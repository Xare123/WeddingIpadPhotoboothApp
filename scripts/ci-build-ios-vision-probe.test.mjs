import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildIosVisionProbe, CI_VISION_PROBE, inspectVisionProbeXctestrun, ownedVisionProbePath,
  requireCiVisionProbePlan, requireVisionProbeSettings, runOwnedVisionProbeCommand, sanitizeVisionProbeBuildLog,
  verifyVisionProbeProducts, VISION_PROBE_BUILD_LIMITS, visionProbeBuildArguments, visionProbeBuildEnvironment,
  visionProbeCleanupDecision, visionProbeSettingsArguments } from './ci-build-ios-vision-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function temporary(t) { const path = mkdtempSync(join(tmpdir(), 'wedding-vision-build-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function plan(t) {
  const output = join(temporary(t), 'Probe');
  return { output, project: join(output, CI_VISION_PROBE.scheme + '.xcodeproj'), scheme: CI_VISION_PROBE.scheme,
    target: CI_VISION_PROBE.target, testClass: CI_VISION_PROBE.target, method: CI_VISION_PROBE.method,
    testIdentifier: [CI_VISION_PROBE.target, CI_VISION_PROBE.target, CI_VISION_PROBE.method].join('/'),
    runnerBundleID: CI_VISION_PROBE.runnerBundleID, testBundleID: CI_VISION_PROBE.testBundleID,
    developmentTeam: CI_VISION_PROBE.developmentTeam, unsignedFixture: true, ownerReady: false, readinessInTestAction: 'NOT_ARMED',
    sourcePreparationOnly: true, signingAllowed: false, applicationTarget: false, physicalExecution: false,
    sources: Array.from({ length: 5 }, (_, index) => ({ source: 'public-source-' + index + '.swift', sha256: 'a'.repeat(64) })),
    resources: [{ source: 'public-generated-fixture.png', sha256: CI_VISION_PROBE.fixtureSHA256 }], fixtureSHA256: CI_VISION_PROBE.fixtureSHA256 };
}
function settings(p) { return [{ target: p.target, buildSettings: { PRODUCT_TYPE: 'com.apple.product-type.bundle.ui-testing',
  PRODUCT_BUNDLE_IDENTIFIER: p.testBundleID, CONFIGURATION: 'Release', SDK_NAME: 'iphoneos26.2',
  CODE_SIGNING_ALLOWED: 'NO', CODE_SIGNING_REQUIRED: 'NO', COMPRESS_PNG_FILES: 'NO' } }]; }
function artifact(p) {
  return { __xctestrun_metadata__: { FormatVersion: 2 }, TestConfigurations: [{ IsEnabled: true, TestTargets: [{
    BlueprintName: p.target, IsUITestBundle: true, TestHostBundleIdentifier: p.runnerBundleID, TestBundleIdentifier: p.testBundleID,
    TestHostPath: '__TESTROOT__/Release-iphoneos/' + p.target + '-Runner.app',
    TestBundlePath: '__TESTHOST__/PlugIns/' + p.target + '.xctest', UITargetAppPath: '',
    OnlyTestIdentifiers: [p.testClass + '/' + p.method], SkipTestIdentifiers: [],
    EnvironmentVariables: { PHOTOBOOTH_SYNTHETIC_VISION_PROBE: 'NOT_ARMED', PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID: p.runnerBundleID },
  }] }] };
}
const target = value => value.TestConfigurations[0].TestTargets[0];

test('only the fake unsigned NOT_ARMED source-preparation plan is admitted', t => {
  assert.equal(requireCiVisionProbePlan(plan(t)).ownerReady, false);
  for (const changes of [{ ownerReady: true }, { unsignedFixture: false }, { signingAllowed: true },
    { readinessInTestAction: 'OWNER_READY' }, { physicalExecution: true }, { applicationTarget: true },
    { runnerBundleID: 'org.other.physicaltests.xctrunner' }, { developmentTeam: 'OTHERTEAM0' },
    { testIdentifier: 'Other/testExample' }, { fixtureSHA256: 'b'.repeat(64) }, { sources: [] }]) {
    assert.throws(() => requireCiVisionProbePlan({ ...plan(t), ...changes }));
  }
});

