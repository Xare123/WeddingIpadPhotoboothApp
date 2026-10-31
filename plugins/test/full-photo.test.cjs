const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const plugin = require('../with-full-photo.cjs');
const fixture = path.join(__dirname, 'fixtures/expo-camera-58.0.12');
const appRoot = path.resolve(__dirname, '../../apps/ipad');
const autolinkingRoot = path.dirname(require.resolve('expo-modules-autolinking/package.json'));
function resolveApple(projectRoot, platform) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(autolinkingRoot, 'bin/expo-modules-autolinking.js'),
    'resolve', '--platform', platform, '--json',
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 30000 }));
}
function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'full-photo-contract-'));
  fs.cpSync(fixture, root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('official source fixture has exact pinned provenance hashes', () => {
  for (const spec of plugin.specs) assert.equal(plugin.digest(fs.readFileSync(path.join(fixture, spec.file))), spec.original);
});
test('installed Expo native sources satisfy the same version and full-file contract', () => {
  const root = path.dirname(require.resolve('expo-camera/package.json'));
  assert.equal(plugin.preparePatch(root).length, 3);
});
test('installed iOS autolinker opts only patched camera out of prebuilt modules', t => {
  // Exercise Expo's actual CLI/package discovery, not just our package.json shape.
  // CocoaPods uses "apple"; also cover the supported "ios" CLI spelling.
  for (const platform of ['ios', 'apple']) {
    const resolved = resolveApple(appRoot, platform);
    assert.deepEqual(resolved.configuration?.buildFromSource, ['expo-camera']);
    const camera = resolved.modules.find(module => module.packageName === 'expo-camera');
    assert.ok(camera, 'camera must still be autolinked');
    assert.equal(camera.packageVersion, '58.0.12');
    assert.ok(camera.pods.some(pod => pod.podName === 'ExpoCamera'));
    assert.ok(resolved.modules.some(module => module.packageName === 'expo-modules-core'),
      'unpatched Expo modules must remain linked');
  }

  // A source-only fixture cannot expose this regression. Without the opt-out,
  // this same installed autolinker resolves camera but provides no instruction
  // to CocoaPods to reject its bundled (unpatched) xcframework.
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'full-photo-autolink-'));
  t.after(() => fs.rmSync(controlRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  delete manifest.expo.autolinking.ios.buildFromSource;
  fs.writeFileSync(path.join(controlRoot, 'package.json'), JSON.stringify(manifest));
  fs.symlinkSync(path.resolve(autolinkingRoot, '..'), path.join(controlRoot, 'node_modules'), 'dir');
  for (const platform of ['ios', 'apple']) {
    const control = resolveApple(controlRoot, platform);
    assert.equal(control.configuration?.buildFromSource, undefined);
    assert.ok(control.modules.some(module => module.packageName === 'expo-camera'),
      'control must resolve the same installed camera without the source-build opt-out');
  }
});
test('patch is deterministic and idempotent, byte-writing path precedes stock crop', t => {
  const root = tree(t);
  assert.equal(plugin.applyPatch(root), 3);
  assert.equal(plugin.applyPatch(root), 0);
  const capture = fs.readFileSync(path.join(root, plugin.specs[2].file), 'utf8');
  // Swift uses no parentheses; isolate the processing branch and not pre-exposure guards.
  const process = capture.slice(capture.indexOf('  private func processImageData'));
  const preservation = process.slice(process.indexOf('    if options.preserveFullPhoto {'), process.indexOf('    guard let imageData, var takenImage'));
  assert.match(preservation, /ExpoCameraUtils\.write\(data: imageData, to: path\)/);
  assert.doesNotMatch(preservation, /UIImage|\.crop\(|\.jpegData\(|CapturedPhotoProcessor/);
  assert.match(preservation, /"originalPreserved": true/);
  assert.match(preservation, /UTType\.jpeg\.identifier/);
  assert.match(preservation, /extension: "\.jpg"/);
  assert.match(preservation, /imageData\.base64EncodedString\(\)/);
  assert.match(preservation, /onPictureSaved\(\["data": response, "id": options\.id\]\)/);
  assert.match(capture, /if options\.preserveFullPhoto \{\n        photoSettings = AVCapturePhotoSettings\(format: \[AVVideoCodecKey: AVVideoCodecType\.jpeg\]\)/);
  assert.match(capture, /preserveFullPhoto && options\.pictureRef/);
  const stock = fs.readFileSync(path.join(fixture, plugin.specs[2].file), 'utf8');
  const stockTail = stock.slice(stock.indexOf('    guard let imageData, var takenImage'));
  assert.ok(capture.endsWith(stockTail), 'entire stock processing/crop/response tail unchanged');
});
test('wrong version refuses all writes', t => {
  const root = tree(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"58.0.13"}');
  assert.throws(() => plugin.applyPatch(root), /requires expo-camera/);
  assert.equal(plugin.digest(fs.readFileSync(path.join(root, plugin.specs[0].file))), plugin.specs[0].original);
});
test('missing or repeated anchors fail, even with transforms invoked directly', () => {
  const spec = plugin.specs[0];
  const source = fs.readFileSync(path.join(fixture, spec.file), 'utf8');
  assert.throws(() => spec.transform(source.replace('  var pictureRef: Bool = false\n', '')), /anchor/);
  assert.throws(() => spec.transform(source + '  var pictureRef: Bool = false\n'), /anchor/);
});
test('tampered final input refuses before modifying any earlier file', t => {
  const root = tree(t);
  fs.appendFileSync(path.join(root, plugin.specs[2].file), '\n// drift\n');
  assert.throws(() => plugin.applyPatch(root), /source drift/);
  assert.equal(plugin.digest(fs.readFileSync(path.join(root, plugin.specs[0].file))), plugin.specs[0].original);
});
test('tampering an already patched source fails closed', t => {
  const root = tree(t);
  plugin.applyPatch(root);
  fs.appendFileSync(path.join(root, plugin.specs[1].file), '\n// drift\n');
  assert.throws(() => plugin.applyPatch(root), /source drift/);
});

test('front capture matches mirrored preview without a second image flip; rear remains unmirrored', t => {
  const root = tree(t); plugin.applyPatch(root);
  const capture = fs.readFileSync(path.join(root, 'ios/Current/CameraPhotoCapture.swift'), 'utf8');
  const module = fs.readFileSync(path.join(root, 'ios/CameraViewModule.swift'), 'utf8');
  const app = fs.readFileSync(path.join(appRoot, 'App.tsx'), 'utf8');
  // Exercise the reviewed installed native connection path, not a JS flip helper.
  assert.match(app, /testID="camera-surface" ref=\{camera\} facing="front" mirror=\{true\}/);
  assert.match(app, /CameraView facing="back" style=\{StyleSheet.absoluteFill\} barcodeScannerSettings/);
  assert.match(module, /view\.mirror = mirror \?\? false/);
  assert.match(capture, /connection\?\.isVideoMirrored = captureDelegate\?\.presetCamera == \.front &&\s*\(\(captureDelegate\?\.mirror \?\? false\) \|\| options\.mirror\)/);
  assert.match(capture, /connection\?\.videoOrientation = ExpoCameraUtils\.captureOrientation\(/);
  assert.match(capture, /physicalOrientation: captureDelegate\?\.physicalOrientation \?\? \.unknown/);
  assert.match(capture, /interfaceOrientation: captureDelegate\?\.deviceOrientation \?\? \.unknown/);
  const preserved = capture.slice(capture.indexOf('    if options.preserveFullPhoto {', capture.indexOf('private func processImageData')), capture.indexOf('    guard let imageData, var takenImage'));
  assert.match(preserved, /write\(data: imageData, to: path\)/);
  assert.doesNotMatch(preserved, /applyingFilter|jpegData|oriented\(|scaleX|flipped/);
  assert.doesNotMatch(app, /scaleX:\s*-1|ImageManipulator/);
});
