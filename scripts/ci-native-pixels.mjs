import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bounded, diagnosticLines, redact, workflowData } from './ci-summary.mjs';
import { commandStreams, parseNamedJSON, requireSwiftTools62, selectIpadSimulator, simulatorBuildArchitecture, stopOwnedProcessGroup } from './ci-native-contract.mjs';
import { createPixelProject, ownedSimulatorRemoval, pixelBuildSettingsArguments, pixelCleanupDecision, PIXEL_LIMITS, PIXEL_REQUIRED_CASES, requireUnhostedPixelSettings, verifyPixelProject } from './native-pixel-project.mjs';
import { EXPECTED_PIXEL_ATTACHMENTS, expectedPixelAttachments, exportNamedPixelJpegs, inspectPixelTests, requirePassingPixelTests, safeSchemaShape } from './native-pixel-results.mjs';
import { CORE_PIXEL_PROFILE, TREATMENT_PIXEL_PROFILE, nativePixelProfile } from './native-treatment-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = process.env.RUNNER_TEMP ?? join(root, '.cache');
const diagnostics = process.env.WEDDING_PIXEL_DIAGNOSTICS_DIR ?? join(temporary, 'wedding-native-pixels-diagnostics');
const resultBundle = join(diagnostics, 'native-pixels.xcresult');
mkdirSync(diagnostics, { recursive: true });
const status = { mode: 'native-pixels', result: 'running', expectedTests: PIXEL_REQUIRED_CASES,
  expectedJpegs: EXPECTED_PIXEL_ATTACHMENTS.length, tests: null, stages: [],
  scope: 'Nineteen real production Core Image/template XCTest methods only. Full Expo app smoke, bridge, camera, Photos, signing and physical iPad remain unverified.' };
let profile = nativePixelProfile(CORE_PIXEL_PROFILE);
const saveStatus = () => writeFileSync(join(diagnostics, 'status.json'), JSON.stringify(status, null, 2) + '\n');
const records = new Set();
let cancellation, plan, simulator, simulatorCreationRequested = false, phase = 'preparation', deadline = Date.now() + PIXEL_LIMITS.preparationMs;
const environment = { ...process.env };
for (const name of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY/i.test(name)) delete environment[name];

function stop(record, forced = false) {
  record.forced ||= forced;
  if (!record.stopping) record.stopping = (!Number.isSafeInteger(record.child.pid)
    ? Promise.resolve({ quiescent: true, pid: null, observation: 'spawn-failed' })
    : stopOwnedProcessGroup(record.child, cancellation ? { graceMs: 1000, killWaitMs: 2000 } : {}))
    .then(value => { record.evidence = value; return value; })
    .catch(error => { record.evidence = error.processGroup ?? { quiescent: false, observation: 'unavailable' }; throw error; });
  return record.stopping;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  if (cancellation) return;
  cancellation = { signal, code }; status.result = 'cancelled'; saveStatus();
  for (const record of records) if (!record.evidence?.quiescent) void stop(record, true).catch(() => {});
  process.exitCode = code;
});

