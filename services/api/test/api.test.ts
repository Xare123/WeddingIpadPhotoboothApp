import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare, type MiniflareOptions } from 'miniflare';

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
const changedJpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);
const origin = 'http://localhost';
const auth = { Authorization: 'Bearer local-development-only' };
const instances: Miniflare[] = [];
let runtime: Miniflare;
const persistencePaths: string[] = [];
const limiterNames = ['RATE_GALLERY_GLOBAL', 'RATE_GALLERY_CLIENT', 'RATE_PHOTO_GLOBAL', 'RATE_PHOTO_CLIENT',
  'RATE_API_GLOBAL', 'RATE_API_CLIENT', 'RATE_SHARE_GLOBAL', 'RATE_SHARE_CLIENT'];
type NativeLimits = Record<string, { namespace_id: string; simple: { limit: number; period: 60 } }>;
const nativeLimits = (): NativeLimits => Object.fromEntries(limiterNames.map((name, index) =>
  [name, { namespace_id: String(index + 1), simple: { limit: 1000, period: 60 as const } }]));
function runtimeOptions(bindings: Record<string, string> = {}, r2Persist?: string, limits?: NativeLimits): MiniflareOptions {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  return {
    modules: true, script: stripTypeScriptTypes(source), compatibilityDate: '2026-07-30',
    r2Buckets: ['PHOTOS'], r2Persist, ratelimits: limits ?? (bindings.MODE === 'production' ? nativeLimits() : undefined), bindings: { MODE: 'local', SMS_MODE: 'mock',
      LOCAL_DEVICE_TOKEN: 'local-development-only', LOCAL_LINK_KEY: 'test-local-key', ...bindings },
  };
}
async function createRuntime(bindings: Record<string, string> = {}, r2Persist?: string, limits?: NativeLimits) {
  const instance = new Miniflare(runtimeOptions(bindings, r2Persist, limits));
  instances.push(instance);
  await instance.ready;
  return instance;
}
before(async () => { runtime = await createRuntime(); });
after(async () => {
  await Promise.all(instances.map(instance => instance.dispose()));
  for (const path of persistencePaths) rmSync(path, { recursive: true, force: true });
});
const put = (sessionId: string, photoId: string, bytes = jpeg, headers = auth) => runtime.dispatchFetch(
  `${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: bytes,
  });
const post = (path: string, body: unknown, instance = runtime) => instance.dispatchFetch(`${origin}${path}`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const ready = (sessionId: string, photoIds: string[], instance = runtime) => post(`/v1/sessions/${sessionId}/ready`, { photoIds }, instance);
const shareRequest = (sessionId: string, overrides: Record<string, unknown> = {}, instance = runtime) => post('/v1/shares', {
  id: randomUUID(), sessionId, phone: '+12025550123', consent: true, ...overrides,
}, instance);
type Gallery = { status: 'ready'; url: string; expiresAt: number };
const fivePhotos = () => Array.from({ length: 5 }, () => randomUUID());
async function gallery(sessionId = randomUUID(), photoIds = fivePhotos()) {
  for (const photoId of photoIds) assert.equal((await put(sessionId, photoId)).status, 201);
  const response = await ready(sessionId, photoIds);
  assert.equal(response.status, 200);
  return { sessionId, photoIds, ...await response.json() as Gallery };
}
const galleryKey = (url: string) => `galleries/${createHash('sha256').update(new URL(url).pathname.split('/').at(-1)!).digest('hex')}.json`;

// These are emulator contract checks. The tiny fixture tests byte preservation and
// marker validation, not the visual quality or full decoding of a camera JPEG.
test('local health is explicit about mock SMS; every write requires a bearer', async () => {
  const health = await runtime.dispatchFetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { sms: string }).sms, 'mock');
  const sessionId = randomUUID(), photoId = randomUUID();
  for (const headers of [{}, { Authorization: 'Bearer incorrect' }]) {
    assert.equal((await put(sessionId, photoId, jpeg, headers as typeof auth)).status, 401);
  }
  for (const path of [`/v1/sessions/${sessionId}/ready`, '/v1/shares', `/v1/sessions/${sessionId}/gallery`]) {
    const response = await runtime.dispatchFetch(`${origin}${path}`, {
      method: path.endsWith('/gallery') ? 'DELETE' : 'POST', body: '{}',
    });
    assert.equal(response.status, 401);
  }
});

test('known local credentials fail closed on a public hostname', async () => {
  assert.equal((await runtime.dispatchFetch('https://public.example/health')).status, 503);
  assert.equal((await runtime.dispatchFetch('https://public.example/v1/shares', { method: 'POST', headers: auth })).status, 503);
});

test('upload retries are idempotent and conflicting bytes cannot overwrite an original', async () => {
  const sessionId = randomUUID(), photoId = randomUUID();
  assert.equal((await put(sessionId, photoId)).status, 201);
  assert.equal((await put(sessionId, photoId)).status, 200);
  assert.equal((await put(sessionId, photoId, changedJpeg)).status, 409);
  const bucket = await runtime.getR2Bucket('PHOTOS');
  assert.deepEqual(new Uint8Array(await (await bucket.get(`sessions/${sessionId}/photos/${photoId}.jpg`))!.arrayBuffer()), jpeg);
});

test('concurrent upload replay stores one immutable object', async () => {
  const sessionId = randomUUID(), photoId = randomUUID();
  const responses = await Promise.all([put(sessionId, photoId), put(sessionId, photoId)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
  assert.equal((await (await runtime.getR2Bucket('PHOTOS')).list({ prefix: `sessions/${sessionId}/photos/` })).objects.length, 1);
});

test('photo IDs are session scoped and object paths/listing cannot bypass authorization', async () => {
  const first = randomUUID(), second = randomUUID(), photoId = randomUUID();
  assert.equal((await put(first, photoId)).status, 201);
  assert.equal((await put(second, photoId, changedJpeg)).status, 201);
  for (const path of [`/sessions/${first}/photos/${photoId}.jpg`, `/photos/${photoId}.jpg`, '/v1/photos', `/v1/sessions/${first}/photos`]) {
    assert.equal((await runtime.dispatchFetch(`${origin}${path}`, { headers: auth })).status, 404);
  }
});

test('JPEG content type, markers, IDs, and streamed 10 MiB limit are enforced', async () => {
  const sessionId = randomUUID(), photoId = randomUUID();
  const wrongType = await runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/png' }, body: jpeg,
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await put(sessionId, photoId, new Uint8Array([1, 2, 3]))).status, 400);
  assert.equal((await put('bad', photoId)).status, 400);
  const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
  tooLarge.set([255, 216]); tooLarge.set([255, 217], tooLarge.length - 2);
  assert.equal((await put(sessionId, photoId, tooLarge)).status, 413);
  assert.equal(await (await runtime.getR2Bucket('PHOTOS')).head(`sessions/${sessionId}/photos/${photoId}.jpg`), null);
});

test('new five-photo gallery stays unavailable until every original is durable', async () => {
  const sessionId = randomUUID(), photoIds = fivePhotos();
  const before = (await (await runtime.getR2Bucket('PHOTOS')).list({ prefix: 'galleries/' })).objects.length;
  assert.equal((await ready(sessionId, photoIds)).status, 409);
  assert.equal((await shareRequest(sessionId)).status, 409);
  await put(sessionId, photoIds[0]!);
  assert.equal((await ready(sessionId, [photoIds[0]!])).status, 400);
  assert.equal((await ready(sessionId, photoIds)).status, 409);
  assert.equal((await shareRequest(sessionId)).status, 409);
  assert.equal((await (await runtime.getR2Bucket('PHOTOS')).list({ prefix: 'galleries/' })).objects.length, before);
  for (const id of photoIds.slice(1)) await put(sessionId, id);
  const response = await ready(sessionId, photoIds);
  assert.equal(response.status, 200);
  const result = await response.json() as Gallery;
  const html = await (await runtime.dispatchFetch(result.url)).text();
  for (const id of photoIds) assert.ok(html.includes(`/photos/${id}`));
});

test('ready requires a nonempty unique UUID list and valid JSON', async () => {
  const sessionId = randomUUID(), id = randomUUID();
  for (const photoIds of [[], ['bad'], [id, id], null, 'not-an-array']) {
    assert.equal((await post(`/v1/sessions/${sessionId}/ready`, { photoIds })).status, 400);
  }
  for (const path of [`/v1/sessions/${sessionId}/ready`, '/v1/shares']) {
    assert.equal((await runtime.dispatchFetch(`${origin}${path}`, { method: 'POST', headers: auth, body: '{' })).status, 400);
  }
});

test('readiness replay preserves link expiry and forbids mutating a published manifest', async () => {
  const result = await gallery(randomUUID(), fivePhotos());
  const repeated = await ready(result.sessionId, result.photoIds);
  assert.deepEqual(await repeated.json(), { status: result.status, url: result.url, expiresAt: result.expiresAt });
  assert.equal((await ready(result.sessionId, [...result.photoIds].reverse())).status, 409);
  assert.equal((await ready(result.sessionId, [result.photoIds[0]!])).status, 409);
});

test('opaque gallery renders only its own photos and offers private downloads', async () => {
  const first = await gallery(randomUUID(), fivePhotos());
  const other = await gallery();
  const token = new URL(first.url).pathname.split('/').at(-1)!;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.ok(!first.url.includes(first.sessionId));
  const response = await runtime.dispatchFetch(first.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type')!, /text\/html/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(response.headers.get('Content-Security-Policy')!, /default-src 'none'/);
  assert.match(response.headers.get('Content-Security-Policy')!, /img-src 'self'/);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  const html = await response.text();
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /animation:none!important;transition:none!important/);
  assert.match(html, /aria-label="Download photo 1 in full resolution"/);
  assert.match(html, /alt="Wedding photo 1"/);
  assert.ok(!/<script[\s>]/i.test(html));
  for (const photoId of first.photoIds) assert.ok(html.includes(`/photos/${photoId}`));
  assert.ok(!html.includes(other.photoIds[0]!));
  assert.ok(!html.includes('+12025550123'));
  assert.ok(html.includes(`<time datetime="${new Date(first.expiresAt).toISOString()}">`));
  assert.match(html, /Link expiry closes access; it does not delete the original photos/);
  assert.match(html, /Anyone with this link can view and download/);
  assert.ok(!html.includes('https://'));
  const photo = await runtime.dispatchFetch(`${first.url}/photos/${first.photoIds[0]}?download=1`);
  assert.equal(photo.status, 200);
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), jpeg);
  assert.match(photo.headers.get('Content-Disposition')!, /^attachment;/);
  assert.equal(photo.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(photo.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await runtime.dispatchFetch(`${first.url}/photos/${other.photoIds[0]}`)).status, 404);
  assert.equal((await runtime.dispatchFetch(`${origin}/g/${'f'.repeat(64)}`)).status, 404);
});

test('expired galleries deny both page and download without extending expiry on retry', async () => {
  const result = await gallery();
  const bucket = await runtime.getR2Bucket('PHOTOS'), key = galleryKey(result.url);
  const record = await (await bucket.get(key))!.json<Record<string, unknown>>();
  await bucket.put(key, JSON.stringify({ ...record, expiresAt: Date.now() - 1 }));
  const expiredPage = await runtime.dispatchFetch(result.url);
  assert.equal(expiredPage.status, 410);
  assert.match(expiredPage.headers.get('Content-Type')!, /text\/html/);
  const expiredHtml = await expiredPage.text();
  assert.match(expiredHtml, /This link has expired/);
  assert.ok(!expiredHtml.includes(`/photos/${result.photoIds[0]}`));
  assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${result.photoIds[0]}?download=1`)).status, 410);
  assert.equal((await ready(result.sessionId, result.photoIds)).status, 410);
});

