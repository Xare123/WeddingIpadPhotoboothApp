/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCaptureRunner, nextPhotoSlot, screenForSession, sessionIsComplete, type CaptureRunEvent, type CaptureSession, type PendingPhoto } from '../src/session-capture';
import { DEFAULT_CAPTURE_TIMING, type CaptureTiming } from '../src/capture-timing';

type Session = Omit<CaptureSession, 'shots'> & { shots: { id: string; shotIndex: number; fileUri: string }[] };
const fresh = (targetCount = 5): Session => ({ id: 'session-1', targetCount, shots: [], confirmed: false });
const save = async (session: Session, photo: PendingPhoto): Promise<Session> => ({ ...session,
  shots: [...session.shots.filter(shot => shot.shotIndex !== photo.slot), { id: photo.id, shotIndex: photo.slot, fileUri: `file:///durable/${photo.id}.jpg` }].sort((a, b) => a.shotIndex - b.shotIndex),
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('five-shot sequence awaits durable save before thumbnail, next countdown, or completion', async () => {
  const firstSave = deferred<Session>();
  const events: CaptureRunEvent<Session>[] = [];
  let captures = 0, saves = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }),
    save: async (session, photo) => ++saves === 1 ? firstSave.promise : save(session, photo), wait: async () => {}, isActive: () => true, onEvent: event => events.push(event) });
  const run = runner.run(fresh(), { seconds: 2 });
  await flush();
  assert.equal(captures, 1);
  assert.equal(events.filter(event => event.kind === 'saved').length, 0);
  assert.equal(events.filter(event => event.kind === 'countdown').length, 2);
  assert.equal(runner.isBusy(), true);
  await runner.run(fresh(), { seconds: 2 });
  assert.equal(captures, 1, 'Repeated taps cannot start a second capture run');
  firstSave.resolve(await save(fresh(), { id: 'photo-1', uri: 'file:///cache.jpg', slot: 0 }));
  await run;
  assert.equal(captures, 5);
  assert.equal(saves, 5);
  const done = events.findLast(event => event.kind === 'done');
  assert.ok(done?.kind === 'done');
  assert.equal(sessionIsComplete(done.session), true);
  assert.deepEqual(done.session.shots.map(shot => shot.shotIndex), [0, 1, 2, 3, 4]);
  assert.equal(runner.isBusy(), false);
});

test('save failure keeps the exposed cache photo available for retry and never advances', async () => {
  const events: CaptureRunEvent<Session>[] = [];
  let captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }),
    save: async () => { throw new Error('disk full'); }, wait: async () => {}, isActive: () => true, onEvent: event => events.push(event) });
  await runner.run(fresh(), { seconds: 3 });
  assert.equal(captures, 1);
  assert.equal(events.some(event => event.kind === 'saved' || event.kind === 'done'), false);
  const error = events.find(event => event.kind === 'error');
  assert.ok(error?.kind === 'error');
  assert.deepEqual(error.photo, { id: 'photo-1', uri: 'file:///cache.jpg', slot: 0 });
  assert.equal(nextPhotoSlot(error.session), 0);
});

test('canceled stale timer cannot capture or unlock an immediately restarted run', async () => {
  const oldTimer = deferred<void>(), newTimer = deferred<void>();
  let waits = 0, captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }), save,
    wait: () => ++waits === 1 ? oldTimer.promise : waits === 2 ? newTimer.promise : Promise.resolve(), isActive: () => true, onEvent: () => {} });
  const old = runner.run(fresh(), { seconds: 2 });
  assert.equal(runner.cancel(), true);
  const next = runner.run(fresh(), { seconds: 2 });
  oldTimer.resolve(); await old;
  assert.equal(captures, 0);
  assert.equal(runner.isBusy(), true);
  newTimer.resolve(); await next;
  assert.equal(captures, 5);
});

