/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_TIMER_OPTIONS } from '../src/capture-timing';
import { stepTimingDetent, timingDetentAt } from '../src/timing-controls';

test('touch positions snap only to the five visible stops, including thumb insets', () => {
  const width = 228;
  assert.deepEqual([14, 64, 114, 164, 214].map(x => timingDetentAt(x, width)), CAPTURE_TIMER_OPTIONS);
  assert.equal(timingDetentAt(38.9, width), 2);
  assert.equal(timingDetentAt(39, width), 3);
  assert.equal(timingDetentAt(-200, width), 2);
  assert.equal(timingDetentAt(999, width), 10);
});

test('rotated/resized rails use current measured width and reject unmeasured coordinates', () => {
  assert.equal(timingDetentAt(64, 228), 3);
  assert.equal(timingDetentAt(64, 128), 5);
  for (const width of [0, 28, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(timingDetentAt(60, width), null);
  assert.equal(timingDetentAt(Number.NaN, 200), null);
});

test('accessible steps traverse labelled detents and clamp at either end', () => {
  assert.equal(stepTimingDetent(2, -1), 2);
  assert.equal(stepTimingDetent(3, 1), 5);
  assert.equal(stepTimingDetent(5, 1), 8);
  assert.equal(stepTimingDetent(8, -1), 5);
  assert.equal(stepTimingDetent(10, 1), 10);
});
