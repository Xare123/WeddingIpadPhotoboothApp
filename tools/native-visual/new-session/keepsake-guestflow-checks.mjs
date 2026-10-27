/** Current-source full-bleed and host/error keyframes, synthetic device ports. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const root = 'artifacts/visual', sha = b => createHash('sha256').update(b).digest('hex');
const report = { scope: 'Current App native JSX through browser with synthetic camera/files/SQLite/Photos/host authentication/publication and opaque glass fallback. Clean image_gen photos are fictional. No physical iPad camera/save, native accessibility/materials, upload, SMS or real QR scanning proof.', status: 'running', checks: [], screenshots: [], settlementChecks: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
const browser = await launchBrowser();
const snapshot = p => p.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
async function settled(page, id, name) {
  const value = await page.getByTestId(id).evaluate(element => new Promise((resolve, reject) => {
    const start = performance.now(); let old = '', stable = 0;
    function check() {
      const b = element.getBoundingClientRect(), opacities = [];
      for (let n = element; n; n = n.parentElement) opacities.push(Number(getComputedStyle(n).opacity));
      const key = [b.x, b.y, b.width, b.height, element.scrollLeft, ...opacities].map(v => v.toFixed(3)).join(',');
      stable = old === key && opacities.every(v => v >= .999) ? stable + 1 : 0; old = key;
      if (stable >= 4) return resolve({ stableFrames: stable, waitMilliseconds: performance.now() - start, box: b.toJSON(), opacities, scrollLeft: element.scrollLeft });
      if (performance.now() - start > 6000) return reject(new Error('Keyframe did not settle')); requestAnimationFrame(check);
    } check();
  }));
  report.settlementChecks.push({ name, ...value }); const file = `${root}/keepsake-flow-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file); return value;
}
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' }); const page = await context.newPage();
    const load = state => page.goto(`http://127.0.0.1:8791/?state=${state}&count=4&templates=available&effects=available&photos=clean-portrait&network=offline`);
    try {
      await load('attract'); await page.getByTestId('start-session').waitFor(); await settled(page, 'start-session', `attract-${orientation}`);
      await page.getByTestId('start-session').tap(); await page.getByTestId('take-photo').waitFor();
      const camera = await settled(page, 'camera-stage', `camera-${orientation}`), banner = await page.locator('#new-session-fixture-banner').boundingBox();
      assert.equal(camera.box.x, 0); assert.equal(camera.box.width, viewport.width); assert.ok(Math.abs(camera.box.y - banner.height) <= 1); assert.ok(Math.abs(camera.box.bottom - viewport.height) <= 1, 'Camera fills viewport behind overlays except the explicit development-only fixture banner');
      assert.match(await page.getByTestId('take-photo').innerText(), /Start 4 photos/);
      await page.getByTestId('take-photo').tap(); await page.locator('[aria-live="assertive"]').waitFor(); await settled(page, 'camera-stage', `countdown-${orientation}`);
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.snapshot().active.shots.length === 1, undefined, { timeout: 7000 });
      await page.getByTestId('photo-thumbnail-1').waitFor(); await settled(page, 'camera-stage', `camera-progress-${orientation}`);
      await page.getByTestId('cancel-countdown').tap(); await page.getByTestId('take-photo').waitFor(); await settled(page, 'camera-stage', `paused-${orientation}`);
      await page.getByTestId('take-photo').tap(); await page.getByTestId('review-gallery').waitFor({ timeout: 22000 });
      assert.equal((await snapshot(page)).active.shots.length, 4); assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 4);
      await settled(page, 'review-gallery', `review-${orientation}`);
      await page.getByTestId('photo-thumbnail-3').tap(); await page.getByTestId('retake-photo').tap(); await page.getByTestId('take-photo').waitFor();
      assert.match(await page.getByTestId('take-photo').innerText(), /Retake photo 3/); await settled(page, 'camera-stage', `retake-${orientation}`);
      await load('camera'); await page.getByTestId('take-photo').waitFor(); await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.failNextSave = true; });
      await page.getByTestId('take-photo').tap(); await page.getByTestId('retry-save').waitFor({ timeout: 7000 });
      const message = await page.getByTestId('capture-save-status').innerText(); assert.equal(message, 'Photo 1 still needs saving · No photos saved for this set yet');
      assert.equal((await snapshot(page)).active.shots.length, 0); await settled(page, 'camera-stage', `save-error-${orientation}`);
      await page.getByTestId('retry-save').tap(); await page.getByTestId('take-photo').waitFor(); assert.equal((await snapshot(page)).active.shots.length, 1); assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 1);
      await load('ready'); await page.getByRole('button', { name: 'Open host controls', exact: true }).tap(); await page.getByText('Booth controls', { exact: true }).waitFor();
      await settled(page, 'host-timer-3', `host-controls-${orientation}`); await page.getByRole('button', { name: 'Saved sessions', exact: true }).tap(); await page.getByText('On this iPad', { exact: true }).waitFor();
      await settled(page, 'wedding-share-identity', `host-library-${orientation}`);
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('background')); await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      await page.getByTestId('wedding-share-identity').waitFor(); assert.equal(await page.getByText('On this iPad', { exact: true }).count(), 0, 'Background relocks host UI');
      await settled(page, 'wedding-share-identity', `host-relocked-${orientation}`);
      report.checks.push({ orientation, camera, savedCount: 4, cameraCalls: 4, retryMessage: message, checks: ['full-bleed camera behind controls', 'four-photo countdown/progress', 'pause/continue', 'four selected originals', 'no-wait thumbnail3 retake actor', 'truthful zero-saved failure and same-exposure retry', 'host controls/library', 'background host relock'] });
    } finally { await context.close(); }
  }
  report.sourceHashes = JSON.parse(await readFile(`${root}/keepsake-bundle-boundary.json`)).sourceHashes;
  for (const [file, digest] of Object.entries(report.sourceHashes)) assert.equal(sha(await readFile(file)), digest, `${file} changed during guestflow capture`);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (e) { report.status = 'failed'; report.failure = e.stack ?? String(e); throw e; }
finally { await browser.close(); await writeFile(`${root}/keepsake-guestflow-checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, workflows: report.checks.length, screenshots: report.screenshots.length, settlementChecks: report.settlementChecks.length }));
