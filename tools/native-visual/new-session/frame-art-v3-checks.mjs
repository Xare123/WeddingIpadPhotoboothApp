/** Synthetic generated-art composition evidence. Canvas approximation, NOT Apple runtime proof. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from './browser.mjs';
const output = 'artifacts/visual/frame-art-v3';
await mkdir(output, { recursive: true });
const report = { scope: 'Six synthetic Canvas approximations using exact original generated artwork and four distinct fictional adult photographs. NOT native CoreImage/CoreText, installation or physical-device proof.', outputs: [], externalRequests: [], errors: [], status: 'running' };
const bundle = await build({ stdin: { contents: `import { syntheticTemplatesV2 as templates, templateV2Geometry } from './template-v2-stub'; import { fixtureControls } from './fixture-controls'; import { originalImageVariants, syntheticRenderedBlobs, syntheticSource } from './effects-stub'; window.__FRAME_ART_REVIEW__ = { templates, templateV2Geometry, fixtureControls, originalImageVariants, syntheticRenderedBlobs, syntheticSource };`, resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
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
    const { templates, templateV2Geometry, fixtureControls, originalImageVariants, syntheticRenderedBlobs, syntheticSource } = window.__FRAME_ART_REVIEW__;
    fixtureControls.photoSet = 'clean-portrait';
    const ids = ['fictional-1', 'fictional-2', 'fictional-3', 'fictional-4'];
    const sources = ids.map((photoId, index) => { const uri = `file:///synthetic/${photoId}.jpg`; originalImageVariants.set(uri, index); return { photoId, uri }; });
    const original = await templates.inspectTemplateSources(sources);
    const bytes = async blob => { const data = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const v of data) binary += String.fromCharCode(v); return btoa(binary); };
    const outputs = [];
    const pixelCanvas = bitmap => { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); return { canvas, ctx, pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data }; };
    const at = (pixels, width, x, y) => { const i = (Math.floor(y) * width + Math.floor(x)) * 4; return [...pixels.slice(i, i + 3)]; };
    const differenceRGB = (a, b) => a.map((v, i) => Math.abs(v - b[i]));
    async function artReference(recipe, geometry) {
      const name = { classic: 'Classic-Ivory', botanical: 'Sage-Botanical', coastal: 'Coastal-Sea-Glass' }[recipe.theme];
      const image = await createImageBitmap(await (await fetch(`/frame-art-v1/${name}-Text-Free-Artwork.png`)).blob());
      const canvas = new OffscreenCanvas(geometry.width, geometry.height), ctx = canvas.getContext('2d'), edge = recipe.layout === 'strip' ? 250 : 350;
      const input = [0, 250, 1004, 1254], xs = [0, edge, geometry.width - edge, geometry.width], ys = [0, edge, geometry.height - edge, geometry.height];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ctx.drawImage(image, input[x], input[y], input[x+1]-input[x], input[y+1]-input[y], xs[x], ys[y], xs[x+1]-xs[x], ys[y+1]-ys[y]);
      return ctx.getImageData(0, 0, geometry.width, geometry.height).data;
    }
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
      const geometry = templateV2Geometry(recipe), pixels = pixelCanvas(fullBitmap).pixels, reference = await artReference(recipe, geometry);
      const backgroundChecks = [];
      if (theme === 'classic') {
        const x = layout === 'strip' ? 24 : 40;
        for (const y of [500, 900, 1300, 1700]) backgroundChecks.push({ purpose: 'No extra Classic outline', x, y, rgbDifference: differenceRGB(at(pixels, full.width, x, y), at(reference, full.width, x, y)) });
      }
      // A portrait's FIT sidebands must preserve the generated paper/wash rather than become cream rectangles.
      for (const w of geometry.windows) for (const y of [w.y + 50, w.y + w.height - 50]) {
        const x = w.x + 3;
        backgroundChecks.push({ purpose: 'Generated artwork continues through portrait FIT sidebands', x, y, rgbDifference: differenceRGB(at(pixels, full.width, x, y), at(reference, full.width, x, y)) });
      }
      const bottom = Math.max(...geometry.windows.map(w => w.y + w.height));
      const ink = { minY: full.height, maxY: -1, count: 0 };
      for (let y = bottom + 1; y < full.height - 45; y++) for (let x = Math.floor(full.width * .28); x < full.width * .72; x++) {
        const a = at(pixels, full.width, x, y), b = at(reference, full.width, x, y);
        if (b.every((v,i) => v-a[i] > 40)) { ink.minY = Math.min(ink.minY, y); ink.maxY = Math.max(ink.maxY, y); ink.count++; }
      }
      outputs.push({ meanPreviewFullJpegDifference, backgroundChecks, footerInk: ink, layout, theme, recipe, geometry: templateV2Geometry(recipe), full: { ...full, bytes: await bytes(fullBlob), byteLength: fullBlob.size }, preview: { ...preview, bytes: await bytes(previewBlob), byteLength: previewBlob.size } });
    }
    fixtureControls.photoSet = 'marker';
    const markerSources = ids.map((photoId, index) => { const uri = `file:///synthetic/marker-${photoId}.jpg`; originalImageVariants.set(uri, index); return { photoId, uri }; });
    const markerChecks = [];
    for (const layout of ['strip', 'grid']) {
      const recipe = { version: 'wedding-template-v3', gridAspect: 'square', layout, theme: 'coastal', photoIds: ids, cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) };
      const result = await templates.renderTemplate(markerSources, JSON.stringify(recipe), false, crypto.randomUUID()), bitmap = await createImageBitmap(syntheticRenderedBlobs.get(result.uri));
      const pixels = pixelCanvas(bitmap).pixels, geometry = templateV2Geometry(recipe), edgeChecks = [];
      for (let i = 0; i < 4; i++) {
        const source = (await syntheticSource(markerSources[i].uri)).bitmap, sourcePixels = pixelCanvas(source).pixels, w = geometry.windows[i];
        const factor = Math.min(w.width / source.width, w.height / source.height), dx = w.x + (w.width-source.width*factor)/2, dy = w.y + (w.height-source.height*factor)/2;
        for (const [sx, sy] of [[source.width/2,12],[source.width/2,source.height-12],[12,300],[source.width-12,300]]) edgeChecks.push({ photoIndex: i, source: [sx, sy], rgbDifference: differenceRGB(at(pixels, bitmap.width, dx + sx*factor, dy + sy*factor), at(sourcePixels, source.width, sx, sy)) });
      }
      markerChecks.push({ layout, edgeChecks });
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
    return { original, outputs, markerChecks, contact: await bytes(await canvas.convertToBlob({ type: 'image/png' })) };
  });
  for (const item of result.outputs) {
    assert.deepEqual([item.full.width, item.full.height], item.layout === 'strip' ? [1200, 3600] : [2400, 2400]);
    assert.deepEqual([item.preview.width, item.preview.height], item.layout === 'strip' ? [480, 1440] : [1440, 1440]);
    assert.equal(new Set(Object.values(item.full.sourceHashes)).size, 4);
    assert.ok(item.meanPreviewFullJpegDifference < 3, 'Preview/full image parity within JPEG resampling tolerance');
    assert.deepEqual(item.full.sourceHashes, item.preview.sourceHashes);
    for (const check of item.backgroundChecks) assert.ok(check.rgbDifference.every(v => v <= 8), check.purpose + ' in ' + item.layout + '/' + item.theme);
    assert.ok(item.footerInk.count > 100, 'Footer must contain real contrasting text pixels');
    const photoBottom = Math.max(...item.geometry.windows.map(w => w.y + w.height));
    assert.ok(item.footerInk.minY >= photoBottom + 20, 'Footer ink clears photo windows');
    assert.ok(item.footerInk.maxY <= item.full.height - (item.layout === 'strip' ? 24 : 40) - 15, 'Date ink clears bottom border');
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
  report.markerChecks = result.markerChecks;
  for (const check of report.markerChecks) for (const edge of check.edgeChecks) assert.ok(edge.rgbDifference.every(v => v <= 25), 'Portrait FIT keeps all four source edges in ' + check.layout);
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
