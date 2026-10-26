import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { preparePhysicalTests, PHYSICAL_SCHEME, PHYSICAL_TARGET, REVIEWED_APPLICATION_COMMIT } from './prepare-ios-physical-tests.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = data => createHash('sha256').update(data).digest('hex');
function directory(t) { const path = mkdtempSync(join(tmpdir(), 'wedding-physical-prep-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function configuration(t, other = {}) { return { repository: root, output: join(directory(t), 'new'), appBundleID: 'org.fixture.weddingbooth', developmentTeam: 'TESTTEAM01', ...other }; }
function scheme(plan) { return readFileSync(join(plan.project, 'xcshareddata/xcschemes', PHYSICAL_SCHEME + '.xcscheme'), 'utf8'); }
function testEnvironment(text) {
  const result = spawnSync('python3', ['-c', 'import sys,json,xml.etree.ElementTree as E; r=E.fromstring(sys.stdin.read()); t=r.find("TestAction"); print(json.dumps({"variables":{v.attrib["key"]:v.attrib["value"] for v in t.findall("EnvironmentVariables/EnvironmentVariable") if v.attrib.get("isEnabled")=="YES"},"inheritsLaunch":t.attrib.get("shouldUseLaunchSchemeArgsEnv"),"launchAction":r.find("LaunchAction") is not None}))'], { input: text, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}

test('new private project contains only a folder-synchronized UI runner and exact copied source; signing stays disabled', t => {
  const c = configuration(t), source = readFileSync(join(root, 'apps/ipad/native-tests', PHYSICAL_TARGET + '.swift'));
  const plan = preparePhysicalTests(c), graph = readFileSync(join(plan.project, 'project.pbxproj'), 'utf8');
  assert.equal((graph.match(/isa = PBXNativeTarget;/g) ?? []).length, 1);
  assert.ok(graph.includes('com.apple.product-type.bundle.ui-testing'));
  assert.ok(graph.includes('PBXFileSystemSynchronizedRootGroup')); assert.ok(graph.includes('fileSystemSynchronizedGroups'));
  assert.equal(/com\.apple\.product-type\.application|PBXTargetDependency|UITargetAppPath|TEST_TARGET_NAME|TEST_HOST|BUNDLE_LOADER|PBXShellScriptBuildPhase/.test(graph), false);
  assert.ok(graph.includes('CODE_SIGNING_ALLOWED = "NO"'));
  assert.equal(plan.applicationTarget, false); assert.equal(plan.sourcePreparationOnly, true);
  assert.equal(plan.applicationSourceCommit, REVIEWED_APPLICATION_COMMIT);
  assert.equal(plan.runnerBundleID, c.appBundleID + '.physicaltests.xctrunner');
  assert.equal(statSync(c.output).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(join(c.output, 'Sources', PHYSICAL_TARGET + '.swift')), source);
  assert.equal(plan.sourceSHA256, digest(source)); assert.equal(plan.projectSHA256, digest(graph));
});

test('inherited readiness never arms by default and only explicit TestAction variables are forwarded', t => {
  const c = configuration(t, { readinessSignal: 'OWNER_READY' }), plan = preparePhysicalTests(c), env = testEnvironment(scheme(plan));
  assert.equal(plan.ownerReady, false);
  assert.deepEqual(env.variables, { PHOTOBOOTH_APP_BUNDLE_ID: c.appBundleID, PHOTOBOOTH_PHYSICAL_REHEARSAL: 'NOT_ARMED' });
  assert.equal(env.inheritsLaunch, 'NO'); assert.equal(env.launchAction, false);
});

test('explicit readiness reaches the actual TestAction only with the readiness signal', t => {
  const c = configuration(t, { ownerReady: true, readinessSignal: 'OWNER_READY' }), plan = preparePhysicalTests(c);
  assert.equal(testEnvironment(scheme(plan)).variables.PHOTOBOOTH_PHYSICAL_REHEARSAL, 'OWNER_READY');
  for (const readinessSignal of [undefined, '', 'yes', 'NOT_ARMED']) {
    const denied = configuration(t, { ownerReady: true, readinessSignal });
    assert.throws(() => preparePhysicalTests(denied), /Arming needs both/); assert.equal(existsSync(denied.output), false);
  }
});

test('CLI requires the explicit arming argument and never copies unrelated process values', t => {
  for (const armed of [false, true]) {
    const c = configuration(t), args = [join(root, 'scripts/prepare-ios-physical-tests.mjs'), c.output, ...(armed ? ['--owner-ready'] : [])];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PHOTOBOOTH_APP_BUNDLE_ID: c.appBundleID, PHOTOBOOTH_DEVELOPMENT_TEAM: c.developmentTeam,
        PHOTOBOOTH_PHYSICAL_REHEARSAL: 'OWNER_READY', PHOTOBOOTH_UNRELATED_SECRET: 'fixture-value-never-forward' } });
    assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout), text = scheme(plan);
    assert.equal(testEnvironment(text).variables.PHOTOBOOTH_PHYSICAL_REHEARSAL, armed ? 'OWNER_READY' : 'NOT_ARMED');
    assert.equal(text.includes('fixture-value-never-forward'), false);
  }
});

test('invalid identity, public destination and existing outputs are refused before overwriting anything', t => {
  for (const other of [{ appBundleID: '' }, { appBundleID: 'com.example.booth' }, { appBundleID: 'org.fixture/escape' },
    { developmentTeam: 'unknown' }, { developmentTeam: '' }, { ownerReady: 'yes' }, { output: join(root, 'artifacts/never-write-physical-project') }]) {
    const c = configuration(t, other); assert.throws(() => preparePhysicalTests(c)); assert.equal(existsSync(c.output), false);
  }
  const c = configuration(t); mkdirSync(c.output); writeFileSync(join(c.output, 'preserved.txt'), 'keep');
  assert.throws(() => preparePhysicalTests(c), /already exists/); assert.equal(readFileSync(join(c.output, 'preserved.txt'), 'utf8'), 'keep');
});

test('a later app version or changed accessibility source requires a new review', t => {
  const repository = join(directory(t), 'repository');
  for (const name of ['apps/ipad/app.json', 'apps/ipad/App.tsx', 'apps/ipad/src/TimingSheet.tsx', 'apps/ipad/native-tests/' + PHYSICAL_TARGET + '.swift']) {
    mkdirSync(dirname(join(repository, name)), { recursive: true }); copyFileSync(join(root, name), join(repository, name));
  }
  writeFileSync(join(repository, 'apps/ipad/App.tsx'), 'changed interface');
  assert.throws(() => preparePhysicalTests(configuration(t, { repository })), /accessibility source changed/);
  copyFileSync(join(root, 'apps/ipad/App.tsx'), join(repository, 'apps/ipad/App.tsx'));
  const config = JSON.parse(readFileSync(join(repository, 'apps/ipad/app.json'))); config.expo.version = '0.3.5';
  writeFileSync(join(repository, 'apps/ipad/app.json'), JSON.stringify(config));
  assert.throws(() => preparePhysicalTests(configuration(t, { repository })), /new app version/);
});

test('cache, cache-child and external aliases cannot redirect generated identity data into public artifacts', t => {
  for (const kind of ['cache', 'cache-child', 'external']) {
    const base = directory(t), repository = join(base, 'repository');
    const artifacts = join(repository, 'artifacts'), cache = join(repository, '.cache');
    mkdirSync(artifacts, { recursive: true });
    let output;
    if (kind === 'cache') { symlinkSync(artifacts, cache); output = join(cache, 'new'); }
    if (kind === 'cache-child') {
      mkdirSync(cache); symlinkSync(artifacts, join(cache, 'redirect')); output = join(cache, 'redirect', 'new');
    }
    if (kind === 'external') { symlinkSync(artifacts, join(base, 'alias')); output = join(base, 'alias', 'new'); }
    assert.throws(() => preparePhysicalTests(configuration(t, { repository, output })), /private directory/);
    assert.equal(existsSync(join(artifacts, 'new')), false);
  }
});

test('rehearsal source protects existing sessions and stops on save/permission interruptions before any relaunch', () => {
  const source = readFileSync(join(root, 'apps/ipad/native-tests', PHYSICAL_TARGET + '.swift'), 'utf8');
  assert.equal((source.match(/func test\w+\(/g) ?? []).length, 1);
  assert.ok(source.includes('targetEnvironment(simulator)'));
  assert.ok(source.includes('element("start-session").exists'));
  assert.ok(source.includes('element("retry-save").exists'));
  assert.ok(source.includes('label.hasPrefix("Continue")'));
  const testBody = source.slice(source.indexOf('func testFourPhysicalCapturesReviewAndRelaunch'));
  assert.ok(testBody.indexOf('try requireFourSavedPhotos()') < testBody.indexOf('booth.terminate()'));
  for (const forbidden of ['tap("next-guest")', 'tap("host-controls")', 'tap("confirm-session")', 'launchEnvironment', 'launchArguments', 'XCTAttachment']) {
    assert.equal(source.includes(forbidden), false);
  }
  const app = readFileSync(join(root, 'apps/ipad/App.tsx'), 'utf8');
  for (const id of ['start-session', 'allow-camera', 'take-photo', 'capture-framing-hint', 'timing-chip', 'review-gallery', 'retry-save', 'photo-preview']) {
    assert.ok(app.includes('"' + id + '"') || app.includes("'" + id + "'"), 'Current application is missing ' + id);
  }
});
