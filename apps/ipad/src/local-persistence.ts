import { isCountdownSeconds, type CaptureTiming } from './capture-timing';
import { uploadJob, type QueueJob } from '@wedding-booth/core';
import type { ActiveCapture, ActiveSession, PhotoExportStatus, PhotoLook, PhotoTreatment, FaceAccessory, CompositeRecipe, SessionComposite, SessionPublicationAssets, RetakeSessionFields } from './local-types';
import { canonicalPhotoTreatment, isDerivedCapture, isPhotoTreatment, samePhotoTreatment } from './photo-treatment';
import { publicationComposite, validCompositeRecipe } from './publication';
export type { ActiveCapture, ActiveSession, PhotoExportStatus, PhotoLook, PhotoTreatment, FaceAccessory, CompositeRecipe, SessionComposite, SessionPublicationAssets, RetakeSessionFields } from './local-types';

type RenderedPhotoBase = { id: string; newRenderedURI: string; sourcePhotoId: string; expectedSelectedPhotoId: string; slot: number };
type LegacyRenderedPhotoInput = RenderedPhotoBase & { look: PhotoLook; treatment?: never; sourceSha256?: never; outputSha256?: never; admit?: never };
export type RenderedPhotoInput = LegacyRenderedPhotoInput | (RenderedPhotoBase & { treatment: PhotoTreatment; look?: never;
  sourceSha256: string; outputSha256: string; admit?: () => boolean });

export type RetakeAllInput = { id: string; expectedSelectedPhotoIds: string[]; timing: CaptureTiming };
export type CompositeInput = { id: string; newRenderedURI: string; recipe: CompositeRecipe; expectedSelectedPhotoIds: string[] };

export interface LocalFiles {
  uri(relative: string): string;
  sha256?(uri: string): Promise<string>;
  ensureDirectory(): Promise<void>;
  list(): Promise<string[]>;
  stat(uri: string): Promise<{ exists: boolean; size: number | null }>;
  copy(source: string, relative: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  read(relative: string): Promise<string>;
  write(relative: string, text: string): Promise<void>;
}
export interface LocalIndex {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown | null): Promise<void>;
  ensureJob(job: QueueJob): Promise<void>;
}
type CaptureRecord = Omit<ActiveCapture, 'fileUri'> & {
  relativePath: string; sessionId: string; shotIndex: number; bytes: number;
  selectionSequence: number; legacy?: boolean;
  selectionEligible?: false; sourceSha256?: string; outputSha256?: string;
};
type CompositeRecord = Omit<SessionComposite, 'fileUri'> & { sessionId: string; relativePath: string; bytes: number; createdAt: number; sequence: number };
type SessionRecord = RetakeSessionFields & { id: string; createdAt: number; targetCount: number; confirmed: boolean; selected: string[]; compositeId?: string };
type RecordData = { kind: 'composite'; composite: CompositeRecord } | { kind: 'capture'; capture: CaptureRecord } | { kind: 'session'; session: SessionRecord } |
  { kind: 'active'; sessionId: string | null; captureId: string | null };
type Journal = RecordData & { version: 1; sequence: number };
type Model = { reservedTreatmentIds: Set<string>; treatmentClaims: Map<string, CaptureRecord>; composites: Map<string, CompositeRecord>; captures: Map<string, CaptureRecord>; sessions: Map<string, SessionRecord>; sessionSequences: Map<string, number>;
  active: { sessionId: string | null; captureId: string | null } | null; hasActiveJournal: boolean; sequence: number; files: string[]; journaled: Set<string> };
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const positive = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const filename = (id: string, confirmed = false) => `photobooth/${id}${confirmed ? '' : '.draft'}.jpg`;
export class LocalSaveError extends Error {
  constructor(readonly stage: string) { super(`Could not verify the original on this iPad (${stage}).`); }
}

