/** Synthetic runtime verification only; requires the existing local visual server. No device/service access. */
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { launchBrowser } from './new-session/browser.mjs';
const fixture = `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {Modal,WindowOverlayProvider} from './apps/ipad/src/window-overlay';
function Test(){const[a,A]=useState(false),[b,B]=useState(false);return <><button id="open" onClick={()=>A(true)}>Open</button><Modal visible={a} transparent><div id="lower"><button id="nested" onClick={()=>B(true)}>Nested</button></div></Modal><Modal visible={b} transparent><div id="upper"><input id="note" defaultValue="synthetic"/><button id="remove-lower" onClick={()=>A(false)}>Remove lower</button><button id="close-upper" onClick={()=>B(false)}>Close</button></div></Modal></>}
createRoot(document.getElementById('root')).render(<WindowOverlayProvider><Test/></WindowOverlayProvider>);`;
const code = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' }, alias: { 'react-native': 'react-native-web' } });
const report = { scope: 'Synthetic Chromium/runtime checks, not UIKit/iPad window or physical orientation proof', checks: [] };
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body style="margin:0"><div id="root" style="height:100vh"></div></body></html>');
  await page.addScriptTag({ content: code.outputFiles[0].text });
  await page.locator('#open').click(); await page.locator('#nested').click();
  await page.locator('#note').fill('synthetic preserved'); await page.locator('#remove-lower').click();
  assert.equal(await page.locator('#note').inputValue(), 'synthetic preserved');
  assert.equal(await page.locator('#lower').count(), 0);
  await page.locator('#close-upper').click(); await page.locator('#open').click(); await page.locator('#lower').waitFor();
  report.checks.push('nested input survives lower-layer removal; top close and parent reopen');
  await page.close();
  for (const [width, height] of [[820, 1180], [1180, 820]]) {
    const p = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = []; p.on('pageerror', error => errors.push(error.message));
    await p.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8791' ? route.continue() : route.abort());
    await p.goto('http://127.0.0.1:8791/?state=camera&count=4&network=offline');
    const bounds = await p.locator('#root').boundingBox();
    await p.getByTestId('timing-chip').click(); await p.getByTestId('timing-first-plus').click(); await p.getByTestId('timing-apply').click();
    const saved = await p.getByTestId('timing-chip').getAttribute('aria-label');
    await p.getByTestId('timing-chip').click(); await p.getByTestId('timing-first-plus').click(); await p.getByTestId('timing-cancel').click();
    assert.equal(await p.getByTestId('timing-chip').getAttribute('aria-label'), saved);
    await p.getByTestId('timing-chip').click(); await p.getByTestId('timing-sheet').waitFor(); await p.getByTestId('timing-cancel').click();
    await p.getByRole('button', { name: 'Open host controls', exact: true }).click();
    await p.getByTestId('host-orientation-auto').waitFor();
    await p.getByRole('button', { name: 'Done', exact: true }).click();
    assert.deepEqual(await p.locator('#root').boundingBox(), bounds);
    assert.deepEqual(errors, []);
    report.checks.push(`timer edit/apply/cancel/reopen + Host open/close; root bounds preserved ${width}x${height}`);
    await p.goto('http://127.0.0.1:8791/?state=review4&count=4&templates=available&effects=available&network=offline');
    await p.getByTestId('retake-all').click(); await p.getByTestId('cancel-retake-all').click();
    await p.getByTestId('choose-look').click(); await p.getByTestId('look-editor').waitFor(); await p.getByTestId('look-cancel').click();
    await p.getByTestId('use-photo').click(); await p.getByTestId('template-studio').waitFor();
    await p.getByTestId('template-inspect').click(); await p.getByTestId('template-inspector').waitFor(); await p.getByTestId('template-inspect-done').click();
    await p.getByTestId('template-back').click(); await p.getByTestId('review-gallery').waitFor();
    assert.deepEqual(errors, []);
    report.checks.push(`retake Cancel, Look open/close, keepsake inspection/return ${width}x${height}`);
    await p.close();
  }
  await mkdir('.cache/window-overlay', { recursive: true });
  await writeFile('.cache/window-overlay/checks.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