test('authenticated revocation permanently closes page, download, readiness and sharing', async () => {
  const result = await gallery();
  const revoke = () => runtime.dispatchFetch(`${origin}/v1/sessions/${result.sessionId}/gallery`, { method: 'DELETE', headers: auth });
  assert.ok([200, 204].includes((await revoke()).status));
  assert.ok([200, 204].includes((await revoke()).status));
  assert.equal((await runtime.dispatchFetch(result.url)).status, 410);
  assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${result.photoIds[0]}`)).status, 410);
  assert.equal((await ready(result.sessionId, result.photoIds)).status, 410);
  assert.equal((await shareRequest(result.sessionId)).status, 410);
});

test('SMS requires explicit consent and E.164 and reports mocked without storing recipients or raw tokens', async () => {
  const result = await gallery();
  for (const overrides of [{ consent: false }, { consent: null }, { phone: '202-555-0123' }, { phone: '' }]) {
    assert.equal((await shareRequest(result.sessionId, overrides)).status, 400);
  }
  const id = randomUUID();
  const response = await shareRequest(result.sessionId, { id });
  assert.equal(response.status, 200);
  const shared = await response.json() as { status: string; url: string; expiresAt: number; message: string };
  assert.equal(shared.status, 'mocked');
  assert.match(shared.message, /no text message was sent/i);
  assert.equal(shared.url, result.url);
  assert.equal(shared.expiresAt, result.expiresAt);
  assert.deepEqual(await (await shareRequest(result.sessionId, { id })).json(), shared);
  const bucket = await runtime.getR2Bucket('PHOTOS');
  for (const object of (await bucket.list()).objects.filter(object => object.key.endsWith('.json'))) {
    const text = await (await bucket.get(object.key))!.text();
    assert.ok(!text.includes('+12025550123'), `${object.key} must not persist a phone number`);
    assert.ok(!text.includes(new URL(result.url).pathname.split('/').at(-1)!), `${object.key} must not persist a bearer token`);
  }
  assert.equal((await shareRequest(result.sessionId, { id, phone: '+12025550124' })).status, 409);
  const other = await gallery();
  assert.equal((await shareRequest(other.sessionId, { id })).status, 409);
});

test('mock failure is an explicit retryable result and live SMS modes fail closed', async () => {
  const failed = await createRuntime({ SMS_MODE: 'mock-fail' });
  const sessionId = randomUUID(), photoIds = fivePhotos();
  for (const photoId of photoIds) assert.equal((await failed.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpeg,
  })).status, 201);
  assert.equal((await ready(sessionId, photoIds, failed)).status, 200);
  const response = await shareRequest(sessionId, {}, failed);
  assert.equal(response.status, 503);
  const failure = await response.json() as { status: string; retryable: boolean };
  assert.equal(failure.status, 'mock_failed');
  assert.equal(failure.retryable, true);
  const live = await createRuntime({ SMS_MODE: 'live' });
  assert.equal((await shareRequest(randomUUID(), {}, live)).status, 503);
});


test('production mode rejects missing, weak, reused secrets, insecure origins and invalid TTL', async () => {
  const cases = [
    { MODE: 'production' },
    { MODE: 'production', DEVICE_TOKEN: 'x'.repeat(40), LINK_SIGNING_KEY: 'y'.repeat(40), PUBLIC_ORIGIN: 'https://gallery.example' },
    { MODE: 'production', DEVICE_TOKEN: '0123456789abcdefghijklmnopqrstuv', LINK_SIGNING_KEY: '0123456789abcdefghijklmnopqrstuv', PUBLIC_ORIGIN: 'https://gallery.example' },
    { MODE: 'production', DEVICE_TOKEN: 'device-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', LINK_SIGNING_KEY: 'signing-9876543210-zyxwvutsrqponmlkjihgfedcba', PUBLIC_ORIGIN: 'http://gallery.example' },
    { LINK_TTL_SECONDS: '0' }, { LINK_TTL_SECONDS: '999999999' },
  ];
  for (const bindings of cases) {
    const instance = await createRuntime(bindings);
    const target = bindings.MODE === 'production' ? 'https://gallery.example/health' : `${origin}/health`;
    assert.equal((await instance.dispatchFetch(target)).status, 503);
  }
});

test('production configuration uses an HTTPS canonical origin and a distinct device bearer', async () => {
  const device = 'device-test-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const signing = 'signing-test-9876543210-zyxwvutsrqponmlkjihgfedcba';
  const instance = await createRuntime({ MODE: 'production', DEVICE_TOKEN: device,
    LINK_SIGNING_KEY: signing, PUBLIC_ORIGIN: 'https://gallery.example', LINK_TTL_SECONDS: '604800' });
  const health = await instance.dispatchFetch('https://gallery.example/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { storage: string }).storage, 'private-r2');
  for (const target of ['http://gallery.example/health', 'https://wrong.example/health']) {
    assert.equal((await instance.dispatchFetch(target)).status, 503);
  }
  const sessionId = randomUUID(), photoId = randomUUID();
  const path = `https://gallery.example/v1/sessions/${sessionId}/photos/${photoId}`;
  assert.equal((await instance.dispatchFetch(path, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpeg })).status, 401);
  const productionAuth = { Authorization: `Bearer ${device}`, 'Content-Type': 'image/jpeg' };
  assert.equal((await instance.dispatchFetch(path, { method: 'PUT', headers: productionAuth, body: jpeg })).status, 201);
  const photoIds = [photoId, ...fivePhotos().slice(0, 4)];
  for (const id of photoIds.slice(1)) assert.equal((await instance.dispatchFetch(`https://gallery.example/v1/sessions/${sessionId}/photos/${id}`, { method: 'PUT', headers: productionAuth, body: jpeg })).status, 201);
  const readyStartedAt = Date.now();
  const response = await instance.dispatchFetch(`https://gallery.example/v1/sessions/${sessionId}/ready`, {
    method: 'POST', headers: { ...productionAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds }),
  });
  assert.equal(response.status, 200);
  const result = await response.json() as Gallery;
  assert.equal(new URL(result.url).origin, 'https://gallery.example');
  assert.ok(result.expiresAt >= readyStartedAt + 7 * 86_400_000);
  assert.ok(result.expiresAt <= Date.now() + 7 * 86_400_000);
  assert.equal((await instance.dispatchFetch(result.url)).status, 200);
});


