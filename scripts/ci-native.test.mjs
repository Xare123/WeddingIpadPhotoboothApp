import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { commandStreams, MAX_MACHINE_STDOUT, metroErrorCodes, metroHTTPStatus, ownedProcessTree, parseNamedJSON, passingXCTestCounts, resolveExpoEntry, selectIpadSimulator, verifyReleaseApp, waitForMetro } from './ci-native-contract.mjs';
import { annotationText, bounded, diagnosticLines, publicAnnotations, redact, workflowData } from './ci-summary.mjs';

const ipad = { udid: '11111111-1111-4111-8111-111111111111', name: 'iPad Pro 13-inch (M4)',
  isAvailable: true, state: 'Shutdown', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-16GB' };

test('simctl fixture selects an available iPad from the real-shaped iOS runtime inventory', () => {
  const inventory = JSON.parse(JSON.stringify({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [ipad, { ...ipad, name: 'iPhone 16' }],
  } }));
  assert.equal(selectIpadSimulator(inventory.devices).udid, ipad.udid);
  assert.equal(selectIpadSimulator(inventory.devices).runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-18-5');
});

test('simulator selection respects availability, deployment target, platform and numeric runtime order', () => {
  const inventory = {
    'com.apple.CoreSimulator.SimRuntime.iOS-16-3': [{ ...ipad, udid: 'too-old' }],
    'com.apple.CoreSimulator.SimRuntime.macOS-26-0': [{ ...ipad, udid: 'wrong-platform' }],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [ipad],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ ...ipad, udid: 'newest' }, { ...ipad, udid: 'unavailable', isAvailable: false }],
  };
  assert.equal(selectIpadSimulator(inventory).udid, 'newest');
});

