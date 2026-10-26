/** Browser geometry/accessibility fixtures only; no native glass or iOS claim. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser, createContext } from './browser.mjs';
const report = { scope: 'Browser fixtures: synthetic safe-area and accessibility values; no native Liquid Glass verification.', mockedHealthRequests: [], unexpectedExternalRequests: [], errors: [], checks: [] };
report.sourceSHA256 = createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex');
const browser = await launchBrowser();
try {
  for (const [orientation, viewport, insets] of [
    ['portrait', { width: 820, height: 1180 }, { top: 24, right: 0, bottom: 34, left: 0 }],
    ['landscape', { width: 1180, height: 820 }, { top: 0, right: 44, bottom: 21, left: 44 }],
  ]) {
    for (const preference of ['default', 'reducedTransparency', 'highContrast', 'syntheticGlassAvailable']) {
      const context = await createContext(browser, report, { viewport, reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        const values = [insets.top, insets.right, insets.bottom, insets.left].join(',');
        await page.goto(`http://127.0.0.1:8791/?state=camera&insets=${values}&${preference}=true${preference === 'syntheticGlassAvailable' ? '&glass=available' : ''}`);
        await page.getByTestId('camera-controls').waitFor();
        const geometry = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return { viewport: rect('#root'), banner: rect('#new-session-fixture-banner'), stage: rect('[data-testid="camera-stage"]'), surface: rect('[data-testid="camera-surface"]'), controls: rect('[data-testid="camera-controls"]'), radius: getComputedStyle(document.querySelector('[data-testid="camera-surface"]')).borderRadius };
        });
        for (const name of ['stage', 'surface']) {
          for (const edge of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(geometry[name][edge] - geometry.viewport[edge]) <= 1, `${orientation} ${preference}: ${name}.${edge} must cover app viewport`);
        }
        assert.equal(geometry.radius, '0px', 'Camera surface must have no rounded viewport corners');
        assert.ok(geometry.viewport.top >= geometry.banner.bottom - 1, 'Fixture banner is outside app viewport');
        for (const [edge, limit, relation] of [
          ['left', geometry.viewport.left + insets.left, 'min'], ['top', geometry.viewport.top + insets.top, 'min'],
          ['right', geometry.viewport.right - insets.right, 'max'], ['bottom', geometry.viewport.bottom - insets.bottom, 'max'],
        ]) assert.ok(relation === 'min' ? geometry.controls[edge] >= limit - 1 : geometry.controls[edge] <= limit + 1, `${orientation}: camera controls violate ${edge} safe inset`);
        for (const id of ['camera-action-glass']) {
          assert.equal(await page.getByTestId(id).getAttribute('aria-label'), 'Opaque controls surface');
        }
        // Switching OS-shaped synthetic preferences must re-render the actual hook.
        for (const event of ['reduceTransparencyChanged', 'highTextContrastChanged', 'reduceMotionChanged']) {
          await page.evaluate(event => window.__NEW_SESSION_FIXTURE__.setAccessibilityPreference(event, true), event);
          const phrase = { reduceTransparencyChanged: 'Reduced transparency', highTextContrastChanged: 'increased contrast', reduceMotionChanged: 'reduced motion' }[event];
          await page.waitForFunction(({ phrase }) => { const element = document.querySelector('[data-testid="camera-action-glass"]'); return element?.getAttribute('data-fixture-accessibility-hint')?.includes(phrase + ' on'); }, { phrase });
          for (const id of ['camera-action-glass']) assert.equal(await page.getByTestId(id).getAttribute('aria-label'), 'Opaque controls surface');
          assert.equal(await page.locator('[aria-label="Synthetic browser glass stand-in; not native Liquid Glass"]').count(), 0, 'Browser must use opaque fallback');
          await page.evaluate(event => window.__NEW_SESSION_FIXTURE__.setAccessibilityPreference(event, false), event);
          await page.waitForFunction(({ phrase }) => document.querySelector('[data-testid="camera-action-glass"]')?.getAttribute('data-fixture-accessibility-hint')?.includes(phrase + ' off'), { phrase });
        }
        report.checks.push({ orientation, preference, insets, geometry, dynamicPreferenceEvents: ['reduceTransparencyChanged', 'highTextContrastChanged', 'reduceMotionChanged'], nativeGlassRendered: false });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unexpectedExternalRequests, []);
  assert.equal(createHash('sha256').update(await readFile('apps/ipad/App.tsx')).digest('hex'), report.sourceSHA256, 'App changed during geometry checks');
  report.status = 'passed';
  await writeFile('artifacts/visual/new-session-fullbleed-checks.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
