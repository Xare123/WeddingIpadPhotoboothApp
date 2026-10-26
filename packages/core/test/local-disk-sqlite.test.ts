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
  const repository = f.make(); let session = await repository.createSession(id);
  for (let i = 0; i < 5; i++) session = await repository.saveShot(session, `${id}-photo-${i}`, f.source, i);
  return { repository, session };
}

test('real disk: verified partial stays staged until JPEG normalization succeeds; retry needs no camera cache', async t => {
  const f = await diskFixture(t), repository = f.make(), session = await repository.createSession('stage');
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
  await repository.clearActiveSession(); const next = await repository.createSession('next');
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
