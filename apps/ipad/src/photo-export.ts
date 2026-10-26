import type { ActiveSession, PhotoExportStatus, PhotoLibraryCapability } from './local-types';
export interface PhotoLibraryPort {
  capability(): Promise<PhotoLibraryCapability>;
  requestAddPermission(): Promise<PhotoLibraryCapability>;
  save(uri: string): Promise<void>;
}
export interface ExportSessions {
  get(id: string): Promise<ActiveSession | null>;
  update(sessionId: string, photoId: string, status: PhotoExportStatus): Promise<ActiveSession | null>;
}
export type PhotoExportOptions = { requestPermission?: boolean; retryUncertain?: boolean; photoIds?: string[]; includeRetakes?: boolean };
export function createPhotoExporter(library: PhotoLibraryPort, sessions: ExportSessions) {
  let running: Promise<unknown> = Promise.resolve();
  return {
    capability: () => library.capability(),
    exportSession(session: ActiveSession, options: PhotoExportOptions = {}): Promise<ActiveSession> {
      const operation = running.catch(() => {}).then(async () => {
        const initial = await sessions.get(session.id);
        if (!initial) throw new Error('The local session is unavailable (export-session).');
        const candidates = (value: ActiveSession) => [...value.shots, ...(options.includeRetakes === true ? value.retakes ?? [] : [])].filter(photo => !options.photoIds || options.photoIds.includes(photo.id));
        const targets = candidates(initial);
        if (targets.every(photo => photo.exportStatus === 'saved' || (photo.exportStatus === 'uncertain' && options.retryUncertain !== true))) return initial;
        let capability: PhotoLibraryCapability;
        try {
          capability = await library.capability();
          if (capability.available && capability.permission === 'undetermined' && capability.canAskAgain && options.requestPermission === true) {
            capability = await library.requestAddPermission();
          }
        } catch { capability = { available: false, permission: 'undetermined', canAskAgain: false, writeOnly: true }; }
        const outcomes = new Map<string, PhotoExportStatus>();
        for (const photo of targets) {
          const current = await sessions.get(initial.id);
          const selected = current && candidates(current).find(item => item.id === photo.id);
          if (!selected || selected.exportStatus === 'saved' || (selected.exportStatus === 'uncertain' && options.retryUncertain !== true)) continue;
          let status: PhotoExportStatus = !capability.available ? 'unavailable' : capability.permission === 'denied' ? 'denied' : 'pending';
          if (status === 'pending' && capability.permission === 'granted') {
            // A durable uncertainty marker precedes the non-idempotent native
            // write. After termination, never automatically create a duplicate.
            try { await sessions.update(initial.id, selected.id, 'uncertain'); }
            catch { outcomes.set(selected.id, 'uncertain'); continue; }
            try {
              const uri = new URL(selected.fileUri);
              if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.endsWith('.jpg')) throw new Error('Local original required');
              await library.save(selected.fileUri);
              status = 'saved';
            } catch { status = 'failed'; }
          }
          try { await sessions.update(initial.id, selected.id, status); }
          catch { status = 'uncertain'; }
          outcomes.set(selected.id, status);
        }
        const result = await sessions.get(initial.id) ?? initial;
        // This overlay is honest even if the export-status journal could not be
        // written. Never return a stale whole-session snapshot to storage.
        const overlay = (photo: ActiveSession['shots'][number]) => outcomes.has(photo.id) ? { ...photo, exportStatus: outcomes.get(photo.id)! } : photo;
        return { ...result, shots: result.shots.map(overlay), retakes: result.retakes?.map(overlay) };
      });
      running = operation;
      return operation;
    },
  };
}
