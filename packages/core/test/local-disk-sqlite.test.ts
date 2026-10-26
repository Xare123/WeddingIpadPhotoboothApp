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
import { createPhotoExporter } from '../../../apps/ipad/src/photo-export';
import { uploadDocumentPhotoPath } from '../../../apps/ipad/src/local-paths';
import { usableQueueRows } from '../../../apps/ipad/src/queue-index';
import { uploadJob, drainQueue, type QueueJob } from '../src/index';

async function diskFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'booth-storage-'));
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

test('real disk: verified partial stays staged until JPEG normalization succeeds; retry needs no camera cache', async t => {
  const f = await diskFixture(t), repository = f.make(), session = await repository.createSession('stage', 5);
  f.faults.move = true;
  await assert.rejects(repository.saveShot(session, 'photo', f.source, 0), /original-commit/);
  let current = await repository.getActiveSession();
  assert.equal(current?.shots.length, 0); assert.equal(current?.stagedOriginals?.[0]?.id, 'photo');
  assert.equal(current?.storageWarning, 'original-commit-pending');
  await assert.rejects(repository.confirmSession('stage'), /incomplete|original-commit/);
  f.faults.move = false;
  await rm(fileURLToPath(f.source));
  current = await repository.retryStagedPhotos('stage');
  assert.equal(current?.shots[0]?.fileUri, f.uri('photobooth/photo.jpg'));
  assert.equal(current?.stagedOriginals, undefined);
  await repository.recover();
  assert.equal((await repository.getActiveSession())?.shots[0]?.fileUri, f.uri('photobooth/photo.jpg'));
});

test('real disk: legacy unconfirmed stage normalizes to draft and never queues itself on relaunch', async t => {
  const f = await diskFixture(t), repository = f.make(), session = await repository.createSession('legacy', 1);
  f.faults.move = true; await assert.rejects(repository.saveShot(session, 'legacy', f.source, 0));
  f.faults.move = false; const restored = f.make(); await restored.recover();
  assert.equal((await restored.getActiveCapture())?.fileUri, f.uri('photobooth/legacy.draft.jpg'));
  assert.equal((await restored.getActiveSession())?.confirmed, false);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('real SQLite: same-process confirmed repair restores all five jobs and healthy drains append no journals', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  f.faults.queue = true; await repository.confirmSession(session);
  assert.equal((await repository.getSession(session.id))?.storageWarning, 'index-repair-pending');
  f.faults.queue = false; await repository.reconcileConfirmedPhotos();
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  assert.equal((await repository.getSession(session.id))?.storageWarning, undefined);
  const before = await f.files.list(); await repository.reconcileConfirmedPhotos();
  assert.deepEqual(await f.files.list(), before);
});

test('real SQLite: corrupt selected row is quarantined/repaired while complete and backoff rows remain exact', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  await repository.confirmSession(session);
  const first = { ...f.payload('session-photo-0'), state: 'complete', attempts: 7, nextAttemptAt: 98765, guestUrl: 'https://photos.example/g/opaque', guestExpiresAt: 999999, extra: 'retained' };
  const second = { ...f.payload('session-photo-1'), attempts: 9, nextAttemptAt: 998877 };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(first), first.id);
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(second), second.id);
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run('{broken', 'session-photo-2');
  await repository.reconcileConfirmedPhotos();
  assert.deepEqual(f.payload(first.id), first); assert.deepEqual(f.payload(second.id), second);
  assert.equal(f.payload('session-photo-2').photoId, 'session-photo-2');
  assert.equal(f.sql.prepare('SELECT payload FROM job_quarantine WHERE job_id=?').get('session-photo-2')?.payload, '{broken');
});

test('real SQLite CAS: concurrent completion wins over stale path repair and corrupt-row replacement', async t => {
  const f = await diskFixture(t);
  for (const corrupt of [false, true]) {
    const expected = { ...uploadJob('photo', 'file:///documents/photobooth/photo.jpg', 1000, 'session'), fileUri: 'photobooth/photo.jpg' };
    const old = corrupt ? '{broken' : JSON.stringify({ ...expected, fileUri: 'photobooth/photo.partial' });
    f.sql.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run('photo', old);
    const completed = { ...expected, state: 'complete', attempts: 4, nextAttemptAt: 9000, guestUrl: 'https://photos.example/g/opaque', guestExpiresAt: 99999, fileUri: 'old-stale-path' };
    let raced = false;
    const racing: QueueDatabase = { getFirstAsync: f.db.getFirstAsync, async runAsync(query, ...args) {
      if (!raced && query.startsWith('UPDATE jobs')) { raced = true; f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), 'photo'); }
      return f.db.runAsync(query, ...args);
    } };
    await ensureUploadJob(racing, expected);
    assert.deepEqual(f.payload('photo'), { ...completed, fileUri: expected.fileUri });
  }
});

