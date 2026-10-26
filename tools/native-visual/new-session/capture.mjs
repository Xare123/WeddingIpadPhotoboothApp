/** Actual App JSX interactions and full-frame QR decoding. Browser fixtures, never native proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext, swipeLeft } from './browser.mjs';
import { decodeFullFrame, decoderVersions } from './qr-decode.mjs';
const viewportSizes = { portrait: { width: 820, height: 1180 }, landscape: { width: 1180, height: 820 } };
const urls = {
  reserved: 'https://photobooth.example/g/' + 'a7'.repeat(32),
  realistic: 'https://photos.gizelleandrami.com/g/d948b21e9fbc4a03952beed701f680cf09e8d382f5c421a9f7da6034cbb16e52',
  'reserved-numeric': 'https://photobooth.example/g/' + '1'.repeat(64),
  'realistic-numeric': 'https://photos.gizelleandrami.com/g/' + '1'.repeat(64),
  'short-numeric': 'https://a.example/g/' + '1'.repeat(64),
};
const report = { scope: 'Actual five-shot App.tsx native JSX through RN-web. Generated synthetic scene, in-memory camera/files/SQLite/Photos/auth/sync. Not iOS, real durability, camera, Photos, native accessibility, phone scanning, network, or SMS verification.', timezoneId: 'America/Los_Angeles', generatedAt: new Date().toISOString(), sourceSHA256: createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex'), decoderVersions, screenshots: [], demonstrations: [], boundedChecks: [], contrastChecks: [], qrChecks: [], errors: [], failures: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
await mkdir('.cache/new-session-visual/videos', { recursive: true });
const browser = await launchBrowser();
const snapshot = page => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
const controls = (page, expression) => page.evaluate(expression);
async function load(page, state, extra = '') {
  await page.goto(`http://127.0.0.1:8791/?state=${state}${extra}`);
  await page.getByText('THE PHOTO STUDIO', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('native-fixture-enabled').count(), 0);
  await page.waitForTimeout(250);
}
async function save(page, state, orientation, { allowVerticalScroll = false } = {}) {
  const file = `artifacts/visual/new-session-${state}-${orientation}.png`;
  const layout = await page.getByRole('button').evaluateAll(elements => {
    const targets = elements.filter(element => element.getAttribute('aria-disabled') !== 'true' && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => ({ label: element.getAttribute('aria-label') || element.textContent, ...element.getBoundingClientRect().toJSON() }));
    return { targets, smallTargets: targets.filter(target => target.width < 43.9 || target.height < 43.9), outOfBounds: targets.filter(target => target.x < -1 || target.right > innerWidth + 1 || target.y < 0 || target.bottom > innerHeight + 1), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  const bytes = await page.screenshot({ path: file });
  report.screenshots.push({ file, state, orientation, allowVerticalScroll, ...layout });
  assert.deepEqual(layout.smallTargets, [], `${file}: enabled touch targets below 44×44`);
  assert.deepEqual(allowVerticalScroll ? layout.outOfBounds.filter(target => target.x < -1 || target.right > page.viewportSize().width + 1) : layout.outOfBounds, [], `${file}: enabled controls outside viewport`);
  assert.equal(layout.horizontalOverflow, false);
  return bytes;
}
async function contrast(locator, label, overWhite = false) {
  const value = await locator.evaluate((element, overWhite) => {
    const parse = color => { const v = color.match(/[\d.]+/g).map(Number); return [...v.slice(0, 3), v[3] ?? 1]; };
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
    let background = [255, 255, 255]; const layers = [];
    if (overWhite) {
      for (let node = element; node; node = node.parentElement) { const color = getComputedStyle(node).backgroundColor; if (parse(color)[3] > 0) { layers.push(color); background = blend(parse(color), background); break; } }
    } else {
      for (let node = element; node; node = node.parentElement) layers.unshift(getComputedStyle(node).backgroundColor);
      for (const color of layers) background = blend(parse(color), background);
    }
    const color = getComputedStyle(element).color;
    const lum = rgb => rgb.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = lum(blend(parse(color), background)), b = lum(background);
    return { foregroundCSS: color, backgroundLayers: layers, backgroundRGB: background, model: overWhite ? 'Actual nearest overlay over hypothetical white image' : 'Actual rendered ancestor background layers', ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  }, overWhite);
  report.contrastChecks.push({ label, requiredRatio: 4.5, ...value });
  assert.ok(value.ratio >= 4.5, `${label}: contrast ${value.ratio}`);
}
async function checkQR(page, bytes, file, expectedURL, context) {
  const decoded = await decodeFullFrame(bytes, expectedURL);
  const svg = await page.getByTestId('guest-qr').locator('svg').evaluate(element => ({ width: Number(element.getAttribute('width')), viewBox: element.getAttribute('viewBox'), box: element.getBoundingClientRect().toJSON() }));
  const quietModules = -Number(svg.viewBox.split(' ')[0]) / (svg.width / decoded.matrixModules);
  report.qrChecks.push({ file, ...context, ...decoded, svg, quietModules });
  assert.equal(decoded.jsQR, expectedURL);
  assert.deepEqual(decoded.zxingCpp, [{ text: expectedURL, error: '' }]);
  assert.ok(quietModules >= 4);
  const viewport = page.viewportSize();
  assert.ok(svg.box.x >= 0 && svg.box.right <= viewport.width && svg.box.y >= 0 && svg.box.bottom <= viewport.height);
}
async function demonstration(orientation, viewport) {
  const context = await createContext(browser, report, { viewport, reducedMotion: 'no-preference', recordVideo: { dir: '.cache/new-session-visual/videos', size: viewport } });
  const page = await context.newPage();
  const video = page.video();
  const videoFile = `artifacts/visual/new-session-demo-${orientation}.webm`;
  const outcome = { orientation, viewport, video: videoFile, motion: 'normal motion; real App animation handlers', checks: [], status: 'running' };
  report.demonstrations.push(outcome);
  try {
    await load(page, 'attract', '&network=offline');
    const provenance = await (await page.request.get('http://127.0.0.1:8791/fixture-provenance.json')).json();
    assert.equal(provenance.sourceSHA256, report.sourceSHA256);
    report.sourceHashes = provenance.sourceHashes;
    await page.waitForTimeout(250);
    await save(page, 'attract', orientation);
    await contrast(page.getByText('FIVE FRAMES. ALL YOURS.', { exact: true }), `${orientation}: attract eyebrow over white image`, true);
    await page.getByTestId('start-session').tap();
    await page.getByTestId('take-photo').waitFor();
    await page.waitForTimeout(300);
    await save(page, 'camera', orientation);
    const cameraBox = await page.getByTestId('synthetic-browser-camera').boundingBox();
    outcome.cameraStage = { ...cameraBox, widthFraction: cameraBox.width / viewport.width, heightFraction: cameraBox.height / viewport.height };
    assert.ok(cameraBox.width >= viewport.width * .9 && cameraBox.height >= viewport.height * .6);
    await page.getByTestId('take-photo').tap();
    await page.getByText('Make it a good one.', { exact: true }).waitFor();
    await contrast(page.getByText('Make it a good one.', { exact: true }), `${orientation}: countdown over worst white frame`, true);
    const progress = page.getByText('PHOTO 1 OF 5', { exact: true });
    await contrast(progress, `${orientation}: photo progress above countdown shade`, true);
    assert.ok(Number(await progress.evaluate(element => getComputedStyle(element.parentElement).zIndex)) > 0, 'Photo progress must render above the countdown shade');
    await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.snapshot().active?.shots.length === 1, undefined, { timeout: 7000 });
    await page.waitForTimeout(380);
    assert.match(await page.getByTestId('photo-thumbnail-1').getAttribute('aria-label'), /saved on this iPad/);
    await save(page, 'camera-progress', orientation);
    await page.getByTestId('cancel-countdown').tap();
    await page.getByTestId('take-photo').waitFor();
    await save(page, 'paused', orientation);
    await page.waitForTimeout(350);
    await page.getByTestId('take-photo').tap();
    await page.getByTestId('review-gallery').waitFor({ timeout: 35000 });
    await page.waitForTimeout(350);
    let state = await snapshot(page);
    assert.equal(state.active.shots.length, 5);
    assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 5);
    assert.equal(state.jobs.length, 0);
    outcome.checks.push('One Start action runs the five-shot sequence; pause/continue preserves the first saved slot; five distinct IDs and no upload jobs before confirmation.');
    await save(page, 'review', orientation);
    const reviewBox = await page.getByTestId('review-gallery').boundingBox();
    outcome.reviewStage = { ...reviewBox, widthFraction: reviewBox.width / viewport.width, heightFraction: reviewBox.height / viewport.height };
    assert.ok(reviewBox.height >= viewport.height * (orientation === 'landscape' ? .7 : .6));
    await swipeLeft(page, page.getByTestId('review-gallery'));
    await page.getByTestId('retake-photo').filter({ hasText: 'Retake photo 2' }).waitFor({ timeout: 4000 });
    outcome.checks.push('Trusted Chromium touch swipe advances actual horizontal review from photo 1 to photo 2.');
    await save(page, 'review-swiped', orientation);
    await page.getByTestId('photo-thumbnail-3').tap();
    outcome.fastRetake = { intendedSlot: 3, labelImmediatelyAfterThumbnail: await page.getByTestId('retake-photo').innerText(), disabledImmediatelyAfterThumbnail: await page.getByTestId('retake-photo').getAttribute('aria-disabled'), actorSleepBeforeRetake: false };
    const before = (await snapshot(page)).active.shots.map(photo => photo.id);
    // No offset wait or artificial settling sleep: the App must preserve the
    // explicit selection or disable Retake until its own scroll settles.
    await page.getByTestId('retake-photo').tap();
    await page.getByTestId('take-photo').waitFor();
    outcome.fastRetake.cameraAction = await page.getByTestId('take-photo').innerText();
    assert.match(outcome.fastRetake.cameraAction, /Retake photo 3/);
    await page.getByTestId('take-photo').tap();
    await page.getByTestId('review-gallery').waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    state = await snapshot(page);
    assert.equal(state.active.shots.length, 5);
    for (let slot = 0; slot < 5; slot++) assert.equal(state.active.shots[slot].id === before[slot], slot !== 2);
    assert.equal(state.active.retakes.length, 1);
    assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 6);
    outcome.checks.push('Immediate thumbnail3→Retake with no actor settling wait targets photo3, replaces only its selected ID, retains four other selections and the prior in-memory original, and returns to review.');
    await save(page, 'review-retake', orientation);
    await page.getByTestId('use-photo').tap();
    await page.getByTestId('retry-sharing').waitFor();
    assert.equal(await page.getByTestId('guest-qr').count(), 0);
    state = await snapshot(page);
    assert.equal(state.jobs.filter(job => job.kind === 'upload' && job.state === 'pending').length, 5);
    await save(page, 'pending', orientation);
    await controls(page, () => { window.__NEW_SESSION_FIXTURE__.acknowledgeReady(false); window.__NEW_SESSION_FIXTURE__.setOnline(true); });
    await page.getByTestId('retry-sharing').tap();
    assert.equal(await page.getByTestId('guest-qr').count(), 0);
    assert.equal((await snapshot(page)).jobs.filter(job => job.kind === 'upload' && job.state === 'complete').length, 5);
    outcome.checks.push('Offline confirmation queues five selected uploads; five upload acknowledgments alone show no QR before the synthetic session-ready acknowledgment.');
    await controls(page, () => window.__NEW_SESSION_FIXTURE__.acknowledgeReady(true));
    await page.getByTestId('retry-sharing').tap();
    await page.getByTestId('guest-qr').waitFor();
    await page.waitForTimeout(300);
    const bytes = await save(page, 'ready', orientation);
    await checkQR(page, bytes, `artifacts/visual/new-session-ready-${orientation}.png`, urls.reserved, { orientation, dpr: 1, origin: 'full demonstrated session' });
    state = await snapshot(page);
    assert.equal(new Set(state.jobs.map(job => job.guestUrl)).size, 1);
    assert.equal(state.jobs[0].guestUrl, urls.reserved);
    await contrast(page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }), `${orientation}: QR caption`);
    await page.getByTestId('next-guest').tap();
    await page.getByTestId('start-session').waitFor();
    await page.waitForTimeout(300);
    assert.equal((await snapshot(page)).active, null);
    assert.equal(await page.getByTestId('guest-qr').count(), 0);
    assert.equal(await page.locator('img[src*="/synthetic/shot/"]').count(), 0);
    assert.equal((await snapshot(page)).sessions.length, 1);
    await save(page, 'next-guests', orientation);
    outcome.checks.push('All-five ready acknowledgment reveals one shared session QR; Next guests clears selected session, guest photos and QR while retaining the in-memory host session history.');
    outcome.events = await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.events);
    let lastExposure = -1;
    for (let index = 0; index < outcome.events.length; index++) if (outcome.events[index].kind === 'synthetic-camera-exposure') {
      if (lastExposure >= 0) assert.ok(outcome.events.slice(lastExposure + 1, index).some(event => event.kind === 'private-save-resolved'));
      lastExposure = index;
    }
    outcome.status = 'passed';
    await page.waitForTimeout(450);
  } catch (error) {
    outcome.status = 'failed'; outcome.failure = error.message;
    outcome.snapshotAtFailure = await snapshot(page).catch(() => null);
    throw error;
  } finally {
    await context.close();
    await video.saveAs(videoFile);
  }
}
try {
  for (const [orientation, viewport] of Object.entries(viewportSizes)) await demonstration(orientation, viewport);
  const context = await createContext(browser, report, { viewport: viewportSizes.portrait, reducedMotion: 'reduce' });
  const page = await context.newPage();
  for (const [orientation, viewport] of Object.entries(viewportSizes)) {
    await page.setViewportSize(viewport);
    await load(page, 'photos-denied');
    await page.getByText('Photos access needed · originals are safe here', { exact: true }).waitFor();
    const before = (await snapshot(page)).active.shots.map(photo => photo.id);
    await page.getByRole('button', { name: 'Save a copy to Photos', exact: true }).tap();
    assert.deepEqual((await snapshot(page)).active.shots.map(photo => photo.id), before);
    assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoPermissionRequests), 1);
    await save(page, 'photos-denied', orientation);
  }
  report.boundedChecks.push('Synthetic denied Photos export is reported separately from five private originals; retrying the mocked permission request keeps all five IDs. No OS Photos export is verified.');
  await page.setViewportSize(viewportSizes.portrait);
  await load(page, 'photos-uncertain');
  await page.getByText('Photos result unconfirmed · check Photos before retrying', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save a copy to Photos', exact: true }).count(), 0);
  await save(page, 'photos-uncertain', 'portrait');
  report.boundedChecks.push('All-uncertain Photos results display a check-Photos notice and omit the no-op guest export retry.');
  await load(page, 'camera', '&permission=denied');
  await page.getByTestId('allow-camera').tap();
  await page.getByTestId('synthetic-browser-camera').waitFor();
  assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraPermissionRequests), 1);
  await load(page, 'camera', '&permission=blocked');
  await page.getByTestId('allow-camera').tap();
  assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.openSettingsCalls), 1);
  report.boundedChecks.push('Denied camera permission grants through a synthetic request; blocked permission invokes only the explicit mocked settings marker.');
  await load(page, 'camera');
  await page.getByTestId('take-photo').tap();
  await page.getByText('Make it a good one.', { exact: true }).waitFor();
  const digits = await page.getByText('Make it a good one.', { exact: true }).evaluate(element => { const text = element.parentElement.querySelector('[aria-live="assertive"]'); const style = getComputedStyle(text); return { opacity: style.opacity, transform: style.transform, prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }; });
  assert.equal(digits.prefersReducedMotion, true);
  assert.equal(Number(digits.opacity), 1);
  assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(digits.transform));
  await save(page, 'reduced-motion-countdown', 'portrait');
  await controls(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('background'));
  await page.waitForTimeout(3300);
  assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 0);
  await controls(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
  await page.getByTestId('take-photo').waitFor();
  await save(page, 'interrupted', 'portrait');
  report.boundedChecks.push({ check: 'Reduced-motion digits remain at scale/opacity1; synthetic background interruption cancels the sequence before exposure and returns paused on foreground.', digits, cameraAdapterCallsAfterInterrupt: 0 });
  await load(page, 'camera');
  await controls(page, () => { window.__NEW_SESSION_FIXTURE__.failNextSave = true; });
  await page.getByTestId('take-photo').tap();
  await page.getByTestId('retry-save').waitFor({ timeout: 7000 });
  assert.equal((await snapshot(page)).active.shots.length, 0);
  await save(page, 'save-retry', 'portrait');
  await page.getByTestId('retry-save').tap();
  await page.getByTestId('take-photo').waitFor();
  assert.equal((await snapshot(page)).active.shots.length, 1);
  assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.cameraCalls), 1);
  report.boundedChecks.push('Synthetic private-save failure shows retry; retry saves the same exposure without a second camera-adapter call. Native journal/filesystem guarantees are not verified.');
  await load(page, 'ready');
  await page.getByRole('button', { name: 'Open host controls', exact: true }).tap();
  await page.getByText('Booth controls', { exact: true }).waitFor();
  await save(page, 'host-controls', 'portrait', { allowVerticalScroll: true });
  await page.getByRole('button', { name: 'Saved sessions', exact: true }).tap();
  await page.getByText('On this iPad', { exact: true }).waitFor();
  await save(page, 'host-library', 'portrait', { allowVerticalScroll: true });
  await page.getByText('Open saved session →', { exact: true }).tap();
  await page.getByText(/5 originals on this iPad ·/).waitFor();
  await save(page, 'host-library-session', 'portrait', { allowVerticalScroll: true });
  await page.getByRole('button', { name: 'Private setup', exact: true }).tap();
  await page.getByText('Connect this booth', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('One-time booth pairing code', { exact: true }).inputValue(), '');
  await save(page, 'host-setup', 'portrait', { allowVerticalScroll: true });
  await page.getByRole('button', { name: 'Done', exact: true }).tap();
  report.boundedChecks.push('Host controls, local-session library and private setup render through synthetic authentication; the pairing field stays blank and no provisioning request is made. Host ScrollViews may require vertical scrolling.');
  await context.close();
  for (const dpr of [1, 2]) {
    const qrContext = await createContext(browser, report, { deviceScaleFactor: dpr, reducedMotion: 'reduce' });
    const qrPage = await qrContext.newPage();
    for (const [orientation, viewport] of Object.entries(viewportSizes)) {
      await qrPage.setViewportSize(viewport);
      for (const [payload, expectedURL] of Object.entries(urls)) {
        await load(qrPage, 'ready', `&payload=${payload}`);
        await qrPage.getByTestId('guest-qr').waitFor();
        const stateName = `qr-${payload}-${dpr}x`;
        const bytes = await save(qrPage, stateName, orientation);
        await checkQR(qrPage, bytes, `artifacts/visual/new-session-${stateName}-${orientation}.png`, expectedURL, { orientation, dpr, payload });
      }
    }
    await qrContext.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unexpectedExternalRequests, []);
  assert.equal(createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex'), report.sourceSHA256, 'App source changed while recording');
  for (const [file, digest] of Object.entries(report.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), digest, `${file} changed while recording`);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failures.push(error.stack ?? String(error)); throw error; }
finally { await browser.close(); await writeFile('artifacts/visual/new-session-checks.json', JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, sourceSHA256: report.sourceSHA256, videos: report.demonstrations.map(value => value.video), screenshots: report.screenshots.length, boundedChecks: report.boundedChecks.length, contrastChecks: report.contrastChecks.length, exactQRMatchesInBothDecoders: report.qrChecks.length, errors: report.errors, unexpectedExternalRequests: report.unexpectedExternalRequests }, null, 2));
