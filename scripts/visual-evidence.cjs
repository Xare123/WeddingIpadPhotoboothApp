#!/usr/bin/env node
/** Local-only browser verification. Capability URLs are kept in memory and never logged. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const output = path.resolve(__dirname, '../artifacts/visual');
const origin = process.env.VISUAL_API_ORIGIN || 'http://127.0.0.1:8790';
const base = new URL(origin);
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Local emulator only');
const auth = { Authorization: 'Bearer local-development-only' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [];
function passed(message) { checks.push(message); }
async function api(route, options = {}) {
  const response = await fetch(new URL(route, origin), { ...options, headers: { ...auth, ...options.headers } });
  assert(response.ok, `Local API request failed with HTTP ${response.status}`);
  return response.json();
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const sourcePath = path.resolve(__dirname, '../services/api/src/index.ts');
  const sourceSha256 = hash(await fs.readFile(sourcePath));
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let session;
  let revoked = false;
  try {
    const health = await api('/health');
    assert.equal(health.status, 'ok');
    assert.equal(health.storage, 'local-r2');
    assert.equal(health.sms, 'mock');
    assert.equal(health.smsAvailable, false);
    const generator = await browser.newPage();
    const samples = [];
    // Original synthetic illustrations, deliberately labeled as samples: no guest photography.
    for (let variant = 0; variant < 5; variant++) {
      const data = await generator.evaluate(v => {
        const c = document.createElement('canvas'); c.width = 1200; c.height = 1500;
        const x = c.getContext('2d');
        const palettes = [['#bba18a', '#eee1ca', '#52685d'], ['#c39c81', '#f3dbb9', '#9a4f32'], ['#7b9282', '#e9d7b6', '#4b655d']];
        const [dark, light, leaf] = palettes[v % palettes.length];
        const gradient = x.createLinearGradient(0, 0, 1200, 1500); gradient.addColorStop(0, dark); gradient.addColorStop(1, light);
        x.fillStyle = gradient; x.fillRect(0, 0, 1200, 1500);
        x.fillStyle = '#fbf6ec'; x.globalAlpha = .65; x.beginPath(); x.roundRect(230, 200, 740, 1180, [380, 380, 0, 0]); x.fill(); x.globalAlpha = 1;
        x.strokeStyle = '#b8964f'; x.lineWidth = 8; x.beginPath(); x.roundRect(250, 220, 700, 1160, [350, 350, 0, 0]); x.stroke();
        // Botanical branches and petals.
        for (let side = 0; side < 2; side++) {
          x.save(); x.translate(side ? 1040 : 160, 1180); if (side) x.scale(-1, 1);
          x.strokeStyle = leaf; x.lineWidth = 7; x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(110, -270, -100, -580, 130, -950); x.stroke();
          for (let i = 0; i < 19; i++) {
            const y = -i * 47, a = i % 2 ? -.7 : .7;
            x.save(); x.translate(40 + 24 * Math.sin(i), y); x.rotate(a); x.fillStyle = leaf; x.globalAlpha = .7;
            x.beginPath(); x.ellipse(0, -35, 18, 65, .5, 0, Math.PI * 2); x.fill(); x.restore();
          }
          for (let i = 0; i < 7; i++) {
            const px = 35 + 55 * Math.cos(i * 1.7), py = -700 - 70 * Math.sin(i * 1.7);
            x.fillStyle = ['#fbf6ec', '#e2b6a1', '#eed5bf'][i % 3];
            for (let petal = 0; petal < 5; petal++) { x.beginPath(); x.ellipse(px + 24 * Math.cos(petal * 1.25), py + 24 * Math.sin(petal * 1.25), 27, 22, petal, 0, Math.PI * 2); x.fill(); }
            x.fillStyle = '#b8964f'; x.beginPath(); x.arc(px, py, 10, 0, Math.PI * 2); x.fill();
          } x.restore();
        }
        x.textAlign = 'center'; x.fillStyle = '#4a4236'; x.font = 'italic 78px Georgia'; x.fillText(['A little magic.', 'To the happy days.', 'Just married.'][v % 3], 600, 520);
        x.font = '22px sans-serif'; x.fillText('A MOMENT FROM THE CELEBRATION', 600, 580);
        // Stylized champagne coupes; clearly illustrative rather than a camera photograph.
        for (let i = 0; i < 2; i++) {
          x.save(); x.translate(i ? 730 : 470, 860); x.rotate(i ? .16 : -.16);
          x.fillStyle = '#d9b678'; x.globalAlpha = .8; x.beginPath(); x.ellipse(0, 0, 119, 37, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
          x.strokeStyle = '#fbf6ec'; x.lineWidth = 7; x.beginPath(); x.ellipse(0, -15, 120, 43, 0, 0, Math.PI * 2); x.moveTo(-118, -6); x.quadraticCurveTo(0, 190, 118, -6); x.moveTo(0, 98); x.lineTo(0, 320); x.moveTo(-85, 325); x.quadraticCurveTo(0, 295, 85, 325); x.stroke(); x.restore();
        }
        for (let i = 0; i < 20; i++) { x.fillStyle = i % 2 ? '#b8964f' : '#fbf6ec'; x.save(); x.translate(330 + ((i * 173 + v * 31) % 540), 640 + ((i * 67) % 170)); x.rotate(i); x.fillRect(0, 0, 6, 14); x.restore(); }
        x.fillStyle = '#3b342b'; x.globalAlpha = .86; x.fillRect(0, 1400, 1200, 100); x.globalAlpha = 1;
        x.fillStyle = '#fbf6ec'; x.font = '22px sans-serif'; x.fillText('SAMPLE SCENE · SYNTHETIC ILLUSTRATION · ' + String(v + 1).padStart(2, '0'), 600, 1459);
        return c.toDataURL('image/jpeg', .94).split(',')[1];
      }, variant);
      const bytes = Buffer.from(data, 'base64');
      await fs.writeFile(path.join(output, `sample-scene-${variant + 1}.jpg`), bytes);
      samples.push({ bytes, photoId: randomUUID() });
    }
    await generator.close();
    session = randomUUID();
    for (const sample of samples) await api(`/v1/sessions/${session}/photos/${sample.photoId}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: sample.bytes });
    const ready = await api(`/v1/sessions/${session}/ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: samples.map(s => s.photoId) }) });
    const galleryUrl = ready.url;
    passed('Health confirmed local R2, mock SMS and smsAvailable:false. Uploaded five original labeled synthetic 1200 × 1500 JPEGs to the local R2 emulator and finalized a real gallery. No messaging request was made.');
    const screenshots = [];
    for (const size of [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 820, height: 1180 }, { name: 'desktop', width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, acceptDownloads: true, timezoneId: 'America/Los_Angeles' });
      const page = await context.newPage();
      const errors = [];
      let externalRequests = 0;
      page.on('pageerror', () => errors.push('pageerror'));
      page.on('request', r => { if (new URL(r.url()).origin !== base.origin) externalRequests++; });
      const response = await page.goto(galleryUrl, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.match(response.headers()['cache-control'], /private, no-store/);
      assert.equal(response.headers()['referrer-policy'], 'no-referrer');
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'America/Los_Angeles');
      const expiry = page.locator('.expiry time');
      assert.equal(await expiry.getAttribute('datetime'), new Date(ready.expiresAt).toISOString());
      assert.equal(await expiry.textContent(), new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(ready.expiresAt)) + ' UTC');
      await page.getByText('Link expiry closes access; it does not delete the original photos.', { exact: false }).waitFor();
      for (let i = 0; i < samples.length; i++) {
        const img = page.locator('.photo img').nth(i);
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(async element => { await element.decode(); });
        assert.equal(await img.evaluate(e => e.naturalWidth), 1200);
        assert.equal(await img.evaluate(e => e.naturalHeight), 1500);
        assert(await img.getAttribute('alt'));
        const link = page.getByRole('link', { name: `Download photo ${i + 1} in full resolution` });
        const bounds = await link.boundingBox(); assert(bounds.height >= 44 && bounds.width >= 44);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.photo img').count(), samples.length);
      assert.equal(await page.getByText('Full resolution · JPEG', { exact: true }).count(), samples.length);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.hero').evaluate(e => getComputedStyle(e).animationName), 'reveal');
      assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
      await page.screenshot({ path: path.join(output, `gallery-${size.name}.png`), fullPage: true, animations: 'disabled' });
      await page.screenshot({ path: path.join(output, `gallery-${size.name}-viewport.png`), fullPage: false, animations: 'disabled' });
      screenshots.push({ name: `gallery-${size.name}.png`, viewport: `${size.width} × ${size.height}`, type: 'Actual browser screenshot; full page' });
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
      assert.equal(focused.tag, 'A'); assert.equal(focused.outline, 'solid');
      if (size.name === 'phone') {
        const event = page.waitForEvent('download');
        await page.getByRole('link', { name: 'Download photo 1 in full resolution' }).click();
        const download = await event;
        assert.equal(download.suggestedFilename(), 'wedding-photo-1.jpg');
        const file = await download.path(); assert.equal(hash(await fs.readFile(file)), hash(samples[0].bytes));
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert(await page.evaluate(() => [...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).animationName === 'none')));
      assert.equal(await page.locator('.download').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
      assert.equal(errors.length, 0); assert.equal(externalRequests, 0);
      passed(`${size.width} × ${size.height}: five images decoded at original dimensions; no horizontal overflow; named download controls ≥44 px; full-resolution labels; keyboard focus visible; entrance animations complete; reduced motion removes animation/transitions; exact UTC expiry with semantic time element remains consistent in America/Los_Angeles browser timezone; photo-retention copy visible; zero page errors or external requests.`);
      await context.close();
    }
    for (const sample of samples) {
      const download = await fetch(`${galleryUrl}/photos/${sample.photoId}?download=1`);
      assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /^attachment;/);
      assert.equal(hash(Buffer.from(await download.arrayBuffer())), hash(sample.bytes));
    }
    passed('All five served downloads were byte-identical to their uploaded JPEGs. Actual browser download of the first JPEG also matched and used wedding-photo-1.jpg.');
    await api(`/v1/sessions/${session}/gallery`, { method: 'DELETE' }); revoked = true;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
    const closed = await page.goto(galleryUrl, { waitUntil: 'networkidle' });
    assert.equal(closed.status(), 410);
    await page.getByRole('heading', { name: 'This gallery is closed.' }).waitFor();
    assert.equal(await page.locator('img, .download').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'gallery-revoked-phone.png'), fullPage: true, animations: 'disabled' });
    const blocked = await fetch(`${galleryUrl}/photos/${samples[0].photoId}?download=1`); assert.equal(blocked.status, 410);
    const missing = await page.goto(new URL('/g/missing-sample-gallery', origin).href, { waitUntil: 'networkidle' });
    assert.equal(missing.status(), 404);
    await page.getByRole('heading', { name: 'A moment, out of reach.' }).waitFor();
    await page.screenshot({ path: path.join(output, 'gallery-missing-phone.png'), fullPage: true, animations: 'disabled' });
    passed('Revoked gallery returned a real HTTP 410 page, hid all photos/download controls, and blocked its photo download. Missing link returned a real HTTP 404 page.');
    assert.equal(hash(await fs.readFile(sourcePath)), sourceSha256, 'Worker source changed during browser evidence capture');
    const manifest = {
      generatedAt: new Date().toISOString(), engine: `Chromium ${browser.version()}`, command: 'node scripts/visual-evidence.cjs (local Worker required)',
      source: { path: 'services/api/src/index.ts', sha256: sourceSha256, stableDuringCapture: true }, browserTimezone: 'America/Los_Angeles',
      scope: 'Actual local Worker guest gallery rendered in desktop Chromium at responsive viewport sizes. Native iPad / iOS Safari / physical camera / native animations were not executed.',
      sampleCount: samples.length, samples: 'Five original synthetic illustrations created with browser canvas; labeled SAMPLE SCENE in every image. No private photos, phone numbers, or messaging used.',
      capabilityHandling: 'Capability URLs and session identifiers omitted from artifacts and stdout. Gallery revoked after captures. Emulator photo bytes remain local.', screenshots, checks,
    };
    await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'evidence.md'), `# Guest gallery: actual browser evidence\n\nCaptured ${manifest.generatedAt}. ${manifest.engine}. Browser timezone: ${manifest.browserTimezone}; gallery expiry explicitly uses UTC.\n\nWorker source: \`${manifest.source.path}\`, SHA-256 \`${manifest.source.sha256}\`; unchanged during capture.\n\n${manifest.scope}\n\n${manifest.samples}\n\nRun with a local Worker on the script’s default test port: \`node scripts/visual-evidence.cjs\`. Uses the installed Chromium executable and Playwright; does not install dependencies or browsers. The API origin can be overridden with \`VISUAL_API_ORIGIN\`, restricted to loopback for internal testing.\n\n## Actual screenshots\n\n${screenshots.map(s => `- [${s.viewport}: full gallery](${s.name}) · [viewport crop](${s.name.replace('.png', '-viewport.png')})`).join('\n')}\n- [Revoked gallery: phone](gallery-revoked-phone.png)\n- [Missing link: phone](gallery-missing-phone.png)\n\n## Automated checks\n\n${checks.map(s => `- PASS: ${s}`).join('\n')}\n\n${manifest.capabilityHandling}\n\nVisual inspection notes are recorded separately in [visual-review.md](visual-review.md). Responsive Chromium captures do not establish native iPad or Safari behavior. Rate-limit 429 rendering is covered by the existing unit suite; this browser run stays below request quotas and does not claim a captured 429 state.\n`);
    console.log(`PASS: ${checks.length} check groups; eight actual browser PNGs; Chromium ${browser.version()}. Artifacts: artifacts/visual. Gallery revoked. No capability URLs recorded.`);
  } finally {
    if (session && !revoked) await api(`/v1/sessions/${session}/gallery`, { method: 'DELETE' }).catch(() => {});
    await browser.close();
  }
})().catch(() => { console.error('FAIL: browser evidence assertion failed. No capability URLs emitted; inspect the failing step locally.'); process.exitCode = 1; });