test('real SQLite: an acknowledgment with missing fileUri keeps every other field during repair', async t => {
  const f = await diskFixture(t), expected = { ...uploadJob('photo', 'file:///documents/photobooth/photo.jpg', 1000, 'session'), fileUri: 'photobooth/photo.jpg' };
  const saved = { ...expected, state: 'complete', attempts: 8, guestUrl: 'https://photos.example/g/opaque', guestExpiresAt: 99999, fileUri: undefined };
  f.sql.prepare('INSERT INTO jobs VALUES (?,?)').run('photo', JSON.stringify(saved));
  await ensureUploadJob(f.db, expected);
  assert.deepEqual(f.payload('photo'), { ...saved, fileUri: expected.fileUri });
});

test('targeted uncertain and retained-original exports never publish retakes or alter the active guest', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  const oldId = session.shots[0]!.id;
  let current = await repository.saveShot(session, 'retake', f.source, 0);
  await repository.updateExport(session.id, oldId, 'uncertain');
  const writes: string[] = [];
  const capability = { available: true, permission: 'granted', canAskAgain: false, writeOnly: true } as const;
  const exporter = createPhotoExporter({ async capability() { return capability; }, async requestAddPermission() { return capability; }, async save(uri) { writes.push(uri); } }, {
    get: id => repository.getSession(id), update: (id, photo, status) => repository.updateExport(id, photo, status),
  });
  await exporter.exportSession(current, { photoIds: [oldId], retryUncertain: true }); assert.equal(writes.length, 0);
  await exporter.exportSession(current, { photoIds: [oldId], includeRetakes: true }); assert.equal(writes.length, 0);
  current = await exporter.exportSession(current, { photoIds: [oldId], includeRetakes: true, retryUncertain: true });
  assert.deepEqual(writes, [f.uri('photobooth/' + oldId + '.jpg')]);
  assert.equal(current.retakes?.find(photo => photo.id === oldId)?.exportStatus, 'saved');
  const confirmed = await repository.confirmSession(current);
  assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get(oldId), undefined);
  assert.equal(confirmed.shots[0]?.id, 'retake');
  await repository.clearActiveSession(); const next = await repository.createSession('next', 5);
  await repository.updateExport(session.id, oldId, 'saved');
  assert.equal((await repository.getActiveSession())?.id, next.id);
});

test('quarantined orphan corruption is visible without blocking unrelated valid jobs', async t => {
  const f = await diskFixture(t), { usableQueueRows } = await import('../../../apps/ipad/src/queue-index');
  const expected = { ...uploadJob('photo', 'file:///documents/photobooth/photo.jpg', 1000, 'session'), fileUri: 'photobooth/photo.jpg' };
  await ensureUploadJob(f.db, expected);
  f.sql.prepare('INSERT INTO jobs VALUES (?,?)').run('orphan', '{bad');
  const rows = f.sql.prepare('SELECT id,payload FROM jobs').all() as {id:string;payload:string}[];
  const result = await usableQueueRows(f.db, rows, job => job);
  assert.deepEqual(result.jobs, [expected]); assert.equal(result.invalidRows, 1);
  assert.equal(f.sql.prepare('SELECT payload FROM job_quarantine WHERE job_id=?').get('orphan')?.payload, '{bad');
  assert.equal(f.sql.prepare('SELECT payload FROM jobs WHERE id=?').get('orphan')?.payload, '{bad', 'repair must preserve source evidence');
});

test('failed retake staging preserves the previous selected original until explicit completion', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  f.faults.move = true; await assert.rejects(repository.saveShot(session, 'new-photo', f.source, 0));
  assert.equal((await repository.getActiveSession())?.shots[0]?.id, session.shots[0]?.id);
  assert.equal((await repository.getActiveSession())?.stagedOriginals?.[0]?.id, 'new-photo');
  f.faults.move = false; const current = await repository.retryStagedPhotos(session.id);
  assert.equal(current?.shots[0]?.id, 'new-photo');
  assert.ok(current?.retakes?.some(photo => photo.id === session.shots[0]?.id));
});

test('active confirmed repair takes priority over more than twenty archived sessions', async t => {
  const f = await diskFixture(t);
  for (let i = 0; i < 21; i++) { const { repository, session } = await complete(f, 'archive-' + i); await repository.confirmSession(session); }
  const { repository, session } = await complete(f, 'current');
  f.faults.queue = true; await repository.confirmSession(session); f.faults.queue = false;
  const before = await f.files.list(); await repository.reconcileConfirmedPhotos();
  assert.ok(session.shots.every(photo => f.payload(photo.id).id === photo.id));
  assert.equal((await repository.getActiveSession())?.storageWarning, undefined);
  assert.deepEqual(await f.files.list(), before);
});

