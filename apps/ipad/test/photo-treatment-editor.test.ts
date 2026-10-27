import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoLookEditor, type PhotoLookEditorState, type PhotoTreatmentRenderResult, type PhotoLookEditorPorts } from '../src/photo-look-editor';
import type { ActiveCapture, ActiveSession, PhotoTreatment, FaceAccessory } from '../src/local-types';
import type { RenderedPhotoInput } from '../src/local-persistence';
import { canonicalPhotoTreatment, isOriginalTreatment, photoTreatmentForCapture } from '../src/photo-treatment';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const recipe = (preset: PhotoTreatment['look']['preset'] = 'original', intensity = preset === 'original' ? 0 : 1, accessory: FaceAccessory = 'none'): PhotoTreatment =>
  ({ version: 'wedding-photo-treatment-v1', order: 'look-then-face', look: { preset, intensity, version: 'wedding-ci-srgb-v1' }, face: { accessory, version: 'wedding-face-prototype-v3' } });
function baseSession(id = 'session'): ActiveSession {
  return { id, createdAt: 1, targetCount: 1, confirmed: false,
    shots: [{ id: id + '-original', fileUri: 'file:///' + id + '-original.jpg', createdAt: 1, confirmed: false, sessionId: id, shotIndex: 0 }] };
}
function harness(completePorts = true) {
  let current = baseSession(), state: PhotoLookEditorState | null = null, serial = 0;
  const store = new Map([[current.id, current]]);
  const jobs: { source: string; recipe: PhotoTreatment; id: string; d: ReturnType<typeof deferred<PhotoTreatmentRenderResult>> }[] = [];
  const released: string[] = [], cancelled: string[] = [], saved: RenderedPhotoInput[] = [], selected: string[] = [], sessions: ActiveSession[] = [];
  let copyGate: ReturnType<typeof deferred<void>> | undefined, afterCommitGate: ReturnType<typeof deferred<void>> | undefined;
  let saveError: Error | undefined, loseAck = false, active = 0, maxActive = 0, legacyRenders = 0;
  let onSessionHook: ((session: ActiveSession) => void) | undefined;
  const update = (value: ActiveSession) => { store.set(value.id, value); if (current.id === value.id) current = value; };
  const all = (value: ActiveSession) => [...value.shots, ...(value.retakes ?? [])];
  const replace = (value: ActiveSession, capture: ActiveCapture) => {
    const known = new Map(all(value).map(item => [item.id, item]));
    known.set(capture.id, capture);
    return { ...value, shots: [capture], retakes: [...known.values()].filter(item => item.id !== capture.id) };
  };
  const ports: PhotoLookEditorPorts = {
    id: () => 'request-' + ++serial,
    render: async () => { legacyRenders++; throw new Error('legacy render should not run in treatment mode'); },
    cancel() {}, release: async () => { throw new Error('legacy cache release must not run'); },
    renderTreatment: (source, json, id) => {
      const d = deferred<PhotoTreatmentRenderResult>(); jobs.push({ source, recipe: JSON.parse(json) as PhotoTreatment, id, d });
      active++; maxActive = Math.max(maxActive, active); return d.promise.finally(() => { active--; });
    },
    cancelTreatment: id => { cancelled.push(id); },
    releaseTreatment: async uri => { released.push(uri); },
    loadSession: async id => store.get(id) ?? null,
    saveRenderedPhoto: async (id, input) => {
      saved.push(input);
      if (copyGate) await copyGate.promise;
      if (input.admit && !input.admit()) throw new Error('stale-after-copy');
      if (saveError) throw saveError;
      const latest = store.get(id)!;
      if (latest.retakeState === 'abandoned' || latest.confirmed || latest.shots[0]?.id !== input.expectedSelectedPhotoId) throw new Error('stale-selection');
      if (!input.treatment) throw new Error('new path must persist a treatment');
      const rendered: ActiveCapture = { id: input.id, fileUri: 'file:///documents/' + input.id + '.jpg', createdAt: 2, confirmed: false,
        sourcePhotoId: input.sourcePhotoId, treatment: input.treatment, sessionId: id, shotIndex: input.slot, exportStatus: 'pending' };
      const updated = replace(latest, rendered); update(updated);
      if (afterCommitGate) await afterCommitGate.promise;
      if (loseAck) throw new Error('journal committed but acknowledgement lost');
      return updated;
    },
    selectSavedPhoto: async (id, photoId, slot, expected) => {
      const latest = store.get(id)!;
      if (latest.retakeState === 'abandoned' || latest.confirmed || latest.shots[0]?.id !== expected || slot !== 0) throw new Error('stale-selection');
      const prior = all(latest).find(capture => capture.id === photoId);
      if (!prior) throw new Error('missing-original');
      selected.push(photoId); const updated = replace(latest, prior); update(updated); return updated;
    },
    onState: value => { state = value; }, onSession: value => { sessions.push(value); onSessionHook?.(value); },
  };
  if (!completePorts) delete ports.releaseTreatment;
  const editor = createPhotoLookEditor(ports);
  const result = (index: number, override: Partial<PhotoTreatmentRenderResult> = {}): PhotoTreatmentRenderResult => {
    const job = jobs[index]!, effective = override.recipe ?? job.recipe, identity = isOriginalTreatment(effective), face = effective.face.accessory !== 'none';
    return { uri: identity ? job.source : 'file:///cache/' + job.id + '.jpg', width: 1200, height: 1600, recipe: effective,
      originalSha256: 'a'.repeat(64), outputSha256: (identity ? 'a' : 'b').repeat(64), isOriginal: identity,
      detectedFaceCount: face ? 2 : null, landmarkedFaceCount: face ? 2 : null, decoratedFaceCount: face ? 2 : 0,
      fallbackReason: 'none', ...override };
  };
  return { editor, jobs, released, cancelled, saved, selected, sessions, store, result,
    get session() { return current; }, set session(value: ActiveSession) { current = value; store.set(value.id, value); },
    get state() { return state; }, get maxActive() { return maxActive; }, get legacyRenders() { return legacyRenders; },
    set copyGate(value: ReturnType<typeof deferred<void>> | undefined) { copyGate = value; },
    set afterCommitGate(value: ReturnType<typeof deferred<void>> | undefined) { afterCommitGate = value; },
    set saveError(value: Error | undefined) { saveError = value; }, set loseAck(value: boolean) { loseAck = value; },
    set onSessionHook(value: ((session: ActiveSession) => void) | undefined) { onSessionHook = value; } };
}

