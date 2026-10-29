import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATE_LAYOUTS, createTemplateEditor, canonicalTemplateRecipe, type TemplateRenderResult, type TemplateEditorState, type TemplateSourceInspection, templateDimensions } from '../src/template-editor';
import type { ActiveSession, CompositeRecipe } from '../src/local-types';
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
function harness(fresh = false) {
    let session: ActiveSession = { id: 's', createdAt: 1, targetCount: 4, confirmed: false, shots: ['a', 'b', 'c', 'd'].map((id, shotIndex) => ({ id, shotIndex, sessionId: 's', fileUri: `file:///${id}.jpg`, createdAt: 1, confirmed: false })) };
    if (!fresh)
        session.composite = { id: 'legacy', fileUri: 'file:///legacy.jpg', originalPhotoIds: ['a', 'b', 'c', 'd'], recipe: { version: 'wedding-template-v1', layout: 'strip', theme: 'classic', photoIds: ['a', 'b', 'c', 'd'], cropsByPhotoId: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) } };
    const inspections: {
        sources: {
            photoId: string;
            uri: string;
        }[];
        d: ReturnType<typeof deferred<TemplateSourceInspection>>;
    }[] = [];
    let state: TemplateEditorState | null = null, serial = 0;
    const jobs: {
        sources: {
            photoId: string;
            uri: string;
        }[];
        recipe: CompositeRecipe;
        preview: boolean;
        d: ReturnType<typeof deferred<TemplateRenderResult>>;
    }[] = [], released: string[] = [], cancelled: string[] = [], saved: unknown[] = [], sessions: ActiveSession[] = [];
    let copy: ReturnType<typeof deferred<ActiveSession>> | undefined;
    const editor = createTemplateEditor({ inspectTemplateSources: sources => { const d = deferred<TemplateSourceInspection>(); inspections.push({ sources, d }); return d.promise; }, id: () => `id-${++serial}`, renderTemplate: (sources, json, preview) => { const d = deferred<TemplateRenderResult>(); jobs.push({ sources, recipe: JSON.parse(json) as CompositeRecipe, preview, d }); return d.promise; }, cancelTemplate: id => { cancelled.push(id); }, releaseTemplate: async (uri) => { released.push(uri); }, loadSession: async () => session, saveComposite: async (_id, input) => { saved.push(input); return copy ? copy.promise : session; }, onSession: s => { sessions.push(s); }, onState: s => { state = s; } });
    const result = (i: number, overrides: Partial<TemplateRenderResult> = {}): TemplateRenderResult => { const j = jobs[i]!, dim = templateDimensions(j.recipe); return { uri: `file:///cache-${i}.jpg`, width: j.preview ? dim[0]! / 3 : dim[0]!, height: j.preview ? dim[1]! / 3 : dim[1]!, preview: j.preview, version: j.recipe.version, recipeJSON: canonicalTemplateRecipe(j.recipe), sourceHashes: Object.fromEntries(j.recipe.photoIds.map(id => [id, 'a'.repeat(64)])), ...overrides }; };
    return { editor, inspections, jobs, released, cancelled, saved, sessions, result, get state() { return state; }, get session() { return session; }, set session(v: ActiveSession) { session = v; }, set copy(v: ReturnType<typeof deferred<ActiveSession>>) { copy = v; } };
}
for (const layout of ['strip', 'grid'] as const)
    for (const theme of ['classic', 'botanical', 'coastal'] as const)
        test(`${layout}/${theme} uses actual receipt and exact full geometry`, async () => {
            const h = harness();
            h.editor.open(h.session);
            if (layout === 'grid')
                h.editor.chooseLayout(layout);
            h.editor.chooseTheme(theme);
            assert.equal(await h.editor.save(), false);
            const i = h.jobs.findLastIndex(j => j.recipe.layout === layout && j.recipe.theme === theme);
            h.jobs[i]!.d.resolve(h.result(i));
            await tick();
            assert.equal(h.state?.phase, 'ready');
            assert.equal(h.state?.previewUri, `file:///cache-${i}.jpg`);
            const a = h.editor.save();
            await tick();
            const n = h.jobs.length - 1;
            h.jobs[n]!.d.resolve(h.result(n));
            assert.equal(await a, true);
            assert.equal(h.saved.length, 1);
            assert.equal(h.state, null);
        });
