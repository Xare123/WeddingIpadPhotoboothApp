import type { QueueJob } from '@wedding-booth/core';

export const RECIPIENT_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RECIPIENT_INDEX_LIMIT = 16;
type Reservation = { ref: string; createdAt: number };
export interface RecipientRetentionPorts {
  readIndex(): Promise<string | null>;
  writeIndex(value: string): Promise<void>;
  writeSecret(ref: string, phone: string): Promise<void>;
  deleteSecret(ref: string): Promise<void>;
  listJobs(): Promise<QueueJob[]>;
  saveJob(job: QueueJob): Promise<void>;
}

// One owner serializes reservations, job writes and reconciliation. A failed or
// interrupted write remains indexed; never infer that a rejected DB write did
// not commit. A fresh successful DB read is required before deleting anything.
export class RecipientRetention {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private ports: RecipientRetentionPorts, private now = Date.now) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result;
  }
  private async index(): Promise<Reservation[]> {
    const raw = await this.ports.readIndex();
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > RECIPIENT_INDEX_LIMIT || value.some(entry =>
      !entry || typeof entry.ref !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(entry.ref) ||
      !Number.isFinite(entry.createdAt) || entry.createdAt < 0) ||
      new Set(value.map(entry => entry.ref)).size !== value.length) {
      throw new Error('Recipient retention index is unavailable');
    }
    return value;
  }
  private async reconcile(): Promise<Reservation[]> {
    let entries = await this.index();
    const jobs = await this.ports.listJobs(); // Fail closed during DB outages.
    const pending = new Set(jobs.flatMap(job => job.kind === 'share' && job.state === 'pending' ? [job.recipientRef] : []));
    const completed = new Set(jobs.flatMap(job => job.kind === 'share' && job.state !== 'pending' ? [job.recipientRef] : []));
    const removable = new Set(entries.filter(entry => !pending.has(entry.ref) &&
      (completed.has(entry.ref) || this.now() - entry.createdAt >= RECIPIENT_ORPHAN_MAX_AGE_MS)).map(entry => entry.ref));
    // Also clean completed jobs created before the index existed.
    for (const ref of completed) if (!pending.has(ref)) removable.add(ref);
    for (const ref of removable) {
      await this.ports.deleteSecret(ref);
      const next = entries.filter(entry => entry.ref !== ref);
      if (next.length !== entries.length) {
        await this.ports.writeIndex(JSON.stringify(next));
        entries = next;
      }
    }
    return entries;
  }
  cleanup(): Promise<void> { return this.exclusive(async () => { await this.reconcile(); }); }
  queue(job: QueueJob & { kind: 'share' }, phone: string): Promise<void> {
    return this.exclusive(async () => {
      const entries = await this.reconcile();
      if (entries.length >= RECIPIENT_INDEX_LIMIT || entries.some(entry => entry.ref === job.recipientRef)) {
        throw new Error('Recipient retention capacity is unavailable');
      }
      await this.ports.writeIndex(JSON.stringify([...entries, { ref: job.recipientRef, createdAt: this.now() }]));
      await this.ports.writeSecret(job.recipientRef, phone);
      await this.ports.saveJob(job);
    });
  }
}
