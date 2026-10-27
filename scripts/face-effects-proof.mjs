import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jpegDimensions } from './native-pixel-results.mjs';

export const FACE_BASELINE = 'c6920138de3fe239571b1c65cf6750dfd96664ff';
export const FACE_FIXTURE_SHA = '98dae85857449307d5093fc8c3de9e9e2615030b2fe29a796a17329696007cf1';
export const SEPARATED_FIXTURE_SHA = 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165';
export const FACE_JPEGS = Object.freeze(['portrait-glasses.jpg', 'portrait-crown.jpg', 'portrait-hearts.jpg',
  'close-faces.jpg', 'rolled-faces.jpg', 'edge-faces.jpg',
  'separated-glasses.jpg', 'separated-crown.jpg', 'separated-hearts.jpg']);
const PORTRAIT_PRODUCER = 'AppleFaceEffectsTests.testActualVisionPortraitDetectsUsableFacesAndRendersAllThreeOriginalVectors';
const CONTROLLED_PRODUCER = 'AppleFaceEffectsTests.testControlledCloseRollAndEdgeEvidenceUsesSafeFallback';
const SEPARATED_PRODUCER = 'AppleFaceEffectsTests.testSeparatedPortraitDecoratesBothPeopleForEveryEffect';
const methods = {
  GeometryTests: [
    'testVisionLocalBottomLeftConvertsOnceToUprightTopLeft', 'testVisionRejectsInvalidBoundsNonfiniteConfidenceAndPoints',
    'testVisionMissingOrOversizedEyeLandmarksFailClosed', 'testNonsquarePixelsDetermineRollAndPhysicalAccessoryDimensions',
    'testCrownAndHeartsOffsetAlongRolledFaceAxisInPixelSpace', 'testAnatomicalEyeOrderingDoesNotIntroducePiRotationOrMirroring',
    'testNoneNoEyesProfileSmallAndLowConfidenceFallBackWithoutOverlay', 'testSixFaceCapStableAreaPriorityAndExplicitOverloadFallback',
    'testInvalidImageMetricsAndNonfinitePlacementNeverEscape', 'testAspectFillPortraitAndLandscapePositionsAndMirrorsExactlyOnce',
    'testOtherFacesAndExplicitObstructionsSuppressAccessoriesWithoutUsableEyes',
    'testRotatedNeighborAndAccessoryCollisionsUsePixelSpaceAndStablePriority',
    'testImageEdgesSuppressClippedOrnamentsBeforeCapacityLimit', 'testV2CrownGeometryIsCompactAndAboveEyes',
    'testGlassesClipOnlyReliableNeighborsWithClearEyes',
    'testAboveHeadAlternativesFindSafeRoomWithoutRelaxingFaceProtection',
    'testSeparatedFacesKeepBothDecorationsAndTouchingFacesMayFallBack',
  ],
  FrameFreshnessGateTests: [
    'testDefaultNoneNeverAdmitsAndHasNoOverlay', 'testOnlyOnePhysicalRequestAndThrottleAfterCompletion',
    'testStaleCaptureAndFutureCaptureCannotAdmit', 'testExpiredCompletionReleasesOwnershipWithoutPainting',
    'testOverlayExpiresFromCaptureTimestampNotCompletionTimestamp',
    'testEffectChangeRetainsPendingUntilOldAcknowledgementAndNeverPaintsOldEffect',
    'testSuspendResumeRetainsPhysicalPendingAndRequiresFreshResult', 'testSelectingNoneClearsOverlayAndCannotResurrectItOnResume',
    'testDropoutClearsPreviousOverlayRatherThanHoldingLastFace', 'testRewindAndNonfiniteClockInvalidateButDoNotReleasePhysicalPending',
    'testUnknownCompletionCannotClearNewPendingOrReplaceCurrentOverlay', 'testWrongEffectNonfiniteAndOverloadPlacementsAreRejected',
    'testInvalidConfigurationUsesSafeDefaultAgeAndThrottle',
  ],
  AppleFaceEffectsTests: [
    'testActualVisionPortraitDetectsUsableFacesAndRendersAllThreeOriginalVectors',
    'testBlankImageReturnsUntouchedInputWithoutEncodingOrFakeFace', 'testNoneUnconditionallyBypassesDetectionAndEncoding',
    'testControlledAnchorsPlaceCrownAtExpectedPixelsAndKeepOuterPixels',
    'testNormalizedExifInputDoesNotPropagateGpsOrOriginalOrientation', 'testSingleFlightRejectsBacklogAndCancellationDoesNotBlockNone',
    'testAsymmetricUprightImagePreservesMarkersAndAlignsRolledGlassesWithBothEyes',
    'testCallerNormalizesAllEightExifOrientationsOnceBeforeRendering',
    'testCloseFaceAndRollFallbackPreservesProtectedNeighborPixels',
    'testControlledCloseRollAndEdgeEvidenceUsesSafeFallback',
    'testReliableNeighborClippingPreservesLensCentersAndAllExcludedPixels',
    'testSeparatedPortraitDecoratesBothPeopleForEveryEffect',
    'testTiaraPearlsRemainPhysicallyRoundOnNonsquareCanvas',
  ],
};
export const FACE_CASES = Object.freeze(Object.entries(methods).flatMap(([name, entries]) => entries.map(entry => name + '.' + entry)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireAppleOnlyPackage(manifest) {
  if (!Array.isArray(manifest?.dependencies) || manifest.dependencies.length || !Array.isArray(manifest.targets) || manifest.targets.length !== 2 ||
    !manifest.targets.some(target => target.name === 'FaceEffectsPrototype' && target.type === 'regular') ||
    !manifest.targets.some(target => target.name === 'FaceEffectsPrototypeTests' && target.type === 'test'))
    throw new Error('Prototype package must have no external dependency, plugin or application target');
}
export function requireIsolatedChanges(paths) {
  const exact = new Set(['scripts/face-effects-proof.mjs', 'scripts/face-effects-proof.test.mjs', '.github/workflows/face-effects-prototype.yml']);
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || path.includes('..') ||
    !(path.startsWith('prototypes/FaceEffects/') || exact.has(path)))) throw new Error('Prototype changed a path outside its isolated boundary');
}
function boundedFile(path, maximum) {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || state.size <= 0 || state.size > maximum)
    throw new Error('Prototype evidence must be a bounded regular file');
  return readFileSync(path);
}
export function requireFaceCases(cases) {
  if (!Array.isArray(cases) || cases.length !== FACE_CASES.length || new Set(cases.map(row => row?.id)).size !== FACE_CASES.length ||
    cases.some(row => !FACE_CASES.includes(row?.id) || row?.failed !== false || row?.skipped !== false))
    throw new Error(`All ${FACE_CASES.length} exact native prototype methods must execute and pass without skips`);
  return { executed: cases.length, passed: cases.length, failed: 0, skipped: 0 };
}
export function parseFaceXunit(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Invalid or oversized XCTest XML');
  const python = `import json,sys,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read())
rows=[]
for c in r.iter('testcase'):
 name=c.attrib.get('name',''); cls=c.attrib.get('classname','').split('.')[-1]
 parts=name.split('.')
 if len(parts)>1: cls=parts[-2]
 method=parts[-1].split('(')[0]
 rows.append({'id':cls+'.'+method,'failed':any(x.tag in ('failure','error') for x in c.iter()),'skipped':any(x.tag=='skipped' for x in c.iter())})
for suite in r.iter():
 if suite.tag in ('testsuite','testsuites'):
  for key in ('failures','errors','skipped'):
   if int(suite.attrib.get(key,'0'))!=0: raise ValueError('Nonpassing XCTest suite')
print(json.dumps(rows))`;
  let cases;
  try { cases = JSON.parse(execFileSync('python3', ['-c', python], { input: xml, encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { throw new Error('Could not verify native XCTest XML'); }
  return { ...requireFaceCases(cases), cases: cases.map(row => row.id).sort() };
}
export function inspectFaceJpegs(directory) {
  const state = lstatSync(directory);
  if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('Prototype evidence directory must not be a symlink');
  if (!Array.isArray(FACE_JPEGS) || FACE_JPEGS.some(name => !existsSync(join(directory, name))))
    throw new Error('All nine actual native still/diagnostic JPEGs are required');
  const names = readdirSync(directory).filter(name => /\.(?:jpg|jpeg|png)$/i.test(name)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...FACE_JPEGS].sort())) throw new Error('Unexpected prototype image evidence');
  const rows = FACE_JPEGS.map(name => {
    const bytes = boundedFile(join(directory, name), 4 * 1024 * 1024), dimensions = jpegDimensions(bytes), sha256 = digest(bytes);
    const separated = name.startsWith('separated-');
    if (dimensions.width !== (separated ? 1122 : 960) || dimensions.height !== (separated ? 1402 : 1200) ||
      sha256 === FACE_FIXTURE_SHA || sha256 === SEPARATED_FIXTURE_SHA)
      throw new Error('Native derivative dimensions or source separation failed');
    const portrait = name.startsWith('portrait-');
    return { file: name, bytes: bytes.length, sha256, ...dimensions,
      producer: portrait ? PORTRAIT_PRODUCER : separated ? SEPARATED_PRODUCER : CONTROLLED_PRODUCER,
      kind: portrait ? 'actual-Vision-touching-still' : separated ? 'actual-Vision-separated-still' : 'controlled-anchor-diagnostic' };
  });
  if (new Set(rows.map(row => row.sha256)).size !== FACE_JPEGS.length) throw new Error('Still/diagnostic outputs must have distinct bytes');
  return rows;
}
export function requireSceneCoverage(value, scene) {
  const keys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object) &&
    JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort());
  if (!['touching', 'separated'].includes(scene) || !keys(value, ['scene', 'expectedPeople', 'styles']) ||
    value.scene !== scene || value.expectedPeople !== 2 || !Array.isArray(value.styles) || value.styles.length !== 3)
    throw new Error('Native scene coverage schema failed');
  const expected = ['glasses', 'crown', 'hearts'];
  if (JSON.stringify(value.styles.map(row => row?.accessory).sort()) !== JSON.stringify([...expected].sort()))
    throw new Error('All three exact effects require scene coverage');
  for (const row of value.styles) {
    if (!keys(row, ['accessory', 'detected', 'landmarked', 'decorated', 'omitted', 'explanation']) ||
      ['detected', 'landmarked', 'decorated', 'omitted'].some(key => !Number.isInteger(row[key]) || row[key] < 0 || row[key] > 2) ||
      row.decorated < 1 || row.decorated > row.landmarked || row.landmarked > row.detected || row.omitted !== 2 - row.decorated)
      throw new Error('Native scene counts are inconsistent');
    const reason = row.decorated === 2 ? 'none' : row.detected < 2 ? 'detector-miss' :
      row.landmarked < 2 ? 'landmarks-unusable' : 'placement-protection';
    if (row.explanation !== reason || scene === 'separated' && (row.detected !== 2 || row.landmarked !== 2 || row.decorated !== 2))
      throw new Error('Separated scene must decorate both people; any omission must be explained truthfully');
  }
  return value;
}
export function inspectSceneCoverage(directory) {
  return Object.fromEntries(['touching', 'separated'].map(scene => {
    const file = `${scene}-coverage.json`, bytes = boundedFile(join(directory, file), 16 * 1024);
    let value;
    try { value = JSON.parse(bytes); } catch { throw new Error('Malformed native scene coverage JSON'); }
    return [scene, { ...requireSceneCoverage(value, scene), file, sha256: digest(bytes),
      producer: scene === 'touching' ? PORTRAIT_PRODUCER : SEPARATED_PRODUCER }];
  }));
}
export function faceInputs(root) {
  root = realpathSync(root);
  const packageDirectory = join(root, 'prototypes/FaceEffects');
  if (realpathSync(packageDirectory) !== packageDirectory) throw new Error('Prototype package must remain inside its declared directory');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024 }).trim().split('\n').filter(Boolean);
  const changed = [...new Set([
    ...git(['diff', '--name-only', FACE_BASELINE, 'HEAD']), ...git(['diff', '--name-only']),
    ...git(['diff', '--cached', '--name-only']), ...git(['ls-files', '--others', '--exclude-standard']),
  ])].sort();
  requireIsolatedChanges(changed);
  const fixture = boundedFile(join(root, 'prototypes/FaceEffects/Tests/FaceEffectsPrototypeTests/Fixtures/portrait.jpg'), 1024 * 1024);
  if (digest(fixture) !== FACE_FIXTURE_SHA) throw new Error('Only the approved generated portrait fixture may enter native testing');
  const separated = boundedFile(join(root, 'prototypes/FaceEffects/Tests/FaceEffectsPrototypeTests/Fixtures/separated-portrait.png'), 8 * 1024 * 1024);
  if (digest(separated) !== SEPARATED_FIXTURE_SHA) throw new Error('Separated generated portrait fixture changed');
  const sources = {};
  for (const path of ['prototypes/FaceEffects/Package.swift', 'prototypes/FaceEffects/Tests/FaceEffectsPrototypeTests/Fixtures/provenance.json',
    '.github/workflows/face-effects-prototype.yml', 'scripts/face-effects-proof.mjs', 'scripts/face-effects-proof.test.mjs'])
    sources[path] = digest(boundedFile(join(root, path), 128 * 1024));
  for (const [name, expected] of Object.entries(methods)) {
    const path = `prototypes/FaceEffects/Tests/FaceEffectsPrototypeTests/${name}.swift`, text = boundedFile(join(root, path), 128 * 1024).toString();
    const actual = [...text.matchAll(/\bfunc\s+(test\w+)\s*\(\s*\)/g)].map(match => match[1]).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()) || /\bXCTSkip\b/.test(text)) throw new Error('Prototype test inventory changed');
    sources[path] = digest(Buffer.from(text));
  }
  const sourceDirectory = join(root, 'prototypes/FaceEffects/Sources/FaceEffectsPrototype');
  for (const name of readdirSync(sourceDirectory).sort()) {
    if (!name.endsWith('.swift')) throw new Error('Unexpected prototype source');
    const path = `prototypes/FaceEffects/Sources/FaceEffectsPrototype/${name}`;
    sources[path] = digest(boundedFile(join(root, path), 128 * 1024));
  }
  return { baseline: FACE_BASELINE, sourceCommit: git(['rev-parse', 'HEAD'])[0], shippingSourceUnchanged: true, changed, expectedCases: FACE_CASES,
    fixtureSha256: FACE_FIXTURE_SHA, separatedFixtureSha256: SEPARATED_FIXTURE_SHA,
    sourceSHA256: sources, dependencies: 'Apple frameworks only; no package dependencies',
    scope: 'Isolated still-image and pure frame-admission prototype; no camera, app, live tracking or device proof' };
}
function cli() {
  const [mode, directory] = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (!['prepare', 'finish'].includes(mode) || !directory || directory !== resolve(directory)) throw new Error('Usage: face-effects-proof.mjs prepare|finish ABSOLUTE_OUTPUT');
  const inputs = faceInputs(root);
  if (mode === 'prepare') {
    if (existsSync(directory)) throw new Error('Evidence directory already exists; refuse stale test evidence');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'source-manifest.json'), JSON.stringify(inputs, null, 2) + '\n');
    return;
  }
  const saved = JSON.parse(boundedFile(join(directory, 'source-manifest.json'), 128 * 1024));
  if (JSON.stringify(saved) !== JSON.stringify(inputs)) throw new Error('Prototype sources changed during native testing');
  for (const marker of ['ios-typecheck.ok', 'swift-test.ok']) {
    if (boundedFile(join(directory, marker), 32).toString() !== 'passed\n') throw new Error('Both native phases must pass');
  }
  if (!existsSync(join(directory, 'tests.xml'))) throw new Error('SwiftPM produced no structured XCTest report; verify parallel XCTest mode');
  const tests = parseFaceXunit(boundedFile(join(directory, 'tests.xml'), 1024 * 1024).toString());
  requireAppleOnlyPackage(JSON.parse(boundedFile(join(directory, 'package-manifest.json'), 128 * 1024)));
  const images = inspectFaceJpegs(directory);
  const scenes = inspectSceneCoverage(directory);
  const report = { ...inputs, result: 'passed', tests, images, scenes, iosSDKTypecheck: 'passed', macOSVisionAndRenderer: 'passed',
    unverified: ['iOS runtime', 'camera/session attachment', 'live tracking/smoothing', 'M2 iPad performance/thermal', 'app integration and durability/export', 'real guests/device'] };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const touching = scenes.touching.styles.map(row => `${row.accessory}=${row.decorated}/2(detected${row.detected},landmarked${row.landmarked})`).join(',');
  console.log(`::notice title=Face prototype evidence::${FACE_CASES.length} exact native methods passed; ${FACE_JPEGS.length} native JPEGs; separated:2/2 people for all three effects; touching:${touching}; iOS SDK typecheck. Shipping app unchanged. No live camera, tracking or physical-iPad proof.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); } catch (error) { console.error('::error title=Face prototype gate::' + error.message.replace(/[\r\n%]/g, ' ').slice(0, 300)); process.exitCode = 1; }
}