async function command(name, binary, args, { timeout = 180_000, structured = false, allowFailure = false } = {}) {
  const entry = { name, result: 'running' }, started = Date.now();
  status.activeStage = name; status.stages.push(entry); saveStatus();
  if (cancellation && phase !== 'cleanup') throw new Error(name + ': cancelled');
  timeout = Math.min(timeout, deadline - Date.now());
  if (timeout <= 0) { entry.result = 'failed'; saveStatus(); throw new Error(name + ': phase budget exhausted'); }
  return new Promise((resolveCommand, reject) => {
    const lines = [], pending = { stdout: '', stderr: '' };
    const collect = (chunk, stream) => {
      if (structured && stream === 'stdout') return;
      pending[stream] += chunk.toString();
      const complete = pending[stream].split('\n'); pending[stream] = complete.pop().slice(-16000);
      for (const line of complete) {
        const safe = redact(line).slice(-16000); lines.push(safe);
        if (lines.length > 1200) lines.shift(); process.stdout.write(safe + '\n');
      }
    };
    const child = spawn(binary, args, { cwd: root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { child }; records.add(record);
    let timedOut = false, captureError;
    const streams = commandStreams(name, { captureStdout: structured, onLog: collect });
    child.stdout.on('data', chunk => { try { streams.stdout(chunk); } catch (error) { captureError = error; void stop(record, true).catch(() => {}); } });
    child.stderr.on('data', chunk => streams.stderr(chunk));
    child.on('error', error => { pending.stderr += error.code ?? 'spawn failed'; });
    const timer = setTimeout(() => { timedOut = true; void stop(record, true).catch(() => {}); }, timeout);
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      let groupError; try { await stop(record); } catch (error) { groupError = error; }
      for (const tail of Object.values(pending)) if (tail) lines.push(redact(tail));
      const output = bounded(lines.join('\n'), 1200, 200000);
      writeFileSync(join(diagnostics, name + '.log'), output + '\n');
      const interrupted = timedOut || captureError || groupError || (cancellation && phase !== 'cleanup');
      entry.exitCode = code; entry.signal = signal; entry.seconds = Math.round((Date.now() - started) / 1000);
      entry.timedOut = timedOut; entry.processGroup = record.evidence;
      entry.result = code === 0 && !interrupted ? 'passed' : 'failed';
      if (name === 'xcode-test') status.xcodeFinishedNormally = !interrupted && !signal;
      saveStatus();
      if (interrupted || (code !== 0 && !allowFailure)) {
        reject(captureError ?? groupError ?? new Error(name + (timedOut ? ' timed out' : ' failed'))); return;
      }
      let stdout;
      try { if (structured && !captureError) stdout = streams.text(); }
      catch (error) { reject(error); return; }
      resolveCommand({ output, stdout, code });
    });
  });
}

function validation(name, action) {
  const entry = { name, result: 'running' }; status.activeStage = name; status.stages.push(entry); saveStatus();
  try { const value = action(); entry.result = 'passed'; return value; }
  catch (error) {
    entry.result = 'failed';
    if (error.diagnosticShape) status.schemaDiagnostic = error.diagnosticShape;
    throw error;
  } finally { saveStatus(); }
}
function jsonFile(name, value) { writeFileSync(join(diagnostics, name), JSON.stringify(value, null, 2) + '\n'); }
function rawSize(directory, limit = 64 * 1024 * 1024) {
  const pending = [directory]; let bytes = 0, count = 0;
  while (pending.length) {
    const path = pending.pop(), stat = lstatSync(path);
    if (++count > 20000 || stat.isSymbolicLink()) return { eligible: false, reason: 'unsupported or excessive result entries' };
    if (stat.isDirectory()) pending.push(...readdirSync(path).map(name => join(path, name)));
    else { bytes += stat.size; if (bytes > limit) return { eligible: false, bytesAtLeast: bytes, reason: 'over64MiB' }; }
  }
  return { eligible: true, bytes };
}

