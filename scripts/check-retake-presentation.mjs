import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Execute the actual reviewed handler bodies, not a rewritten copy of their logic.
// The reviewed bodies use the in-memory synthetic dependencies below. This is
// not native rendering, device, camera, database, Photos or network testing.
if (process.argv.length !== 4) throw new Error('Usage: node --import tsx scripts/check-retake-presentation.mjs REPOSITORY NEW_REPORT_JSON');
const root = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const app = readFileSync(join(root, 'apps/ipad/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const { createReviewSelection } = await import(pathToFileURL(join(root, 'apps/ipad/src/review-selection.ts')));
const { sessionIsComplete } = await import(pathToFileURL(join(root, 'apps/ipad/src/session-capture.ts')));
function body(name) {
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1, `One actual source handler required: ${name}`);
  return found[0];
}
function actual(name, dependencies) {
  const source = ts.transpileModule(body('photoSlot') + '\n' + body(name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), source + `\nreturn ${name};`)(...Object.values(dependencies));
}
function fixture() {
  const session = {
    id: 'synthetic-session', targetCount: 4, createdAt: 0, confirmed: false,
    shots: Array.from({ length: 4 }, (_, shotIndex) => ({
      id: `synthetic-original-${shotIndex}`, shotIndex, confirmed: false, createdAt: 0,
      fileUri: `file:///synthetic-original-${shotIndex}.jpg`, exportStatus: 'saved',
    })),
  };
  const state = { screen: 'review', retakeSlot: undefined, activeSlot: 3, cameraReady: false, message: 'old status', modal: false };
  const reviewSelection = { current: createReviewSelection() };
  const dependencies = {
    sessionRef: { current: session }, busy: false, exporting: false,
    lookActive: { current: false }, lookSaving: { current: false },
    templateActive: { current: false }, templateSaving: { current: false },
    reviewSelection,
    setRetakeSlot: value => { state.retakeSlot = value; },
    setActiveSlot: value => { state.activeSlot = value; },
    updateCameraReady: value => { state.cameraReady = value; },
    setMessage: value => { state.message = value; },
    setScreen: value => { state.screen = value; },
    setRetakeAllVisible: value => { state.modal = value; },
    retakeAllIntent: { current: null }, actionLock: { current: false },
    runner: { current: { isBusy: () => false } }, exportLock: { current: false },
    failedPhoto: undefined, AppState: { currentState: 'active' }, sessionIsComplete,
  };
  return { session, state, dependencies };
}
const results = [];
{
  const f = fixture(); const before = structuredClone(f.session);
  f.dependencies.reviewSelection.current.select(0);
  // Intermediate native-scroll positions must not displace explicit slot intent.
  f.dependencies.reviewSelection.current.scroll(900, 300, [0, 1, 2, 3]);
  actual('retakePhoto', f.dependencies)();
  assert.equal(f.state.screen, 'camera');
  assert.equal(f.state.retakeSlot, 0);
  assert.equal(f.state.activeSlot, 0);
  assert.equal(f.state.cameraReady, false);
  assert.equal(f.state.modal, false, 'Individual Retake has no confirmation modal');
  assert.deepEqual(f.session, before, 'Navigation never replaces or deletes an original');
  results.push('individual Retake selects camera/slot one without a modal or original mutation');
}
{
  const f = fixture(); f.session.confirmed = true; const before = structuredClone(f.session);
  actual('retakePhoto', f.dependencies)();
  assert.equal(f.state.screen, 'review');
  assert.equal(f.state.retakeSlot, undefined);
  assert.deepEqual(f.session, before);
  results.push('confirmed selection is protected from an individual-retake mutation');
}
{
  const f = fixture(); const before = structuredClone(f.session);
  actual('requestRetakeAll', f.dependencies)();
  assert.equal(f.state.screen, 'review');
  assert.equal(f.state.modal, true, 'Only Retake All requests its confirmation modal');
  assert.deepEqual(f.dependencies.retakeAllIntent.current.photoIds, f.session.shots.map(value => value.id));
  assert.deepEqual(f.session, before);
  results.push('Retake All opens confirmation while preserving the four selections');
}
const report = {
  appSHA256: createHash('sha256').update(app).digest('hex'),
  checksPassed: results.length, checksFailed: 0, results,
  limit: 'Actual source handler behavior with synthetic memory-only dependencies; no native rendering, accessibility, touch, camera or device proof.',
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
