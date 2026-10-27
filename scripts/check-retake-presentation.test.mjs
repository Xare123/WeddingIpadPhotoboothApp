import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const guard = join(root, 'scripts/check-retake-presentation.mjs');
function run(repository, output) {
  return spawnSync(process.execPath, ['--import', 'tsx', guard, repository, output], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
}
function scratch(action) {
  const directory = mkdtempSync(join(tmpdir(), 'retake-presentation-test-'));
  try { return action(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('normal aggregate runs the actual Retake handler checks', () => scratch(directory => {
  const output = join(directory, 'report.json');
  const result = run(root, output);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.checksPassed, 3);
  assert.equal(report.checksFailed, 0);
}));

test('readiness guard rejects removal of the actual Retake reset', () => scratch(directory => {
  const source = readFileSync(join(root, 'apps/ipad/App.tsx'), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  function findHandler(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'retakePhoto') handlers.push(node);
    ts.forEachChild(node, findHandler);
  }
  findHandler(ast);
  assert.equal(handlers.length, 1);
  const resets = [];
  function findReset(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'updateCameraReady' && node.arguments.length === 1 &&
        node.arguments[0].kind === ts.SyntaxKind.FalseKeyword) resets.push(node);
    ts.forEachChild(node, findReset);
  }
  findReset(handlers[0]);
  assert.equal(resets.length, 1, 'One source reset is required for the negative control');
  const reset = resets[0];
  const mutated = source.slice(0, reset.getStart(ast)) + source.slice(reset.getEnd());
  mkdirSync(join(directory, 'apps/ipad/src'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'apps/ipad/App.tsx'), mutated);
  for (const file of ['review-selection.ts', 'session-capture.ts', 'capture-timing.ts']) {
    copyFileSync(join(root, 'apps/ipad/src', file), join(directory, 'apps/ipad/src', file));
  }
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  const result = run(directory, join(directory, 'report.json'));
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, 'The mutated reset must not pass');
  assert.match(result.stderr, /Individual Retake must clear previously-ready camera state/,
    'Failure must come from readiness protection, not loading or fixture setup');
}));
