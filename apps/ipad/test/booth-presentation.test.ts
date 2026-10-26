/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureErrorMessage, captureSaveStatus, durableSaveLabel, WEDDING_IDENTITY } from '../src/booth-presentation';

test('wedding identity uses the same names and explicit event date', () => {
  assert.equal(WEDDING_IDENTITY, 'Gizelle & Rami · November 1, 2026');
});

test('first-photo save failure never claims any original has already saved', () => {
  const footer = captureSaveStatus({ savedCount: 0, targetCount: 5, seconds: 3, saving: false, failedSlot: 0 });
  assert.equal(footer, 'Photo 1 still needs saving · No photos saved on this iPad yet');
  assert.equal(footer.includes('originals saved'), false);
  assert.equal(captureErrorMessage(0, false), 'The camera could not finish this photo. No photos have been saved yet. Try again.');
  assert.equal(captureErrorMessage(0, true).includes('has not finished saving'), true);
});

test('an in-flight original is excluded from durable progress in saving and retry states', () => {
  assert.equal(captureSaveStatus({ savedCount: 2, targetCount: 5, seconds: 5, saving: true }), 'Saving this photo · 2 of 5 originals saved on this iPad');
  assert.equal(captureSaveStatus({ savedCount: 2, targetCount: 5, seconds: 5, saving: false, failedSlot: 2 }), 'Photo 3 still needs saving · 2 of 5 originals saved on this iPad');
});

test('ready and completed local counts never imply cloud or Photos-library success', () => {
  assert.equal(captureSaveStatus({ savedCount: 0, targetCount: 5, seconds: 2, saving: false }), '2 seconds per photo · No photos saved on this iPad yet');
  assert.equal(durableSaveLabel(5, 5), '5 of 5 originals saved on this iPad');
  assert.equal(captureErrorMessage(1, false), 'The camera could not finish this photo. Your 1 saved original is safe on this iPad. Try again.');
});

test('two-stage timing never claims the same duration for every photo or hides a save delay', () => {
  const timing = { firstSeconds: 5, nextSeconds: 3 } as const;
  assert.equal(captureSaveStatus({ savedCount: 0, targetCount: 4, timing, saving: false }),
    'Each original saves before the next countdown · No photos saved on this iPad yet');
  assert.equal(captureSaveStatus({ savedCount: 1, targetCount: 4, timing, saving: true }),
    'Saving this photo · 1 of 4 originals saved on this iPad');
});