test('theme switching reuses current native receipts immediately', async () => {
    const h = harness();
    h.editor.open(h.session);
    for (let i = 0; i < 3; i++)
        h.jobs[i]!.d.resolve(h.result(i));
    await tick();
    h.editor.chooseTheme('coastal');
    assert.equal(h.state?.previewUri, 'file:///cache-2.jpg');
    h.editor.chooseTheme('classic');
    assert.equal(h.state?.previewUri, 'file:///cache-0.jpg');
    assert.equal(h.jobs.length, 3);
});
test('rapid layout/order/crop changes cancel stale previews, and crop travels by ID', async () => { const h = harness(); h.editor.open(h.session); h.editor.setCrop('a', { mode: 'fill', x: 0.5, y: -0.2, zoom: 1.25 }); h.editor.swapPhotos('a', 'd'); assert.deepEqual(h.state?.recipe?.photoIds, ['d', 'b', 'c', 'a']); assert.equal(h.state?.recipe?.cropsByPhotoId.a?.x, 0.5); h.editor.chooseLayout('grid'); h.jobs[0]!.d.resolve(h.result(0)); await tick(); assert.equal(h.state?.previewUri, null); assert.ok(h.released.includes('file:///cache-0.jpg')); assert.ok(h.cancelled.length >= 9); const n = h.jobs.length - 3; h.jobs[n]!.d.resolve(h.result(n)); await tick(); assert.equal(h.state?.phase, 'ready'); assert.deepEqual(h.jobs[n]!.sources.map(x => x.photoId), ['d', 'b', 'c', 'a']); h.editor.close(); assert.ok(h.released.every(uri => !h.session.shots.some(x => x.fileUri === uri))); });
for (const bad of ['version', 'recipe', 'hash', 'schema', 'uri', 'dimensions'] as const)
    test(`rejects mismatched full ${bad}`, async () => { const h = harness(); h.editor.open(h.session); h.jobs[0]!.d.resolve(h.result(0)); await tick(); const a = h.editor.save(); await tick(); const i = h.jobs.length - 1; const overrides: Partial<TemplateRenderResult> = bad === 'version' ? { version: 'wrong' } : bad === 'recipe' ? { recipeJSON: '{}' } : bad === 'hash' ? { sourceHashes: { a: 'b'.repeat(64), b: 'a'.repeat(64), c: 'a'.repeat(64), d: 'a'.repeat(64) } } : bad === 'schema' ? { sourceHashes: { a: 'a'.repeat(64) } } : bad === 'uri' ? { uri: 'https://example.com/out.jpg' } : { width: 1201 }; h.jobs[i]!.d.resolve(h.result(i, overrides)); assert.equal(await a, false); assert.equal(h.saved.length, 0); assert.equal(h.state?.previewUri, null); assert.equal(h.state?.phase, 'error'); h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.phase, 'error'); });
