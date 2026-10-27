import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHYSICAL_SCHEME = 'WeddingPhotoboothPhysical';
export const PHYSICAL_TARGET = 'WeddingPhotoboothPhysicalSmokeTests';
export const PREVIOUS_NATIVE_APPLICATION_COMMIT = 'b4e01d3aeb47c3f164f912b829b4807cc3551f8d';
const reviewedUI = {
  'apps/ipad/App.tsx': '9425fa216f680b9f6add46d16eca4d3a0cca4bfb52aaac6eb010b814b269068e',
  'apps/ipad/src/TimingSheet.tsx': 'c6564a204c7a3a3ebd3fe993c04facc755ba08e18bc1e0cee62c572a0e466210',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => JSON.stringify(value);
const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function contains(parent, child) {
  const path = relative(parent, child);
  return !path || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
}
function canonicalNewPath(path) {
  const missing = [];
  let ancestor = path;
  while (true) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(relative(dirname(ancestor), ancestor)); ancestor = dirname(ancestor);
    }
  }
  // Resolve existing symlinks before both the privacy check and the actual write.
  // A dangling link fails here, before any output directory is created.
  return resolve(realpathSync(ancestor), ...missing);
}

/** Source preparation only: no child processes, signing, registration or installation. */
export function preparePhysicalTests({ repository, output, appBundleID, developmentTeam, ownerReady = false, readinessSignal }) {
  if (typeof appBundleID !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(appBundleID) || appBundleID.startsWith('com.example.')) {
    throw new Error('Configure the preserved installed app bundle identifier explicitly');
  }
  if (typeof developmentTeam !== 'string' || !/^[A-Z0-9]{10}$/.test(developmentTeam)) throw new Error('Configure the existing development team');
  if (typeof ownerReady !== 'boolean' || (ownerReady && readinessSignal !== 'OWNER_READY')) {
    throw new Error('Arming needs both the explicit --owner-ready action and OWNER_READY signal, after owner readiness');
  }
  repository = realpathSync(resolve(repository)); output = canonicalNewPath(resolve(output));
  if (contains(repository, output) && !contains(join(repository, '.cache'), output)) {
    throw new Error('Generated identity/project data must stay in ignored .cache or a private directory outside the public checkout');
  }
  if (existsSync(output)) throw new Error('Output already exists; preserve existing work');
  const app = JSON.parse(readFileSync(join(repository, 'apps/ipad/app.json'), 'utf8'));
  if (app.expo?.version !== '0.3.5' || app.expo?.ios?.buildNumber !== '8') throw new Error('Review this rehearsal against the new app version before preparing it');
  for (const [path, digest] of Object.entries(reviewedUI)) {
    if (hash(readFileSync(join(repository, path))) !== digest) throw new Error('Reviewed app accessibility source changed; revalidate this runner');
  }
  const sourcePath = 'apps/ipad/native-tests/WeddingPhotoboothPhysicalSmokeTests.swift';
  const source = readFileSync(join(repository, sourcePath));
  const id = name => hash('wedding-physical:' + name).slice(0, 24).toUpperCase();
  const object = (name, body) => `${id(name)} = { ${body} };`;
  const settings = {
    PRODUCT_BUNDLE_IDENTIFIER: appBundleID + '.physicaltests', PRODUCT_NAME: '$(TARGET_NAME)',
    PRODUCT_MODULE_NAME: PHYSICAL_TARGET, GENERATE_INFOPLIST_FILE: 'YES', SWIFT_VERSION: '5.0',
    SDKROOT: 'iphoneos', SUPPORTED_PLATFORMS: 'iphoneos', TARGETED_DEVICE_FAMILY: '2',
    IPHONEOS_DEPLOYMENT_TARGET: '16.4', DEVELOPMENT_TEAM: developmentTeam, CODE_SIGN_IDENTITY: 'Apple Development',
    CODE_SIGNING_ALLOWED: 'NO', CODE_SIGN_STYLE: 'Automatic', CLANG_ENABLE_MODULES: 'YES',
    ENABLE_TESTING_SEARCH_PATHS: 'YES', ENABLE_USER_SCRIPT_SANDBOXING: 'YES',
    LD_RUNPATH_SEARCH_PATHS: '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
    FRAMEWORK_SEARCH_PATHS: '$(inherited) $(PLATFORM_DIR)/Developer/Library/Frameworks',
  };
  const objects = [
    object('sources', 'isa = PBXFileSystemSynchronizedRootGroup; exceptions = (); explicitFileTypes = {}; explicitFolders = (); path = Sources; sourceTree = "<group>";'),
    object('product', `isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = ${PHYSICAL_TARGET}.xctest; sourceTree = BUILT_PRODUCTS_DIR;`),
    object('products', `isa = PBXGroup; children = (${id('product')},); name = Products; sourceTree = "<group>";`),
    object('main', `isa = PBXGroup; children = (${id('sources')},${id('products')},); sourceTree = "<group>";`),
    ...['Sources', 'Frameworks', 'Resources'].map(name => object('phase' + name, `isa = PBX${name}BuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;`)),
    object('projectRelease', 'isa = XCBuildConfiguration; name = Release; buildSettings = { SDKROOT = iphoneos; };'),
    object('targetRelease', 'isa = XCBuildConfiguration; name = Release; buildSettings = { ' + Object.entries(settings).map(([k, v]) => k + ' = ' + quote(v) + ';').join(' ') + ' };'),
    object('projectConfigs', `isa = XCConfigurationList; buildConfigurations = (${id('projectRelease')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`),
    object('targetConfigs', `isa = XCConfigurationList; buildConfigurations = (${id('targetRelease')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`),
    object('target', `isa = PBXNativeTarget; buildConfigurationList = ${id('targetConfigs')}; buildPhases = (${['Sources', 'Frameworks', 'Resources'].map(n => id('phase' + n)).join(',')},); buildRules = (); dependencies = (); fileSystemSynchronizedGroups = (${id('sources')},); name = ${PHYSICAL_TARGET}; productName = ${PHYSICAL_TARGET}; productReference = ${id('product')}; productType = "com.apple.product-type.bundle.ui-testing";`),
    object('project', `isa = PBXProject; attributes = { LastUpgradeCheck = 2630; }; buildConfigurationList = ${id('projectConfigs')}; compatibilityVersion = "Xcode 16.0"; developmentRegion = en; knownRegions = (en,Base,); mainGroup = ${id('main')}; productRefGroup = ${id('products')}; preferredProjectObjectVersion = 77; projectDirPath = ""; projectRoot = ""; targets = (${id('target')},);`),
  ];
  const projectText = `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 77; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`;
  const projectName = PHYSICAL_SCHEME + '.xcodeproj';
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id('target')}" BuildableName="${PHYSICAL_TARGET}.xctest" BlueprintName="${PHYSICAL_TARGET}" ReferencedContainer="container:${projectName}"/>`;
  const marker = ownerReady ? 'OWNER_READY' : 'NOT_ARMED';
  const schemeText = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2630" version="1.7">
  <BuildAction parallelizeBuildables="NO" buildImplicitDependencies="NO"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv="NO">
    <Testables><TestableReference skipped="NO" parallelizable="NO">${reference}</TestableReference></Testables>
    <EnvironmentVariables>
      <EnvironmentVariable key="PHOTOBOOTH_APP_BUNDLE_ID" value="${xml(appBundleID)}" isEnabled="YES"/>
      <EnvironmentVariable key="PHOTOBOOTH_PHYSICAL_REHEARSAL" value="${marker}" isEnabled="YES"/>
    </EnvironmentVariables>
  </TestAction>