test('relaunch normalizes an old confirmed partial and repairs its stale URI without resetting completion', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  await repository.confirmSession(session);
  const photo = session.shots[0]!, path = 'photobooth/' + photo.id;
  await f.files.move(path + '.jpg', path + '.partial');
  const completed = { ...f.payload(photo.id), state: 'complete', attempts: 6, nextAttemptAt: 12345, guestUrl: 'https://photos.example/g/opaque', guestExpiresAt: 77777, fileUri: path + '.partial' };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), photo.id);
  const restored = f.make(); await restored.recover();
  assert.deepEqual(f.payload(photo.id), { ...completed, fileUri: path + '.jpg' });
  assert.equal((await restored.getSession(session.id))?.shots[0]?.fileUri, f.uri(path + '.jpg'));
  const latest = (await f.files.list()).filter(name => name.endsWith('.json')).sort().reverse();
  let recordedPath: string | undefined;
  for (const name of latest) {
    const record = JSON.parse(await f.files.read('photobooth/' + name));
    if (record.kind === 'capture' && record.capture.id === photo.id) { recordedPath = record.capture.relativePath; break; }
  }
  assert.equal(recordedPath, path + '.jpg');
});

test('impossible terminal upload states are repaired rather than stranded as non-drainable jobs', async t => {
  const f = await diskFixture(t), expected = { ...uploadJob('photo', 'file:///documents/photobooth/photo.jpg', 1000, 'session'), fileUri: 'photobooth/photo.jpg' };
  f.sql.prepare('INSERT INTO jobs VALUES (?,?)').run('photo', JSON.stringify({ ...expected, state: 'mocked' }));
  await ensureUploadJob(f.db, expected);
  assert.equal(f.payload('photo').state, 'pending');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM job_quarantine').get()?.n, 1);
});

test('finishing an older staged retake never replaces a newer selected retake', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  f.faults.move = true; await assert.rejects(repository.saveShot(session, 'older-stage', f.source, 0));
  await repository.getActiveSession();
  f.faults.move = false; await repository.saveShot(session, 'newest-photo', f.source, 0);
  const current = await repository.retryStagedPhotos(session.id);
  assert.equal(current?.shots[0]?.id, 'newest-photo');
  assert.ok(current?.retakes?.some(photo => photo.id === 'older-stage'));
});

test('queue identity validation rejects empty and nonstring fields while accepting secure reference identifiers', async () => {
  const { parseQueuePayload } = await import('../../../apps/ipad/src/queue-index');
  const base = uploadJob('photo', 'file:///documents/photobooth/photo.jpg', 1000, 'session');
  for (const field of ['id', 'photoId', 'sessionId'] as const) for (const value of ['', 42, null]) {
    const row = { ...base, [field]: value };
    assert.equal(parseQueuePayload(JSON.stringify(row), row.id as string), undefined);
  }
  const share = { ...base, id: 'share-job', kind: 'share', uploadJobId: 'photo', recipientRef: 'keychain:recipient-uuid', consentedAt: 1000 };
  assert.equal(parseQueuePayload(JSON.stringify(share), share.id)?.kind, 'share');
  for (const field of ['uploadJobId', 'recipientRef'] as const) assert.equal(parseQueuePayload(JSON.stringify({ ...share, [field]: '' }), share.id), undefined);
});

test('multiple staged retakes commit only the newest intended selection and same-ID retries cannot undo it', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f);
  f.faults.move = true;
  await assert.rejects(repository.saveShot(session, 'staged-a', f.source, 0));
  await assert.rejects(repository.saveShot(session, 'staged-b', f.source, 0));
  await repository.getActiveSession();
  f.faults.move = false;
  let current = await repository.retryStagedPhotos(session.id);
  assert.equal(current?.shots[0]?.id, 'staged-b');
  current = await repository.saveShot(session, 'staged-a', f.source, 0);
  assert.equal(current?.shots[0]?.id, 'staged-b');
  assert.ok(current?.retakes?.some(photo => photo.id === 'staged-a'));
});

