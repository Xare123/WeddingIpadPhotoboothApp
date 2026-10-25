import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainQueue, uploadJob, type QueueJob, type QueueStore, type QueueTransport } from '../src/index';

function memoryStore(initial: QueueJob[] = []): QueueStore {
  const rows = new Map(initial.map(job => [job.id, structuredClone(job)]));
  return {
    async list() { return [...rows.values()].map(job => structuredClone(job)); },
    async save(job) { rows.set(job.id, structuredClone(job)); },
  };
}
const upload = uploadJob('photo-1', 'file:///documents/photo-1.jpg', 100, 'session-1');
const share: QueueJob = { id: 'share-1', photoId: upload.photoId, sessionId: 'session-1', kind: 'share',
  uploadJobId: upload.id, recipientRef: 'keychain:share-1', consentedAt: 100,
  createdAt: 101, attempts: 0, nextAttemptAt: 101, state: 'pending' };
const success: QueueTransport = { async upload() {}, async share() { return 'accepted'; } };
const offline: QueueTransport = { async upload() { throw new Error('Wi-Fi unavailable'); }, async share() { return 'mocked'; } };

test('durable capture records session identity and rejects temporary network paths', () => {
  assert.equal(upload.kind === 'upload' && upload.sessionId, 'session-1');
  const single = uploadJob('single-photo', 'file:///documents/single.jpg', 123);
  assert.equal(single.kind === 'upload' && single.sessionId, 'single-photo');
  for (const uri of ['https://example.com/photo.jpg', 'content://temporary/photo', '', '/tmp/photo.jpg']) {
    assert.throws(() => uploadJob('id', uri));
  }
});

test('offline failure preserves durable file and secure recipient reference, with share blocked', async () => {
  const store = memoryStore([upload, share]);
  let shareCalls = 0;
  await drainQueue(store, { ...offline, async share() { shareCalls++; return 'accepted'; } }, 101);
  const jobs = await store.list();
  assert.equal(jobs[0]?.state, 'pending');
  assert.equal(jobs[0]?.attempts, 1);
  assert.equal(jobs[0]?.kind === 'upload' && jobs[0].fileUri, 'file:///documents/photo-1.jpg');
  assert.equal(jobs[0]?.kind === 'upload' && jobs[0].guestUrl, undefined);
  assert.equal(shareCalls, 0);
  assert.equal(jobs[1]?.state, 'pending');
  assert.equal(jobs[1]?.kind === 'share' && jobs[1].recipientRef, 'keychain:share-1');
  assert.ok(!JSON.stringify(jobs).includes('Wi-Fi unavailable'));
});

test('restart restores pending state, respects exact backoff boundary, and uploads before sharing', async () => {
  const first = memoryStore([upload, share]);
  await drainQueue(first, offline, 101);
  const saved = JSON.parse(JSON.stringify(await first.list())) as QueueJob[];
  const restored = memoryStore(saved);
  const calls: string[] = [];
  const online: QueueTransport = {
    async upload(job) { calls.push(job.id); return { guestUrl: 'https://gallery.example/g/opaque', guestExpiresAt: 86400100 }; },
    async share(job) { calls.push(job.id); return 'mocked'; },
  };
  const retryAt = saved[0]!.nextAttemptAt;
  await drainQueue(restored, online, retryAt - 1);
  assert.deepEqual(calls, []);
  await drainQueue(restored, online, retryAt);
  assert.deepEqual(calls, ['photo-1', 'share-1']);
  const completed = await restored.list();
  assert.deepEqual(completed.map(job => job.state), ['complete', 'mocked']);
  assert.equal(completed[0]?.kind === 'upload' && completed[0].guestUrl, 'https://gallery.example/g/opaque');
  assert.equal(completed[0]?.kind === 'upload' && completed[0].guestExpiresAt, 86400100);
  await drainQueue(restored, online, retryAt + 9999);
  assert.equal(calls.length, 2);
});

test('repeated offline attempts use exponential backoff capped at one hour', async () => {
  const store = memoryStore([upload]);
  let now = 100;
  for (let attempt = 1; attempt <= 16; attempt++) {
    await drainQueue(store, offline, now);
    const saved = (await store.list())[0]!;
    assert.equal(saved.state, 'pending');
    assert.equal(saved.attempts, attempt);
    assert.equal(saved.nextAttemptAt - now, Math.min(3_600_000, 1_000 * 2 ** Math.min(attempt, 12)));
    now = saved.nextAttemptAt;
  }
});

