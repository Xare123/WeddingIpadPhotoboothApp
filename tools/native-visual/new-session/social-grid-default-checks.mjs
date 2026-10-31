/** First-open actual JSX evidence. Synthetic browser boundary, never iPad mirror/capture proof. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const expectedMode = process.argv[2];
assert.ok(['fit', 'fill'].includes(expectedMode), 'Explicit owner-selected fit/fill decision required before evidence capture');
const directory = 'artifacts/visual/social-grid-default';
await mkdir(directory, { recursive: true });
const report = { scope: 'First-open actual TemplateStudio JSX/controller using synthetic four-photo state and Canvas renderer. No layout/theme/placement clicks before capture. Not native iPad window, front-camera mirroring, Photos, upload or SMS proof.', expectedMode, checks: [], screenshots: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [], status: 'running' };
const browser = await launchBrowser();
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8791/?state=review4&count=4&templates=available&photos=clean-portrait&network=offline');
    await page.getByTestId('review-gallery').waitFor();
    const before = await page.evaluate(() => structuredClone(window.__NEW_SESSION_FIXTURE__.snapshot()));
    assert.equal(before.active.shots.length, 4); assert.equal(before.active.composite, undefined);
    // This is the only app action: enter the fresh editor, never select a layout or placement.
    await page.getByTestId('use-photo').tap();
    await page.getByTestId('template-studio').waitFor({ timeout: 20000 });
    await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor({ timeout: 20000 });
    for (const theme of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${theme}`).waitFor();
    const layoutOrder = await page.locator('[data-testid^="template-layout-"]').evaluateAll(elements => elements.map(element => ({ id: element.getAttribute('data-testid'), text: element.textContent, browserAriaSelected: element.getAttribute('aria-selected'), background: getComputedStyle(element).backgroundColor })));
    assert.deepEqual(layoutOrder.map(x => x.id), ['template-layout-grid', 'template-layout-strip']);
    assert.equal(layoutOrder[0].text, 'Social grid'); assert.equal(layoutOrder[0].background, 'rgb(49, 77, 59)'); assert.equal(layoutOrder[1].background, 'rgba(0, 0, 0, 0)');
    assert.equal(await page.getByTestId(`template-placement-${expectedMode}`).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(49, 77, 59)');
    assert.equal(await page.getByTestId(`template-placement-${expectedMode === 'fill' ? 'fit' : 'fill'}`).evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    const renders = await page.evaluate(() => structuredClone(window.__NEW_SESSION_FIXTURE__.templateRenders));
    assert.ok(renders.length > 0);
    const recipe = JSON.parse(renders.at(-1).recipeJSON);
    assert.equal(recipe.layout, 'grid'); assert.equal(recipe.version, 'wedding-template-v3'); assert.equal(recipe.gridAspect, 'square');
    for (const event of renders) {
      const value = JSON.parse(event.recipeJSON);
      assert.equal(value.layout, 'grid', 'Fresh editor must render Social grid without first rendering Strip');
      for (const crop of Object.values(value.cropsByPhotoId)) assert.deepEqual(crop, { mode: expectedMode, x: 0, y: expectedMode === 'fill' ? -1 : 0, zoom: 1 });
    }
    await page.waitForFunction(() => { const node = document.querySelector('[data-testid="template-preview"]'); const image = node?.querySelector('img') ?? node; return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; });
    const image = await page.getByTestId('template-preview').evaluate(async node => {
      const uri = node.querySelector('img')?.src || node.src;
      const blob = await (await fetch(uri)).blob(), bitmap = await createImageBitmap(blob), bytes = await blob.arrayBuffer();
      return { width: bitmap.width, height: bitmap.height, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('') };
    });
    assert.deepEqual([image.width, image.height], [1440, 1440]);
    assert.equal(await page.getByTestId('template-save').isEnabled(), true);
    const saveBounds = await page.getByTestId('template-save').boundingBox();
    assert.ok(saveBounds && saveBounds.width >= 44 && saveBounds.height >= 44 && saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= viewport.height);
    const after = await page.evaluate(() => structuredClone(window.__NEW_SESSION_FIXTURE__.snapshot()));
    assert.deepEqual(after.active.shots, before.active.shots, 'Opening editor must preserve selected originals');
    assert.deepEqual(after.jobs, before.jobs, 'Opening editor must not publish or alter queue');
    const file = `${directory}/first-open-${orientation}.png`;
    await page.screenshot({ path: file }); report.screenshots.push(file);
    report.checks.push({ orientation, viewport, actor: ['Enter fresh editor from four-photo review'], layoutOrPlacementClicks: 0, layoutOrder, recipe, image, saveBounds, originalPhotoIds: before.active.shots.map(value => value.id), originalsUnchanged: true, queueUnchanged: true });
    await context.close();
  }
  report.browserAccessibilityLimit = 'React Native Web role=button omits accessibilityState.selected from ARIA; visual selection paint and actual controller recipe are checked. Native VoiceOver state not established by this run.';
  report.boundary = JSON.parse(await readFile('artifacts/visual/new-session-bundle-boundary.json'));
  report.sourceHashes = {};
  for (const file of ['apps/ipad/App.tsx', 'apps/ipad/src/TemplateStudio.tsx', 'apps/ipad/src/template-editor.ts', 'tools/native-visual/new-session/social-grid-default-checks.mjs', 'tools/native-visual/new-session/template-v2-stub.ts']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally { await browser.close(); await writeFile(`${directory}/checks.json`, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, firstOpenScreens: report.screenshots.length, expectedMode }));
