import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EXPECTED_PIXEL_ATTACHMENTS, exportNamedPixelJpegs, inspectPixelTests, jpegDimensions, requirePassingPixelTests, safeSchemaShape } from './native-pixel-results.mjs';

const cases = ['PhotoEffectsEngineTests', 'PhotoTemplateEngineTests'].flatMap((name, index) =>
  Array.from({ length: index === 0 ? 8 : 11 }, (_, number) => `${name}.testCase${number}`));
const summary = { totalTestCount: 19, passedTests: 19, failedTests: 0, skippedTests: 0 };
const tree = () => ({ testNodes: [{ nodeType: 'Test Plan', children: ['PhotoEffectsEngineTests', 'PhotoTemplateEngineTests'].map(name => ({
  nodeType: 'Unit test suite', name, children: cases.filter(id => id.startsWith(name + '.')).map(id => ({
    nodeType: 'Test Case', nodeIdentifier: 'test://fixture/PixelTests/' + id.replace('.', '/') + '()', result: 'Passed',
  })),
})) }] });
const leaves = value => value.testNodes[0].children.flatMap(node => node.children);

test('nineteen named modern-tree cases establish the exact eight/eleven inventory', () => {
  const value = inspectPixelTests(tree(), cases);
  assert.equal(value.executed, 19); assert.equal(value.passed, 19); assert.equal(value.discovered, 19);
  assert.deepEqual(value.perClass, { PhotoEffectsEngineTests: { expected: 8, passed: 8 }, PhotoTemplateEngineTests: { expected: 11, passed: 11 } });
  assert.equal(requirePassingPixelTests(value, summary), value);
  assert.deepEqual(value.cases.map(entry => entry.id), [...cases].sort());
});

test('failed, skipped and unexecuted methods stay visible and can never become passing aggregate evidence', () => {
  for (const status of ['Failed', 'Skipped', 'Not Run', 'Expected Failure']) {
    const input = tree(); leaves(input)[0].result = status;
    const result = inspectPixelTests(input, cases);
    assert.equal(result.passed, 18);
    assert.equal(result.discovered, 19);
    assert.equal(result.executed, ['Failed', 'Expected Failure'].includes(status) ? 19 : 18);
    assert.throws(() => requirePassingPixelTests(result, summary), /nineteen named/);
  }
  const input = tree(); leaves(input)[0].result = 'Failed'; leaves(input)[1].result = 'Skipped'; leaves(input)[2].result = 'Not Run';
  const result = inspectPixelTests(input, cases);
  assert.equal(result.executed, 17); assert.equal(result.failures, 1); assert.equal(result.skipped, 1); assert.equal(result.notRun, 1);
});

test('status aliases may agree semantically but contradictory or invalid aliases cannot conceal failure or skip', () => {
  for (const alternate of ['Success', 'passed', 'Succeeded']) {
    const input = tree(); leaves(input)[0].testStatus = alternate;
    assert.equal(requirePassingPixelTests(inspectPixelTests(input, cases)).passed, 19);
  }
  for (const alternate of ['Failed', 'Skipped', 'Not Run', null, undefined, 'PRIVATE unknown']) {
    const input = tree(); leaves(input)[0].testStatus = alternate;
    assert.throws(() => inspectPixelTests(input, cases), error => !!error.diagnosticShape && !error.message.includes('PRIVATE'));
  }
  const singleAlias = tree(); leaves(singleAlias)[0].testStatus = leaves(singleAlias)[0].result; delete leaves(singleAlias)[0].result;
  assert.equal(requirePassingPixelTests(inspectPixelTests(singleAlias, cases)).passed, 19);
});

test('duplicate, missing, foreign and conflicting identities fail closed without leaking unknown identifiers', () => {
  const mutations = [
    input => input.testNodes[0].children[0].children.pop(),
    input => { leaves(input)[1].nodeIdentifier = leaves(input)[0].nodeIdentifier; },
    input => { leaves(input)[0].nodeIdentifier = 'PrivateClass/testPrivate()'; },
    input => { leaves(input)[0].nodeIdentifierURL = 'PhotoEffectsEngineTests/testDifferent()'; },
    input => { delete leaves(input)[0].nodeIdentifier; },
    input => { leaves(input)[0].nodeIdentifier = '%broken-private'; },
  ];
  for (const mutate of mutations) {
    const input = tree(); mutate(input);
    assert.throws(() => inspectPixelTests(input, cases), error => !error.message.includes('Private') && !!error.diagnosticShape);
  }
  for (const expected of [cases.slice(1), [...cases.slice(1), cases[1]], cases.map(id => id.replace('PhotoTemplateEngineTests', 'ForeignClass'))]) {
    assert.throws(() => inspectPixelTests(tree(), expected), /inventory|class counts/);
  }
});

