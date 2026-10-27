import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeNativeStartupModules,
  type NativeModuleAvailability,
  type NativeStartupAvailability,
} from '../src/native-startup-diagnostics';

const names = ['KeyboardObserver', 'AppState', 'WebSocketModule', 'NativeAnimatedModule', 'NativeAnimatedTurboModule'];
const allAvailable = { KeyboardObserver: 'available', AppState: 'available', WebSocketModule: 'available', Animated: 'available' };
const allMissing = { KeyboardObserver: 'missing', AppState: 'missing', WebSocketModule: 'missing', Animated: 'missing' };

test('checks exactly five allowlisted modules independently and returns four logical outcomes', () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const result = probeNativeStartupModules(name => { calls.push(name); return {}; }, line => logs.push(line));
  assert.deepEqual(calls, names);
  assert.deepEqual(result, allAvailable);
  assert.deepEqual(Object.keys(result), ['KeyboardObserver', 'AppState', 'WebSocketModule', 'Animated']);
  assert.equal(logs.length, 1);
  assert.equal(logs[0], 'Native module bootstrap: KeyboardObserver=available; AppState=available; WebSocketModule=available; Animated=available');
  assert.ok(logs[0]!.length <= 400);
});

test('null and undefined are missing without preventing remaining lookups', () => {
  for (const absent of [null, undefined]) {
    const calls: string[] = [];
    const logs: string[] = [];
    const result = probeNativeStartupModules(name => { calls.push(name); return absent; }, line => logs.push(line));
    assert.deepEqual(result, allMissing);
    assert.deepEqual(calls, names);
    assert.equal(logs.length, 1);
    assert.ok(logs[0]!.startsWith('Native module bootstrap:'));
  }
});

test('throwing one lookup yields unknown only there while all others still run', () => {
  const calls: string[] = [];
  const result = probeNativeStartupModules(name => {
    calls.push(name);
    if (name === 'KeyboardObserver') throw new Error('synthetic-private-native-detail');
    return {};
  }, () => {});
  assert.deepEqual(result, { ...allAvailable, KeyboardObserver: 'unknown' });
  assert.deepEqual(calls, names);
});

test('all throwing lookups still emit one bounded line and return unknown', () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const result = probeNativeStartupModules(name => { calls.push(name); throw undefined; }, line => logs.push(line));
  assert.deepEqual(result, { KeyboardObserver: 'unknown', AppState: 'unknown', WebSocketModule: 'unknown', Animated: 'unknown' });
  assert.deepEqual(calls, names);
  assert.equal(logs.length, 1);
  assert.ok(logs[0]!.length <= 400);
});

test('Animated family considers both lookups with the complete availability truth table', () => {
  const table: [NativeModuleAvailability, NativeModuleAvailability, NativeModuleAvailability][] = [
    ['available', 'available', 'available'],
    ['available', 'missing', 'available'],
    ['available', 'unknown', 'available'],
    ['missing', 'available', 'available'],
    ['missing', 'missing', 'missing'],
    ['missing', 'unknown', 'unknown'],
    ['unknown', 'available', 'available'],
    ['unknown', 'missing', 'unknown'],
    ['unknown', 'unknown', 'unknown'],
  ];
  for (const [classic, turbo, expected] of table) {
    const calls: string[] = [];
    const result = probeNativeStartupModules(name => {
      calls.push(name);
      const state = name === 'NativeAnimatedModule' ? classic : name === 'NativeAnimatedTurboModule' ? turbo : 'available';
      if (state === 'unknown') throw new Error('synthetic-animated-error');
      return state === 'missing' ? null : {};
    }, () => {});
    assert.equal(result.Animated, expected, classic + '/' + turbo);
    assert.deepEqual(calls, names, 'available classic must not short-circuit the independent Turbo lookup');
  }
});

test('logger failure is swallowed, not retried, and ordinary bootstrap continues', () => {
  let attempts = 0;
  let continued = false;
  let result: NativeStartupAvailability | null = null;
  assert.doesNotThrow(() => {
    result = probeNativeStartupModules(() => null, () => {
      attempts++;
      throw new Error('synthetic-private-logger-error');
    });
    continued = true;
  });
  assert.equal(continued, true);
  assert.equal(attempts, 1);
  assert.deepEqual(result, allMissing);
});

test('lookup values and thrown metadata never appear in the diagnostic message', () => {
  let metadataReads = 0;
  const error = Object.create(null) as object;
  Object.defineProperty(error, 'message', { get() { metadataReads++; throw new Error('do not inspect'); } });
  Object.defineProperty(error, 'toString', { get() { metadataReads++; throw new Error('do not stringify'); } });
  const logs: string[] = [];
  const result = probeNativeStartupModules(name => {
    if (name === 'AppState') throw error;
    return { token: 'synthetic-private-token', url: 'synthetic-private-url', path: 'synthetic-private-path' };
  }, line => logs.push(line));
  assert.equal(metadataReads, 0);
  assert.equal(result.AppState, 'unknown');
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /^Native module bootstrap: KeyboardObserver=available; AppState=unknown; WebSocketModule=available; Animated=available$/);
  assert.ok(!JSON.stringify({ result, logs }).includes('synthetic-private'));
});

test('returned modules are not inspected, enumerated, coerced or invoked', () => {
  let touched = 0;
  const module = new Proxy(() => { touched++; }, {
    get() { touched++; throw new Error('no module property access'); },
    ownKeys() { touched++; throw new Error('no enumeration'); },
    apply() { touched++; throw new Error('no invocation'); },
  });
  const result = probeNativeStartupModules(() => module, () => {});
  assert.deepEqual(result, allAvailable);
  assert.equal(touched, 0);
});

test('fixed status output remains one short line across mixed lookup results', () => {
  const logs: string[] = [];
  const result = probeNativeStartupModules(name => {
    if (name === 'KeyboardObserver') return null;
    if (name === 'WebSocketModule') throw 'synthetic-private-error\nsecond line';
    if (name === 'NativeAnimatedModule') return undefined;
    return {};
  }, line => logs.push(line));
  assert.deepEqual(result, { KeyboardObserver: 'missing', AppState: 'available', WebSocketModule: 'unknown', Animated: 'available' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.split('\n').length, 1);
  assert.ok(logs[0]!.length <= 400);
  assert.ok(!logs[0]!.includes('synthetic-private'));
});
