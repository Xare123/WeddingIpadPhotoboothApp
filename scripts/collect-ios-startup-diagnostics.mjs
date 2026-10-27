import { spawn } from 'node:child_process';
import { constants, closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STARTUP_LIMITS = Object.freeze({ reportBytes: 2 * 1024 * 1024, logBytes: 512 * 1024,
  directoryEntries: 512, candidates: 8, reports: 2, messages: 10, outputBytes: 16 * 1024, logMs: 15000 });
const BUNDLE = 'com.example.weddingphotobooth', PROCESS = 'WeddingPhotobooth';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REPORT_NAME = /^WeddingPhotobooth(?:[-_][A-Za-z0-9_.-]{1,180})?\.ips$/;
const SCOPE = Object.freeze({ freshSimulatorOnly: true,
  limitation: 'Startup evidence only; absence cannot distinguish a crash, launch denial or other termination. No running-app or iPad verification.' });
const vocabulary = (`fatal error uncaught exception terminating termination abort aborted called unhandled JS JavaScript JSError
  TypeError ReferenceError SyntaxError RangeError Error RCTFatal RCTFatalException RCTJSErrorException
  NSException NSInvalidArgumentException NSInternalInconsistencyException NSUnknownKeyException NSRangeException NSGenericException
  ExpoScreenOrientation ExpoGlassEffect ExpoCamera ExpoModulesCore React ReactNative ReactCore RCTBridge WeddingPhotobooth UIKit
  TurboModuleRegistry getEnforcing Hermes hermes dyld libdyld libsystem_c libc objc
  cannot could not be found find read property properties undefined null object function is a an of to the in at
  bundle URL no present valid invalid application app entry main registered registry native module modules view viewmanager unable resolve
  require requires import export unexpected token identifier parse symbol library loaded load loader image missing
  incompatible architecture arm64 x86_64 mach-o unsupported failed failure initialization initialize bridge executor
  thread signal code killed launch denied permission operation watchdog timeout signature codesigning dependency dependencies
  must use available unavailable method selector recognized unrecognized argument arguments parameter parameters
  reason message invariant violation invariantviolation runtime render component default named nullpointer
  calling invoke invocation boolean number string expected received evaluated evaluating accessed access set get
  attempted attempt dispatch queue synchronous asynchronous index bounds invalidated retained released memory
  dynamic linker linking linkingError integrity protection malformed unimplemented implemented install installed
  with without on for from by has have been this that because does do it as and or but`).split(/\s+/);
const technical = new Map(vocabulary.filter(Boolean).map(word => [word.toLowerCase(), word]));
const fatalPattern = /fatal|uncaught|exception|abort|terminat|dyld|library\s+not\s+loaded|symbol\s+not\s+found|JSError|TypeError|ReferenceError|SyntaxError|RangeError|invariant|native\s+module|no\s+bundle\s+URL|not\s+been\s+registered|unrecognized\s+selector|unable\s+to\s+resolve|\bError:/i;

export function startupScope({ simulatorId, since, now = Date.now() } = {}) {
  const sinceMs = typeof since === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(since)
    ? Date.parse(since) : NaN;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (typeof simulatorId !== 'string' || !UUID.test(simulatorId) || !Number.isFinite(sinceMs) ||
    !Number.isFinite(nowMs) || sinceMs > nowMs || nowMs - sinceMs > 2 * 60 * 60 * 1000) return null;
  return Object.freeze({ simulatorId: simulatorId.toUpperCase(), sinceMs, nowMs });
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 80) return NaN;
  const match = value.match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?\s?(Z|[+-]\d\d:?\d\d)$/);
  if (!match) return NaN;
  const zone = match[4] === 'Z' ? 'Z' : match[4].replace(/^([+-]\d\d)(\d\d)$/, '$1:$2');
  return Date.parse(match[1] + 'T' + match[2] + '.' + (match[3] ?? '').padEnd(3, '0').slice(0, 3) + zone);
}
function fresh(value, scope) { return Number.isFinite(value) && value >= scope.sinceMs && value <= scope.nowMs; }
function ownedProcessPath(value, scope) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || value.includes('\\')) return false;
  const match = value.match(/\/CoreSimulator\/Devices\/([a-f0-9-]{36})\/data\/Containers\/Bundle\/Application\/([a-f0-9-]{36})\/WeddingPhotobooth\.app\/WeddingPhotobooth$/i);
  return !!match && UUID.test(match[1]) && UUID.test(match[2]) && match[1].toUpperCase() === scope.simulatorId &&
    !value.split('/').some(part => part === '..' || part === '.');
}

