import { uploadJob, type QueueJob } from '@wedding-booth/core';
import type { ActiveCapture, ActiveSession, PhotoExportStatus } from './local-types';
export type { ActiveCapture, ActiveSession, PhotoExportStatus } from './local-types';

export interface LocalFiles {
  uri(relative: string): string;
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
};
type SessionRecord = { id: string; createdAt: number; targetCount: number; confirmed: boolean; selected: string[] };
type RecordData = { kind: 'capture'; capture: CaptureRecord } | { kind: 'session'; session: SessionRecord } |
  { kind: 'active'; sessionId: string | null; captureId: string | null };
type Journal = RecordData & { version: 1; sequence: number };
type Model = { captures: Map<string, CaptureRecord>; sessions: Map<string, SessionRecord>; sessionSequences: Map<string, number>;
  active: { sessionId: string | null; captureId: string | null } | null; hasActiveJournal: boolean; sequence: number; files: string[]; journaled: Set<string> };
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
  constructor(private files: LocalFiles, private index: LocalIndex, private id: () => string, private now = Date.now) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(action, action); this.tail = operation.catch(() => { this.cached = undefined; }); return operation;
  }
  private async verified(path: string, expected?: number) {
    let info;
    try { info = await this.files.stat(this.files.uri(path)); } catch { throw new LocalSaveError('file-verify'); }
    return info.exists && positive(info.size) && (expected === undefined || info.size === expected) ? info.size : undefined;
  }
  private async locate(capture: CaptureRecord): Promise<CaptureRecord | undefined> {
    for (const path of [capture.relativePath, filename(capture.id, true), filename(capture.id), `photobooth/${capture.id}.partial`]) {
      const bytes = await this.verified(path, capture.bytes);
      if (bytes !== undefined) return { ...capture, relativePath: path, bytes };
    }
    return undefined;
  }
  private async append(data: RecordData, model: Model): Promise<number> {
    const sequence = Math.max(this.sequence, model.sequence, this.now()) + 1;
    this.sequence = sequence; model.sequence = sequence;
    const record = { ...data, version: 1 as const, sequence } as Journal;
    if (record.kind === 'capture' && !record.capture.selectionSequence) record.capture.selectionSequence = sequence;
    const path = `photobooth/journal-${String(sequence).padStart(16, '0')}-${this.id()}.json`;
    const text = JSON.stringify(record);
    try {
      await this.files.write(path, text);
      if (!await this.verified(path) || await this.files.read(path) !== text) throw new Error('Journal readback mismatch');
    } catch { throw new LocalSaveError('journal-write'); }
    return sequence;
  }
  private async readModel(): Promise<Model> {
    if (this.cached) return this.cached;
    let names: string[];
    try { await this.files.ensureDirectory(); names = await this.files.list(); } catch { throw new LocalSaveError('local-index-read'); }
    const model: Model = { captures: new Map(), sessions: new Map(), sessionSequences: new Map(), active: null, hasActiveJournal: false,
      sequence: 0, files: names, journaled: new Set() };
    const records: Journal[] = [];
    for (const name of names.filter(name => /^journal-.*\.json$/.test(name))) {
      try {
        const item = JSON.parse(await this.files.read(`photobooth/${name}`)) as Journal;
        if (item.version === 1 && Number.isSafeInteger(item.sequence) && item.sequence > 0 &&
          ((item.kind === 'capture' && validId(item.capture.id) && validId(item.capture.sessionId)) ||
           (item.kind === 'session' && validId(item.session.id) && Array.isArray(item.session.selected)) || item.kind === 'active')) records.push(item);
      } catch { /* A torn append never destroys earlier committed journal records. */ }
    }
    records.sort((left, right) => left.sequence - right.sequence);
    for (const item of records) {
      model.sequence = Math.max(model.sequence, item.sequence);
      if (item.kind === 'capture') { model.captures.set(item.capture.id, item.capture); model.journaled.add(item.capture.id); }
      if (item.kind === 'session') { model.sessions.set(item.session.id, item.session); model.sessionSequences.set(item.session.id, item.sequence); }
      if (item.kind === 'active') { model.active = { sessionId: item.sessionId, captureId: item.captureId }; model.hasActiveJournal = true; }
    }
    // Import older originals/drafts/staging files without deleting or silently
    // selecting them for the next guest. Legacy .jpg files were explicit keeps.
    for (const name of names.filter(name => /(?:\.draft\.jpg|\.jpg|\.partial)$/.test(name))) {
      const id = name.replace(/(?:\.draft\.jpg|\.jpg|\.partial)$/, '');
      if (!validId(id) || model.captures.has(id)) continue;
      const bytes = await this.verified(`photobooth/${name}`); if (!bytes) continue;
      const confirmed = name.endsWith('.jpg') && !name.endsWith('.draft.jpg');
      const capture: CaptureRecord = { id, sessionId: id, shotIndex: 0, createdAt: 0, confirmed,
        relativePath: `photobooth/${name}`, bytes, selectionSequence: 0, exportStatus: 'pending', legacy: true };
      model.captures.set(id, capture);
      if (!model.sessions.has(id)) model.sessions.set(id, { id, createdAt: 0, targetCount: 1, confirmed, selected: [id] });
    }
    const repairedSessions = new Set<string>();
    for (const [id, capture] of model.captures) {
      const found = await this.locate(capture);
      if (!found) { model.captures.delete(id); continue; }
      if (found.legacy && found.relativePath === filename(found.id, true)) found.confirmed = true;
      model.captures.set(id, found);
      const session = model.sessions.get(found.sessionId);
      if (session && found.legacy && found.confirmed && !session.confirmed) { session.confirmed = true; repairedSessions.add(session.id); }
      if (session && !session.confirmed && found.selectionSequence > (model.sessionSequences.get(session.id) ?? 0)) {
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
    this.cached = model;
    return model;
  }
  private hydrate(capture: CaptureRecord): ActiveCapture {
    return { ...capture, fileUri: this.files.uri(capture.relativePath) };
  }
  private session(model: Model, id: string): ActiveSession | null {
    const data = model.sessions.get(id); if (!data) return null;
    const selected = data.selected.map(photoId => model.captures.get(photoId)).filter((photo): photo is CaptureRecord => !!photo);
    return { id: data.id, createdAt: data.createdAt, targetCount: data.targetCount, confirmed: data.confirmed,
      shots: selected.map(photo => this.hydrate(photo)),
      ...(this.indexPending.has(id) ? { storageWarning: 'index-repair-pending' as const } : {}),
      retakes: [...model.captures.values()].filter(photo => photo.sessionId === id && !data.selected.includes(photo.id)).map(photo => this.hydrate(photo)) };
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
  createSession(id = this.id(), targetCount = 5): Promise<ActiveSession> {
    return this.serial(async () => {
      if (!validId(id) || ![1, 5].includes(targetCount)) throw new LocalSaveError('session-id');
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
  getActiveSession(): Promise<ActiveSession | null> { return this.serial(async () => { const model = await this.readModel(); return model.active?.sessionId ? this.session(model, model.active.sessionId) : null; }); }
  getSession(id: string): Promise<ActiveSession | null> { return this.serial(async () => this.session(await this.readModel(), id)); }
  listLocalSessions(): Promise<ActiveSession[]> { return this.serial(async () => { const model = await this.readModel(); return [...model.sessions.keys()].map(id => this.session(model, id)!).filter(session => session.shots.length > 0).sort((a, b) => b.createdAt - a.createdAt); }); }
  saveShot(sessionOrId: ActiveSession | string, id: string, temporaryUri: string, shotIndex?: number): Promise<ActiveSession> {
    return this.serial(async () => {
      const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
      const model = await this.readModel(), session = model.sessions.get(sessionId);
      if (!session || session.confirmed || !validId(id)) throw new LocalSaveError('capture-session');
      const index = shotIndex ?? session.selected.filter(Boolean).length;
      if (!Number.isInteger(index) || index < 0 || index >= session.targetCount) throw new LocalSaveError('capture-slot');
      const existing = model.captures.get(id);
      if (existing) {
        if (existing.sessionId !== sessionId || existing.shotIndex !== index) throw new LocalSaveError('photo-id-reused');
        return this.session(model, sessionId)!;
      }
      let source;
      try {
        const uri = new URL(temporaryUri);
        if (uri.protocol !== 'file:' || uri.hostname || !uri.pathname.startsWith('/')) throw new Error();
        source = await this.files.stat(temporaryUri);
        if (!source.exists || !positive(source.size)) throw new Error();
      } catch { throw new LocalSaveError('camera-file'); }
      const capture: CaptureRecord = { id, sessionId, shotIndex: index, createdAt: this.now(), confirmed: false,
        relativePath: filename(id, session.targetCount === 5), bytes: source.size, selectionSequence: 0, exportStatus: 'pending', legacy: session.targetCount === 1 };
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
  confirmSession(sessionOrId: ActiveSession | string): Promise<ActiveSession> {
    return this.serial(async () => {
      const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
      const model = await this.readModel(), session = model.sessions.get(id);
      if (!session || session.selected.filter(Boolean).length !== session.targetCount ||
        Array.from({ length: session.targetCount }, (_, index) => !model.captures.has(session.selected[index] ?? '')).some(Boolean)) throw new LocalSaveError('incomplete-session');
      for (const photoId of session.selected) if (!await this.locate(model.captures.get(photoId)!)) throw new LocalSaveError('confirm-original');
      if (!session.confirmed) { session.confirmed = true; await this.append({ kind: 'session', session }, model); }
      const queued = await this.repairConfirmed(model, session);
      const result = this.session(model, id)!;
      const indexed = await this.indexSession(model, id);
      if (!queued || !indexed) { this.indexPending.add(id); result.storageWarning = 'index-repair-pending'; }
      return result;
    });
  }
  private async repairConfirmed(model: Model, session: SessionRecord): Promise<boolean> {
    let indexed = true;
    for (const id of session.selected) {
      let capture = model.captures.get(id); if (!capture) continue;
      let destination = session.targetCount === 1 ? filename(id, true) : capture.relativePath;
      if (capture.relativePath !== destination) {
        try { await this.files.move(capture.relativePath, destination); }
        catch { if (!await this.verified(destination, capture.bytes)) { if (await this.verified(capture.relativePath, capture.bytes)) destination = capture.relativePath; else throw new LocalSaveError('confirm-original'); } }
      }
      if (!await this.verified(destination, capture.bytes)) { indexed = false; continue; }
      capture = { ...capture, confirmed: true, relativePath: destination }; model.captures.set(id, capture);
      await this.append({ kind: 'capture', capture }, model);
      try { await this.index.ensureJob(uploadJob(id, this.files.uri(destination), capture.createdAt, session.id)); }
      catch { indexed = false; /* The confirmed filesystem manifest retries queue insertion after relaunch. */ }
    }
    return indexed;
  }
  clearActiveSession(): Promise<void> { return this.serial(async () => { const model = await this.readModel(); await this.append({ kind: 'active', sessionId: null, captureId: null }, model); model.active = { sessionId: null, captureId: null }; try { await this.index.write('active', null); } catch {} }); }
  setActiveCapture(capture: ActiveCapture | null): Promise<void> { return this.serial(async () => {
    const model = await this.readModel();
    const stored = capture ? model.captures.get(capture.id) : undefined;
    if (capture && !stored) throw new LocalSaveError('active-file');
    await this.append({ kind: 'active', sessionId: stored?.sessionId ?? null, captureId: stored?.id ?? null }, model);
    model.active = { sessionId: stored?.sessionId ?? null, captureId: stored?.id ?? null };
    try { await this.index.write('active', stored ?? null); } catch {}
  }); }
  getActiveCapture(): Promise<ActiveCapture | null> { return this.serial(async () => {
    const model = await this.readModel();
    if (!model.active?.sessionId) return null;
    const capture = model.active.captureId ? model.captures.get(model.active.captureId) : undefined;
    return capture ? this.hydrate(capture) : this.session(model, model.active.sessionId)?.shots.at(-1) ?? null;
  }); }
  updateExport(sessionId: string, photoId: string, exportStatus: PhotoExportStatus): Promise<ActiveSession | null> { return this.serial(async () => {
    const model = await this.readModel(), capture = model.captures.get(photoId);
    if (!capture || capture.sessionId !== sessionId) throw new LocalSaveError('export-photo');
    capture.exportStatus = exportStatus; await this.append({ kind: 'capture', capture }, model);
    return this.session(model, sessionId);
  }); }
  recover(): Promise<void> { return this.serial(async () => {
    this.cached = undefined;
    const model = await this.readModel();
    if (!model.hasActiveJournal && model.active) { await this.append({ kind: 'active', ...model.active }, model); model.hasActiveJournal = true; }
    for (const [id, capture] of model.captures) {
      let moved = false;
      if (capture.relativePath.endsWith('.partial')) {
        const destination = filename(id);
        try { await this.files.move(capture.relativePath, destination); capture.relativePath = destination; moved = true; } catch { /* Keep the verified staged original accessible. */ }
      }
      if (!model.journaled.has(id) || moved) await this.append({ kind: 'capture', capture }, model);
    }
    for (const session of model.sessions.values()) {
      if (!model.sessionSequences.has(session.id)) await this.append({ kind: 'session', session }, model);
      const queued = !session.confirmed || await this.repairConfirmed(model, session);
      const indexed = await this.indexSession(model, session.id);
      if (!queued || !indexed) this.indexPending.add(session.id);
    }
  }); }
}
