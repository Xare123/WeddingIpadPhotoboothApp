import type { ActiveSession, CompositeRecipe, PhotoCrop } from './local-types';
import type { CompositeInput } from './local-persistence';
type Theme = CompositeRecipe['theme'];
export type TemplateRenderResult = {
    uri: string;
    width: number;
    height: number;
    preview: boolean;
    version: string;
    recipeJSON: string;
    sourceHashes: Record<string, string>;
};
export type TemplateEditorState = {
    recipe: CompositeRecipe;
    phase: 'previewing' | 'ready' | 'saving' | 'error';
    previewUri: string | null;
    themePreviews: Partial<Record<Theme, string>>;
    sessionId: string;
    error?: string;
};
export type TemplateEditorPorts = {
    renderTemplate(sources: {
        photoId: string;
        uri: string;
    }[], recipeJSON: string, preview: boolean, requestUUID: string): Promise<TemplateRenderResult>;
    cancelTemplate(requestUUID: string): void;
    releaseTemplate(uri: string): Promise<void>;
    id(): string;
    loadSession(sessionId: string): Promise<ActiveSession | null>;
    saveComposite(sessionId: string, input: CompositeInput): Promise<ActiveSession>;
    onState(state: TemplateEditorState | null): void;
    onSession(session: ActiveSession): void;
};
const version = 'wedding-template-v1', themes: Theme[] = ['classic', 'botanical', 'coastal'];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function sorted(v: unknown): unknown { if (Array.isArray(v))
    return v.map(sorted); if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])); return v; }
