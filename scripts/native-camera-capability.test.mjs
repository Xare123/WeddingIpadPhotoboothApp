import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { verifyNativeCameraMarker, verifyNativeFrameArt } from './native-camera-capability.mjs';

const marker = Buffer.from('preserveFullPhotoAvailable');
const header = Buffer.from('cffaedfe', 'hex');
const info = { CFBundleExecutable: 'WeddingPhotobooth' };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'wedding-camera-marker-')), app = join(base, 'WeddingPhotobooth.app');
  mkdirSync(app); t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, app, binary: join(app, info.CFBundleExecutable) };
}

test('native marker spanning read chunks is found and the exact binary is hashed', t => {
  const { app, binary } = fixture(t);
  const bytes = Buffer.concat([header, Buffer.alloc(65536 - header.length - 7), marker, Buffer.from('tail')]);
  writeFileSync(binary, bytes);
  const result = verifyNativeCameraMarker(app, info);
  assert.equal(result.compiledMarkerFound, true);
  assert.equal(result.scanned[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.scanned[0].bytes, bytes.length);
  assert.ok(result.scope.includes('not runtime camera behavior'));
});

test('a JavaScript-only capability reference cannot satisfy native camera evidence', t => {
  const { app, binary } = fixture(t);
  writeFileSync(binary, Buffer.concat([header, Buffer.from('stock-native-camera')]));
  writeFileSync(join(app, 'main.jsbundle'), marker);
  assert.throws(() => verifyNativeCameraMarker(app, info), /native marker is absent/);
  writeFileSync(binary, marker);
  assert.throws(() => verifyNativeCameraMarker(app, info), /not a Mach-O binary/);
});

test('a linked dynamic camera framework can provide the native marker', t => {
  const { app, binary } = fixture(t);
  writeFileSync(binary, Buffer.concat([header, Buffer.from('app-loader')]));
  const framework = join(app, 'Frameworks', 'ExpoCamera.framework'); mkdirSync(framework, { recursive: true });
  writeFileSync(join(framework, 'ExpoCamera'), Buffer.concat([header, marker]));
  const result = verifyNativeCameraMarker(app, info);
  assert.equal(result.scanned.length, 2);
  assert.equal(result.scanned[0].markerFound, false);
  assert.equal(result.scanned[1].markerFound, true);
});

test('missing, outside, empty and malformed native candidates fail without reading a JS or external substitute', t => {
  const { base, app, binary } = fixture(t);
  for (const executable of ['../outside', '', '.', '..', 'nested/file']) {
    assert.throws(() => verifyNativeCameraMarker(app, { CFBundleExecutable: executable }));
  }
  writeFileSync(binary, ''); assert.throws(() => verifyNativeCameraMarker(app, info), /bounded app-owned/);
  rmSync(binary);
  const outside = join(base, 'outside'); writeFileSync(outside, Buffer.concat([header, marker]));
  symlinkSync(outside, binary);
  assert.throws(() => verifyNativeCameraMarker(app, info), /bounded app-owned/);
});

const artRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../design/frame-art-v1');
const artNames = ['Classic-Ivory', 'Sage-Botanical', 'Coastal-Sea-Glass'];
function artFixture(t) {
  const value = fixture(t), bundle = join(value.app, 'WeddingFrameArt.bundle'); mkdirSync(bundle);
  for (const name of artNames) copyFileSync(join(artRoot, name + '-Text-Free-Artwork.png'), join(bundle, name + '-Text-Free-Artwork.frameart'));
  return { ...value, bundle };
}

test('production app resource bundle contains all three unoptimized exact approved artwork bytes', t => {
  const { app, bundle } = artFixture(t), result = verifyNativeFrameArt(app);
  assert.equal(result.exactOriginalArtworkFound, true); assert.equal(result.entries.length, 3);
  for (const entry of result.entries) {
    const bytes = readFileSync(join(app, entry.file));
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(entry.bytes, bytes.length);
    assert.deepEqual(bytes, readFileSync(join(artRoot, entry.file.split('/').at(-1).replace(/\.frameart$/, '.png'))));
  }
  assert.match(result.scope, /not app rendering/);
});

test('production frame verification fails on missing bundle, missing art, changed bytes or unexpected art', t => {
  const absent = fixture(t); assert.throws(() => verifyNativeFrameArt(absent.app));
  for (const mutate of [
    ({ bundle }) => rmSync(join(bundle, artNames[0] + '-Text-Free-Artwork.frameart')),
    ({ bundle }) => writeFileSync(join(bundle, artNames[0] + '-Text-Free-Artwork.frameart'), 'bad'),
    ({ bundle }) => { const path = join(bundle, artNames[0] + '-Text-Free-Artwork.frameart'); const bytes = readFileSync(path); bytes[100] ^= 1; writeFileSync(path, bytes); },
    ({ bundle }) => writeFileSync(join(bundle, 'unexpected.frameart'), 'bad'),
  ]) { const value = artFixture(t); mutate(value); assert.throws(() => verifyNativeFrameArt(value.app)); }
});

test('production frame verification rejects bundle or asset symlinks even if target bytes match', t => {
  const one = artFixture(t), outside = join(one.base, 'external.bundle');
  mkdirSync(outside); rmSync(one.bundle, { recursive: true }); symlinkSync(outside, one.bundle);
  assert.throws(() => verifyNativeFrameArt(one.app), /without symlinks/);
  const two = artFixture(t), file = join(two.bundle, artNames[0] + '-Text-Free-Artwork.frameart');
  rmSync(file); symlinkSync(join(artRoot, artNames[0] + '-Text-Free-Artwork.png'), file);
  assert.throws(() => verifyNativeFrameArt(two.app), /without symlinks/);
  const three = artFixture(t), alias = join(three.base, 'AppAlias.app'); symlinkSync(three.app, alias);
  assert.throws(() => verifyNativeFrameArt(alias), /owned app directory/);
});
