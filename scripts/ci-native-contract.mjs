// These parsers consume output from the installed Xcode tools. They are shared
// with executable fixtures so hosted CI cannot mistake zero tests for a pass.
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

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
