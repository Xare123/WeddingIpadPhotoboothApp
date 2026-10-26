import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPixelProject, ownedSimulatorRemoval, pixelCleanupDecision, pixelInputs, PIXEL_BUNDLE_ID, PIXEL_LIMITS, PIXEL_PROJECT_NAME, requireUnhostedPixelSettings, verifyPixelProject } from './native-pixel-project.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), 'wedding-native-pixel-contract-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
function fixture(t) {
  const base = temporary(t), repository = join(base, 'repository'), directory = join(base, 'project');
  const files = [
    ['ios/PhotoEffectsEngine.swift', 'import Foundation\n'],
    ['tests/PhotoEffectsEngineTests.swift', 'import XCTest\nfinal class PhotoEffectsEngineTests: XCTestCase {\n' + Array.from({ length: 8 }, (_, index) => ' func testEffect' + index + '() {}').join('\n') + '\n}\n'],
    ['ios/PhotoTemplateEngine.swift', 'import Foundation\n'],
    ['tests/PhotoTemplateEngineTests.swift', 'import XCTest\nfinal class PhotoTemplateEngineTests: XCTestCase {\n' + Array.from({ length: 11 }, (_, index) => ' func testTemplate' + index + '() {}').join('\n') + '\n}\n'],
  ];
  for (const [name, contents] of files) {
    const path = join(repository, 'apps/ipad/modules/wedding-photo-effects', name);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents);
  }
  const resources = join(repository, 'apps/ipad/native-tests/fixtures/studio'); mkdirSync(resources, { recursive: true });
  for (const name of ['portrait-1', 'portrait-2', 'portrait-3', 'portrait-4', 'landscape-1', 'landscape-2']) {
    writeFileSync(join(resources, 'studio-' + name + '.jpg'), Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
  }
  return { repository, directory, plan: createPixelProject(repository, directory) };
}

test('bare project requires only four Swift inputs and six images, with no application, packages or host dependency', t => {
  const { repository, directory, plan } = fixture(t);
  assert.equal(plan.expectedTests, 19); assert.equal(plan.sources.length, 4); assert.equal(plan.resources.length, 6);
  assert.equal(plan.expectedCases.filter(name => name.startsWith('PhotoEffectsEngineTests.')).length, 8);
  assert.equal(plan.expectedCases.filter(name => name.startsWith('PhotoTemplateEngineTests.')).length, 11);
  assert.equal(existsSync(join(repository, 'package.json')), false);
  assert.equal(existsSync(join(repository, 'apps/ipad/native-tests/WeddingPhotoboothReleaseSmokeTests.swift')), false);
  const project = readFileSync(join(plan.project, 'project.pbxproj'), 'utf8');
  assert.equal((project.match(/isa = PBXNativeTarget;/g) ?? []).length, 1);
  assert.ok(project.includes('com.apple.product-type.bundle.unit-test'));
  assert.equal(/TEST_HOST|BUNDLE_LOADER|TEST_TARGET_NAME|PBXTargetDependency|PBXShellScriptBuildPhase|Expo|Pods/.test(project), false);
  assert.ok(project.includes('dependencies = ()'));
  const scheme = readFileSync(join(plan.project, 'xcshareddata/xcschemes', plan.scheme + '.xcscheme'), 'utf8');
  assert.ok(scheme.includes('buildForRunning="NO"')); assert.ok(scheme.includes('skipped="NO"'));
  for (const input of [...plan.sources, ...plan.resources]) {
    assert.equal(hash(readFileSync(join(repository, input.source))), input.sha256);
    assert.equal(hash(readFileSync(join(directory, input.generatedSource))), input.sha256);
  }
  assert.equal(verifyPixelProject(plan, repository), true);
});

test('current production engine/test and fixture bytes are copied unchanged; native execution is not implied', t => {
  const directory = join(temporary(t), 'current-project'), expected = pixelInputs(root);
  const before = [...expected.sources, ...expected.resources].map(input => [input.source, hash(readFileSync(join(root, input.source)))]);
  const plan = createPixelProject(root, directory);
  assert.equal(plan.expectedCases.length, 19);
  assert.ok(plan.expectedCases.includes('PhotoTemplateEngineTests.testV2AllSixCleanNativeJpegFullAndPreviewAttachments'));
  for (const [source, digest] of before) assert.equal(hash(readFileSync(join(root, source))), digest);
  assert.equal(verifyPixelProject(plan, root), true);
});

