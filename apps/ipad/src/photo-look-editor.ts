import type { ActiveCapture, ActiveSession, PhotoLook, PhotoTreatment, FaceAccessory } from './local-types';
import type { RenderedPhotoInput } from './local-persistence';
import { canonicalPhotoTreatment, isDerivedCapture, isOriginalTreatment, isPhotoTreatment, photoTreatmentForCapture, samePhotoTreatment } from './photo-treatment';

export type PhotoLookPreset = 'original' | PhotoLook['preset'];
export type PhotoLookRenderResult = { uri: string; width: number; height: number; recipeVersion: string; preset: PhotoLookPreset; intensity: number; originalSha256: string; isOriginal: boolean; preview: boolean };
export type TreatmentFallbackReason = 'none' | 'no-face' | 'no-usable-face' | 'partial';
export type PhotoTreatmentRenderResult = { uri: string; width: number; height: number; recipe: PhotoTreatment; originalSha256: string; outputSha256: string; isOriginal: boolean; detectedFaceCount: number | null; landmarkedFaceCount: number | null; decoratedFaceCount: number; fallbackReason: TreatmentFallbackReason };
export type PhotoLookEditorState = { phase: 'previewing' | 'ready' | 'saving' | 'error'; previewUri: string; preset: PhotoLookPreset; intensity: number; sessionId: string; photoId: string; sourcePhotoId: string; slot: number; error?: string;
  faceSupported?: boolean; faceAccessory?: FaceAccessory; effectiveRecipe?: PhotoTreatment;
  detectedFaceCount?: number | null; landmarkedFaceCount?: number | null; decoratedFaceCount?: number | null; fallbackReason?: TreatmentFallbackReason | null;
};
export type EditorState = PhotoLookEditorState;
export type PhotoLookEditorPorts = {
  render(sourceUri: string, preset: PhotoLookPreset, intensity: number, preview: boolean, requestUUID: string): Promise<PhotoLookRenderResult>;
  cancel(requestUUID: string): void; release(uri: string): Promise<void>; id(): string;
  renderTreatment?(sourceUri: string, recipeJSON: string, requestUUID: string): Promise<PhotoTreatmentRenderResult>;
  cancelTreatment?(requestUUID: string): void; releaseTreatment?(uri: string): Promise<void>;
  loadSession(sessionId: string): Promise<ActiveSession | null>;
  saveRenderedPhoto(sessionId: string, input: RenderedPhotoInput): Promise<ActiveSession>;
  selectSavedPhoto(sessionId: string, photoId: string, slot: number, expectedSelectedPhotoId: string): Promise<ActiveSession>;
  onState(state: PhotoLookEditorState | null): void; onSession(session: ActiveSession): void;
};
const version = 'wedding-ci-srgb-v1';
const captures = (s: ActiveSession) => [...s.shots, ...(s.retakes ?? [])];
function source(s: ActiveSession, slot: number, expected?: string): { selected: ActiveCapture; original: ActiveCapture } {
  const selected = s.shots.find((p, index) => (p.shotIndex ?? index) === slot);
  if (s.confirmed || !Number.isInteger(slot) || slot < 0 || slot >= s.targetCount || !selected || selected.confirmed || (expected && selected.id !== expected)) throw new Error('stale-selection');
  const original = captures(s).find(p => p.id === (selected.sourcePhotoId ?? selected.id));
  if (!original || original.sourcePhotoId || original.look || original.confirmed || !original.fileUri ||
    [selected, original].some(p => (p.sessionId !== undefined && p.sessionId !== s.id) || (p.shotIndex !== undefined && p.shotIndex !== slot)) ||
    (!!selected.look !== !!selected.sourcePhotoId)) throw new Error('render-source');
  return { selected, original };
}
function createLegacyPhotoLookEditor(p: PhotoLookEditorPorts) {
  let state: PhotoLookEditorState | null = null, original: ActiveCapture | null = null;
  let generation = 0, request: string | null = null, preview: PhotoLookRenderResult | null = null, applying: Promise<boolean> | null = null;
  const owned = new Set<string>(), copying = new Set<string>();
  const emit = () => p.onState(state ? { ...state, faceSupported: false, faceAccessory: 'none' } : null);
  const dispose = (uri: string) => { if (owned.delete(uri)) void p.release(uri).catch(() => {}); };
  const cancel = () => { if (request) { p.cancel(request); request = null; } };
  const current = (g: number) => state !== null && generation === g;
  const fail = (e: unknown, g: number) => {
    if (current(g)) {
      cancel(); preview = null;
      state = { ...state!, phase: 'error', previewUri: original!.fileUri, error: e instanceof Error ? e.message : String(e) };
      emit();
      for (const uri of owned) if (!copying.has(uri)) dispose(uri);
    }
  };
  function validate(r: PhotoLookRenderResult, s: PhotoLookEditorState, isPreview: boolean) {
    let localJPEG = false;
    try { const uri = new URL(r.uri); localJPEG = uri.protocol === 'file:' && !uri.hostname && uri.pathname.startsWith('/') && /\.jpe?g$/i.test(uri.pathname) && !uri.search && !uri.hash; } catch {}
    if (!r || !localJPEG || r.uri === original?.fileUri || r.isOriginal || r.preview !== isPreview || r.recipeVersion !== version || r.preset !== s.preset || r.intensity !== s.intensity || !Number.isInteger(r.width) || r.width <= 0 || !Number.isInteger(r.height) || r.height <= 0 || !/^[a-f0-9]{64}$/i.test(r.originalSha256) || (isPreview && Math.max(r.width, r.height) > 1440)) throw new Error('invalid-render-result');
  }
  async function renderPreview(g: number) {
    const s = { ...state! }, src = original!;
    const id = p.id(); request = id;
    try {
      const r = await p.render(src.fileUri, s.preset, s.intensity, true, id);
      if (r.uri && r.uri !== src.fileUri) owned.add(r.uri);
      if (!current(g)) { dispose(r.uri); return; }
      validate(r, s, true); preview = r; request = null;
      state = { ...s, phase: 'ready', previewUri: r.uri }; emit();
    } catch (e) { fail(e, g); }
  }
  function close() {
    generation++; cancel(); state = null; preview = null; original = null;
    for (const uri of owned) if (!copying.has(uri)) dispose(uri);
    emit();
  }
  function choose(preset: PhotoLookPreset, intensity: number) {
    if (!state || state.phase === 'saving') return;
    const g = ++generation; cancel(); preview = null;
    for (const uri of owned) if (!copying.has(uri)) dispose(uri);
    if (!['original', 'warm', 'bw', 'film'].includes(preset) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) { fail(new Error('invalid-look'), g); return; }
    const identity = preset === 'original' || intensity === 0;
    state = { ...state, preset, intensity: preset === 'original' ? 0 : intensity, previewUri: original!.fileUri, phase: identity ? 'ready' : 'previewing', error: undefined }; emit();
    if (!identity) void renderPreview(g);
  }
  function open(session: ActiveSession, slot: number) {
    close();
    try {
      const found = source(session, slot); original = found.original;
      state = { phase: 'ready', previewUri: original.fileUri, preset: 'original', intensity: 0, sessionId: session.id, photoId: found.selected.id, sourcePhotoId: original.id, slot };
      choose(found.selected.look?.preset ?? 'original', found.selected.look?.intensity ?? 0);
    } catch (e) { state = null; emit(); }
  }
  function apply(): Promise<boolean> {
    if (applying) return applying;
    if (!state || state.phase !== 'ready') return Promise.resolve(false);
    const s = { ...state }, src = original!, ack = preview, g = generation;
    state = { ...s, phase: 'saving' }; emit();
    const job = (async () => {
      let output: string | undefined;
      try {
        const latest = await p.loadSession(s.sessionId);
        if (!current(g)) return false;
        if (!latest) throw new Error('capture-session');
        const fresh = source(latest, s.slot, s.photoId);
        if (fresh.original.id !== src.id || fresh.original.fileUri !== src.fileUri) throw new Error('render-source');
        const prior = s.preset === 'original' || s.intensity === 0 ? fresh.original : captures(latest).find(c => c.sourcePhotoId === src.id && c.look?.preset === s.preset && c.look.intensity === s.intensity && c.look.version === version && (c.sessionId === undefined || c.sessionId === s.sessionId) && (c.shotIndex === undefined || c.shotIndex === s.slot));
        let updated: ActiveSession;
        if (prior) updated = await p.selectSavedPhoto(s.sessionId, prior.id, s.slot, s.photoId);
        else {
          if (!ack) throw new Error('preview-required');
          const id = p.id(); request = id;
          const r = await p.render(src.fileUri, s.preset, s.intensity, false, id);
          if (r.uri && r.uri !== src.fileUri) owned.add(r.uri);
          output = r.uri;
          if (!current(g)) return false;
          validate(r, s, false);
          if (r.originalSha256 !== ack.originalSha256 || r.width < ack.width || r.height < ack.height || Math.abs(r.width / r.height - ack.width / ack.height) > 0.01) throw new Error('render-preview-mismatch');
          request = null;
          const beforeCopy = await p.loadSession(s.sessionId);
          if (!current(g)) return false;
          if (!beforeCopy) throw new Error('capture-session');
          source(beforeCopy, s.slot, s.photoId);
          copying.add(r.uri);
          updated = await p.saveRenderedPhoto(s.sessionId, { id: p.id(), newRenderedURI: r.uri, sourcePhotoId: src.id, look: { preset: s.preset as PhotoLook['preset'], intensity: s.intensity, version }, expectedSelectedPhotoId: s.photoId, slot: s.slot });
        }
        p.onSession(updated);
        if (current(g)) close();
        return true;
      } catch (e) {
        try { const latest = await p.loadSession(s.sessionId); if (latest) p.onSession(latest); } catch {}
        fail(e, g); return false;
      } finally { if (output) { copying.delete(output); dispose(output); } }
    })();
    applying = job;
    void job.finally(() => { if (applying === job) applying = null; });
    return job;
  }
  function previewFailed(uri: string) {
    if (!state || state.phase === 'saving' || !preview || preview.uri !== uri || state.previewUri !== uri) return;
    const g = ++generation;
    fail(new Error('preview-load-failed'), g);
  }
  return { open, choose, apply, close, previewFailed };
}