async function main() {
  profile = validation('selected-profile', () => nativePixelProfile(process.argv[2] ?? CORE_PIXEL_PROFILE));
  status.profile = profile.id; status.expectedTests = profile.expectedTests; status.expectedJpegs = profile.expectedJpegs;
  if (profile.id === TREATMENT_PIXEL_PROFILE) status.scope = 'Nineteen original Core Image/template cases plus ten production treatment cases in a real iOS simulator. Same-target pure Swift: no Expo bridge/UI, camera, Photos, durable app storage, signing or physical iPad proof.';
  if (process.platform !== 'darwin') throw new Error('Native pixel execution requires the supported macOS/Xcode runner');
  const tools = await command('toolchain', 'xcodebuild', ['-version'], { structured: true, timeout: 30000 });
  validation('selected-xcode', () => { if (!/^Xcode 26\.3\s/m.test(tools.stdout)) throw new Error('Select the reviewed Xcode26.3 installation'); });
  const swift = await command('swift', 'xcrun', ['swift', '--version'], { structured: true, timeout: 30000 });
  status.swiftVersion = validation('selected-swift', () => requireSwiftTools62(swift.stdout));
  const machine = await command('host-architecture', 'uname', ['-m'], { structured: true, timeout: 30000 });
  status.architecture = simulatorBuildArchitecture(process.arch, machine.stdout);
  jsonFile('toolchain.json', { xcode: tools.stdout.trim(), swift: status.swiftVersion, architecture: status.architecture });
  for (const [name, args, flags] of [
    ['xcresult-tests-help', ['xcresulttool', 'get', 'test-results', 'tests', '--help'], ['--path']],
    ['xcresult-summary-help', ['xcresulttool', 'get', 'test-results', 'summary', '--help'], ['--path']],
    ['xcresult-export-help', ['xcresulttool', 'export', 'attachments', '--help'], ['--path', '--output-path']],
  ]) {
    const help = await command(name, 'xcrun', args, { structured: true, timeout: 15000 });
    writeFileSync(join(diagnostics, name + '.log'), bounded(help.stdout, 120, 16000));
    status.cliSyntax ??= {};
    status.cliSyntax[name] = help.stdout.split('\n').filter(line => /^USAGE:|--path\b|--output-path\b/.test(line)).slice(0, 4).map(line => redact(line).trim().slice(0, 200));
    validation(name + '-syntax', () => { if (!flags.every(flag => help.stdout.includes(flag))) throw new Error(name + ': required CLI syntax unavailable'); });
  }
  const directory = mkdtempSync(join(temporary, 'wedding-native-pixels-project-'));
  plan = validation('generate-independent-project', () => createPixelProject(root, directory, profile.id));
  jsonFile('source-manifest.json', plan);
  const inventory = await command('simulator-list', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { structured: true });
  const template = validation('simulator-select', () => selectIpadSimulator(parseNamedJSON('simulator-list', inventory.stdout).devices));
  let deviceType = template.deviceTypeIdentifier;
  if (!deviceType) {
    const types = await command('simulator-types', 'xcrun', ['simctl', 'list', 'devicetypes', '--json'], { structured: true });
    deviceType = parseNamedJSON('simulator-types', types.stdout).devicetypes?.find(value => value.name === template.name)?.identifier;
  }
  if (!deviceType) throw new Error('Selected dedicated iPad simulator lacks device type');
  simulatorCreationRequested = true;
  const created = await command('simulator-create', 'xcrun', ['simctl', 'create', 'Wedding-Pixels-' + (process.env.GITHUB_RUN_ID ?? Date.now()), deviceType, template.runtime], { structured: true });
  if (!/^[a-f0-9-]{36}$/i.test(created.stdout.trim())) throw new Error('Simulator creation did not return a UUID');
  simulator = { udid: created.stdout.trim(), runtime: template.runtime, createdHere: true };
  status.simulator = simulator; saveStatus();
  await command('simulator-boot', 'xcrun', ['simctl', 'boot', simulator.udid]);
  await command('simulator-ready', 'xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'], { timeout: 600000 });
  const base = ['-project', plan.project, '-scheme', plan.scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator',
    '-destination', 'platform=iOS Simulator,id=' + simulator.udid, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
    'ONLY_ACTIVE_ARCH=YES', 'ARCHS=' + status.architecture];
  const settings = await command('unhosted-build-settings', 'xcodebuild', pixelBuildSettingsArguments(plan, status.architecture), { structured: true });
  const parsed = parseNamedJSON('unhosted-build-settings', settings.stdout);
  try { status.target = validation('verify-unhosted-build-settings', () => requireUnhostedPixelSettings(parsed)); }
  catch (error) { error.diagnosticShape ??= safeSchemaShape(parsed); throw error; }
  jsonFile('target-proof.json', status.target);
  validation('verify-before-build', () => verifyPixelProject(plan, root));
  status.preparationSeconds = status.stages.reduce((sum, stage) => sum + (stage.seconds ?? 0), 0);
  phase = 'xcode'; deadline = Date.now() + PIXEL_LIMITS.xcodeMs;
  const execution = await command('xcode-test', 'xcodebuild', [...base,
    '-derivedDataPath', join(plan.directory, 'DerivedData'), '-resultBundlePath', resultBundle,
    '-parallel-testing-enabled', 'NO', '-jobs', '3', '-test-timeouts-enabled', 'YES',
    '-default-test-execution-time-allowance', '180', '-maximum-test-execution-time-allowance', '300', 'test'],
    { timeout: PIXEL_LIMITS.xcodeMs, allowFailure: true });
  phase = 'artifacts'; deadline = Date.now() + PIXEL_LIMITS.artifactsMs;
  validation('verify-after-build', () => verifyPixelProject(plan, root));
  if (!status.xcodeFinishedNormally || ![...records].every(record => record.evidence?.quiescent === true)) throw new Error('Cannot inspect an interrupted or unverified native result');
  const summaryOutput = await command('xcresult-summary', 'xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundle], { structured: true, timeout: 30000 });
  const summary = parseNamedJSON('xcresult-summary', summaryOutput.stdout); jsonFile('xctest-summary.json', summary);
  status.validRawResult = rawSize(resultBundle); saveStatus();
  const testOutput = await command('xcresult-test-identities', 'xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle], { structured: true, timeout: 30000 });
  const tree = parseNamedJSON('xcresult-test-identities', testOutput.stdout); jsonFile('xctest-tests.json', tree);
  const errors = [];
  try { status.tests = validation('verify-named-identities', () => inspectPixelTests(tree, plan.expectedCases, profile.id)); }
  catch (error) { errors.push(error); jsonFile('unsupported-schema.json', { shape: safeSchemaShape(tree), stage: 'native-test-identities' }); }
  const exports = join(plan.directory, 'ExportedAttachments');
  await command('xcresult-export-attachments', 'xcrun', ['xcresulttool', 'export', 'attachments', '--path', resultBundle, '--output-path', exports], { timeout: 60000 });
  try {
    const manifest = JSON.parse(readFileSync(join(exports, 'manifest.json'), 'utf8'));
    status.jpegs = validation('verify-native-jpegs', () => exportNamedPixelJpegs({ exportDirectory: exports,
      outputDirectory: join(diagnostics, 'native-jpegs'), manifest, requireComplete: false, profile: profile.id }));
    jsonFile('native-jpeg-evidence.json', status.jpegs);
  } catch (error) { errors.push(error); if (error.diagnosticShape) status.schemaDiagnostic = error.diagnosticShape; }
  if (errors.length) throw errors[0];
  validation('native-pixel-acceptance', () => {
    requirePassingPixelTests(status.tests, summary, profile.id);
    if (execution.code !== 0) throw new Error('xcodebuild did not exit successfully');
    if (!status.jpegs?.complete || status.jpegs.entries.length !== expectedPixelAttachments(profile.id).length) throw new Error('Required baseline/profile native JPEG attachments are incomplete');
  });
  status.result = 'passed';
}

async function cleanup() {
  phase = 'cleanup'; deadline = Date.now() + PIXEL_LIMITS.cleanupMs;
  await Promise.allSettled([...records].map(record => stop(record, !record.evidence?.quiescent)));
  let shutdown, deletion, inventory;
  if (simulator?.createdHere && !cancellation) {
    shutdown = await command('simulator-shutdown', 'xcrun', ['simctl', 'shutdown', simulator.udid], { timeout: 30000, allowFailure: true }).catch(() => undefined);
    if (!cancellation) deletion = await command('simulator-delete', 'xcrun', ['simctl', 'delete', simulator.udid], { timeout: 30000, allowFailure: true }).catch(() => undefined);
    if (!cancellation && deletion?.code !== 0) {
      try {
        const observed = await command('simulator-removal-confirm', 'xcrun', ['simctl', 'list', 'devices', '--json'], { structured: true, timeout: 30000 });
        inventory = parseNamedJSON('simulator-removal-confirm', observed.stdout);
      } catch { /* Do not claim removal from absent/malformed inventory. */ }
    }
  }
  const removal = ownedSimulatorRemoval({ udid: simulator?.udid, creationRequested: simulatorCreationRequested,
    cancelled: !!cancellation, deleteCode: deletion?.code, inventory });
  const quiescent = [...records].every(record => record.evidence?.quiescent === true);
  const decision = pixelCleanupDecision({ result: status.result, quiescent, removal,
    forced: [...records].some(record => record.forced) });
  status.processCleanup = { allOwnedGroupsQuiescent: quiescent, groups: [...records].map(record => record.evidence),
    simulatorRemoval: removal, shutdownExitCode: shutdown?.code ?? null, deleteExitCode: deletion?.code ?? null,
    cleanupVerified: decision.cleanupVerified, buildOutputsRemoved: false, fullAppSmokeVerified: false };
  if (status.result === 'passed' && decision.result === 'failed') {
    status.result = 'failed'; status.error = decision.error; process.exitCode = 1;
    status.stages.push({ name: 'owned-resource-cleanup', result: 'failed' });
  }
  if (plan && decision.removeBuildOutputs) {
    rmSync(plan.directory, { recursive: true, force: true }); status.processCleanup.buildOutputsRemoved = true;
  }
  jsonFile('process-cleanup.json', status.processCleanup);
}

try { await main(); }
catch (error) {
  status.result = cancellation ? 'cancelled' : 'failed'; process.exitCode = cancellation?.code ?? 1;
  status.error = redact(String(error?.message ?? 'Native pixel verification failed')).slice(0, 1000);
  if (error.diagnosticShape) status.schemaDiagnostic = error.diagnosticShape;
}
finally {
  try { await cleanup(); } catch { status.cleanupError = 'Cleanup incomplete; outputs retained on ephemeral runner'; if (status.result === 'passed') { status.result = 'failed'; process.exitCode = 1; } }
  saveStatus();
  const sha = /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : 'local';
  const stage = status.result === 'passed' ? 'complete' : status.stages.filter(value => value.result === 'failed').at(-1)?.name ?? status.activeStage ?? phase;
  const classes = status.tests?.cases?.reduce((value, item) => { const name = item.id.split('.')[0]; value[name] = (value[name] ?? 0) + 1; return value; }, {}) ?? {};
  const message = { commit: sha, profile: profile.id, result: status.result, stage, expectedTests: profile.expectedTests, executed: status.tests?.executed ?? 'unknown',
    failures: status.tests?.failures ?? 'unknown', skipped: status.tests?.skipped ?? 'unknown', classes,
    nativeJpegs: status.jpegs?.entries?.length ?? 0, expectedNativeJpegs: profile.expectedJpegs,
    fullExpoSmokeVerified: false, error: status.error, schema: status.schemaDiagnostic };
  jsonFile('public-evidence.json', message);
  const logs = Object.fromEntries(readdirSync(diagnostics).filter(name => name.endsWith('.log')).map(name => [name, readFileSync(join(diagnostics, name), 'utf8')]));
  const detail = diagnosticLines(logs, status.stages, 2).join('; ');
  const body = JSON.stringify(message).slice(0, 2500) + (detail ? '; ' + detail : '');
  console.log('::' + (status.result === 'passed' ? 'notice' : 'error') + ' title=Native pixel XCTest evidence::' + workflowData(body));
  if (status.result !== 'passed' && status.schemaDiagnostic && status.cliSyntax) {
    console.log('::notice title=Native pixel CLI syntax::' + workflowData(JSON.stringify(status.cliSyntax).slice(0, 1600)));
  }
}
