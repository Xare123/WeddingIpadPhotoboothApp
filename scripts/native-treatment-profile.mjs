import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const CORE_PIXEL_PROFILE = 'core-pixels';
export const TREATMENT_PIXEL_PROFILE = 'photo-treatments';
export const TREATMENT_CLASS = 'NativePhotoTreatmentEngineTests';
export const TREATMENT_METHODS = Object.freeze([
  'testIdentityAndNonePreserveExactOriginalBytesAndNeverRunDetection',
  'testActualSeparatedPortraitDecoratesBothPeopleAfterLookWithoutReencodingIntermediate',
  'testBlankFaceFallbackRetainsLookAndIdentityFallbackReturnsOriginal',
  'testLookNoneMatchesExistingEnginePixelsAndRecipeOrderKeepsVectorColors',
  'testAllEightExifOrientationsNormalizeOnceAndScrubMetadata',
  'testCancellationBusyAdmissionAndNoneDoNotReleasePhysicalJobEarly',
  'testSourceScopeAndReleaseRejectQueriesHostsSymlinksAndOriginals',
  'testRecipeValidationCacheQuotaAndRestartCleanupFailClosed',
  'testRenderedFileHashAndPreviewApplyParityUseSameImmutableCacheFile',
  'testOverlappingEnginesPreserveActiveAndReturnedCacheFiles',
]);
export const TREATMENT_CASES = Object.freeze(TREATMENT_METHODS.map(method => TREATMENT_CLASS + '.' + method));
export const TREATMENT_SOURCE_PATHS = Object.freeze([
  'apps/ipad/modules/wedding-photo-effects/ios/FaceGeometry.swift',
  'apps/ipad/modules/wedding-photo-effects/ios/FrameFreshnessGate.swift',
  'apps/ipad/modules/wedding-photo-effects/ios/AppleFaceEffects.swift',
  'apps/ipad/modules/wedding-photo-effects/ios/PhotoTreatmentEngine.swift',
  'apps/ipad/modules/wedding-photo-effects/tests/NativePhotoTreatmentEngineTests.swift',
]);
export const REVIEWED_FACE_SHA256 = Object.freeze({
  'FaceGeometry.swift': '62866121340d52308afbe16d454aae81ce4873d3de99563b625a24b48c2ffaeb',
  'FrameFreshnessGate.swift': '2d1d6615c49a501302cf44861825c7cda3ad26fe161cd0db53f84cb396ee55f3',
  'AppleFaceEffects.swift': '01a87b5454f3f5b52947054302acc717b80510eead06df9e4a71bf94a3a4a8a0',
});
export const TREATMENT_FIXTURE = Object.freeze({
  source: 'apps/ipad/native-tests/fixtures/treatments/separated-portrait.png',
  generatedSource: 'Resources/separated-portrait.png',
  sha256: 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165',
});
export const TREATMENT_ATTACHMENTS = Object.freeze(['glasses', 'crown', 'hearts'].map(style => Object.freeze({
  name: 'treatment-separated-' + style, width: 1122, height: 1402,
  producer: TREATMENT_CLASS + '.testActualSeparatedPortraitDecoratesBothPeopleAfterLookWithoutReencodingIntermediate',
})));
const coreClasses = Object.freeze({ PhotoEffectsEngineTests: 8, PhotoTemplateEngineTests: 11 });
const treatmentClasses = Object.freeze({ ...coreClasses, [TREATMENT_CLASS]: TREATMENT_CASES.length });
const profiles = Object.freeze({
  [CORE_PIXEL_PROFILE]: Object.freeze({ id: CORE_PIXEL_PROFILE, expectedTests: 19, classes: coreClasses, expectedJpegs: 16 }),
  [TREATMENT_PIXEL_PROFILE]: Object.freeze({ id: TREATMENT_PIXEL_PROFILE, expectedTests: 29, classes: treatmentClasses, expectedJpegs: 19 }),
});
export function nativePixelProfile(name = CORE_PIXEL_PROFILE) {
  if (typeof name !== 'string' || !Object.hasOwn(profiles, name)) throw new Error('Unknown native pixel verification profile');
  return profiles[name];
}

/** Extra pure production Swift and a single pinned generated fixture; no bridge/App dependency. */
export function treatmentPixelInputs(root) {
  const sources = TREATMENT_SOURCE_PATHS.map(source => {
    const path = resolve(root, source), state = lstatSync(path);
    if (!state.isFile() || state.isSymbolicLink() || state.size <= 0 || state.size > 128 * 1024) throw new Error('Treatment source must be a bounded regular file');
    const bytes = readFileSync(path), text = bytes.toString('utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (Object.hasOwn(REVIEWED_FACE_SHA256, basename(source)) && sha256 !== REVIEWED_FACE_SHA256[basename(source)]) {
      throw new Error('Reviewed face source copy changed from prototype commit 9335c18');
    }
    if (/^\s*(?:@testable\s+)?import\s+(?:Expo\w*|UIKit)\b/m.test(text)) throw new Error('Treatment pixel sources must remain independent of Expo and UIKit');
    const methods = [...text.matchAll(/^\s*func\s+(test\w+)\s*\(\s*\)/gm)].map(match => match[1]);
    const isTest = source.endsWith('/NativePhotoTreatmentEngineTests.swift');
    if (isTest) {
      const classes = [...text.matchAll(/final\s+class\s+(\w+)\s*:\s*XCTestCase\b/g)].map(match => match[1]);
      if (classes.length !== 1 || classes[0] !== TREATMENT_CLASS || /\bXCTSkip\b/.test(text) ||
        JSON.stringify([...methods].sort()) !== JSON.stringify([...TREATMENT_METHODS].sort())) throw new Error('Treatment native test identities must remain exact');
    } else if (methods.length) throw new Error('Treatment production source contains unexpected test methods');
    return { source, sha256, testMethods: methods,
      generatedSource: 'Sources/' + basename(source), cases: isTest ? [...TREATMENT_CASES] : [] };
  });
  const path = resolve(root, TREATMENT_FIXTURE.source), state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink() || state.size <= 24 || state.size > 8 * 1024 * 1024) throw new Error('Treatment fixture must be a bounded regular image');
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== TREATMENT_FIXTURE.sha256 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 1122 || bytes.readUInt32BE(20) !== 1402) {
    throw new Error('Only the approved generated two-person treatment fixture may enter native testing');
  }
  return { sources, resources: [{ ...TREATMENT_FIXTURE }], cases: [...TREATMENT_CASES] };
}
