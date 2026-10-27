export type HostOriginal = { id: string; exportStatus?: string };
export type HostOriginalSession = { id: string; shots: HostOriginal[]; retakes?: HostOriginal[]; composite?: HostOriginal; stagedOriginals?: HostOriginal[]; storageWarning?: string };
export type HostOriginalRequest =
  | { kind: 'acknowledge' | 'export'; sessionId: string; photoId: string; retained: boolean; duplicateRiskAccepted?: boolean }
  | { kind: 'finish-save'; sessionId: string };
export type HostExportOptions = { includeComposite?: boolean; photoIds: string[]; includeRetakes: boolean; requestPermission: true; retryUncertain: boolean; assertCurrent: () => void };
export type HostOriginalResult<S> = { kind: 'updated' | 'already-saved'; session: S } | { kind: 'busy' } | { kind: 'confirm-duplicate'; request: HostOriginalRequest };

export const INDEX_REPAIR_DIAGNOSTIC = 'Originals and the recovery journal are saved. The sharing index is waiting for repair.';
export function indexRepairSessions<T extends HostOriginalSession>(sessions: (T | null)[]): T[] {
  const pending = new Map<string, T>();
  for (const session of sessions) if (session?.storageWarning === 'index-repair-pending') pending.set(session.id, session);
  return [...pending.values()];
}
export function queueIndexStatus(pendingSessions: number, invalidRows: number): string | null {
  if (!pendingSessions && !invalidRows) return null;
  const notes: string[] = [];
  if (pendingSessions) notes.push(`${pendingSessions} saved ${pendingSessions === 1 ? 'session needs' : 'sessions need'} upload-index repair.`);
  if (invalidRows) notes.push(`${invalidRows} quarantined upload-index ${invalidRows === 1 ? 'row needs' : 'rows need'} host review. Other valid uploads can continue.`);
  notes.push('Originals remain on this iPad. A zero visible queue does not mean sharing is complete.');
  return notes.join(' ');
}
export function hostOriginalStatus(photo: HostOriginal): string {
  if (photo.exportStatus === 'saved') return 'Exported to Photos';
  if (photo.exportStatus === 'uncertain') return 'Photos result uncertain. Check Photos before marking or exporting again.';
  if (photo.exportStatus === 'denied') return 'Not exported · Photos permission needed';
  if (photo.exportStatus === 'failed') return 'Not exported · last attempt failed';
  if (photo.exportStatus === 'unavailable') return 'Photos export unavailable on this device';
  return 'Not exported to Photos';
}

// Host actions reserve immediately, authenticate before mutation, reload after
// authentication, and address exactly one selected or retained original.
export function createHostOriginalActions<S extends HostOriginalSession>(dependencies: {
  authenticate(): Promise<void>;
  assertCurrent(): void;
  load(id: string): Promise<S | null>;
  acknowledge(sessionId: string, photoId: string): Promise<S | null>;
  export(session: S, options: HostExportOptions): Promise<S>;
  finishSave(sessionId: string): Promise<S | null>;
}) {
  let running = false;
  function photoFor(session: S, request: Exclude<HostOriginalRequest, { kind: 'finish-save' }>) {
    const collection = request.retained ? session.retakes ?? [] : session.shots;
    const photo = collection.find(value => value.id === request.photoId) ?? (!request.retained && session.composite?.id === request.photoId ? session.composite : undefined);
    if (!photo) throw new Error('This original is not available in the selected host collection.');
    return photo;
  }
  return {
    async run(request: HostOriginalRequest): Promise<HostOriginalResult<S>> {
      if (running) return { kind: 'busy' };
      running = true;
      try {
        const initial = await dependencies.load(request.sessionId);
        if (!initial || initial.id !== request.sessionId) throw new Error('The local session is unavailable.');
        if (request.kind === 'finish-save') {
          if (!initial.stagedOriginals?.length) throw new Error('No captured originals are waiting for local save completion.');
        } else {
          const photo = photoFor(initial, request);
          if (request.kind === 'export' && photo.exportStatus === 'uncertain' && !request.duplicateRiskAccepted) return { kind: 'confirm-duplicate', request };
          if (request.kind === 'acknowledge' && photo.exportStatus !== 'uncertain' && photo.exportStatus !== 'saved') throw new Error('Only an uncertain Photos result can be acknowledged.');
        }
        await dependencies.authenticate();
        dependencies.assertCurrent();
        const current = await dependencies.load(request.sessionId);
        dependencies.assertCurrent();
        if (!current || current.id !== request.sessionId) throw new Error('The local session is unavailable.');
        if (request.kind === 'finish-save') {
          dependencies.assertCurrent();
          const updated = await dependencies.finishSave(current.id);
          dependencies.assertCurrent();
          if (!updated) throw new Error('The original still needs its local save completed.');
          const stagedIds = new Set(initial.stagedOriginals?.map(photo => photo.id));
          if (!updated.stagedOriginals?.length && ![...updated.shots, ...updated.retakes ?? []].some(photo => stagedIds.has(photo.id))) {
            throw new Error('The captured original is not available yet. Check local storage before continuing.');
          }
          return { kind: 'updated', session: updated };
        }
        const photo = photoFor(current, request);
        if (photo.exportStatus === 'saved') return { kind: 'already-saved', session: current };
        if (request.kind === 'acknowledge') {
          if (photo.exportStatus !== 'uncertain') throw new Error('The Photos result changed. Check this original again.');
          dependencies.assertCurrent();
          const updated = await dependencies.acknowledge(current.id, photo.id);
          dependencies.assertCurrent();
          if (!updated) throw new Error('The Photos acknowledgement could not be saved.');
          return { kind: 'updated', session: updated };
        }
        if (photo.exportStatus === 'uncertain' && !request.duplicateRiskAccepted) return { kind: 'confirm-duplicate', request };
        dependencies.assertCurrent();
        const updated = await dependencies.export(current, {
          photoIds: [photo.id], includeRetakes: request.retained, requestPermission: true,
          ...(!request.retained && current.composite?.id === photo.id ? { includeComposite: true } : {}),
          retryUncertain: photo.exportStatus === 'uncertain' && request.duplicateRiskAccepted === true,
          assertCurrent: dependencies.assertCurrent,
        });
        dependencies.assertCurrent();
        return { kind: 'updated', session: updated };
      } finally { running = false; }
    },
  };
}
