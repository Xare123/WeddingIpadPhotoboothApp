/** Actual host JSX/controllers with synthetic storage and native Photos SDK ports. */
import assert from 'node:assert/strict';
import { createContext } from './browser.mjs';
export async function hostReliabilityChecks({ browser, report, load, save, snapshot, controls }) {
  const context = await createContext(browser, report, { viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  async function openHost() { await page.getByRole('button', { name: 'Open host controls', exact: true }).tap(); await page.getByText('Booth controls', { exact: true }).waitFor(); }
  async function openLibrary(state) {
    await load(page, state); await openHost();
    await page.getByRole('button', { name: 'Saved sessions', exact: true }).tap();
    await page.getByText('Open saved session →', { exact: true }).tap();
    await page.getByTestId('host-selected-originals').waitFor();
  }
  const evidence = (state) => save(page, state, 'portrait', { allowVerticalScroll: true });
  try {
    await openLibrary('host-uncertain');
    for (let cycle = 0; cycle < 2; cycle++) {
      const authBefore = await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-host-auth').length);
      await controls(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('background'));
      await page.getByTestId('host-selected-originals').waitFor({ state: 'detached' });
      await page.getByText('Booth controls', { exact: true }).waitFor({ state: 'detached' });
      await controls(page, () => window.__NEW_SESSION_FIXTURE__.setAppState('active'));
      assert.equal(await page.getByTestId('host-selected-originals').count(), 0);
      assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-host-auth').length), authBefore);
      await openHost();
      assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.events.filter(event => event.kind === 'synthetic-host-auth').length), authBefore + 1);
      await page.getByRole('button', { name: 'Saved sessions', exact: true }).tap();
      await page.getByText('Open saved session →', { exact: true }).tap();
      await page.getByTestId('host-selected-originals').waitFor();
    }
    report.hostChecks.push({ check: 'Two synthetic background/foreground cycles redact private originals, leave host controls locked, and require one fresh host-auth call on each explicit reopen.', scope: 'Browser AppState/auth adapters only; no native biometric verification.' });
    const original = (await snapshot(page)).active;
    const selectedIds = original.shots.map(photo => photo.id);
    const [first, second] = original.shots;
    await page.getByTestId(`host-photo-export-${first.id}`).tap();
    await page.getByTestId('host-photo-decision').waitFor();
    await evidence('host-duplicate-confirmation');
    assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 0);
    await page.getByTestId('host-photo-decision-cancel').tap();
    assert.equal((await snapshot(page)).active.shots[0].exportStatus, 'uncertain');
    assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 0);
    await page.getByTestId(`host-photo-export-${first.id}`).tap();
    await page.getByTestId('host-photo-decision-confirm').tap();
    await page.waitForFunction(id => window.__NEW_SESSION_FIXTURE__.snapshot().active.shots.find(photo => photo.id === id).exportStatus === 'saved', first.id);
    assert.deepEqual(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.map(call => call.photoId)), [first.id]);
    assert.equal((await snapshot(page)).active.shots[1].exportStatus, 'uncertain');
    report.hostChecks.push({ check: 'Uncertain export requires explicit duplicate-risk confirmation; cancel performs no native SDK write; confirm exports exactly the selected original.', photoId: first.id, nativePort: 'mock MediaLibrary SDK only' });

    await page.getByTestId(`host-photo-ack-${second.id}`).tap();
    await page.getByTestId('host-photo-decision').waitFor();
    await evidence('host-acknowledge-confirmation');
    await page.getByTestId('host-photo-decision-cancel').tap();
    assert.equal((await snapshot(page)).active.shots[1].exportStatus, 'uncertain');
    await page.getByTestId(`host-photo-ack-${second.id}`).tap();
    await page.getByTestId('host-photo-decision-confirm').tap();
    await page.waitForFunction(id => window.__NEW_SESSION_FIXTURE__.snapshot().active.shots.find(photo => photo.id === id).exportStatus === 'saved', second.id);
    assert.deepEqual(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.map(call => call.photoId)), [first.id]);
    report.hostChecks.push({ check: 'Already in Photos requires host confirmation, cancel leaves uncertainty, and confirmed acknowledgment changes one status without making a native SDK copy.', photoId: second.id });

    await page.getByTestId('host-retained-originals').tap();
    const retained = original.retakes[0];
    await page.getByTestId(`host-original-${retained.id}`).scrollIntoViewIfNeeded();
    await evidence('host-retained-original');
    await page.getByTestId(`host-photo-export-${retained.id}`).tap();
    await page.waitForFunction(id => window.__NEW_SESSION_FIXTURE__.snapshot().active.retakes.find(photo => photo.id === id).exportStatus === 'saved', retained.id);
    assert.deepEqual(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.map(call => call.photoId)), [first.id, retained.id]);
    let state = await snapshot(page);
    assert.deepEqual(state.active.shots.map(photo => photo.id), selectedIds);
    assert.deepEqual(state.jobs.map(job => job.photoId).sort(), [...selectedIds].sort());
    await evidence('host-retained-exported');
    await page.getByRole('button', { name: 'Done', exact: true }).tap();
    await page.getByTestId('guest-qr').waitFor();
    for (const photo of original.retakes) assert.equal(await page.locator(`#root img[src*="${photo.id}"]`).count(), 0);
    report.hostChecks.push({ check: 'A retained earlier take can be viewed/exported individually; it changes no guest selection and receives no guest upload job.', retainedPhotoId: retained.id, guestPhotoIds: selectedIds });

    for (const [fixture, expectedSaved] of [['staged-empty', 0], ['staged', 4]]) {
      await load(page, fixture);
      state = await snapshot(page);
      assert.equal(state.active.shots.length, expectedSaved);
      assert.equal(state.active.stagedOriginals.length, 1);
      const status = await page.getByTestId('capture-save-status').innerText();
      assert.ok(expectedSaved === 0 ? status.includes('No photos saved for this set yet') : status.includes('4 of 5 originals saved on this iPad'));
      await save(page, `staged-${expectedSaved}-saved`, 'portrait');
      await openHost(); await page.getByRole('button', { name: 'Saved sessions', exact: true }).tap(); await page.getByText('Open saved session →', { exact: true }).tap();
      const staged = state.active.stagedOriginals[0];
      assert.equal(await page.getByTestId(`host-photo-export-${staged.id}`).count(), 0);
      await page.getByTestId('host-finish-local-save').scrollIntoViewIfNeeded();
      await evidence(`host-staged-${expectedSaved}-saved`);
      await page.getByTestId('host-finish-local-save').tap();
      await page.waitForFunction(count => { const value = window.__NEW_SESSION_FIXTURE__.snapshot().active; return value.shots.length === count && value.stagedOriginals.length === 0; }, expectedSaved + 1);
      assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoExportCalls.length), 0);
      report.hostChecks.push({ check: 'Staged exposure is not counted as saved, is not offered to Photos, and becomes one saved selected original only after Finish local save.', initialSavedCount: expectedSaved, stagedPhotoId: staged.id, initialStatus: status, finalSavedCount: expectedSaved + 1 });
    }

    await load(page, 'index-repair'); await openHost();
    const warning = await page.getByTestId('host-index-repair-status').innerText();
    assert.equal((await snapshot(page)).jobs.length, 0);
    assert.match(warning, /repair/i);
    await evidence('host-index-repair-before');
    await controls(page, () => { window.__NEW_SESSION_FIXTURE__.indexWritable = true; });
    await page.getByRole('button', { name: 'Repair index & retry sharing', exact: true }).tap();
    await page.waitForFunction(() => { const value = window.__NEW_SESSION_FIXTURE__.snapshot(); return value.jobs.length === 5 && !value.active.storageWarning; });
    assert.equal((await snapshot(page)).jobs.filter(job => job.state === 'pending').length, 5);
    await page.getByTestId('host-index-repair-status').waitFor({ state: 'detached' });
    await evidence('host-index-repair-after');
    report.hostChecks.push({ check: 'A zero queue with pending index repair remains visibly incomplete; simulated local index recovery recreates five pending selected jobs while the network remains offline.', initialWarning: warning, recreatedPendingJobs: 5, nativeRepair: 'simulated in-memory port; actual filesystem/SQLite recovery unverified here' });
  } finally { await context.close(); }
}
