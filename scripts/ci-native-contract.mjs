// These parsers consume output from the installed Xcode tools. They are shared
// with executable fixtures so hosted CI cannot mistake zero tests for a pass.
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export function nativeModeSettings(mode) {
  if (!['release-build', 'ui-tests', 'release-runtime'].includes(mode)) throw new Error('Unknown native verification mode');
  const runtime = mode === 'release-runtime', fixture = mode === 'ui-tests';
  return Object.freeze({
    configuration: runtime ? 'Release' : 'Debug',
    scheme: runtime ? 'WeddingPhotoboothReleaseRuntime' : 'WeddingPhotoboothNativeTests',
    fixture: fixture ? 'synthetic-camera-real-native-storage' : 'disabled',
    fixtureFlag: fixture ? '1' : '0', requiresMetro: fixture,
  });
}

// The observed cold Intel preparation consumed about eleven minutes before
// compilation. Keep separate finite preparation/build/cleanup allowances; the
// workflow backstop must exceed their sum, rather than interrupting Xcode first.
// The single-architecture cold run still compiled RNSVG at the former 25m
// Xcode deadline; retain finite headroom for that observed compilation workload.
export const NATIVE_RUNTIME_LIMITS = Object.freeze({
  preparationMs: 18 * 60_000,
  xcodeMs: 40 * 60_000,
  cleanupMs: 2 * 60_000,
  processStopMs: 12_000,
  nativeStepMinutes: 63,
  jobMinutes: 90,
});

export function simulatorBuildArchitecture(nodeArchitecture, machine) {
  const expected = { x64: 'x86_64', arm64: 'arm64' }[nodeArchitecture];
  if (!expected || String(machine).trim() !== expected) {
    throw new Error('Simulator build requires matching supported Node and host architectures');
  }
  return expected;
}

export function simulatorArchitectureSettings(mode, architecture) {
  if (mode !== 'release-runtime') return [];
  if (!['x86_64', 'arm64'].includes(architecture)) throw new Error('Unsupported simulator build architecture');
  return ['ONLY_ACTIVE_ARCH=YES', 'ARCHS=' + architecture];
}

// Inspect only membership/state in the process group created by detached spawn.
// No arguments, environments or unrelated process records are persisted.
export function ownedProcessGroupState(pid, { signal = process.kill, run = spawnSync } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid owned process group');
  try { signal(-pid, 0); }
  catch (error) {
    if (error?.code === 'ESRCH') return { quiescent: true, live: 0, zombies: 0 };
    return { quiescent: false, live: null, zombies: null, observation: 'group-check-unavailable' };
  }
  // A Linux container can retain reparented zombies. They cannot write outputs,
  // but kill(group,0) alone would wait forever for their init to reap them.
  const members = run('pgrep', ['-g', String(pid)], { encoding: 'utf8', timeout: 500, maxBuffer: 32_768 });
  if (members.error || members.signal || ![0, 1].includes(members.status)) {
    return { quiescent: false, live: null, zombies: null, observation: 'membership-unavailable' };
  }
  const ids = (members.stdout ?? '').trim().split(/\s+/).filter(Boolean);
  if (!ids.length) {
    try { signal(-pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return { quiescent: true, live: 0, zombies: 0 }; }
    return { quiescent: false, live: null, zombies: null, observation: 'membership-race' };
  }
  if (ids.length > 512 || ids.some(value => !/^[1-9]\d*$/.test(value))) {
    return { quiescent: false, live: null, zombies: null, observation: 'membership-bound' };
  }
  const states = run('ps', ['-o', 'pid=,pgid=,stat=', '-p', ids.join(',')], { encoding: 'utf8', timeout: 500, maxBuffer: 65_536 });
  if (states.error || states.signal || states.status !== 0) {
    return { quiescent: false, live: null, zombies: null, observation: 'state-unavailable' };
  }
  const rows = (states.stdout ?? '').trim().split('\n').filter(Boolean).map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/));
  if (!rows.length || rows.some(row => !row || Number(row[2]) !== pid || !ids.includes(row[1]))) {
    return { quiescent: false, live: null, zombies: null, observation: 'state-invalid' };
  }
  const live = rows.filter(row => !row[3].startsWith('Z')).length;
  if (live === 0) {
    // A previously live member can fork and exit between pgrep and ps. Require
    // a second membership snapshot containing only the observed zombies before
    // treating an otherwise existing group as unable to write.
    const again = run('pgrep', ['-g', String(pid)], { encoding: 'utf8', timeout: 500, maxBuffer: 32_768 });
    const current = (again.stdout ?? '').trim().split(/\s+/).filter(Boolean);
    const zombieIds = new Set(rows.map(row => row[1]));
    if (again.error || again.signal || ![0, 1].includes(again.status) || current.some(id => !zombieIds.has(id))) {
      return { quiescent: false, live: null, zombies: rows.length, observation: 'membership-changed' };
    }
  }
  return { quiescent: live === 0, live, zombies: rows.length - live };
}

