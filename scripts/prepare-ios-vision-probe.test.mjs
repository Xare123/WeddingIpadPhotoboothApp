import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVisionProbe, verifyVisionProbe, VISION_PROBE_CI_RUNNER, VISION_PROBE_CI_TEAM,
  VISION_PROBE_FIXTURE_SHA, VISION_PROBE_METHOD, VISION_PROBE_SCHEME, VISION_PROBE_SOURCE_SHA, VISION_PROBE_TARGET } from './prepare-ios-vision-probe.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'wedding-vision-preparation-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
function configuration(t, overrides = {}) {
  return { repository, output: join(directory(t), 'private-probe'), runnerBundleID: 'com.owner.booth.physicaltests.xctrunner',
    developmentTeam: 'OWNERTEAM1', reuseExistingRunner: true, ...overrides };
}
const schemePath = plan => join(plan.project, 'xcshareddata/xcschemes', plan.scheme + '.xcscheme');
function files(plan) { return { graph: readFileSync(join(plan.project, 'project.pbxproj'), 'utf8'), scheme: readFileSync(schemePath(plan), 'utf8') }; }

test('the independently reviewed source graph is pinned and contains no application or capture rehearsal', t => {
  const plan = prepareVisionProbe(configuration(t));
  assert.equal(plan.sources.length, 5); assert.equal(plan.resources.length, 1);
  assert.equal(plan.sources.at(-1).sha256, VISION_PROBE_SOURCE_SHA);
  assert.match(VISION_PROBE_SOURCE_SHA, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.sources.map(item => item.generated.split('/').at(-1)).sort(), [
    'AppleFaceEffects.swift', 'FaceGeometry.swift', 'FrameFreshnessGate.swift', 'PhotoEffectsEngine.swift', VISION_PROBE_TARGET + '.swift',
  ].sort());
  assert.equal(plan.resources[0].sha256, VISION_PROBE_FIXTURE_SHA);
  assert.equal(statSync(join(plan.output, 'Sources/separated-portrait.png')).size, 2_150_366);
  assert.deepEqual(readdirSync(join(plan.output, 'Sources')).sort(), [...plan.sources, ...plan.resources].map(item => item.generated.split('/').at(-1)).sort());
  const { graph, scheme } = files(plan);
  assert.equal((graph.match(/isa = PBXNativeTarget;/g) ?? []).length, 1);
  assert.match(graph, /productType = "com\.apple\.product-type\.bundle\.ui-testing"/);
  for (const forbidden of ['com.apple.product-type.application', 'PBXTargetDependency', 'PBXShellScriptBuildPhase', 'UITargetAppPath', 'TEST_HOST', 'BUNDLE_LOADER', 'TEST_TARGET_NAME']) assert.equal(graph.includes(forbidden), false);
  assert.match(graph, /CODE_SIGNING_ALLOWED = "NO"/); assert.match(graph, /CODE_SIGNING_REQUIRED = "NO"/);
  assert.match(graph, /COMPRESS_PNG_FILES = "NO"/);
  assert.match(graph, /STRIP_PNG_TEXT = "NO"/);
  assert.match(graph, /explicitFileTypes = \{ "separated-portrait\.png" = file; \}/);
  assert.equal(scheme.includes('<LaunchAction'), false);
  assert.equal(plan.sourcePreparationOnly, true); assert.equal(plan.signingAllowed, false);
  assert.equal(plan.applicationTarget, false); assert.equal(plan.physicalExecution, false);
  assert.equal(verifyVisionProbe(plan, repository).sourceGraphVerified, true);
});

