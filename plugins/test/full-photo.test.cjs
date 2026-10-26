const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../with-full-photo.cjs');
const fixture = path.join(__dirname, 'fixtures/expo-camera-58.0.12');
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