export async function stopOwnedProcessGroup(child, {
  graceMs = 5_000, killWaitMs = 5_000, pollMs = 50,
  signal = process.kill, state = pid => ownedProcessGroupState(pid),
  now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid || !Array.isArray(child?.spawnargs)) {
    throw new Error('Only a spawned owned process group can be stopped');
  }
  for (const value of [graceMs, killWaitMs, pollMs]) {
    if (!Number.isFinite(value) || value <= 0 || value > NATIVE_RUNTIME_LIMITS.processStopMs) throw new Error('Invalid owned process stop budget');
  }
  if (graceMs + killWaitMs > NATIVE_RUNTIME_LIMITS.processStopMs) throw new Error('Invalid owned process stop budget');
  const started = now(), signals = [];
  const send = name => {
    try { signal(-pid, name); signals.push(name); }
    catch (error) { if (error?.code !== 'ESRCH') throw new Error('Owned process group signal failed'); }
  };
  const until = async deadline => {
    let result;
    do {
      result = state(pid);
      if (result.quiescent) return result;
      const remaining = deadline - now();
      if (remaining <= 0) return result;
      await wait(Math.min(pollMs, remaining));
    } while (true);
  };
  let result = state(pid);
  if (!result.quiescent) { send('SIGTERM'); result = await until(now() + graceMs); }
  if (!result.quiescent) { send('SIGKILL'); result = await until(now() + killWaitMs); }
  const evidence = { pid, signals, ...result, seconds: Math.round((now() - started) / 1000) };
  if (!result.quiescent) {
    const error = new Error('Owned process group did not become quiescent before its cleanup deadline');
    error.processGroup = evidence;
    throw error;
  }
  return evidence;
}

export function runtimeOutputRemovalAllowed(evidence) {
  return evidence?.mode === 'release-runtime' && evidence?.runnerResult === 'passed' &&
    evidence?.allOwnedGroupsQuiescent === true && evidence?.safeToRemoveBuildOutputs === true;
}

export function runtimeResultInspectionAllowed(evidence) {
  // A cleanly exited XCTest failure is still valuable evidence. Its completed
  // result may be inspected/uploaded even though output removal stays blocked.
  return evidence?.mode === 'release-runtime' && evidence?.allOwnedGroupsQuiescent === true &&
    evidence?.safeToInspectResultBundle === true;
}

const runtimeSourceSpecs = [
  ['apps/ipad/native-tests/WeddingPhotoboothReleaseSmokeTests.swift', 1],
  ['apps/ipad/modules/wedding-photo-effects/ios/PhotoEffectsEngine.swift', 0],
  ['apps/ipad/modules/wedding-photo-effects/tests/PhotoEffectsEngineTests.swift', 8],
  ['apps/ipad/modules/wedding-photo-effects/ios/PhotoTemplateEngine.swift', 0],
  ['apps/ipad/modules/wedding-photo-effects/tests/PhotoTemplateEngineTests.swift', 11],
];

// Discover actual named XCTest methods from required, reviewed Swift sources.
// Missing suites and fewer than the known filter/smoke cases fail preparation.
export function nativeRuntimeSources(root) {
  return runtimeSourceSpecs.map(([source, minimumTests]) => {
    const bytes = readFileSync(resolve(root, source));
    const text = bytes.toString('utf8');
    if (/^\s*(?:@testable\s+)?import\s+Expo\w*/m.test(text)) throw new Error('Native pixel sources must be independent of Expo: ' + source);
    const testMethods = [...text.matchAll(/^\s*func\s+(test\w+)\s*\(\s*\)/gm)].map(match => match[1]);
    if (testMethods.length < minimumTests || new Set(testMethods).size !== testMethods.length ||
      (minimumTests === 0 && testMethods.length !== 0)) throw new Error('Unexpected native test method inventory: ' + source);
    return { source, generatedSource: 'NativeTests/' + basename(source),
      sha256: createHash('sha256').update(bytes).digest('hex'), testMethods };
  });
}

