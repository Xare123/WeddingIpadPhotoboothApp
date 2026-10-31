import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrientationController, parseOrientationChoice, requestedOrientationLock,
  type OrientationChoice, type RequestedOrientationLock as NativeLock,
  type OrientationObservation as Observation, type OrientationState as State,
  type OrientationPort, type OrientationBlocker as Blocker,
} from '../src/orientation-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flush() { for (let n = 0; n < 40; n++) await Promise.resolve(); }
class Clock {
  now = 0;
  tasks: { at: number; cancelled: boolean; callback: () => void }[] = [];
  schedule = (delay: number, callback: () => void) => {
    const entry = { at: this.now + delay, cancelled: false, callback };
    this.tasks.push(entry);
    return () => { entry.cancelled = true; };
  };
  advance(ms: number) {
    this.now += ms;
    let due;
    let guard = 0;
    while ((due = this.tasks.find(task => !task.cancelled && task.at <= this.now))) {
      assert.ok(++guard < 100, 'bounded fake timer work');
      due.cancelled = true;
      due.callback();
    }
  }
}
function forLock(lock: NativeLock): Observation {
  return lock === 'portrait-up'
    ? { orientation: 'portrait-up', lock, width: 820, height: 1180 }
    : { orientation: 'landscape-left', lock, width: 1180, height: 820 };
}
function harness(committed: unknown = undefined) {
  const clock = new Clock();
  const h = {
    clock,
    current: forLock('default'),
    requests: [] as NativeLock[], supports: [] as NativeLock[],
    activeListeners: new Set<(value: Observation) => void>(),
    allListeners: [] as ((value: Observation) => void)[],
    states: [] as State[],
    requestActive: 0, maxRequestActive: 0,
    supportsImpl: async (_lock: NativeLock): Promise<boolean> => true,
    requestImpl: async (lock: NativeLock): Promise<void> => { h.current = forLock(lock); },
    observationImpl: async (): Promise<Observation> => h.current,
  };
  const port: OrientationPort = {
    available: true,
    supports: lock => { h.supports.push(lock); return h.supportsImpl(lock); },
    request: lock => {
      h.requests.push(lock);
      h.requestActive++;
      h.maxRequestActive = Math.max(h.maxRequestActive, h.requestActive);
      return h.requestImpl(lock).finally(() => { h.requestActive--; });
    },
    readObservation: () => h.observationImpl(),
    subscribe: callback => {
      h.activeListeners.add(callback);
      h.allListeners.push(callback);
      return () => { h.activeListeners.delete(callback); };
    },
    schedule: clock.schedule,
  };
  const controller = createOrientationController(port, {
    initialPreference: committed, settleMs: 2000, onState: state => h.states.push(state),
  });
  return { h, controller, port, emit(value: Observation) {
    h.current = value;
    for (const callback of h.activeListeners) callback(value);
  } };
}
async function boot(subject: ReturnType<typeof harness>, blockers: Blocker[] = []) {
  subject.controller.setContext({ active: true, blockers });
  await flush();
}

test('valid committed choices map to Auto, upright Portrait and both-sided Landscape', () => {
  for (const value of ['auto', 'portrait', 'landscape'] as const) assert.equal(parseOrientationChoice(value), value);
  for (const value of [undefined, null, '', 'PORTRAIT', 1, {}, false]) assert.equal(parseOrientationChoice(value), null);
  assert.equal(requestedOrientationLock('auto'), 'default');
  assert.equal(requestedOrientationLock('portrait'), 'portrait-up');
  assert.equal(requestedOrientationLock('landscape'), 'landscape');
});

test('absent or invalid committed preference defaults to Auto without a persistence port', async () => {
  for (const value of [undefined, null, 'sideways', {}]) {
    const t = harness(value);
    await boot(t);
    assert.equal(t.controller.getState().desired, 'auto');
    assert.equal(t.controller.getState().status, 'observed');
    assert.deepEqual(t.h.requests, ['default']);
    assert.deepEqual(Object.keys(t.port).sort(),
      ['available', 'readObservation', 'request', 'schedule', 'subscribe', 'supports']);
  }
});

