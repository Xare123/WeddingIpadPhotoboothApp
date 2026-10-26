import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateEditor, canonicalTemplateRecipe, type TemplateRenderResult, type TemplateEditorState } from '../src/template-editor';
import type { ActiveSession, CompositeRecipe } from '../src/local-types';
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
function harness() {
    let session: ActiveSession = { id: 's', createdAt: 1, targetCount: 4, confirmed: false, shots: ['a', 'b', 'c', 'd'].map((id, shotIndex) => ({ id, shotIndex, sessionId: 's', fileUri: `file:///${id}.jpg`, createdAt: 1, confirmed: false })) };
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
    const editor = createTemplateEditor({ id: () => `id-${++serial}`, renderTemplate: (sources, json, preview) => { const d = deferred<TemplateRenderResult>(); jobs.push({ sources, recipe: JSON.parse(json) as CompositeRecipe, preview, d }); return d.promise; }, cancelTemplate: id => { cancelled.push(id); }, releaseTemplate: async (uri) => { released.push(uri); }, loadSession: async () => session, saveComposite: async (_id, input) => { saved.push(input); return copy ? copy.promise : session; }, onSession: s => { sessions.push(s); }, onState: s => { state = s; } });
    const result = (i: number, overrides: Partial<TemplateRenderResult> = {}): TemplateRenderResult => { const j = jobs[i]!, dim = j.recipe.layout === 'strip' ? [1200, 3600] : [2400, 2100]; return { uri: `file:///cache-${i}.jpg`, width: j.preview ? dim[0]! / 3 : dim[0]!, height: j.preview ? dim[1]! / 3 : dim[1]!, preview: j.preview, version: 'wedding-template-v1', recipeJSON: canonicalTemplateRecipe(j.recipe), sourceHashes: Object.fromEntries(j.recipe.photoIds.map(id => [id, 'a'.repeat(64)])), ...overrides }; };
    return { editor, jobs, released, cancelled, saved, sessions, result, get state() { return state; }, get session() { return session; }, set session(v: ActiveSession) { session = v; }, set copy(v: ReturnType<typeof deferred<ActiveSession>>) { copy = v; } };
}
for (const layout of ['strip', 'grid'] as const)
    for (const theme of ['classic', 'botanical', 'coastal'] as const)
        test(`${layout}/${theme} uses actual receipt and exact full geometry`, async () => { const h = harness(); h.editor.open(h.session); if (layout === 'grid')
            h.editor.chooseLayout(layout); h.editor.chooseTheme(theme); assert.equal(await h.editor.save(), false); const i = h.jobs.findLastIndex(j => j.recipe.layout === layout && j.recipe.theme === theme); h.jobs[i]!.d.resolve(h.result(i)); await tick(); assert.equal(h.state?.phase, 'ready'); assert.equal(h.state?.previewUri, `file:///cache-${i}.jpg`); const a = h.editor.save(); await tick(); const n = h.jobs.length - 1; h.jobs[n]!.d.resolve(h.result(n)); assert.equal(await a, true); assert.equal(h.saved.length, 1); assert.equal(h.state, null); });
test('theme switching reuses current native receipts immediately', async () => { const h = harness(); h.editor.open(h.session); for (let i = 0; i < 3; i++)
    h.jobs[i]!.d.resolve(h.result(i)); await tick(); h.editor.chooseTheme('coastal'); assert.equal(h.state?.previewUri, 'file:///cache-2.jpg'); h.editor.chooseTheme('classic'); assert.equal(h.state?.previewUri, 'file:///cache-0.jpg'); assert.equal(h.jobs.length, 3); });
test('rapid layout/order/crop changes cancel stale previews, and crop travels by ID', async () => { const h = harness(); h.editor.open(h.session); h.editor.setCrop('a', { mode: 'fill', x: 0.5, y: -0.2, zoom: 1.25 }); h.editor.swapPhotos('a', 'd'); assert.deepEqual(h.state?.recipe.photoIds, ['d', 'b', 'c', 'a']); assert.equal(h.state?.recipe.cropsByPhotoId.a?.x, 0.5); h.editor.chooseLayout('grid'); h.jobs[0]!.d.resolve(h.result(0)); await tick(); assert.equal(h.state?.previewUri, null); assert.ok(h.released.includes('file:///cache-0.jpg')); assert.ok(h.cancelled.length >= 9); const n = h.jobs.length - 3; h.jobs[n]!.d.resolve(h.result(n)); await tick(); assert.equal(h.state?.phase, 'ready'); assert.deepEqual(h.jobs[n]!.sources.map(x => x.photoId), ['d', 'b', 'c', 'a']); h.editor.close(); assert.ok(h.released.every(uri => !h.session.shots.some(x => x.fileUri === uri))); });
for (const bad of ['version', 'recipe', 'hash', 'schema', 'uri', 'dimensions'] as const)
    test(`rejects mismatched full ${bad}`, async () => { const h = harness(); h.editor.open(h.session); h.jobs[0]!.d.resolve(h.result(0)); await tick(); const a = h.editor.save(); await tick(); const i = h.jobs.length - 1; const overrides: Partial<TemplateRenderResult> = bad === 'version' ? { version: 'wrong' } : bad === 'recipe' ? { recipeJSON: '{}' } : bad === 'hash' ? { sourceHashes: { a: 'b'.repeat(64), b: 'a'.repeat(64), c: 'a'.repeat(64), d: 'a'.repeat(64) } } : bad === 'schema' ? { sourceHashes: { a: 'a'.repeat(64) } } : bad === 'uri' ? { uri: 'https://example.com/out.jpg' } : { width: 1201 }; h.jobs[i]!.d.resolve(h.result(i, overrides)); assert.equal(await a, false); assert.equal(h.saved.length, 0); assert.equal(h.state?.previewUri, null); assert.equal(h.state?.phase, 'error'); h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.phase, 'error'); });
