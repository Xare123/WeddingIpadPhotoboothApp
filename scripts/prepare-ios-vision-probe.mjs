import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VISION_PROBE_SCHEME = 'WeddingPhotoboothSyntheticVisionProbe';
export const VISION_PROBE_TARGET = 'WeddingPhotoboothSyntheticVisionProbeTests';
export const VISION_PROBE_METHOD = 'testOwnerArmedSyntheticVisionOnPhysicalIPad';
export const VISION_PROBE_FIXTURE_SHA = 'c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165';
export const VISION_PROBE_CI_RUNNER = 'org.fixture.weddingbooth.physicaltests.xctrunner';
export const VISION_PROBE_CI_TEAM = 'TESTTEAM01';
// Independently reviewed, synthetic-only physical probe; not a production app revision.
export const VISION_PROBE_SOURCE_SHA = '6f0416721c06d5cc8cabae1910ea7b8015a2ac80d030d7ef441d9faf8a025175';
const reviewedSources = Object.freeze({
  'apps/ipad/modules/wedding-photo-effects/ios/FaceGeometry.swift': '62866121340d52308afbe16d454aae81ce4873d3de99563b625a24b48c2ffaeb',
  'apps/ipad/modules/wedding-photo-effects/ios/FrameFreshnessGate.swift': '2d1d6615c49a501302cf44861825c7cda3ad26fe161cd0db53f84cb396ee55f3',
  'apps/ipad/modules/wedding-photo-effects/ios/AppleFaceEffects.swift': '01a87b5454f3f5b52947054302acc717b80510eead06df9e4a71bf94a3a4a8a0',
  'apps/ipad/modules/wedding-photo-effects/ios/PhotoEffectsEngine.swift': 'f0ae112a9db22137b4207e2c7b9870715311cca772f1c4aa4b25323384747e97',
});
const hash = data => createHash('sha256').update(data).digest('hex');
const quote = value => JSON.stringify(value);
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function inside(parent, child) { const path = relative(parent, child); return !path || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path)); }
function canonicalNewPath(path) {
  let ancestor = resolve(path); const missing = [];
  while (true) {
    try { lstatSync(ancestor); break; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(relative(dirname(ancestor), ancestor)); ancestor = dirname(ancestor);
    }
  }
  return resolve(realpathSync(ancestor), ...missing);
}
function configuration({ runnerBundleID, developmentTeam, reuseExistingRunner, ownerReady, readinessSignal, unsignedFixture }) {
  if (typeof unsignedFixture !== 'boolean' || typeof ownerReady !== 'boolean' || typeof reuseExistingRunner !== 'boolean') throw new Error('Probe flags must be explicit booleans');
  if (unsignedFixture) {
    if (runnerBundleID !== VISION_PROBE_CI_RUNNER || developmentTeam !== VISION_PROBE_CI_TEAM || ownerReady) throw new Error('Unsigned CI fixtures are fixed and cannot be armed');
  } else {
    if (!reuseExistingRunner) throw new Error('Explicit acknowledgement of the existing authorized runner is required');
    if (typeof runnerBundleID !== 'string' || runnerBundleID.length > 255 || !runnerBundleID.endsWith('.physicaltests.xctrunner') || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\.physicaltests\.xctrunner$/.test(runnerBundleID) || /^(?:com\.example\.|org\.fixture\.)/.test(runnerBundleID)) throw new Error('Configure the existing authorized physicaltests runner identity');
    if (typeof developmentTeam !== 'string' || developmentTeam.length !== 10 || !/^[A-Z0-9]{10}$/.test(developmentTeam)) throw new Error('Configure the existing development team');
    if (ownerReady && readinessSignal !== 'OWNER_READY') throw new Error('Arming requires --owner-ready and the explicit owner readiness signal');
  }
  return { runnerBundleID, testBundleID: runnerBundleID.slice(0, -'.xctrunner'.length), developmentTeam, ownerReady, unsignedFixture, reuseExistingRunner };
}
function fileBytes(path, maximum) {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink() || state.size < 1 || state.size > maximum) throw new Error('Probe input must be a bounded regular file');
  return readFileSync(path);
}
function inputs(repository) {
  const probe = 'apps/ipad/native-tests/' + VISION_PROBE_TARGET + '.swift';
  const sources = Object.entries({ ...reviewedSources, [probe]: VISION_PROBE_SOURCE_SHA }).map(([source, expected]) => {
    const bytes = fileBytes(join(repository, source), 192 * 1024);
    if (!/^[a-f0-9]{64}$/.test(expected) || hash(bytes) !== expected) throw new Error('Reviewed probe source changed; source review required: ' + source);
    return { source, generated: 'Sources/' + source.split('/').at(-1), sha256: expected };
  });
  const fixture = 'apps/ipad/native-tests/fixtures/treatments/separated-portrait.png';
  const bytes = fileBytes(join(repository, fixture), 8 * 1024 * 1024);
  if (hash(bytes) !== VISION_PROBE_FIXTURE_SHA || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 1122 || bytes.readUInt32BE(20) !== 1402) throw new Error('The exact generated fixture is required');
  return { sources, resources: [{ source: fixture, generated: 'Sources/separated-portrait.png', sha256: VISION_PROBE_FIXTURE_SHA }] };
}

