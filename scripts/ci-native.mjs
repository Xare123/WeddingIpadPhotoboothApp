import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bounded, redact } from './ci-summary.mjs';
import { verifyNativeCameraMarker } from './native-camera-capability.mjs';
import { NATIVE_RUNTIME_LIMITS, simulatorBuildArchitecture, simulatorArchitectureSettings, stopOwnedProcessGroup, nativeModeSettings, requireNativeTestPlan, verifyNativeRuntimeSources, passingExpectedXCTestCounts, commandStreams, parseNamedJSON, passingXCTestCounts, selectIpadSimulator, waitForMetro, metroErrorCodes, resolveExpoEntry, ownedProcessTree, verifyReleaseApp, requireSwiftTools62 } from './ci-native-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const diagnostics = process.env.WEDDING_DIAGNOSTICS_DIR ?? join(process.env.RUNNER_TEMP ?? '/tmp', 'wedding-native-diagnostics');
const derived = join(process.env.RUNNER_TEMP ?? '/tmp', 'wedding-native-derived');
const resultBundle = join(diagnostics, 'native-tests.xcresult');
const mode = process.argv[2] ?? 'ui-tests';
const settings = nativeModeSettings(mode);
const invocationStartedAt = new Date().toISOString();
const status = { mode, nativeBuild: 'unrun', result: 'running', stages: [], fixture: settings.fixture };
mkdirSync(diagnostics, { recursive: true });
const saveStatus = () => writeFileSync(join(diagnostics, 'status.json'), JSON.stringify(status, null, 2));
let metro, simulator, createdHere = false, bootedHere = false;
const ownedGroups = new Set();
let cancellation, cleanupPromise, runtimePhase = 'preparation';
let phaseDeadline = mode === 'release-runtime' ? Date.now() + NATIVE_RUNTIME_LIMITS.preparationMs : Infinity;

function own(child) {
  const record = { child, spawned: Number.isSafeInteger(child.pid), forced: false };
  ownedGroups.add(record);
  return record;
}
function stop(record, interrupted = false) {
  record.forced ||= interrupted;
  if (!record.stopPromise) {
    record.stopPromise = (!record.spawned
      ? Promise.resolve({ pid: null, quiescent: true, observation: 'spawn-failed-no-group' })
      : stopOwnedProcessGroup(record.child, cancellation ? { graceMs: 1_000, killWaitMs: 2_000 } : {}))
      .then(evidence => { record.evidence = evidence; return evidence; })
      .catch(error => {
        record.evidence = error.processGroup ?? { pid: record.child.pid, quiescent: false, observation: 'stop-unavailable' };
        throw error;
      });
  }
  return record.stopPromise;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    if (cancellation) return;
    cancellation = { signal, code };
    status.result = 'cancelled'; status.error = `Runner received ${signal}`; saveStatus();
    // Let the pending command unwind into awaited cleanup. Exiting immediately
    // after SIGTERM left compiler grandchildren writing ModuleCache during rm.
    for (const record of ownedGroups) if (!record.evidence?.quiescent) void stop(record, true).catch(() => {});
    process.exitCode = code;
  });
}
// No credentials are required by the public native test. Avoid propagating
// token/secret variables into native build scripts or XCTest result bundles.
const fixtureEnv = { ...process.env, EXPO_PUBLIC_E2E_FIXTURE: settings.fixtureFlag, EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', COCOAPODS_DISABLE_STATS: 'true' };
for (const name of Object.keys(fixtureEnv)) if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY/i.test(name)) delete fixtureEnv[name];

