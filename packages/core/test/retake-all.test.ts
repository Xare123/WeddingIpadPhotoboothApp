import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rename, rm } from 'node:fs/promises';
import { statSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { LocalRepository } from '../../../apps/ipad/src/local-persistence';
import { createNativeFilePorts } from '../../../apps/ipad/src/native-file-ports';
import { ensureUploadJob, type QueueDatabase } from '../../../apps/ipad/src/queue-index';
import { type QueueJob } from '../src/index';

async function diskFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'retake-all-'));
  const sql = new DatabaseSync(join(directory, 'booth.sqlite'));
  sql.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE job_quarantine(job_id TEXT,payload TEXT,PRIMARY KEY(job_id,payload)); CREATE TABLE metadata(key TEXT PRIMARY KEY,payload TEXT)');
  t.after(async () => { sql.close(); await rm(directory, { recursive: true, force: true }); });
  const faults = { move: false, queue: false };
  const db: QueueDatabase = {
    async getFirstAsync<T>(query: string, ...args: string[]) { return sql.prepare(query).get(...args) as T ?? null; },
    async runAsync(query, ...args) { return { changes: Number(sql.prepare(query).run(...args).changes) }; },
  };
  const uri = (path: string) => pathToFileURL(join(directory, path)).href;
  class NativeFile {
    constructor(readonly uri: string) {}
    get name() { return basename(fileURLToPath(this.uri)); }
    get exists() { try { return statSync(fileURLToPath(this.uri)).isFile(); } catch { return false; } }
    get size() { try { return statSync(fileURLToPath(this.uri)).size; } catch { return null; } }
    async copy(to: NativeFile, options?: { overwrite?: boolean }) { await copyFile(fileURLToPath(this.uri), fileURLToPath(to.uri), options?.overwrite ? 0 : constants.COPYFILE_EXCL); }
    async move(to: NativeFile) { if (faults.move || to.exists) throw new Error('Native rename refused'); await rename(fileURLToPath(this.uri), fileURLToPath(to.uri)); }
    async write(text: string) { await writeFile(fileURLToPath(this.uri), text); }
    async text() { return readFile(fileURLToPath(this.uri), 'utf8'); }
  }
  const files = createNativeFilePorts({ uri, file: path => new NativeFile(path), directory: {
    async create() { await mkdir(join(directory, 'photobooth'), { recursive: true }); },
    async list() { return (await readdir(join(directory, 'photobooth'))).map(name => new NativeFile(uri('photobooth/' + name))); },
  }, isFile: (value): value is NativeFile => value instanceof NativeFile });
  let nonce = 0;
  const index = {
    async read(key: string) { const row = sql.prepare('SELECT payload FROM metadata WHERE key=?').get(key) as {payload:string}|undefined; return row ? JSON.parse(row.payload) : null; },
    async write(key: string, value: unknown) { sql.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key, JSON.stringify(value)); },
    async ensureJob(job: QueueJob) { if (faults.queue) throw new Error('Database temporarily unavailable'); await ensureUploadJob(db, job.kind === 'upload' ? { ...job, fileUri: 'photobooth/' + basename(new URL(job.fileUri).pathname) } : job); },
  };
  const make = () => new LocalRepository(files, index, () => 'nonce-' + ++nonce, () => 1000);
  await writeFile(join(directory, 'camera.jpg'), Buffer.from([255, 216, 1, 2, 255, 217]));
  const source = uri('camera.jpg');
  const payload = (id: string): QueueJob => JSON.parse((sql.prepare('SELECT payload FROM jobs WHERE id=?').get(id) as {payload:string}).payload);
  return { sql, db, uri, files, faults, make, source, payload };
}
async function complete(f: Awaited<ReturnType<typeof diskFixture>>, id = 'session') {
  const repository = f.make(); let session = await repository.createSession(id, 5);
  for (let i = 0; i < 5; i++) session = await repository.saveShot(session, `${id}-photo-${i}`, f.source, i);
  return { repository, session };
}

