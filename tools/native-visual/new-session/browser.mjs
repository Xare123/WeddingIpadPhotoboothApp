/** Environment-owned browser tools only; no installs or real service requests. */
import { createRequire } from 'node:module';
import { readFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
export async function launchBrowser() {
  // Playwright accepts a custom tools cache. Reuse the installed system FFmpeg;
  // no browser/codec download or unchecked binary is introduced.
  const manifest = JSON.parse(await readFile(path.join(path.dirname(require.resolve('playwright-core')), 'browsers.json')));
  const revision = manifest.browsers.find(tool => tool.name === 'ffmpeg').revision;
  const cache = path.join(root, '.cache/new-session-visual/playwright-tools');
  const directory = path.join(cache, `ffmpeg-${revision}`);
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, 'ffmpeg-linux');
  try { await symlink('/usr/bin/ffmpeg', executable); }
  catch (error) { if (error.code !== 'EEXIST' || await realpath(executable) !== '/usr/bin/ffmpeg') throw error; }
  process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
  const { chromium } = require('playwright');
  return chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
}
export async function createContext(browser, report, options = {}) {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', hasTouch: true, ...options });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:8791') return route.continue();
    if (url.origin === 'https://photobooth.example' && url.pathname === '/health') {
      report.mockedHealthRequests.push(url.href);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', sms: 'mock', smsAvailable: false }) });
    }
    report.unexpectedExternalRequests.push(url.origin);
    return route.abort();
  });
  context.on('page', page => {
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  });
  return context;
}
export async function swipeLeft(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Review gallery has no visible touch target');
  const client = await page.context().newCDPSession(page);
  const startX = box.x + box.width * 0.85, endX = box.x + box.width * 0.15, y = box.y + box.height * 0.5;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * i / 12, y }] });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}