test('readiness is in the test action, selected to one method, and remains NOT_ARMED despite an inherited readiness signal', t => {
  const plan = prepareVisionProbe(configuration(t, { readinessSignal: 'OWNER_READY' }));
  const { scheme } = files(plan);
  const parsed = spawnSync('python3', ['-c', 'import json,sys,xml.etree.ElementTree as E;r=E.parse(sys.argv[1]).getroot();a=r.find("TestAction");print(json.dumps({"inherit":a.get("shouldUseLaunchSchemeArgsEnv"),"selection":[e.get("Identifier") for e in a.findall("Testables/TestableReference/SelectedTests/Test")],"env":{e.get("key"):e.get("value") for e in a.findall("EnvironmentVariables/EnvironmentVariable")}}))', schemePath(plan)], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(JSON.parse(parsed.stdout), { inherit: 'NO', selection: [VISION_PROBE_TARGET + '/' + VISION_PROBE_METHOD], env: {
    PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID: plan.runnerBundleID, PHOTOBOOTH_SYNTHETIC_VISION_PROBE: 'NOT_ARMED',
  } });
  assert.equal(plan.ownerReady, false); assert.equal(scheme.includes('value="OWNER_READY"'), false);
});

test('real preparation requires explicit acknowledgement of an existing identity and never supplies a default', t => {
  const invalid = [
    { reuseExistingRunner: false }, { runnerBundleID: undefined }, { runnerBundleID: 'com.example.booth.physicaltests.xctrunner' },
    { runnerBundleID: VISION_PROBE_CI_RUNNER }, { runnerBundleID: 'com.owner.booth.newrunner' }, { runnerBundleID: 'com.owner.booth.physicaltests.xctrunner\n' },
    { developmentTeam: undefined }, { developmentTeam: 'bad' }, { ownerReady: 'true' }, { unsignedFixture: 'true' },
  ];
  for (const override of invalid) {
    const config = configuration(t, override); assert.throws(() => prepareVisionProbe(config)); assert.equal(existsSync(config.output), false);
  }
});

test('arming requires both the explicit flag and owner readiness, and CI fixtures cannot be armed', t => {
  for (const readinessSignal of [undefined, 'NOT_ARMED', 'OWNER_READY\n']) {
    const config = configuration(t, { ownerReady: true, readinessSignal });
    assert.throws(() => prepareVisionProbe(config), /readiness/); assert.equal(existsSync(config.output), false);
  }
  const armed = prepareVisionProbe(configuration(t, { ownerReady: true, readinessSignal: 'OWNER_READY' }));
  assert.equal(armed.readinessInTestAction, 'OWNER_READY'); assert.match(files(armed).scheme, /value="OWNER_READY"/);
  const fixture = { runnerBundleID: VISION_PROBE_CI_RUNNER, developmentTeam: VISION_PROBE_CI_TEAM, unsignedFixture: true, reuseExistingRunner: false };
  const unarmed = prepareVisionProbe(configuration(t, { ...fixture, readinessSignal: 'OWNER_READY' }));
  assert.equal(unarmed.ownerReady, false); assert.equal(unarmed.readinessInTestAction, 'NOT_ARMED');
  for (const override of [{ ownerReady: true, readinessSignal: 'OWNER_READY' }, { runnerBundleID: 'com.owner.booth.physicaltests.xctrunner' }, { developmentTeam: 'OWNERTEAM1' }]) {
    assert.throws(() => prepareVisionProbe(configuration(t, { ...fixture, ...override })), /cannot be armed/);
  }
});

test('existing output and symlink aliases into public source cannot overwrite work or leak configuration', t => {
  const config = configuration(t); mkdirSync(config.output); writeFileSync(join(config.output, 'preserved'), 'original');
  assert.throws(() => prepareVisionProbe(config), /already exists/); assert.equal(readFileSync(join(config.output, 'preserved'), 'utf8'), 'original');
  for (const kind of ['public', 'cache', 'cache-child', 'external']) {
    const base = directory(t), repo = join(base, 'repository'), artifacts = join(repo, 'artifacts'), cache = join(repo, '.cache');
    mkdirSync(artifacts, { recursive: true }); let output = join(artifacts, 'new');
    if (kind === 'cache') { symlinkSync(artifacts, cache); output = join(cache, 'new'); }
    if (kind === 'cache-child') { mkdirSync(cache); symlinkSync(artifacts, join(cache, 'alias')); output = join(cache, 'alias/new'); }
    if (kind === 'external') { symlinkSync(artifacts, join(base, 'alias')); output = join(base, 'alias/new'); }
    assert.throws(() => prepareVisionProbe(configuration(t, { repository: repo, output })), /private directory/);
    assert.equal(existsSync(join(artifacts, 'new')), false);
  }
});

test('private preparation files are owner-only and copy only the allowlisted fixture and sources', t => {
  const plan = prepareVisionProbe(configuration(t));
  assert.equal(statSync(plan.output).mode & 0o777, 0o700);
  assert.equal(statSync(join(plan.output, 'vision-probe-plan.json')).mode & 0o777, 0o600);
  for (const item of [...plan.sources, ...plan.resources]) assert.equal(statSync(join(plan.output, item.generated)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(plan.output).sort(), ['Sources', VISION_PROBE_SCHEME + '.xcodeproj', 'vision-probe-plan.json'].sort());
});

test('source and fixture drift fail before any output is created', t => {
  const reference = prepareVisionProbe(configuration(t));
  for (const changed of [reference.sources[0], reference.sources.at(-1), reference.resources[0]]) {
    const base = directory(t), repo = join(base, 'repository');
    for (const item of [...reference.sources, ...reference.resources]) {
      mkdirSync(dirname(join(repo, item.source)), { recursive: true }); copyFileSync(join(repository, item.source), join(repo, item.source));
    }
    writeFileSync(join(repo, changed.source), 'unexpected input');
    const config = configuration(t, { repository: repo });
    assert.throws(() => prepareVisionProbe(config), /source changed|fixture/);
    assert.equal(existsSync(config.output), false);
  }
});

test('verification rejects changed copies, extra sources and even rehashed application dependencies or arming changes', t => {
  for (const kind of ['source', 'resource', 'extra', 'symlink', 'app-target', 'signing', 'png-metadata', 'png-filetype', 'scheme']) {
    const plan = prepareVisionProbe(configuration(t));
    if (kind === 'source') writeFileSync(join(plan.output, plan.sources[0].generated), 'changed source');
    if (kind === 'resource') writeFileSync(join(plan.output, plan.resources[0].generated), 'changed fixture');
    if (kind === 'extra') writeFileSync(join(plan.output, 'Sources/Unexpected.swift'), 'import Foundation');
    if (kind === 'symlink') {
      const path = join(plan.output, plan.resources[0].generated); rmSync(path); symlinkSync(join(repository, plan.resources[0].source), path);
    }
    if (['app-target', 'signing', 'png-metadata', 'png-filetype'].includes(kind)) {
      const path = join(plan.project, 'project.pbxproj'); let graph = readFileSync(path, 'utf8');
      if (kind === 'app-target') graph = graph.replace('dependencies = ();', 'dependencies = (SOME_APP); /* PBXTargetDependency */');
      if (kind === 'signing') graph = graph.replace('CODE_SIGNING_ALLOWED = "NO"', 'CODE_SIGNING_ALLOWED = "YES"');
      if (kind === 'png-metadata') graph = graph.replace('STRIP_PNG_TEXT = "NO"', 'STRIP_PNG_TEXT = "YES"');
      if (kind === 'png-filetype') graph = graph.replace('"separated-portrait.png" = file;', '"separated-portrait.png" = image.png;');
      writeFileSync(path, graph); plan.projectSHA256 = digest(graph);
    }
    if (kind === 'scheme') {
      const path = schemePath(plan), scheme = readFileSync(path, 'utf8').replace('value="NOT_ARMED"', 'value="OWNER_READY"');
      writeFileSync(path, scheme); plan.schemeSHA256 = digest(scheme);
    }
    assert.throws(() => verifyVisionProbe(plan, repository), /changed|Unexpected|boundary/);
  }
});

test('CLI preparation stays unarmed and does not copy unrelated credentials or environment values', t => {
  const output = join(directory(t), 'cli-probe');
  const cli = spawnSync(process.execPath, [join(repository, 'scripts/prepare-ios-vision-probe.mjs'), output, '--reuse-existing-runner'], {
    encoding: 'utf8', env: { ...process.env, PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID: 'com.owner.booth.physicaltests.xctrunner',
      PHOTOBOOTH_DEVELOPMENT_TEAM: 'OWNERTEAM1', PHOTOBOOTH_SYNTHETIC_VISION_PROBE: 'OWNER_READY',
      PHOTOBOOTH_DEVICE_TOKEN: 'never-copy-this-sentinel' },
  });
  assert.equal(cli.status, 0, cli.stderr);
  const status = JSON.parse(cli.stdout); assert.equal(status.ownerReady, false); assert.equal(status.physicalExecution, false);
  assert.equal(cli.stdout.includes('OWNERTEAM1'), false); assert.equal(cli.stdout.includes('com.owner.booth'), false);
  const plan = JSON.parse(readFileSync(join(output, 'vision-probe-plan.json'), 'utf8'));
  for (const path of [join(output, 'vision-probe-plan.json'), join(plan.project, 'project.pbxproj'), schemePath(plan)]) {
    assert.equal(readFileSync(path, 'utf8').includes('never-copy-this-sentinel'), false);
  }
});

test('probe runtime fails closed and cannot access the wedding app, camera, Photos, network or session storage', () => {
  const source = readFileSync(join(repository, 'apps/ipad/native-tests', VISION_PROBE_TARGET + '.swift'), 'utf8');
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((code.match(/func test\w+\(/g) ?? []).length, 1);
  assert.match(code, /throw Stop\.unsupportedRuntime/); assert.match(code, /throw Stop\.notArmed/);
  assert.equal(code.includes('XCTSkip'), false);
  for (const forbidden of ['XCUIApplication', 'AVCapture', 'PHPhotoLibrary', 'PhotosPicker', 'URLSession', 'FileManager', 'documentDirectory', 'UserDefaults', 'Keychain', 'print(', 'takeScreenshot']) assert.equal(code.includes(forbidden), false, forbidden);
  assert.ok(code.indexOf('name: "warm1"') < code.indexOf('name: "warm2"'));
  assert.ok(code.indexOf('name: "warm2"') < code.indexOf('name: "bw"'));
  assert.match(code, /XCTWaiter\(\)\.wait/);
  assert.match(code, /systemUptime \+ 150/);
  assert.match(code, /inFlight\.wait\(timeout: \.now\(\) \+ 5\)/);
});