async function rotationFixture() {
  const path = mkdtempSync(join(tmpdir(), 'wedding-r2-rotation-'));
  persistencePaths.push(path);
  const bindings = { LOCAL_LINK_KEY: 'rotation-test-key-a' };
  const instance = await createRuntime(bindings, path);
  const sessionId = randomUUID(), photoIds = fivePhotos(), photoId = photoIds[0]!;
  for (const id of photoIds.slice(1)) assert.equal((await instance.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${id}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpeg })).status, 201);
  const stored = await instance.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpeg,
  });
  assert.equal(stored.status, 201);
  const response = await ready(sessionId, photoIds, instance);
  assert.equal(response.status, 200);
  const result = await response.json() as Gallery;
  const rotate = (key: string) => instance.setOptions(runtimeOptions({ LOCAL_LINK_KEY: key }, path));
  return { instance, sessionId, photoId, photoIds, result, rotate };
}

test('signing-key rotation rejects existing gallery tokens while retaining stored originals and allowing a fresh token', async () => {
  const { instance, sessionId, photoId, photoIds, result, rotate } = await rotationFixture();
  assert.equal((await instance.dispatchFetch(result.url)).status, 200);
  await rotate('rotation-test-key-b');
  // Prove the denial comes from current-key verification, not an empty emulator
  // bucket after a configuration restart: both old manifest and original remain.
  const bucket = await instance.getR2Bucket('PHOTOS');
  assert.ok(await bucket.head(galleryKey(result.url)));
  assert.deepEqual(new Uint8Array(await (await bucket.get(`sessions/${sessionId}/photos/${photoId}.jpg`))!.arrayBuffer()), jpeg);
  assert.equal((await instance.dispatchFetch(result.url)).status, 410);
  assert.equal((await instance.dispatchFetch(`${result.url}/photos/${photoId}?download=1`)).status, 410);
  const fresh = await ready(sessionId, photoIds, instance);
  assert.equal(fresh.status, 200);
  const renewed = await fresh.json() as Gallery;
  assert.notEqual(renewed.url, result.url);
  assert.equal((await instance.dispatchFetch(renewed.url)).status, 200);
  assert.equal((await instance.dispatchFetch(`${renewed.url}/photos/${photoId}?download=1`)).status, 200);
  assert.equal((await instance.dispatchFetch(result.url)).status, 410);
});