const studioResourceNames = ['portrait-1', 'portrait-2', 'portrait-3', 'portrait-4', 'landscape-1', 'landscape-2'];
export function nativeRuntimeResources(root) {
  let total = 0;
  return studioResourceNames.map(name => {
    const source = 'apps/ipad/native-tests/fixtures/studio/studio-' + name + '.jpg';
    const bytes = readFileSync(resolve(root, source));
    if (bytes.length < 4 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Invalid or unbounded clean JPEG resource: ' + source);
    total += bytes.length;
    if (total > 8 * 1024 * 1024) throw new Error('Clean JPEG fixture resources exceed 8 MiB');
    return { source, generatedSource: 'NativeTests/StudioFixtures/' + basename(source),
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  });
}

export function verifyNativeRuntimeSources(plan, root) {
  const actual = nativeRuntimeSources(root);
  if (JSON.stringify(plan?.runtimeSources) !== JSON.stringify(actual)) throw new Error('Native runtime source/hash manifest changed');
  const resources = nativeRuntimeResources(root);
  if (JSON.stringify(plan?.runtimeResources) !== JSON.stringify(resources)) throw new Error('Native runtime resource/hash manifest changed');
  for (const resource of resources) {
    const copy = readFileSync(resolve(root, 'apps/ipad/ios', resource.generatedSource));
    if (createHash('sha256').update(copy).digest('hex') !== resource.sha256) throw new Error('Generated native resource hash mismatch: ' + resource.generatedSource);
  }
  const expected = actual.reduce((count, source) => count + source.testMethods.length, 0);
  if (plan.expectedTestCount !== expected) throw new Error('Native runtime expected test count changed');
  for (const source of actual) {
    const copy = readFileSync(resolve(root, 'apps/ipad/ios', source.generatedSource));
    if (createHash('sha256').update(copy).digest('hex') !== source.sha256) throw new Error('Generated native source hash mismatch: ' + source.generatedSource);
  }
  return { expectedTestCount: expected, runtimeSources: actual, runtimeResources: resources };
}

export function passingExpectedXCTestCounts(output, expected) {
  if (!Number.isSafeInteger(expected) || expected < 1) throw new Error('Invalid expected XCTest count');
  const counts = passingXCTestCounts(output);
  if (counts.executed < expected) throw new Error('XCTest executed ' + counts.executed + ' tests; expected at least ' + expected);
  return counts;
}

export function requireNativeTestPlan(plan, mode) {
  const expected = nativeModeSettings(mode);
  if (plan?.scheme !== expected.scheme || plan.configuration !== expected.configuration ||
    (mode === 'release-runtime' && (plan.fixture !== 'disabled' || plan.metroPort !== null))) {
    throw new Error('Unexpected native UI test plan');
  }
  return plan;
}

export function requireSwiftTools62(output) {
  const match = /\b(?:Apple )?Swift version\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(output));
  if (!match) throw new Error('The selected Xcode did not report a Swift compiler version');
  const major = Number(match[1]), minor = Number(match[2]);
  const version = [major, minor, Number(match[3] ?? 0)].join('.');
  if (major < 6 || (major === 6 && minor < 2)) {
    throw new Error('ExpoModulesJSI requires Swift tools 6.2 or newer; selected compiler is ' + version);
  }
  return version;
}

export function verifyReleaseApp(directory, info, expectedBundleId) {
  if (info?.CFBundleIdentifier !== expectedBundleId) throw new Error('Release app bundle identifier does not match the generated plan');
  if (!Array.isArray(info.UIDeviceFamily) || !info.UIDeviceFamily.includes(2)) throw new Error('Release app does not support the iPad device family');
  if (!Array.isArray(info.CFBundleSupportedPlatforms) || !info.CFBundleSupportedPlatforms.includes('iPhoneOS')) throw new Error('Release app was not built for the physical iOS SDK');
  const executable = info.CFBundleExecutable;
  if (typeof executable !== 'string' || !executable || basename(executable) !== executable) throw new Error('Release executable name is invalid');
  const root = realpathSync(directory);
  const file = name => {
    const path = realpathSync(resolve(root, name));
    const stat = statSync(path);
    if (!path.startsWith(root + sep) || !stat.isFile() || stat.size < 1) throw new Error('Release app is missing a nonempty ' + name);
    return { path, bytes: stat.size };
  };
  const binary = file(executable), bundle = file('main.jsbundle');
  return {
    configuration: 'Release', sdk: 'iphoneos', signed: false, fixture: 'disabled',
    bundleId: expectedBundleId, deviceFamilies: info.UIDeviceFamily,
    executable: executable, executableBytes: binary.bytes, bundleBytes: bundle.bytes,
    bundleSha256: createHash('sha256').update(readFileSync(bundle.path)).digest('hex'),
  };
}

export function resolveExpoEntry(workspace) {
  const manifestPath = resolve(workspace, 'package.json');
  const manifest = parseNamedJSON('workspace-package', readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.dependencies?.expo !== 'string') throw new Error('Workspace Expo dependency is missing');
  const require = createRequire(manifestPath);
  const packagePath = require.resolve('expo/package.json');
  const metadata = parseNamedJSON('expo-package', readFileSync(packagePath, 'utf8'));
  if (metadata.name !== 'expo' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(metadata.version ?? '')) throw new Error('Installed Expo package metadata is invalid');
  if (/^\d+\.\d+\.\d+$/.test(manifest.dependencies.expo) && manifest.dependencies.expo !== metadata.version) throw new Error('Installed Expo version differs from the pinned workspace dependency');
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.expo;
  if (typeof bin !== 'string' || !bin || isAbsolute(bin)) throw new Error('Installed Expo CLI bin is invalid');
  const directory = realpathSync(dirname(packagePath));
  const cli = realpathSync(resolve(directory, bin));
  if (!cli.startsWith(directory + sep) || !statSync(cli).isFile()) throw new Error('Installed Expo CLI must be a file inside its package');
  return { cli, version: metadata.version };
}

export function ownedProcessTree(rootPid, { run = spawnSync, maxProcesses = 12, budgetMs = 1500 } = {}) {
  const result = { processes: [], truncated: false };
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return result;
  const maximum = Math.max(1, Math.min(12, maxProcesses)), deadline = performance.now() + Math.min(1500, budgetMs);
  const queue = [{ pid: rootPid, parent: undefined, depth: 0 }], seen = new Set();
  while (queue.length && result.processes.length < maximum && performance.now() < deadline) {
    const current = queue.shift();
    if (seen.has(current.pid)) continue;
    seen.add(current.pid);
    let record, children;
    try {
      record = run('ps', ['-o', 'pid=,ppid=,pgid=,stat=,comm=', '-p', String(current.pid)], { encoding: 'utf8', timeout: 250, maxBuffer: 8192 });
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z+<>\-]+)\s+(.+?)\s*$/.exec(record.stdout ?? '');
      if (!match || Number(match[1]) !== current.pid || (current.parent !== undefined && Number(match[2]) !== current.parent)) continue;
      result.processes.push({
        pid: current.pid, ppid: Number(match[2]), pgid: Number(match[3]), state: match[4].slice(0, 16),
        executable: basename(match[5].split(/\s+/)[0]).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60),
      });
      if (current.depth >= 2) continue;
      children = run('pgrep', ['-P', String(current.pid)], { encoding: 'utf8', timeout: 250, maxBuffer: 1024 });
      for (const value of (children.stdout ?? '').trim().split(/\s+/).slice(0, 12)) {
        if (/^\d{1,10}$/.test(value) && Number(value) > 0) queue.push({ pid: Number(value), parent: current.pid, depth: current.depth + 1 });
      }
    } catch { /* Missing tools or an exited process do not replace the original failure. */ }
  }
  result.truncated = queue.length > 0;
  return result;
}