type TreatmentPorts = PhotoLookEditorPorts & Required<Pick<PhotoLookEditorPorts, 'renderTreatment' | 'cancelTreatment' | 'releaseTreatment'>>;
class TreatmentEditorError extends Error {}
const treatmentCopy = (recipe: PhotoTreatment): PhotoTreatment => JSON.parse(canonicalPhotoTreatment(recipe)) as PhotoTreatment;
const localJPEG = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const uri = new URL(value); return uri.protocol === 'file:' && !uri.hostname && uri.pathname.startsWith('/') && /\.jpe?g$/i.test(uri.pathname) && !uri.search && !uri.hash; } catch { return false; }
};
function treatmentSource(session: ActiveSession, slot: number, expected?: string) {
  const selected = session.shots.find((capture, index) => (capture.shotIndex ?? index) === slot);
  if (session.confirmed || session.retakeState === 'abandoned' || !Number.isInteger(slot) || slot < 0 || slot >= session.targetCount
    || !selected || selected.confirmed || (expected !== undefined && expected !== selected.id)) throw new TreatmentEditorError('stale-selection');
  const original = captures(session).find(capture => capture.id === (selected.sourcePhotoId ?? selected.id));
  if (!original || original.confirmed || isDerivedCapture(original) || !localJPEG(original.fileUri)
    || [selected, original].some(capture => (capture.sessionId !== undefined && capture.sessionId !== session.id)
      || (capture.shotIndex !== undefined && capture.shotIndex !== slot))
    || (isDerivedCapture(selected) && !selected.sourcePhotoId)
    || (selected.sourcePhotoId !== undefined && selected.look === undefined && selected.treatment === undefined)) throw new TreatmentEditorError('render-source');
  canonicalPhotoTreatment(photoTreatmentForCapture(selected)); // Reject invalid persisted recipe metadata before opening.
  return { selected, original };
}

