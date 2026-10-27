import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectIOSStartupDiagnostics, createStartupDiagnosticsPort, queryStartupLogs, reduceStartupLogs,
  reduceStartupReport, sanitizeStartupReason, STARTUP_LIMITS, startupLogArguments, startupScope } from './collect-ios-startup-diagnostics.mjs';

const simulatorId = '12345678-1234-4ABC-9DEF-1234567890AB';
const since = '2026-10-27T05:00:00.000Z', now = Date.parse('2026-10-27T05:05:00.000Z');
const scope = startupScope({ simulatorId, since, now });
const processPath = '/Users/private-operator/Library/Developer/CoreSimulator/Devices/' + simulatorId
  + '/data/Containers/Bundle/Application/ABCDEF01-2345-6789-ABCD-0123456789AB/WeddingPhotobooth.app/WeddingPhotobooth';
function body() {
  return { procName: 'WeddingPhotobooth', bundleInfo: { CFBundleIdentifier: 'com.example.weddingphotobooth' },
    procPath: processPath, captureTime: '2026-10-27 05:04:00.1234 +0000',
    exception: { type: 'EXC_CRASH', signal: 'SIGABRT', rawCodes: ['private-register-state'] },
    termination: { namespace: 'SIGNAL', code: 6, indicator: 'Abort trap: 6' },
    asi: { 'libobjc.A.dylib': ["Terminating app due to uncaught exception NSInvalidArgumentException: Cannot find native module 'ExpoScreenOrientation'"] },
    usedImages: [{ path: '/Users/private-operator/private-project-secret' }], environment: { TOKEN: 'private-credential-value' } };
}
function encoded(value = body(), header = { timestamp: '2026-10-27 05:04:00.1234 +0000', app_name: 'WeddingPhotobooth' }) {
  return JSON.stringify(header) + '\n' + JSON.stringify(value, null, 2);
}
function logRecord(message = 'Fatal uncaught TypeError: Cannot read property secretProperty of undefined') {
  return { timestamp: '2026-10-27 05:04:01.123456+0000', process: 'WeddingPhotobooth', processImagePath: processPath,
    messageType: 'Error', eventMessage: message };
}
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-startup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
function candidate(index = 0) { return { name: 'WeddingPhotobooth-2026-10-27-' + index + '.ips', regular: true, bytes: 1000, mtimeMs: now - index - 1000 }; }

test('fixed pre-import CoreModule facts survive technical projection and take priority over crash summaries', async () => {
  const message = 'Native module bootstrap: KeyboardObserver=missing; AppState=available; WebSocketModule=available; Animated=unknown';
  const projected = reduceStartupLogs(JSON.stringify([logRecord(message),
    { ...logRecord('ordinary private text'), messageType: 'Info' },
    { ...logRecord(message), processImagePath: processPath.replace(simulatorId, 'ABCDEF12-3456-7890-ABCD-1234567890AB') }]), scope);
  assert.equal(projected?.length, 1);
  assert.ok(projected);
  assert.match(projected[0], /KeyboardObserver missing; AppState available; WebSocketModule available; Animated unknown/);
  assert.ok(!projected[0].includes('='));
  const report = await collectIOSStartupDiagnostics({ simulatorId, since, now }, {
    listReports: () => ({status: 'ready', entries: [candidate()]}), readReport: () => encoded(),
    readLogs: async () => ({status: 'collected', messages: projected, quiescent: true}),
  });
  assert.ok(report.publicMessages[0].includes('native module bootstrap:'));
  assert.ok(report.publicMessages.some(value => value.includes('SIGABRT')));
  assert.ok(!JSON.stringify(report).includes('ordinary private text'));
});

