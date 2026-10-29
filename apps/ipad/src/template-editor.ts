import type { ActiveSession, CompositeRecipe, PhotoCrop } from './local-types';
import type { CompositeInput } from './local-persistence';
type Theme = CompositeRecipe['theme'];
export const TEMPLATE_LAYOUTS = [
    { id: 'grid', label: 'Social grid' },
    { id: 'strip', label: 'Photo strip' },
] as const;
export type TemplateSourceInspection = {
    version: 'wedding-template-v3';
    gridAspect: 'portrait' | 'square';
    sources: {
        photoId: string;
        width: number;
        height: number;
        sha256: string;
    }[];
};
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
    recipe: CompositeRecipe | null;
    phase: 'inspecting' | 'previewing' | 'ready' | 'saving' | 'error';
    previewUri: string | null;
    themePreviews: Partial<Record<Theme, string>>;
    sessionId: string;
    error?: string;
};
export type TemplateEditorPorts = {
    inspectTemplateSources(sources: {
        photoId: string;
        uri: string;
    }[]): Promise<TemplateSourceInspection>;
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
function sorted(v: unknown): unknown {
    if (Array.isArray(v))
        return v.map(sorted);
    if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)]));
    return v;
}
export const canonicalTemplateRecipe = (recipe: CompositeRecipe): string => JSON.stringify(sorted(recipe));
function cropValid(c: PhotoCrop) { return c && ['fit', 'fill'].includes(c.mode) && Number.isFinite(c.x) && Math.abs(c.x) <= 1 && Number.isFinite(c.y) && Math.abs(c.y) <= 1 && Number.isFinite(c.zoom) && c.zoom >= 1 && c.zoom <= 1.5 && (c.mode !== 'fit' || (c.x === 0 && c.y === 0 && c.zoom === 1)); }
function selection(s: ActiveSession) {
    const photos = [...s.shots].sort((a, b) => (a.shotIndex ?? s.shots.indexOf(a)) - (b.shotIndex ?? s.shots.indexOf(b)));
    if (s.retakeState === 'abandoned' || s.confirmed || s.targetCount !== 4 || photos.length !== 4 || new Set(photos.map(x => x.id)).size !== 4 || photos.some((x, i) => x.confirmed || !x.id || !x.fileUri || (x.sessionId !== undefined && x.sessionId !== s.id) || (x.shotIndex !== undefined && x.shotIndex !== i)))
        throw new Error('invalid-template-selection');
    return photos;
}
function validRecipe(r: CompositeRecipe, ids: string[]) { return r && (r.version === version || (r.version === 'wedding-template-v2' && ['portrait', 'square'].includes(r.gridAspect)) || (r.version === 'wedding-template-v3' && r.gridAspect === 'square')) && ['strip', 'grid'].includes(r.layout) && themes.includes(r.theme) && r.photoIds?.length === 4 && new Set(r.photoIds).size === 4 && r.photoIds.every(id => ids.includes(id)) && Object.keys(r.cropsByPhotoId ?? {}).length === 4 && r.photoIds.every(id => cropValid(r.cropsByPhotoId[id]!)); }
export function templateDimensions(recipe: CompositeRecipe): readonly [
    number,
    number
] { return recipe.layout === 'strip' ? [1200, 3600] : recipe.version === 'wedding-template-v1' ? [2400, 2100] : recipe.gridAspect === 'portrait' ? [2400, 3000] : [2400, 2400]; }
export function createTemplateEditor(p: TemplateEditorPorts) {
    let state: TemplateEditorState | null = null, sources: {
        photoId: string;
        uri: string;
    }[] = [], expected: string[] = [], generation = 0, saving: Promise<boolean> | null = null;
    const fullReceipts = new Map<string, TemplateRenderResult>();
    const inspectionJobs = new Map<string, Promise<Readonly<{
        uri: string;
        width: number;
        height: number;
    }> | null>>();
    const requests = new Set<string>(), owned = new Set<string>(), copying = new Set<string>();
    let initialDefaults: ActiveSession['templateDefaults'];
    let receipts: Partial<Record<Theme, TemplateRenderResult>> = {};
    let inspectedHashes: Record<string, string> | null = null;
    let cancelInspection: (() => void) | null = null;
    const emit = () => p.onState(state ? clone(state) : null), current = (g: number) => !!state && generation === g;
    const release = (uri: string) => {
        if (owned.delete(uri))
            void p.releaseTemplate(uri).catch(() => { });
    };
    const cancel = () => {
        cancelInspection?.();
        cancelInspection = null;
        for (const id of requests)
            p.cancelTemplate(id);
        requests.clear();
    };
    const dispose = () => {
        fullReceipts.clear();
        for (const uri of owned)
            if (!copying.has(uri))
                release(uri);
    };
    const acceptURI = (uri: string) => {
        try {
            const u = new URL(uri);
            return u.protocol === 'file:' && !u.hostname && /\.jpe?g$/i.test(u.pathname) && !u.search && !u.hash && !sources.some(s => s.uri === uri);
        }
        catch {
            return false;
        }
    };
    const own = (uri: string, inputs: {
        uri: string;
    }[]) => {
        if (uri && !inputs.some(s => s.uri === uri))
            owned.add(uri);
    };
    function fail(e: unknown, g: number) {
        if (current(g)) {
            generation++;
            cancel();
            receipts = {};
            state = { ...state!, phase: 'error', previewUri: null, themePreviews: {}, error: e instanceof Error ? e.message : String(e) };
            emit();
            dispose();
        }
    }
    function validate(r: TemplateRenderResult, recipe: CompositeRecipe, preview: boolean) {
        const dimensions = templateDimensions(recipe);
        if (!r || !acceptURI(r.uri) || r.version !== recipe.version || r.preview !== preview || r.recipeJSON !== canonicalTemplateRecipe(recipe) || !Number.isInteger(r.width) || !Number.isInteger(r.height) || r.width <= 0 || r.height <= 0 || (preview ? Math.max(r.width, r.height) > 1440 || r.width > dimensions[0]! || r.height > dimensions[1]! || Math.abs(r.width * dimensions[1]! - r.height * dimensions[0]!) > Math.max(...dimensions) : r.width !== dimensions[0] || r.height !== dimensions[1]) || !r.sourceHashes || Object.keys(r.sourceHashes).length !== 4 || !recipe.photoIds.every(id => /^[a-f0-9]{64}$/i.test(r.sourceHashes[id] ?? '')))
            throw new Error('invalid-template-render');
        if (inspectedHashes && recipe.photoIds.some(id => r.sourceHashes[id] !== inspectedHashes![id]))
            throw new Error('template-inspection-mismatch');
    }
    function updatePreview() {
        if (!state?.recipe)
            return;
        const r = receipts[state.recipe.theme];
        state = { ...state, phase: state.phase === 'saving' ? 'saving' : r ? 'ready' : 'previewing', previewUri: r?.uri ?? null, themePreviews: Object.fromEntries(themes.filter(t => receipts[t]).map(t => [t, receipts[t]!.uri])), error: undefined };
        emit();
    }
    async function previewTheme(theme: Theme, g: number) {
        const recipe = { ...clone(state!.recipe!), theme }, input = recipe.photoIds.map(id => sources.find(s => s.photoId === id)!);
        const id = p.id();
        requests.add(id);
        try {
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
        }
    }
    function refresh() {
        const g = ++generation;
        cancel();
        receipts = {};
        dispose();
        state = { ...state!, phase: 'previewing', previewUri: null, themePreviews: {}, error: undefined };
        emit();
        for (const theme of themes)
            void previewTheme(theme, g);
    }
    function close() { initialDefaults = undefined; generation++; cancel(); state = null; receipts = {}; inspectedHashes = null; dispose(); emit(); }
    async function inspect(g: number) {
        const sessionId = state!.sessionId, input = sources.map(x => ({ ...x })), ids = [...expected];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            assertCurrent(await p.loadSession(sessionId), ids, input);
            if (!current(g))
                return;
            const interrupted = new Promise<never>((_, reject) => {
                cancelInspection = () => reject(new Error('template-inspection-cancelled'));
                timer = setTimeout(() => reject(new Error('template-inspection-timeout')), 15000);
            });
            const result = await Promise.race([p.inspectTemplateSources(input), interrupted]);
            if (!current(g))
                return;
            if (!result || result.version !== 'wedding-template-v3' || !['portrait', 'square'].includes(result.gridAspect) || !Array.isArray(result.sources) || result.sources.length !== 4 || result.sources.some((x, i) => x.photoId !== ids[i] || !Number.isInteger(x.width) || !Number.isInteger(x.height) || x.width <= 0 || x.height <= 0 || x.width > 24000 || x.height > 24000 || x.width * x.height > 24000000 || !/^[a-f0-9]{64}$/i.test(x.sha256)))
                throw new Error('invalid-template-inspection');
            const ratios = result.sources.map(x => x.width / x.height).sort((a, b) => a - b);
            if (result.gridAspect !== ((ratios[1]! + ratios[2]!) / 2 < 0.95 ? 'portrait' : 'square'))
                throw new Error('invalid-template-inspection-aspect');
            assertCurrent(await p.loadSession(sessionId), ids, input);
            if (!current(g))
                return;
            inspectedHashes = Object.fromEntries(result.sources.map(x => [x.photoId, x.sha256]));
            state = { ...state!, recipe: { version: 'wedding-template-v3', gridAspect: 'square', layout: initialDefaults?.layout ?? 'grid', theme: initialDefaults?.theme ?? 'classic', photoIds: ids, cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fill', x: 0, y: -1, zoom: 1 }])) } };
            cancelInspection = null;
            refresh();
        }
        catch (e) {
            fail(e, g);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    function open(session: ActiveSession) {
        close();
        try {
            const photos = selection(session);
            const defaults = session.templateDefaults;
            if (defaults && ['strip', 'grid'].includes(defaults.layout) && themes.includes(defaults.theme) &&
                (defaults.gridAspect === undefined || ['portrait', 'square'].includes(defaults.gridAspect))) initialDefaults = clone(defaults);
            expected = photos.map(x => x.id);
            sources = photos.map(x => ({ photoId: x.id, uri: x.fileUri }));
            const recipe = validRecipe(session.composite?.recipe!, expected) ? clone(session.composite!.recipe) : null;
            state = { sessionId: session.id, recipe, phase: recipe ? 'previewing' : 'inspecting', previewUri: null, themePreviews: {} };
            if (recipe)
                refresh();
            else {
                emit();
                void inspect(generation);
            }
        }
        catch {
            state = null;
            emit();
        }
    }
    function retryInspection() { if (state && !state.recipe && state.phase === 'error') {
        const g = ++generation;
        state = { ...state, phase: 'inspecting', error: undefined };
        emit();
        void inspect(g);
    } }
    function mutate(change: (r: CompositeRecipe) => void) {
        if (!state?.recipe || state.phase === 'saving')
            return;
        const recipe = clone(state.recipe);
        change(recipe);
        if (!validRecipe(recipe, expected)) {
            fail(new Error('invalid-template-recipe'), generation);
            return;
        }
        state = { ...state, recipe };
        refresh();
    }
    function chooseLayout(layout: CompositeRecipe['layout']) { mutate(r => { r.layout = layout; }); }
    function chooseTheme(theme: Theme) {
        if (!state?.recipe || state.phase === 'saving')
            return;
        if (!themes.includes(theme)) {
            fail(new Error('invalid-template-theme'), generation);
            return;
        }
        const retry = state.phase === 'error';
        state = { ...state, recipe: { ...state.recipe, theme } };
        if (retry)
            refresh();
        else
            updatePreview();
    }
    function swapPhotos(a: string, b: string) {
        mutate(r => {
            const i = r.photoIds.indexOf(a), j = r.photoIds.indexOf(b);
            if (i < 0 || j < 0) {
                r.photoIds = [];
                return;
            }
            [r.photoIds[i], r.photoIds[j]] = [r.photoIds[j]!, r.photoIds[i]!];
        });
    }
    function setCrops(crops: Record<string, PhotoCrop>) { mutate(r => { for (const [id, crop] of Object.entries(crops))
        r.cropsByPhotoId[id] = clone(crop); }); }
    function setCrop(id: string, crop: PhotoCrop) { mutate(r => { r.cropsByPhotoId[id] = clone(crop); }); }
    function assertCurrent(s: ActiveSession | null, ids: string[], input: {
        photoId: string;
        uri: string;
    }[]) {
        if (!s)
            throw new Error('capture-session');
        const now = selection(s);
        if (now.some((x, i) => x.id !== ids[i] || x.fileUri !== input.find(y => y.photoId === x.id)?.uri))
            throw new Error('stale-template-selection');
    }
    function renderInspection(): Promise<Readonly<{
        uri: string;
        width: number;
        height: number;
    }> | null> {
        if (!state?.recipe || state.phase !== 'ready')
            return Promise.resolve(null);
        const recipe = clone(state.recipe), key = canonicalTemplateRecipe(recipe), g = generation, jobKey = `${g}:${key}`, sessionId = state.sessionId;
        const existing = inspectionJobs.get(jobKey);
        if (existing)
            return existing;
        const ack = receipts[recipe.theme]!, input = recipe.photoIds.map(id => sources.find(x => x.photoId === id)!), ids = [...expected];
        const active = () => current(g) && !!state?.recipe && canonicalTemplateRecipe(state.recipe) === key && state.phase === 'ready';
        const job = (async () => {
            let output: string | undefined;
            try {
                assertCurrent(await p.loadSession(sessionId), ids, input);
                if (!active())
                    return null;
                let result = fullReceipts.get(key);
                if (!result) {
                    const request = p.id();
                    requests.add(request);
                    result = await p.renderTemplate(input, key, false, request);
                    own(result.uri, input);
                    output = result.uri;
                    requests.delete(request);
                }
                if (!active())
                    return null;
                validate(result, recipe, false);
                if (recipe.photoIds.some(id => result.sourceHashes[id] !== ack.sourceHashes[id]))
                    throw new Error('template-source-mismatch');
                assertCurrent(await p.loadSession(sessionId), ids, input);
                if (!active())
                    return null;
                fullReceipts.set(key, result);
                output = undefined;
                return Object.freeze({ uri: result.uri, width: result.width, height: result.height });
            }
            catch (e) {
                if (active())
                    fail(e, g);
                return null;
            }
            finally {
                if (output)
                    release(output);
            }
        })();
        inspectionJobs.set(jobKey, job);
        void job.finally(() => { if (inspectionJobs.get(jobKey) === job)
            inspectionJobs.delete(jobKey); });
        return job;
    }
    function save(): Promise<boolean> {
        if (saving)
            return saving;
        if (!state?.recipe || state.phase !== 'ready')
            return Promise.resolve(false);
        const s = clone(state), ack = receipts[s.recipe!.theme]!, g = generation, input = s.recipe!.photoIds.map(id => sources.find(x => x.photoId === id)!), ids = [...expected];
        state = { ...state, phase: 'saving' };
        emit();
        const job = (async () => {
            let output: string | undefined;
            try {
                assertCurrent(await p.loadSession(s.sessionId), ids, input);
                if (!current(g))
                    return false;
                const id = p.id();
                const key = canonicalTemplateRecipe(s.recipe!);
                let r = fullReceipts.get(key);
                if (!r) {
                    requests.add(id);
                    r = await p.renderTemplate(input, key, false, id);
                    own(r.uri, input);
                }
                output = r.uri;
                if (!current(g))
                    return false;
                validate(r, s.recipe!, false);
                if (s.recipe!.photoIds.some(id => r.sourceHashes[id] !== ack.sourceHashes[id]))
                    throw new Error('template-source-mismatch');
                requests.delete(id);
                assertCurrent(await p.loadSession(s.sessionId), ids, input);
                if (!current(g))
                    return false;
                copying.add(r.uri);
                const updated = await p.saveComposite(s.sessionId, { id: p.id(), newRenderedURI: r.uri, recipe: s.recipe!, expectedSelectedPhotoIds: ids });
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
            }
        })();
        saving = job;
        void job.finally(() => {
            if (saving === job)
                saving = null;
        });
        return job;
    }
    function previewFailed(uri: string) {
        if (!state || state.phase === 'saving')
            return;
        const currentFull = state.recipe ? fullReceipts.get(canonicalTemplateRecipe(state.recipe)) : undefined;
        if (!Object.values(receipts).some(receipt => receipt?.uri === uri) && currentFull?.uri !== uri)
            return;
        fail(new Error('preview-load-failed'), generation);
    }
    return { open, chooseLayout, chooseTheme, swapPhotos, setCrop, save, close, previewFailed, retryInspection, setCrops, renderInspection };
}
