import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandStreams, parseNamedJSON, requireSwiftTools62, stopOwnedProcessGroup } from './ci-native-contract.mjs';
import { annotationText, bounded, diagnosticLines, redact, workflowData } from './ci-summary.mjs';

export const VISION_PROBE_BUILD_LIMITS = Object.freeze({ preparationMs: 3 * 60_000, buildMs: 12 * 60_000,
  verificationMs: 3 * 60_000, cleanupMs: 60_000, stepMinutes: 22, jobMinutes: 30 });
export const CI_VISION_PROBE = Object.freeze({ scheme: 'WeddingPhotoboothSyntheticVisionProbe',
  target: 'WeddingPhotoboothSyntheticVisionProbeTests', method: 'testOwnerArmedSyntheticVisionOnPhysicalIPad',
  runnerBundleID: 'org.fixture.weddingbooth.physicaltests.xctrunner',
  testBundleID: 'org.fixture.weddingbooth.physicaltests', developmentTeam: 'TESTTEAM01',
  fixtureSHA256: 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedIdentifier = [CI_VISION_PROBE.target, CI_VISION_PROBE.target, CI_VISION_PROBE.method].join('/');

export function requireCiVisionProbePlan(plan) {
  if (!plan || plan.scheme !== CI_VISION_PROBE.scheme || plan.target !== CI_VISION_PROBE.target ||
    plan.testClass !== CI_VISION_PROBE.target || plan.method !== CI_VISION_PROBE.method || plan.testIdentifier !== expectedIdentifier ||
    plan.runnerBundleID !== CI_VISION_PROBE.runnerBundleID || plan.testBundleID !== CI_VISION_PROBE.testBundleID ||
    plan.developmentTeam !== CI_VISION_PROBE.developmentTeam || plan.unsignedFixture !== true || plan.ownerReady !== false ||
    plan.readinessInTestAction !== 'NOT_ARMED' || plan.sourcePreparationOnly !== true || plan.signingAllowed !== false ||
    plan.applicationTarget !== false || plan.physicalExecution !== false || plan.fixtureSHA256 !== CI_VISION_PROBE.fixtureSHA256 ||
    typeof plan.project !== 'string' || !isAbsolute(plan.project) || typeof plan.output !== 'string' ||
    plan.project !== join(resolve(plan.output), CI_VISION_PROBE.scheme + '.xcodeproj') ||
    !Array.isArray(plan.sources) || plan.sources.length !== 5 || !Array.isArray(plan.resources) || plan.resources.length !== 1 ||
    [...plan.sources, ...plan.resources].some(input => typeof input?.source !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.sha256 ?? ''))) throw new Error('Unsigned probe build requires the exact fixed NOT_ARMED CI plan');
  return plan;
}

export function visionProbeBuildArguments(plan, derivedData) {
  requireCiVisionProbePlan(plan);
  if (typeof derivedData !== 'string' || !isAbsolute(derivedData)) throw new Error('Owned derived-data path must be absolute');
  return ['-project', plan.project, '-scheme', plan.scheme, '-configuration', 'Release', '-sdk', 'iphoneos',
    '-destination', 'generic/platform=iOS', '-derivedDataPath', derivedData,
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=',
    '-only-testing:' + expectedIdentifier, '-parallel-testing-enabled', 'NO', '-jobs', '3', 'build-for-testing'];
}

export function visionProbeSettingsArguments(plan) {
  requireCiVisionProbePlan(plan);
  // A testing-only scheme is not eligible for the implicit default build action.
  return ['-project', plan.project, '-target', plan.target, '-configuration', 'Release', '-sdk', 'iphoneos',
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', '-showBuildSettings', '-json'];
}

export function requireVisionProbeSettings(value, plan) {
  requireCiVisionProbePlan(plan);
  const settings = Array.isArray(value) && value.length === 1 && value[0]?.target === plan.target ? value[0].buildSettings : undefined;
  if (!settings || settings.PRODUCT_TYPE !== 'com.apple.product-type.bundle.ui-testing' ||
    settings.PRODUCT_BUNDLE_IDENTIFIER !== plan.testBundleID || settings.CONFIGURATION !== 'Release' ||
    !/^iphoneos[0-9.]+$/.test(settings.SDK_NAME ?? '') || settings.CODE_SIGNING_ALLOWED !== 'NO' ||
    settings.CODE_SIGNING_REQUIRED !== 'NO' || settings.COMPRESS_PNG_FILES !== 'NO' || settings.STRIP_PNG_TEXT !== 'NO' ||
    ['TEST_TARGET_NAME', 'TEST_HOST', 'BUNDLE_LOADER', 'UITargetAppPath', 'UITEST_TARGET_APP_PATH']
      .some(key => String(settings[key] ?? '').trim())) throw new Error('Xcode settings did not confirm the independent unsigned physical-SDK UI-test target');
  return { sdk: settings.SDK_NAME, configuration: 'Release', productType: settings.PRODUCT_TYPE,
    applicationDependency: false, signingAllowed: false, pngCompression: false, pngTextStripping: false };
}

function canonicalProbeCase(value, plan) {
  if (typeof value !== 'string' || value.length > 400) throw new Error('Unsupported selected probe identity');
  const components = value.replace(/\(\)$/, '').split('/');
  if (components.length === 3 && components[0] === plan.target) components.shift();
  if (components.length !== 2 || components[0] !== plan.testClass || components[1] !== plan.method) throw new Error('Unexpected selected probe class or method');
  return plan.testIdentifier;
}

function containsArmedValue(value, depth = 0, budget = { remaining: 2000 }) {
  if (--budget.remaining < 0 || depth > 16) throw new Error('Probe xctestrun exceeds structural bounds');
  if (value === 'OWNER_READY') return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(child => containsArmedValue(child, depth + 1, budget));
}

export function inspectVisionProbeXctestrun(value, plan) {
  requireCiVisionProbePlan(plan);
  if (!value || typeof value !== 'object' || Array.isArray(value) || containsArmedValue(value)) throw new Error('Probe xctestrun is unsupported or armed');
  const format = value.__xctestrun_metadata__?.FormatVersion;
  let targets;
  if (format === 2) {
    if (!Array.isArray(value.TestConfigurations) || value.TestConfigurations.length !== 1 ||
      value.TestConfigurations[0]?.IsEnabled === false || !Array.isArray(value.TestConfigurations[0]?.TestTargets)) throw new Error('Probe needs one enabled test configuration');
    targets = value.TestConfigurations[0].TestTargets;
  } else if (format === 1) {
    targets = Object.entries(value).filter(([key]) => key !== '__xctestrun_metadata__').map(([, target]) => target);
  } else throw new Error('Unsupported probe xctestrun format');
  const target = targets.length === 1 ? targets[0] : undefined;
  if (!target || typeof target !== 'object' || target.BlueprintName !== plan.target || target.IsUITestBundle !== true ||
    (target.TestHostBundleIdentifier !== undefined && target.TestHostBundleIdentifier !== plan.runnerBundleID) ||
    (target.TestBundleIdentifier !== undefined && target.TestBundleIdentifier !== plan.testBundleID) ||
    ['UITargetAppPath', 'UITargetAppBundleIdentifier', 'TargetApplicationBundleID'].some(key => String(target[key] ?? '').trim()) ||
    typeof target.TestHostPath !== 'string' || typeof target.TestBundlePath !== 'string' ||
    !Array.isArray(target.OnlyTestIdentifiers) || target.OnlyTestIdentifiers.length !== 1 ||
    (target.SkipTestIdentifiers !== undefined && (!Array.isArray(target.SkipTestIdentifiers) || target.SkipTestIdentifiers.length))) {
    throw new Error('Probe xctestrun must contain only the selected fixture UI-test target without an application dependency');
  }
  canonicalProbeCase(target.OnlyTestIdentifiers[0], plan);
  const environment = target.EnvironmentVariables;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) ||
    environment.PHOTOBOOTH_SYNTHETIC_VISION_PROBE !== 'NOT_ARMED' ||
    environment.PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID !== plan.runnerBundleID ||
    Object.keys(environment).some(key => key.startsWith('PHOTOBOOTH_') &&
      !['PHOTOBOOTH_SYNTHETIC_VISION_PROBE', 'PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID'].includes(key))) {
    throw new Error('Built probe readiness and fake runner environment are not the exact NOT_ARMED CI defaults');
  }
  if (target.DependentProductPaths !== undefined && (!Array.isArray(target.DependentProductPaths) ||
    target.DependentProductPaths.some(path => typeof path !== 'string' || (path.endsWith('.app') && path !== target.TestHostPath)))) {
    throw new Error('Probe xctestrun contains an external application dependency');
  }
  return { format, testTargets: 1, selectedTest: plan.testIdentifier, readiness: 'NOT_ARMED', ownerReady: false,
    applicationDependency: false, testHostPath: target.TestHostPath, testBundlePath: target.TestBundlePath };
}

