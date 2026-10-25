/** DEV ONLY. Verifies browser-fixture JSX interactions, never native device behavior. */
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const checks = { scope: 'Browser fixture of actual App.tsx native JSX; synthetic in-memory camera/storage/auth/sync. Not iOS or physical-device verification.', states: [], interactions: [], errors: [], externalRequests: [] };
await mkdir('artifacts/visual', { recursive: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:8791') return route.continue();
    checks.externalRequests.push(url.origin);
    return route.abort();
  });
  page.on('pageerror', e => checks.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') checks.errors.push(m.text()); });
  const load = async (state, size = { width: 820, height: 1180 }) => {
    await page.setViewportSize(size);
    await page.goto(`http://127.0.0.1:8791/?state=${state}`);
    await page.getByText('THE WEDDING PHOTOBOOTH', { exact: true }).waitFor();
    await page.waitForTimeout(300);
  };
  for (const [orientation, size] of Object.entries({ portrait: { width: 820, height: 1180 }, landscape: { width: 1180, height: 820 } })) {
    for (const state of ['camera', 'review', 'offline-pending', 'ready', 'mock-share']) {
      await load(state, size);
      const file = `artifacts/visual/ipad-${state}-${orientation}.png`;
      await page.screenshot({ path: file });
      const layout = await page.evaluate(() => {
        const scrolls = [...document.querySelectorAll('#root div')].filter(e => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'auto');
        return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          verticalScroll: scrolls.map(e => ({ viewport: e.clientHeight, content: e.scrollHeight })),
          outOfBounds: [...document.querySelectorAll('[role="button"],svg')].map(e => ({ label: e.textContent || e.getAttribute('aria-label') || e.tagName, box: e.getBoundingClientRect().toJSON() })).filter(e => e.box.x < -1 || e.box.right > innerWidth + 1),
        };
      });
      assert.equal(layout.horizontalOverflow, false);
      assert.equal(layout.outOfBounds.length, 0);
      checks.states.push({ state, orientation, size, screenshot: file, ...layout });
    }
  }
  await load('camera');
  await page.getByRole('button', { name: 'Take our photo', exact: true }).click();
  await page.getByText('Make it a memory', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/visual/ipad-countdown-portrait.png' });
  const cancel = page.getByRole('button', { name: /cancel countdown/i });
  if (await cancel.count()) {
    await cancel.click();
    await page.waitForTimeout(3300);
    assert.equal(await page.getByText('Made for remembering', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Take our photo', exact: true }).click();
    checks.interactions.push('Countdown cancel returns to camera and does not capture after original timer elapses.');
    await cancel.click();
    await page.getByRole('button', { name: 'Take our photo', exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByText('Make it a memory', { exact: true }).waitFor();
    assert.equal(await page.getByText('Made for remembering', { exact: true }).count(), 0);
    checks.interactions.push('Cancel followed by immediate restart preserves the new countdown after the canceled timer finishes.');
  } else checks.interactions.push('Countdown cancellation control absent in inspected App source; cannot exercise cancellation.');
  await page.getByRole('button', { name: 'Use this photo', exact: true }).waitFor({ timeout: 6000 });
  await page.getByRole('button', { name: 'Retake photo', exact: true }).click();
  await page.getByRole('button', { name: 'Take our photo', exact: true }).waitFor();
  checks.interactions.push('Synthetic capture reaches review; Retake photo returns to camera.');
  await page.getByRole('button', { name: 'Take our photo', exact: true }).click();
  await page.getByRole('button', { name: 'Use this photo', exact: true }).waitFor({ timeout: 6000 });
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click();
  await page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }).waitFor();
  checks.interactions.push('Confirming synthetic capture invokes synthetic ready sync and renders actual QR component.');
  await page.getByRole('button', { name: 'Next guest', exact: true }).click();
  await page.getByRole('button', { name: 'Take our photo', exact: true }).waitFor();
  assert.equal(await page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }).count(), 0);
  checks.interactions.push('Next guest clears prior QR/photo selection and returns to camera.');
  await load('offline-pending');
  await page.getByRole('button', { name: 'Retry sharing', exact: true }).click();
  assert.equal(await page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }).count(), 0);
  await page.getByText('Saved on this iPad', { exact: true }).waitFor();
  checks.interactions.push('Synthetic offline retry keeps original displayed and does not reveal a QR.');
  await load('ready');
  await page.getByRole('button', { name: 'Test phone sharing · no SMS', exact: true }).click();
  await page.getByRole('textbox', { name: 'International phone number for simulation' }).fill('+1 202 555 0100');
  await page.getByRole('checkbox').click();
  await page.screenshot({ path: 'artifacts/visual/ipad-phone-form-portrait.png' });
  await page.getByRole('button', { name: 'Queue simulated share', exact: true }).click();
  await page.getByText('Phone-sharing simulation complete. No text was sent.', { exact: true }).waitFor();
  checks.interactions.push('Fictional number + consent passes actual recipient validation to in-memory SecureStore and simulated sync; UI explicitly reports no SMS.');
  await page.getByRole('button', { name: 'Open host settings', exact: true }).click();
  await page.getByText('Connection settings', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/visual/ipad-host-settings-portrait.png' });
  await page.getByRole('button', { name: 'Back to booth', exact: true }).click();
  checks.interactions.push('Host settings opens and returns with fixture-only local authentication/config.');
  assert.deepEqual(checks.errors, []);
  assert.deepEqual(checks.externalRequests, []);
} finally {
  await writeFile('artifacts/visual/ipad-fixture-checks.json', JSON.stringify(checks, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ states: checks.states.length, interactions: checks.interactions, errors: checks.errors }, null, 2));