test('valid committed Portrait is preserved and requests upright portrait', async () => {
  const t = harness('portrait');
  await boot(t);
  assert.equal(t.controller.getState().desired, 'portrait');
  assert.equal(t.controller.getState().status, 'observed');
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('valid committed Landscape is restored and either landscape side is accepted', async () => {
  const t = harness('landscape');
  await boot(t);
  t.emit({ ...forLock('landscape'), orientation: 'landscape-right' });
  assert.equal(t.controller.getState().status, 'observed');
  assert.deepEqual(t.h.requests, ['landscape']);
});

test('resolved native promise alone never confirms rotation', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => {};
  await boot(t);
  assert.equal(t.controller.getState().status, 'requested');
  t.h.clock.advance(1999);
  assert.equal(t.controller.getState().status, 'requested');
  t.h.clock.advance(1);
  assert.equal(t.controller.getState().status, 'unconfirmed');
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('native policy/interface with contrary window shape remains unconfirmed', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => {
    t.h.current = { orientation: 'portrait-up', lock: 'portrait-up', width: 1180, height: 820 };
  };
  await boot(t);
  assert.equal(t.controller.getState().windowMismatch, true);
  assert.notEqual(t.controller.getState().status, 'observed');
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
});

test('matching window shape cannot substitute for matching native policy', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => { t.h.current = { ...forLock('portrait-up'), lock: 'other' }; };
  await boot(t);
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
});

test('unknown orientation and upside-down portrait never confirm upright Portrait', async () => {
  for (const orientation of ['unknown', 'portrait-down'] as const) {
    const t = harness('portrait');
    t.h.requestImpl = async () => { t.h.current = { ...forLock('portrait-up'), orientation }; };
    await boot(t);
    t.h.clock.advance(2000);
    assert.equal(t.controller.getState().status, 'unconfirmed');
  }
});

test('malformed geometry is rejected rather than shown as observed', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => { t.h.current = { ...forLock('portrait-up'), width: 0 }; };
  await boot(t);
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
  assert.equal(t.controller.getState().error, 'observation-unavailable');
});

test('Auto policy observation still reports window/interface disagreement', async () => {
  const t = harness();
  t.h.requestImpl = async () => {
    t.h.current = { orientation: 'portrait-up', lock: 'default', width: 1180, height: 820 };
  };
  await boot(t);
  assert.equal(t.controller.getState().status, 'observed');
  assert.equal(t.controller.getState().windowMismatch, true);
});

test('unsupported policy does not reach request port or create an automatic retry loop', async () => {
  const t = harness('portrait');
  t.h.supportsImpl = async () => false;
  await boot(t);
  assert.equal(t.controller.getState().status, 'unsupported');
  assert.deepEqual(t.h.requests, []);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.equal(t.h.supports.length, 1);
});

test('support/request failures expose only safe error categories', async () => {
  for (const stage of ['support', 'request'] as const) {
    const t = harness('portrait');
    const failure = async () => { throw new Error('private-fake-native-payload'); };
    if (stage === 'support') t.h.supportsImpl = failure;
    else t.h.requestImpl = failure;
    await boot(t);
    const state = t.controller.getState();
    assert.equal(state.status, 'error');
    assert.equal(state.error, stage === 'support' ? 'support-unavailable' : 'request-failed');
    assert.ok(!JSON.stringify(state).includes('private-fake-native-payload'));
    assert.equal(t.h.supports.length, 1);
  }
});

test('missing native capability is an explicit safe unavailable state', async () => {
  const t = harness('portrait');
  t.h.supportsImpl = async () => { throw Object.assign(new Error('fake raw'), { code: 'native-unavailable' }); };
  await boot(t);
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-unavailable');
  assert.deepEqual(t.h.requests, []);
});

test('all capture, saving and editor blockers defer native requests', async t => {
  for (const blocker of ['countdown', 'capture', 'save', 'editor'] as const) {
    await t.test(blocker, async () => {
      const s = harness('portrait');
      await boot(s, [blocker]);
      assert.equal(s.controller.getState().status, 'deferred');
      assert.deepEqual(s.h.supports, []);
      assert.deepEqual(s.h.requests, []);
      s.controller.setContext({ active: true, blockers: [] });
      await flush();
      assert.deepEqual(s.h.requests, ['portrait-up']);
    });
  }
});

test('committed change stages during editor and is restorable without mutating photos', async () => {
  const t = harness('auto');
  await boot(t, ['editor']);
  t.controller.setCommittedPreference('landscape');
  await flush();
  assert.equal(t.controller.getState().desired, 'landscape');
  assert.deepEqual(t.h.requests, []);
  const relaunched = harness('landscape'); // Caller supplies its independently persisted preference.
  await boot(relaunched);
  assert.deepEqual(relaunched.h.requests, ['landscape']);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['landscape']);
});

test('inactive app admits no support or request operation', async () => {
  const t = harness('portrait');
  t.controller.setCommittedPreference('landscape');
  await flush();
  assert.deepEqual(t.h.supports, []);
  assert.deepEqual(t.h.requests, []);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['landscape']);
});

