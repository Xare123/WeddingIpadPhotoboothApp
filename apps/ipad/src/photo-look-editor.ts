import type { ActiveCapture, ActiveSession, PhotoLook } from './local-types';
import type { RenderedPhotoInput } from './local-persistence';

export type PhotoLookPreset = 'original' | PhotoLook['preset'];
export type PhotoLookRenderResult = { uri: string; width: number; height: number; recipeVersion: string; preset: PhotoLookPreset; intensity: number; originalSha256: string; isOriginal: boolean; preview: boolean };
export type PhotoLookEditorState = { phase: 'previewing' | 'ready' | 'saving' | 'error'; previewUri: string; preset: PhotoLookPreset; intensity: number; sessionId: string; photoId: string; sourcePhotoId: string; slot: number; error?: string };
export type EditorState = PhotoLookEditorState;
export type PhotoLookEditorPorts = {
  render(sourceUri: string, preset: PhotoLookPreset, intensity: number, preview: boolean, requestUUID: string): Promise<PhotoLookRenderResult>;
  cancel(requestUUID: string): void; release(uri: string): Promise<void>; id(): string;
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
export function createPhotoLookEditor(p: PhotoLookEditorPorts) {
  let state: PhotoLookEditorState | null = null, original: ActiveCapture | null = null;
  let generation = 0, request: string | null = null, preview: PhotoLookRenderResult | null = null, applying: Promise<boolean> | null = null;
  const owned = new Set<string>(), copying = new Set<string>();
  const emit = () => p.onState(state ? { ...state } : null);
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