/** Pure source preparation. No account, profile, device, subprocess or network action. */
export function prepareVisionProbe({ repository, output, runnerBundleID, developmentTeam, reuseExistingRunner = false, ownerReady = false, readinessSignal, unsignedFixture = false }) {
  const configured = configuration({ runnerBundleID, developmentTeam, reuseExistingRunner, ownerReady, readinessSignal, unsignedFixture });
  repository = realpathSync(resolve(repository)); output = canonicalNewPath(output);
  if (inside(repository, output) && !inside(join(repository, '.cache'), output)) throw new Error('Probe configuration must remain in ignored .cache or a private directory outside the public checkout');
  if (existsSync(output)) throw new Error('Output already exists; preserve prior work');
  const { sources, resources } = inputs(repository);
  const id = name => hash('wedding-synthetic-vision:' + name).slice(0, 24).toUpperCase();
  const object = (name, body) => `${id(name)} = { ${body} };`;
  const settings = {
    PRODUCT_BUNDLE_IDENTIFIER: configured.testBundleID, PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_MODULE_NAME: VISION_PROBE_TARGET,
    GENERATE_INFOPLIST_FILE: 'YES', SWIFT_VERSION: '5.0', SDKROOT: 'iphoneos', SUPPORTED_PLATFORMS: 'iphoneos',
    TARGETED_DEVICE_FAMILY: '2', IPHONEOS_DEPLOYMENT_TARGET: '16.4', DEVELOPMENT_TEAM: developmentTeam,
    CODE_SIGN_IDENTITY: 'Apple Development', CODE_SIGNING_ALLOWED: 'NO', CODE_SIGNING_REQUIRED: 'NO', CODE_SIGN_STYLE: 'Automatic',
    COMPRESS_PNG_FILES: 'NO', STRIP_PNG_TEXT: 'NO', CLANG_ENABLE_MODULES: 'YES', ENABLE_TESTING_SEARCH_PATHS: 'YES', ENABLE_USER_SCRIPT_SANDBOXING: 'YES',
    LD_RUNPATH_SEARCH_PATHS: '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
    FRAMEWORK_SEARCH_PATHS: '$(inherited) $(PLATFORM_DIR)/Developer/Library/Frameworks',
  };
  const objects = [
    // Treat the pinned PNG as opaque test data, matching the pixel-test project's explicit file reference.
    object('sources', 'isa = PBXFileSystemSynchronizedRootGroup; exceptions = (); explicitFileTypes = { "separated-portrait.png" = file; }; explicitFolders = (); path = Sources; sourceTree = "<group>";'),
    object('product', `isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = ${VISION_PROBE_TARGET}.xctest; sourceTree = BUILT_PRODUCTS_DIR;`),
    object('products', `isa = PBXGroup; children = (${id('product')},); name = Products; sourceTree = "<group>";`),
    object('main', `isa = PBXGroup; children = (${id('sources')},${id('products')},); sourceTree = "<group>";`),
    ...['Sources', 'Frameworks', 'Resources'].map(name => object('phase' + name, `isa = PBX${name}BuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;`)),
    object('projectRelease', 'isa = XCBuildConfiguration; name = Release; buildSettings = { SDKROOT = iphoneos; };'),
    object('targetRelease', 'isa = XCBuildConfiguration; name = Release; buildSettings = { ' + Object.entries(settings).map(([key, value]) => key + ' = ' + quote(value) + ';').join(' ') + ' };'),
    object('projectConfigs', `isa = XCConfigurationList; buildConfigurations = (${id('projectRelease')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`),
    object('targetConfigs', `isa = XCConfigurationList; buildConfigurations = (${id('targetRelease')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`),
    object('target', `isa = PBXNativeTarget; buildConfigurationList = ${id('targetConfigs')}; buildPhases = (${['Sources', 'Frameworks', 'Resources'].map(name => id('phase' + name)).join(',')},); buildRules = (); dependencies = (); fileSystemSynchronizedGroups = (${id('sources')},); name = ${VISION_PROBE_TARGET}; productName = ${VISION_PROBE_TARGET}; productReference = ${id('product')}; productType = "com.apple.product-type.bundle.ui-testing";`),
    object('project', `isa = PBXProject; attributes = { LastUpgradeCheck = 2630; }; buildConfigurationList = ${id('projectConfigs')}; compatibilityVersion = "Xcode 16.0"; developmentRegion = en; knownRegions = (en,Base,); mainGroup = ${id('main')}; productRefGroup = ${id('products')}; preferredProjectObjectVersion = 77; projectDirPath = ""; projectRoot = ""; targets = (${id('target')},);`),
  ];
  const projectText = `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 77; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`;
  const projectName = VISION_PROBE_SCHEME + '.xcodeproj';
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id('target')}" BuildableName="${VISION_PROBE_TARGET}.xctest" BlueprintName="${VISION_PROBE_TARGET}" ReferencedContainer="container:${projectName}"/>`;
  const marker = ownerReady ? 'OWNER_READY' : 'NOT_ARMED';
  const schemeText = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2630" version="1.7">
  <BuildAction parallelizeBuildables="NO" buildImplicitDependencies="NO"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv="NO">
    <Testables><TestableReference skipped="NO" parallelizable="NO">${reference}<SelectedTests><Test Identifier="${VISION_PROBE_TARGET}/${VISION_PROBE_METHOD}"/></SelectedTests></TestableReference></Testables>
    <EnvironmentVariables>
      <EnvironmentVariable key="PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID" value="${xml(runnerBundleID)}" isEnabled="YES"/>
      <EnvironmentVariable key="PHOTOBOOTH_SYNTHETIC_VISION_PROBE" value="${marker}" isEnabled="YES"/>
    </EnvironmentVariables>
  </TestAction>
