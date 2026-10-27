import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNativeOrientationPort, type OrientationSDK, type OrientationWindow } from '../src/orientation-native';
import { createOrientationController, type OrientationObservation } from '../src/orientation-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
async function flush() { for (let n = 0; n < 40; n++) await Promise.resolve(); }
function nativeHarness() {
  const h = {
    orientation: 1, lock: 3, size: { width: 820, height: 1180 },
    supportCalls: [] as number[], lockCalls: [] as number[], unlocks: 0, reads: 0,
    nativeListeners: new Set<() => void>(), windowListeners: new Set<() => void>(),
    nativeRemovals: 0, windowRemovals: 0,
    orientationImpl: async (): Promise<number> => { h.reads++; return h.orientation; },
    windowSubscriptionFails: false, nativeRemovalFails: false,
  };
  const sdk: OrientationSDK = {
    OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3, LANDSCAPE: 5 },
    Orientation: { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
    supportsOrientationLockAsync: async value => { h.supportCalls.push(value); return true; },
    lockAsync: async value => { h.lockCalls.push(value); h.lock = value; },
    unlockAsync: async () => { h.unlocks++; h.lock = 0; },
    getOrientationAsync: () => h.orientationImpl(),
    getOrientationLockAsync: async () => h.lock,
    addOrientationChangeListener: listener => {
      h.nativeListeners.add(listener);
      return { remove() {
        h.nativeRemovals++;
        h.nativeListeners.delete(listener);
        if (h.nativeRemovalFails) throw new Error('fake-private-native-cleanup');
      } };
    },
  };
  const window: OrientationWindow = {
    get: name => { assert.equal(name, 'window'); return { ...h.size }; },
    addEventListener: (name, listener) => {
      assert.equal(name, 'change');
      if (h.windowSubscriptionFails) throw new Error('fake-private-window-error');
      h.windowListeners.add(listener);
      return { remove() { h.windowRemovals++; h.windowListeners.delete(listener); } };
    },
  };
  return {
    h, sdk, window,
    load: () => loadNativeOrientationPort({ loadSDK: async () => sdk, loadWindow: async () => window }),
    notifyNative() { for (const callback of h.nativeListeners) callback(); },
    notifyWindow() { for (const callback of h.windowListeners) callback(); },
  };
}

test('loading adapter is lazy with respect to native requests and listeners', async () => {
  const t = nativeHarness();
  const port = await t.load();
  assert.equal(port.available, true);
  assert.deepEqual(t.h.lockCalls, []);
  assert.equal(t.h.unlocks, 0);
  assert.equal(t.h.nativeListeners.size, 0);
  assert.equal(t.h.windowListeners.size, 0);
  assert.equal(t.h.reads, 0);
});

test('SDK58 native mapping uses unlock for Auto, upright Portrait and both-sided Landscape', async () => {
  const t = nativeHarness();
  const port = await t.load();
  for (const lock of ['default', 'portrait-up', 'landscape'] as const) {
    assert.equal(await port.supports(lock), true);
    await port.request(lock);
  }
  assert.deepEqual(t.h.supportCalls, [0, 3, 5]);
  assert.equal(t.h.unlocks, 1);
  assert.deepEqual(t.h.lockCalls, [3, 5]);
});

test('observation combines actual SDK orientation and policy with window dimensions', async () => {
  const t = nativeHarness();
  const port = await t.load();
  assert.deepEqual(await port.readObservation(),
    { orientation: 'portrait-up', lock: 'portrait-up', width: 820, height: 1180 });
  t.h.size = { width: 500, height: 400 };
  assert.deepEqual(await port.readObservation(),
    { orientation: 'portrait-up', lock: 'portrait-up', width: 500, height: 400 });
});

test('all SDK interface orientation values and unknown normalize truthfully', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const cases = [[0, 'unknown'], [1, 'portrait-up'], [2, 'portrait-down'],
    [3, 'landscape-left'], [4, 'landscape-right'], [999, 'unknown']] as const;
  for (const [value, expected] of cases) {
    t.h.orientation = value;
    assert.equal((await port.readObservation()).orientation, expected);
  }
  t.h.lock = 9;
  assert.equal((await port.readObservation()).lock, 'unknown');
  t.h.lock = 8;
  assert.equal((await port.readObservation()).lock, 'other');
});

test('both SDK events and window-only resizing deliver a fresh combined snapshot', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const events: OrientationObservation[] = [];
  const stop = port.subscribe(value => events.push(value));
  t.notifyNative();
  await flush();
  assert.equal(events.length, 1);
  t.h.size = { width: 1180, height: 820 };
  t.notifyWindow();
  await flush();
  assert.equal(events.length, 2);
  assert.equal(events.at(-1)?.width, 1180);
  assert.equal(events.at(-1)?.orientation, 'portrait-up', 'do not infer native rotation from width');
  stop();
});

test('same-turn native and Dimensions events coalesce without repeated geometry requests', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const events: OrientationObservation[] = [];
  const stop = port.subscribe(value => events.push(value));
  t.notifyNative();
  t.notifyWindow();
  t.notifyNative();
  await flush();
  assert.equal(events.length, 1);
  assert.equal(t.h.reads, 1);
  assert.deepEqual(t.h.lockCalls, []);
  stop();
});

