import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNTHETIC_FACE_SCOPE, SYNTHETIC_FACE_SHA, SYNTHETIC_VARIANTS, readSyntheticFaceSummaries, validatePlacementSummary, readSyntheticOrderSummary, validateOrderSummary } from './synthetic-face-summary.mjs';

// Parser fixtures only; these do not represent a Vision execution.
function fixture() {
  return { scope: SYNTHETIC_FACE_SCOPE, fixtureSHA: SYNTHETIC_FACE_SHA,
    variants: SYNTHETIC_VARIANTS.map(name => ({ name, w: 1122, h: 1402, detected: 1, landmarked: 1,
      faces: [{ i: 0, b: [0.2, 0.2, 0.3, 0.4], e: [[0.3, 0.4], [0.4, 0.4]], c: 0.9, admissionBits: 63,
        appleE: [[0.3, 0.4], [0.4, 0.4]], appleDeltaMax: 0, directDeltaMax: 0.2, landmarkConfidence: 1, normalizedRepeatDelta: 0 }],
      individual: [{ g: 1, c: 1, h: 1 }], full: { g: 1, c: 1, h: 1 }, confidence1: { g: 1, c: 1, h: 1 },
      canonicalFull: { g: 1, c: 1, h: 1 }, handlerReleased: true })) };
}
test('only exact fictional-fixture markers expose bounded numeric comparison results', () => {
  const value = fixture();
  assert.deepEqual(readSyntheticFaceSummaries('Compiler noise\nSYNTHETIC_FACE_PLACEMENT_SUMMARY ' + JSON.stringify(value) + '\n'), value);
  assert.equal(readSyntheticFaceSummaries('SYNTHETIC_FACE_PLACEMENT_JSON_CHUNK 1/2 ignored\nsecret from unrelated input'), null);
});
test('scope, fixture, variants and arbitrary extra fields cannot publish other image data', () => {
  for (const change of [v => { v.scope = 'guest'; }, v => { v.fixtureSHA = 'a'.repeat(64); },
    v => { v.phone = '+15555550123'; }, v => { v.variants[0].name = 'private-secret'; },
    v => { v.variants.reverse(); }, v => { v.variants[0].faces[0].token = 'private-secret'; }]) {
    const value = fixture(); change(value);
    assert.throws(() => validatePlacementSummary(value), error => !error.message.includes('private-secret') && error.message === 'Synthetic diagnostic schema rejected');
  }
});
test('invalid numeric values, excessive faces and inconsistent counts are rejected', () => {
  for (const change of [v => { v.variants[0].full.g = 7; }, v => { v.variants[0].detected = 9; },
    v => { v.variants[0].faces[0].c = NaN; }, v => { v.variants[0].faces[0].appleDeltaMax = Infinity; },
    v => { v.variants[0].faces[0].e[0][0] = 5; }, v => { v.variants[0].faces[0].admissionBits = 64; },
    v => { v.variants[0].faces.push(v.variants[0].faces[0]); }, v => { v.variants[0].individual = []; },
    v => { v.variants[0].faces[0].normalizedRepeatDelta = Infinity; }, v => { v.variants[0].faces[0].landmarkConfidence = 2; }]) {
    const value = fixture(); change(value); assert.throws(() => validatePlacementSummary(value));
  }
});
test('unknown landmark positions remain unknown instead of becoming zero-coordinate success', () => {
  const value = fixture(), stage = value.variants[0];
  stage.landmarked = 0; stage.individual = [{ g: 0, c: 0, h: 0 }];
  Object.assign(stage.faces[0], { e: null, appleE: null, appleDeltaMax: null, directDeltaMax: null, admissionBits: 0 });
  assert.deepEqual(validatePlacementSummary(value).variants[0].faces[0], stage.faces[0]);
});

test('order summary distinguishes worker failure, absent result and successful no-placement fallback', () => {
  const value = { scope: SYNTHETIC_FACE_SCOPE, fixtureSHA: SYNTHETIC_FACE_SHA, legacyLookByteEqual: true,
    treatment: { detected: 2, landmarked: 2, decorated: 0 }, reference: { detected: 2, landmarked: 2, decorated: 0 },
    referenceStatus: 'success', referenceFailure: 'none', referenceJpegPresent: false, goldPixelCount: 0 };
  assert.deepEqual(readSyntheticOrderSummary('SYNTHETIC_FACE_ORDER_SUMMARY ' + JSON.stringify(value)), value);
  assert.equal(readSyntheticOrderSummary('no marker'), null);
  for (const status of ['failure', 'absent']) {
    const next = { ...value, reference: null, referenceStatus: status, referenceFailure: status === 'failure' ? 'detectionFailed' : 'none' };
    assert.deepEqual(validateOrderSummary(next), next);
  }
  assert.throws(() => validateOrderSummary({ ...value, referenceStatus: 'failure' }));
  assert.throws(() => validateOrderSummary({ ...value, referenceStatus: 'failure', reference: null, referenceFailure: 'private error path' }));
  assert.throws(() => validateOrderSummary({ ...value, phone: '+15555550123' }));
});
test('duplicate and oversized marker records are refused without echoing their payload', () => {
  const marker = 'SYNTHETIC_FACE_PLACEMENT_SUMMARY ' + JSON.stringify(fixture());
  assert.throws(() => readSyntheticFaceSummaries(marker + '\n' + marker));
  assert.throws(() => readSyntheticFaceSummaries('SYNTHETIC_FACE_PLACEMENT_SUMMARY ' + 'x'.repeat(8001)), /schema rejected/);
  assert.throws(() => readSyntheticFaceSummaries('SYNTHETIC_FACE_PLACEMENT_SUMMARY {private-secret-not-json'),
    error => error.message === 'Synthetic diagnostic schema rejected');
});