</Scheme>
`;
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  const project = join(output, projectName), schemes = join(project, 'xcshareddata/xcschemes');
  mkdirSync(schemes, { recursive: true }); mkdirSync(join(output, 'Sources'));
  copyFileSync(join(repository, sourcePath), join(output, 'Sources', PHYSICAL_TARGET + '.swift'));
  writeFileSync(join(project, 'project.pbxproj'), projectText);
  writeFileSync(join(schemes, PHYSICAL_SCHEME + '.xcscheme'), schemeText);
  const plan = { project, scheme: PHYSICAL_SCHEME, previousNativeApplicationCommit: PREVIOUS_NATIVE_APPLICATION_COMMIT,
    applicationReview: { version: app.expo.version, build: app.expo.ios.buildNumber, sourceSHA256: { ...reviewedUI } },
    sourceSHA256: hash(source), projectSHA256: hash(projectText), schemeSHA256: hash(schemeText),
    appBundleID, runnerBundleID: appBundleID + '.physicaltests.xctrunner', signingAllowed: false,
    ownerReady, readinessInTestAction: marker, applicationTarget: false, sourcePreparationOnly: true,
    nativeValidation: 'The earlier E8 generator passed Mac unsigned preparation. This app-source retarget requires matching Mac validation; source-only checks are not device execution.' };
  writeFileSync(join(output, 'physical-test-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || args[0].startsWith('-') || (args.length === 2 && args[1] !== '--owner-ready')) {
    throw new Error('Usage: node scripts/prepare-ios-physical-tests.mjs NEW_PRIVATE_OUTPUT_DIRECTORY [--owner-ready]');
  }
  const plan = preparePhysicalTests({ repository: resolve(dirname(fileURLToPath(import.meta.url)), '..'), output: args[0],
    appBundleID: process.env.PHOTOBOOTH_APP_BUNDLE_ID, developmentTeam: process.env.PHOTOBOOTH_DEVELOPMENT_TEAM,
    ownerReady: args[1] === '--owner-ready', readinessSignal: process.env.PHOTOBOOTH_PHYSICAL_REHEARSAL });
  console.log(JSON.stringify(plan, null, 2));
}
