#!/usr/bin/env node
import { createRequire } from 'node:module';
import { dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ios = resolve(root, 'apps/ipad/ios');
const runtime = process.argv[2] === 'release-runtime';
if (process.argv[2] && !runtime) throw new Error('Unknown native test preparation mode');
const sourceName = runtime ? 'WeddingPhotoboothReleaseSmokeTests' : 'WeddingPhotoboothUITests';
const source = resolve(root, `apps/ipad/native-tests/${sourceName}.swift`);
const targetName = sourceName;
const scheme = runtime ? 'WeddingPhotoboothReleaseRuntime' : 'WeddingPhotoboothNativeTests';
const configuration = runtime ? 'Release' : 'Debug';
const testBundleSuffix = runtime ? 'releaseruntimetests' : 'uitests';
const unquote = value => typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

let projects;
try { projects = (await readdir(ios)).filter(name => name.endsWith('.xcodeproj')); }
catch { throw new Error('Run Expo prebuild --platform ios --no-install in apps/ipad before preparing native tests.'); }
if (projects.length !== 1) throw new Error('Expected exactly one generated iOS application project.');
const projectDirectory = resolve(ios, projects[0]);
const projectPath = resolve(projectDirectory, 'project.pbxproj');
const project = xcode.project(projectPath);
project.parseSync();
const objects = project.hash.project.objects;
const nativeTargets = objects.PBXNativeTarget;
const applicationEntry = Object.entries(nativeTargets).find(([key, value]) => !key.endsWith('_comment') && unquote(value.productType) === 'com.apple.product-type.application');
if (!applicationEntry) throw new Error('Generated project has no iOS application target.');
const [appUUID, application] = applicationEntry;
const applicationName = unquote(application.name);
const appConfiguration = objects.XCConfigurationList[application.buildConfigurationList].buildConfigurations[0].value;
const appSettings = objects.XCBuildConfiguration[appConfiguration].buildSettings;
const appBundleId = unquote(appSettings.PRODUCT_BUNDLE_IDENTIFIER);
if (appBundleId !== 'com.example.weddingphotobooth') throw new Error('Update the explicit XCTest application bundle identifier before using a different app identifier.');

// A fresh Expo template has no dependency sections; xcode's helper only adds
// edges when both sections already exist. Initialize them explicitly.
objects.PBXTargetDependency ??= {};
objects.PBXContainerItemProxy ??= {};

let testEntry = Object.entries(nativeTargets).find(([key, value]) => !key.endsWith('_comment') && unquote(value.name) === targetName);
if (!testEntry) {
  // xcode's supported API creates the configuration/product scaffolding. Convert
  // its unit-test product to the native UI-testing product before writing it.
  // addTarget defaults to app->newtarget: restore that edge, then add the correct
  // UI-test->application dependency to avoid a generated build cycle.
  const previousDependencies = [...(application.dependencies ?? [])];
  const added = project.addTarget(targetName, 'unit_test_bundle', 'NativeTests', `${appBundleId}.${testBundleSuffix}`);
  const unwanted = application.dependencies.filter(dependency => !previousDependencies.some(previous => previous.value === dependency.value));
  application.dependencies = previousDependencies;
  for (const dependency of unwanted) {
    const object = objects.PBXTargetDependency[dependency.value];
    if (object?.targetProxy) {
      delete objects.PBXContainerItemProxy[object.targetProxy];
      delete objects.PBXContainerItemProxy[`${object.targetProxy}_comment`];
    }
    delete objects.PBXTargetDependency[dependency.value];
    delete objects.PBXTargetDependency[`${dependency.value}_comment`];
  }
  const target = added.pbxNativeTarget;
  target.productType = '"com.apple.product-type.bundle.ui-testing"';
  const product = objects.PBXFileReference[target.productReference];
  product.path = `"${targetName}.xctest"`;
  product.name = `"${targetName}.xctest"`;
  product.explicitFileType = '"wrapper.cfbundle"';
  project.addBuildPhase([`NativeTests/${sourceName}.swift`], 'PBXSourcesBuildPhase', 'Sources', added.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', added.uuid);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', added.uuid);
  testEntry = [added.uuid, target];
}
const [testUUID, testTarget] = testEntry;
if (!testTarget.dependencies.some(ref => objects.PBXTargetDependency[ref.value]?.target === appUUID)) {
  project.addTargetDependency(testUUID, [appUUID]);
}
if (application.dependencies.some(ref => objects.PBXTargetDependency[ref.value]?.target === testUUID)) {
  throw new Error('Application must not depend on its UI-test target');
}
for (const config of objects.XCConfigurationList[testTarget.buildConfigurationList].buildConfigurations) {
  const settings = objects.XCBuildConfiguration[config.value].buildSettings;
  delete settings.INFOPLIST_FILE;
  Object.assign(settings, {
    GENERATE_INFOPLIST_FILE: 'YES',
    PRODUCT_BUNDLE_IDENTIFIER: `"${appBundleId}.${testBundleSuffix}"`,
    PRODUCT_NAME: '"$(TARGET_NAME)"',
    SWIFT_VERSION: '5.0',
    IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? '16.4',
    TARGETED_DEVICE_FAMILY: '"1,2"',
    TEST_TARGET_NAME: `"${applicationName}"`,
    CODE_SIGNING_ALLOWED: 'NO',
    CLANG_ENABLE_MODULES: 'YES',
    ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
    LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"',
    FRAMEWORK_SEARCH_PATHS: '"$(inherited) $(PLATFORM_DIR)/Developer/Library/Frameworks"',
  });
}
// The xcode API expects a target object, not its UUID string.
const attributes = project.getFirstProject().firstProject.attributes;
if (attributes.TargetAttributes) delete attributes.TargetAttributes.undefined;
project.addTargetAttribute('TestTargetID', appUUID, { uuid: testUUID });
const sourceReference = Object.values(objects.PBXFileReference).find(value => value && typeof value === 'object' && unquote(value.path) === `NativeTests/${sourceName}.swift`);
if (!sourceReference) throw new Error('Native XCTest source reference is missing');
sourceReference.sourceTree = 'SOURCE_ROOT';
const productReference = objects.PBXFileReference[testTarget.productReference];
productReference.name = `"${targetName}.xctest"`;
productReference.path = `"${targetName}.xctest"`;
// xcode's generic target factory populates optional fields as undefined. Omit
// those keys instead of serializing the literal string into project.pbxproj.
function removeUndefined(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
    else removeUndefined(value[key]);
  }
}
removeUndefined(objects);
await mkdir(resolve(ios, 'NativeTests'), { recursive: true });
await copyFile(source, resolve(ios, `NativeTests/${sourceName}.swift`));
await writeFile(projectPath, project.writeSync());