test('real disk and SQLite: cross-photo URI cannot upload another original before bounded manifest repair', async t => {
  const f = await diskFixture(t);
  await f.files.ensureDirectory();
  await f.files.write('photobooth/a.jpg', 'original-A');
  await f.files.write('photobooth/b.jpg', 'original-B');
  await f.files.write('photobooth/c.jpg', 'original-C');
  const a = { ...uploadJob('a', f.uri('photobooth/a.jpg'), 1000, 'archive-outside-current-batch'), kind: 'upload' as const, fileUri: 'photobooth/b.jpg' };
  const c = { ...uploadJob('c', f.uri('photobooth/c.jpg'), 1000, 'current'), fileUri: 'photobooth/c.jpg' };
  for (const job of [a, c]) f.sql.prepare('INSERT INTO jobs VALUES (?,?)').run(job.id, JSON.stringify(job));
  const uploaded: { photoId: string; bytes: string }[] = [];
  const readJobs = async () => usableQueueRows(f.db, f.sql.prepare('SELECT id,payload FROM jobs').all() as {id:string;payload:string}[], job => job.kind === 'upload' ? { ...job, fileUri: f.uri(uploadDocumentPhotoPath(job.photoId, job.fileUri)) } : job);
  assert.equal((await readJobs()).invalidRows, 1);
  await drainQueue({ async list() { return (await readJobs()).jobs; }, async save(job) { f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(job), job.id); } }, {
    async upload(job) { uploaded.push({ photoId: job.photoId, bytes: await readFile(fileURLToPath(job.fileUri), 'utf8') }); },
    async share() { throw new Error('No shares expected'); },
  }, 2000);
  assert.deepEqual(uploaded, [{ photoId: 'c', bytes: 'original-C' }]);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM job_quarantine WHERE job_id=?').get('a')?.n, 1);
  const completed = { ...a, state: 'complete', attempts: 7, nextAttemptAt: 9000, guestUrl: 'https://photos.example/g/opaque', guestExpiresAt: 99999 };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), 'a');
  await ensureUploadJob(f.db, { ...a, fileUri: 'photobooth/a.jpg' });
  assert.deepEqual(f.payload('a'), { ...completed, fileUri: 'photobooth/a.jpg' });
});

test('upload identity mismatch is quarantined while own-file legacy suffixes rebase safely', async t => {
  const f = await diskFixture(t);
  const wrongIdentity = { ...uploadJob('a', 'file:///documents/photobooth/b.jpg', 1000, 'session'), photoId: 'b' };
  f.sql.prepare('INSERT INTO jobs VALUES (?,?)').run('a', JSON.stringify(wrongIdentity));
  const result = await usableQueueRows(f.db, f.sql.prepare('SELECT id,payload FROM jobs').all() as {id:string;payload:string}[], job => job);
  assert.equal(result.jobs.length, 0); assert.equal(result.invalidRows, 1);
  assert.equal(uploadDocumentPhotoPath('a', 'file:///old/Documents/photobooth/a.partial'), 'photobooth/a.jpg');
  assert.equal(uploadDocumentPhotoPath('a', 'photobooth/a.draft.jpg'), 'photobooth/a.draft.jpg');
  assert.throws(() => uploadDocumentPhotoPath('a', 'photobooth/b.jpg'), /identity mismatch/);
});

const warmLook = { preset: 'warm', intensity: 0.65, version: 'wedding-ci-srgb-v1' } as const;

