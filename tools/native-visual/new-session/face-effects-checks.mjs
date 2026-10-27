/** Actual Root UI and controller; NO browser face/artwork implementation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser, createContext } from './browser.mjs';
if (process.argv.includes('--help')) { console.log('Usage: node tools/native-visual/new-session/face-effects-checks.mjs [--provisional]\nRequires the owned loopback face-effects fixture. --help writes nothing.'); process.exit(0); }
assert.ok(process.argv.slice(2).every(argument => argument === '--provisional'));
const provisional = process.argv.includes('--provisional'), root = provisional ? '.cache/face-effects-provisional' : 'artifacts/visual';
await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const boundary = JSON.parse(await readFile(`${root}/face-effects-bundle-boundary.json`));
const toolHashes = {};
for (const file of ['face-effects-checks.mjs', 'face-effects-build-evidence.mjs', 'browser.mjs']) toolHashes['tools/native-visual/new-session/' + file] = hash(await readFile('tools/native-visual/new-session/' + file));
const report = { generatedAt: new Date().toISOString(), status: 'running',
  scope: 'Actual Root JSX and treatment controller in Chromium with explicit synthetic native no-face/error ports. No fake accessory pixels or CSS overlay. Colour-only JPEGs use a separately labeled Canvas approximation. No native Vision, face placement, JPEG engine parity, durable iPad storage, Photos, upload, SMS or VoiceOver proof.',
  sourceHashes: boundary.sourceHashes, fixtureSourceHashes: boundary.fixtureSourceHashes, sourceSHA256: boundary.sourceSHA256,
  nativeSourceHashes: boundary.nativeSourceHashes,
  toolHashes,
  nativeFaceOutputFixtures: false, facePixelScope: boundary.facePixelScope,
  checks: [], screenshots: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [],
};
const browser = await launchBrowser();
const state = (page, fn, arg) => page.evaluate(fn, arg);
const snapshot = page => state(page, () => window.__NEW_SESSION_FIXTURE__.snapshot());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function tick(page, ms) { await page.clock.runFor(ms); await page.evaluate(() => Promise.resolve()); await sleep(12); }
async function seconds(page, n) { for (let i = 0; i < n; i++) await tick(page, 1000); }
async function pixels(page, id = 'look-preview') {
  return page.getByTestId(id).evaluate(async element => {
    const image = element.querySelector('img') ?? element;
    const uri = image.src || getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const bytes = await (await fetch(uri)).arrayBuffer(); const bitmap = await createImageBitmap(new Blob([bytes]));
    return { width: bitmap.width, height: bitmap.height, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''), cssFilter: getComputedStyle(element).filter, nativeURI: element.getAttribute('data-fixture-native-uri') };
  });
}
async function ready(page, expected = /Photo ready|No face was found|No accessory could be placed safely/) {
  await page.getByTestId('look-status').filter({ hasText: expected }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="look-apply"]')?.getAttribute('aria-disabled') !== 'true');
}
async function shot(page, label, orientation) {
  const surface = page.getByTestId('look-editor');
  if (await surface.count()) await surface.evaluate(element => new Promise((resolve, reject) => {
    const started = performance.now(); let frames = 0;
    function step() {
      if (!element.isConnected) return reject(new Error('Editor detached before evidence settled'));
      let ready = true; for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 0.999) ready = false;
      frames = ready ? frames + 1 : 0;
      if (frames >= 4) return resolve(true);
      if (performance.now() - started > 5000) return reject(new Error('Editor fade did not settle'));
      requestAnimationFrame(step);
    }
    step();
  }));
  else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const file = `${root}/face-effects-${label}-${orientation}.png`, bytes = await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    status: document.querySelector('[data-testid="look-status"]')?.textContent ?? null,
    faceButtons: [...document.querySelectorAll('[data-testid^="face-accessory-"]')].map(element => ({ id: element.getAttribute('data-testid'), label: element.getAttribute('aria-label'), ...element.getBoundingClientRect().toJSON() })),
  })); assert.equal(layout.horizontalOverflow, false);
  for (const button of layout.faceButtons) { assert.ok(button.width >= 44 && button.height >= 44, `${button.id} touch target`); assert.ok(button.x >= 0 && button.right <= layout.width && button.y >= 0 && button.bottom <= layout.height, `${button.id} outside viewport`); }
  report.screenshots.push({ file, label, orientation, sha256: hash(bytes), ...layout }); return bytes;
}
async function load(context, scene = 'review4', extra = '') {
  const page = await context.newPage(); await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await page.goto(`http://127.0.0.1:8791/?state=${scene}&count=4&effects=available&faces=available&templates=available&photos=clean-mixed&network=offline&${extra}`);
  await page.getByTestId(scene === 'camera' ? 'take-photo' : 'review-gallery').waitFor(); return page;
}
async function editor(page) { await page.getByTestId('choose-look').tap(); await page.getByTestId('face-accessories').waitFor(); await ready(page); }
async function cancel(page) { await page.getByTestId('look-cancel').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' }); }
const check = (name, orientation, details = {}) => report.checks.push({ name, orientation, passed: true, ...details });
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
    try {
      const capture = await load(context, 'camera'); await capture.waitForFunction(() => document.querySelector('[data-testid="take-photo"]')?.getAttribute('aria-disabled') !== 'true');
      assert.equal(await capture.getByTestId('face-accessories').count(), 0);
      const stage = await capture.getByTestId('camera-stage').boundingBox(), banner = await capture.locator('#new-session-fixture-banner').boundingBox();
      assert.equal(stage.x, 0); assert.equal(stage.width, viewport.width); assert.equal(stage.y, banner.height); assert.equal(stage.y + stage.height, viewport.height);
      await shot(capture, 'unchanged-camera', orientation); await capture.getByTestId('take-photo').tap(); await seconds(capture, 14); await capture.getByTestId('review-gallery').waitFor();
      assert.equal((await snapshot(capture)).active.shots.length, 4); assert.equal(await state(capture, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length), 0);
      check('capture-remains-unfiltered-opt-in-only', orientation, { fullBleed: true, fourPhotos: true, nativeTreatmentRequestsBeforeOptIn: 0 }); await capture.close();

      const page = await load(context); const original = (await snapshot(page)).active;
      await editor(page); const identity = await pixels(page); assert.equal(identity.cssFilter, 'none');
      for (const title of ['None', 'Glasses', 'Tiara', 'Hearts']) await page.getByRole('button', { name: `Accessory: ${title}`, exact: true }).waitFor();
      assert.equal(await page.getByTestId('look-apply').innerText(), 'Use original'); assert.doesNotMatch(await page.getByTestId('look-status').innerText(), /0 faces|zero faces/i);
      await shot(page, 'none-original', orientation);
      for (const accessory of ['glasses', 'crown', 'hearts']) {
        await page.getByTestId(`face-accessory-${accessory}`).tap(); await ready(page, /No face was found/);
        assert.equal((await pixels(page)).sha256, identity.sha256); assert.equal(await page.getByTestId('look-apply').innerText(), 'Use original');
        await shot(page, `synthetic-no-face-${accessory}`, orientation);
      }
      await page.getByTestId('look-apply').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      assert.deepEqual((await snapshot(page)).active.shots.map(photo => photo.id), original.shots.map(photo => photo.id));
      check('none-and-three-truthful-no-face-fallbacks', orientation, { accessoryPixelsProduced: false, originalHash: identity.sha256, metadataAndSelectionUnchanged: true });

      await editor(page); await state(page, () => { window.__NEW_SESSION_FIXTURE__.faceNativeOutcome = 'no-usable-face'; });
      await page.getByTestId('face-accessory-crown').tap(); await ready(page, /No accessory could be placed safely/); assert.equal((await pixels(page)).sha256, identity.sha256);
      await shot(page, 'synthetic-no-usable-face', orientation); await cancel(page);
      check('unsafe-placement-fallback-keeps-original', orientation, { detectedFacesSynthetic: 2, decoratedFaces: 0, nativeDetectionVerified: false });

      await editor(page); await state(page, () => { window.__NEW_SESSION_FIXTURE__.faceNativeOutcome = 'error'; });
      await page.getByTestId('face-accessory-glasses').tap(); await page.getByTestId('look-retry').waitFor();
      assert.equal(await page.getByTestId('look-apply').getAttribute('aria-disabled'), 'true'); assert.doesNotMatch(await page.getByTestId('look-status').innerText(), /Synthetic SDK payload/);
      assert.deepEqual((await snapshot(page)).active.shots.map(photo => photo.id), original.shots.map(photo => photo.id)); await shot(page, 'synthetic-processing-error', orientation);
      await state(page, () => { window.__NEW_SESSION_FIXTURE__.faceNativeOutcome = 'no-face'; }); await page.getByTestId('look-retry').tap(); await ready(page, /No face was found/);
      const retryRecipe = await state(page, () => JSON.parse(window.__NEW_SESSION_FIXTURE__.faceRenders.at(-1).requestedRecipeJSON)); assert.equal(retryRecipe.face.accessory, 'glasses'); await cancel(page);
      check('native-error-actionable-retry-preserves-intent', orientation, { applyDisabledDuringFailure: true, safeGuestMessage: true, retryAccessory: 'glasses' });

      await editor(page); const beforePending = await state(page, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length);
      await state(page, () => { const f = window.__NEW_SESSION_FIXTURE__; f.faceBlocked = true; f.faceIgnoreCancellation = true; f.effectsIgnoreCancellation = true; });
      await page.getByTestId('face-accessory-glasses').tap(); await page.waitForFunction(count => window.__NEW_SESSION_FIXTURE__.faceRenders.length > count, beforePending);
      await page.getByTestId('face-accessory-crown').tap(); await page.getByTestId('face-accessory-hearts').tap();
      assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length), beforePending + 1, 'Newest choice waits for acknowledgement of the cancelled native operation');
      assert.equal(await page.getByTestId('look-apply').getAttribute('aria-disabled'), 'true'); assert.equal((await pixels(page)).sha256, identity.sha256); await shot(page, 'synthetic-pending-no-accessory-pixels', orientation);
      await state(page, () => window.__NEW_SESSION_FIXTURE__.releaseFaceRenders()); await ready(page, /No face was found/);
      assert.equal(await state(page, () => JSON.parse(window.__NEW_SESSION_FIXTURE__.faceRenders.at(-1).requestedRecipeJSON).face.accessory), 'hearts');
      await state(page, () => { window.__NEW_SESSION_FIXTURE__.faceBlocked = true; }); await page.getByTestId('face-accessory-glasses').tap(); await cancel(page); await state(page, () => window.__NEW_SESSION_FIXTURE__.releaseFaceRenders()); await tick(page, 100);
      assert.equal(await page.getByTestId('look-editor').count(), 0); assert.deepEqual((await snapshot(page)).active.shots.map(photo => photo.id), original.shots.map(photo => photo.id));
      check('rapid-choice-serial-cancel-and-late-result', orientation, { overlappingNativeRequests: 0, newestChoice: 'hearts', cancelPreservesOriginals: true, lateResultCannotReopen: true });

      await state(page, () => { const f = window.__NEW_SESSION_FIXTURE__; f.faceIgnoreCancellation = false; f.effectsIgnoreCancellation = false; }); await editor(page);
      await page.getByTestId('look-preset-warm').tap(); await ready(page, /Photo ready/); const warm = await pixels(page);
      await page.getByTestId('face-accessory-glasses').tap(); await ready(page, /No face was found/); assert.equal((await pixels(page)).sha256, warm.sha256, 'No-face fallback preserves the colour look');
      await page.getByTestId('face-accessory-none').tap(); await ready(page); const cached = await pixels(page); assert.equal(cached.sha256, warm.sha256, 'None does not remove the selected colour look'); assert.notEqual(cached.sha256, identity.sha256); assert.equal(cached.cssFilter, 'none');
      const rendersBeforeApply = await state(page, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length);
      await page.getByTestId('look-apply').tap(); await page.getByTestId('look-editor').waitFor({ state: 'detached' });
      assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length), rendersBeforeApply, 'Apply copies the same acknowledged cache file without another render');
      let value = await snapshot(page); const selected = value.active.shots[0];
      assert.equal(selected.sourcePhotoId, original.shots[0].id); assert.equal(selected.treatment.face.accessory, 'none'); assert.equal(selected.treatment.look.preset, 'warm');
      assert.equal((await pixels(page, 'photo-preview')).sha256, cached.sha256); assert.equal(value.jobs.length, 0);
      assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.treatmentCopyInputs.at(-1).sourceUri), cached.nativeURI, 'Persist receives the exact displayed cache URI, not a second same-recipe render');
      await page.waitForFunction(id => window.__NEW_SESSION_FIXTURE__.photoExportCalls.some(call => call.photoId === id), selected.id);
      assert.equal(await state(page, id => window.__NEW_SESSION_FIXTURE__.photoExportCalls.find(call => call.photoId === id).uri, selected.id), selected.fileUri);
      await shot(page, 'saved-colour-only-cache-copy', orientation); await editor(page);
      assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length), rendersBeforeApply, 'Reopening committed cache does not render again');
      assert.equal((await pixels(page)).sha256, cached.sha256); assert.equal(await page.getByTestId('look-status').innerText(), 'Photo ready'); await shot(page, 'reopened-colour-only-cache', orientation); await cancel(page);
      check('fullres-cache-copy-on-apply-and-reopen', orientation, { cacheHash: cached.sha256, durableSelectionHash: cached.sha256, nativeAccessoryRenderingVerified: false, noApplyOrReopenRender: true, rootOriginalPreserved: true });
      await page.close();

      const copyFailure = await load(context); const copyOriginal = (await snapshot(copyFailure)).active; await editor(copyFailure); await copyFailure.getByTestId('look-preset-warm').tap(); await ready(copyFailure);
      await state(copyFailure, () => { window.__NEW_SESSION_FIXTURE__.failNextTreatmentSave = true; }); const copyRenderCount = await state(copyFailure, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length);
      await copyFailure.getByTestId('look-apply').tap(); await copyFailure.getByTestId('look-retry').waitFor(); assert.equal(await state(copyFailure, () => window.__NEW_SESSION_FIXTURE__.faceRenders.length), copyRenderCount);
      assert.deepEqual((await snapshot(copyFailure)).active.shots.map(photo => photo.id), copyOriginal.shots.map(photo => photo.id)); assert.equal((await snapshot(copyFailure)).jobs.length, 0); await shot(copyFailure, 'private-copy-failure', orientation);
      await copyFailure.getByTestId('look-retry').tap(); await ready(copyFailure); await copyFailure.getByTestId('look-apply').tap(); await copyFailure.getByTestId('look-editor').waitFor({ state: 'detached' }); assert.equal((await snapshot(copyFailure)).active.shots[0].treatment.look.preset, 'warm');
      check('private-copy-failure-keeps-selection-and-retries', orientation, { failedApplyDidNotRender: true, originalIDsPreserved: true, laterExplicitRetrySucceeds: true, filesystemFailureVerified: false }); await copyFailure.close();

      const imageFailure = await load(context); await editor(imageFailure); await state(imageFailure, () => window.__NEW_SESSION_FIXTURE__.failNextImage('look-preview', 'file:///synthetic-effects/'));
      await imageFailure.getByTestId('look-preset-warm').tap(); await imageFailure.getByTestId('look-retry').waitFor(); assert.equal(await imageFailure.getByTestId('look-apply').getAttribute('aria-disabled'), 'true');
      const staleImageURI = await state(imageFailure, () => window.__NEW_SESSION_FIXTURE__.imageEvents.find(event => event.kind === 'synthetic-sdk-error' && event.testID === 'look-preview').uri);
      await shot(imageFailure, 'jpeg-presentation-failure', orientation); await imageFailure.getByTestId('look-retry').tap(); await ready(imageFailure); const freshImage = await pixels(imageFailure);
      await state(imageFailure, uri => window.__NEW_SESSION_FIXTURE__.replayImageError('look-preview', uri), staleImageURI); await tick(imageFailure, 50);
      assert.equal((await pixels(imageFailure)).sha256, freshImage.sha256); assert.notEqual(await imageFailure.getByTestId('look-apply').getAttribute('aria-disabled'), 'true');
      check('jpeg-acknowledgement-and-stale-sdk-error', orientation, { failedImageCannotApply: true, explicitRetryAcknowledgedFreshCache: true, oldSDKErrorCannotInvalidateNewest: true, nativeJPEGDecoderVerified: false }); await imageFailure.close();

      const interrupted = await load(context); const beforeInterrupted = (await snapshot(interrupted)).active; await editor(interrupted); await interrupted.getByTestId('look-preset-warm').tap(); await ready(interrupted);
      await state(interrupted, () => { window.__NEW_SESSION_FIXTURE__.treatmentSaveBlocked = true; }); await interrupted.getByTestId('look-apply').tap();
      await interrupted.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.events.some(event => event.kind === 'synthetic-treatment-copy-started'));
      await state(interrupted, () => window.__NEW_SESSION_FIXTURE__.setAppState('background')); await interrupted.getByTestId('look-editor').waitFor({ state: 'detached' });
      const photosBeforeRelease = await state(interrupted, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length);
      await state(interrupted, () => window.__NEW_SESSION_FIXTURE__.releaseTreatmentSaves()); await tick(interrupted, 100); await state(interrupted, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(interrupted, 100);
      assert.deepEqual((await snapshot(interrupted)).active.shots.map(photo => photo.id), beforeInterrupted.shots.map(photo => photo.id));
      assert.equal(await state(interrupted, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), photosBeforeRelease); assert.equal(await interrupted.getByTestId('look-editor').count(), 0); await shot(interrupted, 'background-copy-admission-revoked', orientation);
      check('background-copy-does-not-admit-stale-treatment', orientation, { selectedIDsUnchanged: true, noLatePhotosPromptOrCopy: true, editorRemainsClosed: true, realPowerLossRecoveryVerified: false }); await interrupted.close();

      const reset = await load(context); await editor(reset); await reset.getByTestId('face-accessory-hearts').focus(); await reset.getByTestId('face-accessory-hearts').press('Enter'); await ready(reset, /No face was found/); await reset.getByTestId('look-apply').tap(); await reset.getByTestId('look-editor').waitFor({ state: 'detached' });
      await reset.getByTestId('use-photo').tap(); await reset.getByTestId('template-save').waitFor(); await reset.waitForFunction(() => document.querySelector('[data-testid="template-save"]')?.getAttribute('aria-disabled') !== 'true'); await reset.getByTestId('template-save').tap(); await reset.getByTestId('next-guest').waitFor(); assert.equal(await reset.getByTestId('guest-qr').count(), 0);
      await reset.getByTestId('next-guest').tap(); await reset.getByTestId('start-session').tap(); await reset.waitForFunction(() => document.querySelector('[data-testid="take-photo"]')?.getAttribute('aria-disabled') !== 'true'); await reset.getByTestId('take-photo').tap(); await seconds(reset, 14); await reset.getByTestId('review-gallery').waitFor(); await editor(reset);
      assert.equal(await reset.getByTestId('look-apply').innerText(), 'Use original'); assert.ok((await snapshot(reset)).active.shots.every(photo => !photo.look && !photo.treatment)); await shot(reset, 'next-guests-none-default', orientation);
      check('keyboard-opt-in-and-next-guests-reset', orientation, { keyboardActivation: true, nativeVoiceOverVerified: false, offlineQRHidden: true, nextGuestHasNoTreatment: true }); await reset.close();

      const motion = await load(context); await state(motion, () => window.__NEW_SESSION_FIXTURE__.setAccessibilityPreference('reduceMotionChanged', false));
      await editor(motion); await motion.getByTestId('face-accessory-glasses').tap(); await ready(motion, /No face was found/); await shot(motion, 'normal-motion-settled-no-face', orientation);
      await cancel(motion); assert.equal(await motion.getByTestId('look-editor').count(), 0);
      check('normal-and-reduced-motion-editor-interruption', orientation, { reducedMotionMainMatrix: true, syntheticOSPreferenceSwitchedLive: true, normalMotionSettledScreenshot: true, cancelLeavesNoEditor: true, nativeAnimationVerified: false }); await motion.close();
    } finally { await context.close(); }
    console.log(`Face-effects UI ${orientation}: ${report.checks.filter(check => check.orientation === orientation).length} groups passed.`);
  }
  const legacyContext = await createContext(browser, report, { viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
  try { const page = await legacyContext.newPage(); await page.goto('http://127.0.0.1:8791/?state=review4&count=4&effects=available&network=offline'); await page.getByTestId('choose-look').tap(); await page.getByTestId('look-editor').waitFor(); assert.equal(await page.getByTestId('face-accessories').count(), 0); report.checks.push({ name: 'legacy-native-capability-keeps-existing-looks', passed: true, faceControlsAbsent: true }); }
  finally { await legacyContext.close(); }
  for (const section of ['sourceHashes', 'fixtureSourceHashes', 'nativeSourceHashes']) for (const [file, expected] of Object.entries(boundary[section])) assert.equal(hash(await readFile(file)), expected, `${file} changed after bundle`);
  for (const [file, expected] of Object.entries(toolHashes)) assert.equal(hash(await readFile(file)), expected, `${file} changed during checks`);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile(`${root}/face-effects-checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, groups: report.checks.length, screenshots: report.screenshots.length }));
