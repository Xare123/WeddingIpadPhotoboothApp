import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACE_CASES, FACE_JPEGS, requireAppleOnlyPackage, requireIsolatedChanges, requireFaceCases, parseFaceXunit, inspectFaceJpegs, faceInputs } from './face-effects-proof.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passing = () => FACE_CASES.map(id => ({ id, failed: false, skipped: false }));
function xml(rows = passing(), extra = '') {
  return `<testsuites><testsuite tests="${rows.length}" failures="0" errors="0" skipped="0" ${extra}>`
    + rows.map(row => {
      const [cls, name] = row.id.split('.');
      return `<testcase classname="FaceEffectsPrototypeTests.${cls}" name="${name}">${row.failed ? '<failure/>' : ''}${row.skipped ? '<skipped/>' : ''}</testcase>`;
    }).join('') + '</testsuite></testsuites>';
}
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'wedding-face-proof-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
function images(t) {
  const path = directory(t);
  // Validator fixtures only: NOT Vision/rendering evidence. A JPEG comment gives the six
  // samples unique bytes without editing or creating any public native evidence image.
  for (const [i, name] of FACE_JPEGS.entries()) {
    const bytes = readFileSync(join(root, `apps/ipad/native-tests/fixtures/studio/studio-portrait-${2 + i % 3}.jpg`));
    const text = Buffer.from(`validator-only-${i}`), header = Buffer.from([0xff, 0xfe, 0, text.length + 2]);
    writeFileSync(join(path, name), Buffer.concat([bytes.subarray(0, 2), header, text, bytes.subarray(2)]));
  }
  return path;
}