test('full-resolution result is the preview and Apply copies exactly its URI/hash without rerendering', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.choose('warm', 0.6);
  assert.equal(h.jobs.length, 1); assert.equal(h.jobs[0]!.source, h.session.shots[0]!.fileUri);
  const ack = h.result(0); h.jobs[0]!.d.resolve(ack); await tick();
  assert.equal(h.state?.previewUri, ack.uri); assert.equal(h.state?.faceSupported, true);
  const a = h.editor.apply(), b = h.editor.apply(); assert.equal(a, b); assert.equal(await a, true);
  assert.equal(h.jobs.length, 1); assert.equal(h.legacyRenders, 0);
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0]!.newRenderedURI, ack.uri);
  assert.equal(h.saved[0]!.sourceSha256, ack.originalSha256); assert.equal(h.saved[0]!.outputSha256, ack.outputSha256);
  assert.equal(canonicalPhotoTreatment(h.saved[0]!.treatment!), canonicalPhotoTreatment(ack.recipe));
  assert.ok(h.released.includes(ack.uri)); assert.ok(!h.released.includes(h.jobs[0]!.source));
});

test('identity selection uses the root without render, duplicate selection or export write', async () => {
  const h = harness(); h.editor.open(h.session, 0);
  assert.equal(h.state?.faceAccessory, 'none'); assert.equal(h.state?.phase, 'ready');
  assert.equal(await h.editor.apply(), true);
  assert.equal(h.jobs.length, 0); assert.equal(h.saved.length, 0); assert.equal(h.selected.length, 0);
});

test('None removes only the face accessory while colour choice preserves the face', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick();
  h.editor.choose('warm', 0.5);
  assert.equal(h.jobs[1]!.recipe.face.accessory, 'glasses'); assert.equal(h.jobs[1]!.recipe.look.preset, 'warm');
  h.jobs[1]!.d.resolve(h.result(1)); await tick();
  h.editor.chooseFace('none');
  assert.deepEqual(h.jobs[2]!.recipe, recipe('warm', 0.5, 'none'));
  h.jobs[2]!.d.resolve(h.result(2)); await tick();
  assert.equal(h.state?.preset, 'warm'); assert.equal(h.state?.faceAccessory, 'none');
});

