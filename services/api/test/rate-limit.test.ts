import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../src/index';
import { workerModule } from './worker-source';
const { default: worker } = await workerModule();

const names = ['RATE_GALLERY_GLOBAL', 'RATE_GALLERY_CLIENT', 'RATE_PHOTO_GLOBAL', 'RATE_PHOTO_CLIENT',
  'RATE_API_GLOBAL', 'RATE_API_CLIENT', 'RATE_SHARE_GLOBAL', 'RATE_SHARE_CLIENT'] as const;
type Name = typeof names[number];
type Call = { name: Name; key: string };
const token = 'a'.repeat(64);
const galleryPath = `/g/${token}`;
const photoId = '11111111-1111-4111-8111-111111111111';
const production = {
  MODE: 'production', SMS_MODE: 'mock', PUBLIC_ORIGIN: 'https://gallery.example',
  DEVICE_TOKEN: 'device-test-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  LINK_SIGNING_KEY: 'signing-test-9876543210-zyxwvutsrqponmlkjihgfedcba',
};

// Exercise the actual fetch handler with a bucket that fails on every operation.
// These tests stop at the protection gate, so any storage access is a test failure
// independent of whether a storage implementation happened to return no object.
// Native limiter behavior and auth crypto are tested separately in workerd.
function probe(outcome: (call: Call, number: number) => unknown = () => ({ success: true })) {
  const touches: string[] = [], calls: Call[] = [];
  const bucket = new Proxy({}, {
    get(_target, method) {
      return async () => { touches.push(String(method)); throw new Error('R2 must not be reached'); };
    },
  });
  const env = { ...production, PHOTOS: bucket } as unknown as Env;
  for (const name of names) {
    env[name] = { async limit({ key }: { key: string }) {
      const call = { name, key }; calls.push(call);
      return outcome(call, calls.length);
    } } as NonNullable<Env[Name]>;
  }
  return { env, touches, calls };
}
function request(path = galleryPath, headers: Record<string, string> = {}, edge = false, method = 'GET') {
  const result = new Request(`${production.PUBLIC_ORIGIN}${path}`, { method, headers });
  if (edge) Object.defineProperty(result, 'cf', { value: { colo: 'TEST' } });
  return result;
}
async function blocked(state: ReturnType<typeof probe>, path = galleryPath, status = 503) {
  const response = await worker.fetch(request(path), state.env);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.deepEqual(state.touches, []);
  return response;
}

test('production requires every limiter binding before lookup, including health configuration checks', async () => {
  for (const omitted of [undefined, ...names]) {
    const state = probe();
    for (const name of omitted ? [omitted] : names) delete state.env[name];
    await blocked(state);
    await blocked(state, '/health');
    assert.deepEqual(state.calls, [], 'partial configuration must not consume a partial policy');
  }
  const valid = probe();
  assert.equal((await worker.fetch(request('/health'), valid.env)).status, 200);
  assert.equal((await worker.fetch(request('/unknown'), valid.env)).status, 404);
  assert.deepEqual(valid.calls, []);
  assert.deepEqual(valid.touches, []);
});

test('throwing or malformed limiter responses fail closed before R2 at every protection stage', async () => {
  for (const stage of [1, 2, 3]) {
    for (const bad of [undefined, null, {}, { success: 'true' }, { success: 1 }, new Error('Limiter unavailable')]) {
      const state = probe((_call, number) => {
        if (number !== stage) return { success: true };
        if (bad instanceof Error) throw bad;
        return bad;
      });
      await blocked(state);
      assert.equal(state.calls.length, stage);
    }
  }
  const malformed = probe();
  malformed.env.RATE_GALLERY_GLOBAL = { limit: null } as unknown as NonNullable<Env[Name]>;
  await blocked(malformed);
  assert.deepEqual(malformed.calls, []);
});

