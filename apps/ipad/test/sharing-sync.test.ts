import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueConsumer, drainQueue, uploadJob, QueuePreconditionError, QueueRequestFailure, type QueueJob, type QueueStore } from '@wedding-booth/core';
import { createConnectionPreflight, expirePendingShares } from '../src/sync-preflight';
import { performSharingRequest, sharingResponseJson, sharingReadyResponse } from '../src/sharing-request';
import { finalizeReadySessions } from '../src/session-sync';
import { parseQueuePayload } from '../src/queue-index';
import { sessionGuestPage } from '../src/sharing';
import type { ConnectionConfig } from '../src/sharing';

function memory(initial: QueueJob[]) {
  const rows = new Map(initial.map(job => [job.id, structuredClone(job)])); let saves = 0;
  const store: QueueStore = { async list() { return [...rows.values()].map(job => structuredClone(job)); },
    async save(job) { saves++; rows.set(job.id, structuredClone(job)); } };
  return { store, get saves() { return saves; } };
}
const job = () => ({ ...uploadJob('photo', 'file:///documents/photo.jpg', 1, 'session'), attempts: 15, nextAttemptAt: 9000 });
const config: ConnectionConfig = { origin: 'https://photos.example', token: 'synthetic-test-only-token' };

test('absent, invalid or unreadable private settings never reset or drain upload jobs while local maintenance still runs', async () => {
  for (const read of [async () => null, async () => { throw new Error('private Keychain details'); }, async () => ({ ...config, token: '' })]) {
    const f = memory([job(), { ...job(), id: 'done', photoId: 'done', state: 'complete' }]);
    const original = await f.store.list(); const preflight = createConnectionPreflight(read);
    let maintenance = 0, uploads = 0, after = 0;
    const consumer = createQueueConsumer(f.store, { async upload() { uploads++; }, async share() { return 'mocked'; } },
      async () => { after++; }, () => 100, async () => { maintenance++; }, () => preflight.check());
    await consumer.sync(); await consumer.retry();
    assert.equal(maintenance, 2); assert.equal(uploads, 0); assert.equal(after, 0); assert.equal(f.saves, 0);
    assert.deepEqual(await f.store.list(), original); assert.equal(preflight.current(), null);
  }
});
test('unpaired local maintenance can repair a missing index row without attempting an upload or modifying existing history', async () => {
  const f = memory([job()]); let uploads = 0;
  const preflight = createConnectionPreflight(async () => null);
  const consumer = createQueueConsumer(f.store, { async upload() { uploads++; }, async share() { return 'mocked'; } }, undefined,
    () => 100, async () => { if (!(await f.store.list()).some(j => j.id === 'repaired')) await f.store.save(uploadJob('repaired', 'file:///documents/repaired.jpg', 1, 'session')); }, () => preflight.check());
  await consumer.retry(); assert.equal(uploads, 0);
  assert.deepEqual((await f.store.list()).find(j => j.id === 'photo'), job());
  assert.equal((await f.store.list()).find(j => j.id === 'repaired')?.attempts, 0);
});
test('a newly paired pass snapshots one connection, resumes exact pending identities and never replays completed uploads', async () => {
  let paired = false, reads = 0; const supplied = { ...config };
  const preflight = createConnectionPreflight(async () => { reads++; return paired ? supplied : null; });
  const f = memory([job(), { ...job(), id: 'done', photoId: 'done', state: 'complete' }]); const calls: string[] = [];
  const consumer = createQueueConsumer(f.store, { async upload(value) { calls.push(value.id); assert.equal(preflight.current()?.origin, config.origin); }, async share() { return 'mocked'; } }, undefined, () => 100, undefined, () => preflight.check());
  await consumer.retry(); assert.deepEqual(calls, []); paired = true; await consumer.retry();
  assert.deepEqual(calls, ['photo']); assert.equal(reads, 2);
  const saved = (await f.store.list()).find(j => j.id === 'photo')!;
  assert.equal(saved.state, 'complete'); assert.equal(saved.attempts, 15);
  supplied.token = 'changed-after-preflight'; assert.equal(preflight.current()?.token, config.token);
});
test('local precondition failure is deferred without attempts, diagnostic or completion changes', async () => {
  const f = memory([{ ...job(), nextAttemptAt: 0 }]); const before = await f.store.list();
  await drainQueue(f.store, { async upload() { throw new QueuePreconditionError(); }, async share() { return 'mocked'; } }, 100);
  assert.deepEqual(await f.store.list(), before); assert.equal(f.saves, 0);
});
test('expired recipient requests are closed locally even while unpaired; upload attempts and files are untouched', async () => {
  const upload = { ...job(), state: 'complete' as const, guestExpiresAt: 50 };
  const share: QueueJob = { id: 'share', kind: 'share', photoId: upload.id, sessionId: upload.sessionId, uploadJobId: upload.id,
    recipientRef: 'synthetic-reference', consentedAt: 1, createdAt: 1, attempts: 15, nextAttemptAt: 9000, state: 'pending', guestExpiresAt: 50 };
  const f = memory([upload, share]); await expirePendingShares(f.store, 100);
  assert.deepEqual((await f.store.list())[0], upload);
  assert.deepEqual((await f.store.list())[1], { ...share, state: 'expired' });
});
test('only fixed diagnostic categories and HTTP statuses survive an invoked request failure with injected fetch', async () => {
  const cases = [[401, 'authorization'], [403, 'authorization'], [429, 'rate-limited'], [503, 'server'], [409, 'http']] as const;
  for (const [status, category] of cases) {
    const f = memory([{ ...job(), nextAttemptAt: 0 }]); let fetchCalls = 0;
    await drainQueue(f.store, { async upload() { await performSharingRequest('upload', async () => { fetchCalls++; return new Response('private body must never persist', { status }); }); }, async share() { return 'mocked'; } }, 100);
    const saved = (await f.store.list())[0]!;
    assert.equal(fetchCalls, 1); assert.equal(saved.state, 'pending'); assert.equal(saved.attempts, 16);
    assert.deepEqual(saved.lastFailure, { operation: 'upload', category, at: 100, httpStatus: status });
    const restored = parseQueuePayload(JSON.stringify(saved), saved.id); assert.deepEqual(restored, saved);
    assert.doesNotMatch(JSON.stringify(saved), /private body|Sharing request/);
  }
});
test('fetch rejection stores no raw exception or contacts and does not claim an offline diagnosis', async () => {
  const f = memory([{ ...job(), nextAttemptAt: 0 }]); let fetchCalls = 0;
  await drainQueue(f.store, { async upload() { await performSharingRequest('upload', async () => { fetchCalls++; throw new Error('https://private.example/g/private-cap Bearer secret +15555550123'); }); }, async share() { return 'mocked'; } }, 100);
  const saved = (await f.store.list())[0]!;
  assert.equal(fetchCalls, 1); assert.deepEqual(saved.lastFailure, { operation: 'upload', category: 'network', at: 100 });
  assert.doesNotMatch(JSON.stringify(saved), /private-cap|Bearer|15555550123|private.example|offline/);
});
test('local preparation errors and historical attempt counters never manufacture a request diagnostic', async () => {
  const f = memory([{ ...job(), nextAttemptAt: 0 }]); let fetchCalls = 0;
  await drainQueue(f.store, { async upload() { throw new Error('File read failed before fetch'); }, async share() { fetchCalls++; return 'mocked'; } }, 100);
  const saved = (await f.store.list())[0]!;
  assert.equal(fetchCalls, 0); assert.equal(saved.attempts, 16); assert.equal(saved.lastFailure, undefined);
});
test('invalid response bodies are classified without persisting body content; a successful retry clears the old diagnostic', async () => {
  const f = memory([{ ...job(), nextAttemptAt: 0 }]);
  await drainQueue(f.store, { async upload() { const r = await performSharingRequest('upload', async () => new Response('private malformed body')); await sharingResponseJson(r, 'upload'); }, async share() { return 'mocked'; } }, 100);
  const failed = (await f.store.list())[0]!;
  assert.deepEqual(failed.lastFailure, { operation: 'upload', category: 'invalid-response', at: 100, httpStatus: 200 });
  await drainQueue(f.store, { async upload() { await performSharingRequest('upload', async () => new Response(null, { status: 201 })); }, async share() { return 'mocked'; } }, failed.nextAttemptAt);
  const done = (await f.store.list())[0]!; assert.equal(done.state, 'complete'); assert.equal(done.attempts, 16); assert.equal(done.lastFailure, undefined);
});
test('an untrusted persisted diagnostic is discarded or reduced to its fixed vocabulary without losing completed state/history', () => {
  const complete = { ...job(), state: 'complete' };
  const value = { operation: 'ready', category: 'authorization', at: 100, httpStatus: 401, error: 'private body', url: 'private capability', phone: 'private recipient' };
  const safe = parseQueuePayload(JSON.stringify({ ...complete, lastFailure: value }), complete.id)!;
  assert.equal(safe.state, 'complete'); assert.equal(safe.attempts, 15);
  assert.deepEqual(safe.lastFailure, { operation: 'ready', category: 'authorization', at: 100, httpStatus: 401 });
  for (const bad of [{ ...value, category: 'private URL here' }, { ...value, at: -1 }, { ...value, httpStatus: 1000 }]) {
    const parsed = parseQueuePayload(JSON.stringify({ ...complete, lastFailure: bad }), complete.id)!;
    assert.equal(parsed.lastFailure, undefined); assert.equal(parsed.state, 'complete'); assert.equal(parsed.attempts, 15);
  }
});
test('an injected ready HTTP refusal preserves completed upload acknowledgements; retry uses only ready and clears diagnostics after exact success', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const session = { id: 'session', confirmed: true, targetCount: 5, shots: ids.map(id => ({ id, sessionId: 'session' })) };
  const f = memory(ids.map(id => ({ ...uploadJob(id, `file:///documents/${id}.jpg`, 1, session.id), state: 'complete', attempts: 15, nextAttemptAt: 9000 })));
  const before = await f.store.list(); let requests = 0, allowed = false;
  const ports = { store: f.store, async sessions() { return [session]; }, async ready(_id: string, photoIds: string[]) {
    const response = await performSharingRequest('ready', async () => { requests++; return allowed ? Response.json({ status: 'ready', url: 'https://photos.example/g/synthetic', expiresAt: Date.now() + 60000 }) : new Response('private refusal', { status: 401 }); });
    return { value: await sharingReadyResponse(response, { photoIds }, config.origin), origin: config.origin };
  } };
  await finalizeReadySessions(ports, 100);
  for (const saved of await f.store.list()) {
    assert.equal(saved.state, 'complete'); assert.equal(saved.attempts, 15); assert.equal(saved.nextAttemptAt, 9000); assert.equal(saved.guestUrl, undefined);
    assert.deepEqual(saved.lastFailure, { operation: 'ready', category: 'authorization', at: 100, httpStatus: 401 });
  }
  assert.equal(sessionGuestPage(session, await f.store.list(), 100), null);
  allowed = true; await finalizeReadySessions(ports, 100);
  assert.equal(requests, 2); assert(sessionGuestPage(session, await f.store.list(), 100));
  for (const saved of await f.store.list()) { assert.equal(saved.lastFailure, undefined); assert.equal(saved.state, 'complete'); assert.equal(saved.attempts, before[0]!.attempts); }
});
test('received readiness response cannot expose an arbitrary, expired or malformed URL as an acknowledged link', async () => {
  for (const body of [{ status: 'ready', url: 'https://another.example/g/private', expiresAt: Date.now() + 60000 },
    { status: 'ready', url: 'https://photos.example/g/private', expiresAt: 1 }, { status: 'ready' }]) {
    await assert.rejects(sharingReadyResponse(Response.json(body), { photoIds: ['a', 'b', 'c', 'd', 'e'] }, config.origin),
      error => error instanceof QueueRequestFailure && error.category === 'invalid-response' && error.httpStatus === 200);
  }
});
test('a failed diagnostic write cannot fabricate a QR, reset completed jobs, or abort readiness for unrelated sessions', async () => {
  const session = { id: 'session', confirmed: true, targetCount: 5, shots: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, sessionId: 'session' })) };
  const f = memory(session.shots.map(s => ({ ...uploadJob(s.id, `file:///documents/${s.id}.jpg`, 1, session.id), state: 'complete', attempts: 15 })));
  const before = await f.store.list();
  await finalizeReadySessions({ store: { list: () => f.store.list(), async save() { throw new Error('DB write interrupted'); } },
    async sessions() { return [session]; }, async ready() { throw new QueueRequestFailure('ready', 'authorization', 401); } }, 100);
  assert.deepEqual(await f.store.list(), before); assert.equal(sessionGuestPage(session, await f.store.list(), 100), null);
});