test('actual constructed action is unsigned generic iphoneos build-for-testing with one selected method', t => {
  const p = plan(t), args = visionProbeBuildArguments(p, join(temporary(t), 'DerivedData'));
  assert.equal(args.at(-1), 'build-for-testing'); assert.equal(args[args.indexOf('-sdk') + 1], 'iphoneos');
  assert.equal(args[args.indexOf('-destination') + 1], 'generic/platform=iOS');
  for (const value of ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', '-only-testing:' + p.testIdentifier]) assert.ok(args.includes(value));
  assert.equal(args.some(value => ['test', 'test-without-building', '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration'].includes(value)), false);
  assert.equal(args.some(value => /id=|simulator|OWNER_READY/i.test(value)), false);
  const preflight = visionProbeSettingsArguments(p);
  assert.ok(preflight.includes('-target')); assert.ok(preflight.includes('-showBuildSettings'));
  assert.equal(preflight.includes('-scheme'), false); assert.equal(preflight.includes('-destination'), false);
});

test('settings proof rejects hosted app dependencies, signing, simulator SDK and changed PNG copying', t => {
  const p = plan(t); assert.equal(requireVisionProbeSettings(settings(p), p).signingAllowed, false);
  for (const [key, value] of [['PRODUCT_TYPE', 'com.apple.product-type.application'], ['SDK_NAME', 'iphonesimulator26.2'],
    ['CODE_SIGNING_ALLOWED', 'YES'], ['CODE_SIGNING_REQUIRED', 'YES'], ['COMPRESS_PNG_FILES', 'YES'],
    ['TEST_TARGET_NAME', 'WeddingPhotobooth'], ['TEST_HOST', '/an/app'], ['UITEST_TARGET_APP_PATH', '/an/app']]) {
    const changed = settings(p); changed[0].buildSettings[key] = value; assert.throws(() => requireVisionProbeSettings(changed, p));
  }
  assert.throws(() => requireVisionProbeSettings([...settings(p), ...settings(p)], p));
});

test('actual V2 or V1 xctestrun requires the sole selected class/method and NOT_ARMED variables', t => {
  const p = plan(t), value = artifact(p), proof = inspectVisionProbeXctestrun(value, p);
  assert.equal(proof.testTargets, 1); assert.equal(proof.selectedTest, p.testIdentifier); assert.equal(proof.readiness, 'NOT_ARMED');
  const legacy = { __xctestrun_metadata__: { FormatVersion: 1 }, [p.target]: target(value) };
  assert.equal(inspectVisionProbeXctestrun(legacy, p).format, 1);
  target(value).OnlyTestIdentifiers = [p.testIdentifier]; assert.equal(inspectVisionProbeXctestrun(value, p).selectedTest, p.testIdentifier);
});

test('armed, extra, skipped or wrong xctestrun targets and application dependencies fail closed', t => {
  const p = plan(t);
  for (const mutate of [
    value => { target(value).EnvironmentVariables.PHOTOBOOTH_SYNTHETIC_VISION_PROBE = 'OWNER_READY'; },
    value => { value.TestConfigurations[0].EnvironmentVariables = { hidden: 'OWNER_READY' }; },
    value => { target(value).EnvironmentVariables.PHOTOBOOTH_OTHER_PRIVATE_VALUE = 'fixture'; },
    value => { delete target(value).EnvironmentVariables.PHOTOBOOTH_SYNTHETIC_VISION_PROBE; },
    value => { target(value).EnvironmentVariables.PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID = 'org.other.runner'; },
    value => { value.TestConfigurations[0].TestTargets.push({ ...target(value) }); },
    value => { value.TestConfigurations.push({ ...value.TestConfigurations[0] }); },
    value => { value.TestConfigurations[0].IsEnabled = false; },
    value => { target(value).OnlyTestIdentifiers = []; },
    value => { target(value).OnlyTestIdentifiers = ['OtherClass/testExample']; },
    value => { target(value).OnlyTestIdentifiers.push(p.testClass + '/testOther'); },
    value => { target(value).SkipTestIdentifiers = [p.testClass + '/' + p.method]; },
    value => { target(value).UITargetAppPath = '__TESTROOT__/Wedding.app'; },
    value => { target(value).DependentProductPaths = ['__TESTROOT__/Wedding.app']; },
    value => { target(value).TestHostBundleIdentifier = 'org.other.runner'; },
    value => { value.__xctestrun_metadata__.FormatVersion = 99; },
  ]) { const value = artifact(p); mutate(value); assert.throws(() => inspectVisionProbeXctestrun(value, p)); }
});

function products(t) {
  const p = plan(t), directory = join(temporary(t), 'Products'), runner = join(directory, 'Release-iphoneos', p.target + '-Runner.app');
  const testBundle = join(runner, 'PlugIns', p.target + '.xctest'); mkdirSync(testBundle, { recursive: true });
  copyFileSync(join(root, 'apps/ipad/native-tests/fixtures/treatments/separated-portrait.png'), join(testBundle, 'separated-portrait.png'));
  return { p, directory, runner, testBundle, options: { products: directory, plan: p, xctestrun: artifact(p),
    runnerInfo: { CFBundleIdentifier: p.runnerBundleID }, testInfo: { CFBundleIdentifier: p.testBundleID } } };
}

test('built runner and test bundle identities retain exact uncompressed PNG without claiming execution', t => {
  const { options } = products(t), proof = verifyVisionProbeProducts(options);
  assert.equal(proof.fixtureVerified, true); assert.equal(proof.fixtureBytes, 2_150_366); assert.equal(proof.testsExecuted, 0);
  assert.equal(proof.compileOnly, true); assert.equal(proof.ownerReady, false); assert.equal(proof.testHostPath, undefined);
});

test('built fixture mutation, identity changes, path escape and symlink cannot satisfy artifact proof', t => {
  for (const mutate of [
    value => writeFileSync(join(value.testBundle, 'separated-portrait.png'), 'mutated fixture'),
    value => { value.options.runnerInfo.CFBundleIdentifier = 'org.other.runner'; },
    value => { value.options.testInfo.CFBundleIdentifier = 'org.other.test'; },
    value => { target(value.options.xctestrun).TestHostPath = '/outside/Other-Runner.app'; },
    value => { target(value.options.xctestrun).TestBundlePath = '__TESTROOT__/../private/test.xctest'; },
    value => {
      const file = join(value.testBundle, 'separated-portrait.png'), elsewhere = join(temporary(t), 'outside.png');
      copyFileSync(file, elsewhere); rmSync(file); symlinkSync(elsewhere, file);
    },
  ]) { const value = products(t); mutate(value); assert.throws(() => verifyVisionProbeProducts(value.options)); }
  const value = products(t), linkedRoot = join(temporary(t), 'linked'); symlinkSync(value.directory, linkedRoot);
  assert.throws(() => ownedVisionProbePath(linkedRoot, target(value.options.xctestrun).TestHostPath));
});

test('build environment forwards tools and standard paths without inherited credentials, identity or arming', () => {
  const environment = visionProbeBuildEnvironment({ PATH: '/tools', HOME: '/temporary-home', DEVELOPER_DIR: '/other',
    GITHUB_TOKEN: 'fixture-secret', PHOTOBOOTH_SYNTHETIC_VISION_PROBE: 'OWNER_READY', PHOTOBOOTH_DEVELOPMENT_TEAM: 'OTHERTEAM0',
    XCODE_XCCONFIG_FILE: '/unexpected/config', DYLD_INSERT_LIBRARIES: '/unexpected/library' });
  assert.deepEqual(Object.keys(environment).sort(), ['CI', 'DEVELOPER_DIR', 'HOME', 'PATH', 'PHOTOBOOTH_SYNTHETIC_VISION_PROBE'].sort());
  assert.equal(environment.DEVELOPER_DIR, '/Applications/Xcode_26.3.app/Contents/Developer');
  assert.equal(environment.PHOTOBOOTH_SYNTHETIC_VISION_PROBE, 'NOT_ARMED');
});

test('public bounded build diagnostics redact synthetic credentials, links and contact details', () => {
  const value = sanitizeVisionProbeBuildLog('error: compiler type mismatch\nBearer fixture-token\nowner@example.invalid +15551234567 https://example.invalid/key?token=fixture\nsecret=fixture-never-public');
  assert.ok(value.includes('compiler type mismatch'));
  for (const secret of ['fixture-token', 'owner@example.invalid', '+15551234567', 'https://example.invalid', 'fixture-never-public']) assert.equal(value.includes(secret), false);
});

test('output removal requires a completed clean build and verified owned groups', () => {
  assert.equal(visionProbeCleanupDecision({ result: 'passed', quiescent: true, completedBuild: true, forced: false }).removeOutputs, true);
  for (const changes of [{ quiescent: false }, { quiescent: undefined }, { completedBuild: false }, { forced: true }, { result: 'failed' }]) {
    const decision = visionProbeCleanupDecision({ result: 'passed', quiescent: true, completedBuild: true, forced: false, ...changes });
    assert.equal(decision.removeOutputs, false); if (changes.quiescent !== undefined && !changes.quiescent) assert.equal(decision.result, 'failed');
  }
});

test('bounded command waits for owned descendants instead of treating parent exit as quiescence', { timeout: 20_000 }, async t => {
  const directory = temporary(t), records = new Set();
  const code = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();console.log('error: fixture-only');";
  const value = await runOwnedVisionProbeCommand({ name: 'fixture-descendant', binary: process.execPath, args: ['-e', code], cwd: directory,
    environment: process.env, diagnostics: directory, timeout: 3000, records });
  assert.equal(value.code, 0); const record = [...records][0];
  assert.equal(record.evidence.quiescent, true); assert.ok(record.evidence.signals.includes('SIGTERM'));
});

test('timeout stops and waits its owned group with a retained bounded failure log', { timeout: 20_000 }, async t => {
  const directory = temporary(t), records = new Set();
  await assert.rejects(runOwnedVisionProbeCommand({ name: 'fixture-timeout', binary: process.execPath,
    args: ['-e', "console.log('error: synthetic timeout');setInterval(()=>{},1000)"], cwd: directory, environment: process.env,
    diagnostics: directory, timeout: 120, records }), /timed out/);
  const record = [...records][0]; assert.equal(record.forced, true); assert.equal(record.evidence.quiescent, true);
  assert.equal(record.entry.timedOut, true); assert.ok(existsSync(join(directory, 'fixture-timeout.log')));
});

test('cancellation uses the same bounded owned-group stop path and cannot pass', { timeout: 20_000 }, async t => {
  const directory = temporary(t), records = new Set(); let cancelled = false;
  const completion = runOwnedVisionProbeCommand({ name: 'fixture-cancel', binary: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'], cwd: directory, environment: process.env, diagnostics: directory,
    timeout: 3000, records, isCancelled: () => cancelled });
  const timer = setTimeout(() => { cancelled = true; for (const record of records) record.interrupt(); }, 80);
  try { await assert.rejects(completion, /failed/); } finally { clearTimeout(timer); }
  const record = [...records][0]; assert.equal(record.forced, true); assert.equal(record.evidence.quiescent, true);
  assert.equal(record.entry.result, 'failed'); assert.equal(record.entry.timedOut, false);
});

test('unknown owned-writer state stays failed and cannot become clean compile evidence', async t => {
  const directory = temporary(t), records = new Set();
  await assert.rejects(runOwnedVisionProbeCommand({ name: 'fixture-unknown', binary: process.execPath, args: ['-e', ''], cwd: directory,
    environment: process.env, diagnostics: directory, timeout: 3000, records,
    stopGroup: async () => ({ quiescent: false, observation: 'fixture-unknown' }) }), /failed/);
  assert.equal([...records][0].evidence.quiescent, false); assert.equal([...records][0].entry.result, 'failed');
});

test('non-macOS refuses before preparation or external commands and reports zero execution', async t => {
  const temporaryDirectory = temporary(t), status = await buildIosVisionProbe({ repository: root, temporary: temporaryDirectory, platform: 'linux', emit: () => {} });
  assert.equal(status.result, 'failed'); assert.equal(status.testsExecuted, 0); assert.equal(status.ownerReady, false);
  assert.equal(status.deviceDiscovery, false); assert.equal(status.installation, false); assert.equal(status.stages.length, 0);
  assert.equal(status.processCleanup.outputsRemoved, false);
});

test('workflow is isolated opt-in standard ARM and uploads only compile diagnostics with finite bounds', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ios-vision-probe-build.yml'), 'utf8');
  assert.ok(workflow.includes('- codex/post-capture-face-effects')); assert.equal(workflow.includes('- codex/wedding-photobooth-mvp'), false);
  assert.ok(workflow.includes("contains(github.event.head_commit.message, '[native-vision-probe-build-ci]')"));
  for (const value of ['runs-on: macos-15', 'contents: read', 'ref: ${{ github.sha }}', 'persist-credentials: false',
    '/Applications/Xcode_26.3.app/Contents/Developer', 'node scripts/ci-build-ios-vision-probe.mjs']) assert.ok(workflow.includes(value));
  assert.equal(/npm ci|npx|cocoapods|simctl|devicectl|xcdevice|test-without-building|allowProvisioning|upload.*\.app/i.test(workflow), false);
  const total = VISION_PROBE_BUILD_LIMITS.preparationMs + VISION_PROBE_BUILD_LIMITS.buildMs + VISION_PROBE_BUILD_LIMITS.verificationMs + VISION_PROBE_BUILD_LIMITS.cleanupMs;
  assert.ok(total + 60_000 < VISION_PROBE_BUILD_LIMITS.stepMinutes * 60_000);
  assert.ok(VISION_PROBE_BUILD_LIMITS.stepMinutes + 3 < VISION_PROBE_BUILD_LIMITS.jobMinutes);
  assert.ok(workflow.includes('timeout-minutes: ' + VISION_PROBE_BUILD_LIMITS.stepMinutes));
  assert.ok(workflow.includes('timeout-minutes: ' + VISION_PROBE_BUILD_LIMITS.jobMinutes));
  assert.equal(workflow.includes('wedding-vision-probe-work-'), false);
  assert.ok(workflow.includes('Zero XCTest executions')); assert.ok(workflow.includes('No runner app or raw xctestrun is published'));
});
