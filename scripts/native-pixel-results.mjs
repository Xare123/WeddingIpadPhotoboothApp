import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_NODES = 5000;
const MAX_DEPTH = 32;
const MAX_JPEG_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const CLASSES = { PhotoEffectsEngineTests: 8, PhotoTemplateEngineTests: 11 };
const SCHEMA_KEYS = new Set(['testNodes', 'nodeType', 'nodeIdentifier', 'nodeIdentifierURL', 'children', 'name', 'result',
  'testStatus', 'identifier', 'identifierURL', 'attachments', 'exportedFileName', 'suggestedHumanReadableName',
  'testIdentifier', 'totalTestCount', 'totalTests', 'passedTests', 'failedTests', 'skippedTests', 'testFailures',
  'testName', 'metadata', 'devices', 'environmentDescription', 'title', 'duration', 'startTime', 'finishTime',
  'statistics', 'status', 'tests', 'testResults', 'summary', 'formatVersion', 'version', 'runs', 'attempts',
  'details', 'configuration', 'sessions', 'metrics', 'activities', 'issues']);

// Shape-only diagnostics are safe for a public annotation. Never echo unknown
// identifiers, paths, attachment labels or arbitrary platform string values.
export function safeSchemaShape(value) {
  let remaining = 48;
  const seen = new WeakSet();
  function shape(input, depth = 0) {
    if (--remaining < 0 || depth > 4) return { type: 'bounded' };
    if (input === null) return { type: 'null' };
    if (typeof input !== 'object') return { type: typeof input };
    if (seen.has(input)) return { type: 'cycle' };
    seen.add(input);
    if (Array.isArray(input)) return { type: 'array', length: input.length, sample: input.length ? shape(input[0], depth + 1) : undefined };
    return { type: 'object', fields: Object.keys(input).sort().slice(0, 24).map(key => ({
      key: SCHEMA_KEYS.has(key) ? key : '[other-key]',
      ...shape(input[key], depth + 1),
    })) };
  }
  return shape(value);
}

function failure(message, value) {
  const error = new Error(message);
  if (value !== undefined) error.diagnosticShape = safeSchemaShape(value);
  return error;
}

function expectedIdentityList(expectedCases) {
  if (!Array.isArray(expectedCases) || expectedCases.length !== 19 || new Set(expectedCases).size !== 19 ||
    expectedCases.some(id => typeof id !== 'string' || !/^(PhotoEffectsEngineTests|PhotoTemplateEngineTests)\.test[A-Za-z0-9_]+$/.test(id))) {
    throw failure('Expected native pixel case inventory must contain nineteen unique known-class methods');
  }
  for (const [name, count] of Object.entries(CLASSES)) {
    if (expectedCases.filter(id => id.startsWith(name + '.')).length !== count) throw failure('Expected native pixel class counts must remain eight plus eleven');
  }
  return [...expectedCases].sort();
}

function canonicalIdentity(value) {
  if (typeof value !== 'string' || value.length > 4096) throw failure('Unsupported native test identifier type');
  let decoded;
  try { decoded = decodeURIComponent(value).trim(); } catch { throw failure('Unsupported native test identifier encoding'); }
  const match = decoded.match(/(?:^|[/.])([A-Za-z_][A-Za-z0-9_]*)[/.](test[A-Za-z0-9_]+)(?:\(\))?$/);
  if (!match) throw failure('Unsupported native test identifier shape');
  return match[1] + '.' + match[2];
}

function caseStatus(value, node) {
  if (typeof value !== 'string') throw failure('Native test case has no supported result field', node);
  const status = value.trim().toLowerCase().replace(/[ _-]+/g, '');
  if (['passed', 'pass', 'success', 'succeeded'].includes(status)) return 'passed';
  if (['failed', 'failure', 'expectedfailure'].includes(status)) return 'failed';
  if (['skipped', 'skip'].includes(status)) return 'skipped';
  if (['notrun', 'notexecuted'].includes(status)) return 'not-run';
  throw failure('Unsupported native test result value', node);
}

