/** Actual Root/controller checks; synthetic native orientation/camera/storage ports. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser, createContext } from './browser.mjs';
import { decodeFullFrame, decoderVersions } from './qr-decode.mjs';
if (process.argv.includes('--help')) { console.log('Usage: node tools/native-visual/new-session/orientation-retake-checks.mjs [--provisional]\nRequires the owned loopback orientation-retake fixture. --help writes nothing.'); process.exit(0); }
assert.ok(process.argv.slice(2).every(argument => argument === '--provisional'), 'Unknown argument');
const provisional = process.argv.includes('--provisional');
const root = provisional ? '.cache/orientation-retake-provisional' : 'artifacts/visual';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(root, { recursive: true });
const boundary = JSON.parse(await readFile(`${root}/orientation-retake-bundle-boundary.json`));
const toolHashes = {};
for (const file of ['orientation-retake-checks.mjs', 'orientation-retake-build-evidence.mjs', 'browser.mjs', 'qr-decode.mjs']) toolHashes['tools/native-visual/new-session/' + file] = hash(await readFile('tools/native-visual/new-session/' + file));
const report = { generatedAt: new Date().toISOString(), status: 'running',
  scope: 'Actual current Root JSX, orientation controller, capture runner, template editor and sharing classifier in Chromium. Explicit synthetic native orientation, OS auth/lifecycle, camera promise, storage, Photos and network ports. sessionStorage simulates preferences across reload; it is not Keychain. Not native rotation, iPad capture/Photos/durability, VoiceOver, live upload/SMS or phone scanning verification.',
  sourceSHA256: boundary.sourceSHA256, sourceHashes: boundary.sourceHashes, fixtureSourceHashes: boundary.fixtureSourceHashes, toolHashes,
  sourceSet: { query: 'clean-mixed', description: 'Existing drink-free generated fictional scenes.', photos: boundary.fixturePhotoSets['clean-mixed'].sources },
  checks: [], screenshots: [], qrChecks: [], decoderVersions, errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [],
};
const browser = await launchBrowser();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = page => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
const controls = (page, callback, arg) => page.evaluate(callback, arg);
const host = page => page.getByRole('button', { name: 'Open host controls', exact: true });
async function tick(page, ms) { await page.clock.runFor(ms); await page.evaluate(() => Promise.resolve()); await delay(12); }
async function seconds(page, n) { for (let i = 0; i < n; i++) await tick(page, 1000); }
async function settled(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('#root img')].filter(el => el.getClientRects().length).every(el => el.complete && el.naturalWidth > 0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function shot(page, label, orientation) {
  await settled(page); const file = `${root}/orientation-retake-${label}-${orientation}.png`;
  const bytes = await page.screenshot({ path: file });
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    orientationStatus: document.querySelector('[data-testid="host-orientation-status"]')?.textContent ?? null,
    globalMessage: document.querySelector('[data-testid="booth-status-message"]')?.textContent ?? null,
  })); assert.equal(layout.horizontalOverflow, false);
  report.screenshots.push({ file, label, orientation, sha256: hash(bytes), ...layout }); return bytes;
}
async function load(context, state = 'review4', extras = '') {
  const page = await context.newPage(); await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await page.goto(`http://127.0.0.1:8791/?state=${state}&count=4&templates=available&effects=available&photos=clean-mixed&network=offline&${extras}`);
  await host(page).waitFor(); await page.waitForFunction(() => !!window.__NEW_SESSION_FIXTURE__);
  if (state === 'camera') await page.getByTestId('take-photo').waitFor();
  else await page.getByTestId('review-gallery').waitFor();
  await settled(page); return page;
}
async function configureAuth(page, outcome = 'success', lifecycle = 'none', blocked = false) {
  await page.evaluate(({ outcome, lifecycle, blocked }) => { const f = window.__NEW_SESSION_FIXTURE__; f.hostAuthOutcome = outcome; f.hostAuthLifecycle = lifecycle; f.hostAuthBlocked = blocked; }, { outcome, lifecycle, blocked });
}
async function openHost(page) { await configureAuth(page); await host(page).tap(); await page.getByText('Booth controls', { exact: true }).waitFor(); await page.getByTestId('host-orientation-status').waitFor(); }
async function done(page) { await page.getByRole('button', { name: 'Done', exact: true }).tap(); await page.getByText('Booth controls', { exact: true }).waitFor({ state: 'detached' }); }
async function saveHost(page) { await page.getByRole('button', { name: 'Save booth settings', exact: true }).tap(); }
async function assertSelectedOrientation(page, choice) {
  // RN-web omits native accessibilityState.checked on Pressable. Inspect the
  // actual selected surface; do not manufacture native radio/VoiceOver proof.
  assert.equal(await page.getByTestId(`host-orientation-${choice}`).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(210, 221, 199)');
}
async function takeEnabled(page) { await page.getByTestId('take-photo').waitFor(); await page.waitForFunction(() => document.querySelector('[data-testid="take-photo"]')?.getAttribute('aria-disabled') !== 'true'); }
const check = (name, orientation, details = {}) => report.checks.push({ name, orientation, passed: true, ...details });
async function beginRetake(page) {
  await page.getByTestId('retake-all').tap(); await page.getByTestId('confirm-retake-all').tap(); await takeEnabled(page);
  return (await snapshot(page)).active;
}
async function assertNoAbandonedQueue(page) {
  const value = await snapshot(page), abandoned = value.sessions.filter(session => session.retakeState === 'abandoned').map(session => session.id);
  assert.ok(value.jobs.every(job => !abandoned.includes(job.sessionId))); return abandoned;
}
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
    try {
      // Drafts never rotate or persist. A fresh authenticated Save commits; a
      // fulfilled native request alone cannot establish the new window geometry.
      const persistence = `orientation-${orientation}-${Date.now()}`;
      const page = await load(context, 'camera', `fixturePersistence=${persistence}`);
      await takeEnabled(page); await openHost(page);
      assert.equal((await snapshot(page)).preferences.orientation, 'auto');
      await page.waitForFunction(() => document.querySelector('[data-testid="host-orientation-status"]')?.textContent.includes('Auto policy observed'));
      await page.getByTestId('host-orientation-auto').scrollIntoViewIfNeeded(); await shot(page, 'auto-default', orientation);
      const baselineRequests = await controls(page, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length);
      const desired = orientation === 'portrait' ? 'landscape' : 'portrait';
      await page.getByTestId(`host-orientation-${desired}`).tap();
      assert.match(await page.getByTestId('host-orientation-status').innerText(), /Unsaved change/);
      assert.equal((await snapshot(page)).preferences.orientation, 'auto');
      assert.equal(await controls(page, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), baselineRequests);
      await shot(page, 'orientation-draft', orientation); await done(page); await openHost(page);
      await assertSelectedOrientation(page, 'auto');
      await page.getByTestId(`host-orientation-${desired}`).tap(); await configureAuth(page, 'user_cancel'); await saveHost(page);
      await page.getByText(/Host settings stayed locked/).last().waitFor();
      assert.equal((await snapshot(page)).preferences.orientation, 'auto');
      assert.equal(await controls(page, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), baselineRequests);
      await configureAuth(page, 'success', 'inactive', true); await saveHost(page);
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      assert.equal((await snapshot(page)).preferences.orientation, 'auto');
      assert.equal(await controls(page, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), baselineRequests);
      await controls(page, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth()); await tick(page, 250);
      assert.equal((await snapshot(page)).preferences.orientation, 'auto');
      assert.equal(await controls(page, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), baselineRequests);
      await controls(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(page, 300);
      await page.waitForFunction(choice => window.__NEW_SESSION_FIXTURE__.snapshot().preferences.orientation === choice, desired);
      await page.getByTestId('host-orientation-status').waitFor(); await tick(page, 2100);
      assert.match(await page.getByTestId('host-orientation-status').innerText(), /not matched/);
      await page.getByTestId('host-orientation-status').scrollIntoViewIfNeeded(); await shot(page, 'request-not-geometry', orientation);
      const targetOrientation = desired === 'landscape' ? 'landscape-left' : 'portrait-up';
      await controls(page, observed => { const f = window.__NEW_SESSION_FIXTURE__; f.orientationObserved = observed; f.emitOrientation(); }, targetOrientation);
      await tick(page, 50); assert.match(await page.getByTestId('host-orientation-status').innerText(), /not matched/);
      await page.setViewportSize({ width: viewport.height, height: viewport.width }); await tick(page, 100);
      await page.waitForFunction(() => document.querySelector('[data-testid="host-orientation-status"]')?.textContent.includes('observed in the current interface'));
      await page.getByTestId('host-orientation-status').scrollIntoViewIfNeeded(); await shot(page, 'observed-after-window-event', orientation);
      await page.reload(); await takeEnabled(page); await openHost(page);
      assert.equal((await snapshot(page)).preferences.orientation, desired);
      await assertSelectedOrientation(page, desired);
      await page.waitForFunction(() => document.querySelector('[data-testid="host-orientation-status"]')?.textContent.includes('observed in the current interface'));
      await page.getByTestId('host-orientation-status').scrollIntoViewIfNeeded(); await shot(page, 'preference-reloaded', orientation);
      await page.getByTestId('host-orientation-auto').tap(); await configureAuth(page); await saveHost(page);
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.snapshot().preferences.orientation === 'auto');
      check('orientation-draft-auth-persist-observe', orientation, { draftWrites: 0, draftNativeRequests: 0, cancelWrites: 0, requestedChoice: desired, observedOnlyAfterIndependentNativeAndWindowEvents: true, fixturePreferenceReload: true, nativePersistenceVerified: false });
      await page.close();

      for (const mode of ['unavailable', 'unsupported', 'rejected']) {
        const fault = await load(context, 'camera', `orientationNative=${mode}`); await takeEnabled(fault); await openHost(fault);
        await tick(fault, 100);
        const description = await fault.getByTestId('host-orientation-status').innerText();
        assert.match(description, /unavailable|could not apply/i); assert.doesNotMatch(description, /observed/i);
        await fault.getByTestId('host-orientation-status').scrollIntoViewIfNeeded(); await shot(fault, `native-${mode}`, orientation);
        check('orientation-native-failure-truthful', orientation, { mode, description, noObservedSuccess: true }); await fault.close();
      }

      const timeoutCases = [];
      for (const mode of ['support-timeout', 'request-timeout']) {
        const timeout = await load(context, 'camera', `orientationNative=${mode}`);
        await timeout.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.orientationSupports.length === 1);
        assert.equal(await timeout.getByTestId('take-photo').getAttribute('aria-disabled'), 'true');
        await tick(timeout, 5200); await takeEnabled(timeout);
        const requestsBeforeRelease = await controls(timeout, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length);
        assert.equal(requestsBeforeRelease, mode === 'request-timeout' ? 1 : 0);
        await openHost(timeout);
        assert.match(await timeout.getByTestId('host-orientation-status').innerText(), /display request did not finish/);
        assert.match(await timeout.getByTestId('host-orientation-status').innerText(), /Capture can continue/);
        await timeout.getByTestId('host-orientation-status').scrollIntoViewIfNeeded(); await shot(timeout, `native-${mode}`, orientation);
        await controls(timeout, () => { const f = window.__NEW_SESSION_FIXTURE__; f.releaseOrientationSupport(); f.releaseOrientationRequest(); }); await tick(timeout, 100);
        assert.equal(await controls(timeout, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), requestsBeforeRelease, 'No additional native operation overlaps the unacknowledged request');
        assert.match(await timeout.getByTestId('host-orientation-status').innerText(), /display request did not finish/);
        assert.doesNotMatch(await timeout.getByTestId('host-orientation-status').innerText(), /observed/);
        timeoutCases.push({ mode, virtualDeadlineAdvancedMs: 5200, StartUnblocked: true, requestsBeforeRelease, noLateObservedSuccess: true }); await timeout.close();
      }
      check('orientation-timeout-unblocks-start-without-false-success', orientation, { cases: timeoutCases, nativeCancellationClaim: false });

      // A module arriving after authentication/editor entry still uses current
      // refs; initialization cannot rotate a redacted sheet or active editor.
      const lateAuth = await load(context, 'camera', 'orientationLoad=blocked');
      await configureAuth(lateAuth, 'success', 'inactive', true); await host(lateAuth).tap();
      await lateAuth.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      await controls(lateAuth, () => window.__NEW_SESSION_FIXTURE__.releaseOrientationLoad()); await tick(lateAuth, 100);
      assert.equal(await controls(lateAuth, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), 0);
      await controls(lateAuth, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth()); await tick(lateAuth, 100);
      assert.equal(await controls(lateAuth, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), 0);
      await controls(lateAuth, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(lateAuth, 300); await lateAuth.getByText('Booth controls', { exact: true }).waitFor();
      await lateAuth.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.orientationRequests.length === 1);
      await lateAuth.close();
      const lateEditor = await load(context, 'review4', 'orientationLoad=blocked');
      await lateEditor.getByTestId('choose-look').tap(); await lateEditor.getByTestId('look-editor').waitFor();
      await controls(lateEditor, () => window.__NEW_SESSION_FIXTURE__.releaseOrientationLoad()); await tick(lateEditor, 100);
      assert.equal(await controls(lateEditor, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), 0);
      await shot(lateEditor, 'orientation-deferred-in-editor', orientation);
      await lateEditor.getByTestId('look-cancel').tap(); await lateEditor.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.orientationRequests.length === 1);
      check('orientation-late-module-respects-auth-and-editor', orientation, { requestsDuringOSInactiveAuth: 0, requestsDuringPhotoEditor: 0, freshSafeContextEventuallyRequestsOnce: true }); await lateEditor.close();

      const deferred = await load(context, 'camera', 'orientationLoad=blocked&orientationPreference=landscape');
      await takeEnabled(deferred); await deferred.getByTestId('take-photo').tap();
      assert.equal(await deferred.getByTestId('capture-countdown-value').innerText(), '5');
      await controls(deferred, () => window.__NEW_SESSION_FIXTURE__.releaseOrientationLoad()); await tick(deferred, 100);
      assert.equal(await controls(deferred, () => window.__NEW_SESSION_FIXTURE__.orientationRequests.length), 0);
      await seconds(deferred, 14); await deferred.getByTestId('review-gallery').waitFor(); await tick(deferred, 50);
      const requests = await controls(deferred, () => window.__NEW_SESSION_FIXTURE__.orientationRequests);
      assert.equal(requests.length, 1); assert.ok(requests.every(request => request.pendingCaptures === 0 && request.pendingSaves === 0 && request.countdown === null && request.appState === 'active'));
      check('orientation-late-load-deferred-through-sequence', orientation, { requests, fourOriginals: (await snapshot(deferred)).active.shots.length }); await deferred.close();

      const retake = await load(context); const parent = (await snapshot(retake)).active;
      await retake.getByTestId('retake-all').tap(); await shot(retake, 'retake-all-confirm', orientation);
      await retake.getByTestId('cancel-retake-all').tap(); assert.equal((await snapshot(retake)).active.id, parent.id); assert.equal((await snapshot(retake)).sessions.length, 1);
      await retake.getByTestId('retake-all').tap(); await controls(retake, () => window.__NEW_SESSION_FIXTURE__.setAppState('background')); await controls(retake, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(retake, 100);
      assert.equal(await retake.getByTestId('confirm-retake-all').count(), 0); assert.equal((await snapshot(retake)).sessions.length, 1);
      const childOne = await beginRetake(retake); assert.notEqual(childOne.id, parent.id); assert.equal(childOne.retakeOfSessionId, parent.id); assert.deepEqual(childOne.captureTiming, { firstSeconds: 5, nextSeconds: 3 });
      assert.equal(childOne.shots.length, 0); await shot(retake, 'fresh-retake-set', orientation);
      await retake.getByTestId('take-photo').tap(); await seconds(retake, 2); await retake.getByTestId('keep-previous-set').tap();
      await retake.getByTestId('review-gallery').waitFor(); await seconds(retake, 6);
      assert.equal(await controls(retake, () => window.__NEW_SESSION_FIXTURE__.cameraCalls), 0, 'Abandoned countdown cannot expose a photo later');
      let value = await snapshot(retake); assert.deepEqual(value.active.shots.map(photo => photo.id), parent.shots.map(photo => photo.id)); assert.equal(value.sessions.find(session => session.id === childOne.id).retakeState, 'abandoned');
      const childTwo = await beginRetake(retake); assert.notEqual(childTwo.id, childOne.id); assert.notEqual(childTwo.id, parent.id);
      await controls(retake, () => { const collect = event => { if (event.target.closest?.('[data-testid="take-photo"]')) { window.__NEW_SESSION_FIXTURE__.events.push({ kind: 'actual-root-start-event', at: Date.now() }); document.removeEventListener('click', collect, true); } }; document.addEventListener('click', collect, true); });
      await retake.getByTestId('take-photo').tap(); assert.equal(await retake.getByTestId('capture-countdown-value').innerText(), '5'); await seconds(retake, 14); await retake.getByTestId('review-gallery').waitFor();
      value = await snapshot(retake); const replacements = value.active.shots;
      assert.equal(replacements.length, 4); assert.equal(new Set(replacements.map(photo => photo.id)).size, 4); assert.ok(replacements.every(photo => !parent.shots.some(old => old.id === photo.id) && !photo.look && !photo.sourcePhotoId));
      assert.deepEqual(value.sessions.find(session => session.id === parent.id).shots.map(photo => photo.id), parent.shots.map(photo => photo.id));
      const exposureTimes = await controls(retake, () => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-camera-exposure').map(event => event.at));
      const startAt = await controls(retake, () => window.__NEW_SESSION_FIXTURE__.events.find(event => event.kind === 'actual-root-start-event').at);
      assert.ok(Math.abs(exposureTimes[0] - startAt - 5000) <= 10, 'First replacement exposure follows the actual Start event by5seconds');
      assert.deepEqual(exposureTimes.slice(1).map((at, i) => at - exposureTimes[i]), [3000, 3000, 3000]);
      await shot(retake, 'new-set-review', orientation); await retake.getByTestId('keep-previous-set').tap(); await retake.getByTestId('review-gallery').waitFor();
      assert.equal((await snapshot(retake)).active.id, parent.id); assert.equal((await snapshot(retake)).jobs.length, 0); await assertNoAbandonedQueue(retake);
      check('retake-dialog-cancel-unique-child-revert', orientation, { parentId: parent.id, childIds: [childOne.id, childTwo.id], priorSetUnchanged: true, cancelledCountdownExposures: 0, automaticSubsequentIntervalsMs: [3000, 3000, 3000], replacementOriginals: 4, noAutomaticQueue: true });
      await retake.close();

      const partial = await load(context); const partialParent = (await snapshot(partial)).active; const partialChild = await beginRetake(partial);
      await partial.getByTestId('take-photo').tap(); await seconds(partial, 5); await partial.getByTestId('cancel-countdown').tap();
      assert.equal((await snapshot(partial)).active.shots.length, 1);
      await controls(partial, () => { const f = window.__NEW_SESSION_FIXTURE__; f.cameraReadyBlocked = true; f.setAppState('background'); });
      await controls(partial, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(partial, 500);
      assert.equal((await snapshot(partial)).active.id, partialChild.id); assert.equal((await snapshot(partial)).active.shots.length, 1);
      assert.equal(await partial.getByTestId('capture-countdown-value').count(), 0); assert.equal(await partial.getByTestId('take-photo').getAttribute('aria-disabled'), 'true');
      await controls(partial, () => window.__NEW_SESSION_FIXTURE__.setCameraReady(true)); await takeEnabled(partial); await partial.getByTestId('take-photo').tap();
      assert.equal(await partial.getByTestId('capture-countdown-value').innerText(), '5'); await shot(partial, 'partial-retake-resume-first-timer', orientation);
      await seconds(partial, 11); await partial.getByTestId('review-gallery').waitFor();
      assert.equal((await snapshot(partial)).active.shots.length, 4); assert.deepEqual((await snapshot(partial)).sessions.find(session => session.id === partialParent.id).shots.map(photo => photo.id), partialParent.shots.map(photo => photo.id));
      check('partial-retake-background-ready-resume', orientation, { savedBeforeBackground: 1, sameChildResumed: true, explicitFreshReadyRequired: true, resumePreparationSeconds: 5, laterCountdownSeconds: 3 }); await partial.close();

      const protectedExposure = await load(context); const exposureParent = (await snapshot(protectedExposure)).active; const exposureChild = await beginRetake(protectedExposure);
      await controls(protectedExposure, () => { const f = window.__NEW_SESSION_FIXTURE__; f.captureBlocked = true; f.saveBlocked = true; });
      await protectedExposure.getByTestId('take-photo').tap(); await seconds(protectedExposure, 5);
      assert.equal(await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.pendingCaptures), 1);
      assert.equal(await protectedExposure.getByTestId('keep-previous-set').getAttribute('aria-disabled'), 'true');
      assert.ok(await protectedExposure.getByTestId('keep-previous-set').evaluate(element => Number(getComputedStyle(element).opacity) < 1), 'Pending exposure visibly dims the disabled return action');
      await protectedExposure.getByTestId('keep-previous-set').dispatchEvent('click');
      assert.equal((await snapshot(protectedExposure)).active.id, exposureChild.id); await shot(protectedExposure, 'native-capture-promise-held', orientation);
      const mounts = await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.cameraMounts);
      await controls(protectedExposure, () => { const f = window.__NEW_SESSION_FIXTURE__; f.cameraReadyBlocked = true; f.setAppState('background'); }); await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await tick(protectedExposure, 100);
      assert.equal(await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.cameraMounts), mounts);
      await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.releaseCaptures()); await tick(protectedExposure, 50);
      assert.equal(await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.pendingSaves), 1); assert.equal((await snapshot(protectedExposure)).active.shots.length, 0);
      assert.equal(await protectedExposure.getByTestId('keep-previous-set').getAttribute('aria-disabled'), 'true');
      assert.ok(await protectedExposure.getByTestId('keep-previous-set').evaluate(element => Number(getComputedStyle(element).opacity) < 1), 'Pending save visibly dims the disabled return action');
      await protectedExposure.getByTestId('keep-previous-set').dispatchEvent('click');
      assert.equal((await snapshot(protectedExposure)).active.id, exposureChild.id); await shot(protectedExposure, 'durable-save-held', orientation);
      await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.releaseSaves()); await tick(protectedExposure, 100);
      assert.equal((await snapshot(protectedExposure)).active.shots.length, 1);
      assert.ok(await protectedExposure.getByTestId('keep-previous-set').evaluate(element => Number(getComputedStyle(element).opacity) >= 0.99), 'Return action regains full opacity after preservation');
      await protectedExposure.getByTestId('keep-previous-set').tap(); await protectedExposure.getByTestId('review-gallery').waitFor();
      value = await snapshot(protectedExposure); const abandonedChild = value.sessions.find(session => session.id === exposureChild.id);
      assert.equal(value.active.id, exposureParent.id); assert.equal(abandonedChild.retakeState, 'abandoned'); assert.equal(abandonedChild.shots.length, 1); assert.equal(value.jobs.length, 0);
      await assertNoAbandonedQueue(protectedExposure); await shot(protectedExposure, 'previous-set-restored', orientation);
      check('retake-exposure-and-save-are-nonabandonable', orientation, { nativePromiseHeld: true, saveHeldSeparately: true, noCameraRemountBeforePreservation: true, oneOriginalRetainedInAbandonedChild: true, originalParentRestored: true, abandonedUploads: 0 });
      // Reuse the restored parent to verify old QR invariants after abandonment.
      await protectedExposure.getByTestId('use-photo').tap(); await protectedExposure.getByTestId('template-save').waitFor();
      await protectedExposure.waitForFunction(() => document.querySelector('[data-testid="template-save"]')?.getAttribute('aria-disabled') !== 'true'); await protectedExposure.getByTestId('template-save').tap(); await protectedExposure.getByTestId('next-guest').waitFor();
      assert.equal(await protectedExposure.getByTestId('guest-qr').count(), 0); await assertNoAbandonedQueue(protectedExposure);
      await controls(protectedExposure, () => { const f = window.__NEW_SESSION_FIXTURE__; f.setOnline(true); f.acknowledgeReady(false); }); await protectedExposure.getByTestId('retry-sharing').tap();
      await protectedExposure.getByText('Finishing your photo link', { exact: true }).waitFor(); assert.equal(await protectedExposure.getByTestId('guest-qr').count(), 0);
      await controls(protectedExposure, () => window.__NEW_SESSION_FIXTURE__.acknowledgeReady(true)); await protectedExposure.getByTestId('retry-sharing').tap(); await protectedExposure.getByTestId('guest-qr').waitFor();
      const qrBytes = await shot(protectedExposure, 'ready-with-abandoned-original-private', orientation);
      const expectedURL = 'https://photobooth.example/g/' + 'a7'.repeat(32); const qr = await decodeFullFrame(qrBytes, expectedURL);
      assert.equal(qr.jsQR, expectedURL); assert.deepEqual(qr.zxingCpp, [{ text: expectedURL, error: '' }]); report.qrChecks.push({ orientation, ...qr });
      value = await snapshot(protectedExposure); assert.equal(value.jobs.length, 5); assert.ok(value.jobs.every(job => job.sessionId === exposureParent.id)); await assertNoAbandonedQueue(protectedExposure);
      check('retake-abandoned-assets-excluded-from-ready-qr', orientation, { publishedAssets: 5, requiredCompleteSessionAcknowledgement: true, abandonedOriginalUploads: 0, independentFullFrameDecoders: 2 }); await protectedExposure.close();

      const legacy = await load(context, 'review4');
      // URLSearchParams uses the first count, so change it explicitly for legacy.
      await legacy.goto('http://127.0.0.1:8791/?state=review&count=5&network=offline&photos=clean-mixed&templates=available'); await legacy.getByTestId('retake-all').waitFor();
      const fiveParent = (await snapshot(legacy)).active; assert.equal(fiveParent.shots.length, 5); const fiveChild = await beginRetake(legacy); assert.equal(fiveChild.targetCount, 5);
      await legacy.getByTestId('take-photo').tap(); await seconds(legacy, 17); await legacy.getByTestId('review-gallery').waitFor();
      assert.equal((await snapshot(legacy)).active.shots.length, 5); await legacy.getByTestId('keep-previous-set').tap(); await legacy.getByTestId('review-gallery').waitFor();
      assert.deepEqual((await snapshot(legacy)).active.shots.map(photo => photo.id), fiveParent.shots.map(photo => photo.id)); await assertNoAbandonedQueue(legacy);
      check('legacy-five-photo-whole-retake', orientation, { targetCount: 5, preservedParentPhotoIds: fiveParent.shots.map(photo => photo.id), fiveNewOriginalsPreserved: true }); await legacy.close();
    } finally { await context.close(); }
    console.log(`Orientation/retake ${orientation}: ${report.checks.filter(check => check.orientation === orientation).length} groups passed.`);
  }
  for (const section of ['sourceHashes', 'fixtureSourceHashes']) for (const [file, expected] of Object.entries(boundary[section])) assert.equal(hash(await readFile(file)), expected, `${file} changed after bundle build`);
  for (const [file, expected] of Object.entries(toolHashes)) assert.equal(hash(await readFile(file)), expected, `${file} changed during checks`);
  assert.ok(boundary.inputs.includes('apps/ipad/src/orientation-controller.ts'));
  assert.ok(!boundary.inputs.includes('apps/ipad/src/orientation-native.ts'));
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile(`${root}/orientation-retake-checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, groups: report.checks.length, screenshots: report.screenshots.length, fullFrameQRChecks: report.qrChecks.length }));