function attempt(repository: LocalRepository) {
  return {
    async begin(parentId: string, id: string, timing: { firstSeconds: 5; nextSeconds: 3 }) {
      const parent = (await repository.getSession(parentId))!;
      return repository.beginRetakeAll(parentId, { id, expectedSelectedPhotoIds: parent.shots.map(photo => photo.id), timing });
    },
    save: (id: string, photoId: string, uri: string, slot: number) => repository.saveShot(id, photoId, uri, slot),
    confirm: (id: string) => repository.confirmSession(id),
    cancel: (id: string) => repository.cancelRetakeAll(id),
    async recover() {
      await repository.recover();
      const active = await repository.getActiveSession();
      return { active, attempt: active?.retakeOfSessionId ? { parentSessionId: active.retakeOfSessionId,
        timing: active.captureTiming, template: active.templateDefaults } : undefined };
    },
  };
}
import { createSessionCaptureRunner } from '../../../apps/ipad/src/session-capture';
const timing = { firstSeconds: 5, nextSeconds: 3 } as const;
function failWrite(f: Awaited<ReturnType<typeof diskFixture>>, at: number, after = false) {
  const write = f.files.write; let count = 0;
  f.files.write = async (path, text) => {
    const fail = ++count === at;
    if (fail && !after) throw new Error('injected-write');
    await write(path, text);
    if (fail && after) throw new Error('injected-write-after-durable');
  };
  return () => { f.files.write = write; };
}
for (const at of [1, 2]) for (const after of [false, true]) {
  test(`begin journal ${at}, fail ${after ? 'after' : 'before'} write: old published set stays exact`, async t => {
    const f = await diskFixture(t), { repository, session } = await complete(f);
    await repository.confirmSession(session);
    const acknowledgment = { ...f.payload('session-photo-0'), state: 'complete', attempts: 8, guestUrl: 'https://photos.example/g/old', guestExpiresAt: 99999 };
    f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(acknowledgment), acknowledgment.id);
    const original = await repository.getSession(session.id);
    const bytes = await Promise.all(session.shots.map(photo => readFile(fileURLToPath(photo.fileUri))));
    const restore = failWrite(f, at, after);
    await assert.rejects(attempt(repository).begin(session.id, 'child', timing));
    restore();
    const fresh = f.make(), recovered = await attempt(fresh).recover();
    assert.deepEqual(await fresh.getSession(session.id), original);
    assert.deepEqual(f.payload(acknowledgment.id), acknowledgment);
    assert.deepEqual(await Promise.all(session.shots.map(photo => readFile(fileURLToPath(photo.fileUri)))), bytes);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
    if (recovered.active?.id === 'child') {
      assert.equal(recovered.attempt?.parentSessionId, session.id);
      assert.equal(recovered.active.shots.length, 0);
    } else assert.equal(recovered.active?.id, session.id);
  });
}