test('source guard permits only prototype files and its independent runner', () => {
  requireIsolatedChanges(['prototypes/FaceEffects/Sources/A.swift', '.github/workflows/face-effects-prototype.yml', 'scripts/face-effects-proof.mjs']);
  for (const name of ['apps/ipad/App.tsx', 'apps/ipad/modules/wedding-photo-effects/ios/PhotoEffectsEngine.swift',
    'plugins/with-full-photo.cjs', 'services/api/src/index.ts', 'package-lock.json', '.github/workflows/ios-release-runtime.yml',
    'prototypes/FaceEffects/../../apps/ipad/App.tsx', '/prototypes/FaceEffects/x', 'prototypes/Other/x']) {
    assert.throws(() => requireIsolatedChanges([name]), /outside its isolated boundary/);
  }
  assert.throws(() => requireIsolatedChanges(null));
});
test('native evidence requires all 39 exact identities without omission, duplication, unknown or nonpassing rows', () => {
  assert.equal(FACE_CASES.length, 39);
  assert.deepEqual(requireFaceCases(passing()), { executed: 39, passed: 39, failed: 0, skipped: 0 });
  const duplicate = passing(); duplicate[0] = { ...duplicate[1] };
  const unknown = passing(); unknown[0].id = 'Unrecognized.testFake';
  const failed = passing(); failed[3].failed = true;
  const skipped = passing(); skipped[5].skipped = true;
  for (const value of [null, [], passing().slice(1), duplicate, unknown, failed, skipped]) assert.throws(() => requireFaceCases(value));
});
test('actual SwiftPM manifest must exclude external dependencies, plugins and application targets', () => {
  const targets = [{ name: 'FaceEffectsPrototype', type: 'regular' }, { name: 'FaceEffectsPrototypeTests', type: 'test' }];
  requireAppleOnlyPackage({ dependencies: [], targets });
  for (const value of [null, { dependencies: [{}], targets }, { dependencies: [], targets: [] },
    { dependencies: [], targets: [...targets, { name: 'Extra', type: 'plugin' }] },
    { dependencies: [], targets: [{ name: 'FaceEffectsPrototype', type: 'executable' }, targets[1]] }]) assert.throws(() => requireAppleOnlyPackage(value));
});
test('actual XCTest XML shape normalizes module/class names and verifies executed cases', () => {
  const result = parseFaceXunit(xml()); assert.equal(result.executed, 39); assert.equal(result.failed, 0);
  assert.deepEqual(result.cases, [...FACE_CASES].sort());
  const withClass = xml().replace(/name="(test\w+)"/g, (_whole, method) => {
    const cls = FACE_CASES.find(id => id.endsWith('.' + method)).split('.')[0];
    return `name="${cls}.${method}"`;
  });
  assert.equal(parseFaceXunit(withClass).executed, 39);
});
test('XML omissions, failed/error/skipped cases and suite failures never pass', () => {
  const failed = passing(); failed[0].failed = true;
  const skipped = passing(); skipped[0].skipped = true;
  for (const value of [xml(passing().slice(1)), xml(failed), xml(skipped),
    xml().replace('errors="0"', 'errors="1"'), xml().replace('skipped="0"', 'skipped="1"'),
    xml().replace('<testcase ', '<testcase ').replace('</testcase>', '<error/></testcase>')]) {
    assert.throws(() => parseFaceXunit(value));
  }
});
test('oversized, malformed and entity-bearing XML are rejected without parsing external data', () => {
  for (const value of [null, '<broken', 'x'.repeat(1024 * 1024 + 1), '<!DOCTYPE x><x/>', '<!ENTITY x "x"><x/>'])
    assert.throws(() => parseFaceXunit(value));
});
test('JPEG header guard checks expected distinct images and hashes at their real dimensions', t => {
  const rows = inspectFaceJpegs(images(t));
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map(row => row.sha256)).size, 6);
  assert.ok(rows.every(row => row.width === 960 && row.height === 1200 && row.bytes > 0));
  assert.equal(rows.filter(row => row.kind === 'actual-Vision-still').length, 3);
  assert.equal(rows.filter(row => row.kind === 'controlled-anchor-diagnostic').length, 3);
  assert.ok(rows.every(row => row.producer.startsWith('AppleFaceEffectsTests.test')));
});
test('missing, extra and identical JPEGs cannot masquerade as complete native output', t => {
  const missing = images(t); rmSync(join(missing, FACE_JPEGS[0])); assert.throws(() => inspectFaceJpegs(missing));
  const extra = images(t); writeFileSync(join(extra, 'private-photo.png'), 'not evidence'); assert.throws(() => inspectFaceJpegs(extra));
  const duplicate = images(t); copyFileSync(join(duplicate, FACE_JPEGS[0]), join(duplicate, FACE_JPEGS[1])); assert.throws(() => inspectFaceJpegs(duplicate));
});
test('unchanged original, wrong dimensions, invalid JPEG and empty output are rejected', t => {
  for (const name of ['source', 'landscape', 'invalid', 'empty']) {
    const output = images(t), path = join(output, FACE_JPEGS[0]);
    if (name === 'source') copyFileSync(join(root, 'apps/ipad/native-tests/fixtures/studio/studio-portrait-1.jpg'), path);
    if (name === 'landscape') copyFileSync(join(root, 'apps/ipad/native-tests/fixtures/studio/studio-landscape-1.jpg'), path);
    if (name === 'invalid' || name === 'empty') writeFileSync(path, name === 'empty' ? '' : 'not jpeg');
    assert.throws(() => inspectFaceJpegs(output));
  }
});
test('symlinks and hardlinks are refused before publication', t => {
  for (const mode of ['symlink', 'hardlink']) {
    const output = images(t), path = join(output, FACE_JPEGS[0]); rmSync(path);
    const source = join(output, FACE_JPEGS[1]);
    if (mode === 'symlink') symlinkSync(source, path); else linkSync(source, path);
    assert.throws(() => inspectFaceJpegs(output));
  }
});
test('current source manifest proves shipping isolation and the fixed synthetic fixture', () => {
  const manifest = faceInputs(root);
  assert.equal(manifest.shippingSourceUnchanged, true); assert.equal(manifest.expectedCases.length, 39);
  assert.equal(Object.keys(manifest.sourceSHA256).length, 11);
  assert.ok(Object.values(manifest.sourceSHA256).every(hash => /^[a-f0-9]{64}$/.test(hash)));
});