test('rapid look and face changes cancel once, wait for acknowledgement and skip intermediate renders', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.editor.chooseFace('crown'); h.editor.choose('film', 0.7); h.editor.chooseFace('hearts');
  assert.equal(h.jobs.length, 1); assert.deepEqual(h.cancelled, [h.jobs[0]!.id]);
  const stale = h.result(0); h.jobs[0]!.d.resolve(stale); await tick();
  assert.equal(h.jobs.length, 2); assert.deepEqual(h.jobs[1]!.recipe, recipe('film', 0.7, 'hearts'));
  assert.ok(h.released.includes(stale.uri)); assert.equal(h.maxActive, 1);
  h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.faceAccessory, 'hearts');
});

test('cancel rejection acknowledges completion before newest request starts', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses'); h.editor.chooseFace('crown');
  assert.equal(h.jobs.length, 1); h.jobs[0]!.d.reject(new Error('cancelled')); await tick();
  assert.equal(h.jobs.length, 2); assert.equal(h.jobs[1]!.recipe.face.accessory, 'crown');
  h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.phase, 'ready'); assert.equal(h.maxActive, 1);
});

test('close/background invalidates pending output and releases it without commits', async () => {
  const h = harness(); const original = h.session.shots[0]!.fileUri;
  h.editor.open(h.session, 0); h.editor.chooseFace('hearts'); h.editor.close();
  const output = h.result(0); h.jobs[0]!.d.resolve(output); await tick();
  assert.equal(h.state, null); assert.equal(h.saved.length, 0); assert.equal(h.sessions.length, 0);
  assert.ok(h.released.includes(output.uri)); assert.ok(!h.released.includes(original));
});

test('close and reopen a different guest cannot publish old callbacks or render from the old source', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  const other = baseSession('other'); h.session = other; h.editor.open(other, 0); h.editor.chooseFace('crown');
  assert.equal(h.jobs.length, 1);
  h.jobs[0]!.d.resolve(h.result(0)); await tick();
  assert.equal(h.jobs.length, 2); assert.equal(h.jobs[1]!.source, other.shots[0]!.fileUri);
  assert.equal(h.state?.sessionId, 'other'); assert.equal(h.sessions.length, 0);
  h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.faceAccessory, 'crown');
});

test('reopened committed treatment uses actual durable URI and unknown counts without render or duplicate Apply', async () => {
  const h = harness(), original = h.session.shots[0]!;
  const prior: ActiveCapture = { ...original, id: 'prior', fileUri: 'file:///documents/prior.jpg', sourcePhotoId: original.id,
    treatment: recipe('warm', 0.7, 'glasses'), exportStatus: 'saved' };
  h.session = { ...h.session, shots: [prior], retakes: [original] };
  h.editor.open(h.session, 0);
  assert.equal(h.jobs.length, 0); assert.equal(h.state?.previewUri, prior.fileUri);
  assert.equal(h.state?.decoratedFaceCount, null); assert.equal(h.state?.fallbackReason, null);
  assert.equal(await h.editor.apply(), true); assert.equal(h.saved.length, 0); assert.equal(h.selected.length, 0);
  assert.equal(h.session.shots[0]!.exportStatus, 'saved');
});

test('legacy committed look converts to face None and can be restored from its exact displayed variant', async () => {
  const h = harness(), original = h.session.shots[0]!;
  const old: ActiveCapture = { ...original, id: 'old-look', fileUri: 'file:///documents/old-look.jpg', sourcePhotoId: original.id,
    look: { preset: 'warm', intensity: 0.4, version: 'wedding-ci-srgb-v1' }, exportStatus: 'saved' };
  const face: ActiveCapture = { ...original, id: 'face-look', fileUri: 'file:///documents/face-look.jpg', sourcePhotoId: original.id, treatment: recipe('warm', 0.4, 'glasses') };
  h.session = { ...h.session, shots: [face], retakes: [original, old] };
  h.editor.open(h.session, 0); h.editor.chooseFace('none');
  assert.equal(h.jobs.length, 0); assert.equal(h.state?.previewUri, old.fileUri); assert.equal(h.state?.preset, 'warm');
  assert.equal(await h.editor.apply(), true); assert.deepEqual(h.selected, [old.id]); assert.equal(h.saved.length, 0);
  assert.equal(h.session.shots[0]!.exportStatus, 'saved');
});