test('unsupported result/schema, depth and cycles cannot fall back to a passing summary count', () => {
  for (const input of [{ totalTestCount: 19 }, { testNodes: [] }, { testNodes: [{ name: 'private' }] }]) {
    assert.throws(() => inspectPixelTests(input, cases), error => !!error.diagnosticShape);
  }
  const input = tree(); leaves(input)[0].result = 'PRIVATE unknown result';
  assert.throws(() => inspectPixelTests(input, cases), error => !!error.diagnosticShape && !error.message.includes('PRIVATE'));
  const cyclic = tree(); cyclic.testNodes[0].children.push(cyclic.testNodes[0]);
  assert.throws(() => inspectPixelTests(cyclic, cases), /structural bounds/);
  const deep = tree(); let node = deep.testNodes[0];
  for (let i = 0; i < 40; i++) { const next = { nodeType: 'Suite', children: [] }; node.children.push(next); node = next; }
  assert.throws(() => inspectPixelTests(deep, cases), /structural bounds/);
});

test('passing guard rejects forged case counts and summary disagreement or missing summary fields', () => {
  const result = inspectPixelTests(tree(), cases);
  for (const changed of [{ ...result, passed: 20 }, { ...result, failures: 1 }, { ...result, skipped: 1 },
    { ...result, cases: result.cases.slice(1) }, { ...result, cases: result.cases.map((entry, i) => i ? entry : { ...entry, status: 'skipped' }) }]) {
    assert.throws(() => requirePassingPixelTests(changed));
  }
  for (const bad of [{ ...summary, totalTestCount: 20 }, { ...summary, failedTests: 1 }, { ...summary, skippedTests: 1 }, {},
    { ...summary, passedTests: '19' }]) assert.throws(() => requirePassingPixelTests(result, bad));
});

test('summary total aliases must agree and explicit summary failure cannot hide behind passing counts', () => {
  const result = inspectPixelTests(tree(), cases);
  assert.equal(requirePassingPixelTests(result, { ...summary, totalTests: 19 }), result);
  const singleAlias = { ...summary, totalTests: 19 }; delete singleAlias.totalTestCount;
  assert.equal(requirePassingPixelTests(result, singleAlias), result);
  assert.equal(requirePassingPixelTests(result, { ...summary, result: 'Passed', testStatus: 'Success' }), result);
  for (const bad of [{ ...summary, totalTests: 20 }, { ...summary, totalTests: null }, { ...summary, totalTests: '19' },
    { ...summary, result: 'Failed' }, { ...summary, result: 'Passed', testStatus: 'Skipped' }]) {
    assert.throws(() => requirePassingPixelTests(result, bad), error => !!error.diagnosticShape);
  }
});

test('public schema diagnostics expose bounded key/type information rather than values or secret-looking keys', () => {
  const input = { testNodes: [{ nodeType: 'Private type', nodeIdentifier: 'https://private.example/g/private-token', result: '+12025550123' }],
    ['ghp_' + 'x'.repeat(30)]: 'private value', ['../private/path']: 'private value' };
  const shaped = JSON.stringify(safeSchemaShape(input));
  for (const secret of ['Private type', 'https://', 'private-token', '+12025550123', 'ghp_', '../private/path', 'private value']) assert.ok(!shaped.includes(secret));
  assert.ok(shaped.includes('nodeIdentifier') && shaped.includes('string') && shaped.includes('[other-key]'));
  assert.ok(shaped.length < 10000);
});

// Synthetic headers exercise structure/geometry guards only; these bytes are
// never represented as actual Apple-encoded images or guest-photo fixtures.
function jpeg(width, height, byteLength = 17) {
  const value = Buffer.alloc(Math.max(17, byteLength), 0);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]).copy(value);
  value[value.length - 2] = 0xff; value[value.length - 1] = 0xd9;
  return value;
}