export const MAX_MACHINE_STDOUT = 4 * 1024 * 1024;

export function commandStreams(name, { captureStdout = false, stdoutLimit = MAX_MACHINE_STDOUT, onLog = () => {} } = {}) {
  if (!Number.isInteger(stdoutLimit) || stdoutLimit < 1 || stdoutLimit > MAX_MACHINE_STDOUT) throw new Error('Invalid structured stdout byte limit');
  const label = String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const chunks = [];
  let bytes = 0, failure;
  return {
    stdout(chunk) {
      onLog(chunk, 'stdout');
      if (!captureStdout) return;
      if (failure) throw failure;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes + buffer.byteLength > stdoutLimit) {
        failure = new Error(label + ': structured stdout exceeded ' + stdoutLimit + ' bytes');
        throw failure;
      }
      bytes += buffer.byteLength;
      chunks.push(Buffer.from(buffer));
    },
    stderr(chunk) { onLog(chunk, 'stderr'); },
    text() {
      if (failure) throw failure;
      if (!captureStdout) return undefined;
      try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); }
      catch { throw new Error(label + ': structured stdout is not valid UTF-8'); }
    },
  };
}

export function parseNamedJSON(name, source) {
  try { return JSON.parse(source); }
  catch (error) {
    const label = String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const position = /\bposition (\d+)\b/.exec(error instanceof Error ? error.message : '');
    throw new Error(label + ': invalid JSON data' + (position ? ' at position ' + position[1] : ''));
  }
}