function inside(parent, child) { const path = relative(parent, child); return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path); }
export function ownedVisionProbePath(products, input, testHost) {
  if (lstatSync(products).isSymbolicLink()) throw new Error('Built products root cannot be a symlink');
  const root = realpathSync(products);
  if (typeof input !== 'string' || !input || input.length > 2048 || input.includes('\\') || input.includes('\0')) throw new Error('Invalid built probe path');
  let path = input;
  if (path.startsWith('__TESTROOT__/')) path = join(root, path.slice('__TESTROOT__/'.length));
  else if (path.startsWith('__TESTHOST__/') && typeof testHost === 'string') path = join(testHost, path.slice('__TESTHOST__/'.length));
  if (path.includes('__') || !isAbsolute(path) || !inside(root, resolve(path))) throw new Error('Built probe path escapes its owned products');
  let cursor = root;
  for (const component of relative(root, resolve(path)).split(sep)) {
    cursor = join(cursor, component);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Built probe symlinks are not allowed');
  }
  const canonical = realpathSync(path);
  if (!inside(root, canonical)) throw new Error('Built probe path escapes its owned products');
  return canonical;
}

export function verifyVisionProbeProducts({ products, xctestrun, plan, runnerInfo, testInfo, recordBuiltFixture = () => {} }) {
  const proof = inspectVisionProbeXctestrun(xctestrun, plan);
  const runner = ownedVisionProbePath(products, proof.testHostPath);
  const testBundle = ownedVisionProbePath(products, proof.testBundlePath, runner);
  if (!runner.endsWith('/' + plan.target + '-Runner.app') || !testBundle.endsWith('/PlugIns/' + plan.target + '.xctest') ||
    !inside(runner, testBundle) || !lstatSync(runner).isDirectory() || !lstatSync(testBundle).isDirectory() ||
    runnerInfo?.CFBundleIdentifier !== plan.runnerBundleID || testInfo?.CFBundleIdentifier !== plan.testBundleID) {
    throw new Error('Built probe runner/test bundle identity or ownership mismatch');
  }
  const fixture = ownedVisionProbePath(products, join(testBundle, 'separated-portrait.png'));
  const state = lstatSync(fixture);
  const bytes = state.isFile() && state.size > 0 && state.size <= 8 * 1024 * 1024 ? readFileSync(fixture) : undefined;
  const builtFixture = { bytes: Number.isSafeInteger(state.size) && state.size >= 0 ? state.size : null,
    sha256: bytes ? digest(bytes) : null, pngSignatureHex: bytes ? bytes.subarray(0, 8).toString('hex') : null };
  // Record only bounded numeric/hash/signature facts before exact-byte acceptance;
  // a changed fixture must leave useful failure evidence without publishing it.
  recordBuiltFixture(builtFixture);
  if (!state.isFile() || builtFixture.bytes !== 2_150_366 || builtFixture.sha256 !== plan.fixtureSHA256 ||
    builtFixture.pngSignatureHex !== '89504e470d0a1a0a') throw new Error('Built probe PNG differs from the exact uncompressed generated fixture');
  return { ...proof, testHostPath: undefined, testBundlePath: undefined, runnerBundleID: plan.runnerBundleID,
    testBundleID: plan.testBundleID, fixtureSHA256: plan.fixtureSHA256, fixtureBytes: state.size,
    fixtureVerified: true, builtFixture, signingAllowed: false, compileOnly: true, testsExecuted: 0 };
}