test('generator refuses a nonempty destination instead of deleting existing files', t => {
  const { repository } = fixture(t), directory = join(temporary(t), 'keep'); mkdirSync(directory);
  writeFileSync(join(directory, 'keep.txt'), 'original');
  assert.throws(() => createPixelProject(repository, directory), /must be empty/);
  assert.equal(readFileSync(join(directory, 'keep.txt'), 'utf8'), 'original');
});

test('source, resource and generated-copy drift cannot reuse an old hash manifest', t => {
  for (const mutate of [
    value => writeFileSync(join(value.repository, value.plan.sources[0].source), 'import Foundation\n// drift'),
    value => writeFileSync(join(value.directory, value.plan.sources[0].generatedSource), 'copy drift'),
    value => writeFileSync(join(value.repository, value.plan.resources[0].source), 'not jpeg'),
    value => writeFileSync(join(value.directory, value.plan.resources[0].generatedSource), 'copy drift'),
    value => { value.plan.expectedTests = 0; },
    value => { value.plan.expectedCases.reverse(); },
    value => { value.plan.version = 2; },
    value => { value.plan.project = join(value.directory, 'different.xcodeproj'); },
  ]) { const value = fixture(t); mutate(value); assert.throws(() => verifyPixelProject(value.plan, value.repository)); }
});

test('reviewed canonical graph rejects empty sources, changed optimization and skipped scheme even with mutually changed plan digests', t => {
  for (const kind of ['emptySources', 'optimization', 'scheme']) {
    const { repository, plan } = fixture(t);
    if (kind === 'scheme') {
      const path = join(plan.project, 'xcshareddata/xcschemes', plan.scheme + '.xcscheme');
      const changed = readFileSync(path, 'utf8').replace('skipped="NO"', 'skipped="YES"');
      writeFileSync(path, changed); plan.schemeSHA256 = hash(changed);
    } else {
      const path = join(plan.project, 'project.pbxproj'), original = readFileSync(path, 'utf8');
      const changed = kind === 'emptySources'
        ? original.replace(/(isa = PBXSourcesBuildPhase;[^\n]*?files = )\([^)]*\)/, '$1()')
        : original.replace('SWIFT_OPTIMIZATION_LEVEL = "-O"', 'SWIFT_OPTIMIZATION_LEVEL = "-Onone"');
      assert.notEqual(changed, original); writeFileSync(path, changed); plan.projectSHA256 = hash(changed);
    }
    assert.throws(() => verifyPixelProject(plan, repository), /reviewed independent/);
  }
});

test('pixel source discovery rejects missing methods, skips or Expo imports instead of reducing nineteen', t => {
  for (const change of [
    text => text.replace(' func testEffect0() {}', ''),
    text => text + '\n// XCTSkip not permitted in required cases',
    text => text.replace('import XCTest', 'import ExpoModulesCore\nimport XCTest'),
  ]) {
    const { repository, plan } = fixture(t), path = join(repository, plan.sources[1].source);
    writeFileSync(path, change(readFileSync(path, 'utf8')));
    assert.throws(() => pixelInputs(repository));
  }
});

function settings() {
  return [{ target: PIXEL_PROJECT_NAME, buildSettings: {
    PRODUCT_BUNDLE_IDENTIFIER: PIXEL_BUNDLE_ID, PRODUCT_TYPE: 'com.apple.product-type.bundle.unit-test',
    CONFIGURATION: 'Release', SDK_NAME: 'iphonesimulator26.2', PRODUCT_NAME: PIXEL_PROJECT_NAME,
    TEST_HOST: '', BUNDLE_LOADER: '',
  } }];
}
test('hosted application, device SDK or wrong build target cannot satisfy the unhosted settings proof', () => {
  assert.equal(requireUnhostedPixelSettings(settings()).applicationHost, false);
  for (const change of [
    value => { value[0].buildSettings.TEST_HOST = '/private/do-not-print/App.app/App'; },
    value => { value[0].buildSettings.BUNDLE_LOADER = '/private/do-not-print/App'; },
    value => { value[0].buildSettings.TEST_TARGET_NAME = 'do-not-print'; },
    value => { value[0].buildSettings.SDK_NAME = 'iphoneos26.2'; },
    value => { value[0].target = 'Other'; },
    value => { value[0].buildSettings.PRODUCT_TYPE = 'com.apple.product-type.application'; },
  ]) {
    const value = settings(); change(value);
    assert.throws(() => requireUnhostedPixelSettings(value), error => {
      assert.ok(!JSON.stringify(error.diagnosticShape).includes('do-not-print')); return true;
    });
  }
});