function consistentStatuses(node) {
  const fields = ['result', 'testStatus'].filter(name => Object.hasOwn(node, name));
  if (!fields.length) throw failure('Native test case has no supported result field', node);
  const statuses = fields.map(name => caseStatus(node[name], node));
  if (statuses.some(status => status !== statuses[0])) throw failure('Conflicting native test result aliases', node);
  return { status: statuses[0], rawStatus: node[fields[0]] };
}

export function inspectPixelTests(tree, expectedCases) {
  const expected = expectedIdentityList(expectedCases), expectedSet = new Set(expected);
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.testNodes) || !tree.testNodes.length) {
    throw failure('Unsupported native tests-tree schema; testNodes array required', tree);
  }
  const found = new Map(), visited = new WeakSet();
  let nodes = 0;
  function walk(node, depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH || !node || typeof node !== 'object' || Array.isArray(node) || visited.has(node)) {
      throw failure('Native tests tree exceeds structural bounds', node);
    }
    visited.add(node);
    if (typeof node.nodeType !== 'string') throw failure('Unsupported native tests-tree node schema', node);
    if (node.nodeType.toLowerCase().replace(/[ _-]+/g, '') === 'testcase') {
      let id;
      try { id = canonicalIdentity(node.nodeIdentifier); }
      catch { throw failure('Unsupported native test case identity schema', node); }
      if (!expectedSet.has(id)) throw failure('Unexpected native pixel test case identity', node);
      if (found.has(id)) throw failure('Duplicate native pixel test case identity', node);
      if (node.nodeIdentifierURL !== undefined) {
        let alternate;
        try { alternate = canonicalIdentity(node.nodeIdentifierURL); } catch { throw failure('Unsupported alternate native test identity schema', node); }
        if (alternate !== id) throw failure('Conflicting native test case identities', node);
      }
      const { rawStatus, status } = consistentStatuses(node);
      found.set(id, { id, status, rawStatus });
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw failure('Unsupported native tests-tree children schema', node);
    for (const child of node.children ?? []) walk(child, depth + 1);
  }
  for (const node of tree.testNodes) walk(node, 0);
  if (expected.some(id => !found.has(id))) throw failure('Native result is missing required pixel test methods', tree);
  const cases = expected.map(id => found.get(id));
  return {
    expectedCases: expected, discovered: cases.length,
    executed: cases.filter(entry => entry.status === 'passed' || entry.status === 'failed').length,
    passed: cases.filter(entry => entry.status === 'passed').length,
    failures: cases.filter(entry => entry.status === 'failed').length,
    skipped: cases.filter(entry => entry.status === 'skipped').length,
    notRun: cases.filter(entry => entry.status === 'not-run').length,
    perClass: Object.fromEntries(Object.entries(CLASSES).map(([name, count]) => [name, {
      expected: count, passed: cases.filter(entry => entry.id.startsWith(name + '.') && entry.status === 'passed').length,
    }])), cases,
  };
}

export function requirePassingPixelTests(result, summary) {
  const expected = expectedIdentityList(result?.expectedCases);
  if (!Array.isArray(result?.cases) || result.cases.length !== 19 ||
    new Set(result.cases.map(entry => entry?.id)).size !== 19 ||
    result.cases.some(entry => !expected.includes(entry?.id) || entry.status !== 'passed') ||
    result.executed !== 19 || result.passed !== 19 || result.failures !== 0 || result.skipped !== 0 || result.notRun !== 0) {
    throw failure('Every one of the nineteen named native pixel tests must pass without failure, skip or missing execution');
  }
  if (summary !== undefined) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw failure('Unsupported native result-summary count schema', summary);
    const totalFields = ['totalTestCount', 'totalTests'].filter(name => Object.hasOwn(summary, name));
    if (!totalFields.length || ['passedTests', 'failedTests', 'skippedTests'].some(name => !Object.hasOwn(summary, name))) {
      throw failure('Unsupported native result-summary count schema', summary);
    }
    const totals = totalFields.map(name => summary[name]);
    const values = [...totals, summary.passedTests, summary.failedTests, summary.skippedTests];
    if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw failure('Unsupported native result-summary count schema', summary);
    if (totals.some(total => total !== totals[0])) throw failure('Conflicting native result-summary total aliases', summary);
    const total = totals[0];
    if (total !== 19 || summary.passedTests !== 19 || summary.failedTests !== 0 || summary.skippedTests !== 0) {
      throw failure('Native result summary disagrees with nineteen passing named pixel cases', summary);
    }
    if (Object.hasOwn(summary, 'result') || Object.hasOwn(summary, 'testStatus')) {
      if (consistentStatuses(summary).status !== 'passed') throw failure('Native result summary reports a nonpassing result', summary);
    }
  }
  return result;
}

