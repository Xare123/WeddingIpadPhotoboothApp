import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { type QueueJob, type QueueStore } from '@wedding-booth/core';
import { ensureUploadJob, usableQueueRows } from './queue-index';
import { relativeDocumentPhotoPath, uploadDocumentPhotoPath } from './local-paths';
import { createNativeFilePorts } from './native-file-ports';
import { LocalRepository, type LocalIndex, type RenderedPhotoInput, type CompositeInput } from './local-persistence';
import type { ActiveCapture, ActiveSession, PhotoExportStatus, PhotoLook, PhotoCrop, CompositeRecipe, SessionComposite, SessionPublicationAssets } from './local-types';
export type { ActiveCapture, ActiveSession, PhotoExportStatus, PhotoLook, PhotoCrop, CompositeRecipe, SessionComposite, SessionPublicationAssets } from './local-types';

const photos = new Directory(Paths.document, 'photobooth');
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    const attempt = SQLite.openDatabaseAsync('photobooth.db').then(async db => {
      await db.execAsync(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS job_quarantine (job_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(job_id, payload));
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);`);
      return db;
    });
    opening = attempt;
    void attempt.catch(() => { if (opening === attempt) opening = undefined; });
  }
  return opening;
}
export function documentPhotoURI(path: string): string {
  if (!/^photobooth\/[A-Za-z0-9_.-]+$/.test(path) || path.includes('..')) throw new Error('Invalid local photo path');
  return new File(Paths.document, path).uri;
}
const relativePhotoPath = relativeDocumentPhotoPath;
function hydrateJob(job: QueueJob): QueueJob {
  if (job.kind !== 'upload') return job;
  let path = uploadDocumentPhotoPath(job.photoId, job.fileUri);
  if (!new File(documentPhotoURI(path)).exists) {
    const candidates = [path.endsWith('.draft.jpg') ? path.replace(/\.draft\.jpg$/, '.jpg') : path.replace(/\.jpg$/, '.draft.jpg')];
    for (const alternate of candidates) if (new File(documentPhotoURI(alternate)).exists) { path = alternate; break; }
  }
  return { ...job, fileUri: documentPhotoURI(path) };
}
function serializeJob(job: QueueJob): QueueJob {
  return job.kind === 'upload' ? { ...job, fileUri: relativePhotoPath(job.fileUri) } : job;
}
export const store: QueueStore = {
  async list() {
    const rows = await (await database()).getAllAsync<{ id: string; payload: string }>('SELECT id, payload FROM jobs');
    const result = await usableQueueRows(await database(), rows, hydrateJob);
    repository.reportQueueIndexIssues(result.invalidRows);
    return result.jobs;
  },
  async save(job) {
    await (await database()).runAsync('INSERT INTO jobs(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', job.id, JSON.stringify(serializeJob(job)));
  },
};
const files = createNativeFilePorts<File>({
  uri: documentPhotoURI,
  file: uri => new File(uri),
  directory: photos,
  isFile: (entry): entry is File => entry instanceof File,
});
const index: LocalIndex = {
  async read(key) { const row = await (await database()).getFirstAsync<{ payload: string }>('SELECT payload FROM metadata WHERE key = ?', key); return row ? JSON.parse(row.payload) as unknown : null; },
  async write(key, value) {
    if (value === null) { await (await database()).runAsync('DELETE FROM metadata WHERE key = ?', key); return; }
    await (await database()).runAsync('INSERT INTO metadata(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload', key, JSON.stringify(value));
  },
  async ensureJob(job) {
    await ensureUploadJob(await database(), serializeJob(job));
  },
};
const repository = new LocalRepository(files, index, randomUUID);
export const createSession = (id?: string, targetCount = 4) => repository.createSession(id, targetCount);
export const getActiveSession = () => repository.getActiveSession();
export const getLocalSession = (id: string) => repository.getSession(id);
export const saveShot = (session: ActiveSession | string, photoId: string, temporaryUri: string, index?: number) => repository.saveShot(session, photoId, temporaryUri, index);
export const saveRenderedPhoto = (sessionId: string, input: RenderedPhotoInput) => repository.saveRenderedPhoto(sessionId, input);
export const selectSavedPhoto = (sessionId: string, photoId: string, slot: number, expectedSelectedPhotoId: string) => repository.selectSavedPhoto(sessionId, photoId, slot, expectedSelectedPhotoId);
export const saveComposite = (sessionId: string, input: CompositeInput) => repository.saveComposite(sessionId, input);
export const getSessionPublicationAssets = (sessionId: string) => repository.getSessionPublicationAssets(sessionId);
export const confirmSession = (session: ActiveSession | string) => repository.confirmSession(session);
export const clearActiveSession = () => repository.clearActiveSession();
export const getQueueIndexDiagnostics = () => repository.queueIndexDiagnostics();
export const listLocalSessions = () => repository.listLocalSessions();
export const updatePhotoExport = (sessionId: string, photoId: string, status: PhotoExportStatus) => repository.updateExport(sessionId, photoId, status);
export const retryStagedComposites = (sessionId: string) => repository.retryStagedComposites(sessionId);
export const retryStagedPhotos = (sessionId: string) => repository.retryStagedPhotos(sessionId);
export const reconcileConfirmedPhotos = (): Promise<void> => repository.reconcileConfirmedPhotos();
export const recoverPreservedPhotos = () => repository.recover();
export const getActiveCapture = () => repository.getActiveCapture();
export const setActiveCapture = (capture: ActiveCapture | null) => repository.setActiveCapture(capture);
export async function preserveCapture(id: string, temporaryUri: string): Promise<ActiveCapture> {
  const session = await repository.createSession(id, 1);
  return (await repository.saveShot(session, id, temporaryUri, 0)).shots[0]!;
}
export async function confirmCapture(capture: ActiveCapture): Promise<ActiveCapture> {
  return (await repository.confirmSession(capture.sessionId ?? capture.id)).shots.find(photo => photo.id === capture.id)!;
}