test('missing or incompatible simulator inventory fails before native build allocation', () => {
  for (const devices of [undefined, [], {}, { 'com.apple.CoreSimulator.SimRuntime.iOS-16-3': [ipad] },
    { 'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [{ ...ipad, isAvailable: false }] }]) {
    assert.throws(() => selectIpadSimulator(devices));
  }
});

test('actual-shaped singular XCTest completion proves a nonzero passing run', () => {
  assert.deepEqual(passingXCTestCounts("Test Suite 'All tests' passed.\n\t Executed 1 test, with 0 failures (0 unexpected) in 42.123 seconds"),
    { executed: 1, failures: 0, skipped: 0 });
});

test('nested plural XCTest summaries preserve the executed count without double counting', () => {
  const output = 'Executed 1 test, with 0 failures (0 unexpected) in 1 seconds\nExecuted 2 tests, with 0 failures (0 unexpected) in 2 seconds\nExecuted 2 tests, with 0 failures (0 unexpected) in 2 seconds';
  assert.deepEqual(passingXCTestCounts(output), { executed: 2, failures: 0, skipped: 0 });
});

test('zero, skipped, failed or absent XCTest execution cannot pass from a build-success message', () => {
  for (const output of ['** BUILD SUCCEEDED **', 'Executed 0 tests, with 0 failures', 'Executed 1 test, with 1 failure',
    'Executed 1 test, with 1 test skipped and 0 failures',
    'Executed 1 test, with 1 failure\nExecuted 2 tests, with 0 failures']) assert.throws(() => passingXCTestCounts(output));
});

test('public diagnostics redact URL capabilities, credentials and phone numbers and remain bounded', () => {
  const source = `https://photos.example/g/${'a'.repeat(64)} Bearer fixture-secret +12025550123 ?token=fixture-secret`;
  const output = redact(source);
  for (const secret of ['a'.repeat(64), 'fixture-secret', '+12025550123']) assert.ok(!output.includes(secret));
  assert.ok(bounded('line\n'.repeat(500), 3).split('\n').length <= 3);
});

test('workflow annotation data escapes percent, CR and LF without introducing a second command', () => {
  assert.equal(workflowData('50%\r\n::notice::injected'), '50%25%0D%0A::notice::injected');
  assert.equal(workflowData('%0A'), '%250A');
  const [command] = publicAnnotations({
    sha: 'f'.repeat(40), jobStatus: 'failure',
    status: { result: 'failed', stages: [{ name: 'pods', result: 'failed' }], error: '50%\r\n::notice::injected' },
  });
  assert.ok(command.startsWith('::error title=Native simulator diagnostics::'));
  assert.ok(!command.includes('\n') && !command.includes('\r'));
  assert.ok(command.includes('50%25%0D%0A::notice::injected'));
});

test('public annotation text removes URLs, capability tokens, credentials, phone numbers and environment assignments', () => {
  const secret = 'a'.repeat(64);
  const source = 'Error: failed ENV_FLAG="private environment value" OTHER_VAR: another-private-value ' +
    'https://photos.example/g/' + secret + ' Bearer private-bearer token: private-token +1 (202) 555-0123 ' + secret;
  const result = annotationText(source);
  for (const value of [secret, 'https://', 'private environment value', 'another-private-value',
    'private-bearer', 'private-token', '+1 (202) 555-0123']) assert.ok(!result.includes(value), value);
  assert.ok(result.includes('Error: failed'));
});

test('diagnostic selection prefers the failed stage and includes only a few bounded error records', () => {
  const logs = {
    'a-noise.log': 'export PRIVATE_TOKEN=never-publish\nordinary output\nhttps://example.com/not-an-error',
    'pods.log': '[!] CocoaPods could not resolve a fixture dependency\n' +
      'Error: ' + 'x'.repeat(4000) + '\n' +
      'Error: fixture failure TWO_VALUE=do-not-publish\n',
    'xcode-test.log': Array.from({ length: 500 }, (_, index) => 'error: unrelated ' + index).join('\n'),
  };
  const result = diagnosticLines(logs, [{ name: 'pods', result: 'failed' }]);
  assert.equal(result.length, 3);
  assert.ok(result.every(line => line.startsWith('pods.log:')));
  assert.ok(result.every(line => line.length <= 635));
  assert.ok(result.join('\n').includes('fixture dependency'));
  for (const value of ['never-publish', 'do-not-publish', 'https://', 'ordinary output']) assert.ok(!result.join('\n').includes(value));
});

test('failure annotations are emitted only for a failed job or failed native status', () => {
  const logs = { 'pods.log': 'Error: fixture failure' };
  for (const result of ['running', 'cancelled', 'unknown']) {
    assert.deepEqual(publicAnnotations({ jobStatus: result, status: { result }, logs }), []);
  }
  assert.equal(publicAnnotations({ jobStatus: 'failure', logs }).length, 1);
  assert.equal(publicAnnotations({ jobStatus: 'success', status: { result: 'failed' }, logs }).length, 1);
});

test('successful native annotation proves exact SHA and nonzero unskipped passing XCTest execution', () => {
  const sha = 'e'.repeat(40);
  const status = { result: 'passed', tests: { executed: 1, failures: 0, skipped: 0 } };
  const [notice] = publicAnnotations({ sha, jobStatus: 'success', status });
  assert.ok(notice.startsWith('::notice title=Native simulator XCTest evidence::'));
  assert.ok(notice.includes(sha));
  assert.ok(notice.includes('executed XCTest tests: 1; failures: 0; skipped: 0'));
  for (const tests of [{ executed: 0, failures: 0 }, { executed: 1, failures: 1 }, { executed: 1, failures: 0, skipped: 1 }]) {
    assert.deepEqual(publicAnnotations({ sha, jobStatus: 'success', status: { result: 'passed', tests } }), []);
  }
});

test('large simctl inventory survives intact after the diagnostic tail loses its JSON prefix', () => {
  const inventory = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-18-5': Array.from({ length: 300 }, (_, index) => ({
    ...ipad, name: 'iPad fixture ' + index, udid: String(index).padStart(8, '0') + '-1111-4111-8111-111111111111',
  })) } };
  const source = JSON.stringify(inventory, null, 2);
  assert.ok(source.split('\n').length > 1200);
  assert.throws(() => JSON.parse(bounded(source, 1200, 200_000)), 'old log-tail transport must reproduce corruption');
  const capture = commandStreams('simulator-list', { captureStdout: true });
  const bytes = Buffer.from(source);
  for (let start = 0; start < bytes.length; start += 1024) capture.stdout(bytes.subarray(start, start + 1024));
  const result = parseNamedJSON('simulator-list', capture.text());
  assert.deepEqual(result, inventory);
  assert.equal(selectIpadSimulator(result.devices).udid, inventory.devices['com.apple.CoreSimulator.SimRuntime.iOS-18-5'][0].udid);
});

