import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { type QueueJob, type QueueStore, uploadJob } from '@wedding-booth/core';

export type ActiveCapture = { id: string; fileUri: string; confirmed: boolean; createdAt: number };
const photos = new Directory(Paths.document, 'photobooth');
const database = SQLite.openDatabaseAsync('photobooth.db').then(async db => {
  await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);`);
  return db;
});

export const store: QueueStore = {
  async list() {
    const rows = await (await database).getAllAsync<{ payload: string }>('SELECT payload FROM jobs');
    return rows.map(row => JSON.parse(row.payload) as QueueJob);
  },
  async save(job) {
    await (await database).runAsync('INSERT INTO jobs(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', job.id, JSON.stringify(job));
  },
};

export async function getActiveCapture(): Promise<ActiveCapture | null> {
  const row = await (await database).getFirstAsync<{ payload: string }>('SELECT payload FROM metadata WHERE key = ?', 'active');
  return row ? JSON.parse(row.payload) as ActiveCapture : null;
}

export async function setActiveCapture(capture: ActiveCapture | null): Promise<void> {
  if (capture) {
    await (await database).runAsync('INSERT INTO metadata(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload', 'active', JSON.stringify(capture));
  } else {
    await (await database).runAsync('DELETE FROM metadata WHERE key = ?', 'active');
  }
}

// Only confirmed .jpg filenames form the upload recovery journal. Draft originals
// survive retakes and restarts but are never silently uploaded.
export async function recoverPreservedPhotos(): Promise<void> {
  photos.create({ idempotent: true, intermediates: true });
  const known = new Set((await store.list()).filter(job => job.kind === 'upload').map(job => job.photoId));
  const active = await getActiveCapture();
  for (const entry of photos.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.jpg') || entry.name.endsWith('.draft.jpg') || entry.size === 0) continue;
    const id = entry.name.slice(0, -4);
    if (!known.has(id)) await store.save(uploadJob(id, entry.uri));
    if (active?.id === id && !active.confirmed) {
      await setActiveCapture({ ...active, fileUri: entry.uri, confirmed: true });
    }
  }
}

export async function preserveCapture(id: string, temporaryUri: string): Promise<ActiveCapture> {
  photos.create({ idempotent: true, intermediates: true });
  const staging = new File(photos, `${id}.partial`);
  new File(temporaryUri).copy(staging);
  if (staging.size === 0) throw new Error('The camera returned an empty image');
  const original = new File(photos, `${id}.draft.jpg`);
  staging.move(original);
  const capture = { id, fileUri: original.uri, confirmed: false, createdAt: Date.now() };
  await setActiveCapture(capture);
  return capture;
}

export async function confirmCapture(capture: ActiveCapture): Promise<ActiveCapture> {
  const confirmed = new File(photos, `${capture.id}.jpg`);
  if (!confirmed.exists) new File(capture.fileUri).move(confirmed);
  const saved = { ...capture, fileUri: confirmed.uri, confirmed: true };
  // Journal the confirmed file first; recovery reconstructs the queue if the
  // process stops between the rename and this database write.
  if (!(await store.list()).some(job => job.kind === 'upload' && job.id === capture.id)) {
    await store.save(uploadJob(capture.id, confirmed.uri));
  }
  await setActiveCapture(saved);
  return saved;
}
