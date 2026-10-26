import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGuestExpiry, normalizePhone, qrForJob, readyGuestPage, validateOrigin, validateReadyPublication } from '../../../apps/ipad/src/sharing';

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
    { ...ready, expiresAt: 1000 }, { ...ready, expiresAt: 1e99 }, { ...ready, expiresAt: NaN }, { ...ready, expiresAt: '2000' },
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
    { ...complete, guestExpiresAt: 1000 }, { ...complete, guestExpiresAt: 1e99 }, { ...complete, guestExpiresAt: NaN },
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


test('visible expiry formats the acknowledged instant in local time across midnight and daylight-saving changes', () => {
  const expiry = Date.parse('2026-11-01T00:30:00Z');
  assert.match(formatGuestExpiry(expiry, 'en-US', 'UTC')!, /Nov 1, 2026.*12:30.*AM.*UTC/);
  assert.match(formatGuestExpiry(expiry, 'en-US', 'America/New_York')!, /Oct 31, 2026.*8:30.*PM.*EDT/);
  const before = Date.parse('2026-11-01T05:30:00Z');
  const after = Date.parse('2026-11-01T06:30:00Z');
  assert.match(formatGuestExpiry(before, 'en-US', 'America/New_York')!, /Nov 1, 2026.*1:30.*AM.*EDT/);
  assert.match(formatGuestExpiry(after, 'en-US', 'America/New_York')!, /Nov 1, 2026.*1:30.*AM.*EST/);
  // The display follows the server timestamp; it never invents a one-day or
  // seven-day retention period from the time this component renders.
  assert.notEqual(formatGuestExpiry(expiry, 'en-US', 'UTC'), formatGuestExpiry(expiry + 7 * 86_400_000, 'en-US', 'UTC'));
});

test('invalid server expiry or formatting options cannot produce a misleading availability label', () => {
  for (const expiry of [undefined, NaN, Infinity, -Infinity, 1e99]) {
    assert.equal(formatGuestExpiry(expiry, 'en-US', 'UTC'), undefined);
  }
  assert.equal(formatGuestExpiry(2000, 'not_a_locale', 'UTC'), undefined);
  assert.equal(formatGuestExpiry(2000, 'en-US', 'Not/A_Timezone'), undefined);
});


test('four-photo readiness requires the exact selected/raw roles, order and complete template metadata echo', () => {
  const expected = { photoIds: ['selected-1', 'selected-2', 'selected-3', 'selected-4'],
    originalPhotoIds: ['raw-1', 'raw-2', 'raw-3', 'raw-4'],
    composite: { photoId: 'template', layout: 'strip' as const, theme: 'coastal' as const, version: 'wedding-template-v1' as const } };
  const good = { ...ready, ...expected };
  assert.doesNotThrow(() => validateReadyPublication(good, expected));
  const invalid = [ready, { ...good, photoIds: undefined }, { ...good, originalPhotoIds: undefined },
    { ...good, composite: undefined }, { ...good, photoIds: expected.originalPhotoIds, originalPhotoIds: expected.photoIds },
    { ...good, photoIds: [...expected.photoIds].reverse() }, { ...good, originalPhotoIds: [...expected.originalPhotoIds].reverse() },
    { ...good, photoIds: [...expected.photoIds, 'extra'] },
    ...[{ layout: 'grid' }, { version: 'other' }, { photoId: 'other' }, { theme: 'classic' }, { extra: true }]
      .map(change => ({ ...good, composite: { ...expected.composite, ...change } }))];
  for (const value of invalid) assert.throws(() => validateReadyPublication(value, expected));
  // Five-photo servers retain their established generic readiness response.
  assert.doesNotThrow(() => validateReadyPublication(ready, { photoIds: ['a', 'b', 'c', 'd', 'e'] }));
});
