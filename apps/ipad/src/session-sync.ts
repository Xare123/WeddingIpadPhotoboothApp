import type { QueueJob, QueueStore } from '@wedding-booth/core';
import { readyGuestPage, sessionGuestPage } from './sharing';
import { publicationAssets, publicationAssetIds, type PublicationSession } from './publication';
import type { SessionPublicationAssets } from './local-types';

export type ShareableSession = PublicationSession;

type FinalizationPorts = {
  store: QueueStore;
  sessions(): Promise<ShareableSession[]>;
  publicationAssets?(sessionId: string): Promise<SessionPublicationAssets>;
  ready(sessionId: string, photoIds: string[], descriptor?: SessionPublicationAssets): Promise<{ value: unknown; origin: string }>;
};

export async function finalizeReadySessions(ports: FinalizationPorts, now = Date.now()): Promise<void> {
  for (const session of await ports.sessions()) {
    const assets = publicationAssets(session);
    if (!assets || ![4, 5].includes(session.shots.length)) continue;
    const jobs = await ports.store.list();
    if (sessionGuestPage(session, jobs, now)) continue;
    const selected = publicationAssetIds(assets).map(photoId => jobs.find(job =>
      job.kind === 'upload' && job.sessionId === session.id && job.photoId === photoId));
    if (selected.some(job => !job || job.state !== 'complete')) continue;
    try {
      // Native repository rechecks immutable files and ownership immediately
      // before publication; a stale queue is never sufficient evidence.
      if (ports.publicationAssets) {
        const durable = await ports.publicationAssets(session.id);
        if (JSON.stringify(durable) !== JSON.stringify(assets)) continue;
      }
      const response = await ports.ready(session.id, assets.photoIds, assets);
      const guest = readyGuestPage(response.value, response.origin, now);
      for (const job of selected as QueueJob[]) await ports.store.save({ ...job, ...guest });
    } catch {
      // Preserve every local original and acknowledged upload. A later drain
      // repeats only the idempotent ready request, never creates new identities.
      // Provider/network error text can contain private capability links.
    }
  }
}
