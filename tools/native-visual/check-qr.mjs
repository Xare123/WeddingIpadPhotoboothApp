/** Independent decoding of actual App screenshots, never a physical phone scan. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const optional = createRequire(new URL('../../.cache/qr-tools/package.json', import.meta.url));
const { chromium } = require('playwright');
const encoder = require('qrcode');
const { PNG } = optional('pngjs');
const jsQR = optional('jsqr');
const cpp = optional('zxing-wasm/reader');
const zxingJS = optional('@zxing/library');
cpp.prepareZXingModule({ overrides: { wasmBinary: await readFile(optional.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
const payloads = {
  reserved: 'https://photobooth.example/g/' + 'a7'.repeat(32),
  realistic: 'https://photos.gizelleandrami.com/g/d948b21e9fbc4a03952beed701f680cf09e8d382f5c421a9f7da6034cbb16e52',
  'reserved-numeric': 'https://photobooth.example/g/' + '1'.repeat(64),
  'realistic-numeric': 'https://photos.gizelleandrami.com/g/' + '1'.repeat(64),
  'short-numeric': 'https://a.example/g/' + '1'.repeat(64),
};
function decodeJS(png, pure = false) {
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (png.data[4 * i] + 2 * png.data[4 * i + 1] + png.data[4 * i + 2]) / 4;
  try {
    const bitmap = new zxingJS.BinaryBitmap(new zxingJS.HybridBinarizer(new zxingJS.RGBLuminanceSource(gray, png.width, png.height)));
    return { text: new zxingJS.QRCodeReader().decode(bitmap, pure ? new Map([[zxingJS.DecodeHintType.PURE_BARCODE, true]]) : undefined).getText() };
  } catch (error) { return { error: error.constructor.name }; }
}
async function decode(png) {
  const data = new Uint8ClampedArray(png.data);
  return {
    jsQR: jsQR(data, png.width, png.height)?.data ?? null,
    zxingCpp: (await cpp.readBarcodes({ data, width: png.width, height: png.height }, { formats: ['QRCode'] })).map(result => ({ text: result.text, error: result.error })),
    zxingJS: decodeJS(png),
  };
}
const report = {
  scope: 'Actual App.tsx release JSX through RN-web with synthetic camera/storage/sync. Full-frame screenshot decoder tests; no iOS or physical-phone verification.',
  generatedAt: new Date().toISOString(),
  timezoneId: 'America/Los_Angeles',
  sourceSHA256: createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex'),
  versions: { qrcode: '1.5.4', reactNativeQRCodeSVG: '6.3.27', jsQR: '1.4.0', zxingCppWasm: '3.1.6', zxingJS: '0.23.0', pngjs: '7.0.0' },
  originalEvidence: [], controls: [], rendered: [], externalRequests: [], errors: [],
};
// Keep the original failure evidence. It is not rewritten or repaired.
for (const file of ['artifacts/visual/qr-before-portrait.png', 'artifacts/visual/qr-before-svg.png']) {
  const png = PNG.sync.read(await readFile(file));
  report.originalEvidence.push({ file, width: png.width, height: png.height, ...await decode(png), zxingJSPure: decodeJS(png, true) });
}
// Reference controls are not substitutes for the actual rendered checks below.
for (const scale of [4, 5]) {
  const file = `artifacts/visual/qr-reference-${scale}px-module.png`;
  const bytes = await encoder.toBuffer(payloads.reserved, { errorCorrectionLevel: 'M', scale, margin: 4 });
  await writeFile(file, bytes);
  const png = PNG.sync.read(bytes);
  report.controls.push({ file, width: png.width, height: png.height, explicitQuietModules: 4, pixelsPerModule: scale, ...await decode(png), zxingJSPure: decodeJS(png, true) });
}
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ deviceScaleFactor: dpr, reducedMotion: 'reduce', timezoneId: report.timezoneId });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:8791') return route.continue();
      report.externalRequests.push(url.origin);
      return route.abort();
    });
    for (const [orientation, viewport] of Object.entries({ portrait: { width: 820, height: 1180 }, landscape: { width: 1180, height: 820 } })) {
      for (const [payload, expectedURL] of Object.entries(payloads)) {
        assert.match(new URL(expectedURL).pathname, /^\/g\/[a-f0-9]{64}$/);
        await page.setViewportSize(viewport);
        await page.goto(`http://127.0.0.1:8791/?state=ready&qrPayload=${payload}`);
        await page.locator('svg').waitFor();
        await page.waitForTimeout(200);
        assert.match(await page.locator('#fixture-banner').innerText(), /release UI \(__DEV__=false\)/);
        const svg = await page.locator('svg').evaluate(element => ({ viewBox: element.getAttribute('viewBox'), width: Number(element.getAttribute('width')), height: Number(element.getAttribute('height')), box: element.getBoundingClientRect().toJSON(), strokeWidth: Number(element.querySelector('path').getAttribute('stroke-width')) }));
        const moduleCount = encoder.create(expectedURL, { errorCorrectionLevel: 'M' }).modules.size;
        const quietUnits = -Number(svg.viewBox.split(' ')[0]);
        const quietModules = quietUnits / (svg.width / moduleCount);
        assert.ok(quietModules >= 4, `Explicit QR quiet zone is ${quietModules} modules`);
        const file = `artifacts/visual/qr-ready-${payload}-${orientation}-${dpr}x.png`;
        const bytes = await page.screenshot({ path: file });
        const png = PNG.sync.read(bytes);
        const decoded = await decode(png);
        const nextGuest = await page.getByRole('button', { name: 'Next guest', exact: true }).boundingBox();
        const entry = { file, orientation, viewport, dpr, expectedURL, payloadLength: expectedURL.length, moduleCount, quietModules, svg, nextGuest, nextGuestInitiallyVisible: !!nextGuest && nextGuest.y >= 0 && nextGuest.y + nextGuest.height <= viewport.height, ...decoded };
        report.rendered.push(entry);
        assert.equal(entry.nextGuestInitiallyVisible, true, `${file}: Next guest outside initial viewport`);
        assert.equal(decoded.jsQR, expectedURL, `${file}: jsQR exact payload mismatch`);
        assert.equal(decoded.zxingCpp.length, 1);
        assert.equal(decoded.zxingCpp[0].text, expectedURL, `${file}: ZXing-C++ exact payload mismatch`);
        assert.equal(decoded.zxingCpp[0].error, '');
        assert.ok(svg.box.x >= 0 && svg.box.right <= viewport.width && svg.box.y >= 0 && svg.box.bottom <= viewport.height);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
} finally {
  await writeFile('artifacts/visual/qr-rendered-checks.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ renderedCases: report.rendered.length, matchedInBothIndependentDecoders: report.rendered.filter(result => result.jsQR === result.expectedURL && result.zxingCpp[0]?.text === result.expectedURL).length, nextGuestVisible: report.rendered.map(({ orientation, dpr, expectedURL, nextGuestInitiallyVisible }) => ({ orientation, dpr, host: new URL(expectedURL).hostname, nextGuestInitiallyVisible })), externalRequests: report.externalRequests, errors: report.errors }, null, 2));
