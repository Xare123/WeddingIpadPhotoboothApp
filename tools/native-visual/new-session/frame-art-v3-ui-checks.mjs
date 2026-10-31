/** Actual native JSX browser fixture with synthetic boundaries, not native iOS proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const report = { scope: 'Actual TemplateStudio JSX + real template-editor controller with synthetic storage/native adapters and Canvas v3 artwork. Not UIKit or native CoreImage proof.', screenshots: [], checks: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [], status: 'running' };
const browser = await launchBrowser();
try {
  for (const [orientation, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8791/?state=review4&count=4&templates=available&photos=clean-portrait&network=offline');
    await page.getByTestId('review-gallery').waitFor();
    await page.getByTestId('use-photo').tap();
    await page.getByTestId('template-studio').waitFor({ timeout: 20000 });
    const ready = async () => { await page.getByTestId('template-status').filter({ hasText: 'Ready to keep' }).waitFor({ timeout: 20000 }); for (const theme of ['classic', 'botanical', 'coastal']) await page.getByTestId(`template-theme-preview-${theme}`).waitFor(); };
    await ready();
    for (const layout of ['strip', 'grid']) {
      await page.getByTestId(`template-layout-${layout}`).tap(); await ready();
      await page.getByTestId('template-theme-botanical').tap(); await ready();
      const image = await page.getByTestId('template-preview').evaluate(async node => {
        const uri = node.querySelector('img')?.src || node.src;
        const blob = await (await fetch(uri)).blob(), image = await createImageBitmap(blob);
        return { width: image.width, height: image.height };
      });
      assert.deepEqual([image.width, image.height], layout === 'strip' ? [480, 1440] : [1440, 1440]);
      const recipe = await page.evaluate(() => JSON.parse(window.__NEW_SESSION_FIXTURE__.templateRenders.at(-1).recipeJSON));
      assert.equal(recipe.version, 'wedding-template-v3'); assert.equal(recipe.gridAspect, 'square');
      const save = page.getByTestId('template-save'), box = await save.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height);
      const file = `artifacts/visual/frame-art-v3/editor-${layout}-${orientation}.png`;
      await page.screenshot({ path: file }); report.screenshots.push(file); report.checks.push({ orientation, layout, image, recipe, saveBounds: box });
    }
    await context.close();
  }
  report.boundary = JSON.parse(await readFile('artifacts/visual/new-session-bundle-boundary.json'));
  report.fixtureHashes = {};
  for (const file of ['tools/native-visual/new-session/template-v2-stub.ts', 'tools/native-visual/new-session/frame-art-v3-ui-checks.mjs']) report.fixtureHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedExternalRequests, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack; throw error; }
finally { await browser.close(); await writeFile('artifacts/visual/frame-art-v3/ui-checks.json', JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, screens: report.screenshots.length }));
