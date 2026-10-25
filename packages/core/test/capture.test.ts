import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureTransition as transition, createCaptureState, type CaptureState,
} from '../../../apps/ipad/src/capture-state';

function saving(): CaptureState {
  let state = transition(createCaptureState(), { type: 'start' });
  for (let i = 0; i < 3; i++) state = transition(state, { type: 'tick', attempt: state.attempt });
  return state;
}
function preview(id = 'guest-one'): CaptureState {
  const state = saving();
  return transition(state, { type: 'saved', attempt: state.attempt, photoId: id });
}
function confirmed(id = 'guest-one'): CaptureState {
  return transition(preview(id), { type: 'confirm', photoId: id });
}

test('countdown admits one tap atomically and permits capture only after three ticks', () => {
  let state = transition(createCaptureState(), { type: 'start' });
  const attempt = state.attempt;
  assert.equal(state.phase, 'countdown');
  assert.equal(state.remaining, 3);
  assert.strictEqual(transition(state, { type: 'start' }), state);
  for (const remaining of [2, 1]) {
    state = transition(state, { type: 'tick', attempt });
    assert.equal(state.phase, 'countdown');
    assert.equal(state.remaining, remaining);
    assert.strictEqual(transition(state, { type: 'saved', attempt, photoId: 'too-soon' }), state);
  }
  state = transition(state, { type: 'tick', attempt });
  assert.equal(state.phase, 'saving');
  assert.equal(state.remaining, undefined);
  assert.strictEqual(transition(state, { type: 'start' }), state);
  assert.strictEqual(transition(state, { type: 'tick', attempt }), state);
});

test('background or cancel interrupts countdown and invalidates every stale timer/camera result', () => {
  const counting = transition(createCaptureState(), { type: 'start' });
  const cancelled = transition(counting, { type: 'interrupt' });
  assert.equal(cancelled.phase, 'camera');
  assert.equal(cancelled.remaining, undefined);
  assert.ok(cancelled.attempt > counting.attempt);
  assert.strictEqual(transition(cancelled, { type: 'tick', attempt: counting.attempt }), cancelled);
  assert.strictEqual(transition(cancelled, { type: 'saved', attempt: counting.attempt, photoId: 'stale' }), cancelled);
  const restarted = transition(cancelled, { type: 'start' });
  assert.equal(restarted.remaining, 3);
  assert.strictEqual(transition(restarted, { type: 'tick', attempt: counting.attempt }), restarted);
  assert.strictEqual(transition(restarted, { type: 'failed', attempt: counting.attempt }), restarted);
});

test('saving an original blocks reset and accepts only its matching camera attempt', () => {
  const state = saving();
  assert.strictEqual(transition(state, { type: 'reset' }), state);
  assert.strictEqual(transition(state, { type: 'saved', attempt: state.attempt - 1, photoId: 'stale' }), state);
  const saved = transition(state, { type: 'saved', attempt: state.attempt, photoId: 'photo-one' });
  assert.equal(saved.phase, 'preview');
  assert.equal(saved.photoId, 'photo-one');
  assert.equal(saved.guestUrl, undefined);
  assert.strictEqual(transition(saved, { type: 'saved', attempt: state.attempt, photoId: 'duplicate' }), saved);
});

test('confirmation is explicit and readiness cannot attach another guest link or bypass review', () => {
  const state = preview();
  assert.strictEqual(transition(state, { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/token' }), state);
  assert.strictEqual(transition(state, { type: 'confirm', photoId: 'other-guest' }), state);
  const chosen = transition(state, { type: 'confirm', photoId: 'guest-one' });
  assert.equal(chosen.phase, 'confirmed');
  assert.equal(chosen.guestUrl, undefined);
  assert.strictEqual(transition(chosen, { type: 'start' }), chosen);
  assert.strictEqual(transition(chosen, { type: 'ready', photoId: 'other-guest', guestUrl: 'https://example.com/g/wrong' }), chosen);
  const ready = transition(chosen, { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/correct' });
  assert.equal(ready.guestUrl, 'https://example.com/g/correct');
});

test('retake clears draft selection and begins a fresh countdown without confirming it', () => {
  const draft = preview();
  const retake = transition(draft, { type: 'reset' });
  assert.equal(retake.phase, 'camera');
  assert.equal(retake.photoId, undefined);
  assert.equal(retake.guestUrl, undefined);
  assert.ok(retake.attempt > draft.attempt);
  assert.strictEqual(transition(retake, { type: 'confirm', photoId: draft.photoId! }), retake);
  assert.equal(transition(retake, { type: 'start' }).remaining, 3);
});

test('next guest clears the previous photo/QR and rejects its delayed readiness response', () => {
  const ready = transition(confirmed(), { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/old' });
  const next = transition(ready, { type: 'reset' });
  assert.equal(next.phase, 'camera');
  assert.equal(next.photoId, undefined);
  assert.equal(next.guestUrl, undefined);
  assert.strictEqual(transition(next, { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/old' }), next);
  const newGuest = transition(next, { type: 'restore', photoId: 'guest-two', confirmed: true });
  assert.strictEqual(transition(newGuest, { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/old' }), newGuest);
  assert.equal(newGuest.guestUrl, undefined);
});

test('restart restores draft review or confirmed identity while requiring fresh QR validation', () => {
  const previous = transition(confirmed(), { type: 'ready', photoId: 'guest-one', guestUrl: 'https://example.com/g/old' });
  for (const isConfirmed of [false, true]) {
    const restored = transition(previous, { type: 'restore', photoId: 'recovered', confirmed: isConfirmed });
    assert.equal(restored.phase, isConfirmed ? 'confirmed' : 'preview');
    assert.equal(restored.photoId, 'recovered');
    assert.equal(restored.guestUrl, undefined);
    assert.ok(restored.attempt > previous.attempt);
  }
});

test('capture failures allow retry but a late failure cannot discard the reviewed original', () => {
  for (const state of [transition(createCaptureState(), { type: 'start' }), saving()]) {
    const failed = transition(state, { type: 'failed', attempt: state.attempt });
    assert.equal(failed.phase, 'camera');
    assert.ok(failed.attempt > state.attempt);
    assert.equal(transition(failed, { type: 'start' }).remaining, 3);
  }
  const reviewed = preview();
  assert.strictEqual(transition(reviewed, { type: 'failed', attempt: reviewed.attempt }), reviewed);
  const chosen = confirmed();
  assert.strictEqual(transition(chosen, { type: 'failed', attempt: chosen.attempt }), chosen);
});
