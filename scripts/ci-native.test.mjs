import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passingXCTestCounts, selectIpadSimulator } from './ci-native-contract.mjs';
import { bounded, redact } from './ci-summary.mjs';

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
