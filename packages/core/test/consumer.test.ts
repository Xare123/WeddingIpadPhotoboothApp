import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueConsumer, uploadJob, type QueueJob, type QueueStore, type QueueTransport } from '../src/index';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function memoryStore(job: QueueJob): QueueStore {
  let value = structuredClone(job);
  return {
    async list() { return [structuredClone(value)]; },
    async save(next) { value = structuredClone(next); },
  };
}
const original = uploadJob('photo-one', 'file:///documents/photo-one.jpg', 100);
const guest = { guestUrl: `https://photobooth.example/g/${'a'.repeat(64)}`, guestExpiresAt: 90_000 };

test('timer sync cannot race a paused manual retry reset or overwrite completed readiness', async () => {
  const memory = memoryStore({ ...original, nextAttemptAt: 10_000 });
  const entered = deferred(), release = deferred();
  let uploads = 0;
  const store: QueueStore = {
    list: () => memory.list(),
    async save(job) {
      if (job.state === 'pending' && job.nextAttemptAt === 0) {
        entered.resolve();
        await release.promise;
      }
      await memory.save(job);
    },
  };
  const transport: QueueTransport = {
    async upload() { uploads++; return guest; },
    async share() { return 'mocked'; },
  };
  const consumer = createQueueConsumer(store, transport, undefined, () => 100);
  const retry = consumer.retry();
  await entered.promise;
  const timer = consumer.sync();
  assert.strictEqual(timer, retry);
  assert.strictEqual(consumer.retry(), retry);
  assert.equal(uploads, 0);
  release.resolve();
  await Promise.all([retry, timer]);
  assert.equal(uploads, 1);
  const saved = (await memory.list())[0]!;
  assert.equal(saved.state, 'complete');
  assert.equal(saved.guestUrl, guest.guestUrl);
  assert.equal(saved.guestExpiresAt, guest.guestExpiresAt);
});

test('retry queued during upload observes its durable completion and cannot resend it', async () => {
  const store = memoryStore(original);
  const entered = deferred(), release = deferred();
  let uploads = 0, cleanups = 0;
  const consumer = createQueueConsumer(store, {
    async upload() { uploads++; entered.resolve(); await release.promise; return guest; },
    async share() { return 'mocked'; },
  }, async () => { cleanups++; }, () => 100);
  const initial = consumer.sync();
  await entered.promise;
  const retry = consumer.retry();
  assert.notStrictEqual(initial, retry);
  assert.strictEqual(consumer.sync(), retry);
  release.resolve();
  await Promise.all([initial, retry]);
  assert.equal(uploads, 1);
  assert.equal(cleanups, 2);
  assert.equal((await store.list())[0]?.state, 'complete');
  assert.equal((await store.list())[0]?.guestUrl, guest.guestUrl);
});

test('a failed reset releases the reservation without upload or recipient cleanup', async () => {
  const memory = memoryStore(original);
  let fail = true, uploads = 0, cleanups = 0;
  const consumer = createQueueConsumer({
    list: () => memory.list(),
    async save(job) { if (fail) { fail = false; throw new Error('Storage unavailable'); } await memory.save(job); },
  }, {
    async upload() { uploads++; return guest; },
    async share() { return 'mocked'; },
  }, async () => { cleanups++; }, () => 100);
  await assert.rejects(consumer.retry(), /Storage unavailable/);
  assert.equal(uploads, 0);
  assert.equal(cleanups, 0);
  await consumer.retry();
  assert.equal(uploads, 1);
  assert.equal(cleanups, 1);
  assert.equal((await memory.list())[0]?.state, 'complete');
});