test('close pending full prevents save; close pending durable copy lets copy finish', async () => { for (const duringCopy of [false, true]) {
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
} });
test('confirmed and duplicate selections reject opening; stale selection blocks save', async () => { for (const mode of ['confirmed', 'duplicate']) {
    const h = harness();
    h.session = mode === 'confirmed' ? { ...h.session, confirmed: true } : { ...h.session, shots: h.session.shots.map((x, i) => i === 3 ? { ...x, id: 'a' } : x) };
    h.editor.open(h.session);
    assert.equal(h.state, null);
    assert.equal(h.jobs.length, 0);
} const h = harness(); h.editor.open(h.session); h.jobs[0]!.d.resolve(h.result(0)); await tick(); h.session = { ...h.session, shots: h.session.shots.map((x, i) => i === 0 ? { ...x, id: 'retake' } : x) }; assert.equal(await h.editor.save(), false); assert.equal(h.jobs.length, 3); assert.equal(h.saved.length, 0); });
test('valid persisted recipe reopens with selected filtered sources untouched', () => { const h = harness(); const recipe: CompositeRecipe = { version: 'wedding-template-v1', layout: 'grid', theme: 'coastal', photoIds: ['d', 'b', 'a', 'c'], cropsByPhotoId: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) }; h.session = { ...h.session, shots: h.session.shots.map((x, i) => i === 0 ? { ...x, sourcePhotoId: 'original-a', look: { preset: 'warm', intensity: 0.5, version: 'wedding-ci-srgb-v1' } } : x), composite: { id: 'composite', fileUri: 'file:///persisted.jpg', recipe, originalPhotoIds: ['original-a', 'b', 'c', 'd'] } }; const before = JSON.stringify(h.session); h.editor.open(h.session); assert.deepEqual(h.state?.recipe, recipe); assert.equal(h.jobs[0]!.sources.find(x => x.photoId === 'a')?.uri, 'file:///a.jpg'); assert.equal(JSON.stringify(h.session), before); });
test('wrong preview theme/order/crop echo and aspect never become ready', async () => {
 for (const wrong of ['theme','order','crop','aspect']) {
  const h=harness();h.editor.open(h.session);const receipt=h.result(0), recipe=JSON.parse(receipt.recipeJSON) as CompositeRecipe;
  if(wrong==='theme')recipe.theme='coastal';if(wrong==='order')recipe.photoIds.reverse();if(wrong==='crop')recipe.cropsByPhotoId.a={mode:'fill',x:0.5,y:0,zoom:1};
  h.jobs[0]!.d.resolve({...receipt,recipeJSON:canonicalTemplateRecipe(recipe),...(wrong==='aspect'?{width:1200,height:100}:{})});await tick();assert.equal(h.state?.phase,'error');assert.equal(h.state?.previewUri,null);assert.equal(await h.editor.save(),false);
 }
});
test('close before thumbnails resolve releases all late outputs without exposing them',async()=>{
 const h=harness();h.editor.open(h.session);h.editor.close();for(let i=0;i<3;i++)h.jobs[i]!.d.resolve(h.result(i));await tick();assert.equal(h.state,null);assert.equal(h.released.length,3);assert.equal(h.saved.length,0);
});
test('image failure for current theme thumbnail invalidates receipts and same theme retries fresh output',async()=>{
 const h=harness();h.editor.open(h.session);for(let i=0;i<3;i++)h.jobs[i]!.d.resolve(h.result(i));await tick();h.editor.chooseLayout('grid');h.jobs[3]!.d.resolve(h.result(3));h.jobs[4]!.d.resolve(h.result(4));await tick();h.editor.previewFailed('file:///cache-0.jpg');assert.equal(h.state?.phase,'ready');h.editor.previewFailed('file:///cache-4.jpg');assert.equal(h.state?.phase,'error');assert.equal(h.state?.previewUri,null);assert.deepEqual(h.state?.themePreviews,{});assert.ok(h.released.includes('file:///cache-3.jpg'));assert.ok(h.released.includes('file:///cache-4.jpg'));h.editor.chooseTheme('classic');assert.equal(h.jobs.length,9);h.jobs[6]!.d.resolve(h.result(6));await tick();assert.equal(h.state?.previewUri,'file:///cache-6.jpg');h.editor.previewFailed('file:///cache-4.jpg');assert.equal(h.state?.phase,'ready');h.jobs[5]!.d.resolve(h.result(5));await tick();assert.equal(h.state?.previewUri,'file:///cache-6.jpg');
 const a=h.editor.save();h.editor.previewFailed('file:///cache-6.jpg');assert.equal(h.state?.phase,'saving');await tick();h.editor.close();h.editor.previewFailed('file:///cache-6.jpg');assert.equal(h.state,null);h.jobs[9]!.d.resolve(h.result(9));assert.equal(await a,false);assert.ok(h.released.every(uri=>!h.session.shots.some(photo=>photo.fileUri===uri)));
});
