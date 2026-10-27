import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_PIXEL_PROFILE, TREATMENT_PIXEL_PROFILE, TREATMENT_CLASS, TREATMENT_CASES, TREATMENT_METHODS,
  TREATMENT_FIXTURE, TREATMENT_SOURCE_PATHS, REVIEWED_FACE_SHA256, nativePixelProfile } from './native-treatment-profile.mjs';
import { createPixelProject, pixelInputs, verifyPixelProject } from './native-pixel-project.mjs';
import { expectedPixelAttachments, exportNamedPixelJpegs, inspectPixelTests, requirePassingPixelTests } from './native-pixel-results.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-treatment-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
function fixture(t) {
  const directory = temporary(t), repository = join(directory, 'repository'), generated = join(directory, 'generated');
  const files = [
    ['ios/PhotoEffectsEngine.swift', 'import Foundation\n'],
    ['tests/PhotoEffectsEngineTests.swift', 'import XCTest\nfinal class PhotoEffectsEngineTests: XCTestCase {\n' + Array.from({ length: 8 }, (_, i) => 'func testEffect' + i + '() {}').join('\n') + '\n}'],
    ['ios/PhotoTemplateEngine.swift', 'import Foundation\n'],
    ['tests/PhotoTemplateEngineTests.swift', 'import XCTest\nfinal class PhotoTemplateEngineTests: XCTestCase {\n' + Array.from({ length: 11 }, (_, i) => 'func testTemplate' + i + '() {}').join('\n') + '\n}'],
    ['ios/PhotoTreatmentEngine.swift', 'import Foundation\n'],
    ['tests/NativePhotoTreatmentEngineTests.swift', 'import XCTest\nfinal class ' + TREATMENT_CLASS + ': XCTestCase {\n' + TREATMENT_METHODS.map(name => 'func ' + name + '() {}').join('\n') + '\n}'],
  ];
  for (const [name, text] of files) {
    const path = join(repository, 'apps/ipad/modules/wedding-photo-effects', name);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text);
  }
  for (const name of Object.keys(REVIEWED_FACE_SHA256)) {
    const path = 'apps/ipad/modules/wedding-photo-effects/ios/' + name;
    writeFileSync(join(repository, path), readFileSync(join(root, path)));
  }
  const resourceDirectory = join(repository, 'apps/ipad/native-tests/fixtures/studio'); mkdirSync(resourceDirectory, { recursive: true });
  for (const name of ['portrait-1', 'portrait-2', 'portrait-3', 'portrait-4', 'landscape-1', 'landscape-2']) {
    writeFileSync(join(resourceDirectory, 'studio-' + name + '.jpg'), Buffer.from([255, 216, 1, 2, 255, 217]));
  }
  const png = join(repository, TREATMENT_FIXTURE.source); mkdirSync(dirname(png), { recursive: true });
  writeFileSync(png, readFileSync(join(root, TREATMENT_FIXTURE.source)));
  return { repository, generated, plan: createPixelProject(repository, generated, TREATMENT_PIXEL_PROFILE) };
}

test('only explicit reviewed profiles exist and treatment mode cannot replace the baseline nineteen', () => {
  assert.equal(nativePixelProfile().expectedTests, 19); assert.equal(nativePixelProfile().expectedJpegs, 16);
  assert.equal(nativePixelProfile(TREATMENT_PIXEL_PROFILE).expectedTests, 29);
  assert.deepEqual(nativePixelProfile(TREATMENT_PIXEL_PROFILE).classes, {
    PhotoEffectsEngineTests: 8, PhotoTemplateEngineTests: 11, NativePhotoTreatmentEngineTests: 10,
  });
  for (const value of ['unknown', '', null, '__proto__', {}]) assert.throws(() => nativePixelProfile(value));
});