test('real disk and SQLite: looks retain original bytes, restore Original, survive restart, and upload only the selected derivative', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'looks');
  const original = session.shots[2]!;
  const originalBytes = await readFile(fileURLToPath(original.fileUri));
  const renderedBytes = Buffer.from([255, 216, 9, 8, 7, 255, 217]);
  const renderedURI = f.uri('render-cache.jpg');
  await writeFile(fileURLToPath(renderedURI), renderedBytes);
  let current = await repository.saveRenderedPhoto(session.id, { id: 'warm-render', newRenderedURI: renderedURI,
    sourcePhotoId: original.id, look: warmLook, expectedSelectedPhotoId: original.id, slot: 2 });
  assert.deepEqual(current.shots.map(photo => photo.id), session.shots.map((photo, slot) => slot === 2 ? 'warm-render' : photo.id));
  assert.deepEqual(await readFile(fileURLToPath(original.fileUri)), originalBytes);
  assert.deepEqual(await readFile(fileURLToPath(current.shots[2]!.fileUri)), renderedBytes);
  assert.equal(current.retakes?.find(photo => photo.id === original.id)?.sourcePhotoId, undefined);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  await rm(fileURLToPath(renderedURI));
  const restored = f.make(); await restored.recover();
  current = (await restored.getSession(session.id))!;
  assert.deepEqual(current.shots[2]?.look, warmLook);
  assert.equal(current.shots[2]?.sourcePhotoId, original.id);
  const before = (await f.files.list()).filter(name => /\.jpg$/.test(name));
  current = await restored.selectSavedPhoto(session.id, original.id, 2, 'warm-render');
  assert.equal(current.shots[2]?.id, original.id);
  assert.equal(current.shots[2]?.look, undefined);
  current = await restored.selectSavedPhoto(session.id, 'warm-render', 2, original.id);
  assert.deepEqual((await f.files.list()).filter(name => /\.jpg$/.test(name)), before);
  await restored.confirmSession(current);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get(original.id), undefined);
  const renderedJob = f.payload('warm-render');
  assert.ok(renderedJob.kind === 'upload');
  assert.equal(renderedJob.fileUri, 'photobooth/warm-render.jpg');
  const uploaded: { photoId: string; bytes: Buffer }[] = [];
  await drainQueue({
    async list() { return (f.sql.prepare('SELECT payload FROM jobs').all() as {payload:string}[]).map(row => {
      const job = JSON.parse(row.payload) as QueueJob;
      return job.kind === 'upload' ? { ...job, fileUri: f.uri(job.fileUri) } : job;
    }); },
    async save(job) { f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(job), job.id); },
  }, { async upload(job) { uploaded.push({ photoId: job.photoId, bytes: await readFile(fileURLToPath(job.fileUri)) }); },
    async share() { throw new Error('No shares'); } }, 2000);
  assert.deepEqual(uploaded.find(photo => photo.photoId === 'warm-render')?.bytes, renderedBytes);
  const completed = f.payload('warm-render');
  await restored.reconcileConfirmedPhotos(); await restored.recover(); await restored.reconcileConfirmedPhotos();
  assert.deepEqual(f.payload('warm-render'), { ...completed, fileUri: 'photobooth/warm-render.jpg' });
  assert.deepEqual(await readFile(fileURLToPath(original.fileUri)), originalBytes);
  await assert.rejects(restored.selectSavedPhoto(session.id, original.id, 2, 'warm-render'));
  await assert.rejects(restored.saveRenderedPhoto(session.id, { id: 'late-render', newRenderedURI: f.source,
    sourcePhotoId: original.id, look: warmLook, expectedSelectedPhotoId: 'warm-render', slot: 2 }));
});

test('real disk: staged derivative retains lineage through rename recovery and a newer retake resets the source', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'staged-look');
  const source = session.shots[0]!;
  f.faults.move = true;
  await assert.rejects(repository.saveRenderedPhoto(session.id, { id: 'staged-render', newRenderedURI: f.source,
    sourcePhotoId: source.id, look: warmLook, expectedSelectedPhotoId: source.id, slot: 0 }), /original-commit/);
  assert.equal((await repository.getSession(session.id))?.shots[0]?.id, source.id);
  assert.equal((await repository.getSession(session.id))?.stagedOriginals?.[0]?.sourcePhotoId, source.id);
  f.faults.move = false;
  const restored = f.make(); await restored.recover();
  assert.equal((await restored.getSession(session.id))?.shots[0]?.id, 'staged-render');
  assert.deepEqual((await restored.getSession(session.id))?.shots[0]?.look, warmLook);
  let current = await restored.saveShot(session.id, 'fresh-camera', f.source, 0);
  assert.equal(current.shots[0]?.look, undefined); assert.equal(current.shots[0]?.sourcePhotoId, undefined);
  await assert.rejects(restored.selectSavedPhoto(session.id, 'staged-render', 0, 'fresh-camera'), /render-source/);
  await assert.rejects(restored.saveRenderedPhoto(session.id, { id: 'old-source', newRenderedURI: f.source,
    sourcePhotoId: source.id, look: warmLook, expectedSelectedPhotoId: 'fresh-camera', slot: 0 }), /render-source/);
  current = await restored.saveRenderedPhoto(session.id, { id: 'fresh-render', newRenderedURI: f.source,
    sourcePhotoId: 'fresh-camera', look: warmLook, expectedSelectedPhotoId: 'fresh-camera', slot: 0 });
  assert.equal(current.shots[0]?.sourcePhotoId, 'fresh-camera');
  assert.ok(current.retakes?.some(photo => photo.id === source.id));
});

