export type QueueJob = {
  id: string;
  photoId: string;
  sessionId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: 'pending' | 'complete' | 'mocked';
  guestUrl?: string;
  guestExpiresAt?: number;
} & (
  | { kind: 'upload'; fileUri: string }
  | { kind: 'share'; uploadJobId: string; recipientRef: string; consentedAt: number }
);

export interface QueueStore {
  list(): Promise<QueueJob[]>;
  save(job: QueueJob): Promise<void>;
}

export interface QueueTransport {
  upload(job: Extract<QueueJob, { kind: 'upload' }>): Promise<{ guestUrl: string; guestExpiresAt?: number } | void>;
  // Implementations must resolve recipientRef from a secure vault, never logs.
  // 'mocked' is a distinct outcome and must never be displayed as sent.
  share(job: Extract<QueueJob, { kind: 'share' }>): Promise<'accepted' | 'mocked'>;
}

export function uploadJob(id: string, fileUri: string, now = Date.now(), sessionId = id): QueueJob {
  if (!fileUri.startsWith('file://')) throw new Error('A durable local file is required');
  return { id, photoId: id, sessionId, kind: 'upload', fileUri, createdAt: now,
    attempts: 0, nextAttemptAt: now, state: 'pending' };
}

// Single foreground consumer. Callers serialize drains. Unfinished jobs remain
// pending after termination; replay uses the same idempotency IDs on the server.
export async function drainQueue(
  store: QueueStore, transport: QueueTransport, now = Date.now(),
): Promise<void> {
  const jobs = await store.list();
  const completedUploads = new Set(jobs.filter(job =>
    job.kind === 'upload' && job.state === 'complete').map(job => job.id));
  for (const job of jobs.sort((a, b) => a.createdAt - b.createdAt)) {
    if (job.state !== 'pending' || job.nextAttemptAt > now) continue;
    if (job.kind === 'share' && !completedUploads.has(job.uploadJobId)) continue;
    try {
      let state: QueueJob['state'] = 'complete';
      let guest: { guestUrl: string; guestExpiresAt?: number } | void = undefined;
      if (job.kind === 'upload') {
        guest = await transport.upload(job);
      } else {
        if (!job.consentedAt || !job.recipientRef) throw new Error('Consent and secure recipient reference required');
        if (await transport.share(job) === 'mocked') state = 'mocked';
      }
      await store.save({ ...job, ...guest, state });
      if (job.kind === 'upload') completedUploads.add(job.id);
    } catch {
      // Do not persist provider errors: they can contain phone numbers or links.
      const attempts = job.attempts + 1;
      const delay = Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 12));
      await store.save({ ...job, attempts, nextAttemptAt: now + delay });
    }
  }
}
