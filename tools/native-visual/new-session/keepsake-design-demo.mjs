/** Clean photo interaction evidence. Actual JSX/recipes, synthetic native ports. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const root = 'artifacts/visual', sha = b => createHash('sha256').update(b).digest('hex');
const report = { scope: 'Clean fictional image_gen photo interaction recording through actual App/TemplateStudio/controllers. Browser/Canvas and simulated storage/Photos/network/QR-ready boundaries only; not an iOS recording or actual upload, optical capture, Photos save, CoreImage/CoreText rendering, real QR scan or SMS.', status: 'running', checks: [], screenshots: [], videos: [], exports: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
await mkdir('.cache/new-session-visual/keepsake-design-videos', { recursive: true });
const browser = await launchBrowser();
async function ready(page) { await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor(); for (const t of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${t}`).waitFor(); }
async function actual(page, id, withBytes = false) {
  return page.getByTestId(id).evaluate(async (element, withBytes) => {
    const img = element.querySelector('img') ?? element; await img.decode?.();
    const nativeURI = element.getAttribute('data-fixture-native-uri'), bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    const render = window.__NEW_SESSION_FIXTURE__.templateRenders.find(r => r.uri === nativeURI && r.status === 'complete');
    if (!render || render.browserURI !== img.src || render.jpegSHA256 !== sha256) throw new Error('Actual image bytes have no matching current render receipt');
    const bitmap = await createImageBitmap(new Blob([bytes]));
    return { nativeURI, sha256, recipe: JSON.parse(render.recipeJSON), width: bitmap.width, height: bitmap.height, ...(withBytes ? { bytes: Array.from(bytes) } : {}) };
  }, withBytes);
}
async function screenshot(page, name) { await page.waitForTimeout(160); const file = `${root}/keepsake-design-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file); }
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'no-preference', recordVideo: { dir: '.cache/new-session-visual/keepsake-design-videos', size: viewport } });
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:8791/?state=review4&templates=available&effects=available&photos=clean-portrait&network=offline');
      await page.getByTestId('review-gallery').waitFor(); await screenshot(page, `review-${orientation}`);
      const originals = (await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot())).active.shots;
      await page.getByTestId('use-photo').tap(); await ready(page); await screenshot(page, `strip-classic-${orientation}`);
      const defaultRecipe = await actual(page, 'template-preview'); assert.equal(defaultRecipe.recipe.theme, 'classic');
      await page.getByTestId('template-layout-grid').tap(); await ready(page); await page.getByTestId('template-theme-botanical').tap(); await ready(page);
      const grid = await actual(page, 'template-preview'); assert.equal(grid.recipe.layout, 'grid'); assert.equal(grid.recipe.theme, 'botanical');
      await screenshot(page, `grid-botanical-${orientation}`);
      await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-inspect-image').waitFor();
      const inspected = await actual(page, 'template-inspect-image'); assert.deepEqual(inspected.recipe, grid.recipe);
      await page.getByTestId('template-inspect-width').tap(); await screenshot(page, `grid-inspection-width-${orientation}`);
      await page.getByTestId('template-inspect-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(250);
      await page.getByTestId('template-inspect-done').tap();
      await page.getByTestId('template-layout-strip').tap(); await ready(page); await page.getByTestId('template-theme-classic').tap(); await ready(page);
      await page.getByTestId('template-placement-fill').tap(); await ready(page);
      const fill = await actual(page, 'template-preview'); assert.equal(fill.recipe.theme, 'classic'); assert.equal(fill.recipe.layout, 'strip');
      assert.ok(Object.values(fill.recipe.cropsByPhotoId).every(c => c.mode === 'fill' && c.x === 0 && c.y === -1 && c.zoom === 1));
      await screenshot(page, `strip-top-fill-${orientation}`);
      await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-inspect-image').waitFor();
      const full = await actual(page, 'template-inspect-image', true); assert.deepEqual(full.recipe, fill.recipe); assert.deepEqual([full.width, full.height], [1200, 3600]);
      const { bytes, ...info } = full;
      if (orientation === 'portrait') { const file = `${root}/keepsake-clean-portrait-strip-classic-fill-top.jpg`; await writeFile(file, Buffer.from(bytes)); report.exports.push({ file, ...info }); }
      else assert.equal(full.sha256, report.exports[0].sha256, 'Full strip bytes do not depend on UI orientation');
      await screenshot(page, `strip-top-fill-inspection-${orientation}`); await page.getByTestId('template-inspect-done').tap();
      await page.getByTestId('template-save').tap(); await page.getByTestId('saved-keepsake-preview').waitFor(); await page.waitForTimeout(180);
      assert.equal(await page.getByTestId('guest-qr').count(), 0); await screenshot(page, `saved-offline-${orientation}`);
      const state = await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
      const withoutConfirmation = photos => photos.map(({ confirmed, ...photo }) => photo);
      assert.ok(state.active.shots.every(photo => photo.confirmed === true));
      assert.deepEqual(withoutConfirmation(state.active.shots), withoutConfirmation(originals), 'Confirming a keepsake may mark selected shots confirmed but must preserve every original field'); assert.deepEqual(state.active.composite.recipe, fill.recipe);
      await page.evaluate(() => { const c = window.__NEW_SESSION_FIXTURE__; c.setOnline(true); c.acknowledgeReady(true); });
      const retry = page.getByTestId('retry-sharing'); if (await retry.count()) await retry.tap();
      await page.getByTestId('guest-qr').waitFor({ timeout: 20000 }); await screenshot(page, `ready-${orientation}`);
      await page.getByTestId('next-guest').tap(); await page.getByTestId('start-session').waitFor(); await screenshot(page, `next-guests-${orientation}`);
      assert.equal((await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot())).active, null);
      report.checks.push({ orientation, initialRecipe: defaultRecipe.recipe, gridRecipe: grid.recipe, inspected: { ...inspected }, fill: info, originalIds: originals.map(p => p.id), checks: ['selected DOM image bytes match its exact completed render receipt', 'full inspector matches selected preview recipe, not a sibling theme', 'top-aligned explicit Fill preserves original records', 'full-resolution JPEG same in both orientations', 'offline shows no QR', 'synthetic ready acknowledgement reveals QR', 'Next guests clears active session'] });
    } finally { await context.close(); const file = `${root}/keepsake-design-demo-${orientation}.webm`; await page.video().saveAs(file); report.videos.push(file); }
  }
  report.sourceHashes = JSON.parse(await readFile(`${root}/keepsake-bundle-boundary.json`)).sourceHashes;
  for (const [file, hash] of Object.entries(report.sourceHashes)) assert.equal(sha(await readFile(file)), hash, `${file} changed during clean demo`);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile(`${root}/keepsake-design-demo.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, workflows: report.checks.length, videos: report.videos.length, screenshots: report.screenshots.length, exports: report.exports.length }));
