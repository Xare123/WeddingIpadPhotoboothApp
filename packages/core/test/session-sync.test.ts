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

test('a missing or staged selected original cannot silently turn a five-photo session into a four-photo QR', () => {
  const complete = jobs().map(job => ({ ...job, guestUrl: url, guestExpiresAt: 2000 }));
  assert.equal(sessionGuestPage({ ...session, targetCount: 5, shots: session.shots.slice(0, 4) }, complete, 1000), null);
  assert.deepEqual(sessionGuestPage({ ...session, targetCount: 1, shots: session.shots.slice(0, 1) }, complete, 1000), { url, expiresAt: 2000 });
});

const four: ShareableSession = {
  id: 'four', confirmed: true, targetCount: 4,
  shots: Array.from({ length: 4 }, (_, i) => ({ id: `filtered-${i}`, sourcePhotoId: `raw-${i}`, sessionId: 'four' })),
  composite: { id: 'template', fileUri: 'file:///template.jpg', originalPhotoIds: ['raw-3', 'raw-1', 'raw-0', 'raw-2'],
    recipe: { version: 'wedding-template-v1', layout: 'strip', theme: 'botanical', photoIds: ['filtered-3', 'filtered-1', 'filtered-0', 'filtered-2'],
      cropsByPhotoId: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`filtered-${i}`, { mode: 'fit' as const, x: 0, y: 0, zoom: 1 }])) } },
};
const fourJobs = (): QueueJob[] => [...four.shots.map(s => s.id), ...four.composite!.originalPhotoIds, four.composite!.id].map(id => ({
  ...uploadJob(id, `file:///${id}.jpg`, 1, four.id), state: 'complete',
}));

test('four-photo filtered template acknowledges every selected, raw and composite upload in template order', async () => {
  const queue = store(fourJobs());
  await finalizeReadySessions({ store: queue, async sessions() { return [four]; }, async ready(id, ids, descriptor) {
    assert.equal(id, four.id); assert.deepEqual(ids, four.composite!.recipe.photoIds);
    assert.deepEqual(descriptor, { photoIds: ids, originalPhotoIds: four.composite!.originalPhotoIds,
      composite: { photoId: 'template', layout: 'strip', theme: 'botanical', version: 'wedding-template-v1' } });
    return { value: { ...ready, ...descriptor }, origin };
  } }, 1000);
  assert.deepEqual(sessionGuestPage(four, await queue.list(), 1000), { url, expiresAt: 2000 });
});

test('four-photo readiness requires raw and composite completion, matching selection and lineage', async () => {
  for (const missing of ['raw-0', 'template']) {
    for (const state of ['missing', 'pending']) {
      const rows = fourJobs().flatMap(job => job.photoId !== missing ? [job] : state === 'missing' ? [] : [{ ...job, state: 'pending' as const }]);
      const queue = store(rows);
      await finalizeReadySessions({ store: queue, async sessions() { return [four]; }, async ready() { assert.fail('premature ready'); } }, 1000);
      assert.equal(sessionGuestPage(four, rows, 1000), null);
    }
  }
  const candidates = [ { ...four, composite: undefined },
    { ...four, shots: [{ ...four.shots[0]!, id: 'retake' }, ...four.shots.slice(1)] },
    { ...four, composite: { ...four.composite!, originalPhotoIds: ['raw-0', 'raw-1', 'raw-2', 'raw-3'] } },
    { ...four, composite: { ...four.composite!, recipe: { ...four.composite!.recipe, photoIds: [...four.composite!.recipe.photoIds, 'extra'] } } },
    { ...four, shots: [{ ...four.shots[0]!, sessionId: 'other' }, ...four.shots.slice(1)] } ];
  for (const candidate of candidates) {
    const queue = store(fourJobs());
    await finalizeReadySessions({ store: queue, async sessions() { return [candidate]; }, async ready() { assert.fail('stale template'); } }, 1000);
    assert.equal(sessionGuestPage(candidate, await queue.list(), 1000), null);
  }
});

test('selected acknowledgements alone cannot expose a four-photo QR; all asset acknowledgements agree', () => {
  const rows = fourJobs().map(job => ({ ...job, guestUrl: url, guestExpiresAt: 2000 }));
  for (const change of [{ guestUrl: undefined }, { guestUrl: `${origin}/g/other` }, { guestExpiresAt: 3000 }, { state: 'pending' as const }]) {
    const altered = rows.map(job => job.photoId === 'raw-0' ? { ...job, ...change } : job);
    assert.equal(sessionGuestPage(four, altered, 1000), null);
  }
});