test('four-photo background/relaunch resumes remaining slots at 5/3 timing without inheriting looks or publishing', async t => {
  const f = await diskFixture(t), repository = f.make();
  let parent = await repository.createSession('parent-four');
  for (let slot = 0; slot < 4; slot++) parent = await repository.saveShot(parent.id, 'old-' + slot, f.source, slot);
  const prototype = attempt(repository);
  const child = await prototype.begin(parent.id, 'new-four', timing);
  let foreground = true, nonce = 0;
  const countdown: number[] = [];
  const runner = createSessionCaptureRunner({
    async capture() { return { id: 'new-' + ++nonce, uri: f.source }; },
    save: (session, photo) => prototype.save(session.id, photo.id, photo.uri, photo.slot),
    async wait() {}, isActive: () => foreground,
    onEvent(event) {
      if (event.kind === 'countdown') countdown.push(event.remaining);
      if (event.kind === 'saved' && event.session.shots.length === 2) foreground = false;
    },
  });
  await runner.run(child, { timing });
  assert.deepEqual(countdown, [5, 4, 3, 2, 1, 3, 2, 1]);
  const next = attempt(f.make()), recovered = await next.recover();
  assert.equal(recovered.active?.shots.length, 2);
  assert.deepEqual(recovered.attempt?.timing, timing);
  const remaining: number[] = [];
  const resumed = createSessionCaptureRunner({
    async capture(slot: number) { remaining.push(slot); return { id: 'resume-' + slot, uri: f.source }; },
    save: (session, photo) => next.save(session.id, photo.id, photo.uri, photo.slot),
    async wait() {}, isActive: () => true, onEvent() {},
  });
  await resumed.run(recovered.active!, { timing: recovered.attempt!.timing });
  assert.deepEqual(remaining, [2, 3]);
  const current = (await next.recover()).active!;
  assert.equal(current.shots.length, 4); assert.equal(current.composite, undefined);
  assert.ok(current.shots.every(photo => !photo.look && !photo.sourcePhotoId));
  assert.deepEqual((await repository.getSession(parent.id))?.shots.map(photo => photo.id), parent.shots.map(photo => photo.id));
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  await assert.rejects(next.confirm('new-four'), /composite-required/);
});

for (const at of [1, 2]) for (const after of [false, true]) {
  test(`cancel journal ${at}, fail ${after ? 'after' : 'before'} write: recovery respects last durable decision`, async t => {
    const f = await diskFixture(t), { repository, session } = await complete(f);
    const prototype = attempt(repository);
    await prototype.begin(session.id, 'cancel-child', timing);
    await prototype.save('cancel-child', 'partial', f.source, 0);
    const restore = failWrite(f, at, after);
    await assert.rejects(prototype.cancel('cancel-child'));
    restore();
    const fresh = f.make(), next = attempt(fresh);
    const result = await next.recover();
    assert.equal(result.active?.id, at === 1 && !after ? 'cancel-child' : session.id);
    assert.equal((await fresh.getSession('cancel-child'))?.shots[0]?.id, 'partial');
    if (result.active?.id === session.id) {
      await assert.rejects(next.save('cancel-child', 'late', f.source, 1), /abandoned-retake/);
      await assert.rejects(next.confirm('cancel-child'), /abandoned-retake/);
    }
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  });
}

