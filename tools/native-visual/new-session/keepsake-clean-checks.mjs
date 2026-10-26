/** Actual v2 JSX/full-JPEG design fixtures. Distinct clean generated photos; not marker/native proof. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const artifactRoot = process.argv.includes('--provisional') ? '.cache/keepsake-provisional' : 'artifacts/visual';
await mkdir(artifactRoot, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'LOCAL clean generated photo design fixtures through actual v2 App/Studio/controllers. Actual Canvas JPEGs/full-resolution inspection; synthetic native SDK/storage/Photos/publication ports. Not native CoreImage/CoreText, optical capture, print fidelity, real files/SQLite, Photos, cloud publication or phone scanning proof. Marker correctness remains separate and mandatory.', status: 'running', sourceSHA256: sha(await readFile('apps/ipad/App.tsx')), screenshots: [], exports: [], checks: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
const browser = await launchBrowser();
const snapshot = page => page.evaluate(() => window.__NEW_SESSION_FIXTURE__.snapshot());
async function recipe(page) {
  const uri = await page.getByTestId('template-preview').getAttribute('data-fixture-native-uri');
  return page.evaluate(uri => { const render = window.__NEW_SESSION_FIXTURE__.templateRenders.find(r => r.uri === uri && r.status === 'complete'); if (!render) throw new Error('Current main image has no completed renderer receipt'); return JSON.parse(render.recipeJSON); }, uri);
}
async function ready(page) { await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor(); for (const theme of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${theme}`).waitFor(); }
async function pixels(page, id, includeBytes = false) {
  return page.getByTestId(id).evaluate(async (element, includeBytes) => {
    const img = element.querySelector('img') ?? element; await img.decode?.(); const uri = img.src;
    const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer()), bitmap = await createImageBitmap(new Blob([bytes]));
    const nativeURI = element.getAttribute('data-fixture-native-uri'), render = window.__NEW_SESSION_FIXTURE__.templateRenders.find(r => r.uri === nativeURI && r.status === 'complete');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (render && (render.browserURI !== uri || render.jpegSHA256 !== sha256)) throw new Error('Displayed template image bytes do not match its exact current renderer receipt');
    return { uri, nativeURI, width: bitmap.width, height: bitmap.height, byteLength: bytes.length, jpeg: bytes[0] === 255 && bytes[1] === 216, sha256, recipe: render ? JSON.parse(render.recipeJSON) : undefined, cssFilter: getComputedStyle(element).filter, ...(includeBytes ? { bytes: Array.from(bytes) } : {}) };
  }, includeBytes);
}
async function save(page, name) { const file = `${artifactRoot}/keepsake-${name}.png`; await page.screenshot({ path: file }); report.screenshots.push(file); }
async function saveVisible(page, viewport, label) { const box = await page.getByTestId('template-save').boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, `${label}: sticky Save must remain visible`); return box; }
try {
  for (const [set, aspect] of [['clean-portrait', 'portrait'], ['clean-mixed', 'square']]) {
    for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
      const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' }); const page = await context.newPage();
      try {
        await page.goto(`http://127.0.0.1:8791/?state=review4&templates=available&effects=available&photos=${set}&network=offline`);
        await page.getByTestId('use-photo').tap(); await ready(page);
        assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.photoSet), set);
        const original = structuredClone((await snapshot(page)).active.shots), initialRecipe = await recipe(page);
        assert.equal(initialRecipe.version, 'wedding-template-v2'); assert.equal(initialRecipe.gridAspect, aspect);
        assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.templateInspections.length), 1);
        const saveBounds = await saveVisible(page, viewport, `${set}/${orientation}`), outputs = [];
        for (const layout of ['strip', 'grid']) {
          await page.getByTestId(`template-layout-${layout}`).tap(); await ready(page);
          for (const theme of ['classic', 'botanical', 'coastal']) {
            await page.getByTestId(`template-theme-${theme}`).tap(); await ready(page);
            const preview = await pixels(page, 'template-preview'); assert.equal(preview.jpeg, true); assert.equal(preview.cssFilter, 'none');
            assert.equal(preview.recipe.layout, layout); assert.equal(preview.recipe.theme, theme); assert.equal(preview.recipe.gridAspect, aspect);
            const dimensions = layout === 'strip' ? [1200, 3600] : aspect === 'portrait' ? [2400, 3000] : [2400, 2400];
            const scale = Math.min(1, 1440 / Math.max(...dimensions)); assert.deepEqual([preview.width, preview.height], dimensions.map(v => Math.round(v * scale)));
            await saveVisible(page, viewport, `${set}/${orientation}/${layout}/${theme}`); await save(page, `${set}-${layout}-${theme}-${orientation}`);
            await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-inspect-image').waitFor();
            const full = await pixels(page, 'template-inspect-image', true); assert.deepEqual([full.width, full.height], dimensions); assert.equal(full.jpeg, true); assert.ok(Math.max(full.width, full.height) > 1440, 'Inspector must display full JPEG, not upscale preview');
            assert.deepEqual(full.recipe, preview.recipe, 'Full inspector and displayed main preview must use the exact same selected recipe');
            const existing = report.exports.find(e => e.set === set && e.layout === layout && e.theme === theme);
            const { bytes, ...info } = full;
            if (!existing) { const file = `${artifactRoot}/keepsake-${set}-${layout}-${theme}.jpg`; await writeFile(file, Buffer.from(bytes)); report.exports.push({ set, layout, theme, gridAspect: aspect, file, ...info }); }
            else assert.equal(full.sha256, existing.sha256, 'UI orientation must not alter full-size exported JPEG bytes');
            if (layout === 'grid' && theme === 'botanical') {
              await save(page, `${set}-inspection-whole-${orientation}`); await page.getByTestId('template-inspect-width').tap();
              const scroll = await page.getByTestId('template-inspect-scroll').evaluate(element => { const before = { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }; element.scrollTop = element.scrollHeight; return { ...before, scrollTop: element.scrollTop }; });
              if (scroll.scrollHeight > scroll.clientHeight + 1) assert.ok(scroll.scrollTop > 0, 'Full-width actual JPEG scrolls to show lower photos');
              assert.equal((await pixels(page, 'template-inspect-image')).sha256, full.sha256); await save(page, `${set}-inspection-width-${orientation}`);
            }
            await page.getByTestId('template-inspect-done').tap(); await page.getByTestId('template-inspector').waitFor({ state: 'detached' });
            outputs.push({ layout, theme, preview, full: info });
          }
        }
        assert.equal(await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.templateInspections.length), 1, 'Chosen aspect persists through all layouts/themes and full inspections');
        const fullPhoto = await pixels(page, 'template-preview');
        await page.getByTestId('template-placement-fill').tap(); await ready(page);
        assert.match(await page.getByTestId('template-placement-note').innerText(), /Fill starts at the top and crops edges\. Check every face/);
        assert.ok(Object.values((await recipe(page)).cropsByPhotoId).every(c => c.mode === 'fill' && c.x === 0 && c.y === -1 && c.zoom === 1));
        const fillPhoto = await pixels(page, 'template-preview'); assert.notEqual(fillPhoto.sha256, fullPhoto.sha256); assert.deepEqual((await snapshot(page)).active.shots, original);
        await saveVisible(page, viewport, `${set}/${orientation}/global-fill`); await save(page, `${set}-explicit-fill-${orientation}`);
        await page.getByTestId('template-placement-fit').tap(); await ready(page);
        assert.match(await page.getByTestId('template-placement-note').innerText(), /Every edge stays in view/); assert.equal((await pixels(page, 'template-preview')).sha256, fullPhoto.sha256);
        // Close while a fresh full-resolution request is pending, then background
        // another pending inspection. Late work must never reopen the modal.
        await page.getByTestId('template-layout-strip').tap(); await ready(page); await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 200; });
        await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-inspector').waitFor(); await page.getByTestId('template-inspect-done').tap();
        await page.waitForTimeout(300); assert.equal(await page.getByTestId('template-inspector').count(), 0);
        await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 0; }); await page.getByTestId('template-layout-grid').tap(); await ready(page);
        await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 200; }); await page.getByTestId('template-inspect').tap(); await page.getByTestId('template-inspector').waitFor();
        await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('background')); await page.getByTestId('template-inspector').waitFor({ state: 'detached' });
        await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.setAppState('active')); await page.getByTestId('review-gallery').waitFor(); await page.waitForTimeout(300);
        assert.equal(await page.getByTestId('template-inspector').count(), 0); assert.deepEqual((await snapshot(page)).active.shots, original); assert.equal((await snapshot(page)).jobs.length, 0); assert.equal(await page.getByText('Booth controls', { exact: true }).count(), 0);
        await page.evaluate(() => { window.__NEW_SESSION_FIXTURE__.templateDelayMs = 0; }); await page.getByTestId('use-photo').tap(); await ready(page); await page.getByTestId('template-layout-grid').tap(); await ready(page); await page.getByTestId('template-theme-coastal').tap(); await ready(page);
        await page.getByTestId('template-save').tap(); await page.getByTestId('saved-keepsake-preview').waitFor(); const saved = await pixels(page, 'saved-keepsake-preview');
        const state = await snapshot(page); assert.equal(state.active.composite.recipe.gridAspect, aspect); assert.equal(state.active.composite.recipe.version, 'wedding-template-v2'); assert.equal(state.jobs.length, 5);
        assert.equal(saved.sha256, report.exports.find(e => e.set === set && e.layout === 'grid' && e.theme === 'coastal').sha256, 'Saved canonical JPEG equals full-resolution inspector output');
        assert.deepEqual(state.active.shots.map(p => ({ id: p.id, fileUri: p.fileUri })), original.map(p => ({ id: p.id, fileUri: p.fileUri })));
        await save(page, `${set}-saved-${orientation}`);
        report.checks.push({ set, gridAspect: aspect, orientation, saveBounds, initialRecipe, outputs, saved, inspectedSources: await page.evaluate(() => window.__NEW_SESSION_FIXTURE__.templateInspections), checks: ['four distinct clean source JPEGs', 'ordinary median chooses aspect once', 'all six actual preview/full JPEG combinations', 'whole/full-width inspection and scrolling', 'sticky Save visible', 'explicit Fill warns and changes pixels without changing originals', 'Full photo restores prior JPEG', 'late close/background never reopens inspection', 'saved canonical JPEG equals inspected output', 'version/gridAspect preserved into confirmed composite', 'five deduplicated publication jobs'] });
      } finally { await context.close(); }
    }
  }
  const provenance = JSON.parse(await readFile(`${artifactRoot}/keepsake-bundle-boundary.json`)); report.sourceHashes = provenance.sourceHashes; report.fixturePhotoSets = provenance.fixturePhotoSets;
  for (const [file, digest] of Object.entries(report.sourceHashes)) assert.equal(sha(await readFile(file)), digest, `${file} changed during clean capture`);
  assert.equal(sha(await readFile('apps/ipad/App.tsx')), report.sourceSHA256); assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { await browser.close(); await writeFile(`${artifactRoot}/keepsake-clean-checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, configurations: report.checks.length, fullSizeJPEGs: report.exports.length, screenshots: report.screenshots.length, sourceSHA256: report.sourceSHA256 }));
