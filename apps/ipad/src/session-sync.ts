import type { QueueJob, QueueStore } from '@wedding-booth/core';
import { readyGuestPage, sessionGuestPage } from './sharing';

export type ShareableSession = {
  id: string; confirmed: boolean; shots: { id: string }[];
};

type FinalizationPorts = {
  store: QueueStore;
  sessions(): Promise<ShareableSession[]>;
  ready(sessionId: string, photoIds: string[]): Promise<{ value: unknown; origin: string }>;
};

export async function finalizeReadySessions(ports: FinalizationPorts, now = Date.now()): Promise<void> {
  for (const session of await ports.sessions()) {
    // Older one-shot originals remain available in the local library; new
    // galleries contain the complete, confirmed five-shot selection.
    if (!session.confirmed || session.shots.length !== 5 || new Set(session.shots.map(s => s.id)).size !== 5) continue;
    const jobs = await ports.store.list();
    if (sessionGuestPage(session, jobs, now)) continue;
    const selected = session.shots.map(shot => jobs.find(job =>
      job.kind === 'upload' && job.sessionId === session.id && job.photoId === shot.id));
    if (selected.some(job => !job || job.state !== 'complete')) continue;
    try {
      const response = await ports.ready(session.id, session.shots.map(shot => shot.id));
      const guest = readyGuestPage(response.value, response.origin, now);
      for (const job of selected as QueueJob[]) await ports.store.save({ ...job, ...guest });
    } catch {
      // Preserve every local original and acknowledged upload. A later drain
      // repeats only the idempotent ready request, never creates new identities.
      // Provider/network error text can contain private capability links.
    }
  }
}