test('real disk: stale selection, another guest or slot, missing original, and derived sources cannot create a look', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'validations');
  const other = await repository.createSession('other-guest', 5); await repository.saveShot(other, 'foreign', f.source, 0);
  const input = { id: 'render', newRenderedURI: f.source, sourcePhotoId: session.shots[0]!.id,
    look: warmLook, expectedSelectedPhotoId: session.shots[0]!.id, slot: 0 };
  for (const patch of [{ expectedSelectedPhotoId: 'stale' }, { sourcePhotoId: 'foreign' },
    { sourcePhotoId: session.shots[1]!.id }, { sourcePhotoId: 'missing' },
    { look: { ...warmLook, intensity: NaN } }, { look: { ...warmLook, intensity: 1.01 } }]) {
    await assert.rejects(repository.saveRenderedPhoto(session.id, { ...input, ...patch }));
  }
  await repository.saveRenderedPhoto(session.id, input);
  await assert.rejects(repository.saveRenderedPhoto(session.id, { ...input, id: 'nested', sourcePhotoId: 'render', expectedSelectedPhotoId: 'render' }), /render-source/);
  await assert.rejects(repository.selectSavedPhoto(session.id, session.shots[0]!.id, 0, session.shots[0]!.id), /stale-selection/);
  await rm(fileURLToPath(session.shots[0]!.fileUri));
  await assert.rejects(repository.saveRenderedPhoto(session.id, { ...input, id: 'missing-source-render', expectedSelectedPhotoId: 'render' }), /render-source/);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  assert.ok(!(await f.files.list()).includes('nested.jpg'));
});

test('real disk: restoring Original supersedes an older staged derivative across retry and relaunch', async t => {
  const f = await diskFixture(t), { repository, session } = await complete(f, 'restore-order');
  const original = session.shots[0]!;
  await repository.saveRenderedPhoto(session.id, { id: 'first-look', newRenderedURI: f.source,
    sourcePhotoId: original.id, look: warmLook, expectedSelectedPhotoId: original.id, slot: 0 });
  f.faults.move = true;
  await assert.rejects(repository.saveRenderedPhoto(session.id, { id: 'older-staged-look', newRenderedURI: f.source,
    sourcePhotoId: original.id, look: { ...warmLook, intensity: 0.8 }, expectedSelectedPhotoId: 'first-look', slot: 0 }));
  await repository.selectSavedPhoto(session.id, original.id, 0, 'first-look');
  f.faults.move = false;
  assert.equal((await repository.retryStagedPhotos(session.id))?.shots[0]?.id, original.id);
  const restored = f.make(); await restored.recover();
  const current = (await restored.getSession(session.id))!;
  assert.equal(current.shots[0]?.id, original.id);
  assert.equal(current.retakes?.find(photo => photo.id === 'older-staged-look')?.sourcePhotoId, original.id);
  const before = (await f.files.list()).filter(name => name.endsWith('.jpg'));
  const reused = await restored.saveRenderedPhoto(session.id, { id: 'first-look', newRenderedURI: 'file:///missing-cache.jpg',
    sourcePhotoId: original.id, look: { version: warmLook.version, intensity: warmLook.intensity, preset: warmLook.preset },
    expectedSelectedPhotoId: original.id, slot: 0 });
  assert.equal(reused.shots[0]?.id, 'first-look');
  assert.deepEqual((await f.files.list()).filter(name => name.endsWith('.jpg')), before);
});

async function four(f: Awaited<ReturnType<typeof diskFixture>>, id = 'four') {
  const repository = f.make(); let session = await repository.createSession(id);
  assert.equal(session.targetCount, 4);
  for (let i = 0; i < 4; i++) session = await repository.saveShot(session, `${id}-photo-${i}`, f.source, i);
  return { repository, session };
}
function templateRecipe(photoIds: string[]) {
  return { version: 'wedding-template-v1' as const, layout: 'strip' as const, theme: 'botanical' as const,
    photoIds, cropsByPhotoId: Object.fromEntries(photoIds.map((id, index) => [id,
      index === 1 ? { mode: 'fill' as const, x: 0.2, y: -0.3, zoom: 1.2 } : { mode: 'fit' as const, x: 0, y: 0, zoom: 1 }])) };
}