test('becoming unsafe while support is pending prevents native request', async () => {
  const t = harness('portrait');
  const support = deferred<boolean>();
  t.h.supportsImpl = () => support.promise;
  await boot(t);
  t.controller.setContext({ active: true, blockers: ['save'] });
  support.resolve(true);
  await flush();
  assert.deepEqual(t.h.requests, []);
  assert.equal(t.controller.getState().status, 'deferred');
  t.h.supportsImpl = async () => true;
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('rapid committed changes coalesce behind one noncancellable native operation', async () => {
  const t = harness('portrait');
  const request = deferred<void>();
  t.h.requestImpl = async lock => {
    if (t.h.requests.length === 1) await request.promise;
    t.h.current = forLock(lock);
  };
  await boot(t);
  t.controller.setCommittedPreference('auto');
  t.controller.setCommittedPreference('landscape');
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up']);
  request.resolve();
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'landscape']);
  assert.equal(t.h.maxRequestActive, 1);
  assert.equal(t.controller.getState().desired, 'landscape');
  assert.equal(t.controller.getState().status, 'observed');
});

test('repeated committed preference causes no extra request', async () => {
  const t = harness('portrait');
  await boot(t);
  for (let n = 0; n < 10; n++) t.controller.setCommittedPreference('portrait');
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setCommittedPreference('landscape');
  await flush();
  for (let n = 0; n < 10; n++) t.controller.setCommittedPreference('landscape');
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'landscape']);
});

test('explicit retry is bounded and a matching later observation clears uncertainty', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => {};
  await boot(t);
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
  t.controller.retry();
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'portrait-up']);
  t.emit(forLock('portrait-up'));
  assert.equal(t.controller.getState().status, 'observed');
});

test('old snapshot cannot overwrite a newer subscription observation', async () => {
  const t = harness('portrait');
  await boot(t);
  const snapshot = deferred<Observation>();
  t.h.observationImpl = () => snapshot.promise;
  t.controller.refresh();
  t.emit(forLock('portrait-up'));
  snapshot.resolve(forLock('default'));
  await flush();
  assert.equal(t.controller.getState().status, 'observed');
  assert.equal(t.controller.getState().observation?.lock, 'portrait-up');
});

test('background invalidates subscriptions and callbacks from older active epochs', async () => {
  const t = harness('portrait');
  await boot(t);
  const stale = t.h.allListeners.at(-1)!;
  t.controller.setContext({ active: false, blockers: [] });
  stale(forLock('default'));
  assert.equal(t.controller.getState().observation, null);
  assert.equal(t.h.activeListeners.size, 0);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  stale(forLock('default'));
  assert.equal(t.controller.getState().status, 'observed');
  assert.equal(t.controller.getState().observation?.lock, 'portrait-up');
  assert.equal(t.h.activeListeners.size, 1);
  assert.deepEqual(t.h.requests, ['portrait-up', 'portrait-up']);
});

test('background during admitted work cannot confirm or overlap requests', async () => {
  const t = harness('portrait');
  const first = deferred<void>();
  t.h.requestImpl = async lock => {
    if (t.h.requests.length === 1) await first.promise;
    t.h.current = forLock(lock);
  };
  await boot(t);
  t.controller.setContext({ active: false, blockers: ['save'] });
  t.controller.setCommittedPreference('landscape');
  t.controller.setContext({ active: true, blockers: ['save'] });
  first.resolve();
  await flush();
  assert.equal(t.controller.getState().status, 'deferred');
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'landscape']);
  assert.equal(t.h.maxRequestActive, 1);
  assert.equal(t.controller.getState().status, 'observed');
});