test('background interruption finishes an exposed original and resumes at the first unsaved slot', async () => {
  const pending = deferred<Session>();
  const events: CaptureRunEvent<Session>[] = [];
  let active = true, captures = 0, saves = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }),
    save: async (session, photo) => ++saves === 1 ? pending.promise : save(session, photo), wait: async () => {}, isActive: () => active, onEvent: event => events.push(event) });
  const run = runner.run(fresh(), { seconds: 2 }); await flush();
  active = false; runner.interrupt();
  assert.equal(runner.isBusy(), true, 'A photo already exposed must finish its durable save');
  const persisted = await save(fresh(), { id: 'photo-1', uri: 'file:///cache.jpg', slot: 0 });
  pending.resolve(persisted); await run;
  assert.equal(captures, 1);
  assert.ok(events.some(event => event.kind === 'saved'));
  assert.equal(nextPhotoSlot(persisted), 1);
  active = true; await runner.run(persisted, { seconds: 2 });
  assert.equal(captures, 5);
});

test('individual retake replaces only the selected slot after its durable save', async () => {
  let session = fresh();
  for (let slot = 0; slot < 5; slot++) session = await save(session, { id: `old-${slot}`, uri: 'file:///cache.jpg', slot });
  const events: CaptureRunEvent<Session>[] = [];
  let captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => { captures++; return { id: 'retake-2', uri: 'file:///retake.jpg' }; }, save,
    wait: async () => {}, isActive: () => true, onEvent: event => events.push(event) });
  await runner.run(session, { seconds: 5, retakeSlot: 2 });
  const done = events.find(event => event.kind === 'done');
  assert.ok(done?.kind === 'done');
  assert.equal(done.retake, true);
  assert.equal(captures, 1);
  assert.deepEqual(done.session.shots.map(shot => shot.id), ['old-0', 'old-1', 'retake-2', 'old-3', 'old-4']);
});

test('resumption and completion require five unique durable selections, not five arbitrary records', async () => {
  const session = fresh();
  assert.equal(screenForSession(null), 'attract');
  assert.equal(screenForSession(session), 'camera');
  const valid = { ...session, shots: Array.from({ length: 5 }, (_, shotIndex) => ({ id: `p${shotIndex}`, shotIndex, fileUri: 'file:///photo.jpg' })) };
  assert.equal(screenForSession(valid), 'review');
  assert.equal(screenForSession({ ...valid, confirmed: true }), 'share');
  assert.equal(sessionIsComplete({ ...valid, shots: valid.shots.map(shot => ({ ...shot, id: 'duplicate' })) }), false);
  assert.equal(sessionIsComplete({ ...valid, shots: valid.shots.map(shot => ({ ...shot, shotIndex: 0 })) }), false);
  const confirmed = createSessionCaptureRunner<Session>({ capture: async () => { throw new Error('must not capture'); }, save, wait: async () => {}, isActive: () => true, onEvent: () => {} });
  await confirmed.run({ ...valid, confirmed: true }, { seconds: 3 });
  assert.equal(confirmed.isBusy(), false);
});


test('the host countdown is used exactly and unsupported values cannot start capture', async () => {
  const events: CaptureRunEvent<Session>[] = [];
  let captures = 0;
  const initial = await save(fresh(), { id: 'original', uri: 'file:///original.jpg', slot: 0 });
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `retake-${++captures}`, uri: 'file:///retake.jpg' }), save,
    wait: async () => {}, isActive: () => true, onEvent: event => events.push(event) });
  await runner.run(initial, { seconds: 10, retakeSlot: 0 });
  assert.deepEqual(events.filter(event => event.kind === 'countdown').map(event => event.remaining), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(captures, 1);
  await assert.rejects(runner.run(initial, { seconds: 4 }), /Unsupported countdown/);
  assert.equal(captures, 1);
  assert.equal(runner.isBusy(), false);
});