test('four photos: filtered selection, raw sources and reordered composite publish exact immutable assets', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f);
  await assert.rejects(repository.confirmSession(session), /composite-required/);
  const discarded = session.shots[0]!.id;
  let current = await repository.saveShot(session, 'new-source', f.source, 0);
  current = await repository.saveRenderedPhoto(session.id, { id: 'chosen-look', newRenderedURI: f.source,
    sourcePhotoId: 'new-source', look: warmLook, expectedSelectedPhotoId: 'new-source', slot: 0 });
  const selected = current.shots.map(photo => photo.id), ordered = [selected[2]!, selected[0]!, selected[3]!, selected[1]!];
  const recipe = templateRecipe(ordered);
  const compositeURI = f.uri('composite-cache.jpg'), bytes = Buffer.from([255, 216, 42, 43, 255, 217]);
  await writeFile(fileURLToPath(compositeURI), bytes);
  current = await repository.saveComposite(session.id, { id: 'composite-one', newRenderedURI: compositeURI, recipe, expectedSelectedPhotoIds: selected });
  assert.deepEqual(current.shots.map(photo => photo.id), selected);
  assert.equal(current.retakes?.some(photo => photo.id === 'composite-one'), false);
  assert.equal(current.shots.some(photo => photo.id === 'composite-one'), false);
  assert.deepEqual(current.composite?.recipe, recipe);
  assert.deepEqual(current.composite?.originalPhotoIds, [selected[2], 'new-source', selected[3], selected[1]]);
  const assets = await repository.getSessionPublicationAssets(session.id);
  assert.deepEqual(assets, { photoIds: ordered, originalPhotoIds: [selected[2], 'new-source', selected[3], selected[1]],
    composite: { photoId: 'composite-one', layout: 'strip', theme: 'botanical', version: 'wedding-template-v1' } });
  await repository.confirmSession(session.id);
  const ids = (f.sql.prepare('SELECT id FROM jobs').all() as {id:string}[]).map(row => row.id).sort();
  assert.deepEqual(ids, [...new Set([...selected, 'new-source', 'composite-one'])].sort());
  assert.ok(!ids.includes(discarded));
  assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/composite-one.jpg'))), bytes);
  const completed = { ...f.payload('composite-one'), state: 'complete', attempts: 3, guestUrl: 'https://photos.example/g/composite', guestExpiresAt: 99999 };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), 'composite-one');
  const restored = f.make(); await restored.recover(); await restored.reconcileConfirmedPhotos(); await restored.recover();
  assert.deepEqual(f.payload('composite-one'), completed);
  assert.deepEqual((await restored.getSession(session.id))?.composite?.recipe, recipe);
  assert.deepEqual(await restored.getSessionPublicationAssets(session.id), assets);
  await assert.rejects(restored.saveComposite(session.id, { id: 'late', newRenderedURI: compositeURI, recipe, expectedSelectedPhotoIds: selected }));
});

test('four photos: composite rename recovery retains crop by photo ID and never imports a composite as a capture', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'composite-stage');
  const selected = session.shots.map(photo => photo.id), recipe = templateRecipe([...selected].reverse());
  f.faults.move = true;
  await assert.rejects(repository.saveComposite(session.id, { id: 'staged-template', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected }), /composite-commit/);
  const staged = (await repository.getSession(session.id))!;
  assert.equal(staged.composite, undefined);
  assert.equal(staged.storageWarning, 'composite-commit-pending');
  assert.deepEqual(staged.stagedComposites?.[0]?.recipe, recipe);
  assert.equal(staged.shots.length, 4); assert.equal(staged.retakes?.length, 0);
  await assert.rejects(repository.confirmSession(session.id), /composite-required/);
  f.faults.move = false;
  const restored = f.make(); await restored.recover();
  const current = (await restored.getSession(session.id))!;
  assert.deepEqual(current.composite?.recipe, recipe);
  assert.equal(current.shots.length, 4); assert.equal(current.retakes?.length, 0);
  assert.equal((await restored.listLocalSessions()).length, 1);
  assert.equal(current.stagedComposites, undefined);
  await restored.confirmSession(session.id);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
});

test('four photos: filter, Original restoration and retake invalidate a stale template; invalid crops and foreign sets reject', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'invalidations');
  const selected = session.shots.map(photo => photo.id), recipe = templateRecipe(selected);
  await repository.saveComposite(session.id, { id: 'old-composite', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected });
  let current = await repository.saveRenderedPhoto(session.id, { id: 'look', newRenderedURI: f.source,
    sourcePhotoId: selected[0]!, look: warmLook, expectedSelectedPhotoId: selected[0]!, slot: 0 });
  assert.equal(current.composite, undefined);
  await assert.rejects(repository.confirmSession(session.id), /composite-required/);
  await assert.rejects(repository.saveComposite(session.id, { id: 'stale-composite', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected }), /composite-selection/);
  const lookedIds = current.shots.map(photo => photo.id), lookedRecipe = templateRecipe(lookedIds);
  for (const crop of [{ mode: 'fill', x: 2, y: 0, zoom: 1 }, { mode: 'fill', x: 0, y: 0, zoom: 2 },
    { mode: 'fit', x: 0, y: 0, zoom: 1.2 }, { mode: 'fill', x: 0, y: NaN, zoom: 1 }]) {
    await assert.rejects(repository.saveComposite(session.id, { id: 'bad-crop', newRenderedURI: f.source,
      recipe: { ...lookedRecipe, cropsByPhotoId: { ...lookedRecipe.cropsByPhotoId, look: crop as typeof lookedRecipe.cropsByPhotoId[string] } }, expectedSelectedPhotoIds: lookedIds }));
  }
  await repository.saveComposite(session.id, { id: 'look-composite', newRenderedURI: f.source, recipe: lookedRecipe, expectedSelectedPhotoIds: lookedIds });
  current = await repository.selectSavedPhoto(session.id, selected[0]!, 0, 'look');
  assert.notEqual(current.composite?.id, 'look-composite');
  current = await repository.saveShot(session.id, 'retake', f.source, 0);
  assert.equal(current.composite, undefined);
  await assert.rejects(repository.getSessionPublicationAssets(session.id), /composite-required/);
  await assert.rejects(repository.confirmSession(session.id), /composite-required/);
  assert.ok((await f.files.list()).includes('old-composite.jpg'));
  assert.ok((await f.files.list()).includes('look-composite.jpg'));
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
});

