import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { NATIVE_RUNTIME_LIMITS, simulatorBuildArchitecture, simulatorArchitectureSettings, ownedProcessGroupState, stopOwnedProcessGroup, runtimeOutputRemovalAllowed, runtimeResultInspectionAllowed, nativeModeSettings, requireNativeTestPlan, nativeRuntimeResources, nativeRuntimeSources, verifyNativeRuntimeSources, passingExpectedXCTestCounts, commandStreams, MAX_MACHINE_STDOUT, metroErrorCodes, metroHTTPStatus, ownedProcessTree, parseNamedJSON, passingXCTestCounts, requireSwiftTools62, resolveExpoEntry, selectIpadSimulator, verifyReleaseApp, waitForMetro } from './ci-native-contract.mjs';
import { annotationText, bounded, diagnosticLines, publicAnnotations, redact, releaseRuntimeGeometry, startupEvidenceMessages, workflowData } from './ci-summary.mjs';

const ipad = { udid: '11111111-1111-4111-8111-111111111111', name: 'iPad Pro 13-inch (M4)',
  isAvailable: true, state: 'Shutdown', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-16GB' };

test('Release UI failure reports bounded geometry without changing its orientation/readiness assertions', () => {
  const source = readFileSync(new URL('../apps/ipad/native-tests/WeddingPhotoboothReleaseSmokeTests.swift', import.meta.url), 'utf8');
  assert.equal((source.match(/func test\w+\(/g) ?? []).length, 1);
  assert.match(source, /frame\.height > frame\.width : frame\.width > frame\.height/);
  assert.match(source, /XCTWaiter\.wait\(for: \[rotated\], timeout: 15\)/);
  assert.match(source, /identity\.waitForExistence\(timeout: 40\)/);
  assert.match(source, /XCTAssertEqual\(result, \.completed, "App must adopt the requested orientation\. \\\(diagnostic\)"\)/);
  const helper = source.slice(source.indexOf('private func geometryDiagnostic'), source.indexOf('private func assertAttract'));
  const keys = [...helper.matchAll(/"([A-Za-z]+)":/g)].map(match => match[1]);
  assert.deepEqual(keys.sort(), ['stage', 'requestedOrientation', 'deviceOrientation', 'appState', 'appExists', 'applicationFrame', 'windowFrames', 'identityExists', 'startExists', 'startHittable', 'systemAlertCount'].sort());
  assert.match(helper, /prefix\(4\)/);
  assert.match(helper, /number\.isFinite/);
  for (const unsafe of ['debugDescription', 'launchEnvironment', 'ProcessInfo', '.label']) assert.equal(helper.includes(unsafe), false);
  const assertion = source.indexOf('XCTAssertEqual(result, .completed');
  assert.ok(source.indexOf('geometryDiagnostic(result') < assertion);
  assert.ok(source.indexOf('XCUIScreen.main.screenshot()') < assertion);
  assert.match(source, /assertAttract\(\.portrait\)[\s\S]*assertAttract\(\.landscapeLeft\)[\s\S]*app\.terminate\(\)[\s\S]*app\.launch\(\)[\s\S]*assertAttract\(\.landscapeLeft\)[\s\S]*assertAttract\(\.portrait\)/);
});

test('public Release diagnostics preserve stopped-app and actual-window facts without path truncation', () => {
  const fact = { stage: 'orientation-unconfirmed', requestedOrientation: 1, deviceOrientation: 1,
    appState: 1, appExists: false, applicationFrame: {}, windowFrames: [], identityExists: false,
    startExists: false, startHittable: false, systemAlertCount: 0 };
  const marker = value => 'PHOTOBOOTH_RELEASE_DIAGNOSTIC ' + JSON.stringify(value);
  const log = value => ({'xcode-test.log': marker(value)});
  const [stopped] = releaseRuntimeGeometry(log(fact));
  assert.match(stopped, /app notRunning; exists false/);
  assert.match(stopped, /app frame\(x,y,w,h\) unavailable; windows none/);
  const ready = {...fact, appState: 4, appExists: true, identityExists: true, startExists: true, startHittable: true,
    applicationFrame: {x: 0, y: 0, width: 1366, height: 1024}, windowFrames: [{x: 0, y: 0, width: 1024, height: 1366}]};
  assert.match(releaseRuntimeGeometry(log(ready))[0], /1366,1024; windows 0,0,1024,1366/);
  const annotations = publicAnnotations({jobStatus: 'failure', nativeMode: 'release-runtime', logs: log(fact)});
  assert.equal(annotations.length, 2);
  assert.ok(annotations[1].includes('app notRunning; exists false'));
  assert.equal(publicAnnotations({jobStatus: 'failure', nativeMode: 'release-build', logs: log(fact)}).length, 1);
  for (const wrong of [{...fact, extra: 'never-publish'}, {...fact, appState: 'never-publish'},
    {...ready, windowFrames: Array(5).fill(ready.applicationFrame)}, {...ready, applicationFrame: {private: 'never-publish'}},
    {...fact, startExists: 'never-publish'}, {...fact, systemAlertCount: -1}, {...fact, stage: 'never-publish'},
    {...ready, applicationFrame: {...ready.applicationFrame, width: -1}}]) assert.deepEqual(releaseRuntimeGeometry(log(wrong)), []);
  assert.deepEqual(releaseRuntimeGeometry({'untrusted.log': marker(fact)}), []);
  assert.deepEqual(releaseRuntimeGeometry({'xcode-test.log': 'PHOTOBOOTH_RELEASE_DIAGNOSTIC {invalid'}), []);
  assert.equal(releaseRuntimeGeometry({'xcode-test.log': Array(20).fill(marker(fact)).join('\n')}).length, 1);
});

test('public startup evidence requires disposable scope and bounds/redacts every published message', () => {
  const report = {schemaVersion: 1, scope: {freshSimulatorOnly: true}, publicMessages: ['App termination SIGABRT; native module ExpoScreenOrientation.']};
  assert.deepEqual(startupEvidenceMessages(report), report.publicMessages);
  const annotations = publicAnnotations({jobStatus: 'failure', nativeMode: 'release-runtime', startupEvidence: report});
  assert.equal(annotations.length, 2);
  assert.ok(annotations[1].includes('Release simulator termination evidence'));
  const passed = publicAnnotations({jobStatus: 'success', startupEvidence: report,
    status: {mode: 'release-runtime', result: 'passed', fixture: 'disabled', expectedTestCount: 20,
      tests: {executed: 20, failures: 0, skipped: 0}}});
  assert.equal(passed.length, 2);
  assert.ok(passed[1].includes('Release simulator bootstrap evidence'));
  const dirty = {...report, publicMessages: ['Read https://private.invalid/g/' + 'a'.repeat(64) + ' +12025550123 /private/guest/photo.jpg']};
  const message = startupEvidenceMessages(dirty)[0];
  for (const value of ['private.invalid', 'a'.repeat(64), '+12025550123', '/private/guest/photo.jpg']) assert.ok(!message.includes(value));
  for (const wrong of [undefined, {}, {...report, schemaVersion: 2}, {...report, scope: {freshSimulatorOnly: false}},
    {...report, publicMessages: Array(4).fill('value')}, {...report, publicMessages: [{}]},
    {...report, publicMessages: ['x'.repeat(401)]}, {...report, publicMessages: ['line\n::error::never-publish']}]) {
    assert.deepEqual(startupEvidenceMessages(wrong), []);
  }
  assert.equal(publicAnnotations({jobStatus: 'failure', nativeMode: 'release-build', startupEvidence: report}).length, 1);
});

test('startup evidence is bounded to the owned fresh simulator after XCTest and never changes its outcome', () => {
  const runner = readFileSync(new URL('./ci-native.mjs', import.meta.url), 'utf8');
  const section = runner.slice(runner.indexOf('async function captureStartupDiagnostics()'), runner.indexOf('async function cleanup()'));
  assert.match(section, /mode !== 'release-runtime' \|\| !createdHere \|\| !simulator \|\| cancellation/);
  assert.match(section, /stage\.name === 'xcode-test' && \['passed', 'failed'\]\.includes\(stage\.result\)/);
  assert.match(section, /'--simulator', simulator\.udid, '--since', invocationStartedAt/);
  assert.match(section, /timeout: 25_000, allowFailure: true, structured: 'json', stdoutLimit: 20_000/);
  assert.ok(!section.includes("status.result = 'passed'"));
  assert.ok(!section.includes('process.exitCode ='));
  assert.ok(section.includes('runtime-startup-diagnostics.json'));
  assert.ok(!section.includes('process.env.HOME ='));
  assert.match(runner, /finally \{[\s\S]*await captureStartupDiagnostics\(\);\s+try \{ await cleanup\(\);/);
  assert.ok(NATIVE_RUNTIME_LIMITS.preparationMs + NATIVE_RUNTIME_LIMITS.xcodeMs + 30_000 +
    NATIVE_RUNTIME_LIMITS.cleanupMs + NATIVE_RUNTIME_LIMITS.processStopMs < NATIVE_RUNTIME_LIMITS.nativeStepMinutes * 60_000);
});

test('Swift tools gate rejects the observed Xcode16.4 compiler and absent compiler evidence before Pods', () => {
  assert.throws(() => requireSwiftTools62('Apple Swift version 6.1.0 (swiftlang-6.1.0)\nTarget: arm64-apple-macosx15.0'), /requires Swift tools 6\.2/);
  assert.throws(() => requireSwiftTools62('Apple Swift version 6.1.2\nTarget: Swift tools 6.2.0'), /selected compiler is 6\.1\.2/);
  assert.throws(() => requireSwiftTools62('swift-driver version: 1.127.14.1\nXcode 26.3'), /did not report a Swift compiler/);
});

test('Swift tools gate reads the Apple compiler rather than the driver and compares versions numerically', () => {
  assert.equal(requireSwiftTools62('swift-driver version: 1.127.14.1\nApple Swift version 6.2.3 (swiftlang-6.2.3)\nTarget: arm64-apple-macosx15.0'), '6.2.3');
  assert.equal(requireSwiftTools62('Apple Swift version 6.2'), '6.2.0');
  assert.equal(requireSwiftTools62('Apple Swift version 6.10.1'), '6.10.1');
  assert.equal(requireSwiftTools62('Swift version 7.0.0'), '7.0.0');
});

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


test('Release simulator runtime forces fixture off and never starts a Metro server; legacy modes remain distinct', () => {
  const runtime = nativeModeSettings('release-runtime');
  assert.equal(runtime.configuration, 'Release');
  assert.equal(runtime.fixtureFlag, '0');
  assert.equal(runtime.fixture, 'disabled');
  assert.equal(runtime.requiresMetro, false);
  assert.equal(nativeModeSettings('release-build').fixtureFlag, '0');
  assert.equal(nativeModeSettings('release-build').requiresMetro, false);
  assert.equal(nativeModeSettings('ui-tests').fixtureFlag, '1');
  assert.equal(nativeModeSettings('ui-tests').requiresMetro, true);
  assert.throws(() => nativeModeSettings('release-fixture'));
});

test('Release runtime rejects Debug, fixture and Metro-contaminated generated plans', () => {
  const valid = { scheme: 'WeddingPhotoboothReleaseRuntime', configuration: 'Release', fixture: 'disabled', metroPort: null };
  assert.equal(requireNativeTestPlan(valid, 'release-runtime'), valid);
  for (const wrong of [{ ...valid, configuration: 'Debug' }, { ...valid, fixture: 'synthetic-camera-real-native-storage' },
    { ...valid, metroPort: 8081 }, { ...valid, scheme: 'WeddingPhotoboothNativeTests' }]) {
    assert.throws(() => requireNativeTestPlan(wrong, 'release-runtime'));
  }
});

test('Release runtime notice requires executed passing XCTest and never claims camera/storage or Metro coverage', () => {
  const status = { mode: 'release-runtime', result: 'passed', fixture: 'disabled', expectedTestCount: 15, tests: { executed: 15, failures: 0, skipped: 0 } };
  const [notice] = publicAnnotations({ status, jobStatus: 'success' });
  assert.ok(notice.includes('Release simulator runtime evidence'));
  assert.ok(notice.includes('embedded JavaScript without Metro'));
  assert.ok(notice.includes('Core Image effects/template pixel tests'));
  assert.ok(notice.includes('Camera, saving, Photos, signing and physical devices untested'));
  assert.ok(!notice.includes('Synthetic camera') && !notice.includes('Debug JavaScript'));
  for (const invalid of [{ ...status, fixture: 'enabled' }, { ...status, tests: { executed: 0, failures: 0 } },
    { ...status, tests: { executed: 1, failures: 0, skipped: 1 } }, { ...status, tests: undefined }]) {
    assert.deepEqual(publicAnnotations({ status: invalid, jobStatus: 'success' }), []);
  }
});


function runtimeSourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wedding-runtime-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const specs = [
    ['apps/ipad/native-tests/WeddingPhotoboothReleaseSmokeTests.swift', 1],
    ['apps/ipad/modules/wedding-photo-effects/ios/PhotoEffectsEngine.swift', 0],
    ['apps/ipad/modules/wedding-photo-effects/tests/PhotoEffectsEngineTests.swift', 8],
    ['apps/ipad/modules/wedding-photo-effects/ios/PhotoTemplateEngine.swift', 0],
    ['apps/ipad/modules/wedding-photo-effects/tests/PhotoTemplateEngineTests.swift', 11],
  ];
  for (const [source, count] of specs) {
    mkdirSync(join(root, source, '..'), { recursive: true });
    writeFileSync(join(root, source), 'import Foundation\n' + Array.from({ length: count }, (_, i) => '  func testCase' + i + '() throws {}').join('\n'));
  }
  for (const name of ['portrait-1', 'portrait-2', 'portrait-3', 'portrait-4', 'landscape-1', 'landscape-2']) {
    const file = join(root, 'apps/ipad/native-tests/fixtures/studio/studio-' + name + '.jpg');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
  }
  const runtimeResources = nativeRuntimeResources(root);
  for (const resource of runtimeResources) {
    const target = join(root, 'apps/ipad/ios', resource.generatedSource);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, readFileSync(join(root, resource.source)));
  }
  const runtimeSources = nativeRuntimeSources(root);
  for (const source of runtimeSources) {
    const target = join(root, 'apps/ipad/ios', source.generatedSource);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, readFileSync(join(root, source.source)));
  }
  return { root, plan: { runtimeSources, runtimeResources, expectedTestCount: 20 } };
}

test('native source manifest hashes exact required production/test bytes and counts all methods', t => {
  const { root, plan } = runtimeSourceFixture(t);
  const result = verifyNativeRuntimeSources(plan, root);
  assert.equal(result.expectedTestCount, 20);
  assert.equal(result.runtimeSources.length, 5);
  assert.equal(result.runtimeResources.length, 6);
  assert.equal(result.runtimeSources[4].testMethods.length, 11);
  assert.equal(result.runtimeSources[2].testMethods.length, 8);
  for (const source of result.runtimeSources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
});

test('native source manifest rejects source drift, copy drift, missing template suites and false expected totals', t => {
  for (const mutate of [
    ({ root, plan }) => writeFileSync(join(root, plan.runtimeSources[1].source), '// changed production engine'),
    ({ root, plan }) => writeFileSync(join(root, plan.runtimeResources[0].source), 'corrupt JPEG'),
    ({ root, plan }) => writeFileSync(join(root, 'apps/ipad/ios', plan.runtimeResources[0].generatedSource), 'changed copied JPEG'),
    ({ plan }) => { plan.runtimeResources[0].sha256 = '0'.repeat(64); },
    ({ plan }) => { plan.runtimeResources = []; },
    ({ root, plan }) => writeFileSync(join(root, 'apps/ipad/ios', plan.runtimeSources[1].generatedSource), '// changed generated engine'),
    ({ root, plan }) => rmSync(join(root, plan.runtimeSources[4].source)),
    ({ plan }) => { plan.expectedTestCount = 9; },
    ({ plan }) => { plan.runtimeSources[1].sha256 = '0'.repeat(64); },
    ({ root, plan }) => writeFileSync(join(root, plan.runtimeSources[2].source), 'func testOnlyOne() {}'),
    ({ root, plan }) => writeFileSync(join(root, plan.runtimeSources[1].source), 'import ExpoModulesCore'),
  ]) {
    const fixture = runtimeSourceFixture(t);
    mutate(fixture);
    assert.throws(() => verifyNativeRuntimeSources(fixture.plan, fixture.root));
  }
});

test('native runtime refuses incomplete execution, missing totals, any skipped tests and any failures', () => {
  assert.equal(passingExpectedXCTestCounts('Executed 15 tests, with 0 failures', 15).executed, 15);
  for (const output of ['Executed 9 tests, with 0 failures', 'Executed 15 tests, with 1 test skipped and 0 failures',
    'Executed 15 tests, with 1 failure', '** BUILD SUCCEEDED **']) {
    assert.throws(() => passingExpectedXCTestCounts(output, 15));
  }
  for (const expected of [0, undefined, NaN, 1.5]) assert.throws(() => passingExpectedXCTestCounts('Executed 15 tests, with 0 failures', expected));
});


test('clean native JPEG resources have bounded bytes and exact copied hash manifests', t => {
  const { root, plan } = runtimeSourceFixture(t);
  const resources = nativeRuntimeResources(root);
  assert.equal(resources.length, 6);
  assert.ok(resources.every(item => /^[a-f0-9]{64}$/.test(item.sha256) && item.bytes > 0));
  const first = join(root, resources[0].source);
  writeFileSync(first, Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => nativeRuntimeResources(root), /unbounded clean JPEG/);
  assert.throws(() => verifyNativeRuntimeSources(plan, root));
});

test('Release simulator builds exactly the verified host architecture without altering device or Debug settings', () => {
  assert.equal(simulatorBuildArchitecture('x64', 'x86_64\n'), 'x86_64');
  assert.equal(simulatorBuildArchitecture('arm64', 'arm64\n'), 'arm64');
  for (const [node, host] of [['x64', 'arm64'], ['arm64', 'x86_64'], ['ia32', 'i386'], ['x64', 'x86_64 EXTRA']]) {
    assert.throws(() => simulatorBuildArchitecture(node, host), /matching supported/);
  }
  assert.deepEqual(simulatorArchitectureSettings('release-runtime', 'x86_64'), ['ONLY_ACTIVE_ARCH=YES', 'ARCHS=x86_64']);
  assert.deepEqual(simulatorArchitectureSettings('release-runtime', 'arm64'), ['ONLY_ACTIVE_ARCH=YES', 'ARCHS=arm64']);
  assert.throws(() => simulatorArchitectureSettings('release-runtime', 'both'));
  assert.deepEqual(simulatorArchitectureSettings('release-build', 'x86_64'), []);
  assert.deepEqual(simulatorArchitectureSettings('ui-tests', 'arm64'), []);
  const runner = readFileSync(new URL('./ci-native.mjs', import.meta.url), 'utf8');
  const device = runner.split("if (mode === 'release-build') {")[1].split('const app =')[0];
  assert.ok(device.includes("'-sdk', 'iphoneos', '-destination', 'generic/platform=iOS'"));
  assert.ok(!/ONLY_ACTIVE_ARCH|ARCHS=|simulatorArchitectureSettings/.test(device));
});

test('standard ARM runtime preserves opt-in toolchain and verified architecture while stable device Release stays Intel', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ios-release-runtime.yml', import.meta.url), 'utf8');
  const deviceWorkflow = readFileSync(new URL('../.github/workflows/ios-simulator.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('./ci-native.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /^    runs-on: macos-15$/m);
  assert.ok(deviceWorkflow.includes("runs-on: ${{ github.ref == 'refs/heads/codex/post-capture-face-effects' && 'macos-15' || 'macos-15-intel' }}"));
  assert.ok(workflow.includes("contains(github.event.head_commit.message, '[native-runtime-ci]')"));
  assert.ok(workflow.includes('github.event.repository.private == false'));
  assert.match(workflow, /DEVELOPER_DIR: \/Applications\/Xcode_26\.3\.app\/Contents\/Developer/);
  assert.match(workflow, /WEDDING_NATIVE_MODE: release-runtime/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cache: npm/);
  assert.match(runner, /simulatorBuildArchitecture\(process\.arch, host\.stdout\)/);
  assert.match(runner, /\.\.\.simulatorArchitectureSettings\(mode, status\.simulatorArchitecture\)/);
  assert.deepEqual(simulatorArchitectureSettings('release-runtime', simulatorBuildArchitecture('arm64', 'arm64\n')),
    ['ONLY_ACTIVE_ARCH=YES', 'ARCHS=arm64']);
});

test('Release smoke SDK preflight runs before dependencies and preserves compiler failures', t => {
  const workflow = readFileSync(new URL('../.github/workflows/ios-release-runtime.yml', import.meta.url), 'utf8');
  const step = workflow.match(/      - name: Typecheck standalone Release smoke source before dependencies\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step);
  assert.match(step, /id: swift_smoke\n        timeout-minutes: 3/);
  assert.ok(workflow.indexOf('id: swift_smoke') < workflow.indexOf('id: npmci'));
  assert.ok(workflow.indexOf('id: swift_smoke') < workflow.indexOf('id: cocoapods'));
  assert.match(workflow, /steps\.swift_smoke\.outcome == 'failure' && 'swift-smoke-typecheck'/);
  const body = step.split('        run: |\n')[1].replace(/^          /gm, '');
  assert.equal(spawnSync('bash', ['-n'], { input: body }).status, 0);
  const directory = mkdtempSync(join(tmpdir(), 'wedding-swift-preflight-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin'), runner = join(directory, 'runner'), argsFile = join(directory, 'args');
  const platform = join(directory, 'test simulator.platform');
  mkdirSync(bin);
  mkdirSync(join(platform, 'Developer/usr/lib'), { recursive: true });
  mkdirSync(join(runner, 'wedding-native-diagnostics'), { recursive: true });
  writeFileSync(join(bin, 'uname'), '#!/bin/bash\nprintf "%s\\n" "$WEDDING_TEST_ARCH"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'xcrun'), '#!/bin/bash\nset -eu\n' +
    'if [[ "$*" == "--sdk iphonesimulator --show-sdk-path" ]]; then\n' +
    '  printf "%s\\n" "/test simulator.sdk"\n' +
    'elif [[ "$*" == "--sdk iphonesimulator --show-sdk-platform-path" ]]; then\n' +
    '  printf "%s\\n" "$WEDDING_TEST_PLATFORM"\nelse\n' +
    '  printf "%s\\n" "$@" > "$WEDDING_TEST_ARGUMENTS"\n' +
    '  exit "${WEDDING_TEST_COMPILER_EXIT:-0}"\nfi\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, RUNNER_TEMP: runner,
    DEVELOPER_DIR: '/test Xcode.app/Contents/Developer', WEDDING_TEST_ARGUMENTS: argsFile,
    WEDDING_TEST_PLATFORM: platform };
  for (const architecture of ['arm64', 'x86_64']) {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', body],
      { env: { ...env, WEDDING_TEST_ARCH: architecture }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(argsFile, 'utf8').trimEnd().split('\n'), [
      '--sdk', 'iphonesimulator', 'swiftc', '-swift-version', '5',
      '-target', architecture + '-apple-ios16.4-simulator', '-sdk', '/test simulator.sdk',
      '-I', join(platform, 'Developer/usr/lib'),
      '-F', join(platform, 'Developer/Library/Frameworks'),
      '-module-cache-path', join(runner, 'wedding-smoke-module-cache'),
      '-typecheck', 'apps/ipad/native-tests/WeddingPhotoboothReleaseSmokeTests.swift',
    ]);
  }
  const failed = spawnSync('bash', ['--noprofile', '--norc', '-c', body],
    { env: { ...env, WEDDING_TEST_ARCH: 'arm64', WEDDING_TEST_COMPILER_EXIT: '17' } });
  assert.equal(failed.status, 17, 'tee must not hide a failed compiler');
  rmSync(argsFile);
  const unsupported = spawnSync('bash', ['--noprofile', '--norc', '-c', body],
    { env: { ...env, WEDDING_TEST_ARCH: 'i386' } });
  assert.equal(unsupported.status, 1);
  assert.throws(() => readFileSync(argsFile), /ENOENT/, 'Unsupported architecture must not reach compilation');
  rmSync(join(platform, 'Developer/usr/lib'), { recursive: true });
  const missingSupport = spawnSync('bash', ['--noprofile', '--norc', '-c', body],
    { env: { ...env, WEDDING_TEST_ARCH: 'arm64' } });
  assert.equal(missingSupport.status, 1);
  assert.throws(() => readFileSync(argsFile), /ENOENT/, 'Missing SDK support must stop before compilation');
  const [annotation] = publicAnnotations({ jobStatus: 'failure', failedStep: 'swift-smoke-typecheck',
    logs: { 'swift-smoke-typecheck.log': 'ReleaseSmoke.swift:20:3: error: diagnostic fixture compiler failure' } });
  assert.ok(annotation.includes('Failed stage: swift-smoke-typecheck: failed'));
  assert.ok(annotation.includes('diagnostic fixture compiler failure'));
});

test('runtime preparation, Xcode, stop and cleanup budgets fit the workflow backstop without another boot extension', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ios-release-runtime.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('./ci-native.mjs', import.meta.url), 'utf8');
  const nativeMinutes = Number(workflow.match(/id: native\s+#[^\n]*\n\s*#[^\n]*\n\s*timeout-minutes:\s*(\d+)/)?.[1]);
  const jobMinutes = Number(workflow.match(/\n    timeout-minutes:\s*(\d+)/)?.[1]);
  assert.equal(nativeMinutes, NATIVE_RUNTIME_LIMITS.nativeStepMinutes);
  assert.equal(jobMinutes, NATIVE_RUNTIME_LIMITS.jobMinutes);
  assert.equal(NATIVE_RUNTIME_LIMITS.preparationMs, 18 * 60_000);
  assert.equal(NATIVE_RUNTIME_LIMITS.xcodeMs, 40 * 60_000);
  assert.ok(NATIVE_RUNTIME_LIMITS.preparationMs + NATIVE_RUNTIME_LIMITS.xcodeMs +
    NATIVE_RUNTIME_LIMITS.cleanupMs + NATIVE_RUNTIME_LIMITS.processStopMs < nativeMinutes * 60_000);
  assert.ok(jobMinutes >= nativeMinutes + 10 + 3 + 5 + 5);
  assert.match(runner, /command\('simulator-ready'[^\n]+timeout: 600_000/);
  assert.match(runner, /timeout = Math\.min\(timeout, phaseDeadline - Date\.now\(\)\)/);
  assert.match(runner, /await stop\(record\)/);
  assert.ok(!runner.includes('process.exit(code)'));
});

async function waitUntil(check, milliseconds = 3000) {
  const deadline = performance.now() + milliseconds;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error('Process fixture readiness deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function ownedWriterFixture(t, { exitParent = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-owned-writers-'));
  const file = join(directory, 'writes.txt');
  const writer = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(file)},'x'),10);`;
  const parent = `const{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});` +
    `spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});` +
    (exitParent ? 'setTimeout(()=>process.exit(0),150);' : 'setInterval(()=>{},1000);');
  const child = spawn(process.execPath, ['-e', parent], { detached: true, stdio: 'ignore' });
  const closed = new Promise(resolveClose => child.once('close', resolveClose));
  t.after(async () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 500))]);
    rmSync(directory, { recursive: true, force: true });
  });
  return { child, closed, file };
}

test('owned group shutdown waits through SIGKILL for a real stubborn grandchild and leaves unrelated processes alive', { timeout: 8000 }, async t => {
  const fixture = ownedWriterFixture(t);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  const unrelatedClosed = new Promise(resolveClose => unrelated.once('close', resolveClose));
  t.after(async () => { try { process.kill(-unrelated.pid, 'SIGKILL'); } catch {} await unrelatedClosed; });
  await waitUntil(() => { try { return readFileSync(fixture.file).length > 2; } catch { return false; } });
  const result = await stopOwnedProcessGroup(fixture.child, { graceMs: 75, killWaitMs: 1500, pollMs: 20 });
  assert.equal(result.quiescent, true);
  assert.deepEqual(result.signals, ['SIGTERM', 'SIGKILL']);
  await fixture.closed;
  const count = readFileSync(fixture.file).length;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(readFileSync(fixture.file).length, count, 'No grandchild may continue writing after cleanup returns');
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});

test('a parent exit does not prove quiescence while its reparented process-group writer still runs', { timeout: 8000 }, async t => {
  const fixture = ownedWriterFixture(t, { exitParent: true });
  await waitUntil(() => fixture.child.exitCode === 0);
  assert.equal(ownedProcessGroupState(fixture.child.pid).quiescent, false);
  const result = await stopOwnedProcessGroup(fixture.child, { graceMs: 75, killWaitMs: 1500, pollMs: 20 });
  assert.equal(result.quiescent, true);
  const count = readFileSync(fixture.file).length;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(readFileSync(fixture.file).length, count);
});

test('unknown group state fails closed within its stop budget instead of granting cleanup permission', async () => {
  let clock = 0;
  const signals = [];
  await assert.rejects(stopOwnedProcessGroup({ pid: 123456, spawnargs: ['fixture'] }, {
    graceMs: 5, killWaitMs: 5, pollMs: 1, now: () => clock,
    wait: async ms => { clock += ms; }, signal: (pid, signal) => signals.push({ pid, signal }),
    state: () => ({ quiescent: false, live: null, observation: 'unavailable' }),
  }), error => error.processGroup?.quiescent === false && error.message.includes('cleanup deadline'));
  assert.equal(clock, 10);
  assert.deepEqual(signals, [{ pid: -123456, signal: 'SIGTERM' }, { pid: -123456, signal: 'SIGKILL' }]);
  for (const child of [{ pid: 1, spawnargs: [] }, { pid: process.pid, spawnargs: [] }, { pid: -1 }, {}]) {
    await assert.rejects(stopOwnedProcessGroup(child), /owned process group/);
  }
});

test('zombie-only process snapshots cannot hide a newly forked live group member', () => {
  let reads = 0;
  const run = program => {
    if (program === 'ps') return { status: 0, stdout: '123456 123456 Z\n' };
    return { status: 0, stdout: ++reads === 1 ? '123456\n' : '123456\n123457\n' };
  };
  assert.deepEqual(ownedProcessGroupState(123456, { signal: () => {}, run }),
    { quiescent: false, live: null, zombies: 1, observation: 'membership-changed' });
});

test('failed valid XCTest results remain inspectable while interrupted or unknown writers block output removal', () => {
  const passed = { mode: 'release-runtime', runnerResult: 'passed', allOwnedGroupsQuiescent: true,
    safeToRemoveBuildOutputs: true, safeToInspectResultBundle: true };
  assert.equal(runtimeOutputRemovalAllowed(passed), true);
  assert.equal(runtimeResultInspectionAllowed(passed), true);
  const failedTests = { ...passed, runnerResult: 'failed', safeToRemoveBuildOutputs: false };
  assert.equal(runtimeOutputRemovalAllowed(failedTests), false);
  assert.equal(runtimeResultInspectionAllowed(failedTests), true, 'Clean failed assertions retain valid xcresults');
  for (const invalid of [undefined, {}, { ...passed, allOwnedGroupsQuiescent: false },
    { ...passed, safeToRemoveBuildOutputs: false, safeToInspectResultBundle: false }, { ...passed, mode: 'release-build' }]) {
    assert.equal(runtimeOutputRemovalAllowed(invalid), false);
    assert.equal(runtimeResultInspectionAllowed(invalid), false);
  }
  const workflow = readFileSync(new URL('../.github/workflows/ios-release-runtime.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('!${{ runner.temp }}/wedding-native-diagnostics/native-tests.xcresult/**'));
  assert.ok(workflow.includes("steps.bound_result.outputs.include_result == 'true'"));
  assert.ok(workflow.includes('runtimeResultInspectionAllowed(evidence)'));
  assert.ok(workflow.includes('runtimeOutputRemovalAllowed(evidence)'));
});
