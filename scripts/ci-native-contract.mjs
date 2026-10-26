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