test('fresh render never switches to a newly discovered same-recipe different-byte cached variant', async () => {
  const h = harness(), original = h.session.shots[0]!;
  h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  const preview = h.result(0); h.jobs[0]!.d.resolve(preview); await tick();
  const competing: ActiveCapture = { ...original, id: 'other-bytes', fileUri: 'file:///documents/other-bytes.jpg', sourcePhotoId: original.id, treatment: recipe('original', 0, 'glasses') };
  h.session = { ...h.session, retakes: [competing] };
  assert.equal(await h.editor.apply(), true);
  assert.equal(h.selected.length, 0); assert.equal(h.saved[0]!.newRenderedURI, preview.uri);
  assert.equal(h.saved[0]!.outputSha256, preview.outputSha256);
});

test('no-face fallback truthfully selects None and root original without a claimed derivative', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0, { recipe: recipe(), detectedFaceCount: 0, landmarkedFaceCount: 0, decoratedFaceCount: 0, fallbackReason: 'no-face' }));
  await tick(); assert.equal(h.state?.faceAccessory, 'none'); assert.equal(h.state?.fallbackReason, 'no-face');
  assert.equal(h.state?.previewUri, h.session.shots[0]!.fileUri);
  assert.equal(await h.editor.apply(), true); assert.equal(h.saved.length, 0); assert.equal(h.jobs.length, 1);
});

test('no-face fallback retains the chosen colour look and persists only the effective recipe', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.choose('warm', 0.8);
  h.jobs[0]!.d.resolve(h.result(0)); await tick(); h.editor.chooseFace('crown');
  const effective = recipe('warm', 0.8, 'none');
  h.jobs[1]!.d.resolve(h.result(1, { recipe: effective, detectedFaceCount: 0, landmarkedFaceCount: 0, decoratedFaceCount: 0, fallbackReason: 'no-face' }));
  await tick(); assert.equal(h.state?.preset, 'warm'); assert.equal(h.state?.faceAccessory, 'none');
  assert.equal(await h.editor.apply(), true); assert.deepEqual(h.saved[0]!.treatment, effective); assert.equal(h.jobs.length, 2);
});

test('partial face fallback reports actual counts without pretending all detected faces were decorated', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('hearts');
  h.jobs[0]!.d.resolve(h.result(0, { detectedFaceCount: 3, landmarkedFaceCount: 2, decoratedFaceCount: 1, fallbackReason: 'partial' }));
  await tick(); assert.equal(h.state?.faceAccessory, 'hearts'); assert.equal(h.state?.decoratedFaceCount, 1); assert.equal(h.state?.fallbackReason, 'partial');
});

test('native zero-strength normalization is accepted without changing the requested face accessory', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.choose('warm', 0.5);
  h.jobs[0]!.d.resolve(h.result(0)); await tick(); h.editor.chooseFace('glasses');
  h.jobs[1]!.d.resolve(h.result(1)); await tick(); h.editor.choose('warm', 0);
  assert.deepEqual(h.jobs[2]!.recipe, recipe('original', 0, 'glasses'));
  h.jobs[2]!.d.resolve(h.result(2, { recipe: recipe('original', 0, 'glasses') })); await tick();
  assert.equal(h.state?.phase, 'ready'); assert.equal(h.state?.faceAccessory, 'glasses');
  assert.deepEqual(h.state?.effectiveRecipe, recipe('original', 0, 'glasses'));
});

