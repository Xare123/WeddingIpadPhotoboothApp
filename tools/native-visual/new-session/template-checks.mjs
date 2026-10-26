/** Four-photo browser acceptance. Canvas pixels, NOT native CoreImage proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const report = { scope: 'LOCAL UNPUBLISHED browser fixtures. Actual four-photo capture/template/filter controllers. Canvas JPEG approximation, in-memory persistence/Photos/publication acknowledgements. Native CoreImage/CoreText, EXIF/color management, filesystem durability, real upload/R2/download/QR scanning/SMS UNVERIFIED. Four marker-labeled JPEG variants derive from the same owned fictional generated scene, not real distinct poses.', status: 'running', staticChecks: [], checks: [], screenshots: [], videos: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
report.sourceSHA256 = sha(await readFile('apps/ipad/App.tsx'));
await mkdir('.cache/new-session-visual/template-videos', { recursive: true });
const browser = await launchBrowser();
const snapshot = page => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
const currentRecipe = page => page.evaluate(() => JSON.parse(window.__NEW_SESSION_FIXTURE__.templateRenders.at(-1).recipeJSON));
async function ready(page) {
  await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor({ timeout: 20000 });
  for (const theme of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${theme}`).waitFor();
}
async function image(page, id) {
  return page.getByTestId(id).evaluate(async element => {
    const uri = element.querySelector('img')?.src || element.src;
    if (!uri) throw new Error('Rendered JPEG URI missing');
    const bytes = await (await fetch(uri)).arrayBuffer(), bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const sample = (x, y) => { const offset = (Math.floor(y) * bitmap.width + Math.floor(x)) * 4; return [...pixels.slice(offset, offset + 3)]; };
    const strip = bitmap.height > bitmap.width * 2, baseW = strip ? 1200 : 2400, factor = bitmap.width / baseW;
    // Fit edge marker from each distinct JPEG. Default portrait source1122x1402.
    const tileMarkers = Array.from({ length: 4 }, (_, i) => {
      const x = strip ? 60 : 96 + i % 2 * 1128, y = strip ? 60 + i * 834 : 96 + Math.floor(i / 2) * 858;
      const scale = 810 / 1402, dx = (1080 - 1122 * scale) / 2;
      return sample((x + dx + 12 * scale) * factor, (y + 300 * scale) * factor);
    });
    const tileEdges = Array.from({ length: 4 }, (_, i) => {
      const x = strip ? 60 : 96 + i % 2 * 1128, y = strip ? 60 + i * 834 : 96 + Math.floor(i / 2) * 858;
      const scale = 810 / 1402, dx = (1080 - 1122 * scale) / 2;
      return [[600, 12], [12, 300], [1110, 300], [600, 1390]].map(([sx, sy]) => sample((x + dx + sx * scale) * factor, (y + sy * scale) * factor));
    });
    return { uri, width: bitmap.width, height: bitmap.height, jpeg: new Uint8Array(bytes)[0] === 255 && new Uint8Array(bytes)[1] === 216, byteLength: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''), paperRGB: sample(3, 3), tileMarkers, tileEdges, cssFilter: getComputedStyle(element).filter };
  });
}
async function save(page, name) { const file = `artifacts/visual/templates-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file); }
const near = (a, b, tolerance = 20) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce', recordVideo: { dir: '.cache/new-session-visual/template-videos', size: viewport } });
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:8791/?state=attract&templates=available&effects=available&network=offline');
      await page.getByTestId('start-session').tap(); await page.getByTestId('take-photo').tap();
      await page.getByTestId('review-gallery').waitFor({ timeout: 22000 });
      let state = await snapshot(page);
      assert.equal(state.active.targetCount, 4); assert.equal(state.active.shots.length, 4); assert.equal(state.jobs.length, 0);
      assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 4);
      const originalsBeforeRetake = state.active.shots.map(p => ({ id: p.id, uri: p.fileUri }));
      // Preserve the exact actor: thumbnail3 then immediate Retake with no scroll
      // offset wait, settling sleep, or other artificial selection synchronization.
      await page.getByTestId('photo-thumbnail-3').tap();
      const fastRetake = { intendedSlot: 3, labelImmediatelyAfterThumbnail: await page.getByTestId('retake-photo').innerText(), actorSleepBeforeRetake: false };
      await page.getByTestId('retake-photo').tap(); await page.getByTestId('take-photo').waitFor();
      fastRetake.cameraAction = await page.getByTestId('take-photo').innerText(); assert.match(fastRetake.cameraAction, /Retake photo 3/);
      await page.getByTestId('take-photo').tap(); await page.getByTestId('review-gallery').waitFor({ timeout: 8000 });
      state = await snapshot(page); assert.notEqual(state.active.shots[2].id, originalsBeforeRetake[2].id);
      for (const i of [0, 1, 3]) assert.equal(state.active.shots[i].id, originalsBeforeRetake[i].id);
      const rawOriginals = structuredClone(state.active.shots);
      await page.getByTestId('choose-look').tap(); await page.getByTestId('look-preset-warm').tap();
      await page.getByTestId('look-status').filter({ hasText: 'Preview ready' }).waitFor(); await page.getByTestId('look-apply').tap();
      await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.snapshot().active.shots.every(p => p.exportStatus === 'saved'));
      const selected = structuredClone((await snapshot(page)).active.shots);
      assert.equal(selected[2].sourcePhotoId, rawOriginals[2].id);
      await page.getByTestId('use-photo').tap(); await page.getByTestId('template-studio').waitFor(); await ready(page);
      const recipeDefault = await currentRecipe(page);
      assert.ok(Object.values(recipeDefault.cropsByPhotoId).every(c => c.mode === 'fit' && c.x === 0 && c.y === 0 && c.zoom === 1));
      const combinations = [];
      for (const layout of ['strip', 'grid']) {
        await page.getByTestId(`template-layout-${layout}`).tap(); await ready(page);
        for (const theme of ['classic', 'botanical', 'coastal']) {
          await page.getByTestId(`template-theme-${theme}`).tap(); await ready(page);
          const actual = await image(page, 'template-preview'); assert.equal(actual.jpeg, true); assert.equal(actual.cssFilter, 'none');
          assert.deepEqual([actual.width, actual.height], layout === 'strip' ? [480, 1440] : [1440, 1260]);
          const paper = { classic: [246, 241, 231], botanical: [238, 241, 232], coastal: [237, 244, 242] }[theme]; assert.ok(near(actual.paperRGB, paper, 4));
          assert.equal(new Set(actual.tileMarkers.map(rgb => rgb.map(v => Math.round(v / 25)).join(','))).size, 4, 'All four marker identities must be present');
          for (let tile = 0; tile < 4; tile++) for (const edge of actual.tileEdges[tile]) assert.ok(near(edge, actual.tileMarkers[tile], 24), 'Default fit must preserve all four colored source edges');
          await save(page, `${layout}-${theme}-${orientation}`); combinations.push({ layout, theme, ...actual });
        }
      }
      assert.equal(new Set(combinations.map(c => c.sha256)).size, 6, 'All layouts/themes must produce distinct actual JPEGs');
      const beforeSwap = await image(page, 'template-preview');
      await page.getByTestId('template-adjust').tap(); await page.getByTestId('template-photo-1').tap(); await page.getByTestId('template-photo-2').tap(); await ready(page);
      const afterSwap = await image(page, 'template-preview');
      assert.ok(near(afterSwap.tileMarkers[0], beforeSwap.tileMarkers[1])); assert.ok(near(afterSwap.tileMarkers[1], beforeSwap.tileMarkers[0]));
      const swappedRecipe = await currentRecipe(page); assert.deepEqual(swappedRecipe.photoIds.slice(0, 2), [selected[1].id, selected[0].id]);
      await page.getByTestId('template-photo-1').tap(); await page.getByTestId('template-crop-fill').tap(); await ready(page);
      const fill = await image(page, 'template-preview'); assert.notEqual(fill.sha256, afterSwap.sha256);
      await page.getByTestId('template-zoom-in').tap(); await page.getByTestId('template-pan-down').tap(); await page.getByTestId('template-pan-right').tap(); await ready(page);
      const panned = await image(page, 'template-preview'); assert.notEqual(panned.sha256, fill.sha256);
      const cropRecipe = await currentRecipe(page), crop = cropRecipe.cropsByPhotoId[cropRecipe.photoIds[0]];
      assert.ok(crop.x > 0 && crop.y > 0 && crop.zoom > 1 && crop.zoom <= 1.5);
      const scrollSettlement = await page.getByTestId('template-photo-1').evaluate(element => new Promise(resolve => {
        const adjust = element.parentElement.parentElement;
        let rail = adjust.parentElement;
        while (rail && !(rail.scrollHeight > rail.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(rail).overflowY))) rail = rail.parentElement;
        if (!rail) return resolve({ scrollable: false });
        const requested = rail.scrollTop + adjust.getBoundingClientRect().top - rail.getBoundingClientRect().top;
        rail.scrollTop = requested;
        let previous = -1, stable = 0;
        function sample() { const now = rail.scrollTop; stable = Math.abs(now - previous) < .1 ? stable + 1 : 0; previous = now; if (stable >= 4) resolve({ scrollable: true, requested, actual: now, maximum: rail.scrollHeight - rail.clientHeight, stableFrames: stable }); else requestAnimationFrame(sample); }
        requestAnimationFrame(sample);
      }));
      report.staticChecks.push({ orientation, state: 'crop-pan', ...scrollSettlement });
      await save(page, `crop-pan-${orientation}`);
      await page.getByTestId('template-crop-fit').tap(); await ready(page);
      const fitAgain = await currentRecipe(page); assert.deepEqual(fitAgain.cropsByPhotoId[fitAgain.photoIds[0]], { mode: 'fit', x: 0, y: 0, zoom: 1 });
      assert.equal((await image(page, 'template-preview')).sha256, afterSwap.sha256, 'Fit restores all source edges');
      // Suspend a delayed render. The editor must close without selecting a
      // composite, publishing any job, or altering raw/filtered source records.
      await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 200; });
      await page.getByTestId('template-layout-strip').tap();
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('background'));
      await page.getByTestId('template-studio').waitFor({ state: 'detached' });
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      await page.getByTestId('review-gallery').waitFor(); assert.deepEqual((await snapshot(page)).active.shots, selected); assert.equal((await snapshot(page)).jobs.length, 0);
      assert.equal(await page.getByText('Booth controls', { exact: true }).count(), 0);
      await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 0; });
      await page.getByTestId('use-photo').tap(); await ready(page);
      await page.getByTestId('template-layout-grid').tap(); await ready(page); await page.getByTestId('template-theme-botanical').tap(); await ready(page);
      const finalPreview = await image(page, 'template-preview');
      await page.getByTestId('template-save').tap(); await page.getByTestId('saved-keepsake-preview').waitFor({ timeout: 12000 });
      state = await snapshot(page); assert.equal(state.active.confirmed, true); assert.equal(state.active.composite.recipe.theme, 'botanical');
      assert.deepEqual(state.active.shots.map(p => ({ id: p.id, fileUri: p.fileUri, look: p.look })), selected.map(p => ({ id: p.id, fileUri: p.fileUri, look: p.look })));
      const expectedJobs = [...new Set([...selected.map(p => p.id), ...rawOriginals.map(p => p.id), state.active.composite.id])];
      assert.deepEqual(state.jobs.map(j => j.photoId).sort(), expectedJobs.sort()); assert.equal(state.jobs.length, 6);
      const saved = await image(page, 'saved-keepsake-preview'); assert.deepEqual([saved.width, saved.height], [2400, 2100]); assert.equal(saved.jpeg, true);
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.snapshot().active.composite.exportStatus === 'saved');
      assert.equal(await page.getByTestId('keepsake-photos-status').innerText(), 'Your keepsake is also saved in Photos');
      const initialNextGuest = await page.getByTestId('next-guest').boundingBox();
      assert.ok(initialNextGuest.y >= 0 && initialNextGuest.y + initialNextGuest.height <= viewport.height + 1, 'Next guests must fit initial sharing viewport without a scroll action');
      assert.equal(await page.getByTestId('guest-qr').count(), 0); await save(page, `saved-offline-${orientation}`);
      await page.evaluate(() => { const c = window.__NEW_SESSION_FIXTURE__; c.setOnline(true); c.acknowledgeReady(false); });
      await page.getByTestId('retry-sharing').tap(); await page.waitForTimeout(350);
      assert.equal(await page.getByTestId('guest-qr').count(), 0, 'Uploaded without complete acknowledgement must not expose QR');
      await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.acknowledgeReady(true));
      // The actual App periodically retries sharing; the retry button can
      // disappear when that acknowledged refresh wins the race. Await its QR.
      await page.getByTestId('guest-qr').waitFor({ timeout: 20000 });
      const initialQR = await page.getByTestId('guest-qr').boundingBox(), readyNextGuest = await page.getByTestId('next-guest').boundingBox();
      for (const [name, box] of [['QR', initialQR], ['Next guests', readyNextGuest]]) assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, `${orientation}: ${name} must fit initial ready viewport without a scroll action`);
      await save(page, `ready-${orientation}`);
      const counters = await page.evaluate(() => ({ renders: window.__NEW_SESSION_FIXTURE__.templateRenders, cancellations: window.__NEW_SESSION_FIXTURE__.templateCancellations, releases: window.__NEW_SESSION_FIXTURE__.templateReleases, photos: window.__NEW_SESSION_FIXTURE__.photoExportCalls }));
      const full = counters.renders.findLast(r => !r.preview && r.status === 'complete');
      const ack = counters.renders.findLast(r => r.preview && r.recipeJSON === full.recipeJSON && r.status === 'complete');
      assert.deepEqual(full.sourceHashes, ack.sourceHashes); assert.equal(new Set(Object.values(full.sourceHashes)).size, 4);
      assert.ok(counters.photos.some(p => p.photoId === state.active.composite.id)); assert.ok(counters.cancellations.length > 0);
      await page.getByTestId('next-guest').tap(); await page.getByTestId('start-session').waitFor(); assert.equal((await snapshot(page)).active, null);
      assert.equal(await page.getByTestId('saved-keepsake-preview').count(), 0); assert.equal(await page.getByTestId('template-preview').count(), 0); assert.equal(await page.locator('#root img[src^="blob:"]').count(), 0); await save(page, `next-guests-${orientation}`);
      report.checks.push({ orientation, initialNextGuest, initialQR, readyNextGuest, fastRetake, rawOriginals, selected, combinations, beforeSwap, afterSwap, fill, panned, cropRecipe, finalPreview, saved, expectedJobs, counters, checks: ['four-shot automatic capture', 'exact immediate thumbnail3 retake', 'filtered selected JPEG in all six templates', 'four distinct edge marker identities', 'fit preserves edges by default', 'two-tap swaps pixels', 'explicit fill/pan/zoom changes pixels', 'fit restores source edges', 'background cancels and locks host', 'raw/selected unchanged', 'full-size composite saved and Photos adapter acknowledged', 'selected/raw/composite queue deduplicated', 'no QR before complete acknowledgement', 'Next guests removes session images'] });
    } finally { await context.close(); const file = `artifacts/visual/templates-demo-${orientation}.webm`; await page.video().saveAs(file); report.videos.push(file); }
  }
  const context = await createContext(browser, report, { viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8791/?state=review4&count=4'); await page.getByTestId('use-photo').tap(); await page.getByText('Your four photos are saved.', { exact: false }).waitFor(); assert.equal(await page.getByTestId('template-studio').count(), 0); assert.equal((await snapshot(page)).active.composite, undefined);
  await page.goto('http://127.0.0.1:8791/?state=review&count=5'); await page.getByTestId('review-gallery').waitFor(); assert.equal((await snapshot(page)).active.targetCount, 5); await page.getByTestId('use-photo').tap(); await page.getByTestId('next-guest').waitFor(); assert.equal((await snapshot(page)).jobs.length, 5); await save(page, 'legacy-five-portrait');
  await context.close();
  const provenance = JSON.parse(await readFile('artifacts/visual/templates-bundle-boundary.json')); report.sourceHashes = provenance.sourceHashes;
  for (const [file, digest] of Object.entries(report.sourceHashes)) assert.equal(sha(await readFile(file)), digest, `${file} changed during capture`);
  assert.equal(sha(await readFile('apps/ipad/App.tsx')), report.sourceSHA256); assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile('artifacts/visual/templates-checks.json', JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, workflows: report.checks.length, screenshots: report.screenshots.length, videos: report.videos.length, sourceSHA256: report.sourceSHA256 }));