function attachmentFixture(t, count = 28) {
  const directory = mkdtempSync(join(tmpdir(), 'wedding-pixel-results-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const exportDirectory = join(directory, 'export'), outputDirectory = join(directory, 'public'); mkdirSync(exportDirectory);
  const manifest = [
    { testIdentifier: 'PhotoTemplateEngineTests/testV2AllSixCleanNativeJpegFullAndPreviewAttachments()', attachments: [] },
    { testIdentifier: 'PhotoTemplateEngineTests/testV2CleanMixedAspectAndExifNativeJpegAttachments()', attachments: [] },
    { testIdentifier: 'PhotoTemplateEngineTests/testV2AllSixCleanNativeJpegFullAndPreviewAttachments()', attachments: [] },
  ];
  EXPECTED_PIXEL_ATTACHMENTS.slice(0, count).forEach((entry, index) => {
    const exportedFileName = 'exported-' + index + '.jpg';
    writeFileSync(join(exportDirectory, exportedFileName), jpeg(entry.width, entry.height));
    manifest[index < 12 ? 0 : index < 16 ? 1 : 2].attachments.push({ exportedFileName, suggestedHumanReadableName: entry.name });
  });
  return { directory, exportDirectory, outputDirectory, manifest };
}

test('all twenty-eight named native outputs preserve exact exported bytes and expected dimensions', t => {
  const fixture = attachmentFixture(t);
  const result = exportNamedPixelJpegs(fixture);
  assert.equal(result.complete, true); assert.equal(result.entries.length, 28); assert.deepEqual(result.missing, []);
  result.entries.forEach((entry, index) => {
    const original = readFileSync(join(fixture.exportDirectory, 'exported-' + index + '.jpg'));
    assert.deepEqual(readFileSync(join(fixture.outputDirectory, entry.file)), original);
    assert.equal(entry.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(entry.width, EXPECTED_PIXEL_ATTACHMENTS[index].width);
  });
  assert.equal(JSON.parse(readFileSync(join(fixture.outputDirectory, 'native-jpegs-manifest.json'))).complete, true);
});

test('legitimate partial failed-run evidence can be retained but cannot satisfy complete passing evidence', t => {
  const fixture = attachmentFixture(t, 1);
  assert.throws(() => exportNamedPixelJpegs(fixture), /lacks required/);
  assert.equal(existsSync(fixture.outputDirectory), false);
  const result = exportNamedPixelJpegs({ ...fixture, requireComplete: false });
  assert.equal(result.complete, false); assert.equal(result.entries.length, 1); assert.equal(result.missing.length, 27);
});

const observedAttachmentUUID = '6D96F847-5D91-43F9-B2B1-4F707D4B7014';

test('observed Xcode zero-index UUID filenames normalize only approved names and preserve exact bytes and producers', t => {
  const fixture = attachmentFixture(t);
  for (const group of fixture.manifest) for (const [index, record] of group.attachments.entries()) {
    record.suggestedHumanReadableName += '_0_' + observedAttachmentUUID + (index % 2 ? '.jpg' : '.jpeg');
  }
  assert.equal(fixture.manifest[0].attachments[0].suggestedHumanReadableName,
    'native-v2-clean-portrait-strip-classic-FULL_0_6D96F847-5D91-43F9-B2B1-4F707D4B7014.jpeg');
  const result = exportNamedPixelJpegs(fixture);
  assert.equal(result.complete, true); assert.equal(result.entries.length, 28);
  result.entries.forEach((entry, index) => {
    assert.equal(entry.name, EXPECTED_PIXEL_ATTACHMENTS[index].name);
    const original = readFileSync(join(fixture.exportDirectory, 'exported-' + index + '.jpg'));
    assert.deepEqual(readFileSync(join(fixture.outputDirectory, entry.file)), original);
    assert.equal(entry.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(entry.producer, (index < 12 || index >= 16)
      ? 'PhotoTemplateEngineTests.testV2AllSixCleanNativeJpegFullAndPreviewAttachments'
      : 'PhotoTemplateEngineTests.testV2CleanMixedAspectAndExifNativeJpegAttachments');
  });
});

test('unobserved counters, malformed UUIDs, trailing text and unapproved suffixed names fail closed', t => {
  const base = EXPECTED_PIXEL_ATTACHMENTS[0].name;
  const suffix = '_0_' + observedAttachmentUUID + '.jpeg';
  for (const label of [
    base + '_1_' + observedAttachmentUUID + '.jpeg', base + '_00_' + observedAttachmentUUID + '.jpeg',
    base + '_-1_' + observedAttachmentUUID + '.jpeg', base + suffix + '.extra', base + suffix + '\n', base + suffix + '\r\n',
    base + '_0_' + observedAttachmentUUID + '-extra.jpeg', base + '_0_' + observedAttachmentUUID,
    base + '_0_' + observedAttachmentUUID.replace('-', '') + '.jpeg',
    base + '_0_' + observedAttachmentUUID.slice(1) + '.jpeg',
    base + '_0_' + observedAttachmentUUID.replace('6', 'G') + '.jpeg',
    base + '_0_{' + observedAttachmentUUID + '}.jpeg',
    'native-v2-unapproved-output' + suffix,
  ]) {
    const fixture = attachmentFixture(t);
    fixture.manifest[0].attachments[0].suggestedHumanReadableName = label;
    assert.throws(() => exportNamedPixelJpegs(fixture), /Unexpected named native JPEG/);
    assert.equal(existsSync(fixture.outputDirectory), false);
  }
});

test('plain and observed suffixed aliases cannot duplicate evidence or bypass producer, path or geometry guards', t => {
  const duplicate = attachmentFixture(t), first = duplicate.manifest[0].attachments[0];
  duplicate.manifest[0].attachments.push({ ...first,
    suggestedHumanReadableName: first.suggestedHumanReadableName + '_0_' + observedAttachmentUUID + '.jpeg' });
  assert.throws(() => exportNamedPixelJpegs(duplicate), /Duplicate named native JPEG/);
  assert.equal(existsSync(duplicate.outputDirectory), false);
  for (const change of [
    value => { value.manifest[0].testIdentifier = value.manifest[1].testIdentifier; },
    value => { value.manifest[0].attachments[0].exportedFileName = '../outside.jpg'; },
    value => { writeFileSync(join(value.exportDirectory, 'exported-0.jpg'), jpeg(3, 4)); },
  ]) {
    const fixture = attachmentFixture(t);
    fixture.manifest[0].attachments[0].suggestedHumanReadableName += '_0_' + observedAttachmentUUID + '.jpeg';
    change(fixture);
    assert.throws(() => exportNamedPixelJpegs(fixture), /wrong producing|safely|dimensions disagree/);
    assert.equal(existsSync(fixture.outputDirectory), false);
  }
});

test('duplicate labels, unexpected native labels, wrong producers and unknown manifest schemas fail closed', t => {
  for (const change of [
    value => value.manifest[0].attachments.push({ ...value.manifest[0].attachments[0] }),
    value => { value.manifest[0].attachments[0].suggestedHumanReadableName = 'native-v2-unexpected-private'; },
    value => { value.manifest[0].testIdentifier = 'ForeignClass/testPrivate()'; },
    value => { value.manifest[0].testIdentifier = value.manifest[1].testIdentifier; },
    value => { delete value.manifest[0].attachments[0].suggestedHumanReadableName; },
  ]) {
    const fixture = attachmentFixture(t); change(fixture);
    assert.throws(() => exportNamedPixelJpegs(fixture), error => !error.message.includes('private') && !error.message.includes('ForeignClass'));
    assert.equal(existsSync(fixture.outputDirectory), false);
  }
  const fixture = attachmentFixture(t);
  for (const manifest of [{}, null, { unknown: [] }]) assert.throws(() => exportNamedPixelJpegs({ ...fixture, manifest }), /manifest schema/);
});

test('export paths cannot traverse, escape through symlinks, or overwrite retained output files', t => {
  const traversal = attachmentFixture(t);
  writeFileSync(join(traversal.directory, 'outside.jpg'), jpeg(1200, 3600));
  traversal.manifest[0].attachments[0].exportedFileName = '../outside.jpg';
  assert.throws(() => exportNamedPixelJpegs(traversal), /safely/);
  const linked = attachmentFixture(t);
  writeFileSync(join(linked.directory, 'outside.jpg'), jpeg(1200, 3600));
  symlinkSync(join(linked.directory, 'outside.jpg'), join(linked.exportDirectory, 'linked.jpg'));
  linked.manifest[0].attachments[0].exportedFileName = 'linked.jpg';
  assert.throws(() => exportNamedPixelJpegs(linked), /safely/);
  const preserved = attachmentFixture(t); mkdirSync(preserved.outputDirectory);
  const retained = join(preserved.outputDirectory, 'keep.txt'); writeFileSync(retained, 'keep unchanged');
  assert.throws(() => exportNamedPixelJpegs(preserved), /owned, empty/);
  assert.equal(readFileSync(retained, 'utf8'), 'keep unchanged');
});

test('wrong geometry, malformed JPEG, individual and cumulative byte overflow cannot become evidence', t => {
  const wrong = attachmentFixture(t); writeFileSync(join(wrong.exportDirectory, 'exported-0.jpg'), jpeg(3, 4));
  assert.throws(() => exportNamedPixelJpegs(wrong), /dimensions disagree/);
  const broken = attachmentFixture(t); writeFileSync(join(broken.exportDirectory, 'exported-0.jpg'), 'not a JPEG');
  assert.throws(() => exportNamedPixelJpegs(broken), /not a bounded JPEG/);
  const large = attachmentFixture(t); writeFileSync(join(large.exportDirectory, 'exported-0.jpg'), jpeg(1200, 3600, 6 * 1024 * 1024));
  assert.throws(() => exportNamedPixelJpegs(large), /safely|individual byte/);
  const total = attachmentFixture(t);
  EXPECTED_PIXEL_ATTACHMENTS.forEach((entry, index) => writeFileSync(join(total.exportDirectory, 'exported-' + index + '.jpg'), jpeg(entry.width, entry.height, 2200000)));
  assert.throws(() => exportNamedPixelJpegs(total), /total byte limit/);
  assert.equal(existsSync(total.outputDirectory), false);
  for (const bytes of [Buffer.alloc(0), Buffer.from([255, 216, 255, 217]), Buffer.from([255, 216, 255, 192, 0, 255, 255, 217])]) {
    assert.throws(() => jpegDimensions(bytes));
  }
});