test('close pending full prevents save; close pending durable copy lets copy finish', async () => {
    for (const duringCopy of [false, true]) {
        const h = harness();
        h.editor.open(h.session);
        h.jobs[0]!.d.resolve(h.result(0));
        await tick();
        const d = deferred<ActiveSession>();
        if (duringCopy)
            h.copy = d;
        const a = h.editor.save();
        assert.equal(a, h.editor.save());
        await tick();
        const i = h.jobs.length - 1;
        if (duringCopy) {
            h.jobs[i]!.d.resolve(h.result(i));
            await tick();
        }
        h.editor.close();
        if (duringCopy) {
            assert.ok(!h.released.includes(`file:///cache-${i}.jpg`));
            d.resolve(h.session);
        }
        else
            h.jobs[i]!.d.resolve(h.result(i));
        assert.equal(await a, duringCopy);
        assert.equal(h.state, null);
        assert.equal(h.saved.length, duringCopy ? 1 : 0);
        assert.ok(h.released.includes(`file:///cache-${i}.jpg`));
    }
});
test('confirmed and duplicate selections reject opening; stale selection blocks save', async () => {
    for (const mode of ['confirmed', 'duplicate']) {
        const h = harness();
        h.session = mode === 'confirmed' ? { ...h.session, confirmed: true } : { ...h.session, shots: h.session.shots.map((x, i) => i === 3 ? { ...x, id: 'a' } : x) };
        h.editor.open(h.session);
        assert.equal(h.state, null);
        assert.equal(h.jobs.length, 0);
    }
    const h = harness();
    h.editor.open(h.session);
    h.jobs[0]!.d.resolve(h.result(0));
    await tick();
    h.session = { ...h.session, shots: h.session.shots.map((x, i) => i === 0 ? { ...x, id: 'retake' } : x) };
    assert.equal(await h.editor.save(), false);
    assert.equal(h.jobs.length, 3);
    assert.equal(h.saved.length, 0);
});
test('valid persisted recipe reopens with selected filtered sources untouched', () => { const h = harness(); const recipe: CompositeRecipe = { version: 'wedding-template-v1', layout: 'grid', theme: 'coastal', photoIds: ['d', 'b', 'a', 'c'], cropsByPhotoId: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) }; h.session = { ...h.session, shots: h.session.shots.map((x, i) => i === 0 ? { ...x, sourcePhotoId: 'original-a', look: { preset: 'warm', intensity: 0.5, version: 'wedding-ci-srgb-v1' } } : x), composite: { id: 'composite', fileUri: 'file:///persisted.jpg', recipe, originalPhotoIds: ['original-a', 'b', 'c', 'd'] } }; const before = JSON.stringify(h.session); h.editor.open(h.session); assert.deepEqual(h.state?.recipe, recipe); assert.equal(h.jobs[0]!.sources.find(x => x.photoId === 'a')?.uri, 'file:///a.jpg'); assert.equal(JSON.stringify(h.session), before); });
test('wrong preview theme/order/crop echo and aspect never become ready', async () => {
    for (const wrong of ['theme', 'order', 'crop', 'aspect']) {
        const h = harness();
        h.editor.open(h.session);
        const receipt = h.result(0), recipe = JSON.parse(receipt.recipeJSON) as CompositeRecipe;
        if (wrong === 'theme')
            recipe.theme = 'coastal';
        if (wrong === 'order')
            recipe.photoIds.reverse();
        if (wrong === 'crop')
            recipe.cropsByPhotoId.a = { mode: 'fill', x: 0.5, y: 0, zoom: 1 };
        h.jobs[0]!.d.resolve({ ...receipt, recipeJSON: canonicalTemplateRecipe(recipe), ...(wrong === 'aspect' ? { width: 1200, height: 100 } : {}) });
        await tick();
        assert.equal(h.state?.phase, 'error');
        assert.equal(h.state?.previewUri, null);
        assert.equal(await h.editor.save(), false);
    }
});
test('close before thumbnails resolve releases all late outputs without exposing them', async () => {
    const h = harness();
    h.editor.open(h.session);
    h.editor.close();
    for (let i = 0; i < 3; i++)
        h.jobs[i]!.d.resolve(h.result(i));
    await tick();
    assert.equal(h.state, null);
    assert.equal(h.released.length, 3);
    assert.equal(h.saved.length, 0);
});
test('image failure for current theme thumbnail invalidates receipts and same theme retries fresh output', async () => {
    const h = harness();
    h.editor.open(h.session);
    for (let i = 0; i < 3; i++)
        h.jobs[i]!.d.resolve(h.result(i));
    await tick();
    h.editor.chooseLayout('grid');
    h.jobs[3]!.d.resolve(h.result(3));
    h.jobs[4]!.d.resolve(h.result(4));
    await tick();
    h.editor.previewFailed('file:///cache-0.jpg');
    assert.equal(h.state?.phase, 'ready');
    h.editor.previewFailed('file:///cache-4.jpg');
    assert.equal(h.state?.phase, 'error');
    assert.equal(h.state?.previewUri, null);
    assert.deepEqual(h.state?.themePreviews, {});
    assert.ok(h.released.includes('file:///cache-3.jpg'));
    assert.ok(h.released.includes('file:///cache-4.jpg'));
    h.editor.chooseTheme('classic');
    assert.equal(h.jobs.length, 9);
    h.jobs[6]!.d.resolve(h.result(6));
    await tick();
    assert.equal(h.state?.previewUri, 'file:///cache-6.jpg');
    h.editor.previewFailed('file:///cache-4.jpg');
    assert.equal(h.state?.phase, 'ready');
    h.jobs[5]!.d.resolve(h.result(5));
    await tick();
    assert.equal(h.state?.previewUri, 'file:///cache-6.jpg');
    const a = h.editor.save();
    h.editor.previewFailed('file:///cache-6.jpg');
    assert.equal(h.state?.phase, 'saving');
    await tick();
    h.editor.close();
    h.editor.previewFailed('file:///cache-6.jpg');
    assert.equal(h.state, null);
    h.jobs[9]!.d.resolve(h.result(9));
    assert.equal(await a, false);
    assert.ok(h.released.every(uri => !h.session.shots.some(photo => photo.fileUri === uri)));
});
const inspection = (aspect: 'portrait' | 'square' = 'portrait'): TemplateSourceInspection => ({ version: 'wedding-template-v3', gridAspect: aspect, sources: ['a', 'b', 'c', 'd'].map(photoId => ({ photoId, width: 1200, height: aspect === 'portrait' ? 1600 : 1200, sha256: 'a'.repeat(64) })) });
for (const aspect of ['portrait', 'square'] as const)
    test(`new v3 ${aspect}-source recipe waits for inspection and saves exact square geometry`, async () => {
        const h = harness(true);
        h.editor.open(h.session);
        assert.equal(h.state?.phase, 'inspecting');
        assert.equal(h.state?.recipe === null, true);
        assert.equal(h.jobs.length, 0);
        assert.equal(await h.editor.save(), false);
        await tick();
        assert.equal(h.inspections.length, 1);
        h.inspections[0]!.d.resolve(inspection(aspect));
        await tick();
        assert.equal(h.jobs.length, 3);
        assert.equal(h.state?.recipe?.version, 'wedding-template-v3');
        assert.equal(h.state?.recipe && 'gridAspect' in h.state.recipe ? h.state.recipe.gridAspect : null, 'square');
        h.editor.chooseLayout('grid');
        h.editor.setCrops(Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fill' as const, x: 0, y: 0, zoom: 1 }])));
        h.editor.swapPhotos('a', 'd');
        const i = h.jobs.length - 3;
        h.jobs[i]!.d.resolve(h.result(i));
        await tick();
        const a = h.editor.save();
        await tick();
        const n = h.jobs.length - 1;
        assert.deepEqual(templateDimensions(h.jobs[n]!.recipe), [2400, 2400]);
        h.jobs[n]!.d.resolve(h.result(n));
        assert.equal(await a, true);
        assert.equal(h.saved.length, 1);
    });
test('inspection close and reopen ignore stale response; latest selection is inspected afresh', async () => {
    const h = harness(true);
    h.editor.open(h.session);
    await tick();
    h.editor.close();
    h.session = { ...h.session, shots: h.session.shots.map((x, i) => i === 0 ? { ...x, id: 'new', fileUri: 'file:///new.jpg' } : x) };
    h.editor.open(h.session);
    await tick();
    h.inspections[0]!.d.resolve(inspection());
    await tick();
    assert.equal(h.state?.phase, 'inspecting');
    assert.equal(h.jobs.length, 0);
    const latest = inspection();
    latest.sources[0] = { ...latest.sources[0]!, photoId: 'new' };
    h.inspections[1]!.d.resolve(latest);
    await tick();
    assert.equal(h.jobs.length, 3);
    assert.equal(h.jobs[0]!.sources[0]!.photoId, 'new');
    h.editor.close();
    assert.equal(h.released.length, 0);
});
for (const bad of ['order', 'size', 'hash', 'aspect', 'version'] as const)
    test(`bounded inspection rejects ${bad}, allows explicit retry`, async () => {
        const h = harness(true);
        h.editor.open(h.session);
        await tick();
        const r = inspection();
        if (bad === 'order')
            r.sources.reverse();
        if (bad === 'size')
            r.sources[0]!.width = 24001;
        if (bad === 'hash')
            r.sources[0]!.sha256 = 'bad';
        if (bad === 'aspect')
            r.gridAspect = 'square';
        if (bad === 'version')
            (r as {
                version: string;
            }).version = 'wrong';
        h.inspections[0]!.d.resolve(r);
        await tick();
        assert.equal(h.state?.phase, 'error');
        assert.equal(h.jobs.length, 0);
        h.editor.retryInspection();
        await tick();
        h.inspections[1]!.d.resolve(inspection());
        await tick();
        assert.equal(h.jobs.length, 3);
        h.editor.close();
    });
test('inspection native failure retries; stale selection after inspect prevents any preview', async () => {
    const h = harness(true);
    h.editor.open(h.session);
    await tick();
    h.inspections[0]!.d.reject(new Error('decode failed'));
    await tick();
    assert.equal(h.state?.phase, 'error');
    h.editor.retryInspection();
    await tick();
    h.session = { ...h.session, confirmed: true };
    h.inspections[1]!.d.resolve(inspection());
    await tick();
    assert.equal(h.state?.phase, 'error');
    assert.equal(h.jobs.length, 0);
});
test('v2 preview hashes must match inspected source hashes', async () => {
    const h = harness(true);
    h.editor.open(h.session);
    await tick();
    h.inspections[0]!.d.resolve(inspection());
    await tick();
    h.jobs[0]!.d.resolve(h.result(0, { sourceHashes: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, 'b'.repeat(64)])) }));
    await tick();
    assert.equal(h.state?.phase, 'error');
    assert.equal(await h.editor.save(), false);
});
test('late sibling preview does not unlock mutations while full save is pending', async () => {
    const h = harness();
    h.editor.open(h.session);
    h.jobs[0]!.d.resolve(h.result(0));
    await tick();
    const a = h.editor.save();
    await tick();
    h.jobs[1]!.d.resolve(h.result(1));
    await tick();
    assert.equal(h.state?.phase, 'saving');
    h.editor.chooseLayout('grid');
    assert.equal(h.state?.recipe?.layout, 'strip');
    h.jobs[3]!.d.resolve(h.result(3));
    assert.equal(await a, true);
});
test('inspection timeout is bounded and retry coalesces while inspecting', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(true);
    h.editor.open(h.session);
    await tick();
    h.editor.retryInspection();
    assert.equal(h.inspections.length, 1);
    t.mock.timers.tick(15000);
    await tick();
    assert.equal(h.state?.phase, 'error');
    assert.equal(h.state?.error, 'template-inspection-timeout');
    h.editor.retryInspection();
    h.editor.retryInspection();
    await tick();
    assert.equal(h.inspections.length, 2);
    h.editor.close();
    await tick();
    t.mock.timers.reset();
});
test('full-resolution inspection coalesces, owns cache, and Save reuses validated full output', async () => {
    const h = harness();
    h.editor.open(h.session);
    h.jobs[0]!.d.resolve(h.result(0));
    await tick();
    const a = h.editor.renderInspection(), b = h.editor.renderInspection();
    assert.equal(a, b);
    await tick();
    assert.equal(h.jobs.length, 4);
    h.jobs[3]!.d.resolve(h.result(3));
    const result = await a;
    assert.deepEqual(result, { uri: 'file:///cache-3.jpg', width: 1200, height: 3600 });
    assert.equal(h.saved.length, 0);
    assert.ok(!h.released.includes('file:///cache-3.jpg'));
    assert.equal(await h.editor.save(), true);
    assert.equal(h.jobs.length, 4);
    assert.equal(h.saved.length, 1);
    assert.ok(h.released.includes('file:///cache-3.jpg'));
    assert.ok(h.released.every(uri => !h.session.shots.some(x => x.fileUri === uri)));
});
test('full-resolution inspection releases cache on mutation and ignores late close/theme results', async () => {
    for (const action of ['close', 'theme', 'crop']) {
        const h = harness();
        h.editor.open(h.session);
        h.jobs[0]!.d.resolve(h.result(0));
        await tick();
        const a = h.editor.renderInspection();
        await tick();
        if (action === 'close')
            h.editor.close();
        if (action === 'theme')
            h.editor.chooseTheme('coastal');
        if (action === 'crop')
            h.editor.setCrop('a', { mode: 'fill', x: 0, y: 0, zoom: 1 });
        h.jobs[3]!.d.resolve(h.result(3));
        assert.equal(await a, null);
        assert.ok(h.released.includes('file:///cache-3.jpg'));
        assert.equal(h.saved.length, 0);
        if (action === 'close')
            assert.equal(h.state, null);
        else
            assert.notEqual(h.state?.phase, 'error');
    }
    const h = harness();
    h.editor.open(h.session);
    h.jobs[0]!.d.resolve(h.result(0));
    await tick();
    const a = h.editor.renderInspection();
    await tick();
    h.jobs[3]!.d.resolve(h.result(3));
    await a;
    h.editor.chooseLayout('grid');
    assert.ok(h.released.includes('file:///cache-3.jpg'));
});
test('full-resolution inspection rejects native failure or preview hash mismatch without disk writes', async () => {
    for (const nativeFailure of [true, false]) {
        const h = harness();
        h.editor.open(h.session);
        h.jobs[0]!.d.resolve(h.result(0));
        await tick();
        const a = h.editor.renderInspection();
        await tick();
        if (nativeFailure)
            h.jobs[3]!.d.reject(new Error('full failed'));
        else
            h.jobs[3]!.d.resolve(h.result(3, { sourceHashes: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, 'b'.repeat(64)])) }));
        assert.equal(await a, null);
        assert.equal(h.state?.phase, 'error');
        assert.equal(h.saved.length, 0);
        h.editor.chooseTheme('classic');
        assert.equal(h.jobs.length, 7);
        h.editor.close();
    }
});
test('failed full inspection image cannot be reused for save', async () => {
    const h = harness();
    h.editor.open(h.session);
    h.jobs[0]!.d.resolve(h.result(0));
    await tick();
    const a = h.editor.renderInspection();
    await tick();
    h.jobs[3]!.d.resolve(h.result(3));
    await a;
    h.editor.previewFailed('file:///cache-3.jpg');
    assert.equal(h.state?.phase, 'error');
    assert.equal(await h.editor.save(), false);
    assert.ok(h.released.includes('file:///cache-3.jpg'));
    h.editor.chooseTheme('classic');
    h.jobs[4]!.d.resolve(h.result(4));
    await tick();
    const b = h.editor.renderInspection();
    await tick();
    assert.equal(h.jobs.length, 8);
    h.jobs[7]!.d.resolve(h.result(7));
    assert.equal((await b)?.uri, 'file:///cache-7.jpg');
    h.editor.close();
});

