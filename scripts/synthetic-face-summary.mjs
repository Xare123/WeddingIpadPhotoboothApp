/** Public CI diagnostics for one explicitly pinned, fictional image only.
 * These records never change the native acceptance result.
 */
export const SYNTHETIC_FACE_SCOPE = 'TEST_ONLY_SHA_PINNED_GENERATED_FIXTURE_NOT_GUEST_DATA';
export const SYNTHETIC_FACE_SHA = 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165';
export const SYNTHETIC_VARIANTS = Object.freeze([
  'raw-png', 'root-jpeg-original-pixels', 'root-jpeg-warm-0.4-pixels', 'root-jpeg-bw-1-pixels',
]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition) { if (!condition) throw new Error('Synthetic diagnostic schema rejected'); }
function keys(value, expected) {
  requireValue(object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
}
function number(value, minimum, maximum) { requireValue(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum); return value; }
function integer(value, minimum, maximum) { requireValue(Number.isSafeInteger(value)); return number(value, minimum, maximum); }
function tuple(value, length, minimum, maximum) {
  requireValue(Array.isArray(value) && value.length === length); return value.map(item => number(item, minimum, maximum));
}
function eyes(value) {
  if (value === null) return null;
  if (Array.isArray(value) && value.length === 2 && value.every(point => point === null)) return null;
  requireValue(Array.isArray(value) && value.length === 2); return value.map(point => tuple(point, 2, -4, 4));
}
function counts(value) { keys(value, ['g', 'c', 'h']); return Object.fromEntries(['g', 'c', 'h'].map(key => [key, integer(value[key], 0, 6)])); }
function nullableNumber(value, maximum) { return value === null ? null : number(value, 0, maximum); }
function parse(value) { try { return JSON.parse(value); } catch { throw new Error('Synthetic diagnostic schema rejected'); } }
function header(value) { requireValue(value.scope === SYNTHETIC_FACE_SCOPE && value.fixtureSHA === SYNTHETIC_FACE_SHA); }
export function validatePlacementSummary(value) {
  keys(value, ['scope', 'fixtureSHA', 'variants']); header(value);
  requireValue(Array.isArray(value.variants) && value.variants.length === SYNTHETIC_VARIANTS.length);
  const variants = value.variants.map((variant, index) => {
    keys(variant, ['name', 'w', 'h', 'detected', 'landmarked', 'faces', 'individual', 'full', 'confidence1', 'canonicalFull', 'handlerReleased']);
    requireValue(variant.name === SYNTHETIC_VARIANTS[index]);
    requireValue(typeof variant.handlerReleased === 'boolean');
    const detected = integer(variant.detected, 0, 8), landmarked = integer(variant.landmarked, 0, detected);
    requireValue(Array.isArray(variant.faces) && variant.faces.length === detected);
    const seen = new Set();
    const faces = variant.faces.map(face => {
      keys(face, ['i', 'b', 'e', 'c', 'admissionBits', 'appleE', 'appleDeltaMax', 'directDeltaMax', 'landmarkConfidence', 'normalizedRepeatDelta']);
      const i = integer(face.i, 0, 7); requireValue(!seen.has(i)); seen.add(i);
      return { i, b: tuple(face.b, 4, -0.01, 1.01), e: eyes(face.e), c: number(face.c, 0, 1),
        admissionBits: integer(face.admissionBits, 0, 63), appleE: eyes(face.appleE),
        appleDeltaMax: nullableNumber(face.appleDeltaMax, 8), directDeltaMax: nullableNumber(face.directDeltaMax, 8),
        landmarkConfidence: nullableNumber(face.landmarkConfidence, 1), normalizedRepeatDelta: nullableNumber(face.normalizedRepeatDelta, 8) };
    });
    requireValue(Array.isArray(variant.individual) && variant.individual.length === detected);
    return { name: variant.name, w: integer(variant.w, 1, 24000), h: integer(variant.h, 1, 24000), detected, landmarked,
      faces, individual: variant.individual.map(counts), full: counts(variant.full), confidence1: counts(variant.confidence1),
      canonicalFull: counts(variant.canonicalFull), handlerReleased: variant.handlerReleased };
  });
  return { scope: SYNTHETIC_FACE_SCOPE, fixtureSHA: SYNTHETIC_FACE_SHA, variants };
}

/** Extract only fixed marker payloads; arbitrary compiler/guest text is never returned. */
export function readSyntheticFaceSummaries(log) {
  requireValue(typeof log === 'string');
  const marker = 'SYNTHETIC_FACE_PLACEMENT_SUMMARY ';
  const found = log.split('\n').filter(line => line.includes(marker));
  if (!found.length) return null;
  requireValue(found.length === 1);
  const payload = found[0].slice(found[0].indexOf(marker) + marker.length).trim();
  requireValue(payload.length > 0 && payload.length <= 8000);
  return validatePlacementSummary(parse(payload));
}

function outputCounts(value) {
  keys(value, ['detected', 'landmarked', 'decorated']);
  return { detected: integer(value.detected, -1, 64), landmarked: integer(value.landmarked, -1, 64), decorated: integer(value.decorated, 0, 6) };
}
export function validateOrderSummary(value) {
  keys(value, ['scope', 'fixtureSHA', 'legacyLookByteEqual', 'treatment', 'reference', 'referenceStatus', 'referenceFailure', 'referenceJpegPresent', 'goldPixelCount']); header(value);
  requireValue(typeof value.legacyLookByteEqual === 'boolean' && typeof value.referenceJpegPresent === 'boolean');
  requireValue(['success', 'failure', 'absent'].includes(value.referenceStatus));
  requireValue(['none', 'busy', 'cancelled', 'invalidImage', 'unsupportedRevision', 'detectionFailed', 'encodingFailed', 'requiresBackground'].includes(value.referenceFailure));
  requireValue((value.referenceStatus === 'success') === (value.reference !== null));
  requireValue(value.referenceStatus === 'failure' ? value.referenceFailure !== 'none' : value.referenceFailure === 'none');
  requireValue(value.referenceStatus === 'success' || value.referenceJpegPresent === false);
  return { scope: SYNTHETIC_FACE_SCOPE, fixtureSHA: SYNTHETIC_FACE_SHA, legacyLookByteEqual: value.legacyLookByteEqual,
    treatment: outputCounts(value.treatment), reference: value.reference === null ? null : outputCounts(value.reference),
    referenceStatus: value.referenceStatus, referenceFailure: value.referenceFailure, referenceJpegPresent: value.referenceJpegPresent,
    goldPixelCount: integer(value.goldPixelCount, 0, 24_000_000) };
}
export function readSyntheticOrderSummary(log) {
  requireValue(typeof log === 'string');
  const marker = 'SYNTHETIC_FACE_ORDER_SUMMARY ';
  const found = log.split('\n').filter(line => line.includes(marker));
  if (!found.length) return null;
  requireValue(found.length === 1);
  const payload = found[0].slice(found[0].indexOf(marker) + marker.length).trim();
  requireValue(payload.length > 0 && payload.length <= 1500);
  return validateOrderSummary(parse(payload));
}
