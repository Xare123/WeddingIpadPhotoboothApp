/** Clean design-review assets and full-size CURRENT template examples. No product/stub edits. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { launchBrowser } from './browser.mjs';
const require = createRequire(import.meta.url), { createCanvas, loadImage } = require('@napi-rs/canvas');
const here = fileURLToPath(new URL('./', import.meta.url)), root = path.resolve(here, '../../..');
const inputArg = process.argv.find(value => value.startsWith('--inputs='));
if (!inputArg) throw new Error('Supply --inputs=.cache/.../generation-inputs.json with four image_gen local paths and provenance.');
const inputPath = path.resolve(root, inputArg.slice(9));
const output = path.resolve(root, process.argv.find(value => value.startsWith('--out='))?.slice(6) ?? '.cache/clean-design-fixtures');
assert.ok(output.startsWith(path.join(root, '.cache') + path.sep), 'Clean design outputs must stay under ignored .cache');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
assert.equal(input.photos?.length, 4);
await mkdir(path.join(output, 'sources'), { recursive: true });
await mkdir(path.join(output, 'exports'), { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rendererPath = path.join(here, 'template-stub.ts'), rendererSHA256 = hash(await readFile(rendererPath));
const report = {
  scope: 'LOCAL clean design-review fixture preparation only. Four new image_gen fictional photos; no real guest/vendor images. Current unchanged browser Canvas template renderer, not actual App screenshots, not native CoreImage/CoreText proof. No output ratio/crop rule/product/stub changes.',
  generatedAt: new Date().toISOString(), generator: 'image_gen', renderer: path.relative(root, rendererPath), rendererSHA256,
  status: 'running', sources: [], exports: [], errors: [], unexpectedExternalRequests: [],
};
for (let i = 0; i < 4; i++) {
  const photo = input.photos[i], png = await readFile(photo.generatedPath), image = await loadImage(photo.generatedPath);
  const orientation = image.width >= image.height ? 'landscape' : 'portrait';
  const sourcePNG = `sources/generated-${i + 1}.png`, sourceJPEG = `sources/clean-${i + 1}-${orientation}.jpg`;
  await copyFile(photo.generatedPath, path.join(output, sourcePNG));
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0); const jpeg = canvas.toBuffer('image/jpeg', 95);
  await writeFile(path.join(output, sourceJPEG), jpeg);
  const scale = Math.min(1080 / image.width, 810 / image.height);
  report.sources.push({ label: `clean${i + 1}`, description: photo.description, generator: 'image_gen', prompt: photo.prompt,
    generatedPath: photo.generatedPath, originalPNG: sourcePNG, originalSHA256: hash(png), file: sourceJPEG, sha256: hash(jpeg),
    width: image.width, height: image.height, orientation, ratio: image.width / image.height,
    transformations: 'Full-frame Canvas JPEG0.95 re-encode only; no crop, border, marker, text, retouch or pose duplication.',
    currentFitWindow: { width: 1080, height: 810, photoAreaFraction: image.width * scale * image.height * scale / (1080 * 810) },
  });
}
assert.equal(new Set(report.sources.map(source => source.sha256)).size, 4);
const entry = `import { syntheticTemplates } from './template-stub';
import { durableRenderedImages, syntheticRenderedBlobs } from './effects-stub';
const files = ${JSON.stringify(report.sources.map(source => source.file))};
const ids = ['clean1','clean2','clean3','clean4'];
const sources = ids.map((photoId,i) => {const uri='file:///synthetic/'+photoId+'.jpg';durableRenderedImages.set(uri,'/'+files[i]);return {photoId,uri};});
window.__CLEAN_DESIGN__ = {async render(layout,theme){
 const recipe={version:'wedding-template-v1',layout,theme,photoIds:ids,cropsByPhotoId:Object.fromEntries(ids.map(id=>[id,{mode:'fit',x:0,y:0,zoom:1}]))};
 const r=await syntheticTemplates.renderTemplate(sources,JSON.stringify(recipe),false,crypto.randomUUID());
 const blob=syntheticRenderedBlobs.get(r.uri);return {...r,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
}};`;
const bundle = await build({ stdin: { contents: entry, resolveDir: here, sourcefile: 'clean-design-entry.ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.ts': 'ts' }, metafile: true });
report.bundleInputs = Object.keys(bundle.metafile.inputs);
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Clean synthetic fixture preparation · Native unverified</title></head><body><p>Clean fictional generated photos · CURRENT Canvas renderer · native CoreImage/CoreText unverified</p><script src="/bundle.js"></script></body></html>';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/bundle.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(bundle.outputFiles[0].contents); }
  else if (/^\/sources\/clean-[1-4]-(portrait|landscape)\.jpg$/.test(url.pathname)) { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(await readFile(path.join(output, url.pathname.slice(1)))); }
  else { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await launchBrowser();
try {
  const context = await browser.newContext();
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.unexpectedExternalRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(origin); await page.waitForFunction(() => !!window.__CLEAN_DESIGN__);
  for (const layout of ['strip', 'grid']) for (const theme of ['classic', 'botanical', 'coastal']) {
    const result = await page.evaluate(({ layout, theme }) => window.__CLEAN_DESIGN__.render(layout, theme), { layout, theme });
    const bytes = Buffer.from(result.bytes), file = `exports/current-${layout}-${theme}-fit.jpg`;
    assert.deepEqual([result.width, result.height], layout === 'strip' ? [1200, 3600] : [2400, 2100]);
    assert.equal(bytes[0], 255); assert.equal(bytes[1], 216);
    const expected = Object.fromEntries(report.sources.map(source => [source.label, source.sha256])); assert.deepEqual(result.sourceHashes, expected);
    await writeFile(path.join(output, file), bytes);
    report.exports.push({ file, layout, theme, version: result.version, width: result.width, height: result.height, mode: 'fit', sha256: hash(bytes), sourceHashes: result.sourceHashes, recipeJSON: result.recipeJSON });
  }
  await context.close(); assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []);
  assert.equal(hash(await readFile(rendererPath)), rendererSHA256, 'Current renderer changed during design fixture generation');
  report.status = 'prepared';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await writeFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n'); }
// Contact sheets label outputs externally. No label or diagnostic overlay is added to a keepsake JPEG.
const board = createCanvas(1800, 1700), ctx = board.getContext('2d'); ctx.fillStyle = '#DDDAD4'; ctx.fillRect(0, 0, 1800, 1700);
ctx.fillStyle = '#25362B'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('CURRENT Canvas fixture · clean generated photos · native processing unverified', 30, 38);
for (let i = 0; i < report.exports.length; i++) { const item = report.exports[i], image = await loadImage(path.join(output, item.file)); const x = 30 + (i % 3) * 590, y = 72 + Math.floor(i / 3) * 805; const scale = Math.min(550 / image.width, 735 / image.height); ctx.drawImage(image, x + (550 - image.width * scale) / 2, y, image.width * scale, image.height * scale); ctx.fillStyle = '#25362B'; ctx.font = '20px sans-serif'; ctx.fillText(`${item.layout} / ${item.theme} / default full-photo fit`, x, y + 768); }
await writeFile(path.join(output, 'current-template-comparison.png'), board.toBuffer('image/png'));
const sourcesBoard = createCanvas(1600, 650), sc = sourcesBoard.getContext('2d'); sc.fillStyle = '#F0EDE7'; sc.fillRect(0, 0, 1600, 650); sc.fillStyle = '#25362B'; sc.font = 'bold 24px sans-serif'; sc.fillText('Four distinct image_gen fictional photos · full-frame JPEGs · no guest/vendor images', 24, 36);
for (let i = 0; i < 4; i++) { const item = report.sources[i], image = await loadImage(path.join(output, item.file)), scale = Math.min(370 / image.width, 530 / image.height), x = 20 + i * 395; sc.drawImage(image, x + (370 - image.width * scale) / 2, 70, image.width * scale, image.height * scale); sc.fillStyle = '#25362B'; sc.font = '18px sans-serif'; sc.fillText(`${item.label} · ${item.width}×${item.height} · ${item.orientation}`, x, 625); }
await writeFile(path.join(output, 'source-contact-sheet.png'), sourcesBoard.toBuffer('image/png'));
console.log(JSON.stringify({ status: report.status, output, manifest: path.join(output, 'manifest.json'), sourcePhotos: report.sources.length, fullSizeCurrentExamples: report.exports.length, rendererSHA256 }));
