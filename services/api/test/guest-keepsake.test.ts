import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { workerModule, workerSource } from './worker-source';
import type { Env } from '../src/index';

const origin = 'http://localhost';
const linkKey = 'guest-keepsake-synthetic-local-test-signing-key';
const auth = { Authorization: 'Bearer local-development-only' };
const themes = ['classic', 'botanical', 'coastal'] as const;
const art = new Map(themes.map((theme, index) => {
  const name = ['Classic-Ivory', 'Sage-Botanical', 'Coastal-Sea-Glass'][index];
  return [theme, readFileSync(new URL(`../../../design/frame-art-v1/${name}-Text-Free-Artwork.png`, import.meta.url))];
}));
let runtime: Miniflare;
before(async () => {
  runtime = new Miniflare({ modules: true, script: workerSource(), compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'],
    bindings: { MODE: 'local', SMS_MODE: 'mock', LOCAL_DEVICE_TOKEN: 'local-development-only', LOCAL_LINK_KEY: linkKey },
    outboundService: async () => { throw new Error('No external requests are authorized in guest keepsake tests'); },
  });
  await runtime.ready;
  const bucket = await runtime.getR2Bucket('PHOTOS');
  for (const theme of themes) await bucket.put(`system/keepsake-art/v3/${theme}.png`, art.get(theme)!);
});
after(async () => { await runtime?.dispose(); });