const invalid: [string, (h: ReturnType<typeof harness>) => Partial<PhotoTreatmentRenderResult>][] = [
  ['source hash', () => ({ originalSha256: 'bad' })], ['output hash', () => ({ outputSha256: 'bad' })],
  ['width', () => ({ width: 0 })], ['fractional height', () => ({ height: 0.5 })],
  ['foreign URI', () => ({ uri: 'https://invalid.example/image.jpg' })],
  ['wrong recipe look', () => ({ recipe: recipe('film', 1, 'glasses') })],
  ['wrong face', () => ({ recipe: recipe('original', 0, 'hearts') })],
  ['version', () => ({ recipe: { ...recipe('original', 0, 'glasses'), version: 'wrong' } as unknown as PhotoTreatment })],
  ['negative count', () => ({ detectedFaceCount: -1 })],
  ['impossible landmarks', () => ({ detectedFaceCount: 1, landmarkedFaceCount: 2 })],
  ['impossible decorated', () => ({ decoratedFaceCount: 3 })],
  ['false identity', () => ({ isOriginal: true })],
  ['unreported fallback', () => ({ recipe: recipe(), decoratedFaceCount: 0 })],
  ['false no-face', () => ({ recipe: recipe(), decoratedFaceCount: 0, fallbackReason: 'no-face', detectedFaceCount: 2 })],
];
for (const [name, bad] of invalid) test('invalid native ' + name + ' cannot become preview/commit', async () => {
  const h = harness(), original = h.session.shots[0]!.fileUri;
  h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0, bad(h))); await tick();
  assert.equal(h.state?.phase, 'error'); assert.equal(h.state?.previewUri, original);
  assert.equal(await h.editor.apply(), false); assert.equal(h.saved.length, 0); assert.equal(h.session.shots[0]!.fileUri, original);
  assert.ok(!h.released.includes(original));
});

test('changed root digest between otherwise valid choices is rejected', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick(); h.editor.chooseFace('crown');
  h.jobs[1]!.d.resolve(h.result(1, { originalSha256: 'c'.repeat(64) })); await tick();
  assert.equal(h.state?.error, 'treatment-source-changed'); assert.equal(h.saved.length, 0);
});

test('image failure is URI-scoped; retry uses fresh root render and releases failed cache bytes', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  const first = h.result(0); h.jobs[0]!.d.resolve(first); await tick();
  h.editor.previewFailed('file:///stale.jpg'); assert.equal(h.state?.phase, 'ready');
  h.editor.previewFailed(first.uri); assert.equal(h.state?.phase, 'error'); assert.ok(h.released.includes(first.uri));
  h.editor.chooseFace('glasses'); assert.equal(h.jobs.length, 2); assert.equal(h.jobs[1]!.source, h.session.shots[0]!.fileUri);
  h.jobs[1]!.d.resolve(h.result(1)); await tick(); assert.equal(h.state?.phase, 'ready');
});

test('native and persistence errors retain original and allow retry without leaking raw messages', async () => {
  const h = harness(); const original = h.session.shots[0]!;
  h.editor.open(h.session, 0); h.editor.chooseFace('glasses'); h.jobs[0]!.d.reject(new Error('synthetic-private-native-payload')); await tick();
  assert.equal(h.state?.error, 'treatment-render-failed');
  h.editor.chooseFace('glasses'); h.jobs[1]!.d.resolve(h.result(1)); await tick();
  h.saveError = new Error('synthetic-private-disk-payload'); assert.equal(await h.editor.apply(), false);
  assert.equal(h.session.shots[0]!.id, original.id); assert.equal(h.state?.error, 'treatment-save-failed');
  assert.ok(!JSON.stringify(h.state).includes('synthetic-private'));
  h.saveError = undefined; h.editor.chooseFace('glasses'); h.jobs[2]!.d.resolve(h.result(2)); await tick();
  assert.equal(await h.editor.apply(), true);
});

test('selection changes and abandoned child sessions never reach commit', async () => {
  for (const abandon of [false, true]) {
    const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses'); h.jobs[0]!.d.resolve(h.result(0)); await tick();
    h.session = abandon ? { ...h.session, retakeState: 'abandoned' } : { ...h.session, shots: [{ ...h.session.shots[0]!, id: 'new-retake', fileUri: 'file:///retake.jpg' }] };
    assert.equal(await h.editor.apply(), false); assert.equal(h.saved.length, 0); assert.equal(h.selected.length, 0); assert.equal(h.sessions.length, 0);
  }
});