const reference = (uuid, name, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${xml(uuid)}" BuildableName="${xml(product)}" BlueprintName="${xml(name)}" ReferencedContainer="container:${xml(basename(projectDirectory))}"/>`;
const appReference = reference(appUUID, applicationName, `${applicationName}.app`);
const testReference = reference(testUUID, targetName, `${targetName}.xctest`);
const schemeXML = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
  <BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${appReference}</BuildActionEntry>
    <BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${testReference}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="${configuration}" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv="YES">
    <Testables><TestableReference skipped="NO" parallelizable="NO">${testReference}</TestableReference></Testables>
  </TestAction>
  <LaunchAction buildConfiguration="${configuration}" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${appReference}</BuildableProductRunnable></LaunchAction>
  <AnalyzeAction buildConfiguration="${configuration}"/>
</Scheme>
`;
const schemes = resolve(projectDirectory, 'xcshareddata/xcschemes');
await mkdir(schemes, { recursive: true });
await writeFile(resolve(schemes, `${scheme}.xcscheme`), schemeXML);
const relativeRoot = path => relative(root, path).replaceAll('\\', '/');
const plan = {
  project: relativeRoot(projectDirectory),
  workspace: relativeRoot(resolve(ios, `${basename(projectDirectory, '.xcodeproj')}.xcworkspace`)),
  scheme, targetName, appBundleId, testBundleId: `${appBundleId}.${testBundleSuffix}`,
  configuration, deploymentTarget: unquote(appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? '16.4'),
  metroPort: runtime ? null : 8081, fixture: runtime ? 'disabled' : 'synthetic-camera-real-native-storage',
  testSource: relativeRoot(source),
};
await writeFile(resolve(ios, 'native-test-plan.json'), JSON.stringify(plan, null, 2) + '\n');
// Reparse the output as a useful structural check on every repeat invocation.
xcode.project(projectPath).parseSync();
process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