test('four automatic photos use five seconds first then three, without a hidden intershot gap', async () => {
  let now = 0;
  const exposures: number[] = [], waits: number[] = [];
  const ticks: { slot: number; remaining: number; at: number }[] = [];
  const runner = createSessionCaptureRunner<Session>({
    capture: async slot => { exposures.push(now); return { id: `photo-${slot}`, uri: 'file:///cache.jpg' }; },
    save, wait: async milliseconds => { waits.push(milliseconds); now += milliseconds; },
    isActive: () => true, isCameraReady: () => true,
    onEvent: event => { if (event.kind === 'countdown') ticks.push({ slot: event.slot, remaining: event.remaining, at: now }); },
  });
  await runner.run(fresh(4), { timing: { ...DEFAULT_CAPTURE_TIMING } });
  assert.deepEqual(exposures, [5_000, 8_000, 11_000, 14_000]);
  assert.deepEqual(ticks.filter(tick => tick.remaining === (tick.slot === 0 ? 5 : 3)).map(tick => [tick.slot, tick.at]), [[0, 0], [1, 5_000], [2, 8_000], [3, 11_000]]);
  assert.deepEqual(waits, Array(14).fill(1_000));
  assert.equal(runner.isBusy(), false);
});

test('starting locks first/next values and retake selection against rapid caller edits', async () => {
  const timing: CaptureTiming = { firstSeconds: 8, nextSeconds: 2 };
  const options: { timing: CaptureTiming; retakeSlot?: number } = { timing };
  const starts: number[] = [], slots: number[] = [];
  let lastSlot = -1, doneRetake: boolean | undefined;
  const runner = createSessionCaptureRunner<Session>({ capture: async slot => { slots.push(slot); return { id: `photo-${slot}`, uri: 'file:///cache.jpg' }; }, save,
    wait: async () => {}, isActive: () => true,
    onEvent: event => {
      if (event.kind === 'countdown' && event.slot !== lastSlot) { lastSlot = event.slot; starts.push(event.remaining); }
      if (event.kind === 'done') doneRetake = event.retake;
    },
  });
  // The final edit before Start is honored; edits after invocation are isolated.
  timing.firstSeconds = 5; timing.nextSeconds = 3;
  const run = runner.run(fresh(4), options);
  timing.firstSeconds = 2; timing.nextSeconds = 10; options.retakeSlot = 3;
  await runner.run(fresh(4), { timing: { firstSeconds: 10, nextSeconds: 10 } });
  await run;
  assert.deepEqual(starts, [5, 3, 3, 3]);
  assert.deepEqual(slots, [0, 1, 2, 3]);
  assert.equal(doneRetake, false);
});

test('the subsequent countdown waits for both durable persistence and camera readiness', async () => {
  const pendingSave = deferred<Session>(), pendingReady = deferred<void>();
  const events: CaptureRunEvent<Session>[] = [];
  let ready = true, captures = 0, saves = 0, readinessWaits = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }),
    save: async (session, photo) => {
      if (++saves === 1) { ready = false; return pendingSave.promise; }
      return save(session, photo);
    },
    wait: milliseconds => milliseconds === 50 && ++readinessWaits === 1 ? pendingReady.promise : Promise.resolve(),
    isActive: () => true, isCameraReady: () => ready, onEvent: event => events.push(event),
  });
  const initial = fresh(4), run = runner.run(initial, { timing: { firstSeconds: 5, nextSeconds: 3 } });
  await flush();
  assert.equal(captures, 1);
  assert.equal(events.filter(event => event.kind === 'countdown').length, 5);
  assert.equal(events.some(event => event.kind === 'saved'), false);
  pendingSave.resolve(await save(initial, { id: 'photo-1', slot: 0, uri: 'file:///cache.jpg' }));
  await flush();
  assert.ok(events.some(event => event.kind === 'saved'));
  assert.ok(events.some(event => event.kind === 'preparing' && event.slot === 1));
  assert.equal(events.some(event => event.kind === 'countdown' && event.slot === 1), false);
  ready = true; pendingReady.resolve(); await run;
  assert.equal(captures, 4);
  const nextCountdown = events.find(event => event.kind === 'countdown' && event.slot === 1);
  assert.ok(nextCountdown?.kind === 'countdown');
  assert.equal(nextCountdown.remaining, 3);
});