test('session revocation under a rotated key survives further rotations and restoration of the previous key', async () => {
  const { instance, sessionId, photoId, photoIds, result, rotate } = await rotationFixture();
  await rotate('rotation-test-key-b');
  // Revoke before this key has issued any gallery. Revocation must bind the
  // session identity instead of only the token derived from the current key.
  const response = await instance.dispatchFetch(`${origin}/v1/sessions/${sessionId}/gallery`, { method: 'DELETE', headers: auth });
  assert.equal(response.status, 200);
  for (const key of ['rotation-test-key-b', 'rotation-test-key-a', 'rotation-test-key-c']) {
    await rotate(key);
    assert.equal((await instance.dispatchFetch(result.url)).status, 410);
    assert.equal((await instance.dispatchFetch(`${result.url}/photos/${photoId}?download=1`)).status, 410);
    assert.equal((await ready(sessionId, photoIds, instance)).status, 410);
    assert.equal((await shareRequest(sessionId, {}, instance)).status, 410);
    assert.ok(await (await instance.getR2Bucket('PHOTOS')).head(`sessions/${sessionId}/photos/${photoId}.jpg`));
  }
});


test('actual Worker bearer comparison rejects malformed and varied-length credentials and preserves valid upload/readiness', async () => {
  const device = 'device-test-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const instance = await createRuntime({ MODE: 'production', DEVICE_TOKEN: device,
    LINK_SIGNING_KEY: 'signing-test-9876543210-zyxwvutsrqponmlkjihgfedcba', PUBLIC_ORIGIN: 'https://gallery.example' });
  const sessionId = randomUUID(), photoId = randomUUID();
  const path = `https://gallery.example/v1/sessions/${sessionId}/photos/${photoId}`;
  for (const authorization of ['', 'Bearer', 'Basic ' + device, 'Bearer x', 'Bearer ' + 'x'.repeat(2048),
    `Bearer ${device.slice(0, -1)}x`, `Bearer x${device.slice(1)}`, `Bearer ${device}suffix`]) {
    assert.equal((await instance.dispatchFetch(path, { method: 'PUT', headers: { Authorization: authorization, 'Content-Type': 'image/jpeg' }, body: jpeg })).status, 401);
  }
  assert.equal((await (await instance.getR2Bucket('PHOTOS')).list()).objects.length, 0);
  const headers = { Authorization: `Bearer ${device}`, 'Content-Type': 'image/jpeg' };
  assert.equal((await instance.dispatchFetch(path, { method: 'PUT', headers, body: jpeg })).status, 201);
  const photoIds = [photoId, ...fivePhotos().slice(0, 4)];
  for (const id of photoIds.slice(1)) assert.equal((await instance.dispatchFetch(`https://gallery.example/v1/sessions/${sessionId}/photos/${id}`, { method: 'PUT', headers, body: jpeg })).status, 201);
  const response = await instance.dispatchFetch(`https://gallery.example/v1/sessions/${sessionId}/ready`, {
    method: 'POST', headers, body: JSON.stringify({ photoIds }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as Gallery).status, 'ready');
});

