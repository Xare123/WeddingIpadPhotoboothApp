export type QueueJob = {
  id: string;
  photoId: string;
  sessionId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: 'pending' | 'complete' | 'mocked' | 'test_accepted' | 'uncertain' | 'rejected' | 'expired';
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
  share(job: Extract<QueueJob, { kind: 'share' }>): Promise<'accepted' | 'mocked' | 'test_accepted' | 'uncertain' | 'rejected' | 'expired'>;
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
        const outcome = await transport.share(job);
        // Provider acceptance is not delivery. Uncertain sends must not replay:
        // the server retains its matching session/request guard as well.
        state = outcome === 'accepted' ? 'complete' : outcome;
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

export function createQueueConsumer(
  store: QueueStore,
  transport: QueueTransport,
  afterDrain: () => Promise<void> = async () => {},
  clock: () => number = Date.now,
): { sync(): Promise<void>; retry(): Promise<void> } {
  let running: Promise<void> | undefined;
  let retrying: Promise<void> | undefined;

  async function consume(resetBackoff: boolean) {
    // Reset and drain share the same reservation. A timer/foreground sync must
    // never complete a job while an older retry snapshot can still overwrite it.
    if (resetBackoff) {
      for (const job of await store.list()) {
        if (job.state === 'pending') await store.save({ ...job, nextAttemptAt: 0 });
      }
    }
    await drainQueue(store, transport, clock());
    await afterDrain();
  }

  function reserve(operation: Promise<void>): Promise<void> {
    running = operation;
    const release = () => { if (running === operation) running = undefined; };
    void operation.then(release, release);
    return operation;
  }

  return {
    sync() {
      return running ?? reserve(Promise.resolve().then(() => consume(false)));
    },
    retry() {
      if (retrying) return retrying;
      const previous = running ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(() => consume(true));
      retrying = reserve(operation);
      const release = () => { if (retrying === operation) retrying = undefined; };
      void operation.then(release, release);
      return operation;
    },
  };
}