test('extended project retains all original cases/resources and exact reviewed pure face copies without an app host', t => {
  const { repository, generated, plan } = fixture(t);
  const core = pixelInputs(repository);
  assert.equal(plan.expectedTests, 29); assert.equal(plan.sources.length, 9); assert.equal(plan.resources.length, 7);
  assert.deepEqual(plan.expectedCases.slice(0, 19), core.cases); assert.deepEqual(plan.expectedCases.slice(19), [...TREATMENT_CASES]);
  assert.deepEqual(plan.resources.slice(0, 6), core.resources);
  const project = readFileSync(join(plan.project, 'project.pbxproj'), 'utf8');
  assert.equal((project.match(/isa = PBXNativeTarget;/g) ?? []).length, 1);
  assert.equal(/TEST_HOST|BUNDLE_LOADER|Expo|Pods|PBXShellScriptBuildPhase|PBXTargetDependency/.test(project), false);
  assert.ok(project.includes('COMPRESS_PNG_FILES = NO; STRIP_PNG_TEXT = NO;'));
  assert.ok(project.includes('explicitFileType = file; path = "Resources/separated-portrait.png"'));
  for (const input of [...plan.sources, ...plan.resources]) assert.equal(hash(readFileSync(join(generated, input.generatedSource))), input.sha256);
  for (const [name, expected] of Object.entries(REVIEWED_FACE_SHA256)) assert.equal(plan.sources.find(input => input.source.endsWith('/' + name)).sha256, expected);
  assert.equal(verifyPixelProject(plan, repository), true);
});

test('current production treatment inputs retain all nineteen baseline identities and do not depend on app/bridge sources', t => {
  const plan = createPixelProject(root, join(temporary(t), 'actual'), TREATMENT_PIXEL_PROFILE);
  assert.equal(plan.expectedTests, 29); assert.equal(plan.expectedCases.filter(id => id.startsWith(TREATMENT_CLASS + '.')).length, 10);
  assert.ok(TREATMENT_SOURCE_PATHS.every(path => plan.sources.some(input => input.source === path)));
  assert.equal(plan.sources.some(input => /WeddingPhotoEffectsModule|App\.tsx|AppDelegate/.test(input.source)), false);
  assert.equal(verifyPixelProject(plan, root), true);
});

test('missing, changed, skipped or renamed treatment sources cannot reduce required work or reuse a stale plan', t => {
  for (const mutate of [
    value => rmSync(join(value.repository, TREATMENT_SOURCE_PATHS[3])),
    value => writeFileSync(join(value.repository, TREATMENT_SOURCE_PATHS[0]), 'import Foundation\n'),
    value => writeFileSync(join(value.generated, value.plan.sources.at(-1).generatedSource), 'changed copy'),
    value => writeFileSync(join(value.repository, TREATMENT_FIXTURE.source), 'changed PNG'),
    value => { value.plan.profile = CORE_PIXEL_PROFILE; },
    value => { value.plan.expectedTests = 19; },
    value => {
      const path = join(value.repository, TREATMENT_SOURCE_PATHS.at(-1));
      writeFileSync(path, readFileSync(path, 'utf8').replace(TREATMENT_METHODS[0], 'testReplacement'));
    },
    value => {
      const path = join(value.repository, TREATMENT_SOURCE_PATHS.at(-1));
      writeFileSync(path, readFileSync(path, 'utf8') + '\n// XCTSkip is prohibited');
    },
  ]) {
    const value = fixture(t); mutate(value); assert.throws(() => verifyPixelProject(value.plan, value.repository));
  }
});