export class LocalRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private cached: Model | undefined;
  private indexPending = new Set<string>();
  private reconcileCursor = 0;
  private invalidQueueRows = 0;
  reportQueueIndexIssues(count: number): void { this.invalidQueueRows = count; }
  queueIndexDiagnostics(): { invalidRows: number } { return { invalidRows: this.invalidQueueRows }; }
  constructor(private files: LocalFiles, private index: LocalIndex, private id: () => string, private now = Date.now) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(action, action); this.tail = operation.catch(() => { this.cached = undefined; }); return operation;
  }
  private async verified(path: string, expected?: number) {
    let info;
    try { info = await this.files.stat(this.files.uri(path)); } catch { throw new LocalSaveError('file-verify'); }
    return info.exists && positive(info.size) && (expected === undefined || info.size === expected) ? info.size : undefined;
  }
  private async matchesHash(uri: string, expected: string): Promise<boolean> {
    try { return !!this.files.sha256 && await this.files.sha256(uri) === expected; } catch { return false; }
  }
  private async treatmentRootMatches(id: string, expected: string): Promise<boolean> {
    if (!validId(id) || !validHash(expected)) return false;
    // Old four/five-shot records may still own a verified draft JPEG. Read only
    // these two identity-bound paths; hashing must not promote/rename a root.
    for (const path of [filename(id, true), filename(id)]) {
      if (await this.matchesHash(this.files.uri(path), expected)) return true;
    }
    return false;
  }
  private async treatmentBytesMatch(capture: CaptureRecord, path: string): Promise<boolean> {
    if (capture.treatment === undefined) return true;
    return isPhotoTreatment(capture.treatment) && !capture.look && validId(capture.sourcePhotoId ?? '') &&
      validHash(capture.sourceSha256) && validHash(capture.outputSha256) &&
      await this.treatmentRootMatches(capture.sourcePhotoId!, capture.sourceSha256) &&
      await this.matchesHash(this.files.uri(path), capture.outputSha256);
  }
  private async locate(capture: CaptureRecord): Promise<CaptureRecord | undefined> {
    for (const path of [capture.relativePath, filename(capture.id, true), filename(capture.id), `photobooth/${capture.id}.partial`]) {
      const bytes = await this.verified(path, capture.bytes);
      if (bytes !== undefined && await this.treatmentBytesMatch(capture, path)) return { ...capture, relativePath: path, bytes };
    }
    return undefined;
  }
  private canonical(capture: CaptureRecord, session?: SessionRecord): string {
    return filename(capture.id, (session?.targetCount === 4 || session?.targetCount === 5) || session?.confirmed === true || capture.confirmed);
  }
  private async normalize(capture: CaptureRecord, model: Model): Promise<CaptureRecord> {
    const destination = this.canonical(capture, model.sessions.get(capture.sessionId));
    if (!await this.treatmentBytesMatch(capture, capture.relativePath)) throw new LocalSaveError('treatment-hash');
    if (capture.relativePath === destination) {
      if (!await this.verified(destination, capture.bytes) || !await this.treatmentBytesMatch(capture, destination)) throw new LocalSaveError('original-readback');
      return capture;
    }
    try { await this.files.move(capture.relativePath, destination); }
    catch { if (!await this.verified(destination, capture.bytes) || !await this.treatmentBytesMatch(capture, destination)) throw new LocalSaveError('original-commit'); }
    if (!await this.verified(destination, capture.bytes) || !await this.treatmentBytesMatch(capture, destination)) throw new LocalSaveError('original-readback');
    const normalized = { ...capture, relativePath: destination };
    await this.append({ kind: 'capture', capture: normalized }, model);
    model.captures.set(capture.id, normalized);
    return normalized;
  }
  private async append(data: RecordData, model: Model): Promise<number> {
    const sequence = Math.max(this.sequence, model.sequence, this.now()) + 1;
    this.sequence = sequence; model.sequence = sequence;
    const record = { ...data, version: 1 as const, sequence } as Journal;
    if (record.kind === 'composite' && !record.composite.sequence) record.composite.sequence = sequence;
    if (record.kind === 'capture' && !record.capture.selectionSequence) record.capture.selectionSequence = sequence;
    const path = `photobooth/journal-${String(sequence).padStart(16, '0')}-${this.id()}.json`;
    const text = JSON.stringify(record);
    try {
      await this.files.write(path, text);
      if (!await this.verified(path) || await this.files.read(path) !== text) throw new Error('Journal readback mismatch');
    } catch { throw new LocalSaveError('journal-write'); }
    if (record.kind === 'session') model.sessionSequences.set(record.session.id, sequence);
    return sequence;
  }
  private async readModel(): Promise<Model> {
    if (this.cached) return this.cached;
    let names: string[];
    try { await this.files.ensureDirectory(); names = await this.files.list(); } catch { throw new LocalSaveError('local-index-read'); }
    const model: Model = { reservedTreatmentIds: new Set(), treatmentClaims: new Map(), composites: new Map(), captures: new Map(), sessions: new Map(), sessionSequences: new Map(), active: null, hasActiveJournal: false,
      sequence: 0, files: names, journaled: new Set() };
    const records: Journal[] = [];
    const reservedCompositeIds = new Set<string>();
    const reservedTreatmentIds = model.reservedTreatmentIds;
    for (const name of names.filter(name => /^journal-.*\.json$/.test(name))) {
      try {
        const item = JSON.parse(await this.files.read(`photobooth/${name}`)) as Journal;
        if (item.version === 1 && item.kind === 'capture' && item.capture?.treatment !== undefined && validId(item.capture.id)) reservedTreatmentIds.add(item.capture.id);
        if (item.version === 1 && item.kind === 'composite' && validId(item.composite.id) && validId(item.composite.sessionId)) reservedCompositeIds.add(item.composite.id);
        if (item.version === 1 && Number.isSafeInteger(item.sequence) && item.sequence > 0 &&
          ((item.kind === 'composite' && validId(item.composite.id) && validId(item.composite.sessionId) && this.validRecipe(item.composite.recipe) &&
            Array.isArray(item.composite.originalPhotoIds) && item.composite.originalPhotoIds.length === 4 && new Set(item.composite.originalPhotoIds).size === 4 &&
            item.composite.originalPhotoIds.every(validId)) ||
           (item.kind === 'capture' && validId(item.capture.id) && validId(item.capture.sessionId) &&
             (item.capture.treatment === undefined || (isPhotoTreatment(item.capture.treatment) && !item.capture.look &&
              validId(item.capture.sourcePhotoId ?? '') && validHash(item.capture.sourceSha256) && validHash(item.capture.outputSha256) && item.capture.selectionEligible === false))) ||
           (item.kind === 'session' && validId(item.session.id) && Array.isArray(item.session.selected)) || item.kind === 'active')) records.push(item);
      } catch { /* A torn append never destroys earlier committed journal records. */ }
    }
    records.sort((left, right) => left.sequence - right.sequence);
    for (const item of records) {
      model.sequence = Math.max(model.sequence, item.sequence);
      if (item.kind === 'composite') model.composites.set(item.composite.id, item.composite);
      if (item.kind === 'capture') { if (item.capture.treatment) model.treatmentClaims.set(item.capture.id, item.capture); model.captures.set(item.capture.id, item.capture); model.journaled.add(item.capture.id); }
      if (item.kind === 'session') { model.sessions.set(item.session.id, item.session); model.sessionSequences.set(item.session.id, item.sequence); }
      if (item.kind === 'active') { model.active = { sessionId: item.sessionId, captureId: item.captureId }; model.hasActiveJournal = true; }
    }
    // Import older originals/drafts/staging files without deleting or silently
    // selecting them for the next guest. Legacy .jpg files were explicit keeps.
    for (const name of names.filter(name => /(?:\.draft\.jpg|\.jpg|\.partial)$/.test(name))) {
      const id = name.replace(/(?:\.draft\.jpg|\.jpg|\.partial)$/, '');
      if (!validId(id) || model.captures.has(id) || model.composites.has(id) || reservedCompositeIds.has(id) || reservedTreatmentIds.has(id)) continue;
      const bytes = await this.verified(`photobooth/${name}`); if (!bytes) continue;
      const confirmed = name.endsWith('.jpg') && !name.endsWith('.draft.jpg');
      const capture: CaptureRecord = { id, sessionId: id, shotIndex: 0, createdAt: 0, confirmed,
        relativePath: `photobooth/${name}`, bytes, selectionSequence: 0, exportStatus: 'pending', legacy: true };
      model.captures.set(id, capture);
      if (!model.sessions.has(id)) model.sessions.set(id, { id, createdAt: 0, targetCount: 1, confirmed, selected: [id] });
    }
    for (const [id, composite] of model.composites) {
      let found: CompositeRecord | undefined;
      for (const path of [composite.relativePath, filename(id, true), `photobooth/${id}.partial`]) {
        if (await this.verified(path, composite.bytes)) { found = { ...composite, relativePath: path }; break; }
      }
      if (!found) { model.composites.delete(id); continue; }
      model.composites.set(id, found);
      if (found.relativePath.endsWith('.partial')) {
        try { await this.normalizeComposite(found, model); } catch { /* Keep the previous valid composite ready. */ }
      }
    }
    const repairedSessions = new Set<string>();
    for (const [id, capture] of model.captures) {
      let found = await this.locate(capture);
      if (!found) { model.captures.delete(id); continue; }
      if (found.relativePath !== capture.relativePath && !found.relativePath.endsWith('.partial')) await this.append({ kind: 'capture', capture: found }, model);
      if (found.relativePath.endsWith('.partial')) {
        try { found = await this.normalize(found, model); } catch { /* Retain bytes as staged, never acknowledge a JPEG. */ }
      }
      if (found.legacy && found.relativePath === filename(found.id, true)) found.confirmed = true;
      model.captures.set(id, found);
      const session = model.sessions.get(found.sessionId);
      if (session && found.legacy && found.confirmed && !session.confirmed) { session.confirmed = true; repairedSessions.add(session.id); }
      if (session && !session.confirmed && session.retakeState !== 'abandoned' && found.selectionEligible !== false && found.relativePath.endsWith('.jpg') && found.selectionSequence > (model.sessionSequences.get(session.id) ?? 0)) {
        session.selected[found.shotIndex] = found.id;
        repairedSessions.add(session.id);
      }
    }
    for (const id of repairedSessions) {
      const sequence = await this.append({ kind: 'session', session: model.sessions.get(id)! }, model);
      model.sessionSequences.set(id, sequence);
    }
    if (!model.active) {
      try {
        const old = await this.index.read('active') as ActiveCapture | null;
        if (old?.id && model.captures.has(old.id)) model.active = { sessionId: model.captures.get(old.id)!.sessionId, captureId: old.id };
      } catch { /* A database outage must not block file-backed local access. */ }
    }
    // A durable cancellation wins even if the process stopped before its active-pointer append.
    let active = model.active?.sessionId ? model.sessions.get(model.active.sessionId) : undefined;
    const visited = new Set<string>();
    while (active?.retakeState === 'abandoned') {
      if (!active.retakeOfSessionId || visited.has(active.id)) throw new LocalSaveError('retake-fallback');
      visited.add(active.id);
      active = model.sessions.get(active.retakeOfSessionId);
      if (!active) throw new LocalSaveError('retake-fallback');
      await this.verifyCompleteSession(model, active);
    }
    if (active && active.id !== model.active?.sessionId) {
      const pointer = { sessionId: active.id, captureId: active.selected.at(-1) ?? null };
      await this.append({ kind: 'active', ...pointer }, model); model.active = pointer;
    }
    this.cached = model;
    return model;
  }
  private hydrate(capture: CaptureRecord): ActiveCapture {
    return { ...capture, ...(capture.treatment ? { treatment: JSON.parse(canonicalPhotoTreatment(capture.treatment)) as PhotoTreatment } : {}),
      fileUri: this.files.uri(capture.relativePath) };
  }
  private session(model: Model, id: string): ActiveSession | null {
    const data = model.sessions.get(id); if (!data) return null;
    const selected = data.selected.map(photoId => model.captures.get(photoId)).filter((photo): photo is CaptureRecord => !!photo && photo.relativePath.endsWith('.jpg'));
    const staged = [...model.captures.values()].filter(photo => photo.sessionId === id && photo.relativePath.endsWith('.partial'));
    return { id: data.id, createdAt: data.createdAt, targetCount: data.targetCount, confirmed: data.confirmed,
      ...(data.retakeOfSessionId ? { retakeOfSessionId: data.retakeOfSessionId, retakeState: data.retakeState } : {}),
      ...(data.captureTiming ? { captureTiming: { ...data.captureTiming } } : {}),
      ...(data.templateDefaults ? { templateDefaults: { ...data.templateDefaults } } : {}),
      shots: selected.map(photo => this.hydrate(photo)),
      ...(this.currentComposite(model, data) ? { composite: this.hydrateComposite(this.currentComposite(model, data)!) } : {}),
      ...([...model.composites.values()].some(item => item.sessionId === id && item.relativePath.endsWith('.partial')) ? {
        stagedComposites: [...model.composites.values()].filter(item => item.sessionId === id && item.relativePath.endsWith('.partial')).map(item => this.hydrateComposite(item)),
        storageWarning: 'composite-commit-pending' as const,
      } : {}),
      ...(staged.length ? { stagedOriginals: staged.map(photo => this.hydrate(photo)), storageWarning: 'original-commit-pending' as const } : (this.indexPending.has(id) || this.invalidQueueRows > 0) ? { storageWarning: 'index-repair-pending' as const } : {}),
      retakes: [...model.captures.values()].filter(photo => photo.sessionId === id && photo.relativePath.endsWith('.jpg') && !data.selected.includes(photo.id)).map(photo => this.hydrate(photo)) };
  }
  private validRecipe(recipe: CompositeRecipe): boolean {
    return validCompositeRecipe(recipe);
  }
  private samePhotoSet(left: string[], right: string[]): boolean {
    return left.length === 4 && right.length === 4 && new Set(left).size === 4 && new Set(right).size === 4 && left.every(id => right.includes(id));
  }
  private currentComposite(model: Model, session: SessionRecord): CompositeRecord | undefined {
    return [...model.composites.values()].filter(item => item.sessionId === session.id && (!session.confirmed || item.id === session.compositeId) && item.relativePath.endsWith('.jpg') &&
      this.samePhotoSet(item.recipe.photoIds, session.selected)).sort((a, b) => b.sequence - a.sequence)[0];
  }
  private hydrateComposite(item: CompositeRecord): SessionComposite {
    return { id: item.id, fileUri: this.files.uri(item.relativePath), exportStatus: item.exportStatus, recipe: JSON.parse(JSON.stringify(item.recipe)) as CompositeRecipe, originalPhotoIds: [...item.originalPhotoIds] };
  }
  private async originalsFor(model: Model, session: SessionRecord, photoIds: string[]): Promise<CaptureRecord[]> {
    const originals: CaptureRecord[] = [];
    for (const id of photoIds) {
      const selected = model.captures.get(id);
      const original = selected ? model.captures.get(selected.sourcePhotoId ?? selected.id) : undefined;
      if (!selected || selected.sessionId !== session.id || !original || original.sessionId !== session.id ||
        isDerivedCapture(original) || original.shotIndex !== selected.shotIndex ||
        !await this.verified(selected.relativePath, selected.bytes) || !await this.treatmentBytesMatch(selected, selected.relativePath) || !await this.verified(original.relativePath, original.bytes)) throw new LocalSaveError('composite-source');
      originals.push(original);
    }
    if (new Set(originals.map(item => item.id)).size !== 4) throw new LocalSaveError('composite-source');
    return originals;
  }
  private async normalizeComposite(item: CompositeRecord, model: Model): Promise<CompositeRecord> {
    const destination = filename(item.id, true);
    if (item.relativePath === destination) {
      if (!await this.verified(destination, item.bytes)) throw new LocalSaveError('composite-readback');
      return item;
    }
    try { await this.files.move(item.relativePath, destination); }
    catch { if (!await this.verified(destination, item.bytes)) throw new LocalSaveError('composite-commit'); }
    if (!await this.verified(destination, item.bytes)) throw new LocalSaveError('composite-readback');
    const normalized = { ...item, relativePath: destination };
    await this.append({ kind: 'composite', composite: normalized }, model);
    model.composites.set(item.id, normalized);
    return normalized;
  }
  saveComposite(sessionId: string, input: CompositeInput): Promise<ActiveSession> {
    // Snapshot the recipe before queueing asynchronous disk work.
    const recipe = JSON.parse(JSON.stringify(input.recipe)) as CompositeRecipe, expected = [...input.expectedSelectedPhotoIds];
    return this.serial(async () => {
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      if (session) this.assertRetakeMutable(model, session);
      if (!session || session.confirmed || session.targetCount !== 4 || !validId(input.id)) throw new LocalSaveError('composite-session');
      if (!this.samePhotoSet(session.selected, expected) || !session.selected.every((id, index) => id === expected[index]) ||
        !this.validRecipe(recipe) || !this.samePhotoSet(recipe.photoIds, session.selected)) throw new LocalSaveError('composite-selection');
      const originals = await this.originalsFor(model, session, recipe.photoIds);
      if (model.captures.has(input.id) || model.composites.has(input.id)) throw new LocalSaveError('photo-id-reused');
      let bytes: number;
      try {
        const uri = new URL(input.newRenderedURI);
        if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.startsWith('/')) throw new Error();
        const source = await this.files.stat(input.newRenderedURI);
        if (!source.exists || !positive(source.size)) throw new Error();
        bytes = source.size;
      } catch { throw new LocalSaveError('composite-file'); }
      const item: CompositeRecord = { id: input.id, sessionId, recipe, originalPhotoIds: originals.map(photo => photo.id),
        bytes, relativePath: `photobooth/${input.id}.partial`, createdAt: this.now(), sequence: 0 };
      await this.append({ kind: 'composite', composite: item }, model);
      try {
        await this.files.copy(input.newRenderedURI, item.relativePath);
        if (!await this.verified(item.relativePath, bytes)) throw new Error();
      } catch { throw new LocalSaveError('composite-copy'); }
      model.composites.set(item.id, item);
      await this.normalizeComposite(item, model);
      const result = this.session(model, sessionId)!;
      if (!await this.indexSession(model, sessionId)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  getSessionPublicationAssets(sessionId: string): Promise<SessionPublicationAssets> {
    return this.serial(async () => {
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      if (!session) throw new LocalSaveError('capture-session');
      if (session.targetCount !== 4) return { photoIds: [...session.selected] };
      const item = this.currentComposite(model, session);
      if (!item || !await this.verified(item.relativePath, item.bytes)) throw new LocalSaveError('composite-required');
      const originals = await this.originalsFor(model, session, item.recipe.photoIds);
      if (originals.some((photo, index) => photo.id !== item.originalPhotoIds[index])) throw new LocalSaveError('composite-source');
      return { photoIds: [...item.recipe.photoIds], originalPhotoIds: [...item.originalPhotoIds], composite: publicationComposite(item.id, item.recipe) };
    });
  }
  private async indexSession(model: Model, id: string): Promise<boolean> {
    try {
      await this.index.write(`session:${id}`, model.sessions.get(id));
      const activeId = model.active?.captureId;
      if (activeId) await this.index.write('active', model.captures.get(activeId));
      this.indexPending.delete(id);
      return true;
    } catch { this.indexPending.add(id); return false; }
  }
  createSession(id = this.id(), targetCount = 4): Promise<ActiveSession> {
    return this.serial(async () => {
      if (!validId(id) || ![1, 4, 5].includes(targetCount)) throw new LocalSaveError('session-id');
      const model = await this.readModel();
      if (model.sessions.has(id)) throw new LocalSaveError('session-id-reused');
      const session: SessionRecord = { id, createdAt: this.now(), targetCount, confirmed: false, selected: [] };
      await this.append({ kind: 'session', session }, model); model.sessions.set(id, session);
      await this.append({ kind: 'active', sessionId: id, captureId: null }, model); model.active = { sessionId: id, captureId: null };
      const result = this.session(model, id)!;
      if (!await this.indexSession(model, id)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  private assertRetakeMutable(model: Model, session: SessionRecord): void {
    if (session.retakeState === 'abandoned') throw new LocalSaveError('abandoned-retake');
    if (session.retakeOfSessionId && !session.confirmed && model.active?.sessionId !== session.id) throw new LocalSaveError('inactive-retake');
    // A stale callback from the preserved parent cannot replace its selection while a descendant is active.
    let current = model.active?.sessionId ? model.sessions.get(model.active.sessionId) : undefined;
    const seen = new Set<string>();
    while (!session.confirmed && current?.retakeOfSessionId && !seen.has(current.id)) {
      if (current.retakeOfSessionId === session.id) throw new LocalSaveError('inactive-retake-parent');
      seen.add(current.id); current = model.sessions.get(current.retakeOfSessionId);
    }
  }
  private async verifyCompleteSession(model: Model, session: SessionRecord): Promise<void> {
    if (session.selected.length !== session.targetCount || new Set(session.selected).size !== session.targetCount) throw new LocalSaveError('incomplete-session');
    for (let slot = 0; slot < session.targetCount; slot++) {
      const photo = model.captures.get(session.selected[slot]!);
      const original = photo ? model.captures.get(photo.sourcePhotoId ?? photo.id) : undefined;
      if (!photo || photo.sessionId !== session.id || photo.shotIndex !== slot || !photo.relativePath.endsWith('.jpg') ||
        !original || original.sessionId !== session.id || original.shotIndex !== slot || isDerivedCapture(original) ||
        !await this.verified(photo.relativePath, photo.bytes) || !await this.treatmentBytesMatch(photo, photo.relativePath) || !await this.verified(original.relativePath, original.bytes)) throw new LocalSaveError('retake-original');
    }
  }
  beginRetakeAll(parentSessionId: string, input: RetakeAllInput): Promise<ActiveSession> {
    const expected = [...input.expectedSelectedPhotoIds], timing = { ...input.timing }, id = input.id;
    return this.serial(async () => {
      const model = await this.readModel(), parent = model.sessions.get(parentSessionId);
      if (!parent || ![4, 5].includes(parent.targetCount) || parent.retakeState === 'abandoned' || model.active?.sessionId !== parentSessionId ||
        parent.selected.length !== expected.length || !parent.selected.every((photoId, slot) => photoId === expected[slot])) throw new LocalSaveError('stale-retake-parent');
      if (!validId(id) || model.sessions.has(id) || model.captures.has(id) || model.composites.has(id)) throw new LocalSaveError('session-id-reused');
      if (!isCountdownSeconds(timing.firstSeconds) || !isCountdownSeconds(timing.nextSeconds)) throw new LocalSaveError('retake-timing');
      await this.verifyCompleteSession(model, parent);
      const recipe = this.currentComposite(model, parent)?.recipe;
      const templateDefaults = recipe ? { layout: recipe.layout, theme: recipe.theme,
        ...(recipe.version === 'wedding-template-v2' ? { gridAspect: recipe.gridAspect } : {}) } : parent.templateDefaults ? { ...parent.templateDefaults } : undefined;
      const child: SessionRecord = { id, createdAt: this.now(), targetCount: parent.targetCount, confirmed: false, selected: [],
        retakeOfSessionId: parentSessionId, retakeState: 'open', captureTiming: timing,
        ...(templateDefaults ? { templateDefaults } : {}) };
      // Parent link and defaults become durable before the child can become active.
      await this.append({ kind: 'session', session: child }, model); model.sessions.set(id, child);
      const pointer = { sessionId: id, captureId: null };
      await this.append({ kind: 'active', ...pointer }, model); model.active = pointer;
      const result = this.session(model, id)!;
      if (!await this.indexSession(model, id)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  cancelRetakeAll(childSessionId: string): Promise<ActiveSession> {
    return this.serial(async () => {
      const model = await this.readModel(), child = model.sessions.get(childSessionId);
      const parent = child?.retakeOfSessionId ? model.sessions.get(child.retakeOfSessionId) : undefined;
      if (!child || !parent || child.confirmed || (model.active?.sessionId !== childSessionId &&
        !(child.retakeState === 'abandoned' && model.active?.sessionId === parent.id))) throw new LocalSaveError('stale-retake');
      await this.verifyCompleteSession(model, parent);
      if (child.retakeState !== 'abandoned') {
        const abandoned = { ...child, retakeState: 'abandoned' as const };
        await this.append({ kind: 'session', session: abandoned }, model); model.sessions.set(childSessionId, abandoned);
      }
      const pointer = { sessionId: parent.id, captureId: parent.selected.at(-1) ?? null };
      await this.append({ kind: 'active', ...pointer }, model); model.active = pointer;
      const result = this.session(model, parent.id)!;
      if (!await this.indexSession(model, parent.id)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  getActiveSession(): Promise<ActiveSession | null> { return this.serial(async () => { const model = await this.readModel(); return model.active?.sessionId ? this.session(model, model.active.sessionId) : null; }); }
  getSession(id: string): Promise<ActiveSession | null> { return this.serial(async () => this.session(await this.readModel(), id)); }
  listLocalSessions(): Promise<ActiveSession[]> { return this.serial(async () => { const model = await this.readModel(); return [...model.sessions.keys()].map(id => this.session(model, id)!).filter(session => session.shots.length > 0 || !!session.stagedOriginals?.length).sort((a, b) => b.createdAt - a.createdAt); }); }
  saveShot(sessionOrId: ActiveSession | string, id: string, temporaryUri: string, shotIndex?: number): Promise<ActiveSession> {
    return this.savePhoto(sessionOrId, id, temporaryUri, shotIndex);
  }
  saveRenderedPhoto(sessionId: string, input: RenderedPhotoInput): Promise<ActiveSession> {
    if (input.treatment !== undefined) {
      if (input.look !== undefined || !isPhotoTreatment(input.treatment)) return Promise.reject(new LocalSaveError('render-recipe'));
      const snapshot = { ...input, treatment: JSON.parse(canonicalPhotoTreatment(input.treatment)) as PhotoTreatment };
      return this.saveTreatment(sessionId, snapshot);
    }
    return this.savePhoto(sessionId, input.id, input.newRenderedURI, input.slot, input as LegacyRenderedPhotoInput);
  }
  private saveTreatment(sessionId: string, input: Extract<RenderedPhotoInput, { treatment: PhotoTreatment }>): Promise<ActiveSession> {
    return this.serial(async () => {
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      const admit = () => {
        if (input.admit !== undefined && (typeof input.admit !== 'function' || input.admit() !== true)) throw new LocalSaveError('render-admission');
      };
      admit();
      if (!session || ![4, 5].includes(session.targetCount) || !validId(input.id) || model.active?.sessionId !== sessionId) throw new LocalSaveError('capture-session');
      this.assertSelection(model, session, input.slot, input.expectedSelectedPhotoId);
      if (!validHash(input.sourceSha256) || !validHash(input.outputSha256) || !this.files.sha256) throw new LocalSaveError('treatment-hash');
      const original = model.captures.get(input.sourcePhotoId), selected = model.captures.get(input.expectedSelectedPhotoId);
      if (!original || isDerivedCapture(original) || original.sessionId !== sessionId || original.shotIndex !== input.slot ||
        !selected || (selected.sourcePhotoId ?? selected.id) !== original.id ||
        !await this.verified(original.relativePath, original.bytes) ||
        !await this.matchesHash(this.files.uri(original.relativePath), input.sourceSha256)) throw new LocalSaveError('render-source');
      const known = model.treatmentClaims.get(input.id) ?? model.captures.get(input.id);
      if (model.composites.has(input.id) || model.reservedTreatmentIds.has(input.id) && !known || known && (known.sessionId !== sessionId || known.shotIndex !== input.slot ||
        known.sourcePhotoId !== original.id || known.look || !samePhotoTreatment(known.treatment, input.treatment) ||
        known.sourceSha256 !== input.sourceSha256 || known.outputSha256 !== input.outputSha256)) throw new LocalSaveError('photo-id-reused');
      let capture = model.captures.get(input.id);
      if (capture) capture = await this.normalize(capture, model);
      else {
        let source;
        try {
          const uri = new URL(input.newRenderedURI);
          if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.startsWith('/') || uri.search || uri.hash ||
            input.newRenderedURI === this.files.uri(original.relativePath)) throw new Error();
          source = await this.files.stat(input.newRenderedURI);
          if (!source.exists || !positive(source.size)) throw new Error();
        } catch { throw new LocalSaveError('render-file'); }
        if (!await this.matchesHash(input.newRenderedURI, input.outputSha256)) throw new LocalSaveError('treatment-hash');
        admit();
        capture = { id: input.id, sessionId, shotIndex: input.slot, createdAt: this.now(), confirmed: false,
          relativePath: `photobooth/${input.id}.partial`, bytes: source.size, selectionSequence: 0, exportStatus: 'pending',
          sourcePhotoId: original.id, treatment: input.treatment, sourceSha256: input.sourceSha256,
          outputSha256: input.outputSha256, selectionEligible: false };
        // This claim precedes the copy and never auto-selects, including after
        // process death or a completed rename followed by a torn session append.
        await this.append({ kind: 'capture', capture }, model);
        model.reservedTreatmentIds.add(input.id); model.treatmentClaims.set(input.id, capture); model.captures.set(input.id, capture);
        try {
          await this.files.copy(input.newRenderedURI, capture.relativePath);
          if (!await this.verified(capture.relativePath, capture.bytes) || !await this.treatmentBytesMatch(capture, capture.relativePath)) throw new Error();
        } catch { throw new LocalSaveError('treatment-copy'); }
        capture = await this.normalize(capture, model);
      }
      admit(); // The exact approved cache bytes are now durable; selection is a separate commit.
      this.assertSelection(model, session, input.slot, input.expectedSelectedPhotoId);
      if (model.active?.sessionId !== sessionId) throw new LocalSaveError('stale-selection');
      if (session.selected[input.slot] !== capture.id) {
        const updated = { ...session, selected: [...session.selected] };
        updated.selected[input.slot] = capture.id;
        await this.append({ kind: 'session', session: updated }, model); model.sessions.set(sessionId, updated);
      }
      const result = this.session(model, sessionId)!;
      if (!await this.indexSession(model, sessionId)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  private savePhoto(sessionOrId: ActiveSession | string, id: string, temporaryUri: string, shotIndex?: number, rendered?: LegacyRenderedPhotoInput): Promise<ActiveSession> {
    return this.serial(async () => {
      const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      if (session) this.assertRetakeMutable(model, session);
      if (!session || session.confirmed || !validId(id)) throw new LocalSaveError('capture-session');
      const index = shotIndex ?? session.selected.filter(Boolean).length;
      if (!Number.isInteger(index) || index < 0 || index >= session.targetCount) throw new LocalSaveError('capture-slot');
      if (rendered) {
        this.assertSelection(model, session, index, rendered.expectedSelectedPhotoId);
        const { look } = rendered;
        if (!look || !['warm', 'bw', 'film'].includes(look.preset) || look.version !== 'wedding-ci-srgb-v1' ||
          !Number.isFinite(look.intensity) || look.intensity < 0 || look.intensity > 1) throw new LocalSaveError('render-recipe');
        const original = model.captures.get(rendered.sourcePhotoId);
        const selected = model.captures.get(session.selected[index]!);
        if (!original || original.sessionId !== sessionId || isDerivedCapture(original) || original.shotIndex !== index ||
          !selected || (selected.sourcePhotoId ?? selected.id) !== original.id || !await this.verified(original.relativePath, original.bytes)) throw new LocalSaveError('render-source');
        const known = model.captures.get(id);
        if (known && (known.treatment !== undefined || known.sourcePhotoId !== original.id || known.look?.preset !== look.preset || known.look?.intensity !== look.intensity || known.look?.version !== look.version)) throw new LocalSaveError('photo-id-reused');
      }
      if (model.composites.has(id) || model.reservedTreatmentIds.has(id)) throw new LocalSaveError('photo-id-reused');
      const existing = model.captures.get(id);
      if (existing) {
        if (existing.treatment !== undefined || existing.sessionId !== sessionId || existing.shotIndex !== index) throw new LocalSaveError('photo-id-reused');
        const normalized = await this.normalize(existing, model);
        if (session.selected[index] !== normalized.id && (rendered || normalized.selectionSequence > (model.sessionSequences.get(sessionId) ?? 0))) {
          const updated = { ...session, selected: [...session.selected] };
          updated.selected[index] = normalized.id;
          await this.append({ kind: 'session', session: updated }, model);
          model.sessions.set(sessionId, updated);
        }
        const result = this.session(model, sessionId)!;
        if (!await this.indexSession(model, sessionId)) result.storageWarning = 'index-repair-pending';
        return result;
      }
      let source;
      try {
        const uri = new URL(temporaryUri);
        if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.startsWith('/')) throw new Error();
        source = await this.files.stat(temporaryUri);
        if (!source.exists || !positive(source.size)) throw new Error();
      } catch { throw new LocalSaveError('camera-file'); }
      const capture: CaptureRecord = { id, sessionId, shotIndex: index, createdAt: this.now(), confirmed: false,
        relativePath: filename(id, session.targetCount !== 1), bytes: source.size, selectionSequence: 0, exportStatus: 'pending', legacy: session.targetCount === 1,
        ...(rendered ? { sourcePhotoId: rendered.sourcePhotoId, look: { ...rendered.look } } : {}) };
      await this.append({ kind: 'active', sessionId, captureId: id }, model); model.active = { sessionId, captureId: id };
      await this.append({ kind: 'capture', capture }, model);
      try {
        await this.files.copy(temporaryUri, `photobooth/${id}.partial`);
        if (!await this.verified(`photobooth/${id}.partial`, source.size)) throw new Error();
      } catch { throw new LocalSaveError('original-copy'); }
      try { await this.files.move(`photobooth/${id}.partial`, capture.relativePath); }
      catch { if (!await this.verified(capture.relativePath, source.size)) throw new LocalSaveError('original-commit'); }
      if (!await this.verified(capture.relativePath, source.size)) throw new LocalSaveError('original-readback');
      await this.append({ kind: 'capture', capture }, model); model.captures.set(id, capture);
      session.selected[index] = id;
      await this.append({ kind: 'session', session }, model);
      const result = this.session(model, sessionId)!;
      if (!await this.indexSession(model, sessionId)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  private assertSelection(model: Model, session: SessionRecord, slot: number, expected: string): void {
    this.assertRetakeMutable(model, session);
    if (session.confirmed || !Number.isInteger(slot) || slot < 0 || slot >= session.targetCount ||
      !expected || session.selected[slot] !== expected || !model.captures.has(expected)) throw new LocalSaveError('stale-selection');
  }
  selectSavedPhoto(sessionId: string, photoId: string, slot: number, expectedSelectedPhotoId: string): Promise<ActiveSession> {
    return this.serial(async () => {
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      if (!session) throw new LocalSaveError('capture-session');
      this.assertSelection(model, session, slot, expectedSelectedPhotoId);
      const capture = model.captures.get(photoId), selected = model.captures.get(expectedSelectedPhotoId)!;
      if (!capture || capture.sessionId !== sessionId || capture.shotIndex !== slot ||
        (capture.sourcePhotoId ?? capture.id) !== (selected.sourcePhotoId ?? selected.id)) throw new LocalSaveError('render-source');
      const original = model.captures.get(capture.sourcePhotoId ?? capture.id);
      if (!original || original.sessionId !== sessionId || isDerivedCapture(original) ||
        !await this.verified(original.relativePath, original.bytes)) throw new LocalSaveError('render-source');
      await this.normalize(capture, model);
      if (session.selected[slot] !== photoId) {
        const updated = { ...session, selected: [...session.selected] };
        updated.selected[slot] = photoId;
        await this.append({ kind: 'session', session: updated }, model);
        model.sessions.set(sessionId, updated);
      }
      const result = this.session(model, sessionId)!;
      if (!await this.indexSession(model, sessionId)) result.storageWarning = 'index-repair-pending';
      return result;
    });
  }
  confirmSession(sessionOrId: ActiveSession | string): Promise<ActiveSession> {
    return this.serial(async () => {
      const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
      const model = await this.readModel(), session = model.sessions.get(id);
      if (session) this.assertRetakeMutable(model, session);
      if (!session || session.selected.filter(Boolean).length !== session.targetCount ||
        Array.from({ length: session.targetCount }, (_, index) => !model.captures.has(session.selected[index] ?? '')).some(Boolean)) throw new LocalSaveError('incomplete-session');
      if (session.targetCount === 4) {
        const composite = this.currentComposite(model, session);
        if (!composite || !await this.verified(composite.relativePath, composite.bytes)) throw new LocalSaveError('composite-required');
        const originals = await this.originalsFor(model, session, composite.recipe.photoIds);
        if (originals.some((photo, index) => photo.id !== composite.originalPhotoIds[index])) throw new LocalSaveError('composite-source');
      }
      for (const photoId of session.selected) {
        const found = await this.locate(model.captures.get(photoId)!);
        if (!found) throw new LocalSaveError('confirm-original');
        await this.normalize(found, model);
      }
      if (!session.confirmed) {
        if (session.targetCount === 4) session.compositeId = this.currentComposite(model, session)!.id;
        session.confirmed = true; await this.append({ kind: 'session', session }, model);
      }
      const queued = await this.repairConfirmed(model, session);
      const result = this.session(model, id)!;
      const indexed = await this.indexSession(model, id);
      if (!queued || !indexed) { this.indexPending.add(id); result.storageWarning = 'index-repair-pending'; }
      return result;
    });
  }
  private async repairConfirmed(model: Model, session: SessionRecord): Promise<boolean> {
    let indexed = true;
    const composite = session.targetCount === 4 ? this.currentComposite(model, session) : undefined;
    if (session.targetCount === 4 && !composite) return false;
    if (composite) {
      try {
        const originals = await this.originalsFor(model, session, composite.recipe.photoIds);
        if (originals.some((photo, index) => photo.id !== composite.originalPhotoIds[index])) return false;
      } catch { return false; }
    }
    const assetIds = [...new Set([...session.selected, ...(composite?.originalPhotoIds ?? [])])];
    for (const id of assetIds) {
      let capture = model.captures.get(id); if (!capture) { indexed = false; continue; }
      const destination = filename(id, true);
      try { capture = await this.normalize(capture, model); }
      catch { indexed = false; continue; }
      if (capture.relativePath !== destination || !await this.verified(destination, capture.bytes)) { indexed = false; continue; }
      if (!capture.confirmed) {
        capture = { ...capture, confirmed: true };
        try { await this.append({ kind: 'capture', capture }, model); model.captures.set(id, capture); }
        catch { indexed = false; continue; }
      }
      try { await this.index.ensureJob(uploadJob(id, this.files.uri(destination), capture.createdAt, session.id)); }
      catch { indexed = false; /* The confirmed filesystem manifest retries queue insertion after relaunch. */ }
    }
    if (composite) {
      try {
        if (!await this.verified(composite.relativePath, composite.bytes)) throw new Error('Missing composite');
        await this.index.ensureJob(uploadJob(composite.id, this.files.uri(composite.relativePath), composite.createdAt, session.id));
      } catch { indexed = false; }
    }
    return indexed;
  }
  clearActiveSession(): Promise<void> { return this.serial(async () => { const model = await this.readModel(); await this.append({ kind: 'active', sessionId: null, captureId: null }, model); model.active = { sessionId: null, captureId: null }; try { await this.index.write('active', null); } catch {} }); }
  setActiveCapture(capture: ActiveCapture | null): Promise<void> { return this.serial(async () => {
    const model = await this.readModel();
    const stored = capture ? model.captures.get(capture.id) : undefined;
    if (capture && !stored) throw new LocalSaveError('active-file');
    if (stored) {
      const target = model.sessions.get(stored.sessionId);
      if (target?.retakeState === 'abandoned') throw new LocalSaveError('abandoned-retake');
      // Retake-family switches require begin/cancel's validated journal ordering.
      // The legacy capture setter may update the current capture, but cannot
      // resurrect an inactive child or displace its active descendant/next guest.
      if (target && model.active?.sessionId !== target.id && (target.retakeOfSessionId ||
        [...model.sessions.values()].some(session => session.retakeOfSessionId === target.id))) throw new LocalSaveError('inactive-retake');
    }
    await this.append({ kind: 'active', sessionId: stored?.sessionId ?? null, captureId: stored?.id ?? null }, model);
    model.active = { sessionId: stored?.sessionId ?? null, captureId: stored?.id ?? null };
    try { await this.index.write('active', stored ?? null); } catch {}
  }); }
  getActiveCapture(): Promise<ActiveCapture | null> { return this.serial(async () => {
    const model = await this.readModel();
    if (!model.active?.sessionId) return null;
    const capture = model.active.captureId ? model.captures.get(model.active.captureId) : undefined;
    return capture && capture.relativePath.endsWith('.jpg') ? this.hydrate(capture) : this.session(model, model.active.sessionId)?.shots.at(-1) ?? null;
  }); }
  updateExport(sessionId: string, photoId: string, exportStatus: PhotoExportStatus): Promise<ActiveSession | null> { return this.serial(async () => {
    const model = await this.readModel(), capture = model.captures.get(photoId), composite = model.composites.get(photoId);
    if (capture?.sessionId === sessionId) {
      const updated = { ...capture, exportStatus };
      await this.append({ kind: 'capture', capture: updated }, model);
      model.captures.set(photoId, updated);
    } else if (composite?.sessionId === sessionId && composite.relativePath === filename(photoId, true) &&
      await this.verified(composite.relativePath, composite.bytes)) {
      const updated = { ...composite, exportStatus };
      await this.append({ kind: 'composite', composite: updated }, model);
      model.composites.set(photoId, updated);
    } else throw new LocalSaveError('export-photo');
    return this.session(model, sessionId);
  }); }
  retryStagedComposites(sessionId: string): Promise<ActiveSession | null> { return this.serial(async () => {
    const model = await this.readModel(), session = model.sessions.get(sessionId);
    if (!session) return null;
    this.assertRetakeMutable(model, session);
    // Normalize retained bytes only: confirmed composite identity lives in the session journal.
    for (const item of model.composites.values()) if (item.sessionId === sessionId && item.relativePath.endsWith('.partial')) {
      await this.normalizeComposite(item, model);
    }
    const queued = !session.confirmed || await this.repairConfirmed(model, session);
    const indexed = await this.indexSession(model, sessionId);
    if (!queued || !indexed) this.indexPending.add(sessionId);
    return this.session(model, sessionId);
  }); }
  retryStagedPhotos(sessionId: string): Promise<ActiveSession | null> { return this.serial(async () => {
    const model = await this.readModel();
    const session = model.sessions.get(sessionId);
    if (session) this.assertRetakeMutable(model, session);
    const previousSequence = model.sessionSequences.get(sessionId) ?? 0;
    let selectionChanged = false;
    for (const capture of model.captures.values()) if (capture.sessionId === sessionId && capture.relativePath.endsWith('.partial')) {
      const normalized = await this.normalize(capture, model);
      const selected = session ? model.captures.get(session.selected[normalized.shotIndex] ?? '') : undefined;
      if (session && !session.confirmed && session.retakeState !== 'abandoned' && normalized.selectionEligible !== false && normalized.selectionSequence > previousSequence &&
        (!selected || normalized.selectionSequence > selected.selectionSequence)) {
        session.selected[normalized.shotIndex] = normalized.id; selectionChanged = true;
      }
    }
    for (const item of model.composites.values()) if (item.sessionId === sessionId && item.relativePath.endsWith('.partial')) await this.normalizeComposite(item, model);
    if (session && selectionChanged) await this.append({ kind: 'session', session }, model);
    if (session) {
      const queued = !session.confirmed || await this.repairConfirmed(model, session);
      const indexed = await this.indexSession(model, sessionId);
      if (!queued || !indexed) this.indexPending.add(sessionId);
    }
    return this.session(model, sessionId);
  }); }
  reconcileConfirmedPhotos(): Promise<void> { return this.serial(async () => {
    const model = await this.readModel();
    const sessions = [...model.sessions.values()].filter(session => session.confirmed);
    // A rotating bounded pass repairs missing/corrupt rows without relaunch or
    // rescanning journals. Healthy passes append no filesystem records.
    const active = sessions.find(session => session.id === model.active?.sessionId);
    const priority = [...(active ? [active] : []), ...sessions.filter(session => this.indexPending.has(session.id))];
    // Reserve archive capacity even when many pending sessions cannot repair.
    const batch = [...new Map(priority.map(session => [session.id, session])).values()].slice(0, 10);
    const included = new Set(batch.map(session => session.id));
    for (let visited = 0; visited < sessions.length && batch.length < 20; visited++) {
      const session = sessions[this.reconcileCursor % sessions.length]!;
      this.reconcileCursor = (this.reconcileCursor + 1) % sessions.length;
      if (!included.has(session.id)) { batch.push(session); included.add(session.id); }
    }
    for (const session of batch) {
      const queued = await this.repairConfirmed(model, session);
      if (!queued) this.indexPending.add(session.id);
      else if (this.indexPending.has(session.id)) await this.indexSession(model, session.id);
    }
  }); }
  recover(): Promise<void> { return this.serial(async () => {
    this.cached = undefined;
    const model = await this.readModel();
    if (!model.hasActiveJournal && model.active) { await this.append({ kind: 'active', ...model.active }, model); model.hasActiveJournal = true; }
    for (const [id, capture] of model.captures) {
      if (!model.journaled.has(id)) await this.append({ kind: 'capture', capture }, model);
    }
    for (const session of model.sessions.values()) {
      if (!model.sessionSequences.has(session.id)) await this.append({ kind: 'session', session }, model);
      const queued = !session.confirmed || await this.repairConfirmed(model, session);
      const indexed = await this.indexSession(model, session.id);
      if (!queued || !indexed) this.indexPending.add(session.id);
    }
  }); }
}