test('cancel waits for exposed save, retains bytes, and late save cannot reactivate canceled attempt', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  const prototype = attempt(repository);
  await prototype.begin(session.id, 'inflight-child', timing);
  const originalCopy = f.files.copy;
  let release!: () => void, entered!: () => void;
  const enteredCopy = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.files.copy = async (source, path) => { entered(); await blocked; await originalCopy(source, path); };
  const saved = prototype.save('inflight-child', 'exposed', f.source, 0);
  await enteredCopy;
  const canceled = prototype.cancel('inflight-child');
  release(); await saved; await canceled;
  assert.equal((await repository.getActiveSession())?.id, session.id);
  assert.equal((await repository.getSession('inflight-child'))?.shots[0]?.id, 'exposed');
  await assert.rejects(prototype.save('inflight-child', 'stale-late', f.source, 1), /abandoned-retake/);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('failed child rename recovers privately; canceled attempt never uploads or hijacks another guest', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  const prototype = attempt(repository);
  await prototype.begin(session.id, 'stage-child', timing);
  f.faults.move = true;
  await assert.rejects(prototype.save('stage-child', 'staged-child-photo', f.source, 0));
  assert.equal((await repository.getSession('stage-child'))?.shots.length, 0);
  await prototype.cancel('stage-child');
  f.faults.move = false;
  const fresh = f.make(), next = attempt(fresh);
  await next.recover();
  assert.equal((await fresh.getSession('stage-child'))?.retakes?.[0]?.id, 'staged-child-photo');
  const unrelated = await fresh.createSession('next-guest');
  assert.equal((await next.recover()).active?.id, unrelated.id);
  await assert.rejects(next.cancel('stage-child'), /stale-retake/);
  await fresh.reconcileConfirmedPhotos();
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('saved theme/aspect defaults travel to child; per-photo look, crop and composite do not', async t => {
  const f = await diskFixture(t), repository = f.make();
  let parent = await repository.createSession('styled-parent');
  for (let slot = 0; slot < 4; slot++) parent = await repository.saveShot(parent.id, 'styled-' + slot, f.source, slot);
  parent = await repository.saveRenderedPhoto(parent.id, { id: 'styled-look', newRenderedURI: f.source,
    sourcePhotoId: 'styled-0', look: { preset: 'warm', intensity: 0.65, version: 'wedding-ci-srgb-v1' }, expectedSelectedPhotoId: 'styled-0', slot: 0 });
  const selected = parent.shots.map(photo => photo.id);
  parent = await repository.saveComposite(parent.id, { id: 'styled-template', newRenderedURI: f.source,
    recipe: { version: 'wedding-template-v2', layout: 'grid', theme: 'coastal', gridAspect: 'square', photoIds: selected,
      cropsByPhotoId: Object.fromEntries(selected.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) },
    expectedSelectedPhotoIds: selected });
  const before = await repository.getSession(parent.id);
  const prototype = attempt(repository), child = await prototype.begin(parent.id, 'styled-child', timing);
  assert.equal(child.shots.length, 0); assert.equal(child.composite, undefined);
  const state = await prototype.recover();
  assert.deepEqual(state.attempt?.template, { layout: 'grid', theme: 'coastal', gridAspect: 'square' });
  const saved = await prototype.save(child.id, 'fresh-unfiltered', f.source, 0);
  assert.equal(saved.shots[0]?.look, undefined); assert.equal(saved.shots[0]?.sourcePhotoId, undefined);
  await prototype.cancel(child.id);
  assert.deepEqual(await repository.getSession(parent.id), before);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('legacy five replacement becomes confirmable only after five durable photos; parent never auto-uploads', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  const prototype = attempt(repository);
  await prototype.begin(session.id, 'legacy-new', timing);
  for (let slot = 0; slot < 4; slot++) await prototype.save('legacy-new', 'legacy-new-' + slot, f.source, slot);
  await assert.rejects(prototype.confirm('legacy-new'), /incomplete-session/);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  await prototype.save('legacy-new', 'legacy-new-4', f.source, 4);
  const confirmed = await prototype.confirm('legacy-new');
  assert.equal(confirmed.confirmed, true);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  assert.ok((f.sql.prepare('SELECT payload FROM jobs').all() as {payload:string}[]).every(row => JSON.parse(row.payload).sessionId === 'legacy-new'));
  assert.equal((await repository.getSession(session.id))?.confirmed, false);
  await assert.rejects(prototype.cancel('legacy-new'), /stale-retake|capture-session/);
  await assert.rejects(prototype.save('legacy-new', 'late', f.source, 0), /stale-retake|capture-session/);
});

async function four(f: Awaited<ReturnType<typeof diskFixture>>, id: string) {
  const repository = f.make(); let session = await repository.createSession(id);
  for (let slot = 0; slot < 4; slot++) session = await repository.saveShot(id, id + '-' + slot, f.source, slot);
  return { repository, session };
}
const recipeFor = (ids: string[]) => ({ version: 'wedding-template-v2' as const, layout: 'grid' as const,
  theme: 'botanical' as const, gridAspect: 'portrait' as const, photoIds: ids,
  cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fit' as const, x: 0, y: 0, zoom: 1 }])) });

test('four replacement requires its own composite and explicit confirmation; published parent stays exact', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'published-four');
  const originalIds = session.shots.map(photo => photo.id);
  await repository.saveComposite(session.id, { id: 'parent-template', newRenderedURI: f.source, recipe: recipeFor(originalIds), expectedSelectedPhotoIds: originalIds });
  await repository.updateExport(session.id, 'parent-template', 'saved');
  await repository.confirmSession(session.id);
  const before = await repository.getSession(session.id);
  const completed = { ...f.payload('parent-template'), state: 'complete', attempts: 5, guestUrl: 'https://photos.example/g/old', guestExpiresAt: 99999 };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), 'parent-template');
  let child = await repository.beginRetakeAll(session.id, { id: 'replacement-four', expectedSelectedPhotoIds: originalIds, timing });
  assert.equal(child.retakeOfSessionId, session.id); assert.equal(child.retakeState, 'open');
  for (let slot = 0; slot < 4; slot++) child = await repository.saveShot(child.id, 'replacement-' + slot, f.source, slot);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  await assert.rejects(repository.confirmSession(child.id), /composite-required/);
  const ids = child.shots.map(photo => photo.id);
  await repository.saveComposite(child.id, { id: 'new-template', newRenderedURI: f.source, recipe: recipeFor(ids), expectedSelectedPhotoIds: ids });
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  await repository.confirmSession(child.id);
  const restored = f.make(); await restored.recover(); await restored.reconcileConfirmedPhotos();
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 10);
  assert.deepEqual(f.payload('parent-template'), completed);
  assert.deepEqual(await restored.getSession(session.id), before);
  assert.equal((await restored.getActiveSession())?.id, child.id);
  await assert.rejects(restored.cancelRetakeAll(child.id), /stale-retake/);
});