// Free-form reason text is projected through a fixed technical vocabulary.
// Unknown identifiers, names and values never become public diagnostic text.
export function sanitizeStartupReason(value) {
  if (typeof value !== 'string' || !fatalPattern.test(value.slice(0, 8192))) return null;
  const stripped = value.slice(0, 8192)
    .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/gi, ' REDACTED ')
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s<>"']+/g, ' REDACTED ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' REDACTED ')
    .replace(/\+?\d[\d ().-]{5,}\d/g, ' REDACTED ')
    .replace(/\b(?:Bearer\s+\S+|[a-f0-9]{24,}|[A-Za-z0-9_-]{32,})\b/gi, ' REDACTED ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
  const words = stripped.match(/[A-Za-z_$][A-Za-z0-9_$-]*|\d+|[.:,;!?()]/g) ?? [];
  const output = [];
  for (const word of words) {
    const safe = technical.get(word.toLowerCase()) ?? (/^[.:,;!?()]$/.test(word) ? word : '[redacted]');
    if (safe !== '[redacted]' || output.at(-1) !== safe) output.push(safe);
  }
  return output.join(' ').replace(/\s+([.:,;!?])/g, '$1').slice(0, 400) || null;
}

function parseReport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > STARTUP_LIMITS.reportBytes) return null;
  try {
    const newline = text.indexOf('\n');
    let header = {}, body;
    try { body = JSON.parse(text); }
    catch {
      if (newline < 0) return null;
      header = JSON.parse(text.slice(0, newline)); body = JSON.parse(text.slice(newline + 1));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !header || typeof header !== 'object' || Array.isArray(header)) return null;
    return { header, body };
  } catch { return null; }
}
function safeCode(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value
    : typeof value === 'string' && /^0x[a-f0-9]{1,16}$/i.test(value) ? value.toLowerCase() : undefined;
}
const namespaces = new Set(['SIGNAL', 'DYLD', 'FRONTBOARD', 'SPRINGBOARD', 'RUNNINGBOARD', 'WATCHDOG', 'CODESIGNING', 'LIBSYSTEM', 'KERNEL', 'TCC', 'PORT_DIED']);
const exceptionTypes = new Set(['EXC_BAD_ACCESS', 'EXC_BAD_INSTRUCTION', 'EXC_ARITHMETIC', 'EXC_EMULATION', 'EXC_SOFTWARE',
  'EXC_BREAKPOINT', 'EXC_SYSCALL', 'EXC_MACH_SYSCALL', 'EXC_RPC_ALERT', 'EXC_CRASH', 'EXC_RESOURCE', 'EXC_GUARD', 'EXC_CORPSE_NOTIFY']);
export function reduceStartupReport(text, scope) {
  const parsed = parseReport(text);
  if (!parsed || !scope) return null;
  const { body, header } = parsed;
  if (body.procName !== PROCESS || body.bundleInfo?.CFBundleIdentifier !== BUNDLE || !ownedProcessPath(body.procPath, scope) ||
    !fresh(timestamp(body.captureTime ?? header.timestamp), scope) ||
    (header.timestamp !== undefined && !fresh(timestamp(header.timestamp), scope))) return null;
  const exception = {}, termination = {};
  if (exceptionTypes.has(body.exception?.type)) exception.type = body.exception.type;
  if (typeof body.exception?.signal === 'string' && /^SIG(?:ABRT|KILL|SEGV|BUS|ILL|TRAP|TERM|QUIT|SYS|FPE)$/.test(body.exception.signal)) exception.signal = body.exception.signal;
  if (namespaces.has(body.termination?.namespace)) termination.namespace = body.termination.namespace;
  const code = safeCode(body.termination?.code); if (code !== undefined) termination.code = code;
  const candidates = [body.termination?.indicator, body.termination?.reason, body.exception?.message,
    body.lastExceptionReason, body.abortReason, body.fatalError, body.dyldError];
  if (Array.isArray(body.termination?.details)) candidates.push(...body.termination.details.slice(0, 4));
  for (const key of ['libsystem_c.dylib', 'libobjc.A.dylib', 'libc++abi.dylib', 'dyld', 'libdyld.dylib', 'React', 'ReactNative']) {
    const value = body.asi?.[key];
    if (typeof value === 'string') candidates.push(value);
    else if (Array.isArray(value)) candidates.push(...value.slice(0, 4));
  }
  const reasons = [...new Set(candidates.map(sanitizeStartupReason).filter(Boolean))].slice(0, 3);
  return { source: 'fresh-correlated-ips', exception, termination, reasons };
}