test('a paused save still completes but a resumed sequence starts its preparation timer again', async () => {
  const pending = deferred<Session>();
  const events: CaptureRunEvent<Session>[] = [];
  let active = true, captures = 0, saves = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }),
    save: async (session, photo) => ++saves === 1 ? pending.promise : save(session, photo),
    wait: async () => {}, isActive: () => active, onEvent: event => events.push(event),
  });
  const initial = fresh(4), run = runner.run(initial, { timing: { firstSeconds: 5, nextSeconds: 3 } });
  await flush(); active = false; runner.interrupt();
  assert.equal(runner.isBusy(), true);
  assert.equal(runner.cancel(), false, 'An exposed photo must finish its durable copy');
  const persisted = await save(initial, { id: 'photo-1', slot: 0, uri: 'file:///cache.jpg' });
  pending.resolve(persisted); await run;
  assert.equal(captures, 1);
  assert.ok(events.some(event => event.kind === 'saved'));
  active = true; await runner.run(persisted, { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.equal(captures, 4);
  for (const [slot, duration] of [[0, 5], [1, 5], [2, 3], [3, 3]]) {
    const countdown = events.find(event => event.kind === 'countdown' && event.slot === slot);
    assert.ok(countdown?.kind === 'countdown');
    assert.equal(countdown.remaining, duration);
  }
});

test('an individual four-photo retake uses preparation time and preserves the other selections', async () => {
  let initial = fresh(4);
  for (let slot = 0; slot < 4; slot++) initial = await save(initial, { id: `original-${slot}`, slot, uri: 'file:///original.jpg' });
  const events: CaptureRunEvent<Session>[] = [];
  const options = { timing: { firstSeconds: 8, nextSeconds: 2 } as CaptureTiming, retakeSlot: 2 };
  let captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => { captures++; return { id: 'retake', uri: 'file:///retake.jpg' }; }, save,
    wait: async () => {}, isActive: () => true,
    onEvent: event => { events.push(event); options.retakeSlot = 0; },
  });
  await runner.run(initial, options);
  assert.equal(captures, 1);
  assert.deepEqual(events.filter(event => event.kind === 'countdown').map(event => event.remaining), [8, 7, 6, 5, 4, 3, 2, 1]);
  const done = events.find(event => event.kind === 'done');
  assert.ok(done?.kind === 'done');
  assert.equal(done.retake, true);
  assert.deepEqual(done.session.shots.map(shot => shot.id), ['original-0', 'original-1', 'retake', 'original-3']);
});

test('canceling camera preparation never lets its stale continuation affect the restarted run', async () => {
  const oldReady = deferred<void>(), newCountdown = deferred<void>();
  let ready = false, captures = 0, readinessWaits = 0, countdownWaits = 0;
  const events: CaptureRunEvent<Session>[] = [];
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }), save,
    wait: milliseconds => milliseconds === 50 && ++readinessWaits === 1 ? oldReady.promise
      : milliseconds === 1_000 && ++countdownWaits === 1 ? newCountdown.promise : Promise.resolve(),
    isActive: () => true, isCameraReady: () => ready, onEvent: event => events.push(event),
  });
  const old = runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.equal(events[0]?.kind, 'preparing');
  assert.equal(runner.cancel(), true);
  ready = true;
  const next = runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  oldReady.resolve(); await old;
  assert.equal(captures, 0);
  assert.equal(runner.isBusy(), true);
  assert.equal(events.filter(event => event.kind === 'paused').length, 1);
  newCountdown.resolve(); await next;
  assert.equal(captures, 4);
});

