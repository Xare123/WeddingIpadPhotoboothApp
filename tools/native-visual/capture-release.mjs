/** DEV-ONLY harness checking actual App guest JSX with __DEV__ false. Not an iOS release build. */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const checks = { scope: 'Actual App.tsx release UI (__DEV__=false) in development-only browser fixture with synthetic device adapters. Not an iOS release build.', screenshot: 'artifacts/visual/ipad-ready-release-portrait.png', interactions: [], errors: [], externalRequests: [] };
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => checks.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') checks.errors.push(m.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:8791') return route.continue();
    checks.externalRequests.push(url.origin);
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8791/?state=ready');
  await page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next guest', exact: true }).waitFor();
  assert.match(await page.locator('#fixture-banner').innerText(), /release UI \(__DEV__=false\)/);
  assert.equal(await page.getByRole('button', { name: /phone sharing|sharing test|simulated share/i }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: /phone number/i }).count(), 0);
  assert.equal(await page.getByText(/Phone-sharing simulation complete|Phone-sharing test queued/).count(), 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: checks.screenshot });
  checks.interactions.push('Actual release guest JSX renders ready QR and Next guest with no phone simulation controls, inputs, or status.');
  await page.getByRole('button', { name: 'Next guest', exact: true }).click();
  await page.getByRole('button', { name: 'Take our photo', exact: true }).waitFor();
  assert.equal(await page.getByText('YOUR PRIVATE PHOTO PAGE', { exact: true }).count(), 0);
  checks.interactions.push('Release UI Next guest clears prior fixture QR and returns to camera.');
  assert.deepEqual(checks.errors, []);
  assert.deepEqual(checks.externalRequests, []);
} finally {
  await writeFile('artifacts/visual/ipad-release-fixture-checks.json', JSON.stringify(checks, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(checks, null, 2));
