/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewSelection } from '../src/review-selection';

const slots = [0, 1, 2, 3, 4];
test('an immediate retake retains thumbnail intent through intermediate animated frames', () => {
  const selection = createReviewSelection();
  selection.select(2);
  assert.equal(selection.current(), 2, 'Intent is reserved synchronously before a React render');
  for (const offset of [0, 55, 392, 784, 1200, 1550]) {
    assert.equal(selection.scroll(offset, 784, slots), 2);
    assert.equal(selection.current(), 2);
  }
  assert.equal(selection.scroll(1568, 784, slots), 2);
});

test('a second thumbnail overrides the first target while old animation frames arrive', () => {
  const selection = createReviewSelection();
  selection.select(2);
  selection.scroll(784, 784, slots);
  selection.select(4);
  assert.equal(selection.scroll(1568, 784, slots), 4);
  assert.equal(selection.current(), 4);
  assert.equal(selection.scroll(3136, 784, slots), 4);
});

test('a real user drag cancels programmatic intent and follows the visible page', () => {
  const selection = createReviewSelection();
  selection.select(2);
  selection.scroll(784, 784, slots);
  assert.equal(selection.beginDrag(784, slots), 1);
  assert.equal(selection.current(), 1);
  assert.equal(selection.scroll(0, 784, slots), 0);
  assert.equal(selection.scroll(1568, 784, slots), 2);
});

test('layout realignment preserves intended slot with the new page width', () => {
  const selection = createReviewSelection();
  selection.select(2);
  selection.scroll(1568, 784, slots);
  selection.select(selection.current());
  assert.equal(selection.scroll(1568, 600, slots), 2, 'Old-width offset must not select another photo');
  assert.equal(selection.scroll(1200, 600, slots), 2);
  assert.equal(selection.beginDrag(600, slots, 600), 1);
});


test('a real drag or newer thumbnail invalidates deferred programmatic scroll commands', () => {
  const selection = createReviewSelection();
  selection.select(2);
  assert.equal(selection.isTarget(2), true);
  selection.select(4);
  assert.equal(selection.isTarget(2), false);
  assert.equal(selection.isTarget(4), true);
  selection.beginDrag(784, slots, 3136);
  assert.equal(selection.isTarget(4), false, 'A queued animation frame cannot restart scrolling after a user drag');
});