test('real subprocess stderr warnings never contaminate structured stdout JSON', async () => {
  const logs = [];
  const capture = commandStreams('simulator-list', { captureStdout: true, onLog: (chunk, stream) => logs.push({ stream, value: chunk.toString() }) });
  const child = spawn(process.execPath, ['-e',
    'process.stderr.write("normal simulator warning\\n"); process.stdout.write(JSON.stringify({devices:{}})); process.stderr.write("second warning\\n");']);
  child.stdout.on('data', chunk => capture.stdout(chunk));
  child.stderr.on('data', chunk => capture.stderr(chunk));
  const exit = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
  assert.equal(exit, 0);
  assert.deepEqual(parseNamedJSON('simulator-list', capture.text()), { devices: {} });
  assert.ok(logs.some(record => record.stream === 'stderr' && record.value.includes('warning')));
  assert.ok(!capture.text().includes('warning'));
});

test('raw structured stdout preserves UTF-8 and values while persisted diagnostic text is redacted', () => {
  const logs = [];
  const capture = commandStreams('simulator-types', { captureStdout: true, onLog: chunk => logs.push(chunk) });
  const source = JSON.stringify({ name: 'iPad café', note: 'Bearer fixture-secret' });
  for (const byte of Buffer.from(source)) capture.stdout(Buffer.from([byte]));
  assert.equal(capture.text(), source);
  assert.deepEqual(parseNamedJSON('simulator-types', capture.text()), JSON.parse(source));
  assert.ok(!bounded(Buffer.concat(logs).toString()).includes('fixture-secret'));
});

test('structured capture fails closed on its byte cap and cannot return a truncated partial response', () => {
  const capture = commandStreams('simulator-list', { captureStdout: true, stdoutLimit: 8 });
  capture.stdout(Buffer.from('12345678'));
  assert.throws(() => capture.stdout(Buffer.from('9')), /simulator-list: structured stdout exceeded 8 bytes/);
  assert.throws(() => capture.text(), /simulator-list: structured stdout exceeded/);
  const defaults = commandStreams('simulator-list', { captureStdout: true });
  assert.throws(() => defaults.stdout(Buffer.alloc(MAX_MACHINE_STDOUT + 1)), /structured stdout exceeded 4194304 bytes/);
  assert.throws(() => commandStreams('simulator-list', { stdoutLimit: MAX_MACHINE_STDOUT + 1 }), /Invalid structured stdout byte limit/);
});

test('malformed or non-UTF-8 machine data reports a named failure without salvaging or exposing its content', () => {
  for (const [name, source] of [['simulator-list', '{"private":"do-not-publish"} trailing'],
    ['native-test-plan', 'do-not-publish malformed plan'], ['simulator-types', '{"devicetypes":']]) {
    assert.throws(() => parseNamedJSON(name, source), error => error.message.startsWith(name + ': invalid JSON data') && !error.message.includes('do-not-publish'));
  }
  const capture = commandStreams('simulator-list', { captureStdout: true });
  capture.stdout(Buffer.from([0xc3, 0x28]));
  assert.throws(() => capture.text(), /simulator-list: structured stdout is not valid UTF-8/);
});

test('simulator creation consumes only its stdout UUID even when stderr adds progress or warnings', () => {
  const capture = commandStreams('simulator-create', { captureStdout: true });
  capture.stderr(Buffer.from('normal create warning\n'));
  capture.stdout(Buffer.from(ipad.udid + '\n'));
  capture.stderr(Buffer.from('created device\n'));
  assert.equal(capture.text().trim(), ipad.udid);
});

test('normal CocoaPods script-phase warnings never drown a later explicit error', () => {
  const logs = {
    'pods.log': Array.from({ length: 5 }, () => '[!] hermes-engine has added 1 script phase. Please inspect before executing a build.').join('\n') +
      '\n[!] Generic informational note',
    'simulator-list.log': 'Error: simulator-list: invalid JSON data at position 19',
  };
  const selected = diagnosticLines(logs, [{ name: 'simulator-list', result: 'failed' }]);
  assert.ok(selected[0].startsWith('simulator-list.log: Error:'));
  assert.ok(!selected.join('\n').includes('script phase'));
  assert.deepEqual(diagnosticLines({ 'pods.log': '[!] hermes-engine has added 1 script phase. Please inspect before executing a build.' }), []);
});

