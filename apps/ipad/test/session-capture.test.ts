/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCaptureRunner, nextPhotoSlot, screenForSession, sessionIsComplete, type CaptureRunEvent, type CaptureSession, type PendingPhoto } from '../src/session-capture';

type Session = Omit<CaptureSession, 'shots'> & { shots: { id: string; shotIndex: number; fileUri: string }[] };
const fresh = (): Session => ({ id: 'session-1', targetCount: 5, shots: [], confirmed: false });
const save = async (session: Session, photo: PendingPhoto): Promise<Session> => ({ ...session,
  shots: [...session.shots.filter(shot => shot.shotIndex !== photo.slot), { id: photo.id, shotIndex: photo.slot, fileUri: `file:///durable/${photo.id}.jpg` }].sort((a, b) => a.shotIndex - b.shotIndex),
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

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