function createTreatmentPhotoLookEditor(p: TreatmentPorts) {
  type Ack = { kind: 'capture'; capture: ActiveCapture; recipe: PhotoTreatment } | { kind: 'render'; result: PhotoTreatmentRenderResult; requestedRecipe: PhotoTreatment };
  let state: PhotoLookEditorState | null = null, original: ActiveCapture | null = null, knownSession: ActiveSession | null = null;
  let desired: PhotoTreatment | null = null, ack: Ack | null = null, generation = 0;
  let flight: { id: string; generation: number; cancelled: boolean } | null = null;
  let applying: { generation: number; sessionId: string; job: Promise<boolean> } | null = null;
  const owned = new Set<string>(), copying = new Set<string>(), protectedUris = new Set<string>(), badPreviews = new Set<string>();
  const sourceHashes = new Map<string, string>();
  const current = (g: number) => !!state && generation === g;
  const emit = () => p.onState(state ? { ...state, effectiveRecipe: state.effectiveRecipe && treatmentCopy(state.effectiveRecipe) } : null);
  const protect = (session: ActiveSession) => { for (const capture of [...captures(session), ...(session.stagedOriginals ?? [])]) protectedUris.add(capture.fileUri); };
  const release = (uri: string) => {
    if (copying.has(uri) || protectedUris.has(uri) || !owned.delete(uri)) return;
    void p.releaseTreatment(uri).catch(() => {});
  };
  const cleanup = () => { for (const uri of owned) release(uri); };
  const cancel = () => {
    if (flight && !flight.cancelled) { flight.cancelled = true; try { p.cancelTreatment(flight.id); } catch {} }
  };
  function fail(error: unknown, g: number, fallback = 'treatment-render-failed') {
    if (!current(g)) return;
    ack = null;
    state = { ...state!, phase: 'error', previewUri: original!.fileUri, effectiveRecipe: photoTreatmentForCapture(original!),
      error: error instanceof TreatmentEditorError ? error.message : fallback };
    cleanup(); emit();
  }
  function findPrior(session: ActiveSession, recipe: PhotoTreatment, src: ActiveCapture, slot: number): ActiveCapture | undefined {
    if (isOriginalTreatment(recipe)) return badPreviews.has(src.fileUri) ? undefined : src;
    return captures(session).find(capture => {
      if (capture.sourcePhotoId !== src.id || capture.confirmed || badPreviews.has(capture.fileUri) || !localJPEG(capture.fileUri)
        || (capture.sessionId !== undefined && capture.sessionId !== session.id) || (capture.shotIndex !== undefined && capture.shotIndex !== slot)) return false;
      try { return samePhotoTreatment(photoTreatmentForCapture(capture), recipe); } catch { return false; }
    });
  }
  function validate(result: PhotoTreatmentRenderResult, requested: PhotoTreatment, src: ActiveCapture) {
    if (!result || !isPhotoTreatment(result.recipe) || !localJPEG(result.uri)
      || !Number.isInteger(result.width) || result.width <= 0 || !Number.isInteger(result.height) || result.height <= 0
      || !/^[a-f0-9]{64}$/i.test(result.originalSha256) || !/^[a-f0-9]{64}$/i.test(result.outputSha256)
      || typeof result.isOriginal !== 'boolean') throw new TreatmentEditorError('invalid-treatment-result');
    const count = (value: unknown) => value === null || (Number.isInteger(value) && Number(value) >= 0);
    if (!count(result.detectedFaceCount) || !count(result.landmarkedFaceCount)
      || !Number.isInteger(result.decoratedFaceCount) || result.decoratedFaceCount < 0
      || !['none', 'no-face', 'no-usable-face', 'partial'].includes(result.fallbackReason)
      || (result.detectedFaceCount !== null && result.landmarkedFaceCount !== null && result.landmarkedFaceCount > result.detectedFaceCount)
      || (result.landmarkedFaceCount !== null && result.decoratedFaceCount > result.landmarkedFaceCount)
      || (result.detectedFaceCount !== null && result.decoratedFaceCount > result.detectedFaceCount)) throw new TreatmentEditorError('invalid-treatment-counts');
    if (!samePhotoTreatment({ ...requested, face: result.recipe.face }, result.recipe)) throw new TreatmentEditorError('treatment-recipe-mismatch');
    const fallback = result.fallbackReason === 'no-face' || result.fallbackReason === 'no-usable-face';
    if (fallback ? (requested.face.accessory === 'none' || result.recipe.face.accessory !== 'none' || result.decoratedFaceCount !== 0
      || (result.fallbackReason === 'no-face' && result.detectedFaceCount !== 0))
      : result.recipe.face.accessory !== requested.face.accessory) throw new TreatmentEditorError('treatment-recipe-mismatch');
    if (result.recipe.face.accessory === 'none' ? result.decoratedFaceCount !== 0
      : result.decoratedFaceCount === 0) throw new TreatmentEditorError('invalid-treatment-counts');
    if ((requested.face.accessory === 'none' && result.fallbackReason !== 'none') || (result.fallbackReason === 'partial' && result.decoratedFaceCount === 0)) throw new TreatmentEditorError('invalid-treatment-counts');
    const identity = isOriginalTreatment(result.recipe);
    if (result.isOriginal !== identity || (identity ? result.uri !== src.fileUri || result.originalSha256 !== result.outputSha256
      : result.uri === src.fileUri || protectedUris.has(result.uri))) throw new TreatmentEditorError('invalid-treatment-output');
    const priorHash = sourceHashes.get(src.fileUri);
    if (priorHash && priorHash !== result.originalSha256.toLowerCase()) throw new TreatmentEditorError('treatment-source-changed');
    sourceHashes.set(src.fileUri, result.originalSha256.toLowerCase());
  }
  function ready(recipe: PhotoTreatment, uri: string, result?: PhotoTreatmentRenderResult) {
    desired = treatmentCopy(recipe);
    state = { ...state!, phase: 'ready', previewUri: uri, preset: recipe.look.preset, intensity: recipe.look.intensity,
      faceAccessory: recipe.face.accessory, effectiveRecipe: treatmentCopy(recipe), error: undefined,
      detectedFaceCount: result?.detectedFaceCount ?? null, landmarkedFaceCount: result?.landmarkedFaceCount ?? null,
      decoratedFaceCount: result?.decoratedFaceCount ?? null, fallbackReason: result?.fallbackReason ?? null };
    emit();
  }
  function pump() {
    if (flight || !state || state.phase !== 'previewing' || !original || !desired) return;
    const g = generation, src = original, recipe = treatmentCopy(desired), id = p.id();
    const work = { id, generation: g, cancelled: false };
    flight = work;
    void (async () => {
      try {
        const result = await p.renderTreatment(src.fileUri, canonicalPhotoTreatment(recipe), id);
        if (result && localJPEG(result.uri) && !protectedUris.has(result.uri)) owned.add(result.uri);
        if (!current(g)) { if (result?.uri) release(result.uri); return; }
        validate(result, recipe, src);
        ack = { kind: 'render', result: { ...result, recipe: treatmentCopy(result.recipe) }, requestedRecipe: recipe };
        ready(result.recipe, result.uri, result);
      } catch (error) { fail(error, g); }
      finally { if (flight === work) flight = null; pump(); }
    })();
  }
  function close() {
    generation++; cancel(); state = null; original = null; desired = null; knownSession = null; ack = null;
    cleanup(); emit();
  }
  function chooseTreatment(recipe: PhotoTreatment) {
    if (!state || state.phase === 'saving' || !original || !knownSession) return;
    if (state.phase === 'ready' && desired && samePhotoTreatment(desired, recipe)) return;
    const g = ++generation;
    cancel(); ack = null; cleanup();
    try { recipe = treatmentCopy(recipe); }
    catch { fail(new TreatmentEditorError('invalid-treatment'), g); return; }
    desired = recipe;
    state = { ...state, preset: recipe.look.preset, intensity: recipe.look.intensity, faceAccessory: recipe.face.accessory,
      phase: 'previewing', previewUri: original.fileUri, effectiveRecipe: photoTreatmentForCapture(original), error: undefined,
      detectedFaceCount: null, landmarkedFaceCount: null, decoratedFaceCount: null, fallbackReason: null };
    const prior = findPrior(knownSession, recipe, original, state.slot);
    if (prior) { ack = { kind: 'capture', capture: prior, recipe }; ready(recipe, prior.fileUri); }
    else if (isOriginalTreatment(recipe)) fail(new TreatmentEditorError('treatment-original-unavailable'), g);
    else { emit(); pump(); }
  }
  function choose(preset: PhotoLookPreset, intensity: number) {
    if (!state || state.phase === 'saving' || !desired) return;
    if (!['original', 'warm', 'bw', 'film'].includes(preset) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      fail(new TreatmentEditorError('invalid-look'), ++generation); cancel(); return;
    }
    chooseTreatment({ ...treatmentCopy(desired), look: { preset, intensity: preset === 'original' ? 0 : intensity, version } });
  }
  function chooseFace(accessory: FaceAccessory) {
    if (!state || state.phase === 'saving' || !desired) return;
    if (!['none', 'glasses', 'crown', 'hearts'].includes(accessory)) { fail(new TreatmentEditorError('invalid-face'), ++generation); cancel(); return; }
    chooseTreatment({ ...treatmentCopy(desired), face: { accessory, version: 'wedding-face-prototype-v3' } });
  }
  function open(session: ActiveSession, slot: number) {
    close();
    try {
      const found = treatmentSource(session, slot); original = { ...found.original }; knownSession = session; protect(session);
      state = { phase: 'previewing', previewUri: original.fileUri, preset: 'original', intensity: 0,
        sessionId: session.id, photoId: found.selected.id, sourcePhotoId: original.id, slot, faceSupported: true, faceAccessory: 'none' };
      chooseTreatment(photoTreatmentForCapture(found.selected));
    } catch { state = null; original = null; knownSession = null; desired = null; ack = null; emit(); }
  }
  function apply(): Promise<boolean> {
    if (applying) return current(applying.generation) && state?.sessionId === applying.sessionId ? applying.job : Promise.resolve(false);
    if (!state || state.phase !== 'ready' || !original || !ack || !state.effectiveRecipe) return Promise.resolve(false);
    const s = { ...state }, src = original, receipt = ack, recipe = treatmentCopy(state.effectiveRecipe), g = generation;
    state = { ...state, phase: 'saving' }; emit();
    let copyingUri: string | undefined, committedId: string | undefined, commitStarted = false;
    const job = (async () => {
      try {
        const latest = await p.loadSession(s.sessionId);
        if (!current(g)) return false;
        if (!latest) throw new TreatmentEditorError('capture-session');
        const fresh = treatmentSource(latest, s.slot, s.photoId);
        if (fresh.original.id !== src.id || fresh.original.fileUri !== src.fileUri) throw new TreatmentEditorError('render-source');
        let prior: ActiveCapture | undefined;
        if (receipt.kind === 'capture') {
          prior = captures(latest).find(capture => capture.id === receipt.capture.id && capture.fileUri === s.previewUri);
          if (!prior || (isOriginalTreatment(recipe) ? prior.id !== src.id : prior.sourcePhotoId !== src.id
            || !samePhotoTreatment(photoTreatmentForCapture(prior), recipe))) throw new TreatmentEditorError('treatment-preview-stale');
        } else if (isOriginalTreatment(recipe) && receipt.result.uri === src.fileUri) prior = fresh.original;
        let updated: ActiveSession;
        if (prior) {
          committedId = prior.id;
          commitStarted = true;
          updated = prior.id === fresh.selected.id ? latest : await p.selectSavedPhoto(s.sessionId, prior.id, s.slot, s.photoId);
        } else {
          if (receipt.kind !== 'render' || !samePhotoTreatment(receipt.result.recipe, recipe)) throw new TreatmentEditorError('treatment-preview-required');
          validate(receipt.result, receipt.requestedRecipe, src);
          if (!current(g)) return false;
          const id = p.id();
          copyingUri = receipt.result.uri; copying.add(copyingUri); committedId = id; commitStarted = true;
          updated = await p.saveRenderedPhoto(s.sessionId, { id, newRenderedURI: copyingUri, sourcePhotoId: src.id, treatment: recipe,
            sourceSha256: receipt.result.originalSha256, outputSha256: receipt.result.outputSha256,
            expectedSelectedPhotoId: s.photoId, slot: s.slot, admit: () => current(g) });
        }
        if (updated.id !== s.sessionId || updated.shots.find((capture, index) => (capture.shotIndex ?? index) === s.slot)?.id !== committedId) throw new TreatmentEditorError('treatment-save-unacknowledged');
        protect(updated);
        if (current(g)) { p.onSession(updated); if (current(g)) close(); }
        return true;
      } catch (error) {
        // A failed acknowledgement can follow a durable commit. Re-read before calling it a cancellation.
        try {
          const latest = await p.loadSession(s.sessionId);
          const selected = latest?.shots.find((capture, index) => (capture.shotIndex ?? index) === s.slot);
          if (commitStarted && committedId && latest?.id === s.sessionId && selected && selected.id === committedId
            && samePhotoTreatment(photoTreatmentForCapture(selected), recipe)) {
            protect(latest);
            if (current(g)) { p.onSession(latest); if (current(g)) close(); }
            return true;
          }
        } catch {}
        fail(error, g, 'treatment-save-failed'); return false;
      } finally { if (copyingUri) { copying.delete(copyingUri); release(copyingUri); } }
    })();
    const operation = { generation: g, sessionId: s.sessionId, job };
    applying = operation;
    void job.finally(() => { if (applying === operation) applying = null; });
    return job;
  }
  function previewFailed(uri: string) {
    if (!state || state.phase === 'saving' || state.previewUri !== uri) return;
    badPreviews.add(uri);
    const g = ++generation; cancel();
    fail(new TreatmentEditorError('treatment-preview-load-failed'), g);
  }
  return { open, choose, chooseFace, apply, close, previewFailed };
}

export function createPhotoLookEditor(p: PhotoLookEditorPorts) {
  if (typeof p.renderTreatment === 'function' && typeof p.cancelTreatment === 'function' && typeof p.releaseTreatment === 'function') return createTreatmentPhotoLookEditor(p as TreatmentPorts);
  return { ...createLegacyPhotoLookEditor(p), chooseFace: (_accessory: FaceAccessory) => {} };
}
