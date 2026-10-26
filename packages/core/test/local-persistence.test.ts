import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository, type LocalFiles, type LocalIndex } from '../../../apps/ipad/src/local-persistence';
import { createPhotoExporter } from '../../../apps/ipad/src/photo-export';
import { rebaseDocumentPhotoURI, relativeDocumentPhotoPath } from '../../../apps/ipad/src/local-paths';
import type { PhotoLibraryCapability } from '../../../apps/ipad/src/local-types';
import type { QueueJob } from '../src/index';

function fixture() {
  const disk = new Map<string, Uint8Array>();
  const metadata = new Map<string, unknown>();
  const jobs = new Map<string, QueueJob>();
  const source = 'file:///cache/camera.jpg';
  disk.set(source, new Uint8Array([255, 216, 1, 2, 255, 217]));
  let container = 'container-a', nonce = 0;
  const counts = { list: 0, stat: 0, read: 0, write: 0, copy: 0 };
  const faults: { copy?: boolean; truncated?: boolean; move?: boolean; index?: boolean; queue?: boolean; nullSize?: boolean;
    journal?: (path: string, text: string) => boolean } = {};
  const key = (uri: string) => uri.includes('/Documents/') ? uri.split('/Documents/')[1]! : uri;
  const files: LocalFiles = {
    uri: path => `file:///${container}/Documents/${path}`,
    async ensureDirectory() {},
    async list() { counts.list++; return [...disk.keys()].filter(path => path.startsWith('photobooth/')).map(path => path.slice('photobooth/'.length)); },
    async stat(uri) { counts.stat++; const value = disk.get(key(uri)); return { exists: !!value, size: faults.nullSize ? null : value?.byteLength ?? null }; },
    async copy(uri, destination) { counts.copy++; if (faults.copy) throw new Error('Disk full private-path'); const value = disk.get(key(uri)); if (!value) throw new Error('Missing source'); disk.set(destination, value.slice(0, faults.truncated ? 2 : undefined)); },
    async move(from, to) { if (faults.move) throw new Error('Move denied'); const value = disk.get(from); if (!value || disk.has(to)) throw new Error('Move failed'); disk.set(to, value); disk.delete(from); },
    async read(path) { counts.read++; const value = disk.get(path); if (!value) throw new Error('Missing journal'); return new TextDecoder().decode(value); },
    async write(path, text) { counts.write++; if (faults.journal?.(path, text)) throw new Error('Journal disk full'); disk.set(path, new TextEncoder().encode(text)); },
  };
  const index: LocalIndex = {
    async read(name) { if (faults.index) throw new Error('Database denied'); return metadata.get(name) ?? null; },
    async write(name, value) { if (faults.index) throw new Error('Database denied'); if (value === null) metadata.delete(name); else metadata.set(name, structuredClone(value)); },
    async ensureJob(job) { if (faults.queue) throw new Error('Queue database denied'); if (!jobs.has(job.id)) jobs.set(job.id, structuredClone(job)); },
  };
  const make = () => new LocalRepository(files, index, () => `nonce-${++nonce}`, () => 1000);
  return { disk, metadata, jobs, source, files, counts, faults, make, relocate() { container = 'container-b'; } };
}
async function five(f: ReturnType<typeof fixture>, repository = f.make(), id = 'session-one') {
  let session = await repository.createSession(id);
  for (let index = 0; index < 5; index++) session = await repository.saveShot(session, `${id}-photo-${index}`, f.source, index);
  return { repository, session };
}

test('every selected shot is a verified durable document original before confirmation or any queue/cloud call', async () => {
  const f = fixture(), repository = f.make();
  let session = await repository.createSession('five');
  for (let index = 0; index < 5; index++) {
    session = await repository.saveShot(session, `photo-${index}`, f.source, index);
    assert.equal(session.shots.length, index + 1);
    assert.equal(session.confirmed, false);
    assert.equal(f.jobs.size, 0);
    assert.ok(session.shots.every(photo => photo.fileUri.includes('/Documents/photobooth/')));
  }
  const confirmed = await repository.confirmSession(session);
  assert.equal(confirmed.confirmed, true);
  assert.equal(f.jobs.size, 5);
  assert.ok([...f.jobs.values()].every(job => job.sessionId === 'five'));
  assert.deepEqual(confirmed.shots.map(photo => photo.shotIndex), [0, 1, 2, 3, 4]);
});