test('all abandoned guest mutators reject while archival Photos acknowledgments remain truthful', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'abandon-parent');
  const expected = session.shots.map(photo => photo.id);
  let child = await repository.beginRetakeAll(session.id, { id: 'abandon-child', expectedSelectedPhotoIds: expected, timing });
  for (let slot = 0; slot < 4; slot++) child = await repository.saveShot(child.id, 'abandon-' + slot, f.source, slot);
  const ids = child.shots.map(photo => photo.id), recipe = recipeFor(ids);
  await repository.saveComposite(child.id, { id: 'abandon-template', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: ids });
  await repository.updateExport(child.id, ids[0]!, 'uncertain');
  await repository.cancelRetakeAll(child.id);
  await assert.rejects(repository.saveShot(child.id, 'late-photo', f.source, 0), /abandoned-retake/);
  await assert.rejects(repository.saveRenderedPhoto(child.id, { id: 'late-look', newRenderedURI: f.source, sourcePhotoId: ids[0]!,
    look: { preset: 'warm', intensity: 0.5, version: 'wedding-ci-srgb-v1' }, expectedSelectedPhotoId: ids[0]!, slot: 0 }), /abandoned-retake/);
  await assert.rejects(repository.selectSavedPhoto(child.id, ids[0]!, 0, ids[0]!), /abandoned-retake/);
  await assert.rejects(repository.saveComposite(child.id, { id: 'late-template', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: ids }), /abandoned-retake/);
  await assert.rejects(repository.confirmSession(child.id), /abandoned-retake/);
  await assert.rejects(repository.retryStagedPhotos(child.id), /abandoned-retake/);
  await assert.rejects(repository.retryStagedComposites(child.id), /abandoned-retake/);
  await assert.rejects(repository.setActiveCapture(child.shots[0]!), /abandoned-retake/);
  await repository.updateExport(child.id, ids[0]!, 'saved');
  const restored = f.make(); await restored.recover(); await restored.reconcileConfirmedPhotos();
  assert.equal((await restored.getActiveSession())?.id, session.id);
  assert.equal((await restored.getSession(child.id))?.shots[0]?.exportStatus, 'saved');
  assert.equal((await restored.getSession(child.id))?.retakeState, 'abandoned');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('stale snapshots, identity reuse, timing and active-session mismatches cannot start or mutate an attempt', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  const ids = session.shots.map(photo => photo.id);
  const input = { id: 'safe-child', expectedSelectedPhotoIds: ids, timing };
  await assert.rejects(repository.beginRetakeAll(session.id, { ...input, expectedSelectedPhotoIds: [...ids].reverse() }), /stale-retake-parent/);
  await assert.rejects(repository.beginRetakeAll(session.id, { ...input, id: session.id }), /session-id-reused/);
  await assert.rejects(repository.beginRetakeAll(session.id, { ...input, timing: { ...timing, firstSeconds: 0 } as never }), /retake-timing/);
  assert.equal(await repository.getSession(input.id), null);
  const child = await repository.beginRetakeAll(session.id, input);
  await assert.rejects(repository.saveShot(session.id, 'stale-parent-photo', f.source, 0), /inactive-retake-parent/);
  await assert.rejects(repository.beginRetakeAll(session.id, { ...input, id: 'double-tap-child' }), /stale-retake-parent/);
  const next = await repository.createSession('unrelated-guest');
  await assert.rejects(repository.saveShot(child.id, 'late-child-photo', f.source, 0), /inactive-retake/);
  await assert.rejects(repository.cancelRetakeAll(child.id), /stale-retake/);
  await repository.recover();
  assert.equal((await repository.getActiveSession())?.id, next.id);
  assert.deepEqual((await repository.getSession(session.id))?.shots.map(photo => photo.id), ids);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('legacy capture setter cannot reactivate inactive retake child or bypass its mutation guard', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'setter-parent');
  let child = await repository.beginRetakeAll(session.id, { id: 'setter-child', expectedSelectedPhotoIds: session.shots.map(photo => photo.id), timing });
  child = await repository.saveShot(child.id, 'setter-child-0', f.source, 0);
  // Updating the current capture remains harmless and supported.
  await repository.setActiveCapture(child.shots[0]!);
  const unrelated = await repository.createSession('setter-next');
  await assert.rejects(repository.setActiveCapture(child.shots[0]!), /inactive-retake/);
  await assert.rejects(repository.saveShot(child.id, 'setter-child-1', f.source, 1), /inactive-retake/);
  assert.equal((await repository.getActiveSession())?.id, unrelated.id);
  assert.equal((await repository.getSession(child.id))?.shots.length, 1);
  // Clearing the pointer must not turn the setter into a way around the guard.
  await repository.setActiveCapture(null);
  await assert.rejects(repository.setActiveCapture(child.shots[0]!), /inactive-retake/);
  await assert.rejects(repository.setActiveCapture(session.shots[0]!), /inactive-retake/);
  assert.equal(await repository.getActiveSession(), null);
});