function fixture() {
  const selected = Array.from({ length: 4 }, () => randomUUID());
  const originals = Array.from({ length: 4 }, () => randomUUID());
  const composite = { photoId: randomUUID(), layout: 'strip' as 'strip' | 'grid', theme: 'classic' as typeof themes[number],
    version: 'wedding-template-v3', gridAspect: 'square' };
  const recipe = { photoIds: selected, originalPhotoIds: originals, composite };
  const ids = [...selected, ...originals, composite.photoId];
  // Distinct JPEG markers test routing/byte identity, not JPEG compositing quality.
  const bytes = new Map(ids.map((id, index) => [id, new Uint8Array([255, 216, 255, 224, index + 1, 42, 255, 217])]));
  return { sessionId: randomUUID(), recipe, ids, bytes };
}
type Fixture = ReturnType<typeof fixture>;
const guestURL = (sessionId: string) => `${origin}/g/${createHmac('sha256', linkKey).update(`gallery:v1:${sessionId}`).digest('hex')}`;
const manifestKey = (url: string) => `galleries/${createHash('sha256').update(new URL(url).pathname.split('/').at(-1)!).digest('hex')}.json`;
async function publish(value = fixture()) {
  for (const id of value.ids) {
    const response = await runtime.dispatchFetch(`${origin}/v1/sessions/${value.sessionId}/photos/${id}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: value.bytes.get(id)!,
    });
    assert.ok([200, 201].includes(response.status));
  }
  const response = await runtime.dispatchFetch(`${origin}/v1/sessions/${value.sessionId}/ready`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(value.recipe),
  });
  assert.equal(response.status, 200);
  return { ...value, url: (await response.json() as { url: string }).url };
}
async function inventory() {
  const bucket = await runtime.getR2Bucket('PHOTOS');
  const listing = await bucket.list();
  return listing.objects.map(object => ({ key: object.key, etag: object.etag, size: object.size })).sort((a, b) => a.key.localeCompare(b.key));
}
const assets = (url: string) => [`${url}/keepsake.js`, ...themes.map(theme => `${url}/art/${theme}`)];

function privateResponse(response: Response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
}

test('guest editor page and JS use only capability-scoped selected photos and preserve booth download', async () => {
  const value = await publish();
  const response = await runtime.dispatchFetch(value.url), html = await response.text();
  assert.equal(response.status, 200); privateResponse(response);
  assert.match(html, /id="keepsake-editor"/);
  assert.ok(html.includes(`/g/${new URL(value.url).pathname.split('/').at(-1)}/keepsake.js`));
  // Camera originals remain separately downloadable; the editor must receive the
  // selected/look-preserving photo IDs, not use those raw files as fallback.
  const configMatch = html.match(/id="keepsake-editor"[^>]*data-config="([^"]+)"/);
  assert.ok(configMatch, 'Editor config must be escaped inert data, not executable inline JS');
  const config = JSON.parse(configMatch[1]!.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')) as { photoUrls: string[]; version: string; layout: string; theme: string; artUrl?: string };
  const configText = JSON.stringify(config);
  assert.deepEqual(config.photoUrls, value.recipe.photoIds.map(id => `${new URL(value.url).pathname}/photos/${id}`));
  assert.equal(config.version, 'wedding-template-v3'); assert.equal(config.layout, value.recipe.composite.layout);
  assert.equal(config.theme, value.recipe.composite.theme); assert.equal(config.artUrl, `${new URL(value.url).pathname}/art/classic`);
  for (const id of value.recipe.photoIds) assert.ok(configText.includes(`/photos/${id}`));
  for (const id of value.recipe.originalPhotoIds) assert.equal(configText.includes(id), false);
  assert.equal(configText.includes('local-development-only'), false);
  assert.equal(configText.includes(linkKey), false);
  const selectedPositions = value.recipe.photoIds.map(id => configText.indexOf(id));
  assert.deepEqual(selectedPositions, [...selectedPositions].sort((a, b) => a - b));
  const csp = response.headers.get('Content-Security-Policy')!;
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /script-src 'self'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /img-src[^;]*blob:/);
  const js = await runtime.dispatchFetch(`${value.url}/keepsake.js`);
  assert.equal(js.status, 200); privateResponse(js);
  assert.match(js.headers.get('Content-Type')!, /application\/javascript/);
  const source = await js.text();
  assert.ok(source.length > 500);
  assert.equal(source.includes('local-development-only'), false); assert.equal(source.includes(linkKey), false);
  const download = await runtime.dispatchFetch(`${value.url}/photos/${value.recipe.composite.photoId}?download=1`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('Content-Disposition')!, /attachment;.*wedding-keepsake-strip\.jpg/);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), value.bytes.get(value.recipe.composite.photoId));
});

test('all three art responses preserve exact approved PNG bytes and guest asset reads never mutate R2', async () => {
  const values = [];
  for (const theme of themes) { const value = fixture(); value.recipe.composite.theme = theme; values.push(await publish(value)); }
  const before = await inventory();
  for (const value of values) {
    const theme = value.recipe.composite.theme;
    const response = await runtime.dispatchFetch(`${value.url}/art/${theme}`);
    assert.equal(response.status, 200); privateResponse(response);
    assert.match(response.headers.get('Content-Type')!, /image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, art.get(theme));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(art.get(theme)!).digest('hex'));
  }
  for (const value of values) {
    assert.equal((await runtime.dispatchFetch(`${value.url}/keepsake.js`)).status, 200);
    assert.equal((await runtime.dispatchFetch(value.url)).status, 200);
    for (const theme of themes.filter(theme => theme !== value.recipe.composite.theme))
      assert.equal((await runtime.dispatchFetch(`${value.url}/art/${theme}`)).status, 404);
  }
  for (const value of values) for (const url of [`${value.url}/keepsake.js`, `${value.url}/art/${value.recipe.composite.theme}`]) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await runtime.dispatchFetch(url, { method, body: method === 'DELETE' ? undefined : 'not-a-mutation' });
      assert.ok([404, 405].includes(response.status));
    }
  }
  assert.deepEqual(await inventory(), before);
});

test('missing generated art fails truthfully and unsupported theme/path cannot list or read arbitrary keys', async () => {
  const value = await publish(), bucket = await runtime.getR2Bucket('PHOTOS');
  const key = 'system/keepsake-art/v3/classic.png';
  await bucket.delete(key);
  try {
    const response = await runtime.dispatchFetch(`${value.url}/art/classic`);
    assert.equal(response.status, 503); privateResponse(response);
    assert.equal((await runtime.dispatchFetch(`${value.url}/photos/${value.recipe.composite.photoId}`)).status, 200);
  } finally { await bucket.put(key, art.get('classic')!); }
  await bucket.put(key, new Uint8Array([137, 80, 78, 71]));
  try { assert.equal((await runtime.dispatchFetch(`${value.url}/art/classic`)).status, 503); }
  finally { await bucket.put(key, art.get('classic')!); }
  for (const suffix of ['/art', '/art/', '/art/not-a-theme', '/art/CLASSIC', '/art/classic.png', '/art/system/keepsake-art/v3/classic.png', '/art/%2e%2e%2fclassic']) {
    assert.equal((await runtime.dispatchFetch(value.url + suffix)).status, 404, suffix);
  }
  for (const path of ['/system/keepsake-art/v3/classic.png', '/art/classic', '/keepsake.js'])
    assert.equal((await runtime.dispatchFetch(origin + path)).status, 404);
});

test('new script/art routes reject invalid, expired, revoked and forged cross-session capabilities', async () => {
  const missingURL = `${origin}/g/${'f'.repeat(64)}`;
  for (const url of assets(missingURL)) assert.equal((await runtime.dispatchFetch(url)).status, 404);
  for (const url of assets(`${origin}/g/not-a-token`)) assert.equal((await runtime.dispatchFetch(url)).status, 404);
  const expired = await publish(), bucket = await runtime.getR2Bucket('PHOTOS');
  const manifest = await (await bucket.get(manifestKey(expired.url)))!.json<Record<string, unknown>>();
  await bucket.put(manifestKey(expired.url), JSON.stringify({ ...manifest, expiresAt: Date.now() - 1 }));
  for (const url of assets(expired.url)) assert.equal((await runtime.dispatchFetch(url)).status, 410);
  const revoked = await publish();
  assert.equal((await runtime.dispatchFetch(`${origin}/v1/sessions/${revoked.sessionId}/gallery`, { method: 'DELETE', headers: auth })).status, 200);
  for (const url of assets(revoked.url)) assert.equal((await runtime.dispatchFetch(url)).status, 410);
  const first = await publish(), second = await publish();
  const foreignManifest = await (await bucket.get(manifestKey(second.url)))!.text();
  await bucket.put(manifestKey(first.url), foreignManifest);
  for (const url of assets(first.url)) assert.equal((await runtime.dispatchFetch(url)).status, 410);
  assert.equal((await runtime.dispatchFetch(`${second.url}/photos/${first.recipe.photoIds[0]}`)).status, 404);
  const rejected = await runtime.dispatchFetch(`${missingURL}/keepsake.js`);
  assert.doesNotMatch(rejected.headers.get('Content-Security-Policy')!, /script-src 'self'/);
});

test('missing selected derivative returns unavailable without substituting the retained raw original or saved booth JPEG', async () => {
  const value = await publish(), bucket = await runtime.getR2Bucket('PHOTOS');
  const selected = value.recipe.photoIds[0]!, original = value.recipe.originalPhotoIds[0]!;
  await bucket.delete(`sessions/${value.sessionId}/photos/${selected}.jpg`);
  const missing = await runtime.dispatchFetch(`${value.url}/photos/${selected}`);
  assert.equal(missing.status, 404); assert.match(missing.headers.get('Content-Type')!, /application\/json/);
  const raw = await runtime.dispatchFetch(`${value.url}/photos/${original}`);
  assert.equal(raw.status, 200); assert.deepEqual(new Uint8Array(await raw.arrayBuffer()), value.bytes.get(original));
  const keepsake = await runtime.dispatchFetch(`${value.url}/photos/${value.recipe.composite.photoId}`);
  assert.equal(keepsake.status, 200); assert.deepEqual(new Uint8Array(await keepsake.arrayBuffer()), value.bytes.get(value.recipe.composite.photoId));
});

test('legacy v1/v2 four-photo editor needs no generated art and keeps existing downloads', async () => {
  for (const version of ['wedding-template-v1', 'wedding-template-v2']) {
    const value = fixture(); value.recipe.composite.version = version;
    if (version === 'wedding-template-v1') delete (value.recipe.composite as { gridAspect?: string }).gridAspect;
    else value.recipe.composite.gridAspect = 'portrait';
    const published = await publish(value);
    const response = await runtime.dispatchFetch(published.url), html = await response.text();
    assert.equal(response.status, 200); assert.match(html, /id="keepsake-editor"/);
    assert.equal((await runtime.dispatchFetch(`${published.url}/keepsake.js`)).status, 200);
    for (const theme of themes) assert.equal((await runtime.dispatchFetch(`${published.url}/art/${theme}`)).status, 404);
    const download = await runtime.dispatchFetch(`${published.url}/photos/${published.recipe.composite.photoId}?download=1`);
    assert.equal(download.status, 200); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), published.bytes.get(published.recipe.composite.photoId));
  }
});

test('legacy five-photo galleries remain downloadable without an unavailable four-photo editor', async () => {
  const sessionId = randomUUID(), photoIds = Array.from({ length: 5 }, () => randomUUID());
  for (const id of photoIds) {
    const response = await runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${id}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 224, 1, 42, 255, 217]),
    });
    assert.ok([200, 201].includes(response.status));
  }
  assert.equal((await runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/ready`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds }),
  })).status, 200);
  const response = await runtime.dispatchFetch(guestURL(sessionId)), html = await response.text();
  assert.equal(response.status, 200); assert.equal(html.includes('id="keepsake-editor"'), false);
  for (const id of photoIds) assert.equal((await runtime.dispatchFetch(`${guestURL(sessionId)}/photos/${id}?download=1`)).status, 200);
});