test('derived chains, foreign roots and abandoned sessions cannot open', () => {
  const h = harness(), original = h.session.shots[0]!;
  const derived = { ...original, id: 'derived', sourcePhotoId: original.id, treatment: recipe('warm') };
  for (const session of [
    { ...h.session, retakeState: 'abandoned' as const },
    { ...h.session, shots: [{ ...original, sessionId: 'foreign' }] },
    { ...h.session, shots: [{ ...derived, sourcePhotoId: derived.id }], retakes: [original] },
    { ...h.session, shots: [{ ...original, id: 'metadata-missing', sourcePhotoId: original.id }], retakes: [original] },
    { ...h.session, shots: [{ ...original, id: 'invalid-legacy', sourcePhotoId: original.id,
      look: { preset: 'invalid', intensity: 1, version: 'wedding-ci-srgb-v1' } as unknown as ActiveCapture['look'] }], retakes: [original] },
  ]) { h.editor.open(session, 0); assert.equal(h.state, null); }
  assert.equal(h.jobs.length, 0);
});

test('close during durable copy makes admit false and never selects the staged child', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses'); const ack = h.result(0); h.jobs[0]!.d.resolve(ack); await tick();
  const gate = deferred<void>(); h.copyGate = gate; const apply = h.editor.apply(); await tick();
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0]!.admit?.(), true);
  h.editor.close(); assert.equal(h.saved[0]!.admit?.(), false); assert.ok(!h.released.includes(ack.uri));
  gate.resolve(); assert.equal(await apply, false); assert.equal(h.session.shots[0]!.sourcePhotoId, undefined);
  assert.ok(h.released.includes(ack.uri)); assert.equal(h.sessions.length, 0);
});

test('once durable commit is acknowledged, close/new guest suppresses old UI without falsely cancelling truth', async () => {
  const h = harness(); const oldId = h.session.id;
  h.editor.open(h.session, 0); h.editor.chooseFace('glasses'); const ack = h.result(0); h.jobs[0]!.d.resolve(ack); await tick();
  const gate = deferred<void>(); h.afterCommitGate = gate; const apply = h.editor.apply(); await tick();
  assert.ok(h.store.get(oldId)!.shots[0]!.treatment); assert.ok(!h.released.includes(ack.uri));
  const other = baseSession('next'); h.session = other; h.editor.open(other, 0);
  assert.equal(await h.editor.apply(), false, 'new guest cannot inherit the previous apply Promise');
  gate.resolve(); assert.equal(await apply, true);
  assert.equal(h.state?.sessionId, 'next'); assert.equal(h.sessions.length, 0); assert.ok(h.released.includes(ack.uri));
});

test('lost acknowledgement is reconciled from durable selection rather than reported as cancellation', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick(); h.loseAck = true;
  assert.equal(await h.editor.apply(), true); assert.ok(h.session.shots[0]!.treatment); assert.equal(h.sessions.length, 1);
});

test('incomplete new native ports keep legacy behaviour and never enable face controls', () => {
  const h = harness(false); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  assert.equal(h.state?.faceSupported, false); assert.equal(h.state?.faceAccessory, 'none'); assert.equal(h.jobs.length, 0);
});

test('saving ignores further controls without invalidating the admitted copy', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick();
  const gate = deferred<void>(); h.copyGate = gate;
  const apply = h.editor.apply(); await tick();
  h.editor.choose('warm', Number.NaN); h.editor.chooseFace('invalid' as FaceAccessory);
  h.editor.choose('film', 0.5); h.editor.chooseFace('crown');
  assert.equal(h.state?.phase, 'saving'); assert.equal(h.saved[0]!.admit?.(), true);
  assert.equal(h.jobs.length, 1); gate.resolve(); assert.equal(await apply, true);
});

test('mutating the original URI after preview cannot redirect its treatment commit', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick();
  h.session.shots[0]!.fileUri = 'file:///changed-original.jpg';
  assert.equal(await h.editor.apply(), false); assert.equal(h.saved.length, 0);
  assert.equal(h.state?.error, 'render-source');
});

test('onSession navigation cannot make an old completion close the new guest editor', async () => {
  const h = harness(); h.editor.open(h.session, 0); h.editor.chooseFace('glasses');
  h.jobs[0]!.d.resolve(h.result(0)); await tick();
  h.onSessionHook = () => {
    const next = baseSession('callback-next'); h.session = next; h.editor.open(next, 0);
  };
  assert.equal(await h.editor.apply(), true);
  assert.equal(h.state?.sessionId, 'callback-next'); assert.equal(h.state?.phase, 'ready');
});