export function visionProbeCleanupDecision({ result, quiescent, completedBuild, forced }) {
  return { result: result === 'passed' && !quiescent ? 'failed' : result,
    cleanupVerified: quiescent === true, removeOutputs: result === 'passed' && quiescent === true && completedBuild === true && forced === false };
}

export function visionProbeBuildEnvironment(source) {
  const environment = { CI: '1', DEVELOPER_DIR: '/Applications/Xcode_26.3.app/Contents/Developer',
    PHOTOBOOTH_SYNTHETIC_VISION_PROBE: 'NOT_ARMED' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) if (typeof source[key] === 'string') environment[key] = source[key];
  return environment;
}

export function sanitizeVisionProbeBuildLog(text) {
  return redact(String(text)).replace(/(?:https?|file):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted email]')
    .replace(/\b(?:token|secret|password|api[_-]?key|authorization)\s*[=:]\s*[^\r\n]*/gi, '[redacted credential]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export async function runOwnedVisionProbeCommand({ name, binary, args, cwd, environment, diagnostics, timeout,
  structured = false, records = new Set(), isCancelled = () => false, stopGroup = stopOwnedProcessGroup }) {
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(name) || !Number.isFinite(timeout) || timeout <= 0 || timeout > VISION_PROBE_BUILD_LIMITS.buildMs) throw new Error('Invalid bounded probe command');
  const lines = [], pending = { stdout: '', stderr: '' }, started = Date.now();
  const collect = (chunk, stream) => {
    if (structured && stream === 'stdout') return;
    pending[stream] += chunk.toString();
    const complete = pending[stream].split('\n'); pending[stream] = complete.pop().slice(-8000);
    for (const line of complete) { lines.push(sanitizeVisionProbeBuildLog(line).slice(-4000)); if (lines.length > 500) lines.shift(); }
  };
  const child = spawn(binary, args, { cwd, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, forced: false }; records.add(record);
  record.stop = () => record.stopping ??= (Number.isSafeInteger(child.pid)
    ? stopGroup(child) : Promise.resolve({ quiescent: true, observation: 'spawn-failed' }))
    .then(value => { record.evidence = value; return value; })
    .catch(error => { record.evidence = error.processGroup ?? { quiescent: false, observation: 'unavailable' }; throw error; });
  const streams = commandStreams(name, { captureStdout: structured, stdoutLimit: 1024 * 1024, onLog: collect });
  return new Promise((resolveCommand, reject) => {
    let settled = false, timedOut = false, streamError, fallback;
    const finish = async (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(fallback);
      let stopError; try { await record.stop(); if (record.evidence?.quiescent !== true) stopError = new Error('Owned process cleanup remained unverified'); } catch (error) { stopError = error; }
      for (const tail of Object.values(pending)) if (tail) lines.push(sanitizeVisionProbeBuildLog(tail).slice(-4000));
      const output = bounded(lines.join('\n'), 500, 128_000);
      writeFileSync(join(diagnostics, name + '.log'), output + '\n');
      record.entry = { name, exitCode: code, signal: signal ?? null, timedOut, seconds: Math.round((Date.now() - started) / 1000), processGroup: record.evidence };
      child.stdout.destroy(); child.stderr.destroy(); if (child.exitCode === null && child.signalCode === null) child.unref();
      if (timedOut || streamError || stopError || isCancelled() || code !== 0 || signal) {
        record.entry.result = 'failed'; reject(new Error(name + (timedOut ? ' timed out' : ' failed'))); return;
      }
      let stdout; try { if (structured) stdout = streams.text(); } catch { record.entry.result = 'failed'; reject(new Error(name + ' structured output was invalid')); return; }
      record.entry.result = 'passed'; resolveCommand({ output, stdout, code });
    };
    const interrupt = () => { record.forced = true; void record.stop().catch(() => {}); fallback ??= setTimeout(() => void finish(null, 'unverified-close'), 13_000); };
    const timer = setTimeout(() => { timedOut = true; interrupt(); }, timeout);
    record.interrupt = interrupt;
    child.stdout.on('data', chunk => { try { streams.stdout(chunk); } catch (error) { streamError = error; interrupt(); } });
    child.stderr.on('data', chunk => streams.stderr(chunk));
    child.on('error', () => { streamError = new Error('Owned probe command could not start'); });
    child.once('close', (code, signal) => void finish(code, signal));
    if (isCancelled()) interrupt();
  });
}

