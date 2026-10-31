import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { nativeRuntimeResources } from './ci-native-contract.mjs';

export const PIXEL_PROJECT_NAME = 'WeddingPhotoboothNativePixels';
export const PIXEL_BUNDLE_ID = 'com.example.weddingphotobooth.nativepixels';
export const PIXEL_REQUIRED_CASES = 19;
export const PIXEL_LIMITS = Object.freeze({
  preparationMs: 18 * 60_000, xcodeMs: 20 * 60_000,
  artifactsMs: 3 * 60_000, cleanupMs: 2 * 60_000,
  nativeStepMinutes: 46, jobMinutes: 60,
});

const pixelSourcePaths = [
  'apps/ipad/modules/wedding-photo-effects/ios/PhotoEffectsEngine.swift',
  'apps/ipad/modules/wedding-photo-effects/tests/PhotoEffectsEngineTests.swift',
  'apps/ipad/modules/wedding-photo-effects/ios/PhotoTemplateEngine.swift',
  'apps/ipad/modules/wedding-photo-effects/tests/PhotoTemplateEngineTests.swift',
];
const testClasses = new Map([
  ['PhotoEffectsEngineTests.swift', ['PhotoEffectsEngineTests', 8]],
  ['PhotoTemplateEngineTests.swift', ['PhotoTemplateEngineTests', 11]],
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function pixelInputs(root) {
  const sources = pixelSourcePaths.map(path => {
    const bytes = readFileSync(resolve(root, path)), text = bytes.toString('utf8');
    if (/^\s*(?:@testable\s+)?import\s+Expo\w*/m.test(text)) throw new Error('Pixel sources must remain independent of Expo');
    const testMethods = [...text.matchAll(/^\s*func\s+(test\w+)\s*\(\s*\)/gm)].map(match => match[1]);
    if (new Set(testMethods).size !== testMethods.length) throw new Error('Duplicate pixel method name');
    const input = { source: path, sha256: hash(bytes), testMethods };
    const known = testClasses.get(basename(path));
    let cases = [];
    if (known) {
      const [className, required] = known;
      const classes = [...text.matchAll(/final\s+class\s+(\w+)\s*:\s*XCTestCase\b/g)].map(match => match[1]);
      if (classes.length !== 1 || classes[0] !== className || input.testMethods.length !== required || /\bXCTSkip\b/.test(text)) {
        throw new Error('Unexpected pixel XCTest class or method inventory');
      }
      cases = input.testMethods.map(method => className + '.' + method);
    } else if (input.testMethods.length) throw new Error('Production pixel engine contains unexpected tests');
    return { ...input, generatedSource: 'Sources/' + basename(path), cases };
  });
  const resources = nativeRuntimeResources(root).map(input => ({ ...input, generatedSource: 'Resources/' + basename(input.source) }));
  const cases = sources.flatMap(source => source.cases);
  if (cases.length !== PIXEL_REQUIRED_CASES || new Set(cases).size !== PIXEL_REQUIRED_CASES || resources.length !== 9) {
    throw new Error('The pixel target must retain all nineteen named methods and nine resources');
  }
  return { sources, resources, cases };
}

function projectText(inputs) {
  const ids = new Map();
  const id = name => {
    if (!ids.has(name)) {
      const value = hash('wedding-native-pixels:' + name).slice(0, 24).toUpperCase();
      if ([...ids.values()].includes(value)) throw new Error('Generated project identifier collision');
      ids.set(name, value);
    }
    return ids.get(name);
  };
  const objects = [];
  const add = (name, body) => objects.push(`${id(name)} = { ${body} };`);
  const file = input => {
    const name = basename(input.generatedSource), resource = input.generatedSource.startsWith('Resources/');
    add('ref:' + name, `isa = PBXFileReference; lastKnownFileType = ${resource ? (name.endsWith('.frameart') ? 'file' : 'image.jpeg') : 'sourcecode.swift'}; path = ${JSON.stringify(input.generatedSource)}; sourceTree = SOURCE_ROOT;`);
    add('build:' + name, `isa = PBXBuildFile; fileRef = ${id('ref:' + name)};`);
  };
  inputs.sources.forEach(file); inputs.resources.forEach(file);
  add('sources', `isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${inputs.sources.map(source => id('build:' + basename(source.generatedSource))).join(',')},); runOnlyForDeploymentPostprocessing = 0;`);
  add('resources', `isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (${inputs.resources.map(source => id('build:' + basename(source.generatedSource))).join(',')},); runOnlyForDeploymentPostprocessing = 0;`);
  add('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;');
  add('product', `isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = ${PIXEL_PROJECT_NAME}.xctest; sourceTree = BUILT_PRODUCTS_DIR;`);
  add('products-group', `isa = PBXGroup; children = (${id('product')},); name = Products; sourceTree = "<group>";`);
  add('source-group', `isa = PBXGroup; children = (${inputs.sources.map(source => id('ref:' + basename(source.generatedSource))).join(',')},); name = Sources; sourceTree = "<group>";`);
  add('resource-group', `isa = PBXGroup; children = (${inputs.resources.map(source => id('ref:' + basename(source.generatedSource))).join(',')},); name = Resources; sourceTree = "<group>";`);
  add('main-group', `isa = PBXGroup; children = (${id('source-group')},${id('resource-group')},${id('products-group')},); sourceTree = "<group>";`);
  const settings = `
    CLANG_ENABLE_MODULES = YES;
    CODE_SIGNING_ALLOWED = NO;
    CODE_SIGNING_REQUIRED = NO;
    ENABLE_TESTING_SEARCH_PATHS = YES;
    ENABLE_USER_SCRIPT_SANDBOXING = YES;
    GENERATE_INFOPLIST_FILE = YES;
    IPHONEOS_DEPLOYMENT_TARGET = 16.4;
    LD_RUNPATH_SEARCH_PATHS = ("$(inherited)","@loader_path/Frameworks","@executable_path/Frameworks",);
    FRAMEWORK_SEARCH_PATHS = ("$(inherited)","$(PLATFORM_DIR)/Developer/Library/Frameworks","$(SDKROOT)/Developer/Library/Frameworks",);
    PRODUCT_BUNDLE_IDENTIFIER = ${PIXEL_BUNDLE_ID};
    PRODUCT_MODULE_NAME = ${PIXEL_PROJECT_NAME};
    PRODUCT_NAME = "$(TARGET_NAME)";
    SDKROOT = iphonesimulator;
    SKIP_INSTALL = YES;
    SUPPORTED_PLATFORMS = iphonesimulator;
    SUPPORTS_MACCATALYST = NO;
    SWIFT_ACTIVE_COMPILATION_CONDITIONS = "";
    SWIFT_COMPILATION_MODE = wholemodule;
    SWIFT_OPTIMIZATION_LEVEL = "-O";
    SWIFT_VERSION = 5.0;
    TARGETED_DEVICE_FAMILY = "1,2";
  `;
  add('project-release', 'isa = XCBuildConfiguration; name = Release; buildSettings = { CLANG_ENABLE_MODULES = YES; SDKROOT = iphonesimulator; };');
  add('target-release', `isa = XCBuildConfiguration; name = Release; buildSettings = { ${settings} };`);
  add('project-configs', `isa = XCConfigurationList; buildConfigurations = (${id('project-release')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);
  add('target-configs', `isa = XCConfigurationList; buildConfigurations = (${id('target-release')},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);
  add('target', `isa = PBXNativeTarget; buildConfigurationList = ${id('target-configs')}; buildPhases = (${id('sources')},${id('frameworks')},${id('resources')},); buildRules = (); dependencies = (); name = ${PIXEL_PROJECT_NAME}; productName = ${PIXEL_PROJECT_NAME}; productReference = ${id('product')}; productType = "com.apple.product-type.bundle.unit-test";`);
  add('project', `isa = PBXProject; attributes = { LastUpgradeCheck = 2630; }; buildConfigurationList = ${id('project-configs')}; compatibilityVersion = "Xcode 15.0"; developmentRegion = en; knownRegions = (en,Base,); mainGroup = ${id('main-group')}; productRefGroup = ${id('products-group')}; projectDirPath = ""; projectRoot = ""; targets = (${id('target')},);`);
  return { text: `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 60; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`, targetId: id('target') };
}

function schemeText(targetId) {
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${targetId}" BuildableName="${PIXEL_PROJECT_NAME}.xctest" BlueprintName="${PIXEL_PROJECT_NAME}" ReferencedContainer="container:${PIXEL_PROJECT_NAME}.xcodeproj"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2630" version="1.7">
  <BuildAction parallelizeBuildables="NO" buildImplicitDependencies="NO"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv="NO"><Testables><TestableReference skipped="NO" parallelizable="NO">${reference}</TestableReference></Testables></TestAction>
</Scheme>
`;
}

export function createPixelProject(root, directory) {
  root = resolve(root); directory = resolve(directory);
  if (existsSync(directory) && readdirSync(directory).length) throw new Error('Pixel project destination must be empty');
  const inputs = pixelInputs(root);
  mkdirSync(directory, { recursive: true });
  for (const input of [...inputs.sources, ...inputs.resources]) {
    const target = join(directory, input.generatedSource);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(resolve(root, input.source), target);
  }
  const project = join(directory, PIXEL_PROJECT_NAME + '.xcodeproj');
  const schemes = join(project, 'xcshareddata/xcschemes'); mkdirSync(schemes, { recursive: true });
  const generated = projectText(inputs);
  writeFileSync(join(project, 'project.pbxproj'), generated.text);
  const scheme = schemeText(generated.targetId);
  writeFileSync(join(schemes, PIXEL_PROJECT_NAME + '.xcscheme'), scheme);
  const plan = { version: 1, mode: 'native-pixels', directory, project, scheme: PIXEL_PROJECT_NAME,
    product: PIXEL_PROJECT_NAME + '.xctest', bundleId: PIXEL_BUNDLE_ID,
    configuration: 'Release', sdk: 'iphonesimulator', host: 'Xcode built-in xctest; no application target',
    sources: inputs.sources, resources: inputs.resources, expectedCases: inputs.cases,
    expectedTests: PIXEL_REQUIRED_CASES, projectSHA256: hash(generated.text), schemeSHA256: hash(scheme) };
  writeFileSync(join(directory, 'native-pixel-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  verifyPixelProject(plan, root);
  return plan;
}

export function verifyPixelProject(plan, root) {
  const expected = pixelInputs(resolve(root));
  if (plan?.version !== 1 || plan.mode !== 'native-pixels' || plan.expectedTests !== PIXEL_REQUIRED_CASES ||
    plan.scheme !== PIXEL_PROJECT_NAME || plan.bundleId !== PIXEL_BUNDLE_ID || plan.configuration !== 'Release' ||
    plan.project !== join(resolve(plan.directory), PIXEL_PROJECT_NAME + '.xcodeproj') ||
    plan.sdk !== 'iphonesimulator' || JSON.stringify(plan.sources) !== JSON.stringify(expected.sources) ||
    JSON.stringify(plan.resources) !== JSON.stringify(expected.resources) || JSON.stringify(plan.expectedCases) !== JSON.stringify(expected.cases)) {
    throw new Error('Pixel source, fixture or named-case manifest changed');
  }
  for (const input of [...expected.sources, ...expected.resources]) {
    if (hash(readFileSync(join(plan.directory, input.generatedSource))) !== input.sha256) throw new Error('Generated pixel source or fixture changed');
  }
  const project = readFileSync(join(plan.project, 'project.pbxproj'), 'utf8');
  const scheme = readFileSync(join(plan.project, 'xcshareddata/xcschemes', PIXEL_PROJECT_NAME + '.xcscheme'), 'utf8');
  const reviewed = projectText(expected), reviewedScheme = schemeText(reviewed.targetId);
  if (project !== reviewed.text || scheme !== reviewedScheme || hash(project) !== plan.projectSHA256 || hash(scheme) !== plan.schemeSHA256 ||
    /TEST_HOST|BUNDLE_LOADER|TEST_TARGET_NAME|PBXTargetDependency|PBXShellScriptBuildPhase|Expo|Pods/.test(project) ||
    (project.match(/isa = PBXNativeTarget;/g) ?? []).length !== 1 ||
    !project.includes('com.apple.product-type.bundle.unit-test')) throw new Error('Pixel target is not the reviewed independent unhosted project');
  return true;
}

export function pixelBuildSettingsArguments(plan, architecture) {
  if (!plan || typeof plan.project !== 'string' || !plan.project || plan.scheme !== PIXEL_PROJECT_NAME ||
    !['x86_64', 'arm64'].includes(architecture)) throw new Error('Invalid independent pixel build settings inputs');
  // A test-only scheme has no build-for-running entry. Query its target directly
  // so this preflight cannot select the scheme's implicit default build action.
  return ['-project', plan.project, '-target', PIXEL_PROJECT_NAME, '-configuration', 'Release',
    '-sdk', 'iphonesimulator', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
    'ONLY_ACTIVE_ARCH=YES', 'ARCHS=' + architecture, '-showBuildSettings', '-json'];
}

export function requireUnhostedPixelSettings(value) {
  const settings = Array.isArray(value) ? value[0]?.buildSettings : undefined;
  const reject = message => {
    const error = new Error(message);
    error.diagnosticShape = { type: Array.isArray(value) ? 'array' : typeof value, targetCount: Array.isArray(value) ? value.length : null,
      targetMatches: value?.[0]?.target === PIXEL_PROJECT_NAME,
      fields: ['PRODUCT_BUNDLE_IDENTIFIER', 'PRODUCT_TYPE', 'CONFIGURATION', 'SDK_NAME', 'PRODUCT_NAME', 'TEST_HOST', 'BUNDLE_LOADER', 'TEST_TARGET_NAME']
        .map(key => ({ key, present: settings ? Object.hasOwn(settings, key) : false, type: typeof settings?.[key],
          nonempty: typeof settings?.[key] === 'string' ? settings[key].trim().length > 0 : false })) };
    throw error;
  };
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.target !== PIXEL_PROJECT_NAME) reject('Unexpected pixel build settings target');
  if (!settings || settings.PRODUCT_BUNDLE_IDENTIFIER !== PIXEL_BUNDLE_ID ||
    settings.PRODUCT_TYPE !== 'com.apple.product-type.bundle.unit-test' ||
    settings.CONFIGURATION !== 'Release' || settings.SDK_NAME?.startsWith('iphonesimulator') !== true ||
    !String(settings.PRODUCT_NAME).includes(PIXEL_PROJECT_NAME) ||
    ['TEST_HOST', 'BUNDLE_LOADER', 'TEST_TARGET_NAME'].some(key => String(settings[key] ?? '').trim())) {
    reject('Xcode did not confirm an unhosted Release iOS simulator unit-test target');
  }
  return { target: PIXEL_PROJECT_NAME, productType: settings.PRODUCT_TYPE, sdk: settings.SDK_NAME,
    configuration: settings.CONFIGURATION, applicationHost: false };
}

export function ownedSimulatorRemoval({ udid, creationRequested = false, cancelled = false, deleteCode, inventory } = {}) {
  if (!creationRequested) return { verified: true, method: 'not-created' };
  if (!udid || !/^[a-f0-9-]{36}$/i.test(udid)) return { verified: false, method: 'creation-outcome-unknown' };
  if (deleteCode === 0) return { verified: true, method: 'delete-succeeded', udid };
  if (cancelled) return { verified: false, method: 'deferred-after-cancellation', udid };
  const devices = inventory?.devices;
  if (!devices || typeof devices !== 'object' || Array.isArray(devices) ||
    Object.values(devices).some(rows => !Array.isArray(rows) || rows.some(row => typeof row?.udid !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.udid)))) {
    return { verified: false, method: 'absence-unverified', udid };
  }
  const present = Object.values(devices).some(rows => rows.some(row => row.udid.toLowerCase() === udid.toLowerCase()));
  return { verified: !present, method: present ? 'still-present' : 'confirmed-absent', udid };
}

export function pixelCleanupDecision({ result, quiescent, removal, forced = false }) {
  const verified = quiescent === true && removal?.verified === true;
  return {
    result: result === 'passed' && !verified ? 'failed' : result,
    cleanupVerified: verified,
    removeBuildOutputs: result === 'passed' && verified && !forced,
    error: quiescent !== true ? 'Owned process cleanup remained unverified'
      : removal?.verified !== true ? 'Owned simulator removal remained unverified' : undefined,
  };
}
