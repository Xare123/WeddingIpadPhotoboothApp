import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNativeCameraMarker } from './native-camera-capability.mjs';

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