async function statusFixture(t, host, body = 'packager-status:running', status = 200) {
  const server = createServer((_request, response) => { response.writeHead(status); response.end(body); });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, host, resolveListen); });
  t.after(() => new Promise(resolveClose => { server.closeAllConnections(); server.close(resolveClose); }));
  return server.address().port;
}

test('real IPv4-only Metro status is found even when the IPv6 probe fails', async t => {
  const port = await statusFixture(t, '127.0.0.1');
  const result = await waitForMetro({ origins: ['http://[::1]:' + port, 'http://127.0.0.1:' + port], timeoutMs: 1000 });
  assert.equal(result.family, 'ipv4');
  assert.ok(result.observations.some(item => item.family === 'ipv6' && item.result === 'fetch-error'));
});

test('real IPv6-only Metro status is found even when the IPv4 probe fails', async t => {
  const port = await statusFixture(t, '::1');
  const result = await waitForMetro({ origins: ['http://127.0.0.1:' + port, 'http://[::1]:' + port], timeoutMs: 1000 });
  assert.equal(result.family, 'ipv6');
  assert.ok(result.observations.some(item => item.family === 'ipv4' && item.result === 'fetch-error'));
});

test('HTTP success with a non-Metro body fails on the same bounded deadline without leaking response data', async t => {
  const port = await statusFixture(t, '127.0.0.1', 'private response ENV_FLAG=private-value https://fixture.example/private');
  const started = performance.now();
  await assert.rejects(waitForMetro({ origins: ['http://127.0.0.1:' + port], timeoutMs: 150, requestTimeoutMs: 50, pollIntervalMs: 20 }),
    error => error.message.includes('HTTP 200 unexpected-status-body') && error.metro.observations.length === 1 &&
      !error.message.includes('private-value') && !error.message.includes('https://'));
  assert.ok(performance.now() - started < 1500);
});

test('Metro premature exit, signal or spawn failure is reported before waiting for HTTP readiness', async () => {
  for (const state of [{ exitCode: 7 }, { signal: 'SIGTERM' }, { spawnError: 'ENOENT' }]) {
    let fetches = 0;
    await assert.rejects(waitForMetro({ childState: () => state, requestImpl: () => { fetches++; throw new Error('must not request'); } }),
      error => error.message.includes('Expo CLI exited or could not spawn') &&
        (state.exitCode ? error.message.includes('exit 7') : state.signal ? error.message.includes('SIGTERM') : error.message.includes('ENOENT')));
    assert.equal(fetches, 0);
  }
});

test('safe Metro fetch diagnostics expose nested cause codes without raw messages or environment values', () => {
  const error = { message: 'private ENV_FLAG=value https://private.example', cause: {
    errors: [{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }, { code: 'ENV_FLAG=private-value' }],
  } };
  assert.equal(metroErrorCodes(error), 'ECONNREFUSED,ENETUNREACH');
  assert.equal(metroErrorCodes({ name: 'TimeoutError' }), 'TimeoutError');
  assert.equal(metroErrorCodes({ message: 'do not publish' }), 'FETCH_ERROR');
});

test('failed Metro readiness surfaces its meaningful redacted output instead of unrelated CocoaPods notices', () => {
  const logs = {
    'metro-ready.log': 'Error: metro-ready: readiness deadline reached; exit running; ipv4: ECONNREFUSED',
    'metro.log': 'Starting Metro Bundler\n ERROR  Fixture Metro startup failed\nWaiting on http://localhost:8081\n',
    'pods.log': '[!] Please close any current Xcode sessions and use the generated workspace from now on.\n[!] Generic unrelated note',
  };
  const selected = diagnosticLines(logs, [{ name: 'metro-ready', result: 'failed' }]);
  assert.ok(selected.some(line => line.includes('ECONNREFUSED')));
  assert.ok(selected.some(line => line.includes('Fixture Metro startup failed')));
  assert.ok(!selected.join('\n').includes('pods.log'));
  assert.ok(!selected.join('\n').includes('http://'));
});