export function reduceStartupLogs(text, scope) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > STARTUP_LIMITS.logBytes || !scope) return null;
  let records; try { records = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(records) || records.length > 2000) return null;
  const messages = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || !fresh(timestamp(record.timestamp), scope) ||
      !ownedProcessPath(record.processImagePath, scope) || (record.process !== undefined && record.process !== PROCESS)) continue;
    const errorLevel = typeof record.messageType === 'string' && ['error', 'fault'].includes(record.messageType.toLowerCase());
    if (!errorLevel && !(typeof record.eventMessage === 'string' && /fatal|uncaught|JSError|TypeError|ReferenceError|SyntaxError|RangeError|dyld/i.test(record.eventMessage))) continue;
    const reason = sanitizeStartupReason(record.eventMessage);
    if (reason && !messages.includes(reason)) messages.push(reason);
    if (messages.length >= STARTUP_LIMITS.messages) break;
  }
  return messages;
}

export function startupLogArguments(scope) {
  if (!scope || !UUID.test(scope.simulatorId)) throw new Error('Invalid startup diagnostic scope');
  return ['simctl', 'spawn', scope.simulatorId, 'log', 'show', '--style', 'json', '--last', '5m', '--predicate',
    '(process == "WeddingPhotobooth") AND (messageType == error OR messageType == fault OR eventMessage CONTAINS[c] "fatal" OR eventMessage CONTAINS[c] "uncaught" OR eventMessage CONTAINS[c] "JSError" OR eventMessage CONTAINS[c] "dyld")'];
}

export function queryStartupLogs(scope, { spawnImpl = spawn, timeoutMs = STARTUP_LIMITS.logMs, signal, killGraceMs = 500, killWaitMs = 1500 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > STARTUP_LIMITS.logMs ||
    !Number.isFinite(killGraceMs) || killGraceMs <= 0 || killGraceMs > 1000 ||
    !Number.isFinite(killWaitMs) || killWaitMs <= 0 || killWaitMs > 2000) throw new Error('Invalid startup log budget');
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled', messages: [], quiescent: true });
  return new Promise(resolveQuery => {
    let child, timer, killTimer, stopTimer, stopped, settled = false, size = 0, stderrBytes = 0;
    const chunks = [];
    const finish = (status, quiescent, messages = []) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(stopTimer); signal?.removeEventListener('abort', abort);
      resolveQuery({ status, messages, quiescent });
    };
    const stop = status => {
      if (stopped || settled) return; stopped = status;
      try { child?.kill('SIGTERM'); } catch { /* No raw process error is retained. */ }
      killTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, killGraceMs);
      stopTimer = setTimeout(() => {
        child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
        finish('cleanup-unverified', false);
      }, killGraceMs + killWaitMs);
    };
    const abort = () => stop('cancelled');
    try {
      // Inherit the collector's parent-owned process group; an outer cancellation
      // can stop the collector and helpers together. Never create a nested PGID.
      child = spawnImpl('xcrun', startupLogArguments(scope), { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { finish('unavailable', true); return; }
    child.stdout.on('data', chunk => {
      size += chunk.length; if (size > STARTUP_LIMITS.logBytes) { stop('oversize'); return; }
      if (!stopped) chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) stop('oversize'); });
    child.once('error', () => stop('unavailable'));
    child.once('close', code => {
      if (stopped) { finish(stopped, true); return; }
      if (code !== 0) { finish('unavailable', true); return; }
      const messages = reduceStartupLogs(Buffer.concat(chunks).toString('utf8'), scope);
      finish(messages ? 'collected' : 'malformed', true, messages ?? []);
    });
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('timeout'), timeoutMs);
  });
}

