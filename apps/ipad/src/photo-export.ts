import { publicationAssets } from './publication';
import type { ActiveCapture, ActiveSession, PhotoExportStatus, PhotoLibraryCapability } from './local-types';
export interface PhotoLibraryPort {
  capability(): Promise<PhotoLibraryCapability>;
  requestAddPermission(): Promise<PhotoLibraryCapability>;
  save(uri: string): Promise<void>;
}
export interface ExportSessions {
  get(id: string): Promise<ActiveSession | null>;
  update(sessionId: string, photoId: string, status: PhotoExportStatus): Promise<ActiveSession | null>;
}
// Only the current, lineage-valid, committed JPEG is a Photos candidate.
// Staged and superseded composites never enter the original-shot collections.
export function compositeExportCapture(session: ActiveSession): ActiveCapture | null {
  const composite = session.composite;
  if (!composite || !Number.isFinite(session.createdAt) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(composite.id)) return null;
  try {
    const uri = new URL(composite.fileUri);
    if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.endsWith(`/photobooth/${composite.id}.jpg`) ||
      !publicationAssets({ ...session, confirmed: true })?.composite) return null;
  } catch { return null; }
  return { id: composite.id, fileUri: composite.fileUri, sessionId: session.id,
    createdAt: session.createdAt, confirmed: session.confirmed, exportStatus: composite.exportStatus };
}
export type PhotoExportOptions = { includeComposite?: boolean; requestPermission?: boolean; retryUncertain?: boolean; photoIds?: string[]; includeRetakes?: boolean; assertCurrent?: () => void };
export function createPhotoExporter(library: PhotoLibraryPort, sessions: ExportSessions) {
  let running: Promise<unknown> = Promise.resolve();
  return {
    capability: () => library.capability(),
    exportSession(session: ActiveSession, options: PhotoExportOptions = {}): Promise<ActiveSession> {
      const operation = running.catch(() => {}).then(async () => {
        options.assertCurrent?.();
        const initial = await sessions.get(session.id);
        options.assertCurrent?.();
        if (!initial) throw new Error('The local session is unavailable (export-session).');
        const candidates = (value: ActiveSession) => {
          const composite = options.includeComposite === true ? compositeExportCapture(value) : null;
          // Explicit selection is required for composite export. Including a
          // composite flag alone must not turn original batch retries into a copy.
          return [...value.shots, ...(options.includeRetakes === true ? value.retakes ?? [] : []),
            ...(composite && options.photoIds?.includes(composite.id) ? [composite] : [])]
            .filter(photo => !options.photoIds || options.photoIds.includes(photo.id));
        };
        const targets = candidates(initial);
        if (targets.every(photo => photo.exportStatus === 'saved' || (photo.exportStatus === 'uncertain' && options.retryUncertain !== true))) return initial;
        let capability: PhotoLibraryCapability;
        try {
          capability = await library.capability();
        } catch { capability = { available: false, permission: 'undetermined', canAskAgain: false, writeOnly: true }; }
        options.assertCurrent?.();
        if (capability.available && capability.permission === 'undetermined' && capability.canAskAgain && options.requestPermission === true) {
          try { capability = await library.requestAddPermission(); }
          catch { capability = { available: false, permission: 'undetermined', canAskAgain: false, writeOnly: true }; }
        }
        options.assertCurrent?.();
        const outcomes = new Map<string, PhotoExportStatus>();
        for (const photo of targets) {
          const current = await sessions.get(initial.id);
          options.assertCurrent?.();
          const selected = current && candidates(current).find(item => item.id === photo.id);
          if (!selected || selected.exportStatus === 'saved' || (selected.exportStatus === 'uncertain' && options.retryUncertain !== true)) continue;
          let status: PhotoExportStatus = !capability.available ? 'unavailable' : capability.permission === 'denied' ? 'denied' : 'pending';
          if (status === 'pending' && capability.permission === 'granted') {
            // A durable uncertainty marker precedes the non-idempotent native
            // write. After termination, never automatically create a duplicate.
            try {
              const marked = await sessions.update(initial.id, selected.id, 'uncertain');
              if (!marked || !candidates(marked).some(item => item.id === selected.id && item.exportStatus === 'uncertain')) throw new Error('Photos journal unavailable');
            }
            catch { outcomes.set(selected.id, 'uncertain'); continue; }
            try { options.assertCurrent?.(); }
            catch (error) {
              // The uncertainty journal was written but no native copy began.
              // Preserve an earlier uncertain copy when this was an explicit
              // retry; revocation must never remove its duplicate protection.
              // Otherwise failed is retryable because no native copy began.
              try { await sessions.update(initial.id, selected.id, selected.exportStatus === 'uncertain' ? 'uncertain' : 'failed'); }
              catch { /* Keep the durable uncertainty marker. */ }
              throw error;
            }
            try {
              const uri = new URL(selected.fileUri);
              if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.endsWith('.jpg')) throw new Error('Local original required');
              await library.save(selected.fileUri);
              status = 'saved';
            } catch { status = 'failed'; }
          }
          try {
            const updated = await sessions.update(initial.id, selected.id, status);
            if (!updated) throw new Error('Photos journal unavailable');
          }
          catch { status = 'uncertain'; }
          outcomes.set(selected.id, status);
        }
        const result = await sessions.get(initial.id) ?? initial;
        options.assertCurrent?.();
        // This overlay is honest even if the export-status journal could not be
        // written. Never return a stale whole-session snapshot to storage.
        const overlay = (photo: ActiveSession['shots'][number]) => outcomes.has(photo.id) ? { ...photo, exportStatus: outcomes.get(photo.id)! } : photo;
        return { ...result, shots: result.shots.map(overlay), retakes: result.retakes?.map(overlay),
          ...(result.composite && outcomes.has(result.composite.id) ? { composite: { ...result.composite, exportStatus: outcomes.get(result.composite.id)! } } : {}) };
      });
      running = operation;
      return operation;
    },
  };
}
