/** Actual Root JSX regressions. Synthetic OS/Keychain/storage/network ports only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser, createContext } from './browser.mjs';
import { decodeFullFrame, decoderVersions } from './qr-decode.mjs';

const provisional = process.argv.includes('--provisional');
const root = provisional ? '.cache/host-sharing-provisional' : 'artifacts/visual';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(root, { recursive: true });
const boundary = JSON.parse(await readFile(`${root}/host-sharing-bundle-boundary.json`));
const verificationToolHashes = {};
for (const file of ['host-sharing-checks.mjs', 'host-sharing-build-evidence.mjs', 'browser.mjs', 'qr-decode.mjs']) verificationToolHashes['tools/native-visual/new-session/' + file] = sha256(await readFile('tools/native-visual/new-session/' + file));
const expectedURL = 'https://photobooth.example/g/' + 'a7'.repeat(32);
const report = {
  generatedAt: new Date().toISOString(), status: 'running',
  scope: 'Actual current App JSX, host visibility/auth policy and share-readiness logic through RN-web. Explicit synthetic OS lifecycle/auth result, secure-store, camera, storage, Canvas keepsake, Photos and sharing adapters. No genuine PIN/biometric, iPad, durable storage, native camera, network, real URL, or SMS verification.',
  sourceHashes: boundary.sourceHashes, sourceSHA256: boundary.sourceSHA256,
  fixtureSourceHashes: boundary.fixtureSourceHashes,
  verificationToolHashes,
  decoderVersions, expectedSyntheticGuestURL: expectedURL,
  sourceSet: { query: 'clean-mixed', description: 'Four distinct existing generated, drink-free fictional scenes. No real guests or vendor assets.', sourcePhotos: boundary.fixturePhotoSets['clean-mixed'].sources },
  checks: [], screenshots: [], qrChecks: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [],
};
const browser = await launchBrowser();
const state = (page, expression) => page.evaluate(expression);
const snapshot = page => state(page, () => window.__NEW_SESSION_FIXTURE__.snapshot());
const host = page => page.getByRole('button', { name: 'Open host controls', exact: true });
const hostTitle = page => page.getByText('Booth controls', { exact: true });
const message = page => page.getByTestId('booth-status-message');
const assertLocked = async page => { await hostTitle(page).waitFor({ state: 'detached' }); assert.equal(await hostTitle(page).count(), 0); };
async function settled(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('#root img')].filter(el => el.getClientRects().length).every(el => el.complete && el.naturalWidth > 0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
}
async function capture(page, label, orientation) {
  await settled(page);
  const file = `${root}/host-sharing-${label}-${orientation}.png`;
  const layout = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    globalMessage: document.querySelector('[data-testid="booth-status-message"]')?.textContent ?? null,
    buttons: [...document.querySelectorAll('[role="button"]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => ({
      label: el.getAttribute('aria-label') ?? el.textContent, disabled: el.getAttribute('aria-disabled') === 'true', box: el.getBoundingClientRect().toJSON(),
    })),
  }));
  assert.equal(layout.horizontalOverflow, false, `${label}: horizontal overflow`);
  const bytes = await page.screenshot({ path: file });
  report.screenshots.push({ file, label, orientation, width: page.viewportSize().width, height: page.viewportSize().height, sha256: sha256(bytes), layout });
  return bytes;
}
async function load(context, screen, connection = 'paired') {
  const page = await context.newPage();
  const fixture = screen === 'welcome' ? 'attract' : screen === 'share' ? 'review4' : screen === 'review' ? 'review4' : 'camera';
  await page.goto(`http://127.0.0.1:8791/?state=${fixture}&count=4&templates=available&effects=available&photos=clean-mixed&network=offline&connection=${connection}`);
  await host(page).waitFor();
  if (screen === 'welcome') await page.getByTestId('start-session').waitFor();
  else if (screen === 'camera') await page.getByTestId('take-photo').waitFor();
  else await page.getByTestId('review-gallery').waitFor();
  await settled(page);
  if (screen === 'share') {
    await page.getByTestId('use-photo').tap();
    await page.getByTestId('template-save').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="template-save"]')?.getAttribute('aria-disabled') !== 'true');
    await page.getByTestId('template-save').tap();
    await page.getByTestId('next-guest').waitFor();
    await page.getByTestId('share-link-unavailable').waitFor();
    await settled(page);
    const value = await snapshot(page);
    assert.equal(value.active.shots.length, 4);
    assert.equal(value.active.confirmed, true);
    assert.ok(value.active.composite);
    assert.equal(value.jobs.length, 5, 'Four originals plus actual saved Canvas keepsake are queued');
  }
  assert.equal(await page.getByTestId('native-fixture-enabled').count(), 0);
  return page;
}
async function configureAuth(page, outcome = 'success', lifecycle = 'none', blocked = false) {
  await page.evaluate(({ outcome, lifecycle, blocked }) => {
    const f = window.__NEW_SESSION_FIXTURE__;
    f.hostAuthOutcome = outcome; f.hostAuthLifecycle = lifecycle; f.hostAuthBlocked = blocked;
  }, { outcome, lifecycle, blocked });
}
async function normalOpen(page) {
  await configureAuth(page); const before = await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests);
  await host(page).tap(); await hostTitle(page).waitFor();
  assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests), before + 1);
  assert.equal(await hostTitle(page).count(), 1);
}
async function closeHost(page) { await page.getByRole('button', { name: 'Done', exact: true }).tap(); await assertLocked(page); }
const checks = (name, orientation, details) => report.checks.push({ name, orientation, passed: true, ...details });
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
    try {
      for (const screen of ['welcome', 'camera', 'review', 'share']) {
        const page = await load(context, screen);
        const before = await snapshot(page);
        await configureAuth(page, 'success', 'inactive', true);
        await host(page).tap();
        await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1 && window.__NEW_SESSION_FIXTURE__.appState === 'inactive');
        await assertLocked(page);
        assert.match(await message(page).innerText(), /passcode or biometrics/i);
        const requests = await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests);
        await host(page).dispatchEvent('click');
        assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests), requests, 'Busy Host control cannot launch a duplicate prompt');
        await capture(page, `${screen}-auth-pending`, orientation);
        await state(page, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth());
        await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 0);
        await page.waitForTimeout(180); await assertLocked(page);
        await state(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
        await hostTitle(page).waitFor();
        assert.equal(await hostTitle(page).count(), 1);
        assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests), requests);
        assert.equal(await message(page).count(), 0);
        if (screen === 'camera') await capture(page, 'host-success', orientation);
        await closeHost(page);
        if (screen === 'camera') await page.waitForFunction(() => document.querySelector('[data-testid="take-photo"]')?.getAttribute('aria-disabled') !== 'true');
        assert.deepEqual((await snapshot(page)).active?.shots.map(photo => photo.id), before.active?.shots.map(photo => photo.id));
        checks('inactive-success-active-opens-once', orientation, { screen, authRequests: requests, originalIdentitiesPreserved: true, limits: 'Synthetic SDK success and AppState notifications; no actual passcode or biometric entry.' });
        await page.close();
      }

      // Failures are visible on every guest screen, not hidden inside a locked modal.
      for (const [screen, outcome, expected] of [
        ['welcome', 'user_cancel', /stayed locked.*Tap Host/i],
        ['camera', 'passcode_not_set', /Enable an iPad passcode/i],
        ['review', 'throw', /could not open authentication.*tap Host/i],
        ['share', 'authentication_failed', /could not verify you.*Tap Host/i],
      ]) {
        const page = await load(context, screen); const before = await snapshot(page);
        await configureAuth(page, outcome); await host(page).tap(); await expectMessage(page, expected);
        await assertLocked(page);
        assert.doesNotMatch(await message(page).innerText(), /Synthetic SDK payload/);
        await capture(page, `${screen}-auth-error`, orientation);
        assert.deepEqual((await snapshot(page)).active?.shots.map(photo => photo.id), before.active?.shots.map(photo => photo.id));
        await normalOpen(page); await closeHost(page);
        checks('actionable-locked-auth-error-and-retry', orientation, { screen, outcome, recovery: 'Explicit fresh Host action succeeds once; no original selection changed.' });
        await page.close();
      }

      const page = await load(context, 'review');
      await configureAuth(page, 'success', 'background', true); await host(page).tap();
      await page.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      await state(page, () => { window.__NEW_SESSION_FIXTURE__.releaseHostAuth(); window.__NEW_SESSION_FIXTURE__.setAppState('active'); });
      await expectMessage(page, /stayed locked because.*left the booth/i); await assertLocked(page);
      await capture(page, 'background-success-stays-locked', orientation);
      await normalOpen(page);
      for (let n = 0; n < 2; n++) {
        const requests = await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests);
        await page.evaluate(status => window.__NEW_SESSION_FIXTURE__.setAppState(status), n ? 'background' : 'inactive');
        await assertLocked(page);
        await state(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
        await page.waitForTimeout(200); await assertLocked(page);
        assert.equal(await state(page, () => window.__NEW_SESSION_FIXTURE__.hostAuthRequests), requests);
        await normalOpen(page);
      }
      await closeHost(page);
      await configureAuth(page, 'success', 'inactive'); await host(page).tap();
      await expectMessage(page, /stayed locked because.*foreground/i); await assertLocked(page);
      await state(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      await page.waitForTimeout(200); await assertLocked(page); await normalOpen(page); await closeHost(page);
      checks('background-stale-and-repeat-relock', orientation, { cases: ['OS success after real synthetic background cannot reopen', 'inactive/background each redact open modal', 'foreground never automatically authenticates', 'fresh Host required twice', 'late foreground after2second deadline stays locked'] });
      await page.close();

      // Settings are a separate protected mutation, not just modal access.
      const settings = await load(context, 'camera'); await normalOpen(settings);
      const defaultPreferences = (await snapshot(settings)).preferences;
      await settings.getByTestId('host-timing-first-plus').tap();
      await settings.getByTestId('host-timing-next-plus').tap();
      await configureAuth(settings, 'success', 'inactive', true);
      await settings.getByRole('button', { name: 'Save booth settings', exact: true }).tap();
      await settings.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      await assertLocked(settings); assert.deepEqual((await snapshot(settings)).preferences, defaultPreferences);
      await state(settings, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth());
      await settings.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 0);
      await settings.waitForTimeout(180); assert.deepEqual((await snapshot(settings)).preferences, defaultPreferences, 'OS success while inactive cannot persist settings yet');
      await capture(settings, 'settings-save-auth-pending', orientation);
      await state(settings, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      await settings.waitForFunction(() => { const prefs = window.__NEW_SESSION_FIXTURE__.snapshot().preferences; return prefs.firstSeconds === 8 && prefs.nextSeconds === 5; });
      assert.equal(await state(settings, () => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-preferences-saved').length), 1);
      await settings.getByText('Booth defaults saved. Guest changes apply to one session only.', { exact: true }).waitFor({ state: 'visible' });
      await capture(settings, 'settings-save-foreground-success', orientation);
      checks('settings-mutation-waits-for-foreground', orientation, { noWriteBeforeForeground: true, writes: 1, savedDefaults: [8, 5], outcomeVisibleOutsideOrInsideAuthenticatedHost: true });
      await settings.close();

      const revoked = await load(context, 'review'); await normalOpen(revoked);
      const unchangedPreferences = (await snapshot(revoked)).preferences;
      await revoked.getByTestId('host-timing-first-plus').tap();
      await configureAuth(revoked, 'success', 'background', true);
      await revoked.getByRole('button', { name: 'Save booth settings', exact: true }).tap();
      await revoked.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      await state(revoked, () => { window.__NEW_SESSION_FIXTURE__.releaseHostAuth(); window.__NEW_SESSION_FIXTURE__.setAppState('active'); });
      await expectMessage(revoked, /locked|interrupted|authenticate again|not complete/i);
      await revoked.waitForTimeout(250); await assertLocked(revoked);
      assert.deepEqual((await snapshot(revoked)).preferences, unchangedPreferences);
      assert.equal(await state(revoked, () => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-preferences-saved').length), 0);
      await capture(revoked, 'settings-background-revoked', orientation);
      await normalOpen(revoked); await closeHost(revoked);
      checks('settings-background-revokes-write', orientation, { preferenceWrites: 0, oldDefaultsPreserved: true, staleModalNotReopened: true, explicitFreshReauthenticationWorks: true });
      await revoked.close();

      // The actual Photos exporter runs against an explicit in-memory SDK port.
      // Retained originals must not become guest selections or upload assets.
      const originals = await context.newPage();
      await originals.goto('http://127.0.0.1:8791/?state=host-uncertain&count=4&photos=clean-mixed&templates=available&network=offline');
      await host(originals).waitFor(); await normalOpen(originals);
      await originals.getByRole('button', { name: 'Saved sessions', exact: true }).tap();
      await originals.getByText('Open saved session →', { exact: true }).tap();
      await originals.getByTestId('host-retained-originals').tap();
      const originalSession = (await snapshot(originals)).active;
      const [firstRetained, uncertainRetained] = originalSession.retakes;
      await configureAuth(originals, 'success', 'inactive', true);
      await originals.getByTestId(`host-photo-export-${firstRetained.id}`).tap();
      await originals.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      assert.equal(await state(originals, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 0);
      await state(originals, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth());
      await originals.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 0);
      await originals.waitForTimeout(180);
      assert.equal(await state(originals, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 0);
      await state(originals, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      await originals.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length === 1);
      await originals.getByTestId('host-retained-originals').waitFor();
      assert.deepEqual(await state(originals, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.map(call => call.photoId)), [firstRetained.id]);
      await originals.getByTestId(`host-original-${firstRetained.id}`).scrollIntoViewIfNeeded();
      await capture(originals, 'retained-export-foreground-success', orientation);
      await configureAuth(originals, 'success', 'background', true);
      await originals.getByTestId(`host-photo-export-${uncertainRetained.id}`).tap();
      await originals.getByTestId('host-photo-decision-confirm').tap();
      await originals.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 1);
      await state(originals, () => { window.__NEW_SESSION_FIXTURE__.releaseHostAuth(); window.__NEW_SESSION_FIXTURE__.setAppState('active'); });
      await expectMessage(originals, /stopped|interrupted|authenticate/i);
      await originals.waitForTimeout(200);
      assert.equal(await state(originals, () => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 1, 'Revoked export cannot create a second Photos SDK copy');
      const retainedState = await snapshot(originals);
      assert.deepEqual(retainedState.active.shots.map(photo => photo.id), originalSession.shots.map(photo => photo.id));
      assert.ok(retainedState.jobs.every(job => !originalSession.retakes.some(photo => photo.id === job.photoId)));
      assert.equal(retainedState.active.retakes.find(photo => photo.id === uncertainRetained.id).exportStatus, 'uncertain');
      assert.equal(await originals.getByTestId('host-retained-originals').count(), 0);
      await capture(originals, 'retained-export-background-revoked', orientation);
      checks('retained-export-foreground-lease-and-revocation', orientation, { syntheticSDKCopies: 1, onlyExplicitSelectedRetainedOriginalCopied: true, revokedUncertainExportUnchanged: true, guestSelectionsAndUploadsUnchanged: true, nativePhotosVerified: false });
      await originals.close();

      // Missing/unreadable setup has its own explanation and an authenticated action.
      for (const [connection, title] of [['unpaired', 'Ask the host to connect sharing'], ['unavailable', 'Sharing settings need attention']]) {
        const share = await load(context, 'share', connection);
        assert.equal(await share.getByTestId('share-link-unavailable').innerText(), title);
        assert.equal(await share.getByTestId('guest-qr').count(), 0);
        assert.equal(await share.getByTestId('retry-sharing').count(), 0);
        assert.equal(await state(share, () => window.__NEW_SESSION_FIXTURE__.sharingCalls), 0);
        assert.ok((await snapshot(share)).jobs.every(job => job.attempts === 0));
        assert.doesNotMatch(await share.getByTestId('share-readiness-message').innerText(), /offline|reconnect/i);
        await capture(share, connection, orientation);
        await configureAuth(share, 'success', 'inactive', true);
        await share.getByTestId('sharing-setup-host').tap();
        await state(share, () => window.__NEW_SESSION_FIXTURE__.releaseHostAuth());
        await share.waitForFunction(() => window.__NEW_SESSION_FIXTURE__.hostAuthPending === 0);
        assert.equal(await share.getByText('Private setup', { exact: true }).count(), 0);
        await state(share, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
        await share.getByText('Private setup', { exact: true }).first().waitFor();
        assert.equal(await hostTitle(share).count(), 0, 'Guest action opens Setup, not generic controls');
        await capture(share, `${connection}-private-setup`, orientation);
        assert.equal(await share.getByTestId('guest-qr').count(), 0);
        checks('missing-setup-private-auth-route', orientation, { connection, title, syntheticNetworkOrQueueClaimCalls: 0, setupOpenedOnlyAfterFreshForegroundAuth: true });
        await share.close();
      }

      const share = await load(context, 'share');
      assert.equal(await share.getByTestId('share-link-unavailable').innerText(), 'Your photos are waiting to share');
      assert.match(await share.getByTestId('share-readiness-message').innerText(), /download link is not ready yet/);
      assert.doesNotMatch(await share.getByTestId('share-readiness-message').innerText(), /offline|reconnect/i);
      await capture(share, 'queued', orientation);
      await state(share, () => { window.__NEW_SESSION_FIXTURE__.sharingBlocked = true; });
      await share.getByTestId('retry-sharing').tap();
      await share.getByTestId('share-link-unavailable').getByText('Preparing your download link', { exact: true }).waitFor();
      assert.equal(await share.getByTestId('guest-qr').count(), 0); await capture(share, 'uploading-unacknowledged', orientation);
      await state(share, () => window.__NEW_SESSION_FIXTURE__.releaseSharing());
      await share.getByTestId('share-link-unavailable').getByText('Your photos are waiting to share', { exact: true }).waitFor();
      await state(share, () => { window.__NEW_SESSION_FIXTURE__.sharingFailure = true; });
      await share.getByTestId('retry-sharing').tap();
      await share.getByTestId('share-link-unavailable').getByText('Sharing needs a retry', { exact: true }).waitFor();
      assert.doesNotMatch(await share.getByTestId('share-readiness-message').innerText(), /offline|reconnect/i);
      assert.equal(await share.getByTestId('guest-qr').count(), 0); await capture(share, 'failed-unacknowledged', orientation);
      await state(share, () => { const f = window.__NEW_SESSION_FIXTURE__; f.sharingFailure = false; f.setOnline(true); f.acknowledgeReady(false); });
      await share.getByTestId('retry-sharing').tap();
      await share.getByTestId('share-link-unavailable').getByText('Finishing your photo link', { exact: true }).waitFor();
      let value = await snapshot(share); assert.equal(value.jobs.length, 5); assert.ok(value.jobs.every(job => job.state === 'complete' && !job.guestUrl));
      assert.equal(await share.getByTestId('guest-qr').count(), 0); await capture(share, 'uploaded-no-session-ack', orientation);
      await state(share, () => window.__NEW_SESSION_FIXTURE__.acknowledgeReady(true));
      await share.getByTestId('retry-sharing').tap(); await share.getByTestId('guest-qr').waitFor();
      value = await snapshot(share); assert.ok(value.jobs.every(job => job.state === 'complete' && job.guestUrl === expectedURL));
      const png = await capture(share, 'ready-exact-session-ack', orientation);
      const qr = await decodeFullFrame(png, expectedURL);
      assert.equal(qr.jsQR, expectedURL); assert.deepEqual(qr.zxingCpp, [{ text: expectedURL, error: '' }]);
      report.qrChecks.push({ orientation, ...qr });
      await share.getByTestId('next-guest').tap(); await share.getByTestId('start-session').waitFor();
      assert.equal(await share.getByTestId('guest-qr').count(), 0); assert.equal((await snapshot(share)).active, null);
      checks('queued-failed-publishing-ready-ack-boundary', orientation, { assets: 'Four originals plus one actual Canvas saved composite', progressStates: ['queued', 'uploading', 'failed', 'publishing', 'ready'], noNetworkOutageClaim: true, QRRequiresAllFiveAssetAcknowledgements: true, independentScreenshotDecoders: ['jsQR', 'ZXing-C++'], nextGuestsRedactsGuestPage: true });
      await share.close();
    } finally { await context.close(); }
    console.log(`Host/sharing ${orientation}: ${report.checks.filter(check => check.orientation === orientation).length} groups passed.`);
  }
  for (const [file, expected] of Object.entries(boundary.sourceHashes)) assert.equal(sha256(await readFile(file)), expected, `${file} changed after bundling; rebuild before evidence publication`);
  for (const [file, expected] of Object.entries(boundary.fixtureSourceHashes)) assert.equal(sha256(await readFile(file)), expected, `${file} changed after bundling; rebuild before evidence publication`);
  for (const [file, expected] of Object.entries(verificationToolHashes)) assert.equal(sha256(await readFile(file)), expected, `${file} changed during verification`);
  assert.ok(boundary.inputs.includes('apps/ipad/src/host-auth-policy.ts'));
  assert.ok(boundary.inputs.includes('apps/ipad/src/host-action-auth.ts'));
  assert.ok(boundary.inputs.includes('apps/ipad/src/share-readiness.ts'));
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally {
  await browser.close();
  await writeFile(`${root}/host-sharing-checks.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, groups: report.checks.length, screenshots: report.screenshots.length, fullFrameQRChecks: report.qrChecks.length }));
async function expectMessage(page, pattern) {
  await message(page).waitFor();
  await page.waitForFunction(source => {
    const text = document.querySelector('[data-testid="booth-status-message"]')?.textContent ?? '';
    return new RegExp(source, 'i').test(text);
  }, pattern.source);
  assert.match(await message(page).innerText(), pattern);
}