export const EXPECTED_PIXEL_ATTACHMENTS = Object.freeze([
  ...['strip', 'grid'].flatMap(layout => ['classic', 'botanical', 'coastal'].flatMap(theme => [
    { name: `native-v2-clean-portrait-${layout}-${theme}-FULL`, width: layout === 'strip' ? 1200 : 2400, height: layout === 'strip' ? 3600 : 3000 },
    { name: `native-v2-clean-portrait-${layout}-${theme}-PREVIEW`, width: layout === 'strip' ? 480 : 1152, height: 1440 },
  ])),
  { name: 'native-v2-clean-mixed-square-grid-coastal-FULL', width: 2400, height: 2400 },
  { name: 'native-v2-clean-mixed-square-grid-coastal-PREVIEW', width: 1440, height: 1440 },
  { name: 'native-v2-clean-mixed-EXIF-portrait-grid-sage-FULL', width: 2400, height: 3000 },
  { name: 'native-v2-clean-mixed-EXIF-portrait-grid-sage-PREVIEW', width: 1152, height: 1440 },
].map(Object.freeze));

export function jpegDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw failure('Native evidence is not a bounded JPEG');
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2, segments = 0;
  while (offset < bytes.length - 2 && ++segments <= 1024) {
    if (bytes[offset++] !== 0xff) throw failure('Native JPEG marker structure is invalid');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) throw failure('Native JPEG segment is truncated');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw failure('Native JPEG segment is invalid');
    if (sof.has(marker)) {
      if (length < 8 || offset + 7 >= bytes.length) throw failure('Native JPEG frame is truncated');
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (!width || !height) throw failure('Native JPEG dimensions are invalid');
      return { width, height };
    }
    offset += length;
  }
  throw failure('Native JPEG has no supported frame dimensions');
}

const PRODUCERS = new Set([
  'PhotoTemplateEngineTests.testV2AllSixCleanNativeJpegFullAndPreviewAttachments',
  'PhotoTemplateEngineTests.testV2CleanMixedAspectAndExifNativeJpegAttachments',
]);

function inside(root, candidate) {
  const value = relative(root, candidate);
  return value !== '' && value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value);
}

function attachmentFile(root, name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || isAbsolute(name) || name.includes('\\') ||
    name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..')) throw failure('Native attachment path is outside its owned export directory');
  const path = resolve(root, name);
  if (!inside(root, path)) throw failure('Native attachment path is outside its owned export directory');
  let cursor = root;
  for (const part of name.split('/')) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw failure('Native attachment symlink is not allowed');
  }
  const canonical = realpathSync(path), stat = lstatSync(canonical);
  if (!inside(root, canonical) || !stat.isFile()) throw failure('Native attachment is not an owned regular file');
  if (stat.size <= 0 || stat.size >= MAX_JPEG_BYTES) throw failure('Native attachment exceeds its individual byte limit');
  return canonical;
}

