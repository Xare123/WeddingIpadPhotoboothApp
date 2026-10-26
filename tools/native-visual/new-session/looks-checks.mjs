/** Actual editor/controller + synthetic Canvas JPEGs. Not CoreImage/native proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const report = { scope: 'LOCAL UNPUBLISHED browser fixtures. Actual editor/controller; Canvas recipe approximation, in-memory originals/derivatives, no CoreImage, native file durability, Photos, R2, downloads or SMS verification.', status: 'running', checks: [], screenshots: [], videos: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
report.sourceSHA256 = createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex');
await mkdir('.cache/new-session-visual/looks-videos', { recursive: true });
const browser = await launchBrowser();
const snapshot = page => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
async function pixels(page, testID) {
  return page.getByTestId(testID).evaluate(async element => {
    const image = element.querySelector('img') ?? element;
    const uri = image.src || getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!uri) throw new Error('Actual processed image URI missing');
    const bytes = await (await fetch(uri)).arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0); const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = [0, 0, 0], chroma = 0;
    for (let i = 0; i < data.length; i += 4) { for (let c = 0; c < 3; c++) sum[c] += data[i + c]; chroma += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]); }
    return { uri, width: bitmap.width, height: bitmap.height, byteLength: bytes.byteLength, jpeg: new Uint8Array(bytes)[0] === 255 && new Uint8Array(bytes)[1] === 216, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''), meanRGB: sum.map(v => v / (data.length / 4)), meanChroma: chroma / (data.length / 4), cssFilter: getComputedStyle(element).filter };
  });
}
async function ready(page) {
  await page.getByTestId('look-status').filter({ hasText: 'Preview ready' }).waitFor();
  await page.waitForFunction(() => { const button = document.querySelector('[data-testid="look-apply"]'); return button && button.getAttribute('aria-disabled') !== 'true'; });
}
async function save(page, name) {
  const file = `artifacts/visual/looks-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file);
}
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce', recordVideo: { dir: '.cache/new-session-visual/looks-videos', size: viewport } });
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:8791/?state=review&count=5&effects=available&network=offline');
      await page.getByTestId('choose-look').waitFor();
      const initial = (await snapshot(page)).active, originals = structuredClone(initial.shots);
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-editor').waitFor();
      const originalPixels = await pixels(page, 'look-preview');
      await save(page, `original-${orientation}`);
      const rendered = {};
      for (const preset of ['warm', 'bw', 'film']) {
        await page.getByTestId(`look-preset-${preset}`).tap(); await page.getByTestId('look-intensity-100').tap(); await ready(page);
        rendered[preset] = await pixels(page, 'look-preview');
        assert.equal(rendered[preset].jpeg, true); assert.equal(rendered[preset].cssFilter, 'none');
        assert.notEqual(rendered[preset].sha256, originalPixels.sha256);
        assert.ok(Math.max(rendered[preset].width, rendered[preset].height) <= 1440);
        await save(page, `${preset}-${orientation}`);
      }
      assert.ok(rendered.bw.meanChroma < originalPixels.meanChroma * .1, 'B&W must change actual decoded JPEG chroma');
      assert.ok(rendered.warm.meanRGB[0] > rendered.warm.meanRGB[2], 'Warm output must contain actual warm JPEG pixels');
      await page.getByTestId('look-intensity-25').tap(); await ready(page);
      await save(page, `film-strength25-${orientation}`);
      const quarter = await pixels(page, 'look-preview'); assert.notEqual(quarter.sha256, rendered.film.sha256);
      await page.getByTestId('look-intensity-0').tap(); await ready(page);
      assert.equal((await pixels(page, 'look-preview')).sha256, originalPixels.sha256);
      // Force late completed results to exercise controller generation checks even
      // when the synthetic native port cannot honor cancellation in time.
      await page.evaluate(() => { const c = window.__NEW_SESSION_FIXTURE__; c.effectDelayMs = 180; c.effectsIgnoreCancellation = true; });
      await page.getByTestId('look-preset-warm').tap(); await page.getByTestId('look-preset-bw').tap(); await page.getByTestId('look-intensity-100').tap();
      await ready(page); const newest = await pixels(page, 'look-preview');
      assert.ok(newest.meanChroma < originalPixels.meanChroma * .1);
      await page.waitForTimeout(300);
      assert.equal((await pixels(page, 'look-preview')).sha256, newest.sha256, 'Late warm result cannot replace latest B&W');
      await page.getByTestId('look-cancel').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      assert.deepEqual((await snapshot(page)).active.shots, originals);
      await page.evaluate(() => { const c = window.__NEW_SESSION_FIXTURE__; c.effectDelayMs = 0; c.effectsIgnoreCancellation = false; });
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-preset-warm').tap(); await ready(page);
      const acknowledgedPreview = await pixels(page, 'look-preview');
      await page.getByTestId('look-apply').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      let state = await snapshot(page); const selected = state.active.shots[0];
      assert.equal(selected.sourcePhotoId, originals[0].id); assert.equal(selected.look.preset, 'warm');
      assert.equal(state.active.retakes.find(p => p.id === originals[0].id).fileUri, originals[0].fileUri);
      assert.deepEqual(state.active.shots.slice(1), originals.slice(1)); assert.equal(state.jobs.length, 0);
      const savedPixels = await pixels(page, 'review-gallery');
      assert.equal(savedPixels.jpeg, true); assert.equal(savedPixels.sha256, acknowledgedPreview.sha256, 'Displayed durable JPEG must equal acknowledged synthetic recipe output');
      await save(page, `saved-warm-${orientation}`);
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-preset-original').tap(); await ready(page); await page.getByTestId('look-apply').tap();
      await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      assert.equal((await snapshot(page)).active.shots[0].id, originals[0].id);
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-preset-film').tap(); await ready(page); await page.getByTestId('look-apply').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      await page.getByTestId('retake-photo').tap(); await page.getByTestId('take-photo').tap(); await page.getByTestId('review-gallery').waitFor({ timeout: 8000 });
      state = await snapshot(page); assert.equal(state.active.shots[0].look, undefined); assert.equal(state.active.shots[0].sourcePhotoId, undefined); assert.equal(state.jobs.length, 0);
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-preset-warm').tap();
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('background'));
      await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      assert.equal(await page.getByTestId('look-editor').count(), 0);
      const counters = await page.evaluate(() => ({ renders: window.__NEW_SESSION_FIXTURE__.effectRenders, cancellations: window.__NEW_SESSION_FIXTURE__.effectCancellations, releases: window.__NEW_SESSION_FIXTURE__.effectReleases }));
      assert.ok(counters.cancellations.length > 0); assert.ok(counters.releases.length > 0);
      assert.ok(counters.renders.every(r => /^file:\/\/\/synthetic\/[a-zA-Z0-9-]+\.jpg$/.test(r.sourceUri)), 'Every recipe must use immutable original');
      report.checks.push({ orientation, originalPixels, rendered, quarter, savedPixels, counters, originalIDs: originals.map(p => p.id), originalURIs: originals.map(p => p.fileUri), checks: ['real JPEG pixels for all presets/intensity', 'late supersede ignored', 'cancel preserves originals', 'saved JPEG equals preview', 'Original restores original ID', 'retake clears look', 'background closes editor', 'no queue before confirm'] });
    } finally { await context.close(); const file = `artifacts/visual/looks-demo-${orientation}.webm`; await page.video().saveAs(file); report.videos.push(file); }
  }
  const unavailable = await createContext(browser, report, { viewport: { width: 820, height: 1180 } });
  const page = await unavailable.newPage(); await page.goto('http://127.0.0.1:8791/?state=review&count=5'); await page.getByTestId('review-gallery').waitFor(); assert.equal(await page.getByTestId('choose-look').count(), 0); await unavailable.close();
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []);
  const provenance = JSON.parse(await readFile('artifacts/visual/looks-bundle-boundary.json'));
  report.sourceHashes = provenance.sourceHashes;
  for (const [file, hash] of Object.entries(report.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `${file} changed while recording`);
  assert.equal(createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex'), report.sourceSHA256);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile('artifacts/visual/looks-checks.json', JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, sourceSHA256: report.sourceSHA256 }));
