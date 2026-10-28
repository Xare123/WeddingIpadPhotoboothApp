/** Synthetic generated-art composition evidence. Canvas approximation, NOT Apple runtime proof. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from './browser.mjs';
const output = 'artifacts/visual/frame-art-v3';
await mkdir(output, { recursive: true });
const report = { scope: 'Six synthetic Canvas approximations using exact original generated artwork and four distinct fictional adult photographs. NOT native CoreImage/CoreText, installation or physical-device proof.', outputs: [], externalRequests: [], errors: [], status: 'running' };
const bundle = await build({ stdin: { contents: `import { syntheticTemplatesV2 as templates, templateV2Geometry } from './template-v2-stub'; import { fixtureControls } from './fixture-controls'; import { originalImageVariants, syntheticRenderedBlobs } from './effects-stub'; window.__FRAME_ART_REVIEW__ = { templates, templateV2Geometry, fixtureControls, originalImageVariants, syntheticRenderedBlobs };`, resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1700 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:8791') { report.externalRequests.push(url.origin); return route.abort(); }
    if (url.pathname === '/frame-art-review') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:8791/frame-art-review');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { templates, templateV2Geometry, fixtureControls, originalImageVariants, syntheticRenderedBlobs } = window.__FRAME_ART_REVIEW__;
    fixtureControls.photoSet = 'clean-portrait';
    const ids = ['fictional-1', 'fictional-2', 'fictional-3', 'fictional-4'];
    const sources = ids.map((photoId, index) => { const uri = `file:///synthetic/${photoId}.jpg`; originalImageVariants.set(uri, index); return { photoId, uri }; });
    const original = await templates.inspectTemplateSources(sources);
    const bytes = async blob => { const data = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const v of data) binary += String.fromCharCode(v); return btoa(binary); };
    const outputs = [];
    for (const layout of ['strip', 'grid']) for (const theme of ['classic', 'botanical', 'coastal']) {
      const recipe = { version: 'wedding-template-v3', gridAspect: 'square', layout, theme, photoIds: ids, cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) };
      const full = await templates.renderTemplate(sources, JSON.stringify(recipe), false, crypto.randomUUID());
      const preview = await templates.renderTemplate(sources, JSON.stringify(recipe), true, crypto.randomUUID());
      const fullBlob = syntheticRenderedBlobs.get(full.uri), previewBlob = syntheticRenderedBlobs.get(preview.uri);
      const fullBitmap = await createImageBitmap(fullBlob), previewBitmap = await createImageBitmap(previewBlob);
      const comparison = new OffscreenCanvas(preview.width, preview.height), cmp = comparison.getContext('2d');
      cmp.drawImage(fullBitmap, 0, 0, preview.width, preview.height); const fullPixels = cmp.getImageData(0, 0, preview.width, preview.height).data;
      cmp.clearRect(0, 0, preview.width, preview.height); cmp.drawImage(previewBitmap, 0, 0); const previewPixels = cmp.getImageData(0, 0, preview.width, preview.height).data;
      let difference = 0, channels = 0;
      for (let i = 0; i < fullPixels.length; i++) if (i % 4 !== 3) { difference += Math.abs(fullPixels[i] - previewPixels[i]); channels++; }
      const meanPreviewFullJpegDifference = difference / channels;
      outputs.push({ meanPreviewFullJpegDifference, layout, theme, recipe, geometry: templateV2Geometry(recipe), full: { ...full, bytes: await bytes(fullBlob), byteLength: fullBlob.size }, preview: { ...preview, bytes: await bytes(previewBlob), byteLength: previewBlob.size } });
    }
    const canvas = new OffscreenCanvas(1800, 1800), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#E6E1D8'; ctx.fillRect(0, 0, 1800, 1800); ctx.fillStyle = '#352B25'; ctx.font = '26px Georgia';
    ctx.fillText('Original generated artwork · synthetic photo keepsakes', 32, 44); ctx.font = '18px sans-serif'; ctx.fillText('Canvas composition approximation · native Apple rendering pending', 32, 76);
    for (const [index, value] of outputs.entries()) {
      const source = await createImageBitmap(syntheticRenderedBlobs.get(value.full.uri)), col = index % 3, row = Math.floor(index / 3);
      const cell = { x: 30 + col * 590, y: 110 + row * 840, width: 550, height: 770 };
      const factor = Math.min(cell.width / source.width, cell.height / source.height), width = source.width * factor, height = source.height * factor;
      ctx.drawImage(source, cell.x + (cell.width - width) / 2, cell.y, width, height);
      ctx.fillStyle = '#352B25'; ctx.font = '23px Georgia'; ctx.fillText(`${value.layout === 'strip' ? 'Photo strip' : 'Square four-cut'} · ${ {classic:'Classic Ivory', botanical:'Sage Botanical', coastal:'Coastal Sea Glass'}[value.theme] }`, cell.x, cell.y + cell.height + 33);
    }
    return { original, outputs, contact: await bytes(await canvas.convertToBlob({ type: 'image/png' })) };
  });
  for (const item of result.outputs) {
    assert.deepEqual([item.full.width, item.full.height], item.layout === 'strip' ? [1200, 3600] : [2400, 2400]);
    assert.deepEqual([item.preview.width, item.preview.height], item.layout === 'strip' ? [480, 1440] : [1440, 1440]);
    assert.equal(new Set(Object.values(item.full.sourceHashes)).size, 4);
    assert.ok(item.meanPreviewFullJpegDifference < 3, 'Preview/full image parity within JPEG resampling tolerance');
    assert.deepEqual(item.full.sourceHashes, item.preview.sourceHashes);
    for (const mode of ['full', 'preview']) {
      const value = item[mode], data = Buffer.from(value.bytes, 'base64'), file = `${output}/${item.layout}-${item.theme}-${mode}.jpg`;
      await writeFile(file, data); delete value.bytes; delete value.uri;
      value.file = file; value.sha256 = createHash('sha256').update(data).digest('hex');
    }
    report.outputs.push(item);
  }
  assert.equal(new Set(report.outputs.map(v => v.full.sha256)).size, 6);
  await writeFile(`${output}/contact-sheet.png`, Buffer.from(result.contact, 'base64'));
  report.originalSources = result.original;
  report.sourceHashes = {};
  for (const file of ['tools/native-visual/new-session/template-v2-stub.ts', 'tools/native-visual/new-session/frame-art-v3-checks.mjs', 'apps/ipad/modules/wedding-photo-effects/ios/PhotoTemplateEngine.swift']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  report.artwork = [];
  for (const name of ['Classic-Ivory', 'Sage-Botanical', 'Coastal-Sea-Glass']) {
    const file = `design/frame-art-v1/${name}-Text-Free-Artwork.png`, data = await readFile(file);
    report.artwork.push({ file, sha256: createHash('sha256').update(data).digest('hex') });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  report.status = 'passed';
  await context.close();
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally { await browser.close(); await writeFile(`${output}/checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, outputs: report.outputs.length, scope: report.scope }));