test('lost acknowledgement replays the same identity and keeps the capture until acceptance', async () => {
  const store = memoryStore([upload]);
  const acceptedIds = new Set<string>();
  let first = true, attempts = 0;
  const transport: QueueTransport = {
    async upload(job) {
      attempts++;
      acceptedIds.add(`${job.kind === 'upload' && job.sessionId}/${job.id}`);
      if (first) { first = false; throw new Error('Acknowledgement lost'); }
    },
    async share() { return 'mocked'; },
  };
  await drainQueue(store, transport, 100);
  const restored = memoryStore(JSON.parse(JSON.stringify(await store.list())));
  await drainQueue(restored, transport, 2100);
  assert.equal(attempts, 2);
  assert.equal(acceptedIds.size, 1);
  assert.equal((await restored.list())[0]?.state, 'complete');
});

test('an older completed upload unblocks a newly queued share after restart', async () => {
  const store = memoryStore([{ ...upload, state: 'complete' }, share]);
  let uploads = 0, shares = 0;
  await drainQueue(store, {
    async upload() { uploads++; }, async share() { shares++; return 'accepted'; },
  }, 101);
  assert.equal(uploads, 0);
  assert.equal(shares, 1);
  assert.deepEqual((await store.list()).map(job => job.state), ['complete', 'complete']);
});

test('failed upload blocks only its dependent share while unrelated jobs still progress', async () => {
  const second = uploadJob('photo-2', 'file:///documents/photo-2.jpg', 102);
  const store = memoryStore([upload, share, second]);
  const calls: string[] = [];
  await drainQueue(store, {
    async upload(job) { calls.push(job.id); if (job.id === upload.id) throw new Error('offline'); },
    async share(job) { calls.push(job.id); return 'accepted'; },
  }, 200);
  assert.deepEqual(calls, ['photo-1', 'photo-2']);
  assert.deepEqual((await store.list()).map(job => job.state), ['pending', 'pending', 'complete']);
});

test('SMS transport failures remain pending and never persist provider errors or phone numbers', async () => {
  const store = memoryStore([{ ...upload, state: 'complete' }, share]);
  await drainQueue(store, { ...success, async share() { throw new Error('Provider rejected +12025550123 secret-token'); } }, 101);
  const saved = (await store.list())[1]!;
  assert.equal(saved.state, 'pending');
  assert.equal(saved.attempts, 1);
  assert.equal(saved.nextAttemptAt, 2101);
  assert.ok(!JSON.stringify(await store.list()).includes('+12025550123'));
  assert.ok(!JSON.stringify(await store.list()).includes('secret-token'));
  await drainQueue(store, success, 2101);
  assert.equal((await store.list())[1]?.state, 'complete');
});

test('missing explicit consent or secure recipient reference never reaches SMS transport', async () => {
  for (const invalid of [{ ...share, consentedAt: 0 }, { ...share, recipientRef: '' }]) {
    const store = memoryStore([{ ...upload, state: 'complete' }, invalid]);
    let shares = 0;
    await drainQueue(store, { ...success, async share() { shares++; return 'accepted'; } }, 101);
    assert.equal(shares, 0);
    assert.equal((await store.list())[1]?.state, 'pending');
  }
});

test('completed and explicitly mocked shares cannot replay as sent', async () => {
  const store = memoryStore([{ ...upload, state: 'complete' }, { ...share, state: 'mocked' },
    { ...share, id: 'accepted-share', state: 'complete' }]);
  let calls = 0;
  await drainQueue(store, { async upload() { calls++; }, async share() { calls++; return 'accepted'; } }, 9999);
  assert.equal(calls, 0);
  assert.deepEqual((await store.list()).map(job => job.state), ['complete', 'mocked', 'complete']);
});

test('a failed local completion write keeps sharing blocked until upload acknowledgement is durable', async () => {
  const durable = memoryStore([upload, share]);
  let failed = false, shares = 0;
  const store: QueueStore = {
    list: durable.list,
    async save(job) {
      if (job.id === upload.id && job.state === 'complete' && !failed) {
        failed = true;
        throw new Error('Local disk temporarily unavailable');
      }
      await durable.save(job);
    },
  };
  const transport: QueueTransport = { async upload() {}, async share() { shares++; return 'mocked'; } };
  await drainQueue(store, transport, 101);
  assert.equal(shares, 0);
  assert.deepEqual((await store.list()).map(job => job.state), ['pending', 'pending']);
  await drainQueue(store, transport, 2101);
  assert.equal(shares, 1);
  assert.deepEqual((await store.list()).map(job => job.state), ['complete', 'mocked']);
});