test('scope requires a fresh explicit timestamp and canonical simulator UUID without returning caller inputs on failure', async () => {
  assert.equal(scope.simulatorId, simulatorId);
  for (const options of [{ simulatorId: 'booted', since, now }, { simulatorId: simulatorId + '/outside', since, now },
    { simulatorId, since: '2026-10-27 05:00:00', now }, { simulatorId, since: '2026-10-27T05:06:00Z', now },
    { simulatorId, since: '2026-10-26T05:00:00Z', now }, { simulatorId, since: 'private-value', now }]) {
    assert.equal(startupScope(options), null);
    const report = await collectIOSStartupDiagnostics(options, { listReports() { throw new Error('must not read'); } });
    assert.equal(report.status, 'invalid-scope'); assert.ok(!JSON.stringify(report).includes('private-value'));
  }
});

test('real-shaped two-JSON Apple report retains only correlated exception, termination and public technical reasons', () => {
  const result = reduceStartupReport(encoded(), scope);
  assert.deepEqual(result.exception, { type: 'EXC_CRASH', signal: 'SIGABRT' });
  assert.deepEqual(result.termination, { namespace: 'SIGNAL', code: 6 });
  assert.ok(result.reasons.some(value => value.includes('NSInvalidArgumentException') && value.includes('ExpoScreenOrientation')));
  const serialized = JSON.stringify(result);
  for (const sensitive of ['private-operator', simulatorId, processPath, 'private-project-secret', 'private-credential-value', 'rawCodes', 'usedImages']) assert.ok(!serialized.includes(sensitive));
  assert.ok(reduceStartupReport(JSON.stringify(body()), scope));
});

test('unrelated bundle/process/simulator, stale or future capture, traversal and malformed report schemas fail closed', () => {
  for (const change of [
    value => { value.procName = 'OtherApp'; }, value => { value.bundleInfo.CFBundleIdentifier = 'private.other.app'; },
    value => { value.procPath = processPath.replace(simulatorId, 'ABCDEF12-3456-7890-ABCD-1234567890AB'); },
    value => { value.procPath = processPath.replace('WeddingPhotobooth.app', 'OtherApp.app'); },
    value => { value.procPath = processPath.replace('/data/', '/data/../data/'); },
    value => { value.captureTime = '2026-10-27 04:59:59.000 +0000'; },
    value => { value.captureTime = '2026-10-27 05:06:00.000 +0000'; }, value => { value.captureTime = 'not-a-timestamp'; },
  ]) { const value = body(); change(value); assert.equal(reduceStartupReport(encoded(value), scope), null); }
  assert.equal(reduceStartupReport(encoded(body(), { timestamp: '2026-10-27 04:59:00.000 +0000' }), scope), null);
  for (const value of ['{invalid', '{}\n{}\n{}', '[]', 'null', encoded() + '\nprivate-tail', ' '.repeat(STARTUP_LIMITS.reportBytes + 1)]) assert.equal(reduceStartupReport(value, scope), null);
});

test('fatal reason projection preserves known public modules/classes but never arbitrary names, URLs, paths, phones or secrets', () => {
  const raw = 'Fatal NSInvalidArgumentException: ExpoScreenOrientation ExpoGlassEffect ExpoCamera ExpoModulesCore React ReactNative RCTFatal WeddingPhotobooth UIKit '
    + 'privatePerson private-operator@example.test +1 (202) 555-0123 https://private.test/g/abcdef?token=privateToken '
    + '/Users/private-operator/private-file Bearer privateBearerValue SECRET=unquotedPrivateValue 0123456789abcdef0123456789abcdef\n\u001b';
  const safe = sanitizeStartupReason(raw);
  for (const expected of ['NSInvalidArgumentException', 'ExpoScreenOrientation', 'ExpoGlassEffect', 'ExpoCamera', 'ExpoModulesCore', 'ReactNative', 'RCTFatal', 'WeddingPhotobooth', 'UIKit']) assert.ok(safe.includes(expected));
  for (const sensitive of ['privatePerson', 'private-operator', 'example.test', '202', '555', 'https', '/Users', 'privateToken', 'privateBearerValue', 'unquotedPrivateValue', '0123456789abcdef']) assert.ok(!safe.includes(sensitive));
  assert.ok(safe.includes('[redacted]')); assert.ok(safe.length <= 400);
  assert.ok(sanitizeStartupReason('No bundle URL present.').includes('bundle URL'));
  assert.equal(sanitizeStartupReason('ordinary private text'), null);
  assert.equal(sanitizeStartupReason({ message: 'Fatal private value' }), null);
});

