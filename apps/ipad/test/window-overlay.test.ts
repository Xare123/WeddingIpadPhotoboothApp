import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('all booth overlays use one in-window host, not native Modal controllers', () => {
 for (const path of ['../App.tsx','../src/TimingSheet.tsx','../src/SmsShare.tsx','../src/TemplateStudio.tsx']) {
  const body=source(path);
  assert.match(body,/import \{ Modal(?:, [^}]+)? \} from ['"][^'"]*window-overlay['"]/);
  assert.doesNotMatch(body,/import\s*\{[^}]*\bModal\b[^}]*\}\s*from ['"]react-native['"]/);
 }
 assert.match(source('../App.tsx'),/<WindowOverlayProvider><Photobooth \/><\/WindowOverlayProvider>/);
});
test('overlay host retains stable identity, shields underlays and has no native geometry APIs', () => {
 const body=source('../src/window-overlay.tsx');
 assert.match(body,/key=\{layer.id\}/); assert.doesNotMatch(body,/key=\{String\(index\)\}/);
 assert.match(body,/accessibilityElementsHidden=\{layers.length > 0\}/);
 assert.match(body,/index === layers.length - 1 \? 'auto' : 'none'/);
 assert.doesNotMatch(body,/lockAsync|unlockAsync|requestGeometry|Dimensions\.set|from ['"]expo/);
});
test('orientation controller is blocked synchronously and reactively while overlays are active', () => {
 const body=source('../App.tsx');
 assert.match(body,/if \(hasActiveOverlay\(\) \|\| AppState/);
 assert.match(body,/overlayActive \? \['editor' as const\]/);
 assert.match(body,/\[foreground, overlayActive,/);
});