test('Metro readiness rejects non-loopback probes before any network request', async () => {
  let fetches = 0;
  await assert.rejects(waitForMetro({ origins: ['https://production.example'], requestImpl: () => { fetches++; } }), /only HTTP loopback/);
  assert.equal(fetches, 0);
});

test('a real failed TAP contract retains its pipeline exit and public failure records without native status', t => {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-contract-failure-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'fixture.test.mjs'), log = join(directory, 'ci-contracts.log');
  writeFileSync(source, "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('synthetic contract failure',()=>assert.equal(1,2,'fixture-public-failure ENV_FLAG=never-publish'));\n");
  const fixtureEnv = { ...process.env };
  delete fixtureEnv.NODE_TEST_CONTEXT; // Run an independent CLI fixture, not a recursive test-runner child.
  const result = spawnSync('bash', ['-o', 'pipefail', '-c',
    'node --test --test-reporter=tap "$1" 2>&1 | tee "$2"', 'contract-fixture', source, log], { encoding: 'utf8', env: fixtureEnv });
  assert.equal(result.status, 1, 'tee must not hide the failed Node test');
  const [annotation] = publicAnnotations({ jobStatus: 'failure', failedStep: 'ci-contracts',
    logs: { 'ci-contracts.log': readFileSync(log, 'utf8') } });
  assert.ok(annotation.includes('Failed stage: ci-contracts: failed'));
  assert.ok(annotation.includes('not ok 1'));
  assert.ok(annotation.includes('testCodeFailure'));
  assert.ok(annotation.includes('fixture-public-failure'));
  assert.ok(!annotation.includes('never-publish'));
  assert.ok(!annotation.includes('\n'));
});

test('native module-load errors remain visible when no runner status file was created', () => {
  const [annotation] = publicAnnotations({ jobStatus: 'failure', failedStep: 'native-invocation', logs: {
    'native-invocation.log': 'file:///private/native.mjs:1\nSyntaxError: fixture module failed to load ENV_FLAG=never-publish\n',
  } });
  assert.ok(annotation.includes('Failed stage: native-invocation: failed'));
  assert.ok(annotation.includes('SyntaxError: fixture module failed to load'));
  assert.ok(!annotation.includes('file://'));
  assert.ok(!annotation.includes('never-publish'));
});

test('workflow failure fallback accepts only known step names and retains a more precise native stage', () => {
  const [fallback] = publicAnnotations({ jobStatus: 'failure', failedStep: 'npm-ci' });
  assert.ok(fallback.includes('Failed stage: npm-ci: failed'));
  const [untrusted] = publicAnnotations({ jobStatus: 'failure', failedStep: 'ENV_FLAG=never-publish\n::error::bad' });
  assert.ok(!untrusted.includes('never-publish'));
  const [precise] = publicAnnotations({ jobStatus: 'failure', failedStep: 'native-invocation',
    status: { result: 'failed', stages: [{ name: 'metro-ready', result: 'failed' }] } });
  assert.ok(precise.includes('Failed stage: metro-ready: failed'));
});

