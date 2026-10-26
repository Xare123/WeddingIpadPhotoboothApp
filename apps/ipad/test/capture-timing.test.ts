/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_TIMER_OPTIONS, DEFAULT_CAPTURE_TIMING, isCountdownSeconds, normalizeCaptureTiming } from '../src/capture-timing';

test('capture timing defaults give preparation five seconds and following shots three', () => {
  assert.deepEqual(normalizeCaptureTiming(null), { firstSeconds: 5, nextSeconds: 3 });
  assert.deepEqual(normalizeCaptureTiming({}), DEFAULT_CAPTURE_TIMING);
  assert.equal(Object.isFrozen(DEFAULT_CAPTURE_TIMING), true);
  const guest = normalizeCaptureTiming(DEFAULT_CAPTURE_TIMING);
  guest.firstSeconds = 10;
  guest.nextSeconds = 2;
  assert.deepEqual(DEFAULT_CAPTURE_TIMING, { firstSeconds: 5, nextSeconds: 3 });
  assert.deepEqual(normalizeCaptureTiming(null), { firstSeconds: 5, nextSeconds: 3 });
});

test('two independently selected timing values retain bounded detents without coercion', () => {
  assert.deepEqual(CAPTURE_TIMER_OPTIONS, [2, 3, 5, 8, 10]);
  for (const firstSeconds of CAPTURE_TIMER_OPTIONS) for (const nextSeconds of CAPTURE_TIMER_OPTIONS) {
    assert.deepEqual(normalizeCaptureTiming({ firstSeconds, nextSeconds }), { firstSeconds, nextSeconds });
  }
  for (const invalid of [undefined, null, '5', NaN, Infinity, -1, 0, 1, 4, 5.5, 60, {}, []]) assert.equal(isCountdownSeconds(invalid), false);
  assert.deepEqual(normalizeCaptureTiming({ firstSeconds: '10', nextSeconds: 2 }), { firstSeconds: 5, nextSeconds: 2 });
  assert.deepEqual(normalizeCaptureTiming({ firstSeconds: 8, nextSeconds: Infinity }), { firstSeconds: 8, nextSeconds: 3 });
});