export function createStartupDiagnosticsPort({ reportsDirectory = join(homedir(), 'Library/Logs/DiagnosticReports'), logQuery = queryStartupLogs } = {}) {
  let directory;
  return {
    listReports() {
      const entries = []; let handle, scanned = 0, truncated = false;
      try {
        const stat = lstatSync(reportsDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: 'unsafe', entries };
        directory = realpathSync(reportsDirectory); handle = opendirSync(directory);
        for (let entry; (entry = handle.readSync());) {
          if (++scanned > STARTUP_LIMITS.directoryEntries) { truncated = true; break; }
          if (!REPORT_NAME.test(entry.name)) continue;
          const stat = lstatSync(join(directory, entry.name));
          entries.push({ name: entry.name, regular: stat.isFile() && !stat.isSymbolicLink(),
            bytes: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
        }
        return { status: 'ready', truncated, entries };
      } catch (error) { return { status: error?.code === 'ENOENT' ? 'missing' : 'unavailable', entries: [] }; }
      finally { try { handle?.closeSync(); } catch {} }
    },
    readReport(entry) {
      if (!directory || !REPORT_NAME.test(entry.name) || constants.O_NOFOLLOW === undefined) throw new Error('Unsafe report');
      const descriptor = openSync(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = fstatSync(descriptor);
        if (!before.isFile() || before.ino !== entry.ino || before.dev !== entry.dev || before.size !== entry.bytes ||
          before.mtimeMs !== entry.mtimeMs || before.size <= 0 || before.size > STARTUP_LIMITS.reportBytes) throw new Error('Changed report');
        const buffer = Buffer.alloc(before.size + 1); let length = 0, count;
        do { count = readSync(descriptor, buffer, length, buffer.length - length, null); length += count; } while (count && length < buffer.length);
        const after = fstatSync(descriptor);
        if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Changed report');
        return buffer.subarray(0, length).toString('utf8');
      } finally { closeSync(descriptor); }
    },
    readLogs: (scope, options) => logQuery(scope, options),
  };
}

function emptyReport(status) {
  return { schemaVersion: 1, status, scope: SCOPE, publicMessages: ['No safely correlated startup diagnostic was available; the original test failure remains decisive.'],
    reports: [], log: { status: 'not-requested', messages: [], quiescent: true } };
}
export async function collectIOSStartupDiagnostics(options = {}, port = createStartupDiagnosticsPort()) {
  const scope = startupScope(options);
  if (!scope) return emptyReport('invalid-scope');
  const report = emptyReport('not-found');
  if (options.signal?.aborted) return emptyReport('cancelled');
  let listing;
  try { listing = await port.listReports(); } catch { listing = { status: 'unavailable', entries: [] }; }
  report.reportScan = { status: ['ready', 'missing', 'unsafe', 'unavailable'].includes(listing?.status) ? listing.status : 'unavailable',
    truncated: listing?.truncated === true, examined: 0, rejected: 0 };
  const entries = Array.isArray(listing?.entries) ? listing.entries.slice(0, STARTUP_LIMITS.directoryEntries) : [];
  const candidates = entries.filter(entry => entry && REPORT_NAME.test(entry.name) && entry.regular === true &&
    Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= STARTUP_LIMITS.reportBytes && fresh(entry.mtimeMs, scope))
    .sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, STARTUP_LIMITS.candidates);
  for (const candidate of candidates) {
    if (options.signal?.aborted || report.reports.length >= STARTUP_LIMITS.reports) break;
    report.reportScan.examined++;
    let reduced; try { reduced = reduceStartupReport(await port.readReport(candidate), scope); } catch {}
    if (reduced) report.reports.push(reduced); else report.reportScan.rejected++;
  }
  if (options.includeLogs !== false && !options.signal?.aborted) {
    try {
      const log = await port.readLogs(scope, { signal: options.signal });
      if (log && ['collected', 'malformed', 'unavailable', 'timeout', 'oversize', 'cancelled', 'cleanup-unverified'].includes(log.status) &&
        Array.isArray(log.messages) && log.messages.every(value => typeof value === 'string' && value.length <= 400)) {
        report.log = { status: log.status, messages: log.messages.slice(0, STARTUP_LIMITS.messages).map(sanitizeStartupReason).filter(Boolean), quiescent: log.quiescent === true };
      } else report.log = { status: 'unavailable', messages: [], quiescent: false };
    } catch { report.log = { status: 'unavailable', messages: [], quiescent: false }; }
  }
  const reasons = [...report.reports.flatMap(entry => {
    const termination = [entry.termination.namespace,
      entry.termination.code !== undefined ? 'code ' + entry.termination.code : ''].filter(Boolean).join(' ');
    return [[entry.exception.type, entry.exception.signal, termination].filter(Boolean).join(' / '), ...entry.reasons];
  }), ...report.log.messages].filter(Boolean);
  if (reasons.length) { report.status = 'collected'; report.publicMessages = [...new Set(reasons)].slice(0, 3).map(value => value.slice(0, 400)); }
  else if (report.reports.length) { report.status = 'collected'; report.publicMessages = ['A fresh app report matched the disposable simulator, but contained no safely publishable startup reason.']; }
  else if (report.reportScan.status === 'unavailable' || report.log.status === 'unavailable') report.status = 'unavailable';
  if (options.signal?.aborted) report.status = 'cancelled';
  if (Buffer.byteLength(JSON.stringify(report)) > STARTUP_LIMITS.outputBytes) return emptyReport('output-bound');
  return report;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--simulator') options.simulatorId = args[++index];
    else if (args[index] === '--since') options.since = args[++index];
    else if (args[index] === '--no-logs') options.includeLogs = false;
    else { process.stdout.write(JSON.stringify(emptyReport('invalid-scope')) + '\n'); return; }
  }
  const abort = new AbortController(); options.signal = abort.signal;
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let report;
  try { report = process.platform === 'darwin' ? await collectIOSStartupDiagnostics(options) : emptyReport('unavailable'); }
  catch { report = emptyReport('unavailable'); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) void main().catch(() => {
  process.stdout.write(JSON.stringify(emptyReport('unavailable')) + '\n');
});
