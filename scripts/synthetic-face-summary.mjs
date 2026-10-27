/** Public CI diagnostics for one explicitly pinned, fictional image only.
 * These records never change the native acceptance result.
 */
export const SYNTHETIC_FACE_SCOPE = 'TEST_ONLY_SHA_PINNED_GENERATED_FIXTURE_NOT_GUEST_DATA';
export const SYNTHETIC_FACE_SHA = 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165';
export const SYNTHETIC_VARIANTS = Object.freeze([
  'warm-cpu-ci', 'warm-default-ci', 'warm-cpu-copy', 'warm-default-copy',
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
    keys(variant, ['name', 'w', 'h', 'detected', 'landmarked', 'faces', 'individual', 'full', 'confidence1', 'canonicalFull', 'handlerReleased',
      'cpuOnly', 'materialized', 'pixelSha256', 'representation', 'status', 'error']);
    requireValue(variant.name === SYNTHETIC_VARIANTS[index]);
    requireValue(typeof variant.handlerReleased === 'boolean' && typeof variant.cpuOnly === 'boolean' && typeof variant.materialized === 'boolean');
    requireValue(variant.materialized === (index >= 2));
    requireValue(index % 2 !== 0 || variant.cpuOnly === true);
    requireValue(typeof variant.pixelSha256 === 'string' && /^[a-f0-9]{12}$/.test(variant.pixelSha256));
    keys(variant.representation, ['bpc', 'bpp', 'rowBytes', 'bitmapInfo', 'isSRGB']);
    requireValue(typeof variant.representation.isSRGB === 'boolean');
    const metadata = { name: variant.name, w: integer(variant.w, 1, 24000), h: integer(variant.h, 1, 24000),
      handlerReleased: variant.handlerReleased, cpuOnly: variant.cpuOnly, materialized: variant.materialized, pixelSha256: variant.pixelSha256,
      representation: { bpc: integer(variant.representation.bpc, 1, 128), bpp: integer(variant.representation.bpp, 1, 512),
        rowBytes: integer(variant.representation.rowBytes, 0, 3_072_000), bitmapInfo: integer(variant.representation.bitmapInfo, 0, 0xffffffff),
        isSRGB: variant.representation.isSRGB } };
    requireValue(['success', 'failure'].includes(variant.status));
    if (variant.status === 'failure') {
      keys(variant.error, ['domain', 'code']); requireValue(['vision', 'other'].includes(variant.error.domain));
      requireValue(variant.detected === null && variant.landmarked === null && variant.full === null && variant.confidence1 === null && variant.canonicalFull === null);
      requireValue(Array.isArray(variant.faces) && variant.faces.length === 0 && Array.isArray(variant.individual) && variant.individual.length === 0);
      return { ...metadata, status: 'failure', error: { domain: variant.error.domain, code: variant.error.code === null ? null : integer(variant.error.code, -0x80000000, 0x7fffffff) },
        detected: null, landmarked: null, faces: [], individual: [], full: null, confidence1: null, canonicalFull: null };
    }
    requireValue(variant.error === null);
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
    return { ...metadata, status: 'success', error: null, detected, landmarked,
      faces, individual: variant.individual.map(counts), full: counts(variant.full), confidence1: counts(variant.confidence1),
      canonicalFull: counts(variant.canonicalFull) };
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