test('treatment imports, symlinks and mutually changed generated graph digests cannot bypass reviewed source admission', t => {
  const imported = fixture(t), engine = join(imported.repository, TREATMENT_SOURCE_PATHS[3]);
  writeFileSync(engine, 'import ExpoModulesCore\n'); assert.throws(() => pixelInputs(imported.repository, TREATMENT_PIXEL_PROFILE), /independent/);
  const linked = fixture(t), path = join(linked.repository, TREATMENT_SOURCE_PATHS[3]), elsewhere = join(temporary(t), 'other.swift');
  writeFileSync(elsewhere, 'import Foundation\n'); rmSync(path); symlinkSync(elsewhere, path);
  assert.throws(() => pixelInputs(linked.repository, TREATMENT_PIXEL_PROFILE), /regular/);
  const tampered = fixture(t), graph = join(tampered.plan.project, 'project.pbxproj');
  const changed = readFileSync(graph, 'utf8').replace('SWIFT_OPTIMIZATION_LEVEL = "-O"', 'SWIFT_OPTIMIZATION_LEVEL = "-Onone"');
  writeFileSync(graph, changed); tampered.plan.projectSHA256 = hash(changed);
  assert.throws(() => verifyPixelProject(tampered.plan, tampered.repository), /reviewed/);
});

function testTree(cases) {
  return { testNodes: [{ nodeType: 'Test Plan', children: cases.map(id => ({
    nodeType: 'Test Case', nodeIdentifier: id.replace('.', '/') + '()', result: 'Passed',
  })) }] };
}
function summary(total = 29) { return { totalTestCount: total, passedTests: total, failedTests: 0, skippedTests: 0 }; }

test('actual result admission requires all twenty-nine named methods and all three fixed class inventories', t => {
  const { plan } = fixture(t), result = inspectPixelTests(testTree(plan.expectedCases), plan.expectedCases, TREATMENT_PIXEL_PROFILE);
  assert.equal(result.executed, 29); assert.equal(result.perClass.PhotoEffectsEngineTests.passed, 8);
  assert.equal(result.perClass.PhotoTemplateEngineTests.passed, 11); assert.equal(result.perClass.NativePhotoTreatmentEngineTests.passed, 10);
  assert.equal(requirePassingPixelTests(result, summary(), TREATMENT_PIXEL_PROFILE), result);
  assert.throws(() => requirePassingPixelTests(result, summary(19), TREATMENT_PIXEL_PROFILE));
  assert.throws(() => requirePassingPixelTests(result, summary(), CORE_PIXEL_PROFILE));
  assert.throws(() => inspectPixelTests(testTree(plan.expectedCases.slice(0, 19)), plan.expectedCases, TREATMENT_PIXEL_PROFILE), /missing/);
  const skipped = testTree(plan.expectedCases); skipped.testNodes[0].children.at(-1).result = 'Skipped';
  const partial = inspectPixelTests(skipped, plan.expectedCases, TREATMENT_PIXEL_PROFILE);
  assert.equal(partial.executed, 28); assert.equal(partial.skipped, 1);
  assert.throws(() => requirePassingPixelTests(partial, summary(), TREATMENT_PIXEL_PROFILE));
  const renamed = [...plan.expectedCases]; renamed[28] = TREATMENT_CLASS + '.testReplacement';
  assert.throws(() => inspectPixelTests(testTree(renamed), renamed, TREATMENT_PIXEL_PROFILE), /identities/);
});

// Header-only fixtures test evidence admission, never claim Apple-rendered pixels.
function jpeg(width, height) {
  return Buffer.from([255,216,255,192,0,11,8,height >> 8,height & 255,width >> 8,width & 255,1,1,17,0,255,217]);
}
function attachments(t) {
  const directory = temporary(t), exportDirectory = join(directory, 'export'), outputDirectory = join(directory, 'public'); mkdirSync(exportDirectory);
  const manifest = [
    { testIdentifier: 'PhotoTemplateEngineTests/testV2AllSixCleanNativeJpegFullAndPreviewAttachments()', attachments: [] },
    { testIdentifier: 'PhotoTemplateEngineTests/testV2CleanMixedAspectAndExifNativeJpegAttachments()', attachments: [] },
    { testIdentifier: TREATMENT_CLASS + '/' + TREATMENT_METHODS[1] + '()', attachments: [] },
  ];
  expectedPixelAttachments(TREATMENT_PIXEL_PROFILE).forEach((entry, index) => {
    writeFileSync(join(exportDirectory, 'raw-' + index + '.jpg'), jpeg(entry.width, entry.height));
    manifest[index < 12 ? 0 : index < 16 ? 1 : 2].attachments.push({ exportedFileName: 'raw-' + index + '.jpg',
      suggestedHumanReadableName: entry.name + (index >= 16 ? '_0_6D96F847-5D91-43F9-B2B1-4F707D4B7014.jpeg' : '') });
  });
  return { exportDirectory, outputDirectory, manifest, profile: TREATMENT_PIXEL_PROFILE };
}