export async function buildIosVisionProbe({ repository = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  temporary = process.env.RUNNER_TEMP ?? join(repository, '.cache'), platform = process.platform, emit = console.log } = {}) {
  mkdirSync(temporary, { recursive: true });
  const diagnostics = join(temporary, 'wedding-vision-probe-build-diagnostics'); mkdirSync(diagnostics, { recursive: true });
  const status = { mode: 'vision-probe-build', result: 'running', compileOnly: true, sourcePreparationOnly: true,
    ownerReady: false, signingAllowed: false, testsExecuted: 0, deviceDiscovery: false, installation: false,
    physicalExecution: false, stages: [], scope: 'Unsigned generic physical-SDK build-for-testing only; no Vision runtime or device proof.' };
  const records = new Set(), environment = visionProbeBuildEnvironment(process.env);
  let cancelled = false, workspace, plan, phaseDeadline = Date.now() + VISION_PROBE_BUILD_LIMITS.preparationMs;
  const save = () => writeFileSync(join(diagnostics, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  const writeProvenance = () => writeFileSync(join(diagnostics, 'provenance.json'), JSON.stringify({ compileOnly: true, testsExecuted: 0, ownerReady: false,
    unsignedFixture: true, runnerBundleID: plan.runnerBundleID, testBundleID: plan.testBundleID, developmentTeam: CI_VISION_PROBE.developmentTeam,
    testIdentifier: plan.testIdentifier, sourceSHA256: plan.sourceSHA256, fixtureSHA256: plan.fixtureSHA256,
    projectSHA256: plan.projectSHA256, schemeSHA256: plan.schemeSHA256, builtFixture: status.builtFixture ?? null,
    builtArtifact: status.builtArtifact ?? null }, null, 2) + '\n');
  const signal = () => { cancelled = true; status.result = 'cancelled'; for (const record of records) if (record.evidence?.quiescent !== true) record.interrupt?.(); save(); };
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  const validation = (name, action) => { status.activeStage = name; const entry = { name, result: 'running' }; status.stages.push(entry); save();
    try { const value = action(); entry.result = 'passed'; return value; } catch (error) { entry.result = 'failed'; throw error; } finally { save(); } };
  const command = async (name, binary, args, options = {}) => {
    status.activeStage = name; save(); emit('Vision probe compile stage: ' + name);
    try { return await runOwnedVisionProbeCommand({ name, binary, args, cwd: repository, environment, diagnostics, records,
      timeout: Math.min(options.timeout ?? 30_000, phaseDeadline - Date.now()), structured: options.structured === true, isCancelled: () => cancelled }); }
    finally { const record = [...records].at(-1); if (record?.entry) status.stages.push(record.entry); save(); }
  };
  try {
    if (platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Unsigned probe build requires the selected standard ARM macOS/Xcode runner');
    if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.length !== 2) throw new Error('CI probe build takes no owner identity or arming arguments');
    const tools = await command('toolchain', 'xcodebuild', ['-version'], { structured: true });
    validation('selected-xcode', () => { if (!/^Xcode 26\.3\s/m.test(tools.stdout)) throw new Error('Select reviewed Xcode 26.3'); });
    const swift = await command('swift-toolchain', 'xcrun', ['swift', '--version'], { structured: true });
    status.swiftVersion = validation('selected-swift', () => requireSwiftTools62(swift.stdout));
    const generator = await import('./prepare-ios-vision-probe.mjs');
    workspace = mkdtempSync(join(temporary, 'wedding-vision-probe-work-'));
    plan = validation('prepare-not-armed-ci-source', () => requireCiVisionProbePlan(generator.prepareVisionProbe({ repository,
      output: join(workspace, 'Probe'), runnerBundleID: CI_VISION_PROBE.runnerBundleID, developmentTeam: CI_VISION_PROBE.developmentTeam,
      reuseExistingRunner: false, ownerReady: false, unsignedFixture: true })));
    status.sourceProof = validation('verify-source-graph', () => generator.verifyVisionProbe(plan, repository));
    const settings = await command('unsigned-build-settings', 'xcodebuild', visionProbeSettingsArguments(plan), { structured: true });
    status.target = validation('verify-unsigned-target', () => requireVisionProbeSettings(parseNamedJSON('probe-settings', settings.stdout), plan));
    phaseDeadline = Date.now() + VISION_PROBE_BUILD_LIMITS.buildMs;
    const derivedData = join(workspace, 'DerivedData');
    await command('build-for-testing', 'xcodebuild', visionProbeBuildArguments(plan, derivedData), { timeout: VISION_PROBE_BUILD_LIMITS.buildMs });
    status.buildComplete = true; phaseDeadline = Date.now() + VISION_PROBE_BUILD_LIMITS.verificationMs;
    validation('verify-source-after-build', () => generator.verifyVisionProbe(plan, repository));
    const products = join(derivedData, 'Build/Products');
    const candidates = validation('one-built-xctestrun', () => {
      const files = readdirSync(products).filter(name => name.endsWith('.xctestrun'));
      if (files.length !== 1) throw new Error('Build must produce exactly one xctestrun');
      const path = ownedVisionProbePath(products, join(products, files[0])), state = lstatSync(path);
      if (!state.isFile() || state.size < 1 || state.size > 512 * 1024) throw new Error('Built xctestrun is not a bounded regular file');
      return path;
    });
    const convert = async (name, path) => parseNamedJSON(name, (await command(name, 'plutil', ['-convert', 'json', '-o', '-', path], { structured: true })).stdout);
    const xctestrun = await convert('read-built-xctestrun', candidates);
    const proof = validation('not-armed-xctestrun', () => inspectVisionProbeXctestrun(xctestrun, plan));
    const runner = ownedVisionProbePath(products, proof.testHostPath), testBundle = ownedVisionProbePath(products, proof.testBundlePath, runner);
    const runnerInfo = await convert('read-runner-identity', ownedVisionProbePath(products, join(runner, 'Info.plist')));
    const testInfo = await convert('read-test-identity', ownedVisionProbePath(products, join(testBundle, 'Info.plist')));
    status.builtArtifact = validation('verify-bundled-png-and-identities', () => verifyVisionProbeProducts({ products, xctestrun, plan, runnerInfo, testInfo,
      recordBuiltFixture: facts => { status.builtFixture = facts; save(); writeProvenance(); } }));
    writeProvenance();
    status.result = 'passed';
  } catch (error) {
    status.result = cancelled ? 'cancelled' : 'failed'; status.error = annotationText(error?.message ?? 'Unsigned probe build failed', 400);
  } finally {
    phaseDeadline = Date.now() + VISION_PROBE_BUILD_LIMITS.cleanupMs;
    await Promise.allSettled([...records].map(record => record.stop?.()));
    const decision = visionProbeCleanupDecision({ result: status.result, quiescent: [...records].every(record => record.evidence?.quiescent === true),
      completedBuild: status.buildComplete === true, forced: [...records].some(record => record.forced) });
    status.result = decision.result; status.processCleanup = { allOwnedGroupsQuiescent: decision.cleanupVerified,
      outputsRemoved: false, outputsRetainedOnUncertainty: !decision.removeOutputs };
    if (workspace && decision.removeOutputs) {
      try { rmSync(workspace, { recursive: true, force: true }); status.processCleanup.outputsRemoved = true; }
      catch { status.result = 'failed'; status.cleanupError = 'Build output removal incomplete; remaining outputs retained'; status.processCleanup.outputsRetainedOnUncertainty = true; }
    }
    process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal); save();
    const commit = /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : 'local';
    emit('::' + (status.result === 'passed' ? 'notice' : 'error') + ' title=Unsigned synthetic Vision probe compile::' + workflowData(JSON.stringify({ commit,
      result: status.result, stage: status.activeStage, error: status.error ?? null, compileOnly: true, testsExecuted: 0, ownerReady: false,
      fixtureVerified: status.builtArtifact?.fixtureVerified ?? false, builtFixture: status.builtFixture ?? null,
      cleanupVerified: status.processCleanup.allOwnedGroupsQuiescent })));
    if (status.result !== 'passed') {
      const logs = Object.fromEntries(readdirSync(diagnostics).filter(name => name.endsWith('.log')).map(name => [name, readFileSync(join(diagnostics, name), 'utf8')]));
      for (const line of diagnosticLines(logs, status.stages, 3)) emit('::notice title=Probe compile diagnostic::' + workflowData(line));
    }
  }
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = await buildIosVisionProbe(); process.exitCode = status.result === 'passed' ? 0 : 1;
}
