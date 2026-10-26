// These parsers consume output from the installed Xcode tools. They are shared
// with executable fixtures so hosted CI cannot mistake zero tests for a pass.
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

export async function waitForMetro({
  origins = ['http://localhost:8081', 'http://127.0.0.1:8081', 'http://[::1]:8081'],
  timeoutMs = 60_000, pollIntervalMs = 1000, requestTimeoutMs = 1000,
  childState = () => ({}), fetchImpl = fetch, onObservation = () => {},
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
      const response = await fetchImpl(target.origin + '/status', { signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(requestTimeoutMs, remaining)))) });
      let body = '', bytes = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (bytes < 256) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            body += new TextDecoder().decode(chunk.value.subarray(0, Math.max(0, 256 - body.length)));
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      const ready = response.ok && body.includes('packager-status:running');
      return { family: target.family, status: response.status, result: ready ? 'ready' : response.ok ? 'unexpected-status-body' : 'http-error' };
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
