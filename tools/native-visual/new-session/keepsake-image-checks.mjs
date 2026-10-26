/** SDK Image error callback simulation through actual Root handlers, not native decode proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifactRoot = process.argv.includes('--provisional') ? '.cache/keepsake-provisional' : 'artifacts/visual';
await mkdir(artifactRoot, { recursive: true });
const report = { scope: 'Browser fixture SDK boundary simulation: the Image adapter delivers controlled onError callbacks and withholds onLoad. Actual App/TemplateStudio callbacks, controller failure handling and retry actors execute. This is not a failed browser network/decode request or native iOS Image/CoreImage proof.', status: 'running', sourceSHA256: hash(await readFile('apps/ipad/App.tsx')), checks: [], screenshots: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
const browser = await launchBrowser();
const context = await createContext(browser, report, { viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const snapshot = () => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
const failNext = (testID, prefix) => page.evaluate(({ testID, prefix }) => window.__NEW_SESSION_FIXTURE__.failNextImage(testID, prefix), { testID, prefix });
async function save(name) { const file = `${artifactRoot}/keepsake-image-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file); }
async function readyLook() { await page.getByTestId('look-status').filter({ hasText: 'Preview ready' }).waitFor(); assert.notEqual(await page.getByTestId('look-apply').getAttribute('aria-disabled'), 'true'); }
async function readyTemplate() { await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor(); for (const t of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${t}`).waitFor(); }
const callbacks = testID => page.evaluate(testID => [...window.__NEW_SESSION_FIXTURE__.imageCallbacks.values()].filter(c => c.testID === testID).map(c => c.uri), testID);
const faultEvent = testID => page.evaluate(testID => window.__NEW_SESSION_FIXTURE__.imageEvents.findLast(e => e.kind === 'synthetic-sdk-error' && e.testID === testID), testID);
try {
  await page.goto('http://127.0.0.1:8791/?state=review4&templates=available&effects=available&network=offline');
  await page.getByTestId('choose-look').waitFor(); const originals = (await snapshot()).active.shots;
  // Original URI is unchanged on retry; the Root key epoch must remount it.
  await failNext('look-preview', 'file:///synthetic/'); await page.getByTestId('choose-look').tap(); await page.getByTestId('look-retry').waitFor();
  assert.equal(await page.getByTestId('look-apply').getAttribute('aria-disabled'), 'true');
  const originalFailure = await faultEvent('look-preview'); assert.equal(originalFailure.uri, originals[0].fileUri); await save('look-original-error');
  const beforeRenders = await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.effectRenders.length);
  await page.getByTestId('look-retry').tap(); await readyLook();
  assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.effectRenders.length), beforeRenders, 'Identity retry remounts same source without rendering derivative');
  const originalLoads = await page.evaluate(uri => window.__NEW_SESSION_FIXTURE__.imageEvents.filter(e => e.kind === 'sdk-load' && e.testID === 'look-preview' && e.uri === uri).length, originalFailure.uri); assert.ok(originalLoads >= 1);
  assert.deepEqual((await snapshot()).active.shots, originals);
  report.checks.push({ check: 'Original SDK Image error disables Apply; explicit Retry remounts same immutable original URI and recovers on actual onLoad.', failure: originalFailure, originalLoads });
  // Processed render failure must retry the same Warm recipe at a fresh URI.
  await failNext('look-preview', 'file:///synthetic-effects/'); await page.getByTestId('look-preset-warm').tap(); await page.getByTestId('look-retry').waitFor();
  const warmFailure = await faultEvent('look-preview'); assert.ok(warmFailure.uri.startsWith('file:///synthetic-effects/')); assert.equal(await page.getByTestId('look-apply').getAttribute('aria-disabled'), 'true'); await save('look-warm-error');
  await page.getByTestId('look-retry').tap(); await readyLook();
  const warmSuccess = (await callbacks('look-preview')).findLast(uri => uri.startsWith('file:///synthetic-effects/') && uri !== warmFailure.uri); assert.ok(warmSuccess);
  await page.evaluate(({ testID, uri }) => window.__NEW_SESSION_FIXTURE__.replayImageError(testID, uri), { testID: 'look-preview', uri: warmFailure.uri });
  await readyLook(); assert.equal(await page.getByTestId('look-retry').count(), 0); assert.deepEqual((await snapshot()).active.shots, originals); await save('look-warm-recovered');
  report.checks.push({ check: 'Processed SDK Image error goes through Root/controller, disables Apply, preserves originals; same-preset Retry yields fresh file URI; stale old onError is ignored.', failedURI: warmFailure.uri, recoveredURI: warmSuccess });
  await page.getByTestId('look-cancel').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
  // A main template Image error invalidates the receipt and requests all themes anew.
  await failNext('template-preview', 'file:///synthetic-templates/'); await page.getByTestId('use-photo').tap(); await page.getByTestId('template-retry').waitFor();
  const mainFailure = await faultEvent('template-preview'); assert.ok(mainFailure.uri.startsWith('file:///synthetic-templates/')); assert.equal(await page.getByTestId('template-save').getAttribute('aria-disabled'), 'true'); await save('template-main-error');
  await page.getByTestId('template-retry').tap(); await readyTemplate();
  const mainSuccess = (await callbacks('template-preview')).findLast(uri => uri !== mainFailure.uri); assert.ok(mainSuccess);
  await page.evaluate(uri => window.__NEW_SESSION_FIXTURE__.replayImageError('template-preview', uri), mainFailure.uri); await readyTemplate(); assert.equal(await page.getByTestId('template-retry').count(), 0); assert.deepEqual((await snapshot()).active.shots, originals);
  report.checks.push({ check: 'Main template SDK Image error clears receipt and disables Save; explicit Retry yields a fresh same-theme file URI; stale old callback is ignored.', failedURI: mainFailure.uri, recoveredURI: mainSuccess });
  await page.getByTestId('template-back').tap(); await page.getByTestId('review-gallery').waitFor();
  // A nonselected theme card also uses the actual TemplateStudio onError path.
  await failNext('template-theme-preview-coastal', 'file:///synthetic-templates/'); await page.getByTestId('use-photo').tap(); await page.getByTestId('template-retry').waitFor();
  const themeFailure = await faultEvent('template-theme-preview-coastal'); assert.equal(await page.getByTestId('template-save').getAttribute('aria-disabled'), 'true'); await save('template-theme-error');
  await page.getByTestId('template-retry').tap(); await readyTemplate();
  const themeSuccess = (await callbacks('template-theme-preview-coastal')).findLast(uri => uri !== themeFailure.uri); assert.ok(themeSuccess);
  await page.evaluate(uri => window.__NEW_SESSION_FIXTURE__.replayImageError('template-theme-preview-coastal', uri), themeFailure.uri); await readyTemplate();
  await page.getByTestId('template-theme-coastal').tap(); await readyTemplate(); await save('template-theme-recovered');
  assert.deepEqual((await snapshot()).active.shots, originals); assert.equal((await snapshot()).jobs.length, 0); assert.equal((await snapshot()).active.composite, undefined);
  report.checks.push({ check: 'Theme-thumbnail SDK Image error invalidates Save; explicit Retry regenerates card at fresh URI, stale card error ignored, recovered Coastal can be selected; originals and queue untouched.', failedURI: themeFailure.uri, recoveredURI: themeSuccess });
  await failNext('template-inspect-image', 'file:///synthetic-templates/');
  await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-retry').waitFor();
  await page.getByTestId('template-inspector').waitFor({ state: 'detached' });
  const inspectionFailure = await faultEvent('template-inspect-image');
  assert.equal(await page.getByTestId('template-save').getAttribute('aria-disabled'), 'true');
  await save('full-inspection-error');
  await page.getByTestId('template-retry').tap(); await readyTemplate(); await page.getByTestId('template-inspect').tap();
  await page.getByTestId('template-inspect-image').waitFor();
  const inspectionSuccess = (await callbacks('template-inspect-image')).findLast(uri => uri !== inspectionFailure.uri); assert.ok(inspectionSuccess);
  const inspectedDimensions = await page.getByTestId('template-inspect-image').evaluate(async element => { const img = element.querySelector('img'); await img.decode(); const bitmap = await createImageBitmap(await (await fetch(img.src)).blob()); return [bitmap.width, bitmap.height]; });
  assert.deepEqual(inspectedDimensions, [1200, 3600]); await save('full-inspection-recovered');
  await page.getByTestId('template-inspect-done').tap(); assert.deepEqual((await snapshot()).active.shots, originals); assert.equal((await snapshot()).jobs.length, 0);
  report.checks.push({ check: 'Full-resolution inspector SDK Image error executes actual Studio handler, closes modal and invalidates Save; explicit preview retry and reopening yield a fresh genuine full JPEG, preserving originals and empty queue.', failedURI: inspectionFailure.uri, recoveredURI: inspectionSuccess, inspectedDimensions });
  report.sdkImageEvents = await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.imageEvents);
  const provenance = JSON.parse(await readFile(`${artifactRoot}/keepsake-bundle-boundary.json`)); report.sourceHashes = provenance.sourceHashes;
  for (const [file, digest] of Object.entries(report.sourceHashes)) assert.equal(hash(await readFile(file)), digest, `${file} changed during Image regression`);
  assert.equal(hash(await readFile('apps/ipad/App.tsx')), report.sourceSHA256); assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await context.close(); await browser.close(); await writeFile(`${artifactRoot}/keepsake-image-checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, sourceSHA256: report.sourceSHA256 }));