export const canonicalTemplateRecipe = (recipe: CompositeRecipe): string => JSON.stringify(sorted(recipe));
function cropValid(c: PhotoCrop) { return c && ['fit', 'fill'].includes(c.mode) && Number.isFinite(c.x) && Math.abs(c.x) <= 1 && Number.isFinite(c.y) && Math.abs(c.y) <= 1 && Number.isFinite(c.zoom) && c.zoom >= 1 && c.zoom <= 1.5 && (c.mode !== 'fit' || (c.x === 0 && c.y === 0 && c.zoom === 1)); }
function selection(s: ActiveSession) {
    const photos = [...s.shots].sort((a, b) => (a.shotIndex ?? s.shots.indexOf(a)) - (b.shotIndex ?? s.shots.indexOf(b)));
    if (s.confirmed || s.targetCount !== 4 || photos.length !== 4 || new Set(photos.map(x => x.id)).size !== 4 || photos.some((x, i) => x.confirmed || !x.id || !x.fileUri || (x.sessionId !== undefined && x.sessionId !== s.id) || (x.shotIndex !== undefined && x.shotIndex !== i)))
        throw new Error('invalid-template-selection');
    return photos;
}
function validRecipe(r: CompositeRecipe, ids: string[]) { return r && r.version === version && ['strip', 'grid'].includes(r.layout) && themes.includes(r.theme) && r.photoIds?.length === 4 && new Set(r.photoIds).size === 4 && r.photoIds.every(id => ids.includes(id)) && Object.keys(r.cropsByPhotoId ?? {}).length === 4 && r.photoIds.every(id => cropValid(r.cropsByPhotoId[id]!)); }
export function createTemplateEditor(p: TemplateEditorPorts) {
    let state: TemplateEditorState | null = null, sources: {
        photoId: string;
        uri: string;
    }[] = [], expected: string[] = [], generation = 0, saving: Promise<boolean> | null = null;
    const requests = new Set<string>(), owned = new Set<string>(), copying = new Set<string>();
    let receipts: Partial<Record<Theme, TemplateRenderResult>> = {};
    const emit = () => p.onState(state ? clone(state) : null), current = (g: number) => !!state && generation === g;
    const release = (uri: string) => { if (owned.delete(uri))
        void p.releaseTemplate(uri).catch(() => { }); };
    const cancel = () => { for (const id of requests)
        p.cancelTemplate(id); requests.clear(); };
    const dispose = () => { for (const uri of owned)
        if (!copying.has(uri))
            release(uri); };
    const acceptURI = (uri: string) => { try {
        const u = new URL(uri);
        return u.protocol === 'file:' && !u.hostname && /\.jpe?g$/i.test(u.pathname) && !u.search && !u.hash && !sources.some(s => s.uri === uri);
    }
    catch {
        return false;
    } };
    const own = (uri: string, inputs: {
        uri: string;
    }[]) => { if (uri && !inputs.some(s => s.uri === uri))
        owned.add(uri); };
    function fail(e: unknown, g: number) { if (current(g)) {
        generation++;
        cancel();
        receipts = {};
        state = { ...state!, phase: 'error', previewUri: null, themePreviews: {}, error: e instanceof Error ? e.message : String(e) };
        emit();
        dispose();
    } }
    function validate(r: TemplateRenderResult, recipe: CompositeRecipe, preview: boolean) {
        const dimensions = recipe.layout === 'strip' ? [1200, 3600] : [2400, 2100];
        if (!r || !acceptURI(r.uri) || r.version !== version || r.preview !== preview || r.recipeJSON !== canonicalTemplateRecipe(recipe) || !Number.isInteger(r.width) || !Number.isInteger(r.height) || r.width <= 0 || r.height <= 0 || (preview ? Math.max(r.width, r.height) > 1440 || r.width > dimensions[0]! || r.height > dimensions[1]! || Math.abs(r.width * dimensions[1]! - r.height * dimensions[0]!) > Math.max(...dimensions) : r.width !== dimensions[0] || r.height !== dimensions[1]) || !r.sourceHashes || Object.keys(r.sourceHashes).length !== 4 || !recipe.photoIds.every(id => /^[a-f0-9]{64}$/i.test(r.sourceHashes[id] ?? '')))
            throw new Error('invalid-template-render');
    }
    function updatePreview() { if (!state)
        return; const r = receipts[state.recipe.theme]; state = { ...state, phase: r ? 'ready' : 'previewing', previewUri: r?.uri ?? null, themePreviews: Object.fromEntries(themes.filter(t => receipts[t]).map(t => [t, receipts[t]!.uri])), error: undefined }; emit(); }
    async function previewTheme(theme: Theme, g: number) { const recipe = { ...clone(state!.recipe), theme }, input = recipe.photoIds.map(id => sources.find(s => s.photoId === id)!); const id = p.id(); requests.add(id); try {
        const r = await p.renderTemplate(input, canonicalTemplateRecipe(recipe), true, id);
        own(r.uri, input);
        if (!current(g)) {
            release(r.uri);
            return;
        }
        validate(r, recipe, true);
        receipts[theme] = r;
        requests.delete(id);
        updatePreview();
    }
    catch (e) {
        fail(e, g);
    } }
    function refresh() { const g = ++generation; cancel(); receipts = {}; dispose(); state = { ...state!, phase: 'previewing', previewUri: null, themePreviews: {}, error: undefined }; emit(); for (const theme of themes)
        void previewTheme(theme, g); }
    function close() { generation++; cancel(); state = null; receipts = {}; dispose(); emit(); }
    function open(session: ActiveSession) { close(); try {
        const photos = selection(session);
        expected = photos.map(x => x.id);
        sources = photos.map(x => ({ photoId: x.id, uri: x.fileUri }));
        const recipe: CompositeRecipe = validRecipe(session.composite?.recipe!, expected) ? clone(session.composite!.recipe) : { version, layout: 'strip', theme: 'classic', photoIds: [...expected], cropsByPhotoId: Object.fromEntries(expected.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) };
        state = { sessionId: session.id, recipe, phase: 'previewing', previewUri: null, themePreviews: {} };
        refresh();
    }
    catch {
        state = null;
        emit();
    } }
    function mutate(change: (r: CompositeRecipe) => void) { if (!state || state.phase === 'saving')
        return; const recipe = clone(state.recipe); change(recipe); if (!validRecipe(recipe, expected)) {
        fail(new Error('invalid-template-recipe'), generation);
        return;
    } state = { ...state, recipe }; refresh(); }
    function chooseLayout(layout: CompositeRecipe['layout']) { mutate(r => { r.layout = layout; }); }
    function chooseTheme(theme: Theme) { if (!state || state.phase === 'saving')
        return; if (!themes.includes(theme)) {
        fail(new Error('invalid-template-theme'), generation);
        return;
    } const retry = state.phase === 'error'; state = { ...state, recipe: { ...state.recipe, theme } }; if (retry)
        refresh();
    else
        updatePreview(); }
    function swapPhotos(a: string, b: string) { mutate(r => { const i = r.photoIds.indexOf(a), j = r.photoIds.indexOf(b); if (i < 0 || j < 0) {
        r.photoIds = [];
        return;
    } [r.photoIds[i], r.photoIds[j]] = [r.photoIds[j]!, r.photoIds[i]!]; }); }
    function setCrop(id: string, crop: PhotoCrop) { mutate(r => { r.cropsByPhotoId[id] = clone(crop); }); }
    function assertCurrent(s: ActiveSession | null, ids: string[], input: {
        photoId: string;
        uri: string;
    }[]) { if (!s)
        throw new Error('capture-session'); const now = selection(s); if (now.some((x, i) => x.id !== ids[i] || x.fileUri !== input.find(y => y.photoId === x.id)?.uri))
        throw new Error('stale-template-selection'); }
    function save(): Promise<boolean> { if (saving)
        return saving; if (!state || state.phase !== 'ready')
        return Promise.resolve(false); const s = clone(state), ack = receipts[s.recipe.theme]!, g = generation, input = s.recipe.photoIds.map(id => sources.find(x => x.photoId === id)!), ids = [...expected]; state = { ...state, phase: 'saving' }; emit(); const job = (async () => { let output: string | undefined; try {
        assertCurrent(await p.loadSession(s.sessionId), ids, input);
        if (!current(g))
            return false;
        const id = p.id();
        requests.add(id);
        const r = await p.renderTemplate(input, canonicalTemplateRecipe(s.recipe), false, id);
        own(r.uri, input);
        output = r.uri;
        if (!current(g))
            return false;
        validate(r, s.recipe, false);
        if (s.recipe.photoIds.some(id => r.sourceHashes[id] !== ack.sourceHashes[id]))
            throw new Error('template-source-mismatch');
        requests.delete(id);
        assertCurrent(await p.loadSession(s.sessionId), ids, input);
        if (!current(g))
            return false;
        copying.add(r.uri);
        const updated = await p.saveComposite(s.sessionId, { id: p.id(), newRenderedURI: r.uri, recipe: s.recipe, expectedSelectedPhotoIds: ids });
        p.onSession(updated);
        if (current(g))
            close();
        return true;
    }
    catch (e) {
        try {
            const latest = await p.loadSession(s.sessionId);
            if (latest)
                p.onSession(latest);
        }
        catch { }
        fail(e, g);
        return false;
    }
    finally {
        if (output) {
            copying.delete(output);
            release(output);
        }
    } })(); saving = job; void job.finally(() => { if (saving === job)
        saving = null; }); return job; }
    function previewFailed(uri: string) {
        if (!state || state.phase === 'saving' || !Object.values(receipts).some(receipt => receipt?.uri === uri)) return;
        fail(new Error('preview-load-failed'), generation);
    }
    return { open, chooseLayout, chooseTheme, swapPhotos, setCrop, save, close, previewFailed };
}