for (const layout of ['strip', 'grid'] as const) test(`retake defaults preserve inherited ${layout}/theme with fresh IDs and new fill crops`, async () => {
    const h = harness(true);
    h.session = { ...h.session, retakeOfSessionId: 'previous-session', retakeState: 'open',
        templateDefaults: { layout, theme: 'coastal', gridAspect: 'square' } };
    h.editor.open(h.session);
    await tick();
    assert.equal(h.jobs.length, 0);
    h.inspections[0]!.d.resolve(inspection('portrait'));
    await tick();
    assert.equal(h.state?.recipe?.version, 'wedding-template-v3');
    assert.equal(h.state?.recipe?.layout, layout);
    assert.equal(h.state?.recipe?.theme, 'coastal');
    assert.equal(h.state?.recipe && 'gridAspect' in h.state.recipe ? h.state.recipe.gridAspect : null, 'square');
    assert.deepEqual(h.state?.recipe?.photoIds, ['a', 'b', 'c', 'd']);
    assert.deepEqual(h.state?.recipe?.cropsByPhotoId, Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fill', x: 0, y: -1, zoom: 1 }])));
    assert.deepEqual(templateDimensions(h.state!.recipe!), layout === 'grid' ? [2400, 2400] : [1200, 3600]);
    h.editor.close();
});

test('abandoned retake cannot open a template editor even when four images and saved recipe remain', () => {
    const h = harness();
    h.session = { ...h.session, retakeOfSessionId: 'parent', retakeState: 'abandoned' };
    h.editor.open(h.session);
    assert.equal(h.state, null);
    assert.equal(h.jobs.length, 0);
    assert.equal(h.inspections.length, 0);
});

for (const gridAspect of ['portrait', 'square'] as const) test(`persisted v2 ${gridAspect} recipe remains unchanged when reopening`, () => {
  const h = harness();
  const recipe: CompositeRecipe = { ...h.session.composite!.recipe, version: 'wedding-template-v2', gridAspect, layout: 'grid' };
  h.session = { ...h.session, composite: { ...h.session.composite!, recipe } };
  const before = JSON.stringify(h.session);
  h.editor.open(h.session);
  assert.deepEqual(h.state?.recipe, recipe);
  assert.equal(h.inspections.length, 0);
  assert.deepEqual(templateDimensions(h.state!.recipe!), gridAspect === 'portrait' ? [2400, 3000] : [2400, 2400]);
  assert.equal(JSON.stringify(h.session), before);
  h.editor.close();
});

for (const aspect of ['portrait', 'square'] as const) test(`fresh ${aspect} sources default to Social grid and top-aligned Full frame without changing originals`, async () => {
  const h = harness(true), before = JSON.stringify(h.session);
  h.editor.open(h.session);
  await tick();
  h.inspections[0]!.d.resolve(inspection(aspect));
  await tick();
  assert.equal(h.state?.recipe?.layout, 'grid');
  assert.equal(h.state?.recipe?.theme, 'classic');
  assert.deepEqual(h.state?.recipe?.cropsByPhotoId, Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fill', x: 0, y: -1, zoom: 1 }])));
  assert.equal(JSON.stringify(h.session), before);
  assert.ok(h.jobs.every(job => job.recipe.layout === 'grid'));
  h.editor.close();
});

test('layout selector presents Social grid before Photo strip', () => {
  assert.deepEqual(TEMPLATE_LAYOUTS, [{ id: 'grid', label: 'Social grid' }, { id: 'strip', label: 'Photo strip' }]);
  const source = readFileSync(new URL('../src/TemplateStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /TEMPLATE_LAYOUTS\.map\(\(\{ id: layout, label \}\)/);
  assert.match(source, /<Text[^>]*>\{label\}<\/Text>/);
});

for (const layout of ['strip', 'grid'] as const) test(`persisted v3 ${layout} with Full photo and custom crop reopens unchanged`, () => {
  const h = harness();
  const recipe: CompositeRecipe = { ...h.session.composite!.recipe, version: 'wedding-template-v3', gridAspect: 'square', layout };
  recipe.cropsByPhotoId.a = { mode: 'fill', x: 0.25, y: 0.5, zoom: 1.2 };
  h.session = { ...h.session, composite: { ...h.session.composite!, recipe } };
  const before = JSON.stringify(h.session);
  h.editor.open(h.session);
  assert.deepEqual(h.state?.recipe, recipe);
  assert.equal(h.inspections.length, 0);
  assert.equal(JSON.stringify(h.session), before);
  h.editor.close();
});