</Scheme>
`;
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  const project = join(output, projectName), schemes = join(project, 'xcshareddata/xcschemes');
  mkdirSync(schemes, { recursive: true }); mkdirSync(join(output, 'Sources'), { mode: 0o700 });
  for (const item of [...sources, ...resources]) writeFileSync(join(output, item.generated), readFileSync(join(repository, item.source)), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(project, 'project.pbxproj'), projectText); writeFileSync(join(schemes, VISION_PROBE_SCHEME + '.xcscheme'), schemeText);
  const plan = { output, project, scheme: VISION_PROBE_SCHEME, target: VISION_PROBE_TARGET, testClass: VISION_PROBE_TARGET, method: VISION_PROBE_METHOD,
    testIdentifier: [VISION_PROBE_TARGET, VISION_PROBE_TARGET, VISION_PROBE_METHOD].join('/'), ...configured,
    ownerReady, readinessInTestAction: marker, sourcePreparationOnly: true, signingAllowed: false, applicationTarget: false,
    sources, resources, fixtureSHA256: VISION_PROBE_FIXTURE_SHA,
    sourceSHA256: Object.fromEntries([...sources, ...resources].map(item => [item.source, item.sha256])),
    projectSHA256: hash(projectText), schemeSHA256: hash(schemeText), physicalExecution: false };
  writeFileSync(join(output, 'vision-probe-plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  verifyVisionProbe(plan, repository); return plan;
}

export function verifyVisionProbe(plan, repository) {
  repository = realpathSync(resolve(repository));
  if (!plan || !plan.sourcePreparationOnly || plan.signingAllowed !== false || plan.applicationTarget !== false) throw new Error('Invalid source-only probe plan');
  const expected = inputs(repository);
  if (JSON.stringify(plan.sources) !== JSON.stringify(expected.sources) || JSON.stringify(plan.resources) !== JSON.stringify(expected.resources)) throw new Error('Probe source graph changed');
  const directory = realpathSync(plan.output), names = readdirSync(join(directory, 'Sources')).sort();
  const wanted = [...expected.sources, ...expected.resources].map(item => item.generated.split('/').at(-1)).sort();
  if (JSON.stringify(names) !== JSON.stringify(wanted)) throw new Error('Unexpected source or resource entered the probe');
  for (const item of [...expected.sources, ...expected.resources]) {
    const path = join(directory, item.generated);
    if (!inside(directory, realpathSync(path)) || hash(fileBytes(path, 8 * 1024 * 1024)) !== item.sha256) throw new Error('Probe copy changed');
  }
  const graph = readFileSync(join(plan.project, 'project.pbxproj'), 'utf8');
  const scheme = readFileSync(join(plan.project, 'xcshareddata/xcschemes', plan.scheme + '.xcscheme'), 'utf8');
  if (hash(graph) !== plan.projectSHA256 || hash(scheme) !== plan.schemeSHA256) throw new Error('Generated probe project or scheme changed');
  if ((graph.match(/isa = PBXNativeTarget;/g) ?? []).length !== 1 || !graph.includes('com.apple.product-type.bundle.ui-testing') ||
    /com\.apple\.product-type\.application|PBXTargetDependency|PBXShellScriptBuildPhase|UITargetAppPath|TEST_HOST|BUNDLE_LOADER|TEST_TARGET_NAME/.test(graph) ||
    !graph.includes('CODE_SIGNING_ALLOWED = "NO";') || !graph.includes('CODE_SIGNING_REQUIRED = "NO";') ||
    !graph.includes('COMPRESS_PNG_FILES = "NO";') || !graph.includes('STRIP_PNG_TEXT = "NO";') ||
    !graph.includes('explicitFileTypes = { "separated-portrait.png" = file; };')) throw new Error('Probe target or unsigned boundary changed');
  if (scheme.includes('<LaunchAction') || !scheme.includes('shouldUseLaunchSchemeArgsEnv="NO"') ||
    !scheme.includes(`<SelectedTests><Test Identifier="${VISION_PROBE_TARGET}/${VISION_PROBE_METHOD}"/></SelectedTests>`) ||
    (scheme.match(/<EnvironmentVariable /g) ?? []).length !== 2 ||
    !scheme.includes(`key="PHOTOBOOTH_SYNTHETIC_VISION_PROBE" value="${plan.ownerReady ? 'OWNER_READY' : 'NOT_ARMED'}"`) ||
    !scheme.includes(`key="PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID" value="${xml(plan.runnerBundleID)}"`)) throw new Error('Probe test selection or readiness changed');
  return { sourceGraphVerified: true, sourceCount: expected.sources.length, resourceCount: expected.resources.length, fixtureSHA256: VISION_PROBE_FIXTURE_SHA };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flags = new Set(args.slice(1));
  if (!args[0] || args[0].startsWith('-') || flags.size !== args.length - 1 || [...flags].some(value => !['--reuse-existing-runner', '--owner-ready'].includes(value))) throw new Error('Usage: node scripts/prepare-ios-vision-probe.mjs NEW_PRIVATE_OUTPUT --reuse-existing-runner [--owner-ready]');
  const plan = prepareVisionProbe({ repository: resolve(dirname(fileURLToPath(import.meta.url)), '..'), output: args[0],
    runnerBundleID: process.env.PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID, developmentTeam: process.env.PHOTOBOOTH_DEVELOPMENT_TEAM,
    reuseExistingRunner: flags.has('--reuse-existing-runner'), ownerReady: flags.has('--owner-ready'), readinessSignal: process.env.PHOTOBOOTH_SYNTHETIC_VISION_PROBE });
  console.log(JSON.stringify({ project: plan.project, scheme: plan.scheme, planPath: join(plan.output, 'vision-probe-plan.json'),
    testIdentifier: plan.testIdentifier, ownerReady: plan.ownerReady, signingAllowed: false, sourcePreparationOnly: true, physicalExecution: false }));
}