export function metroErrorCodes(error) {
  const found = new Set();
  function visit(value, depth = 0) {
    if (!value || depth > 3) return;
    if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)) found.add(value.code);
    if (['AbortError', 'TimeoutError'].includes(value.name)) found.add(value.name);
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors)) for (const nested of value.errors.slice(0, 4)) visit(nested, depth + 1);
  }
  visit(error);
  return [...found].slice(0, 4).join(',') || 'FETCH_ERROR';
}

export function metroHTTPStatus(origin, { timeoutMs = 1000, requestImpl = httpRequest } = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Metro readiness permits only HTTP loopback origins');
  if (!(timeoutMs > 0 && timeoutMs <= 1000)) throw new Error('Invalid Metro HTTP request timeout');
  url.pathname = '/status';
  return new Promise((resolveStatus, reject) => {
    let request, response, finished = false, bytes = 0;
    const chunks = [];
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      if (error) reject(error); else resolveStatus(result);
    };
    const timer = setTimeout(() => {
      const error = new Error('Metro HTTP probe timed out');
      error.code = 'ETIMEDOUT';
      finish(error);
    }, timeoutMs);
    try {
      // node:http avoids Undici's socket quality-of-service path on macOS.
      // Disable pooling so every completed/failed/timed-out probe closes its socket.
      request = requestImpl(url, { method: 'GET', agent: false, headers: { Connection: 'close' } }, incoming => {
        response = incoming;
        const complete = () => {
          if (finished) return;
          const status = incoming.statusCode ?? 0, ok = status >= 200 && status < 300;
          const ready = ok && Buffer.concat(chunks, bytes).toString('utf8').includes('packager-status:running');
          finish(undefined, { status, bytesRead: bytes, result: ready ? 'ready' : ok ? 'unexpected-status-body' : 'http-error' });
        };
        incoming.on('data', chunk => {
          if (finished) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const part = buffer.subarray(0, 256 - bytes);
          chunks.push(Buffer.from(part)); bytes += part.byteLength;
          if (bytes >= 256) complete();
        });
        incoming.once('end', complete);
        incoming.once('error', error => finish(error));
        incoming.once('aborted', () => {
          const error = new Error('Metro HTTP response was aborted'); error.code = 'ECONNRESET'; finish(error);
        });
      });
      request.once('error', error => finish(error));
      request.end();
    } catch (error) { finish(error); }
  });
}