test('null, empty, missing and truncated camera files never acknowledge a saved shot', async () => {
  for (const mode of ['null', 'empty', 'missing', 'truncated', 'disk-full']) {
    const f = fixture(), repository = f.make(), session = await repository.createSession('failure');
    if (mode === 'null') f.faults.nullSize = true;
    if (mode === 'empty') f.disk.set(f.source, new Uint8Array());
    if (mode === 'missing') f.disk.delete(f.source);
    if (mode === 'truncated') f.faults.truncated = true;
    if (mode === 'disk-full') f.faults.copy = true;
    await assert.rejects(repository.saveShot(session, 'photo', f.source, 0));
    f.faults.nullSize = false;
    assert.equal((await repository.getActiveSession())?.shots.length, 0);
    assert.equal(f.jobs.size, 0);
  }
});

test('a database outage cannot hide a verified capture or block relaunch recovery', async () => {
  const f = fixture(), repository = f.make(); f.faults.index = true;
  const session = await repository.createSession('offline-index');
  const saved = await repository.saveShot(session, 'photo', f.source, 0);
  assert.equal(saved.shots.length, 1);
  assert.equal(saved.storageWarning, 'index-repair-pending');
  const restored = f.make(); await restored.recover();
  assert.equal((await restored.getActiveSession())?.shots[0]?.id, 'photo');
  assert.equal((await restored.listLocalSessions()).length, 1);
});

test('a journal/index interruption after copying recovers the original and selected slot', async () => {
  const f = fixture(), repository = f.make(), session = await repository.createSession('interrupted');
  let failed = false;
  f.faults.journal = (_path, text) => { const value = JSON.parse(text); if (!failed && value.kind === 'session' && value.session.selected?.length) { failed = true; return true; } return false; };
  await assert.rejects(repository.saveShot(session, 'photo', f.source, 0), /journal-write/);
  f.faults.journal = undefined;
  const restored = f.make(); await restored.recover();
  assert.equal((await restored.getActiveSession())?.shots[0]?.id, 'photo');
  assert.equal((await restored.listLocalSessions())[0]?.shots.length, 1);
});

test('a fully copied staging file recovers after interruption before rename', async () => {
  const f = fixture(), repository = f.make(), session = await repository.createSession('stage');
  f.faults.move = true;
  await assert.rejects(repository.saveShot(session, 'photo', f.source, 0), /original-commit/);
  assert.ok(f.disk.has('photobooth/photo.partial'));
  f.faults.move = false;
  const restored = f.make(); await restored.recover();
  const capture = (await restored.getActiveSession())?.shots[0];
  assert.equal(capture?.id, 'photo');
  assert.ok(capture?.fileUri.endsWith('.jpg'));
});

test('retakes preserve old originals but only the latest five selections enter an immutable confirmed manifest', async () => {
  const f = fixture(), { repository, session } = await five(f);
  const retaken = await repository.saveShot(session, 'new-photo-zero', f.source, 0);
  assert.equal(retaken.retakes?.length, 1);
  assert.ok(f.disk.has('photobooth/session-one-photo-0.jpg'));
  const confirmed = await repository.confirmSession(retaken);
  assert.equal(confirmed.shots[0]?.id, 'new-photo-zero');
  assert.ok(!f.jobs.has('session-one-photo-0'));
  await assert.rejects(repository.saveShot(confirmed, 'late-retake', f.source, 0));
  const restored = f.make(); await restored.recover();
  assert.deepEqual((await restored.getActiveSession())?.shots.map(photo => photo.id), confirmed.shots.map(photo => photo.id));
});

test('confirmed session journals repair queue failures without resetting completed jobs', async () => {
  const f = fixture(), { repository, session } = await five(f);
  f.faults.queue = true;
  const confirmed = await repository.confirmSession(session);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.storageWarning, 'index-repair-pending');
  assert.equal(f.jobs.size, 0);
  f.faults.queue = false;
  const restored = f.make(); await restored.recover();
  assert.equal(f.jobs.size, 5);
  const first = f.jobs.values().next().value!; f.jobs.set(first.id, { ...first, state: 'complete' });
  await restored.recover();
  assert.equal(f.jobs.get(first.id)?.state, 'complete');
});

