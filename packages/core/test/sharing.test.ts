import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, qrForJob, readyGuestPage, validateOrigin } from '../../../apps/ipad/src/sharing';

const origin = 'https://gallery.example';
const guestUrl = `${origin}/g/${'a'.repeat(64)}`;
const ready = { status: 'ready', url: guestUrl, expiresAt: 2000 };

test('production API settings require an origin over HTTPS; development permits only HTTP loopback', () => {
  assert.equal(validateOrigin('  https://gallery.example/  ', false), origin);
  assert.equal(validateOrigin('http://127.0.0.1:8787', true), 'http://127.0.0.1:8787');
  assert.equal(validateOrigin('http://localhost:8787', true), 'http://localhost:8787');
  for (const value of ['http://gallery.example', 'http://127.0.0.1:8787', 'https://user:password@gallery.example',
    'https://gallery.example/path', 'https://gallery.example?token=secret', 'https://gallery.example/#fragment', 'not-a-url']) {
    assert.throws(() => validateOrigin(value, false));
  }
  assert.throws(() => validateOrigin('http://192.168.1.2:8787', true));
});

test('native transport accepts a guest page only after explicit server readiness and future expiry', () => {
  assert.deepEqual(readyGuestPage(ready, origin, 1000), { guestUrl, guestExpiresAt: 2000 });
  for (const value of [undefined, {}, { ...ready, status: 'stored' }, { ...ready, status: 'pending' },
    { ...ready, expiresAt: 1000 }, { ...ready, expiresAt: NaN }, { ...ready, expiresAt: '2000' },
    { ...ready, url: 'https://another.example/g/token' }, { ...ready, url: `${origin}/v1/photos/id` },
    { ...ready, url: `${guestUrl}?extra=secret` }, { ...ready, url: `${guestUrl}#fragment` },
    { ...ready, url: 'https://user:password@gallery.example/g/token' }]) {
    assert.throws(() => readyGuestPage(value, origin, 1000));
  }
});

test('QR helper never exposes an upload URL before completion, after expiry or from a share outcome', () => {
  const complete = { kind: 'upload', state: 'complete', guestUrl, guestExpiresAt: 2000 };
  assert.equal(qrForJob(complete, 1000), guestUrl);
  for (const value of [undefined, { ...complete, state: 'pending' }, { ...complete, state: 'mocked' },
    { ...complete, kind: 'share' }, { ...complete, guestUrl: undefined }, { ...complete, guestExpiresAt: undefined },
    { ...complete, guestExpiresAt: 1000 }, { ...complete, guestExpiresAt: NaN },
    { ...complete, guestUrl: 'javascript:alert(1)' }, { ...complete, guestUrl: `${origin}/photos/id` },
    { ...complete, guestUrl: 'http://gallery.example/g/token' },
    { ...complete, guestUrl: 'https://user:password@gallery.example/g/token' },
    { ...complete, guestUrl: `${guestUrl}?token=other` }, { ...complete, guestUrl: `${guestUrl}#fragment` }]) {
    assert.equal(qrForJob(value, 1000), undefined);
  }
});


test('phone opt-in normalizes formatting while requiring explicit international E.164 boundaries', () => {
  assert.equal(normalizePhone('  +1 (202) 555-0123  '), '+12025550123');
  assert.equal(normalizePhone('+12.345.678'), '+12345678');
  assert.equal(normalizePhone('+123456789012345'), '+123456789012345');
  for (const phone of ['', '2025550123', '+02025550123', '+1234567', '+1234567890123456',
    '+1 202 555 0123 ext 2', '++12025550123', '+١٢٠٢٥٥٥٠١٢٣', 'mailto:guest@example.com']) {
    assert.throws(() => normalizePhone(phone));
  }
});


test('guest QR requires a public HTTPS gallery and never offers an emulator or local-network address', () => {
  const complete = { kind: 'upload', state: 'complete', guestExpiresAt: 2000 };
  assert.equal(qrForJob({ ...complete, guestUrl: 'https://photos.gizelleandrami.com/g/opaque' }, 1000), 'https://photos.gizelleandrami.com/g/opaque');
  for (const origin of ['http://gallery.example', 'http://localhost:8787', 'http://127.0.0.1:8787',
    'https://localhost', 'https://127.0.0.1', 'https://192.168.1.2', 'https://[::1]',
    'https://booth', 'https://booth.localhost', 'https://booth.local', 'https://booth.internal',
    'https://booth.test', 'https://booth.invalid']) {
    assert.equal(qrForJob({ ...complete, guestUrl: `${origin}/g/opaque` }, 1000), undefined, origin);
  }
  // Local transport validation can still test server readiness without exposing
  // an unusable localhost address as a guest-facing QR.
  const local = readyGuestPage({ status: 'ready', url: 'http://localhost:8787/g/opaque', expiresAt: 2000 }, 'http://localhost:8787', 1000);
  assert.equal(qrForJob({ ...complete, ...local }, 1000), undefined);
});