function command(name, binary, args, { cwd = root, timeout = 180_000, allowFailure = false, env = fixtureEnv, structured, stdoutLimit } = {}) {
  return new Promise((resolveCommand, reject) => {
    const started = Date.now();
    const entry = { name, result: 'running' };
    status.stages.push(entry); saveStatus();
    if (cancellation && runtimePhase !== 'cleanup') {
      entry.result = 'failed'; saveStatus(); reject(new Error(name + ': runner cancelled')); return;
    }
    if (mode === 'release-runtime' && runtimePhase !== 'xcode') {
      timeout = Math.min(timeout, phaseDeadline - Date.now());
      if (timeout <= 0) {
        entry.result = 'failed'; entry.seconds = 0; saveStatus();
        reject(new Error(name + ': runtime ' + runtimePhase + ' budget exhausted')); return;
      }
    }
    const lines = [], pending = { stdout: '', stderr: '' };
    let timedOut = false, captureError;
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = own(child);
    const collect = (chunk, stream) => {
      // Complete machine output stays in capped memory, never in console/file
      // diagnostics. Stderr still receives the normal bounded redacted log.
      if (structured && stream === 'stdout') return;
      pending[stream] += chunk.toString();
      const complete = pending[stream].split('\n'); pending[stream] = complete.pop().slice(-32_000);
      for (const line of complete) {
        const safe = redact(line).slice(-16_000);
        lines.push(safe);
        if (lines.length > 1200) lines.shift();
        process.stdout.write(safe + '\n');
      }
    };
    const streams = commandStreams(name, { captureStdout: !!structured, stdoutLimit, onLog: collect });
    child.stdout.on('data', chunk => {
      try { streams.stdout(chunk); }
      catch (error) { if (!captureError) { captureError = error; void stop(record, true).catch(() => {}); } }
    });
    child.stderr.on('data', chunk => streams.stderr(chunk));
    const timer = setTimeout(() => { timedOut = true; void stop(record, true).catch(() => {}); }, timeout);
    child.on('error', error => { pending.stderr += error.message; });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      let groupError;
      try { await stop(record); } catch (error) { groupError = error; }
      for (const tail of Object.values(pending)) if (tail) lines.push(redact(tail));
      const output = bounded(lines.join('\n'), 1200, 200_000);
      writeFileSync(join(diagnostics, name + '.log'), output);
      let stdout, json;
      if (structured && !captureError && code === 0 && !timedOut) {
        try {
          stdout = streams.text();
          if (structured === 'json') json = parseNamedJSON(name, stdout);
        } catch (error) { captureError = error; }
      }
      const cancelled = !!cancellation && runtimePhase !== 'cleanup';
      entry.result = code === 0 && !timedOut && !captureError && !groupError && !cancelled ? 'passed' : allowFailure ? 'unavailable' : 'failed';
      entry.seconds = Math.round((Date.now() - started) / 1000);
      entry.exitCode = code; entry.signal = signal;
      entry.processGroup = record.evidence;
      entry.timedOut = timedOut;
      if (name === 'xcode-test') status.xcodeFinishedNormally = !timedOut && !captureError && !groupError && !cancelled && !signal;
      saveStatus();
      if ((code !== 0 || timedOut || captureError || groupError || cancelled) && !allowFailure) {
        reject(captureError ?? groupError ?? new Error(name + (timedOut ? ' timed out' : cancelled ? ' cancelled' : ' failed (exit ' + (code ?? signal) + ')')));
      } else resolveCommand({ output, stdout, json, code });
    });
  });
}
function validationStage(name, validate) {
  const started = Date.now(), entry = { name, result: 'running' };
  status.stages.push(entry); saveStatus();
  try { const result = validate(); entry.result = 'passed'; return result; }
  catch (error) { entry.result = 'failed'; throw error; }
  finally { entry.seconds = Math.round((Date.now() - started) / 1000); saveStatus(); }
}
async function asyncValidationStage(name, validate) {
  const started = Date.now(), entry = { name, result: 'running' };
  status.stages.push(entry); saveStatus();
  try { const result = await validate(); entry.result = 'passed'; return result; }
  catch (error) { entry.result = 'failed'; throw error; }
  finally { entry.seconds = Math.round((Date.now() - started) / 1000); saveStatus(); }
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    runtimePhase = 'cleanup'; phaseDeadline = Date.now() + NATIVE_RUNTIME_LIMITS.cleanupMs;
    await Promise.allSettled([...ownedGroups].map(record => stop(record, !record.evidence?.quiescent)));
    const saveCleanupEvidence = () => {
      const allOwnedGroupsQuiescent = [...ownedGroups].every(record => record.evidence?.quiescent === true);
      status.processCleanup = {
        mode, runnerResult: status.result, allOwnedGroupsQuiescent,
        // Do not infer that an interrupted global Xcode build service is idle
        // from only its original parent's exit. Preserve outputs on failure.
        safeToRemoveBuildOutputs: status.result === 'passed' && allOwnedGroupsQuiescent && ![...ownedGroups].some(record => record.forced),
        safeToInspectResultBundle: status.xcodeFinishedNormally === true && allOwnedGroupsQuiescent,
        groups: [...ownedGroups].map(record => record.evidence),
      };
      writeFileSync(join(diagnostics, 'process-cleanup.json'), JSON.stringify(status.processCleanup, null, 2) + '\n'); saveStatus();
    };
    saveCleanupEvidence();
    if (simulator && createdHere && !cancellation) {
      if (bootedHere) await command('simulator-shutdown', 'xcrun', ['simctl', 'shutdown', simulator.udid], { timeout: 30_000, allowFailure: true });
      if (!cancellation) await command('simulator-delete', 'xcrun', ['simctl', 'delete', simulator.udid], { timeout: 30_000, allowFailure: true });
    }
    if (cancellation && simulator && createdHere) status.simulatorCleanup = 'Deferred to ephemeral runner teardown after cancellation; no new cleanup subprocess spawned';
    saveCleanupEvidence();
  })();
  return cleanupPromise;
}
async function main() {
  if (!['release-build', 'ui-tests', 'release-runtime'].includes(mode)) throw new Error('Native mode must be release-build, release-runtime or ui-tests');
  if (process.platform !== 'darwin') throw new Error('Native verification requires the standard macOS runner');
  const expoEntry = validationStage('expo-entrypoint', () => resolveExpoEntry(join(root, 'apps/ipad')));
  const tools = await command('toolchain', 'xcodebuild', ['-version']);
  const swift = await command('swift-toolchain', 'xcrun', ['swift', '--version']);
  status.swiftVersion = validationStage('swift-compatibility', () => requireSwiftTools62(swift.output));
  if (mode === 'release-runtime') {
    const host = await command('host-architecture', 'uname', ['-m'], { structured: 'text', timeout: 30_000 });
    status.simulatorArchitecture = validationStage('simulator-build-architecture', () => simulatorBuildArchitecture(process.arch, host.stdout));
    status.runtimeLimits = NATIVE_RUNTIME_LIMITS; saveStatus();
  }
  writeFileSync(join(diagnostics, 'toolchain.txt'), `Node ${process.version}\n${tools.output}\n${swift.output}\n`);
  await command('prebuild', process.execPath, [expoEntry.cli, 'prebuild', '--platform', 'ios', '--no-install'], { cwd: join(root, 'apps/ipad') });
  if (!existsSync(join(root, 'scripts/prepare-ios-tests.mjs'))) throw new Error('Native UI test preparation script is missing; tests were not run');
  await command('prepare-tests', process.execPath, ['scripts/prepare-ios-tests.mjs', ...(mode === 'release-runtime' ? ['release-runtime'] : [])]);
  await command('pods', 'pod', ['_1.16.2_', 'install', '--project-directory=ios'], { cwd: join(root, 'apps/ipad'), timeout: 600_000 });
  const planPath = join(root, 'apps/ipad/ios/native-test-plan.json');
  const { plan, workspace, appScheme } = validationStage('native-test-plan', () => {
    if (!existsSync(planPath)) throw new Error('Native UI test plan was not generated');
    const plan = parseNamedJSON('native-test-plan', readFileSync(planPath, 'utf8'));
    requireNativeTestPlan(plan, mode);
    if (mode === 'release-runtime') {
      const evidence = verifyNativeRuntimeSources(plan, root);
      status.expectedTestCount = evidence.expectedTestCount;
      status.runtimeSources = evidence.runtimeSources;
      status.runtimeResources = evidence.runtimeResources;
      writeFileSync(join(diagnostics, 'runtime-sources.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
    const workspace = isAbsolute(plan.workspace) ? plan.workspace : resolve(root, plan.workspace);
    if (!workspace.startsWith(join(root, 'apps/ipad/ios/')) || !existsSync(workspace)) throw new Error('Native test workspace is outside the generated project or missing');
    const project = typeof plan.project === 'string' ? resolve(root, plan.project) : '';
    if (!project.startsWith(join(root, 'apps/ipad/ios/')) || !existsSync(project)) throw new Error('Native app project metadata is missing');
    return { plan, workspace, appScheme: basename(project, '.xcodeproj') };
  });
  if (mode === 'release-build') {
    status.nativeBuild = 'running'; saveStatus();
    await command('release-build', 'xcodebuild', [
      '-workspace', workspace, '-scheme', appScheme, '-configuration', 'Release',
      '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', derived,
      '-jobs', '3', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'build',
    ], { timeout: 1_500_000 });
    const app = join(derived, 'Build/Products/Release-iphoneos', appScheme + '.app');
    const info = await command('release-info', 'plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { structured: 'json' });
    status.releaseEvidence = validationStage('release-evidence', () => verifyReleaseApp(app, info.json, plan.appBundleId));
    status.nativeCameraEvidence = validationStage('native-camera-marker', () => verifyNativeCameraMarker(app, info.json));
    writeFileSync(join(diagnostics, 'release-evidence.json'), JSON.stringify(status.releaseEvidence, null, 2) + '\n');
    writeFileSync(join(diagnostics, 'native-camera-evidence.json'), JSON.stringify(status.nativeCameraEvidence, null, 2) + '\n');
    status.nativeBuild = 'passed'; status.result = 'passed';
    return;
  }
  const deviceOutput = await command('simulator-list', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { structured: 'json' });
  const template = validationStage('simulator-select', () => selectIpadSimulator(deviceOutput.json.devices));
  let deviceType = template.deviceTypeIdentifier;
  if (!deviceType) {
    const types = await command('simulator-types', 'xcrun', ['simctl', 'list', 'devicetypes', '--json'], { structured: 'json' });
    deviceType = validationStage('simulator-type-select', () => {
      if (!Array.isArray(types.json.devicetypes)) throw new Error('simulator-types: missing device type inventory');
      return types.json.devicetypes.find(type => type.name === template.name)?.identifier;
    });
  }
  if (!deviceType) throw new Error('The selected iPad simulator has no device type');
  const created = await command('simulator-create', 'xcrun', ['simctl', 'create', 'Wedding-CI-' + (process.env.GITHUB_RUN_ID ?? Date.now()), deviceType, template.runtime], { structured: 'text' });
  const udid = validationStage('simulator-created-id', () => {
    const value = created.stdout.trim();
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('simulator-create: stdout did not contain a simulator UUID');
    return value;
  });
  simulator = { ...template, name: `Wedding CI (${template.name})`, udid }; createdHere = true;
  status.simulator = { name: simulator.name, runtime: simulator.runtime, udid: simulator.udid }; saveStatus();
  await command('simulator-boot', 'xcrun', ['simctl', 'boot', simulator.udid]); bootedHere = true;
  // Cold Intel iOS26.2 progressed into System App startup at the old 180s limit.
  // Keep readiness mandatory, with a bounded 10-minute cold-boot allowance.
  await command('simulator-ready', 'xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'], { timeout: 600_000 });
  if (settings.requiresMetro) {
    writeFileSync(join(diagnostics, 'metro.log'), 'Metro startup requested.\n');
    const metroEntry = expoEntry;
    const metroLog = ['Metro startup requested.\n'];
    let metroSpawnError;
    const metroOutput = data => {
      metroLog.push(redact(data.toString()));
      if (metroLog.length > 100) metroLog.shift();
      writeFileSync(join(diagnostics, 'metro.log'), bounded(metroLog.join(''), 400, 96_000));
    };
    await asyncValidationStage('metro-startup', () => new Promise((resolveSpawn, reject) => {
      metro = spawn(process.execPath, [metroEntry.cli, 'start', '--localhost', '--port', '8081'], {
        cwd: join(root, 'apps/ipad'), env: fixtureEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      own(metro);
      metro.stdout.on('data', metroOutput); metro.stderr.on('data', metroOutput);
      for (const event of ['exit', 'close']) metro.on(event, (code, signal) => {
        const safeSignal = typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : 'none';
        metroOutput(Buffer.from('Metro lifecycle: ' + event + '; pid ' + metro.pid + '; code ' +
          (Number.isInteger(code) ? code : 'none') + '; signal ' + safeSignal + '; executable ' +
          basename(process.execPath).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) + '\n'));
      });
      metro.once('spawn', () => {
        const message = 'Expo ' + metroEntry.version + ' direct Node CLI spawned; pid ' + metro.pid + '.\n';
        writeFileSync(join(diagnostics, 'metro-startup.log'), message);
        metroOutput(Buffer.from('Metro lifecycle: ' + message));
        resolveSpawn();
      });
      metro.on('error', error => {
        metroSpawnError = metroErrorCodes(error).split(',')[0];
        const safe = 'metro-startup: Expo CLI spawn failed; code ' + metroSpawnError;
        metroOutput(Buffer.from('Error: ' + safe + '\n'));
        writeFileSync(join(diagnostics, 'metro-startup.log'), 'Error: ' + safe + '\n');
        reject(new Error(safe));
      });
    }));
    await asyncValidationStage('metro-ready', async () => {
      try {
        const ready = await waitForMetro({
          childState: () => ({ exitCode: metro.exitCode, signal: metro.signalCode, spawnError: metroSpawnError }),
          onObservation: info => {
            status.metro = info;
            writeFileSync(join(diagnostics, 'metro-ready.log'), 'Metro readiness observations: ' + JSON.stringify(info) + '\n');
            saveStatus();
          },
        });
        status.metro = ready;
        writeFileSync(join(diagnostics, 'metro-ready.log'), 'Metro ready via ' + ready.family + ' after ' + ready.seconds + ' seconds.\n');
      } catch (error) {
        status.metro = error.metro;
        writeFileSync(join(diagnostics, 'metro-ready.log'), 'Error: ' + redact(error.message) + '\n');
        throw error;
      }
    });
  }
  if (mode === 'release-runtime') {
    runtimePhase = 'xcode'; phaseDeadline = Infinity;
    status.preparationSeconds = status.stages.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0);
    saveStatus();
  }
  const test = await command('xcode-test', 'xcodebuild', [
    '-workspace', workspace, '-scheme', plan.scheme, '-configuration', plan.configuration, '-sdk', 'iphonesimulator',
    '-destination', `platform=iOS Simulator,id=${simulator.udid}`, '-derivedDataPath', derived,
    '-resultBundlePath', resultBundle, '-parallel-testing-enabled', 'NO', '-jobs', '3',
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '180',
    '-maximum-test-execution-time-allowance', '300', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
    ...simulatorArchitectureSettings(mode, status.simulatorArchitecture), 'test',
  ], { timeout: mode === 'release-runtime' ? NATIVE_RUNTIME_LIMITS.xcodeMs : 1_500_000 });
  status.tests = mode === 'release-runtime' ? passingExpectedXCTestCounts(test.output, status.expectedTestCount) : passingXCTestCounts(test.output);
  if (mode === 'release-runtime') {
    const app = join(derived, 'Build/Products/Release-iphonesimulator', appScheme + '.app');
    const info = await command('runtime-app-info', 'plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { structured: 'json', timeout: 30000 });
    status.nativeCameraEvidence = validationStage('native-camera-marker', () => verifyNativeCameraMarker(app, info.json));
    writeFileSync(join(diagnostics, 'native-camera-evidence.json'), JSON.stringify(status.nativeCameraEvidence, null, 2) + '\n');
  }
  if (mode === 'release-runtime') status.runtimeEvidence = { configuration: 'Release', sdk: 'iphonesimulator', fixture: 'disabled', metroServer: false, scope: 'coreimage-effects-and-template-pixel-tests-plus-attract-ui', expectedTestCount: status.expectedTestCount };
  status.result = 'passed';
}
try { await main(); }
catch (error) {
  status.result = cancellation ? 'cancelled' : 'failed'; status.error = redact(error instanceof Error ? error.message : String(error)); process.exitCode = cancellation?.code ?? 1;
  if (mode === 'release-build' && status.nativeBuild === 'running') status.nativeBuild = 'failed';
  // A missing application frame can mean the app stopped. Collect only this
  // run's disposable-simulator startup evidence before deleting that simulator.
  // The collector emits reduced JSON, never raw OS logs or crash reports.
  if (mode === 'release-runtime' && createdHere && simulator && !cancellation &&
      status.stages.some(stage => stage.name === 'xcode-test' && stage.result === 'failed')) {
    runtimePhase = 'startup-diagnostics'; phaseDeadline = Date.now() + 30_000;
    try {
      const collected = await command('startup-diagnostics', process.execPath,
        ['scripts/collect-ios-startup-diagnostics.mjs', '--simulator', simulator.udid, '--since', invocationStartedAt],
        { timeout: 25_000, allowFailure: true, structured: 'json', stdoutLimit: 20_000 });
      const report = collected.json;
      if (collected.code === 0 && report?.schemaVersion === 1 && Array.isArray(report.publicMessages)) {
        writeFileSync(join(diagnostics, 'runtime-startup-diagnostics.json'), JSON.stringify(report, null, 2) + '\n');
        status.startupEvidence = report.status;
      } else status.startupEvidence = 'unavailable';
    } catch { status.startupEvidence = 'unavailable'; }
  }
  if (metro) {
    try {
      status.metroProcessTree = ownedProcessTree(metro.pid);
      writeFileSync(join(diagnostics, 'metro-processes.log'), JSON.stringify(status.metroProcessTree, null, 2) + '\n');
    } catch { /* Preserve the original native failure if diagnostics are unavailable. */ }
  }
}
finally {
  try { await cleanup(); }
  catch (error) {
    status.cleanupError = redact(error instanceof Error ? error.message : String(error));
    if (status.result === 'passed') { status.result = 'failed'; process.exitCode = 1; }
    const path = join(diagnostics, 'process-cleanup.json');
    if (existsSync(path)) {
      const evidence = JSON.parse(readFileSync(path, 'utf8'));
      evidence.runnerResult = status.result; evidence.safeToRemoveBuildOutputs = false;
      evidence.cleanupError = status.cleanupError;
      writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
    }
  }
  saveStatus();
}