test('production asset routes fail closed under rate limits before any R2 access', async () => {
  const worker = (await workerModule()).default;
  const routes = ['/keepsake.js', '/art/classic'];
  for (const suffix of routes) {
    const touches: string[] = [], limits: string[] = [];
    const bucket = new Proxy({}, { get(_target, name) { return async () => { touches.push(String(name)); throw new Error('No R2 access permitted'); }; } });
    const env = { MODE: 'production', SMS_MODE: 'mock', PUBLIC_ORIGIN: 'https://gallery.example',
      DEVICE_TOKEN: 'device-test-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', LINK_SIGNING_KEY: 'signing-test-9876543210-zyxwvutsrqponmlkjihgfedcba', PHOTOS: bucket } as unknown as Env;
    for (const name of ['RATE_GALLERY_GLOBAL', 'RATE_GALLERY_CLIENT', 'RATE_PHOTO_GLOBAL', 'RATE_PHOTO_CLIENT', 'RATE_API_GLOBAL', 'RATE_API_CLIENT', 'RATE_SHARE_GLOBAL', 'RATE_SHARE_CLIENT'] as const)
      env[name] = { async limit() { limits.push(name); return { success: false }; } } as NonNullable<Env[typeof name]>;
    const response = await worker.fetch(new Request(`https://gallery.example/g/${'a'.repeat(64)}${suffix}`), env);
    assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(limits.length, 1); assert.deepEqual(touches, []);
    for (const name of ['RATE_GALLERY_GLOBAL', 'RATE_GALLERY_CLIENT', 'RATE_PHOTO_GLOBAL', 'RATE_PHOTO_CLIENT', 'RATE_API_GLOBAL', 'RATE_API_CLIENT', 'RATE_SHARE_GLOBAL', 'RATE_SHARE_CLIENT'] as const) delete env[name];
    limits.length = 0;
    assert.equal((await worker.fetch(new Request(`https://gallery.example/g/${'a'.repeat(64)}${suffix}`), env)).status, 503);
    assert.deepEqual(limits, []); assert.deepEqual(touches, []);
  }
});