for (const published of [false, true]) test(`legacy capture setter cannot displace active child with ${published ? 'published' : 'unconfirmed'} parent`, async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'ancestor-parent');
  if (published) await repository.confirmSession(session.id);
  const child = await repository.beginRetakeAll(session.id, { id: 'ancestor-child', expectedSelectedPhotoIds: session.shots.map(photo => photo.id), timing });
  await assert.rejects(repository.setActiveCapture(session.shots[0]!), /inactive-retake/);
  await assert.rejects(repository.saveShot(session.id, 'ancestor-late', f.source, 0), /inactive-retake-parent|capture-session/);
  assert.equal((await repository.getActiveSession())?.id, child.id);
  assert.deepEqual((await repository.getSession(session.id))?.shots.map(photo => photo.id), session.shots.map(photo => photo.id));
  const restored = f.make(); await restored.recover();
  assert.equal((await restored.getActiveSession())?.id, child.id);
  await restored.cancelRetakeAll(child.id);
  assert.equal((await restored.getActiveSession())?.id, session.id);
});

test('legacy single-capture clear and restore remain supported outside a retake family', async t => {
  const f = await diskFixture(t), repository = f.make();
  const legacy = await repository.createSession('standalone-legacy', 1);
  const saved = await repository.saveShot(legacy, 'standalone-photo', f.source, 0);
  await repository.setActiveCapture(null);
  assert.equal(await repository.getActiveCapture(), null);
  await repository.setActiveCapture(saved.shots[0]!);
  assert.equal((await repository.getActiveSession())?.id, legacy.id);
  assert.equal((await repository.getActiveCapture())?.id, saved.shots[0]?.id);
});