export function exportNamedPixelJpegs({ exportDirectory, outputDirectory, manifest, requireComplete = true }) {
  const expected = new Map(EXPECTED_PIXEL_ATTACHMENTS.map(entry => [entry.name, entry]));
  if (!manifest || typeof manifest !== 'object') throw failure('Unsupported native attachment manifest schema', manifest);
  const groups = Array.isArray(manifest) ? manifest : Array.isArray(manifest.attachments) ? [manifest] : null;
  if (!groups || groups.length > 1000) throw failure('Unsupported native attachment manifest schema', manifest);
  let root;
  try {
    if (lstatSync(exportDirectory).isSymbolicLink()) throw failure('Owned native export directory cannot be a symlink');
    root = realpathSync(exportDirectory);
    if (!lstatSync(root).isDirectory()) throw failure('Owned native export directory is invalid');
  } catch { throw failure('Owned native export directory is unavailable'); }
  const entries = [], buffers = [], names = new Set();
  let totalBytes = 0, records = 0;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.attachments)) throw failure('Unsupported native attachment group schema', group);
    for (const record of group.attachments) {
      if (++records > 1000 || !record || typeof record !== 'object' ||
        typeof record.exportedFileName !== 'string' || typeof record.suggestedHumanReadableName !== 'string') {
        throw failure('Unsupported native attachment record schema', record);
      }
      const name = record.suggestedHumanReadableName.replace(/\.(?:jpg|jpeg)$/i, '');
      if (!expected.has(name)) {
        if (name.startsWith('native-v2-')) throw failure('Unexpected named native JPEG evidence', record);
        continue;
      }
      let producer;
      try { producer = canonicalIdentity(group.testIdentifier); } catch { throw failure('Unsupported native attachment producer schema', group); }
      if (!PRODUCERS.has(producer)) throw failure('Native JPEG evidence belongs to an unexpected test method', group);
      const producingMethod = name.startsWith('native-v2-clean-portrait-')
        ? 'PhotoTemplateEngineTests.testV2AllSixCleanNativeJpegFullAndPreviewAttachments'
        : 'PhotoTemplateEngineTests.testV2CleanMixedAspectAndExifNativeJpegAttachments';
      if (producer !== producingMethod) throw failure('Named native JPEG belongs to the wrong producing test method', group);
      if (names.has(name)) throw failure('Duplicate named native JPEG evidence', record);
      names.add(name);
      let bytes;
      try { bytes = readFileSync(attachmentFile(root, record.exportedFileName)); }
      catch (error) {
        if (error.diagnosticShape) throw error;
        throw failure('Native attachment file could not be read safely', record);
      }
      if (bytes.length >= MAX_JPEG_BYTES) throw failure('Native attachment exceeds its individual byte limit');
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw failure('Native JPEG evidence exceeds its total byte limit');
      const dimensions = jpegDimensions(bytes), geometry = expected.get(name);
      if (dimensions.width !== geometry.width || dimensions.height !== geometry.height) throw failure('Native JPEG dimensions disagree with the named output');
      entries.push({ name, file: name + '.jpg', producer, ...dimensions, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
      buffers.push(bytes);
    }
  }
  const missing = EXPECTED_PIXEL_ATTACHMENTS.filter(entry => !names.has(entry.name)).map(entry => entry.name);
  if (requireComplete && missing.length) throw failure('Native result lacks required named JPEG outputs', manifest);
  let output;
  try {
    mkdirSync(outputDirectory, { recursive: true });
    if (lstatSync(outputDirectory).isSymbolicLink()) throw new Error();
    output = realpathSync(outputDirectory);
    if (output === root || inside(root, output) || inside(output, root) || readdirSync(output).length) throw new Error();
  } catch { throw failure('Native JPEG output directory must be owned, empty and separate from export inputs'); }
  entries.forEach((entry, index) => {
    writeFileSync(join(output, entry.file), buffers[index], { flag: 'wx', mode: 0o600 });
    if (createHash('sha256').update(readFileSync(join(output, entry.file))).digest('hex') !== entry.sha256) throw failure('Native JPEG copy did not preserve exact bytes');
  });
  const result = { schemaVersion: 1, complete: missing.length === 0, totalBytes, entries, missing,
    scope: 'Exact exported native XCTest JPEG bytes; JPEG structure/dimensions/hashes checked, not independent visual approval or physical-iPad proof.' };
  writeFileSync(join(output, 'native-jpegs-manifest.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}