export async function waitForMetro({
  origins = ['http://localhost:8081', 'http://127.0.0.1:8081', 'http://[::1]:8081'],
  timeoutMs = 60_000, pollIntervalMs = 1000, requestTimeoutMs = 1000,
  childState = () => ({}), requestImpl = httpRequest, onObservation = () => {},
} = {}) {
  if (!(timeoutMs > 0 && timeoutMs <= 60_000) || !(requestTimeoutMs > 0 && requestTimeoutMs <= 1000)) throw new Error('Invalid Metro readiness deadline');
  const targets = origins.map(origin => {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Metro readiness permits only HTTP loopback origins');
    return { origin: url.origin, family: url.hostname === 'localhost' ? 'localhost' : url.hostname === '127.0.0.1' ? 'ipv4' : 'ipv6' };
  });
  const started = performance.now(), deadline = started + timeoutMs;
  const lastHttp = new Map();
  let observations = [];
  function snapshot() {
    const state = childState();
    return {
      exitCode: Number.isInteger(state.exitCode) ? state.exitCode : null,
      signal: typeof state.signal === 'string' && /^SIG[A-Z0-9]+$/.test(state.signal) ? state.signal : null,
      spawnError: typeof state.spawnError === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(state.spawnError) ? state.spawnError : null,
    };
  }
  function fail(reason) {
    const state = snapshot();
    const detail = observations.map(item => {
      const http = lastHttp.get(item.family);
      return item.family + ': ' + (item.code ?? ('HTTP ' + item.status + ' ' + item.result)) +
        (item.code && http ? ' (last HTTP ' + http.status + ' ' + http.result + ')' : '');
    }).join('; ') || 'no HTTP observation';
    const error = new Error('metro-ready: ' + reason + '; exit ' + (state.exitCode ?? 'running') + '; signal ' +
      (state.signal ?? 'none') + '; spawn ' + (state.spawnError ?? 'none') + '; ' + detail);
    error.metro = { ...state, observations, lastHttp: [...lastHttp.values()], seconds: Math.round((performance.now() - started) / 1000) };
    throw error;
  }
  async function probe(target, remaining) {
    try {
      const response = await metroHTTPStatus(target.origin, {
        timeoutMs: Math.max(1, Math.floor(Math.min(requestTimeoutMs, remaining))), requestImpl,
      });
      return { family: target.family, ...response };
    } catch (error) { return { family: target.family, result: 'fetch-error', code: metroErrorCodes(error) }; }
  }
  while (performance.now() < deadline) {
    const state = snapshot();
    if (state.exitCode !== null || state.signal || state.spawnError) fail('Expo CLI exited or could not spawn');
    observations = await Promise.all(targets.map(target => probe(target, deadline - performance.now())));
    for (const observation of observations) if (Number.isInteger(observation.status)) lastHttp.set(observation.family, observation);
    const after = snapshot();
    onObservation({ ...after, observations, seconds: Math.round((performance.now() - started) / 1000) });
    if (after.exitCode !== null || after.signal || after.spawnError) fail('Expo CLI exited or could not spawn');
    const ready = observations.find(item => item.result === 'ready');
    if (ready) return { family: ready.family, observations, seconds: Math.round((performance.now() - started) / 1000) };
    await new Promise(resolveWait => setTimeout(resolveWait, Math.max(0, Math.min(pollIntervalMs, deadline - performance.now()))));
  }
  fail('readiness deadline reached');
}

export function selectIpadSimulator(devices) {
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) throw new Error('simctl returned no device inventory');
  const choices = Object.entries(devices).filter(([runtime, rows]) => {
    const version = /\.iOS-(\d+)-(\d+)(?:-\d+)?$/.exec(runtime);
    return Array.isArray(rows) && version && (Number(version[1]) > 16 || (Number(version[1]) === 16 && Number(version[2]) >= 4));
  }).flatMap(([runtime, rows]) => rows.filter(row => row?.isAvailable === true && typeof row.name === 'string' && row.name.startsWith('iPad'))
    .map(row => ({ ...row, runtime })))
    .sort((a, b) => b.runtime.localeCompare(a.runtime, 'en', { numeric: true }));
  if (!choices[0]) throw new Error('No available iPad simulator with iOS 16.4 or newer is installed on this runner');
  return choices[0];
}

export function passingXCTestCounts(output) {
  const counts = [...output.matchAll(/Executed\s+(\d+)\s+tests?,\s+with\s+(?:(\d+)\s+tests?\s+skipped\s+and\s+)?(\d+)\s+failures?/g)]
    .map(match => ({ executed: Number(match[1]), skipped: Number(match[2] ?? 0), failures: Number(match[3]) }));
  if (!counts.length) throw new Error('No executed XCTest count was reported');
  // XCTest repeats counts at case/suite/overall levels. Keep the largest count
  // and reject any observed failure or skip instead of adding duplicate totals.
  const result = {
    executed: Math.max(...counts.map(count => count.executed)),
    failures: Math.max(...counts.map(count => count.failures)),
    skipped: Math.max(...counts.map(count => count.skipped)),
  };
  if (result.executed < 1 || result.failures > 0 || result.skipped > 0) throw new Error(`XCTest did not pass every test: ${JSON.stringify(result)}`);
  return result;
}
