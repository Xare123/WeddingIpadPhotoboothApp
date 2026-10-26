import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QueueJob } from '../src/index';
import { smsCapability, smsOutcome, smsRequestExpired } from '../../../apps/ipad/src/sms-state';

test('guest phone collection stays disabled until the backend explicitly confirms approved live SMS', () => {
  assert.equal(smsCapability({ status: 'ok', sms: 'textbelt', smsAvailable: true }), true);
  for (const value of [null, {}, { status: 'ok', sms: 'mock', smsAvailable: true },
    { status: 'ok', sms: 'textbelt-test', smsAvailable: true }, { status: 'ok', sms: 'textbelt' },
    { status: 'ok', sms: 'textbelt', smsAvailable: 'true' }, { status: 'error', sms: 'textbelt', smsAvailable: true }]) {
    assert.equal(smsCapability(value), false);
  }
});

test('SMS UI distinguishes provider acceptance, unknown delivery, test mode, rejection and uncertainty', () => {
  const job: QueueJob = { id: 'request', photoId: 'photo', sessionId: 'session', kind: 'share', uploadJobId: 'photo',
    recipientRef: 'opaque-reference', consentedAt: 1, createdAt: 1, attempts: 0, nextAttemptAt: 1, state: 'pending' };
  assert.match(smsOutcome({ ...job, state: 'complete' })!, /accepted.*not yet confirmed/);
  assert.match(smsOutcome({ ...job, state: 'mocked' })!, /No text was sent/);
  assert.match(smsOutcome({ ...job, state: 'test_accepted' })!, /No text was sent/);
  assert.match(smsOutcome({ ...job, state: 'uncertain' })!, /will not send it again automatically/);
  assert.match(smsOutcome({ ...job, state: 'rejected' })!, /did not accept/);
  assert.match(smsOutcome({ ...job, state: 'expired' })!, /expired.*unconfirmed/);
  assert.equal(smsOutcome(undefined), null);
});

test('a lost text response can expire locally without provider calls or continued phone retention', () => {
  const job: QueueJob = { id: 'request', photoId: 'photo', sessionId: 'session', kind: 'share', uploadJobId: 'photo',
    recipientRef: 'opaque-reference', consentedAt: 1, createdAt: 1, attempts: 2, nextAttemptAt: 1, state: 'pending', guestExpiresAt: 2000 };
  assert.equal(smsRequestExpired(job, [], 1999), false);
  assert.equal(smsRequestExpired(job, [], 2000), true);
  // Old queued jobs can recover the same expiry from acknowledged uploads.
  const upload: QueueJob = { id: 'photo', photoId: 'photo', sessionId: 'session', kind: 'upload', fileUri: 'file:///documents/photo.jpg',
    createdAt: 1, attempts: 0, nextAttemptAt: 1, state: 'complete', guestExpiresAt: 2000 };
  assert.equal(smsRequestExpired({ ...job, guestExpiresAt: undefined }, [upload], 2000), true);
  assert.equal(smsRequestExpired({ ...job, guestExpiresAt: undefined }, [{ ...upload, sessionId: 'other' }], 2000), false);
  assert.equal(smsRequestExpired({ ...job, guestExpiresAt: NaN }, [], 2000), false);
});
