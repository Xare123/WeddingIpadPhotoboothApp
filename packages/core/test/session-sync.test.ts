import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadJob, type QueueJob, type QueueStore } from '../src/index';
import { finalizeReadySessions, type ShareableSession } from '../../../apps/ipad/src/session-sync';
import { sessionGuestPage } from '../../../apps/ipad/src/sharing';

const origin = 'https://photos.gizelleandrami.com';
const url = `${origin}/g/${'f'.repeat(64)}`;
const session: ShareableSession = { id: 'session', confirmed: true, shots: Array.from({ length: 5 }, (_, i) => ({ id: `photo-${i}` })) };
function store(initial: QueueJob[]): QueueStore {
  const rows = new Map(initial.map(job => [job.id, structuredClone(job)]));
  return { async list() { return [...rows.values()].map(job => structuredClone(job)); }, async save(job) { rows.set(job.id, structuredClone(job)); } };
}
const jobs = (): QueueJob[] => session.shots.map(s => ({ ...uploadJob(s.id, `file:///documents/${s.id}.jpg`, 1, session.id), state: 'complete' }));
const ready = { status: 'ready', url, expiresAt: 2000 };

test('a five-shot session has no QR until every selected upload and the complete gallery are acknowledged', async () => {
  const queue = store(jobs()); let finalizations = 0;
  assert.equal(sessionGuestPage(session, await queue.list(), 1000), null);
  await finalizeReadySessions({ store: queue, async sessions() { return [session]; }, async ready(id, ids) {
    finalizations++; assert.equal(id, session.id); assert.deepEqual(ids, session.shots.map(s => s.id)); return { value: ready, origin };
  } }, 1000);
  assert.deepEqual(sessionGuestPage(session, await queue.list(), 1000), { url, expiresAt: 2000 });
  await finalizeReadySessions({ store: queue, async sessions() { return [session]; }, async ready() { finalizations++; throw new Error('must not repeat'); } }, 1000);
  assert.equal(finalizations, 1);
});

test('unconfirmed, incomplete, duplicate and still-pending selected sessions cannot finalize', async () => {
  for (const candidate of [{ ...session, confirmed: false }, { ...session, shots: session.shots.slice(0, 4) },
    { ...session, shots: [session.shots[0]!, ...session.shots.slice(0, 4)] }]) {
    await finalizeReadySessions({ store: store(jobs()), async sessions() { return [candidate]; }, async ready() { assert.fail('premature ready'); } }, 1000);
  }
  const pending = jobs(); pending[4] = { ...pending[4]!, state: 'pending' };
  await finalizeReadySessions({ store: store(pending), async sessions() { return [session]; }, async ready() { assert.fail('fifth upload pending'); } }, 1000);
  assert.equal(sessionGuestPage(session, pending, 1000), null);
});

test('retake selection and session identity exclude acknowledged old shots and another session', async () => {
  const selected = { ...session, shots: [...session.shots.slice(0, 4), { id: 'retake' }] };
  const queue = store([...jobs(), { ...uploadJob('retake', 'file:///documents/retake.jpg', 1, 'different-session'), state: 'complete' }]);
  await finalizeReadySessions({ store: queue, async sessions() { return [selected]; }, async ready() { assert.fail('wrong session/old retake cannot count'); } }, 1000);
  assert.equal(sessionGuestPage(selected, await queue.list(), 1000), null);
});

test('failed readiness preserves all originals/upload acknowledgements, then idempotently resumes after restart', async () => {
  const queue = store(jobs());
  await finalizeReadySessions({ store: queue, async sessions() { return [session]; }, async ready() { throw new Error('private provider error'); } }, 1000);
  assert.equal(sessionGuestPage(session, await queue.list(), 1000), null);
  assert((await queue.list()).every(job => job.state === 'complete' && job.kind === 'upload' && job.fileUri.startsWith('file://')));
  const restarted = store(JSON.parse(JSON.stringify(await queue.list())));
  await finalizeReadySessions({ store: restarted, async sessions() { return [session]; }, async ready() { return { value: ready, origin }; } }, 1000);
  assert.deepEqual(sessionGuestPage(session, await restarted.list(), 1000), { url, expiresAt: 2000 });
});

test('interrupted readiness index writes keep QR hidden and a retry repairs the exact same manifest', async () => {
  const durable = store(jobs()); let saves = 0, fail = true;
  const queue: QueueStore = { list: durable.list, async save(job) { if (fail && ++saves === 3) throw new Error('disk error'); await durable.save(job); } };
  const ports = { store: queue, async sessions() { return [session]; }, async ready() { return { value: ready, origin }; } };
  await finalizeReadySessions(ports, 1000);
  assert.equal(sessionGuestPage(session, await queue.list(), 1000), null);
  fail = false; await finalizeReadySessions(ports, 1000);
  assert.deepEqual(sessionGuestPage(session, await queue.list(), 1000), { url, expiresAt: 2000 });
});

test('mixed, expired, local or partially acknowledged gallery identities never produce a session QR', () => {
  const complete = jobs().map(job => ({ ...job, guestUrl: url, guestExpiresAt: 2000 }));
  assert.equal(sessionGuestPage(session, complete, 2000), null);
  for (const change of [{ guestUrl: `${origin}/g/${'e'.repeat(64)}` }, { guestExpiresAt: 3000 }, { state: 'pending' as const }, { guestUrl: 'http://127.0.0.1:8787/g/token' }]) {
    const mixed = [...complete]; mixed[4] = { ...mixed[4]!, ...change };
    assert.equal(sessionGuestPage(session, mixed, 1000), null);
  }
});