test('default Metro transport never invokes global fetch or Undici', async t => {
  const port = await statusFixture(t, '127.0.0.1');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Undici must not run'); };
  try {
    const ready = await waitForMetro({ origins: ['http://127.0.0.1:' + port], timeoutMs: 1000 });
    assert.equal(ready.family, 'ipv4');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('Node HTTP Metro probe rejects non-2xx status even when its body contains the ready marker', async t => {
  const port = await statusFixture(t, '127.0.0.1', 'packager-status:running', 503);
  const result = await metroHTTPStatus('http://127.0.0.1:' + port);
  assert.equal(result.status, 503);
  assert.equal(result.result, 'http-error');
});

test('Node HTTP Metro response capture stops at 256 bytes and cannot accept a marker beyond the cap', async t => {
  const port = await statusFixture(t, '127.0.0.1', 'x'.repeat(256) + 'packager-status:running' + 'x'.repeat(1_000_000));
  const result = await metroHTTPStatus('http://127.0.0.1:' + port);
  assert.equal(result.bytesRead, 256);
  assert.equal(result.result, 'unexpected-status-body');
});

test('Node HTTP Metro timeout rejects with a safe code and closes its active socket', { timeout: 2000 }, async t => {
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const server = createServer(() => { /* Deliberately never reply. */ });
  server.once('connection', socket => socket.once('close', resolveClosed));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await assert.rejects(metroHTTPStatus('http://127.0.0.1:' + server.address().port, { timeoutMs: 40 }), error => error.code === 'ETIMEDOUT');
  await closed;
});

test('Node HTTP Metro connection failures retain their safe network code', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(metroHTTPStatus('http://127.0.0.1:' + port), error => error.code === 'ECONNREFUSED');
});

function expoFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wedding-expo-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'node_modules/expo');
  mkdirSync(join(directory, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '58.0.19' } }));
  writeFileSync(join(directory, 'bin/cli'), "#!/usr/bin/env node\nrequire('@expo/cli');\n");
  const metadata = { name: 'expo', version: '58.0.19', bin: { expo: 'bin/cli' } };
  const save = value => writeFileSync(join(directory, 'package.json'), JSON.stringify(value));
  save(metadata);
  return { root, directory, metadata, save };
}

test('direct Expo entry resolves the workspace-installed versioned package bin without dependencies', t => {
  const fixture = expoFixture(t);
  const expected = { cli: realpathSync(join(fixture.directory, 'bin/cli')), version: '58.0.19' };
  assert.deepEqual(resolveExpoEntry(fixture.root), expected);
  // macOS temporary directories can be reached through /var and /private/var.
  // Exercise an actual alias on every host while requiring the canonical CLI.
  const aliases = mkdtempSync(join(tmpdir(), 'wedding-expo-alias-'));
  t.after(() => rmSync(aliases, { recursive: true, force: true }));
  const alias = join(aliases, 'workspace');
  symlinkSync(fixture.root, alias, 'dir');
  assert.notEqual(join(alias, 'node_modules/expo/bin/cli'), expected.cli);
  assert.deepEqual(resolveExpoEntry(alias), expected);
  fixture.save({ ...fixture.metadata, bin: 'bin/cli' });
  assert.deepEqual(resolveExpoEntry(fixture.root), expected);
  assert.deepEqual(resolveExpoEntry(alias), expected);
});

test('direct Expo entry rejects version mismatches, missing files, directories and package escapes', t => {
  const fixture = expoFixture(t);
  fixture.save({ ...fixture.metadata, version: '59.0.0' });
  assert.throws(() => resolveExpoEntry(fixture.root), /differs from the pinned/);
  writeFileSync(join(fixture.root, 'outside.js'), 'not an Expo CLI');
  for (const bin of ['../../outside.js', 'bin', 'bin/missing']) {
    fixture.save({ ...fixture.metadata, bin: { expo: bin } });
    assert.throws(() => resolveExpoEntry(fixture.root));
  }
  fixture.save({ ...fixture.metadata, bin: { expo: join(fixture.root, 'outside.js') } });
  assert.throws(() => resolveExpoEntry(fixture.root), /CLI bin is invalid/);
});

test('process diagnostics publish only the owned PID tree and sanitized executable basenames', () => {
  const calls = [];
  const run = (program, args, options) => {
    calls.push({ program, args, options });
    const pid = Number(args.at(-1));
    if (program === 'pgrep') return { stdout: pid === 100 ? '101\n202\n' : pid === 101 ? '102\n' : '' };
    const rows = {
      100: '100 1 100 S /opt/node SECRET_ARG=never-publish',
      101: '101 100 100 S /usr/bin/dotslash',
      102: '102 101 100 R /opt/node ENV_FLAG=never-publish',
      202: '202 999 202 S UNRELATED-PROCESS',
    };
    return { stdout: rows[pid] ?? '' };
  };
  const result = ownedProcessTree(100, { run });
  assert.deepEqual(result.processes.map(row => row.pid), [100, 101, 102]);
  assert.deepEqual(result.processes.map(row => row.executable), ['node', 'dotslash', 'node']);
  for (const value of ['SECRET_ARG', 'ENV_FLAG', 'never-publish', 'UNRELATED']) assert.ok(!JSON.stringify(result).includes(value));
  for (const call of calls) {
    assert.equal(call.options.timeout, 250);
    if (call.program === 'ps') assert.deepEqual(call.args.slice(0, 3), ['-o', 'pid=,ppid=,pgid=,stat=,comm=', '-p']);
    else assert.equal(call.args[0], '-P');
  }
});