test('document-relative journals survive an iOS container change without retaining old absolute URIs', async () => {
  const f = fixture(), { session } = await five(f);
  const journals = [...f.disk.entries()].filter(([path]) => path.endsWith('.json')).map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n');
  assert.ok(!journals.includes('file://'));
  f.relocate();
  const restored = f.make(); await restored.recover();
  const recovered = await restored.getActiveSession();
  assert.ok(recovered?.shots.every(photo => photo.fileUri.startsWith('file:///container-b/')));
  assert.deepEqual(recovered?.shots.map(photo => photo.id), session.shots.map(photo => photo.id));
  assert.equal(relativeDocumentPhotoPath('file:///old-container/Documents/photobooth/photo.jpg'), 'photobooth/photo.jpg');
  assert.equal(rebaseDocumentPhotoURI('photobooth/photo.jpg', 'file:///new/Documents/'), 'file:///new/Documents/photobooth/photo.jpg');
});

test('Next guest clears selection durably while all saved sessions remain discoverable', async () => {
  const f = fixture(), { repository, session } = await five(f);
  await repository.confirmSession(session);
  await repository.clearActiveSession();
  assert.equal(await repository.getActiveSession(), null, 'warm cached state must also clear immediately');
  const restored = f.make(); await restored.recover();
  assert.equal(await restored.getActiveSession(), null);
  assert.equal((await restored.listLocalSessions()).length, 1);
});

test('steady-state shutter cost stays bounded after a hundred saved sessions', async () => {
  const f = fixture(), repository = f.make();
  for (let index = 0; index < 100; index++) {
    const session = await repository.createSession(`history-${index}`);
    await repository.saveShot(session, `history-photo-${index}`, f.source, 0);
  }
  const current = await repository.createSession('current');
  const before = { ...f.counts };
  await repository.saveShot(current, 'current-photo', f.source, 0);
  assert.equal(f.counts.list - before.list, 0);
  assert.ok(f.counts.stat - before.stat < 20);
  assert.ok(f.counts.read - before.read < 10);
});

const granted: PhotoLibraryCapability = { available: true, permission: 'granted', canAskAgain: true, writeOnly: true };
function exportPorts(repository: LocalRepository) { return { get: (id: string) => repository.getSession(id), update: (sessionId: string, photoId: string, status: Parameters<LocalRepository['updateExport']>[2]) => repository.updateExport(sessionId, photoId, status) }; }

test('Photos permission denial makes no library writes and never discards private originals', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let requests = 0, writes = 0;
  const exporter = createPhotoExporter({ async capability() { return { ...granted, permission: 'denied', canAskAgain: false }; },
    async requestAddPermission() { requests++; return granted; }, async save() { writes++; } }, exportPorts(repository));
  const result = await exporter.exportSession(session, { requestPermission: true });
  assert.equal(requests, 0); assert.equal(writes, 0);
  assert.ok(result.shots.every(photo => photo.exportStatus === 'denied'));
  assert.equal((await repository.getActiveSession())?.shots.length, 5);
});

test('Photos export records per-shot failures and skips already acknowledged saves on retry', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let failed = true, writes = 0;
  const exporter = createPhotoExporter({ async capability() { return granted; }, async requestAddPermission() { return granted; },
    async save(uri) { writes++; if (uri.includes('photo-1') && failed) throw new Error('Native Photos write denied'); } }, exportPorts(repository));
  const result = await exporter.exportSession(session);
  assert.deepEqual(result.shots.map(photo => photo.exportStatus), ['saved', 'failed', 'saved', 'saved', 'saved']);
  failed = false; await exporter.exportSession(result);
  assert.equal(writes, 6);
});

test('an export finishing after Next guest never reactivates the old guest or overwrites the new session', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let finish!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const exporter = createPhotoExporter({ async capability() { return granted; }, async requestAddPermission() { return granted; },
    async save() { started(); await blocked; } }, exportPorts(repository));
  const exporting = exporter.exportSession(session); await entered;
  await repository.clearActiveSession();
  const next = await repository.createSession('new-guest');
  finish(); await exporting;
  assert.equal((await repository.getActiveSession())?.id, next.id);
  assert.equal((await repository.getSession(session.id))?.shots[0]?.exportStatus, 'saved');
});

test('export status merges by photo ID while a same-session retake remains selected', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let finish!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  const exporter = createPhotoExporter({ async capability() { return granted; }, async requestAddPermission() { return granted; }, async save() { started(); await blocked; } }, exportPorts(repository));
  const exporting = exporter.exportSession(session); await entered;
  await repository.saveShot(session, 'retake-during-export', f.source, 0);
  finish(); await exporting;
  const current = await repository.getActiveSession();
  assert.equal(current?.shots[0]?.id, 'retake-during-export');
  assert.equal(current?.retakes?.find(photo => photo.id === session.shots[0]!.id)?.exportStatus, 'saved');
});