test('unknown exception, signal and namespace fields cannot inject arbitrary identifiers; reasons stay bounded', () => {
  const value = body(); value.exception = { type: 'EXC_PRIVATE_IDENTIFIER', signal: 'SIGPRIVATE' };
  value.termination = { namespace: 'PRIVATE_NAMESPACE', code: 'private-code', details: Array(20).fill('Fatal privateValue') };
  value.asi = { 'private-framework': ['Fatal privateFrameworkData'] };
  const result = reduceStartupReport(encoded(value), scope);
  assert.deepEqual(result.exception, {}); assert.deepEqual(result.termination, {});
  assert.ok(result.reasons.length <= 3); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('unified logs retain at most ten fresh app errors/faults/fatal reasons and reject other process paths and levels', () => {
  const records = [logRecord('No bundle URL present.'),
    { ...logRecord(), processImagePath: processPath.replace(simulatorId, 'ABCDEF12-3456-7890-ABCD-1234567890AB') },
    { ...logRecord(), process: 'OtherApp' }, { ...logRecord(), timestamp: '2026-10-27 04:59:00.000+0000' },
    { ...logRecord('native module present'), messageType: 'Info' },
    ...Array.from({ length: 20 }, (_, i) => logRecord('Fatal '.repeat(i + 1) + 'Error: privateValue'))];
  const messages = reduceStartupLogs(JSON.stringify(records), scope);
  assert.equal(messages.length, 10); assert.ok(messages[0].includes('bundle URL'));
  assert.ok(messages.every(value => !value.includes('privateValue')));
  for (const malformed of ['{invalid', '{}', 'null', JSON.stringify(Array(2001).fill({})), ' '.repeat(STARTUP_LIMITS.logBytes + 1)]) assert.equal(reduceStartupLogs(malformed, scope), null);
});

test('collector reads only eligible fresh bounded app candidates and retains two reports with three public messages', async () => {
  const read = [], entries = [
    { ...candidate(), name: 'OtherApp-1.ips' }, { ...candidate(), regular: false }, { ...candidate(), mtimeMs: scope.sinceMs - 1 },
    { ...candidate(), bytes: STARTUP_LIMITS.reportBytes + 1 }, ...Array.from({ length: 15 }, (_, i) => candidate(i + 1)),
  ];
  const report = await collectIOSStartupDiagnostics({ simulatorId, since, now, includeLogs: false }, {
    listReports: () => ({ status: 'ready', entries }), readReport(value) { read.push(value.name); return encoded(); },
  });
  assert.equal(read.length, 2); assert.equal(report.reports.length, 2); assert.equal(report.status, 'collected');
  assert.ok(report.publicMessages[0].includes('SIGNAL code 6'));
  assert.ok(report.publicMessages.length <= 3 && report.publicMessages.every(value => value.length <= 400));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 16 * 1024); assert.ok(!JSON.stringify(report).includes(simulatorId));
  const watchdog = body(); watchdog.termination = { namespace: 'FRONTBOARD', code: '0x8badf00d' };
  const watchdogReport = await collectIOSStartupDiagnostics({ simulatorId, since, now, includeLogs: false }, {
    listReports: () => ({ status: 'ready', entries: [candidate()] }), readReport: () => encoded(watchdog),
  });
  assert.ok(watchdogReport.publicMessages[0].includes('FRONTBOARD code 0x8badf00d'));
});

test('malformed/unrelated candidates stop at the eight-read bound and never become startup evidence', async () => {
  let reads = 0;
  const report = await collectIOSStartupDiagnostics({ simulatorId, since, now, includeLogs: false }, {
    listReports: () => ({ status: 'ready', entries: Array.from({ length: 20 }, (_, i) => candidate(i)) }),
    readReport() { reads++; return '{invalid-private-data'; },
  });
  assert.equal(reads, 8); assert.equal(report.reportScan.rejected, 8); assert.equal(report.status, 'not-found');
  assert.equal(report.reports.length, 0); assert.ok(!JSON.stringify(report).includes('private-data'));
});

test('missing, unavailable, malformed ports and cancellation remain diagnostic-only and do not throw raw errors', async () => {
  for (const status of ['missing', 'unavailable', 'unsafe']) {
    const report = await collectIOSStartupDiagnostics({ simulatorId, since, now, includeLogs: false }, {
      listReports: () => ({ status, entries: [] }),
    });
    assert.equal(report.reports.length, 0); assert.ok(report.publicMessages[0].includes('original test failure'));
  }
  const report = await collectIOSStartupDiagnostics({ simulatorId, since, now }, {
    listReports() { throw new Error('private-path'); }, readLogs() { throw new Error('private-secret'); },
  });
  assert.equal(report.status, 'unavailable'); assert.equal(report.log.quiescent, false);
  assert.ok(!JSON.stringify(report).includes('private-'));
  const signal = AbortSignal.abort();
  const cancelled = await collectIOSStartupDiagnostics({ simulatorId, since, now, signal }, { listReports() { throw new Error('must not read'); } });
  assert.equal(cancelled.status, 'cancelled');
});

test('filesystem port never reads symlink, oversized, stale or unrelated reports and preserves source bytes', async t => {
  const directory = temporary(t), reports = join(directory, 'DiagnosticReports'); mkdirSync(reports);
  const fresh = join(reports, 'WeddingPhotobooth-fresh.ips'), stale = join(reports, 'WeddingPhotobooth-stale.ips');
  const outside = join(directory, 'outside.ips'), oversized = join(reports, 'WeddingPhotobooth-big.ips');
  writeFileSync(fresh, encoded()); writeFileSync(stale, encoded()); writeFileSync(outside, 'private-unrelated-content');
  writeFileSync(join(reports, 'OtherApp-fresh.ips'), 'private-other-application');
  writeFileSync(oversized, Buffer.alloc(STARTUP_LIMITS.reportBytes + 1));
  symlinkSync(outside, join(reports, 'WeddingPhotobooth-link.ips'));
  for (const path of [fresh, oversized]) utimesSync(path, new Date(now - 1000), new Date(now - 1000));
  utimesSync(stale, new Date(scope.sinceMs - 1000), new Date(scope.sinceMs - 1000));
  const port = createStartupDiagnosticsPort({ reportsDirectory: reports });
  const original = port.readReport, reads = [];
  port.readReport = value => { reads.push(value.name); return original(value); };
  const report = await collectIOSStartupDiagnostics({ simulatorId, since, now, includeLogs: false }, port);
  assert.deepEqual(reads, ['WeddingPhotobooth-fresh.ips']); assert.equal(report.reports.length, 1);
  assert.equal(readFileSync(fresh, 'utf8'), encoded()); assert.equal(readFileSync(outside, 'utf8'), 'private-unrelated-content');
});

test('filesystem port rejects a symlinked root and reports replaced after inspection', t => {
  const directory = temporary(t), reports = join(directory, 'reports'); mkdirSync(reports);
  const alias = join(directory, 'alias'); symlinkSync(reports, alias);
  assert.equal(createStartupDiagnosticsPort({ reportsDirectory: alias }).listReports().status, 'unsafe');
  const path = join(reports, 'WeddingPhotobooth-fresh.ips'); writeFileSync(path, encoded());
  const port = createStartupDiagnosticsPort({ reportsDirectory: reports }), [entry] = port.listReports().entries;
  rmSync(path); symlinkSync(join(directory, 'outside.ips'), path);
  assert.throws(() => port.readReport(entry));
  rmSync(path); writeFileSync(path, encoded() + '\nchanged'); assert.throws(() => port.readReport(entry));
});

test('log invocation is fixed to the exact simulator and public app with no shell, raw output or extra processes', async () => {
  const args = startupLogArguments(scope);
  assert.deepEqual(args.slice(0, 10), ['simctl', 'spawn', simulatorId, 'log', 'show', '--style', 'json', '--last', '5m', '--predicate']);
  assert.ok(args[10].includes('process == "WeddingPhotobooth"')); assert.ok(!args[10].includes('runningboard'));
  let options;
  const result = await queryStartupLogs(scope, { spawnImpl(binary, passed, opts) {
    assert.equal(binary, 'xcrun'); assert.deepEqual(passed, args); options = opts;
    return spawn(process.execPath, ['-e', 'process.stderr.write("private-stderr");process.stdout.write(' + JSON.stringify(JSON.stringify([logRecord('Fatal TypeError: ExpoCamera privateValue')])) + ');'], opts);
  } });
  assert.equal(options.detached, false); assert.equal(options.shell, undefined);
  assert.equal(result.status, 'collected'); assert.equal(result.quiescent, true); assert.ok(result.messages[0].includes('ExpoCamera'));
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('a timed-out log helper is terminated and awaited without pretending missing diagnostics passed', { timeout: 5000 }, async () => {
  let child;
  const result = await queryStartupLogs(scope, { timeoutMs: 150, killGraceMs: 50, killWaitMs: 1000,
    spawnImpl(binary, args, opts) { child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);'], opts); return child; } });
  assert.equal(result.status, 'timeout'); assert.equal(result.quiescent, true);
  assert.ok(child.exitCode !== null || child.signalCode !== null); assert.deepEqual(result.messages, []);
});

test('signal cancellation stops and awaits the inherited-group helper; cancelled queries emit no raw output', { timeout: 5000 }, async () => {
  const abort = new AbortController(); let child;
  const result = await queryStartupLogs(scope, { signal: abort.signal, timeoutMs: 1000, killGraceMs: 50, killWaitMs: 1000,
    spawnImpl(binary, args, opts) {
      child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("private-ready");setInterval(()=>{},1000);'], opts);
      child.stdout.once('data', () => abort.abort()); return child;
    } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.quiescent, true);
  assert.ok(child.exitCode !== null || child.signalCode !== null); assert.deepEqual(result.messages, []);
});

test('log byte overflow and spawn failure stay bounded, sanitized and quiescent', async () => {
  const oversized = await queryStartupLogs(scope, { timeoutMs: 1000, killGraceMs: 50, killWaitMs: 1000,
    spawnImpl(binary, args, opts) { return spawn(process.execPath, ['-e', 'process.stdout.write("x".repeat(' + (STARTUP_LIMITS.logBytes + 1) + '));'], opts); } });
  assert.equal(oversized.status, 'oversize'); assert.equal(oversized.quiescent, true);
  const absent = await queryStartupLogs(scope, { spawnImpl(binary, args, opts) { return spawn('/not-a-real-private-executable', [], opts); } });
  assert.equal(absent.status, 'unavailable'); assert.equal(absent.quiescent, true);
  assert.ok(!JSON.stringify(absent).includes('private'));
});

test('CLI on unsupported host exits zero with one sanitized bounded JSON diagnostic and no stderr', t => {
  const directory = temporary(t), preload = join(directory, 'unsupported.mjs');
  writeFileSync(preload, 'Object.defineProperty(process,"platform",{value:"linux"});');
  const result = spawnSync(process.execPath, ['--import', preload, new URL('./collect-ios-startup-diagnostics.mjs', import.meta.url).pathname,
    '--simulator', simulatorId, '--since', since], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 });
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout); assert.equal(report.status, 'unavailable');
  assert.equal(result.stdout.trim().split('\n').length, 1); assert.ok(!result.stdout.includes(simulatorId));
});
