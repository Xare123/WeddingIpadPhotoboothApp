import test from 'node:test';
import assert from 'node:assert/strict';
import { photoEditApplyTitle, photoEditPreviewLabel, photoEditStatus } from '../src/photo-edit-presentation';
import type { PhotoLookEditorState } from '../src/photo-look-editor';

const state = (extra: Partial<PhotoLookEditorState> = {}): PhotoLookEditorState => ({
  phase: 'ready', previewUri: 'file:///private/preview.jpg', preset: 'original', intensity: 0,
  sessionId: 'session', photoId: 'photo', sourcePhotoId: 'photo', slot: 0,
  faceSupported: true, faceAccessory: 'none', ...extra,
});
test('an original colour look with an accessory is never called an untouched original', () => {
  const value = state({ faceAccessory: 'crown', decoratedFaceCount: 2 });
  assert.equal(photoEditApplyTitle(value, false), 'Use this photo');
  assert.equal(photoEditPreviewLabel(value), 'Original photo with Tiara');
  assert.equal(photoEditStatus(value, true, false), 'Photo ready · 2 faces decorated');
});
test('None preserves a colour look and uses the actual effective recipe', () => {
  assert.equal(photoEditApplyTitle(state({ preset: 'warm', intensity: 0.75 }), false), 'Use this photo');
  assert.equal(photoEditApplyTitle(state(), false), 'Use original');
});
test('no-face and protected-face fallbacks are truthful rather than decoration success', () => {
  const missing = state({ fallbackReason: 'no-face', decoratedFaceCount: 0 });
  assert.match(photoEditStatus(missing, true, false), /without an accessory/);
  assert.equal(photoEditApplyTitle(missing, false), 'Use original');
  assert.match(photoEditStatus(state({ fallbackReason: 'no-usable-face' }), true, false), /placed safely/);
  assert.equal(photoEditStatus(state({ fallbackReason: 'partial', detectedFaceCount: 2, decoratedFaceCount: 1 }), true, false),
    '1 of 2 faces decorated. Applied where safe.');
});
test('reopened committed variants do not invent a zero-face result', () => {
  assert.equal(photoEditStatus(state({ faceAccessory: 'glasses', decoratedFaceCount: null, fallbackReason: null }), true, false), 'Photo ready');
});
test('rendering, failed image loading and saving never claim a ready edit', () => {
  assert.equal(photoEditStatus(state(), false, false), 'Preparing your photo…');
  assert.match(photoEditStatus(state(), true, true), /could not open/);
  assert.equal(photoEditStatus(state({ phase: 'saving' }), true, false), 'Saving your photo…');
  assert.equal(photoEditStatus(state({ phase: 'error' }), true, false), 'Original kept. Try this edit again.');
});
test('legacy look-only builds retain familiar status and actions', () => {
  const value = state({ faceSupported: false, preset: 'film', intensity: 0.75 });
  assert.equal(photoEditStatus(value, true, false), 'Preview ready');
  assert.equal(photoEditApplyTitle(value, false), 'Use Film');
});