test('a failed confirmation journal cannot leak an uncommitted confirmed state from the cache', async () => {
  const f = fixture(), { repository, session } = await five(f);
  f.faults.journal = (_path, text) => { const record = JSON.parse(text); return record.kind === 'session' && record.session.confirmed; };
  await assert.rejects(repository.confirmSession(session), /journal-write/);
  f.faults.journal = undefined;
  assert.equal((await repository.getActiveSession())?.confirmed, false);
  assert.equal(f.jobs.size, 0);
  assert.equal((await repository.getActiveSession())?.shots.length, 5);
});

test('legacy confirmed-file interruption restores a valid preview and exactly one queue job even after index failure', async () => {
  const f = fixture(), repository = f.make();
  const legacy = await repository.createSession('legacy-photo', 1);
  const saved = await repository.saveShot(legacy, 'legacy-photo', f.source, 0);
  assert.ok(saved.shots[0]?.fileUri.endsWith('.draft.jpg'));
  await f.files.move('photobooth/legacy-photo.draft.jpg', 'photobooth/legacy-photo.jpg');
  f.faults.index = true;
  const restored = f.make(); await restored.recover();
  const capture = await restored.getActiveCapture();
  assert.equal(capture?.confirmed, true);
  assert.ok(capture?.fileUri.endsWith('/legacy-photo.jpg'));
  assert.equal(f.jobs.size, 1);
  await restored.recover();
  assert.equal(f.jobs.size, 1);
});

test('passive Photos export never prompts, and explicit add-only permission is requested once before writes', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let permission: PhotoLibraryCapability = { ...granted, permission: 'undetermined' }, requests = 0, writes = 0;
  const exporter = createPhotoExporter({ async capability() { return permission; }, async requestAddPermission() { requests++; permission = granted; return permission; }, async save() { writes++; } }, exportPorts(repository));
  const passive = await exporter.exportSession(session);
  assert.equal(requests, 0); assert.equal(writes, 0);
  assert.ok(passive.shots.every(photo => photo.exportStatus === 'pending'));
  const result = await exporter.exportSession(session, { requestPermission: true });
  assert.equal(requests, 1); assert.equal(writes, 5);
  assert.ok(result.shots.every(photo => photo.exportStatus === 'saved'));
});

test('Photos acknowledgment with a failed status journal is uncertain and never automatically duplicated', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let writes = 0, failStatus = true;
  const ports = exportPorts(repository);
  const exporter = createPhotoExporter({ async capability() { return granted; }, async requestAddPermission() { return granted; }, async save() { writes++; } }, {
    get: ports.get,
    async update(sessionId, photoId, status) {
      if (status === 'saved' && photoId.endsWith('photo-0') && failStatus) throw new Error('Status journal unavailable');
      return ports.update(sessionId, photoId, status);
    },
  });
  const result = await exporter.exportSession(session);
  assert.equal(result.shots[0]?.exportStatus, 'uncertain');
  assert.equal((await repository.getSession(session.id))?.shots[0]?.exportStatus, 'uncertain');
  assert.equal(writes, 5);
  await exporter.exportSession(session, { requestPermission: true });
  assert.equal(writes, 5, 'an uncertain native save must not be automatically repeated');
  failStatus = false;
  await exporter.exportSession(session, { requestPermission: true, retryUncertain: true });
  assert.equal(writes, 6, 'only an explicit duplicate-aware decision retries uncertainty');
});

test('the Photos uncertainty marker is durable before native saving and survives relaunch', async () => {
  const f = fixture(), { repository, session } = await five(f);
  let writes = 0;
  const exporter = createPhotoExporter({ async capability() { return granted; }, async requestAddPermission() { return granted; }, async save(uri) {
    writes++;
    const photo = (await repository.getSession(session.id))?.shots.find(item => item.fileUri === uri);
    assert.equal(photo?.exportStatus, 'uncertain');
  } }, exportPorts(repository));
  await exporter.exportSession(session);
  assert.equal(writes, 5);
  const restored = f.make(); await restored.recover();
  assert.ok((await restored.getSession(session.id))?.shots.every(photo => photo.exportStatus === 'saved'));
});