test('old asynchronous event observations cannot replace newer window observations', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const events: OrientationObservation[] = [];
  const old = deferred<number>();
  const stop = port.subscribe(value => events.push(value));
  t.h.orientationImpl = () => old.promise;
  t.notifyNative();
  await flush();
  t.h.orientation = 4;
  t.h.lock = 5;
  t.h.size = { width: 1180, height: 820 };
  t.h.orientationImpl = async () => t.h.orientation;
  t.notifyWindow();
  await flush();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.orientation, 'landscape-right');
  old.resolve(1);
  await flush();
  assert.equal(events.length, 1);
  stop();
});

test('unsubscribe is idempotent and drops already queued or pending callbacks', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const events: OrientationObservation[] = [];
  const old = deferred<number>();
  t.h.orientationImpl = () => old.promise;
  const stop = port.subscribe(value => events.push(value));
  t.notifyNative();
  await flush();
  stop();
  stop();
  old.resolve(1);
  t.notifyNative();
  t.notifyWindow();
  await flush();
  assert.deepEqual(events, []);
  assert.equal(t.h.nativeRemovals, 1);
  assert.equal(t.h.windowRemovals, 1);
  assert.equal(t.h.nativeListeners.size, 0);
  assert.equal(t.h.windowListeners.size, 0);
});

test('failed window listener registration cleans the native listener and reports safe unavailability', async () => {
  const t = nativeHarness();
  t.h.windowSubscriptionFails = true;
  const port = await t.load();
  assert.throws(() => port.subscribe(() => {}),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'native-unavailable'
      && !error.message.includes('fake-private'));
  assert.equal(t.h.nativeRemovals, 1);
  assert.equal(t.h.nativeListeners.size, 0);
});

test('a throwing native cleanup does not leak the window subscription or raw error', async () => {
  const t = nativeHarness();
  t.h.nativeRemovalFails = true;
  const port = await t.load();
  const stop = port.subscribe(() => {});
  assert.doesNotThrow(stop);
  assert.equal(t.h.nativeRemovals, 1);
  assert.equal(t.h.windowRemovals, 1);
  assert.equal(t.h.windowListeners.size, 0);
});

test('failed native loading resolves explicit unavailable port instead of crashing import', async () => {
  const t = nativeHarness();
  const port = await loadNativeOrientationPort({
    loadSDK: async () => { throw new Error('fake-private-missing-module-payload'); },
    loadWindow: async () => t.window,
  });
  assert.equal(port.available, false);
  const stop = port.subscribe(() => { assert.fail('unavailable subscription must stay silent'); });
  stop();
  for (const operation of [() => port.supports('portrait-up'), () => port.request('landscape'),
    () => port.readObservation()]) {
    await assert.rejects(operation, (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'native-unavailable'
      && !error.message.includes('fake-private'));
  }
  assert.deepEqual(t.h.lockCalls, []);
});

test('failed RN window loading is unavailable without admitting native requests', async () => {
  const t = nativeHarness();
  const port = await loadNativeOrientationPort({
    loadSDK: async () => t.sdk,
    loadWindow: async () => { throw new Error('fake-private-window-loader'); },
  });
  assert.equal(port.available, false);
  assert.deepEqual(t.h.lockCalls, []);
  assert.equal(t.h.nativeListeners.size, 0);
});

test('missing-native port feeds controller a safe unavailable state with no fatal startup', async () => {
  const t = nativeHarness();
  const port = await loadNativeOrientationPort({
    loadSDK: async () => { throw new Error('fake-private-unavailable'); },
    loadWindow: async () => t.window,
  });
  const controller = createOrientationController(port, { initialPreference: 'portrait' });
  controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error, 'native-unavailable');
  assert.ok(!JSON.stringify(controller.getState()).includes('fake-private'));
  controller.dispose();
});

test('event read failures are contained without an unhandled callback or false observation', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const events: OrientationObservation[] = [];
  const errors: string[] = [];
  const stop = port.subscribe(value => events.push(value), code => errors.push(code));
  t.h.orientationImpl = async () => { throw new Error('fake-private-native-read'); };
  t.notifyNative();
  await flush();
  assert.deepEqual(events, []);
  assert.deepEqual(errors, ['observation-unavailable']);
  await assert.rejects(port.readObservation());
  stop();
});

test('adapter event read error invalidates previously observed controller state', async () => {
  const t = nativeHarness();
  const port = await t.load();
  const controller = createOrientationController(port, { initialPreference: 'portrait' });
  controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.equal(controller.getState().status, 'observed');
  t.h.orientationImpl = async () => { throw new Error('fake-private-event-read-error'); };
  t.notifyWindow();
  await flush();
  assert.equal(controller.getState().error, 'observation-unavailable');
  assert.equal(controller.getState().observation, null);
  assert.notEqual(controller.getState().status, 'observed');
  controller.dispose();
});
