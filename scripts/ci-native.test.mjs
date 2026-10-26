import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { commandStreams, MAX_MACHINE_STDOUT, parseNamedJSON, passingXCTestCounts, selectIpadSimulator } from './ci-native-contract.mjs';
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