test('process diagnostics enforce their own-PID and process-count bounds without unrelated dumps', () => {
  let calls = 0;
  const run = (program, args) => {
    calls++; const pid = Number(args.at(-1));
    return { stdout: program === 'ps' ? pid + ' ' + (pid - 1) + ' 100 S node' : String(pid + 1) };
  };
  assert.deepEqual(ownedProcessTree(-1, { run }).processes, []);
  assert.equal(calls, 0);
  const result = ownedProcessTree(100, { run, maxProcesses: 2 });
  assert.equal(result.processes.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(calls <= 4);
});

function releaseFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-release-app-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'WeddingPhotobooth'), 'synthetic executable fixture');
  writeFileSync(join(directory, 'main.jsbundle'), 'abc');
  const info = { CFBundleIdentifier: 'com.example.weddingphotobooth', CFBundleExecutable: 'WeddingPhotobooth',
    UIDeviceFamily: [1, 2], CFBundleSupportedPlatforms: ['iPhoneOS'] };
  return { directory, info };
}

test('Release evidence requires real nonempty app files and hashes the embedded bundle', t => {
  const { directory, info } = releaseFixture(t);
  const result = verifyReleaseApp(directory, info, 'com.example.weddingphotobooth');
  assert.equal(result.sdk, 'iphoneos');
  assert.equal(result.configuration, 'Release');
  assert.equal(result.fixture, 'disabled');
  assert.equal(result.bundleBytes, 3);
  assert.ok(result.executableBytes > 0);
  assert.equal(result.bundleSha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('Release evidence rejects a simulator/wrong app, missing iPad support and empty embedded artifacts', t => {
  const { directory, info } = releaseFixture(t);
  for (const wrong of [{ ...info, CFBundleIdentifier: 'com.wrong.app' }, { ...info, UIDeviceFamily: [1] },
    { ...info, CFBundleSupportedPlatforms: ['iPhoneSimulator'] }, { ...info, CFBundleExecutable: '../outside' }]) {
    assert.throws(() => verifyReleaseApp(directory, wrong, 'com.example.weddingphotobooth'));
  }
  writeFileSync(join(directory, 'main.jsbundle'), '');
  assert.throws(() => verifyReleaseApp(directory, info, 'com.example.weddingphotobooth'));
  writeFileSync(join(directory, 'main.jsbundle'), 'abc');
  writeFileSync(join(directory, 'WeddingPhotobooth'), '');
  assert.throws(() => verifyReleaseApp(directory, info, 'com.example.weddingphotobooth'));
});

test('Release success is labeled as unsigned compilation and embedded JavaScript, never XCTest execution', t => {
  const { directory, info } = releaseFixture(t);
  const releaseEvidence = verifyReleaseApp(directory, info, 'com.example.weddingphotobooth');
  const status = { mode: 'release-build', result: 'passed', nativeBuild: 'passed', releaseEvidence };
  const [notice] = publicAnnotations({ status, jobStatus: 'success', sha: 'c'.repeat(40) });
  assert.ok(notice.startsWith('::notice title=Unsigned Release iOS build evidence::'));
  assert.ok(notice.includes('embedded JavaScript'));
  assert.ok(notice.includes('No XCTest executed'));
  assert.ok(notice.includes('no signing, installation or device testing'));
  for (const invalid of [{ ...status, nativeBuild: 'unrun' },
    { ...status, releaseEvidence: { ...releaseEvidence, fixture: 'enabled' } },
    { ...status, releaseEvidence: { ...releaseEvidence, sdk: 'iphonesimulator' } },
    { ...status, releaseEvidence: undefined, tests: { executed: 1, failures: 0, skipped: 0 } }]) {
    assert.deepEqual(publicAnnotations({ status: invalid, jobStatus: 'success' }), []);
  }
});