test('native Worker rate-limit binding enforces its budget before repeated gallery lookup', async () => {
  const limits = nativeLimits();
  limits.RATE_GALLERY_GLOBAL!.simple.limit = 1;
  const instance = await createRuntime({}, undefined, limits);
  const url = `${origin}/g/${'a'.repeat(64)}`;
  assert.equal((await instance.dispatchFetch(url)).status, 404);
  const blocked = await instance.dispatchFetch(url);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(blocked.headers.get('Cache-Control'), 'private, no-store');
});


test('legacy manifest replay remains immutable without allowing new partial galleries', async () => {
  const result = await gallery();
  const bucket = await runtime.getR2Bucket('PHOTOS'), key = galleryKey(result.url);
  const saved = await (await bucket.get(key))!.json<Record<string, unknown>>();
  const legacy = [result.photoIds[0]!];
  await bucket.put(key, JSON.stringify({ ...saved, photoIds: legacy }));
  const replay = await ready(result.sessionId, legacy);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as Gallery).expiresAt, result.expiresAt);
  assert.equal((await ready(result.sessionId, result.photoIds)).status, 409);
  assert.equal((await runtime.dispatchFetch(result.url)).status, 200);
  assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${legacy[0]}?download=1`)).status, 200);
  assert.equal((await shareRequest(result.sessionId)).status, 409);
});
