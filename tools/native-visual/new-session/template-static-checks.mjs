/** Full-frame static browser fixtures; actual app crop actors, explicit stable scroll row. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { launchBrowser, createContext } from "./browser.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex"), report = { scope: "Additional full-frame static browser fixtures. Aligns the complete Adjust photos row after the identical swap/fill/pan/zoom actions; no image crop, no App change, no retake actor changes. Starts from four-photo review fixture; full capture movies are in templates-checks.json.", sourceSHA256: sha(await readFile("apps/ipad/App.tsx")), checks: [], errors: [], mockedHealthRequests: [], unexpectedExternalRequests: [] };
const browser = await launchBrowser();
try {
  for (const [orientation, viewport] of [["portrait", { width: 820, height: 1180 }], ["landscape", { width: 1180, height: 820 }]]) {
    const context = await createContext(browser, report, { viewport, reducedMotion: "reduce" }), page = await context.newPage();
    try {
      const ready = () => page.getByTestId("template-status").filter({ hasText: "Ready to keep" }).waitFor();
      await page.goto("http://127.0.0.1:8791/?state=review4&templates=available&effects=available&network=offline");
      await page.getByTestId("photo-thumbnail-3").tap();
      await page.getByTestId("choose-look").tap();
      await page.getByTestId("look-preset-warm").tap();
      await page.getByTestId("look-status").filter({ hasText: "Preview ready" }).waitFor();
      await page.getByTestId("look-apply").tap();
      await page.getByTestId("look-editor").waitFor({ state: "detached" });
      await page.getByTestId("use-photo").tap();
      await ready();
      await page.getByTestId("template-layout-grid").tap();
      await ready();
      await page.getByTestId("template-theme-coastal").tap();
      await ready();
      await page.getByTestId("template-adjust").tap();
      await page.getByTestId("template-photo-1").tap();
      await page.getByTestId("template-photo-2").tap();
      await ready();
      await page.getByTestId("template-photo-1").tap();
      await page.getByTestId("template-crop-fill").tap();
      await ready();
      await page.getByTestId("template-zoom-in").tap();
      await page.getByTestId("template-pan-down").tap();
      await page.getByTestId("template-pan-right").tap();
      await ready();
      const settlement = await page.getByTestId("template-adjust").evaluate((target) => new Promise((resolve) => {
        let rail = target.parentElement;
        while (rail && !(rail.scrollHeight > rail.clientHeight && ["auto", "scroll"].includes(getComputedStyle(rail).overflowY))) rail = rail.parentElement;
        if (!rail) return resolve({ scrollable: false });
        const requested = rail.scrollTop + target.getBoundingClientRect().top - rail.getBoundingClientRect().top;
        rail.scrollTop = requested;
        let previous = -1, stable = 0;
        function sample() {
          const now = rail.scrollTop;
          stable = Math.abs(now - previous) < 0.1 ? stable + 1 : 0;
          previous = now;
          if (stable >= 4) resolve({ requested, actual: now, maximum: rail.scrollHeight - rail.clientHeight, stableFrames: stable, target: target.getBoundingClientRect().toJSON(), viewport: rail.getBoundingClientRect().toJSON() });
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }));
      assert.ok(settlement.target.top >= settlement.viewport.top - 0.5);
      const file = `artifacts/visual/templates-crop-pan-clean-${orientation}.png`;
      await page.screenshot({ path: file });
      report.checks.push({ orientation, file, settlement });
    } finally {
      await context.close();
    }
  }
  assert.equal(sha(await readFile("apps/ipad/App.tsx")), report.sourceSHA256);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unexpectedExternalRequests, []);
  report.status = "passed";
} finally {
  await browser.close();
  await writeFile("artifacts/visual/templates-static-checks.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ status: report.status, frames: report.checks.length, sourceSHA256: report.sourceSHA256 }));