test('dispose is idempotent and ignores late native/read/listener work', async () => {
  const t = harness('portrait');
  const native = deferred<void>();
  const read = deferred<Observation>();
  t.h.requestImpl = () => native.promise;
  t.h.observationImpl = () => read.promise;
  await boot(t);
  const callback = t.h.allListeners.at(-1)!;
  t.controller.dispose();
  const state = t.controller.getState();
  const count = t.h.states.length;
  t.controller.dispose();
  callback(forLock('portrait-up'));
  native.resolve();
  read.resolve(forLock('portrait-up'));
  t.controller.setCommittedPreference('landscape');
  t.controller.retry();
  t.controller.refresh();
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.controller.getState(), state);
  assert.equal(t.controller.getState().status, 'disposed');
  assert.equal(t.h.states.length, count);
  assert.equal(t.h.activeListeners.size, 0);
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('cancelled deadline cannot overwrite a newer observed choice', async () => {
  const t = harness('portrait');
  t.h.requestImpl = async () => {};
  await boot(t);
  const obsolete = t.h.clock.tasks.at(-1)!;
  t.h.requestImpl = async lock => { t.h.current = forLock(lock); };
  t.controller.setCommittedPreference('landscape');
  await flush();
  obsolete.callback();
  assert.equal(t.controller.getState().status, 'observed');
  assert.equal(t.controller.getState().desired, 'landscape');
});

test('later window constraints do not cause automatic reapply loops', async () => {
  const t = harness('portrait');
  await boot(t);
  t.emit({ ...forLock('portrait-up'), width: 1180, height: 820 });
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
  t.emit(forLock('portrait-up'));
  assert.equal(t.controller.getState().status, 'observed');
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('safe snapshots are immutable and no data/persistence mutation API exists', async () => {
  const t = harness('portrait');
  await boot(t);
  const state = t.controller.getState();
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.observation));
  assert.equal(Reflect.set(state.observation!, 'width', 1), false);
  assert.equal(state.observation?.width, 820);
  assert.equal('writePreference' in t.port, false);
  assert.equal('readPreference' in t.port, false);
  assert.equal('select' in t.controller, false);
});

test('identical or reordered context is a no-op for subscribers and native calls', async () => {
  const t = harness('portrait');
  await boot(t, ['save', 'editor']);
  const notifications = t.h.states.length;
  for (let index = 0; index < 10; index++) t.controller.setContext({ active: true, blockers: ['editor', 'save', 'save'] });
  await flush();
  assert.equal(t.h.states.length, notifications);
  assert.deepEqual(t.h.requests, []);
  assert.equal(t.h.allListeners.length, 1);
});

test('failed or malformed newer observation invalidates previous observation proof', async () => {
  const t = harness('portrait');
  await boot(t);
  assert.equal(t.controller.getState().status, 'observed');
  t.h.observationImpl = async () => { throw new Error('fake-private-native-read-error'); };
  t.controller.refresh();
  await flush();
  assert.equal(t.controller.getState().observation, null);
  assert.equal(t.controller.getState().error, 'observation-unavailable');
  assert.notEqual(t.controller.getState().status, 'observed');
  t.h.clock.advance(2000);
  assert.equal(t.controller.getState().status, 'unconfirmed');
  t.emit(forLock('portrait-up'));
  assert.equal(t.controller.getState().status, 'observed');
  t.emit({ ...forLock('portrait-up'), width: Number.NaN });
  assert.equal(t.controller.getState().observation, null);
  assert.notEqual(t.controller.getState().status, 'observed');
});

test('extra native payload fields never escape through observation snapshots', async () => {
  const t = harness('portrait');
  await boot(t);
  t.emit(Object.assign(forLock('portrait-up'), { rawNativePayload: 'fake-private-payload' }));
  assert.deepEqual(Object.keys(t.controller.getState().observation!).sort(), ['height', 'lock', 'orientation', 'width']);
  assert.ok(!JSON.stringify(t.controller.getState()).includes('fake-private-payload'));
});

test('pending native support reaches a deadline and late success never admits its request', async () => {
  const t = harness('portrait');
  const support = deferred<boolean>();
  t.h.supportsImpl = () => support.promise;
  await boot(t);
  t.h.clock.advance(5000);
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  support.resolve(true);
  await flush();
  assert.deepEqual(t.h.requests, []);
  assert.equal(t.controller.getState().error, 'native-timeout');
});

test('pending native request reaches a deadline and late success cannot publish observed', async () => {
  const t = harness('portrait');
  const request = deferred<void>();
  t.h.requestImpl = () => request.promise;
  await boot(t);
  t.h.clock.advance(5000);
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  t.emit(forLock('portrait-up'));
  assert.notEqual(t.controller.getState().status, 'observed');
  request.resolve();
  await flush();
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('newest committed preference waits for timed-out request ownership without blocking camera forever', async () => {
  const t = harness('portrait');
  const first = deferred<void>();
  t.h.requestImpl = async lock => {
    if (t.h.requests.length === 1) await first.promise;
    t.h.current = forLock(lock);
  };
  await boot(t);
  t.h.clock.advance(5000);
  t.controller.setCommittedPreference('auto');
  t.controller.setCommittedPreference('landscape');
  await flush();
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setContext({ active: true, blockers: ['capture'] });
  first.resolve();
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'landscape']);
  assert.equal(t.h.maxRequestActive, 1);
  assert.equal(t.controller.getState().status, 'observed');
});

test('support timeout survives background and a newer active epoch cannot revive the expired request', async () => {
  const t = harness('portrait');
  const support = deferred<boolean>();
  t.h.supportsImpl = () => support.promise;
  await boot(t);
  t.controller.setContext({ active: false, blockers: [] });
  t.h.clock.advance(5000);
  t.controller.setCommittedPreference('landscape');
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.equal(t.controller.getState().error, 'native-timeout');
  assert.deepEqual(t.h.requests, []);
  t.h.supportsImpl = async () => true;
  support.resolve(true);
  await flush();
  assert.deepEqual(t.h.requests, ['landscape']);
  assert.equal(t.controller.getState().status, 'observed');
});

test('dispose cancels native deadline and late timeout/call callbacks cannot change disposed state', async () => {
  const t = harness('portrait');
  const support = deferred<boolean>();
  t.h.supportsImpl = () => support.promise;
  await boot(t);
  const deadline = t.h.clock.tasks.find(task => task.at === 5000)!;
  t.controller.dispose();
  const state = t.controller.getState();
  const notifications = t.h.states.length;
  t.h.clock.advance(5000);
  deadline.callback();
  support.resolve(true);
  await flush();
  assert.deepEqual(t.controller.getState(), state);
  assert.equal(t.h.states.length, notifications);
  assert.deepEqual(t.h.requests, []);
});

test('completed request cancels native deadline and stale callback cannot poison observed state', async () => {
  const t = harness('portrait');
  await boot(t);
  const deadline = t.h.clock.tasks.find(task => task.at === 5000)!;
  deadline.callback();
  t.h.clock.advance(5000);
  assert.equal(t.controller.getState().status, 'observed');
  assert.equal(t.controller.getState().error, null);
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('late request rejection preserves timeout and does not retry or expose raw payload', async () => {
  const t = harness('portrait');
  const request = deferred<void>();
  t.h.requestImpl = () => request.promise;
  await boot(t);
  t.h.clock.advance(5000);
  request.reject(new Error('fake-private-late-rejection'));
  await flush();
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  assert.ok(!JSON.stringify(t.controller.getState()).includes('fake-private-late-rejection'));
  assert.deepEqual(t.h.requests, ['portrait-up']);
});

test('request timeout across background preserves ownership until safe latest-choice admission', async () => {
  const t = harness('portrait');
  const request = deferred<void>();
  t.h.requestImpl = async lock => {
    if (t.h.requests.length === 1) await request.promise;
    t.h.current = forLock(lock);
  };
  await boot(t);
  t.controller.setContext({ active: false, blockers: [] });
  t.h.clock.advance(5000);
  t.controller.setCommittedPreference('landscape');
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.equal(t.controller.getState().status, 'error');
  assert.equal(t.controller.getState().error, 'native-timeout');
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setContext({ active: true, blockers: ['save'] });
  request.resolve();
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up']);
  t.controller.setContext({ active: true, blockers: [] });
  await flush();
  assert.deepEqual(t.h.requests, ['portrait-up', 'landscape']);
  assert.equal(t.h.maxRequestActive, 1);
  assert.equal(t.controller.getState().status, 'observed');
});

test('dispose after native timeout freezes public state through late terminal completion', async () => {
  const t = harness('portrait');
  const request = deferred<void>();
  t.h.requestImpl = () => request.promise;
  await boot(t);
  t.h.clock.advance(5000);
  t.controller.dispose();
  const state = t.controller.getState();
  const notifications = t.h.states.length;
  request.resolve();
  await flush();
  assert.deepEqual(t.controller.getState(), state);
  assert.equal(t.h.states.length, notifications);
  assert.equal(state.status, 'disposed');
  assert.equal(state.error, 'native-timeout');
});

test('synchronous overlay admission defers pending support without poisoning retry after close', async () => {
 const support = deferred<boolean>(); let blocked = false, calls = 0;
 const controller = createOrientationController({
  available: true, isRequestSafe: () => !blocked, supports: () => support.promise,
  request: async () => { calls++; }, readObservation: async () => forLock('landscape'),
  subscribe: () => () => {}, schedule: () => () => {},
 }, { initialPreference: 'landscape' });
 controller.setContext({ active: true, blockers: [] });
 blocked = true; support.resolve(true); await flush();
 assert.equal(calls, 0); assert.equal(controller.getState().status, 'deferred');
 controller.setContext({ active: true, blockers: ['editor'] });
 blocked = false; controller.setContext({ active: true, blockers: [] }); await flush();
 assert.equal(calls, 1); assert.equal(controller.getState().status, 'observed');
 controller.dispose();
});