test('native finalization rechecks durable publication assets and rejects a changed manifest', async () => {
  const queue = store(fourJobs());
  await finalizeReadySessions({ store: queue, async sessions() { return [four]; },
    async publicationAssets() { return { photoIds: four.shots.map(shot => shot.id) }; },
    async ready() { assert.fail('durable manifest differs'); } }, 1000);
  assert.equal(sessionGuestPage(four, await queue.list(), 1000), null);
});

test('plain four-photo originals share one deduplicated acknowledgement with their template', async () => {
  const plain = { ...four, shots: four.shots.map(shot => ({ ...shot, sourcePhotoId: undefined })),
    composite: { ...four.composite!, originalPhotoIds: [...four.composite!.recipe.photoIds] } };
  const rows = [...plain.shots.map(shot => shot.id), 'template'].map(id => ({
    ...uploadJob(id, `file:///${id}.jpg`, 1, plain.id), state: 'complete' as const,
  }));
  const queue = store(rows);
  await finalizeReadySessions({ store: queue, async sessions() { return [plain]; },
    async ready(_id, _ids, descriptor) { return { value: { ...ready, ...descriptor }, origin }; } }, 1000);
  assert.equal((await queue.list()).length, 5);
  assert.deepEqual(sessionGuestPage(plain, await queue.list(), 1000), { url, expiresAt: 2000 });
});

const fourV2: ShareableSession = { ...four, composite: { ...four.composite!, recipe: {
  ...four.composite!.recipe, version: 'wedding-template-v2', gridAspect: 'portrait',
} } };

test('finalizer independently enforces the full v2 acknowledgement before assigning any guest URL', async () => {
  for (const change of ['missing', 'aspect', 'roles', 'version'] as const) {
    const queue = store(fourJobs());
    await finalizeReadySessions({ store: queue, async sessions() { return [fourV2]; },
      async ready(_id, _ids, descriptor) {
        const good = { ...ready, ...descriptor };
        const value = change === 'missing' ? ready : change === 'roles' ? { ...good, photoIds: descriptor!.originalPhotoIds, originalPhotoIds: descriptor!.photoIds } :
          { ...good, composite: { ...descriptor!.composite, ...(change === 'aspect' ? { gridAspect: 'square' } : { version: 'wedding-template-v1' }) } };
        return { value, origin };
      } }, 1000);
    assert.equal(sessionGuestPage(fourV2, await queue.list(), 1000), null);
    assert((await queue.list()).every(job => job.state === 'complete' && job.guestUrl === undefined));
  }
  const queue = store(fourJobs());
  await finalizeReadySessions({ store: queue, async sessions() { return [fourV2]; },
    async ready(_id, _ids, descriptor) { return { value: { ...ready, ...descriptor }, origin }; } }, 1000);
  const restarted = store(JSON.parse(JSON.stringify(await queue.list())));
  assert.deepEqual(sessionGuestPage(fourV2, await restarted.list(), 1000), { url, expiresAt: 2000 });
  await finalizeReadySessions({ store: restarted, async sessions() { return [fourV2]; }, async ready() { assert.fail('valid persisted acknowledgements must not repeat'); } }, 1000);
});

test('a changed durable v2 aspect or an invalid persisted version cannot produce publication readiness', async () => {
  const queue = store(fourJobs());
  await finalizeReadySessions({ store: queue, async sessions() { return [fourV2]; },
    async publicationAssets() { return { photoIds: fourV2.composite!.recipe.photoIds, originalPhotoIds: fourV2.composite!.originalPhotoIds,
      composite: { photoId: 'template', layout: 'strip', theme: 'botanical', version: 'wedding-template-v2', gridAspect: 'square' } }; },
    async ready() { assert.fail('durable aspect drift cannot publish'); } }, 1000);
  assert.equal(sessionGuestPage(fourV2, await queue.list(), 1000), null);
  const acknowledged = fourJobs().map(job => ({ ...job, guestUrl: url, guestExpiresAt: 2000 }));
  for (const gridAspect of [undefined, null, 'wide']) {
    const malformed = { ...fourV2, composite: { ...fourV2.composite!, recipe: { ...fourV2.composite!.recipe, gridAspect } } };
    assert.equal(sessionGuestPage(malformed as never, acknowledged, 1000), null);
  }
  const v1WithAspect = { ...four, composite: { ...four.composite!, recipe: { ...four.composite!.recipe, gridAspect: 'square' } } };
  assert.equal(sessionGuestPage(v1WithAspect as never, acknowledged, 1000), null);
});