test('independent workflow uses no package/Expo/Pods install and retains finite budgets and explicit nineteen-only scope', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ios-native-pixels.yml'), 'utf8');
  const runner = readFileSync(join(root, 'scripts/ci-native-pixels.mjs'), 'utf8');
  assert.ok(workflow.includes("'[native-pixels-ci]'")); assert.ok(workflow.includes('runs-on: macos-15-intel'));
  assert.equal(/npm ci|npx |pod install|expo prebuild/.test(workflow), false);
  assert.equal(/resolveExpoEntry|prepare-ios-tests|pod.*install|expo.*prebuild/.test(runner), false);
  const native = Number(workflow.match(/Execute nineteen[^\n]*\n\s*timeout-minutes:\s*(\d+)/)?.[1]);
  const job = Number(workflow.match(/\n    timeout-minutes:\s*(\d+)/)?.[1]);
  assert.equal(native, PIXEL_LIMITS.nativeStepMinutes); assert.equal(job, PIXEL_LIMITS.jobMinutes);
  assert.ok(PIXEL_LIMITS.preparationMs + PIXEL_LIMITS.xcodeMs + PIXEL_LIMITS.artifactsMs + PIXEL_LIMITS.cleanupMs + 12000 < native * 60000);
  assert.ok(job >= native + 3 + 3 + 4);
  assert.ok(workflow.includes('separate actual full Expo app launch/relaunch/rotation test remains unverified'));
  assert.ok(workflow.includes('native-pixels-jpegs-${{ github.sha }}'));
  assert.ok(workflow.includes('!${{ runner.temp }}/wedding-native-pixels-diagnostics/native-pixels.xcresult/**'));
  assert.match(runner, /bootstatus[^\n]+timeout: 600000/);
});

test('non-macOS runner invocation refuses native execution and reports unknown counts without mutating application sources', t => {
  const directory = temporary(t), preload = join(directory, 'non-native.mjs');
  writeFileSync(preload, 'Object.defineProperty(process,"platform",{value:"linux"});\n');
  const app = join(root, 'apps/ipad/App.tsx'), before = hash(readFileSync(app));
  const executed = spawnSync(process.execPath, ['--import', preload, join(root, 'scripts/ci-native-pixels.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, WEDDING_PIXEL_DIAGNOSTICS_DIR: join(directory, 'diagnostics') },
  });
  assert.equal(executed.status, 1);
  const status = JSON.parse(readFileSync(join(directory, 'diagnostics/status.json')));
  assert.equal(status.result, 'failed'); assert.equal(status.tests, null);
  assert.equal(status.processCleanup.buildOutputsRemoved, false);
  assert.equal(hash(readFileSync(app)), before);
  assert.ok(executed.stdout.includes('"executed":"unknown"'));
  assert.ok(executed.stdout.includes('"fullExpoSmokeVerified":false'));
});

test('failed owned-simulator deletion cannot pass cleanup merely because command groups are quiescent', () => {
  const udid = '11111111-1111-4111-8111-111111111111';
  const unknown = ownedSimulatorRemoval({ udid, creationRequested: true, deleteCode: 1 });
  const decision = pixelCleanupDecision({ result: 'passed', quiescent: true, removal: unknown });
  assert.equal(unknown.verified, false); assert.equal(decision.result, 'failed');
  assert.equal(decision.removeBuildOutputs, false);
  assert.ok(decision.error.includes('simulator removal'));
  const stillPresent = ownedSimulatorRemoval({ udid, creationRequested: true, deleteCode: 1,
    inventory: { devices: { 'iOS-26-2': [{ udid }] } } });
  assert.equal(stillPresent.verified, false);
  assert.equal(ownedSimulatorRemoval({ creationRequested: true }).method, 'creation-outcome-unknown');
});

test('successful delete or validated absence can recover a shutdown failure without touching another simulator', () => {
  const udid = '11111111-1111-4111-8111-111111111111';
  for (const removal of [ownedSimulatorRemoval({ udid, creationRequested: true, deleteCode: 0 }),
    ownedSimulatorRemoval({ udid, creationRequested: true, deleteCode: 1, inventory: { devices: {
      'iOS-26-2': [{ udid: '22222222-2222-4222-8222-222222222222' }],
    } } })]) {
    assert.equal(removal.verified, true);
    assert.equal(pixelCleanupDecision({ result: 'passed', quiescent: true, removal }).result, 'passed');
  }
  const removal = ownedSimulatorRemoval({ udid, creationRequested: true, cancelled: true });
  assert.equal(removal.verified, false);
  assert.equal(pixelCleanupDecision({ result: 'cancelled', quiescent: true, removal }).removeBuildOutputs, false);
});
