import { parseQueueFailure, type QueueJob } from '@wedding-booth/core';

export interface QueueDatabase {
  getFirstAsync<T>(sql: string, ...parameters: string[]): Promise<T | null>;
  runAsync(sql: string, ...parameters: string[]): Promise<{ changes: number }>;
}
export class QueueIndexError extends Error {
  constructor(readonly stage: string) { super(`The local upload index needs repair (${stage}).`); }
}
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value);
const recipientReference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const states = new Set(['pending', 'complete', 'mocked', 'test_accepted', 'uncertain', 'rejected', 'expired']);
// URI is deliberately checked separately: a damaged/stale path does not erase
// a trustworthy acknowledgment or retry history for the same upload identity.
export function parseQueuePayload(payload: string, id: string): QueueJob | undefined {
  try {
    const job = JSON.parse(payload);
    if (!job || !identity(id) || job.id !== id || !identity(job.photoId) || !identity(job.sessionId) ||
      !Number.isFinite(job.createdAt) || job.createdAt < 0 || !Number.isFinite(job.nextAttemptAt) || job.nextAttemptAt < 0 ||
      !Number.isSafeInteger(job.attempts) || job.attempts < 0 || !states.has(job.state)) return undefined;
    if (job.lastFailure !== undefined) {
      const diagnostic = parseQueueFailure(job.lastFailure);
      if (diagnostic) job.lastFailure = diagnostic; else delete job.lastFailure;
    }
    if (job.kind === 'upload' && job.id === job.photoId && (job.state === 'pending' || job.state === 'complete')) return job as QueueJob;
    if (job.kind === 'share' && identity(job.uploadJobId) && recipientReference(job.recipientRef) && Number.isFinite(job.consentedAt) && job.consentedAt > 0) return job as QueueJob;
  } catch { /* The original payload is quarantined by the authoritative repair. */ }
  return undefined;
}
export async function ensureUploadJob(db: QueueDatabase, expected: QueueJob): Promise<void> {
  if (expected.kind !== 'upload' || expected.id !== expected.photoId || !/^photobooth\/[A-Za-z0-9_-]+(?:\.draft)?\.jpg$/.test(expected.fileUri)) throw new QueueIndexError('canonical-original');
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM jobs WHERE id = ?', expected.id);
    if (!row) {
      const inserted = await db.runAsync('INSERT INTO jobs(id, payload) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', expected.id, JSON.stringify(expected));
      if (inserted.changes) return;
      continue;
    }
    const parsed = parseQueuePayload(row.payload, expected.id);
    const matching = parsed?.kind === 'upload' && parsed.photoId === expected.photoId && parsed.sessionId === expected.sessionId;
    if (matching && parsed.fileUri === expected.fileUri) return;
    if (!matching) {
      // Retain the exact observed corrupt row. Both quarantine and replacement
      // compare the prior payload, so concurrent completion always wins.
      await db.runAsync('INSERT OR IGNORE INTO job_quarantine(job_id, payload) SELECT id, payload FROM jobs WHERE id = ? AND payload = ?', expected.id, row.payload);
    }
    const replacement = matching ? { ...parsed, fileUri: expected.fileUri } : expected;
    const changed = await db.runAsync('UPDATE jobs SET payload = ? WHERE id = ? AND payload = ?', JSON.stringify(replacement), expected.id, row.payload);
    if (changed.changes) return;
  }
  throw new QueueIndexError('concurrent-repair');
}

export async function usableQueueRows(db: QueueDatabase, rows: { id: string; payload: string }[], hydrate: (job: QueueJob) => QueueJob): Promise<{ jobs: QueueJob[]; invalidRows: number }> {
  const jobs: QueueJob[] = [];
  let invalidRows = 0;
  for (const row of rows) {
    const parsed = parseQueuePayload(row.payload, row.id);
    if (parsed) {
      try { jobs.push(hydrate(parsed)); continue; } catch { /* Preserve and report the unusable row below. */ }
    }
    invalidRows++;
    await db.runAsync('INSERT OR IGNORE INTO job_quarantine(job_id, payload) SELECT id, payload FROM jobs WHERE id = ? AND payload = ?', row.id, row.payload);
  }
  return { jobs, invalidRows };
}