test('denied global, IP or gallery budgets stop immediately with retry guidance and zero storage operations', async () => {
  for (const stage of [1, 2, 3]) {
    const state = probe((_call, number) => ({ success: number !== stage }));
    const response = await blocked(state, galleryPath, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.match(response.headers.get('Content-Type')!, /text\/html/);
    assert.equal(state.calls.length, stage);
  }
});

test('gallery, photo, API and share routes consume their own policy before auth, body parsing or lookup', async () => {
  const routes = [
    { path: galleryPath, band: 'GALLERY', method: 'GET', stages: 3 },
    { path: `${galleryPath}/photos/${photoId}?download=1`, band: 'PHOTO', method: 'GET', stages: 3 },
    { path: `/v1/sessions/${photoId}/photos/${photoId}`, band: 'API', method: 'PUT', stages: 2 },
    { path: `/v1/sessions/${photoId}/ready`, band: 'API', method: 'POST', stages: 2 },
    { path: `/v1/sessions/${photoId}/gallery`, band: 'API', method: 'DELETE', stages: 2 },
    { path: '/v1/shares', band: 'SHARE', method: 'POST', stages: 2 },
  ];
  for (const route of routes) {
    const state = probe((_call, number) => ({ success: number !== route.stages }));
    const response = await worker.fetch(request(route.path, {}, false, route.method), state.env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.deepEqual(state.calls.map(call => call.name), [
      `RATE_${route.band}_GLOBAL`, ...Array(route.stages - 1).fill(`RATE_${route.band}_CLIENT`),
    ]);
    for (const call of state.calls) {
      assert.ok(!call.key.includes(token));
      assert.ok(!call.key.includes(photoId));
      assert.ok(!call.key.includes('https://'));
    }
    assert.deepEqual(state.touches, []);
  }
});

async function clientKeys(headers: Record<string, string>, edge: boolean, path = galleryPath) {
  const state = probe((_call, number) => ({ success: number < 3 }));
  assert.equal((await worker.fetch(request(path, headers, edge), state.env)).status, 429);
  assert.deepEqual(state.touches, []);
  return state.calls;
}

test('untrusted IP headers cannot rotate anonymous budgets; only platform CF identity selects a client bucket', async () => {
  const absent = await clientKeys({}, false);
  for (const headers of [{ 'CF-Connecting-IP': '203.0.113.1' }, { 'CF-Connecting-IP': '203.0.113.2' },
    { 'X-Forwarded-For': '203.0.113.3', 'X-Real-IP': '203.0.113.4' }]) {
    assert.deepEqual(await clientKeys(headers, false), absent);
  }
  assert.deepEqual(await clientKeys({ 'X-Forwarded-For': '203.0.113.3' }, true), absent);
  assert.deepEqual(await clientKeys({ 'CF-Connecting-IP': 'not-an-address' }, true), absent);
  const first = await clientKeys({ 'CF-Connecting-IP': '203.0.113.1' }, true);
  const repeated = await clientKeys({ 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '203.0.113.99' }, true);
  const second = await clientKeys({ 'CF-Connecting-IP': '203.0.113.2' }, true);
  assert.deepEqual(first, repeated);
  assert.notEqual(first[1]!.key, absent[1]!.key);
  assert.notEqual(first[1]!.key, second[1]!.key);
  assert.equal(first[0]!.key, second[0]!.key, 'rotating addresses must still consume the same route-wide budget');
  assert.equal(first[2]!.key, second[2]!.key, 'one gallery must retain its gallery budget across client addresses');
  for (const call of [...first, ...second]) assert.ok(!call.key.includes('203.0.113.'));
});

test('rotating gallery tokens preserves route/IP budgets while gallery keys remain opaque', async () => {
  const headers = { 'CF-Connecting-IP': '2001:db8::1' };
  const first = await clientKeys(headers, true);
  const nextToken = 'b'.repeat(64);
  const second = await clientKeys(headers, true, `/g/${nextToken}`);
  assert.equal(first[0]!.key, second[0]!.key);
  assert.equal(first[1]!.key, second[1]!.key);
  assert.notEqual(first[2]!.key, second[2]!.key);
  assert.ok(!second[2]!.key.includes(nextToken));
});

test('loopback-only tests can omit all limiters, while a partially configured local policy fails closed', async () => {
  const state = probe();
  Object.assign(state.env, { MODE: 'local', LOCAL_DEVICE_TOKEN: 'local-development-only', LOCAL_LINK_KEY: 'local-test-key' });
  for (const name of names) delete state.env[name];
  assert.equal((await worker.fetch(new Request('http://localhost/health'), state.env)).status, 200);
  state.env.RATE_API_GLOBAL = { async limit() { return { success: true }; } };
  const response = await worker.fetch(new Request('http://localhost/health'), state.env);
  assert.equal(response.status, 503);
  assert.deepEqual(state.touches, []);
});


test('bearer verification passes fixed-width digests to native equality for missing, malformed and valid headers', async () => {
  // Observe the real handler's crypto call without reimplementing its digest or
  // auth logic. Node's native equality supplies the Workers-specific method for
  // this call-shape test; the separate workerd test uses actual Workers crypto.
  // Neither test claims to measure or prove execution-time behavior.
  const original = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  const widths: number[][] = [];
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: (left: ArrayBuffer, right: ArrayBuffer) => {
    widths.push([left.byteLength, right.byteLength]);
    return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
  } });
  try {
    const state = probe();
    const expected = `Bearer ${production.DEVICE_TOKEN}`;
    for (const authorization of ['', 'Bearer', 'Basic invalid', 'Bearer x', 'Bearer ' + 'x'.repeat(2048), expected]) {
      const response = await worker.fetch(request('/v1/unknown', { Authorization: authorization }), state.env);
      assert.equal(response.status, authorization === expected ? 404 : 401);
    }
    assert.deepEqual(widths, Array.from({ length: 6 }, () => [32, 32]));
    assert.deepEqual(state.touches, []);
  } finally {
    if (original) Object.defineProperty(crypto.subtle, 'timingSafeEqual', original);
    else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  }
});