test('treatment evidence requires original sixteen plus three correctly produced full-resolution JPEGs', t => {
  const value = attachments(t), result = exportNamedPixelJpegs(value);
  assert.equal(result.complete, true); assert.equal(result.entries.length, 19); assert.deepEqual(result.missing, []);
  for (const entry of result.entries.slice(16)) {
    assert.equal(entry.width, 1122); assert.equal(entry.height, 1402); assert.equal(entry.producer, TREATMENT_CASES[1]);
    assert.equal(hash(readFileSync(join(value.outputDirectory, entry.file))), entry.sha256);
  }
});

test('neither missing baseline images nor missing treatment images can pass the extended gate', t => {
  for (const group of [0, 2]) {
    const value = attachments(t); value.manifest[group].attachments.pop();
    assert.throws(() => exportNamedPixelJpegs(value), /lacks required/);
    const partial = exportNamedPixelJpegs({ ...value, requireComplete: false }); assert.equal(partial.complete, false);
    assert.equal(partial.entries.length, 18); assert.equal(partial.missing.length, 1);
  }
});

test('new evidence retains producer, normalized-name, geometry and path safety checks', t => {
  for (const mutate of [
    value => { value.manifest[2].testIdentifier = value.manifest[0].testIdentifier; },
    value => { value.manifest[2].attachments[0].suggestedHumanReadableName = 'treatment-unreviewed.jpg'; },
    value => value.manifest[2].attachments.push({ ...value.manifest[2].attachments[0] }),
    value => { writeFileSync(join(value.exportDirectory, 'raw-16.jpg'), jpeg(960, 1200)); },
    value => { value.manifest[2].attachments[0].exportedFileName = '../outside.jpg'; },
  ]) { const value = attachments(t); mutate(value); assert.throws(() => exportNamedPixelJpegs(value)); assert.equal(existsSync(value.outputDirectory), false); }
});

test('integration workflows require explicit sentinels, select ARM/profile by branch and preserve the separate full-app gate', () => {
  const pixels = readFileSync(join(root, '.github/workflows/ios-native-pixels.yml'), 'utf8');
  const device = readFileSync(join(root, '.github/workflows/ios-simulator.yml'), 'utf8');
  const full = readFileSync(join(root, '.github/workflows/ios-release-runtime.yml'), 'utf8');
  for (const workflow of [pixels, device]) {
    assert.ok(workflow.includes('- codex/post-capture-face-effects'));
    assert.ok(workflow.includes('github.event.repository.private == false'));
    assert.ok(workflow.includes('ref: ${{ github.sha }}')); assert.ok(workflow.includes('persist-credentials: false'));
    assert.ok(workflow.includes('/Applications/Xcode_26.3.app/Contents/Developer'));
  }
  assert.ok(pixels.includes("contains(github.event.head_commit.message, '[native-pixels-ci]')"));
  assert.ok(pixels.includes("'photo-treatments' || 'core-pixels'"));
  assert.ok(pixels.includes('node scripts/ci-native-pixels.mjs "$WEDDING_PIXEL_PROFILE"'));
  assert.ok(device.includes("contains(github.event.head_commit.message, '[native-ci]')"));
  assert.ok(device.includes("github.ref == 'refs/heads/codex/post-capture-face-effects' && 'macos-15' || 'macos-15-intel'"));
  assert.equal(full.includes('post-capture-face-effects'), false, 'The separate twenty-case full Expo app gate is unchanged');
  assert.ok(pixels.includes('no Expo, Pods, Metro or application target'));
});