test('camera readiness timeout is bounded and cannot start a countdown or exposure', async () => {
  const events: CaptureRunEvent<Session>[] = [];
  let waited = 0, captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => { captures++; return { id: 'bad', uri: 'file:///cache.jpg' }; }, save,
    wait: async milliseconds => { waited += milliseconds; }, isActive: () => true, isCameraReady: () => false,
    onEvent: event => events.push(event),
  });
  await runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.equal(waited, 10_000);
  assert.equal(captures, 0);
  assert.equal(events.some(event => event.kind === 'countdown' || event.kind === 'saved' || event.kind === 'done'), false);
  const error = events.find(event => event.kind === 'error');
  assert.ok(error?.kind === 'error');
  assert.match(String(error.error), /camera is not ready/);
  assert.equal(error.photo, undefined);
  assert.equal(runner.isBusy(), false);
});

test('lost readiness during countdown pauses without capture and restart gets preparation time', async () => {
  let ready = true, waits = 0, captures = 0;
  const events: CaptureRunEvent<Session>[] = [];
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }), save,
    wait: async () => { if (++waits === 1) ready = false; }, isActive: () => true, isCameraReady: () => ready,
    onEvent: event => events.push(event),
  });
  await runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.equal(captures, 0);
  assert.equal(events.at(-1)?.kind, 'paused');
  ready = true; events.length = 0;
  await runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.equal(events.find(event => event.kind === 'countdown')?.remaining, 5);
  assert.equal(captures, 4);
});

test('inactive entry and invalid independent timing values cannot capture', async () => {
  let active = false, captures = 0;
  const events: CaptureRunEvent<Session>[] = [];
  const runner = createSessionCaptureRunner<Session>({ capture: async () => { captures++; return { id: 'bad', uri: 'file:///cache.jpg' }; }, save,
    wait: async () => {}, isActive: () => active, onEvent: event => events.push(event),
  });
  await runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  assert.deepEqual(events.map(event => event.kind), ['paused']);
  assert.equal(captures, 0);
  active = true;
  for (const timing of [{ firstSeconds: 4, nextSeconds: 3 }, { firstSeconds: 5, nextSeconds: 4 }, { firstSeconds: NaN, nextSeconds: 3 }]) {
    await assert.rejects(runner.run(fresh(4), { timing: timing as CaptureTiming }), /Unsupported countdown/);
  }
  assert.equal(captures, 0);
  assert.equal(runner.isBusy(), false);
});

test('a canceled timer rejection cannot report a stale failure over a restarted sequence', async () => {
  const oldWait = deferred<void>(), newWait = deferred<void>();
  const events: CaptureRunEvent<Session>[] = [];
  let waits = 0, captures = 0;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: `photo-${++captures}`, uri: 'file:///cache.jpg' }), save,
    wait: () => ++waits === 1 ? oldWait.promise : waits === 2 ? newWait.promise : Promise.resolve(),
    isActive: () => true, onEvent: event => events.push(event),
  });
  const old = runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  runner.cancel();
  const next = runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  oldWait.reject(new Error('Old native timer interrupted')); await old;
  assert.equal(events.some(event => event.kind === 'error'), false);
  assert.equal(runner.isBusy(), true);
  newWait.resolve(); await next;
  assert.equal(captures, 4);
});

test('an exposed photo failure after backgrounding still reports its retained source for retry', async () => {
  const pending = deferred<Session>();
  const events: CaptureRunEvent<Session>[] = [];
  let active = true;
  const runner = createSessionCaptureRunner<Session>({ capture: async () => ({ id: 'retained', uri: 'file:///exposed-original.jpg' }), save: async () => pending.promise,
    wait: async () => {}, isActive: () => active, onEvent: event => events.push(event),
  });
  const run = runner.run(fresh(4), { timing: { firstSeconds: 5, nextSeconds: 3 } });
  await flush(); active = false; runner.interrupt();
  assert.equal(runner.isBusy(), true);
  pending.reject(new Error('Disk full during durable copy')); await run;
  const error = events.find(event => event.kind === 'error');
  assert.ok(error?.kind === 'error');
  assert.deepEqual(error.photo, { id: 'retained', uri: 'file:///exposed-original.jpg', slot: 0 });
  assert.equal(events.some(event => event.kind === 'done' || event.kind === 'saved'), false);
  assert.equal(runner.isBusy(), false);
});