test('four photos: late recovery of a newer staged composite cannot replace the confirmed composite', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'frozen-composite');
  const selected = session.shots.map(photo => photo.id), recipe = templateRecipe(selected);
  await repository.saveComposite(session.id, { id: 'confirmed-composite', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected });
  f.faults.move = true;
  await assert.rejects(repository.saveComposite(session.id, { id: 'newer-stage', newRenderedURI: f.source,
    recipe: { ...recipe, theme: 'coastal' }, expectedSelectedPhotoIds: selected }));
  await repository.confirmSession(session.id);
  f.faults.move = false;
  const restored = f.make(); await restored.recover(); await restored.reconcileConfirmedPhotos();
  assert.equal((await restored.getSession(session.id))?.composite?.id, 'confirmed-composite');
  assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get('newer-stage'), undefined);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  assert.ok((await f.files.list()).includes('newer-stage.jpg'));
});

test('composite Photos uncertainty and acknowledgment survive recovery without becoming captures or extra jobs', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'composite-export');
  const selected = session.shots.map(photo => photo.id), recipe = templateRecipe(selected);
  await repository.saveComposite(session.id, { id: 'export-template', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected });
  await repository.updateExport(session.id, 'export-template', 'uncertain');
  let restored = f.make(); await restored.recover();
  let current = (await restored.getSession(session.id))!;
  assert.equal(current.composite?.exportStatus, 'uncertain');
  assert.equal(current.shots.length, 4); assert.equal(current.retakes?.length, 0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 0);
  await assert.rejects(restored.updateExport('another-guest', 'export-template', 'saved'), /export-photo/);
  await restored.confirmSession(session.id);
  const completed = { ...f.payload('export-template'), state: 'complete', attempts: 2, guestUrl: 'https://photos.example/g/export', guestExpiresAt: 99999 };
  f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(completed), 'export-template');
  await restored.updateExport(session.id, 'export-template', 'saved');
  restored = f.make(); await restored.recover(); await restored.reconcileConfirmedPhotos();
  current = (await restored.getSession(session.id))!;
  assert.equal(current.composite?.exportStatus, 'saved');
  assert.equal(current.shots.some(photo => photo.id === 'export-template'), false);
  assert.equal(current.retakes?.some(photo => photo.id === 'export-template'), false);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n, 5);
  assert.deepEqual(f.payload('export-template'), completed);
});

test('dedicated composite retry finishes bytes without retrying shots or changing a frozen manifest', async t => {
  const f = await diskFixture(t), { repository, session } = await four(f, 'retry-composite-only');
  const selected = session.shots.map(photo => photo.id), recipe = templateRecipe(selected);
  await repository.saveComposite(session.id, { id: 'frozen-template', newRenderedURI: f.source, recipe, expectedSelectedPhotoIds: selected });
  f.faults.move = true;
  await assert.rejects(repository.saveComposite(session.id, { id: 'retained-template', newRenderedURI: f.source,
    recipe: { ...recipe, theme: 'coastal' }, expectedSelectedPhotoIds: selected }));
  await assert.rejects(repository.updateExport(session.id, 'retained-template', 'saved'), /export-photo/);
  await repository.confirmSession(session.id);
  f.faults.move = false;
  const current = (await repository.retryStagedComposites(session.id))!;
  assert.equal(current.composite?.id, 'frozen-template');
  assert.deepEqual(current.shots.map(photo => photo.id), selected);
  assert.equal(current.stagedComposites, undefined);
  assert.equal(current.retakes?.length, 0);
  assert.ok((await f.files.list()).includes('retained-template.jpg'));
  assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get('retained-template'), undefined);
  assert.equal(await repository.retryStagedComposites('missing-session'), null);
});
