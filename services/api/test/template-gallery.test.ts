import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare } from 'miniflare';

const origin = 'http://localhost';
const linkKey = 'template-local-test-key';
const auth = { Authorization: 'Bearer local-development-only' };
type Composite = { photoId: string; layout: 'strip' | 'grid'; theme: 'classic' | 'botanical' | 'coastal' } & ({ version: 'wedding-template-v1' } | { version: 'wedding-template-v2'; gridAspect: 'portrait' | 'square' } | { version: 'wedding-template-v3'; gridAspect: 'square' });
type Recipe = { photoIds: string[]; originalPhotoIds: string[]; composite: Composite };
type Ready = Recipe & { status: 'ready'; url: string; expiresAt: number };
let runtime: Miniflare;
before(async () => {
  runtime = new Miniflare({ modules: true, script: stripTypeScriptTypes(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')),
    compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'],
    bindings: { MODE: 'local', SMS_MODE: 'mock', LOCAL_DEVICE_TOKEN: 'local-development-only', LOCAL_LINK_KEY: linkKey },
    outboundService: async () => { throw new Error('External requests are forbidden in template tests'); },
  });
  await runtime.ready;
});
after(async () => { await runtime?.dispose(); });
function fixture(overlap = false) {
  const originalPhotoIds = Array.from({ length: 4 }, () => randomUUID());
  const photoIds = overlap ? [...originalPhotoIds] : Array.from({ length: 4 }, () => randomUUID());
  const recipe: Recipe = { photoIds, originalPhotoIds, composite: { photoId: randomUUID(), layout: 'strip', theme: 'classic', version: 'wedding-template-v1' } };
  const allIds = [...new Set([...photoIds, ...originalPhotoIds, recipe.composite.photoId])];
  // Distinct tiny marker fixtures verify byte identity; they do not claim JPEG
  // decoding or native renderer/compositor quality.
  const bytes = new Map(allIds.map((id, index) => [id, new Uint8Array([255, 216, 255, 224, index + 1, 42, 255, 217])]));
  return { sessionId: randomUUID(), recipe, allIds, bytes };
}
type Fixture = ReturnType<typeof fixture>;
const put = (sessionId: string, photoId: string, bytes: Uint8Array) => runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
  method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: bytes,
});
async function upload(value: Fixture, ids = value.allIds, sessionId = value.sessionId) {
  for (const id of ids) assert.ok([200, 201].includes((await put(sessionId, id, value.bytes.get(id)!)).status));
}
const ready = (sessionId: string, body: unknown) => runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/ready`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const guestUrl = (sessionId: string) => `${origin}/g/${createHmac('sha256', linkKey).update(`gallery:v1:${sessionId}`).digest('hex')}`;
const manifestKey = (url: string) => `galleries/${createHash('sha256').update(new URL(url).pathname.split('/').at(-1)!).digest('hex')}.json`;
async function publish(value: Fixture): Promise<Ready> {
  await upload(value);
  const response = await ready(value.sessionId, value.recipe);
  assert.equal(response.status, 200);
  return await response.json() as Ready;
}

test('new four-photo galleries reject incomplete recipes, bad counts, duplicates, unknown fields and unsafe metadata', async () => {
  const value = fixture(), recipe = value.recipe;
  const invalid: unknown[] = [
    { photoIds: recipe.photoIds }, { photoIds: recipe.photoIds.slice(0, 3) }, { photoIds: [...recipe.photoIds, randomUUID(), randomUUID()] },
    { ...recipe, unexpected: true }, { ...recipe, originalPhotoIds: recipe.originalPhotoIds.slice(0, 3) },
    { ...recipe, photoIds: [recipe.photoIds[0], recipe.photoIds[0]!.toUpperCase(), ...recipe.photoIds.slice(2)] },
    { ...recipe, originalPhotoIds: [recipe.originalPhotoIds[0], recipe.originalPhotoIds[0], ...recipe.originalPhotoIds.slice(2)] },
    { ...recipe, originalPhotoIds: null }, { ...recipe, composite: null }, { photoIds: recipe.photoIds, composite: recipe.composite },
    { photoIds: recipe.photoIds, originalPhotoIds: recipe.originalPhotoIds },
    { ...recipe, composite: { ...recipe.composite, photoId: recipe.photoIds[0] } },
    { ...recipe, composite: { ...recipe.composite, photoId: recipe.originalPhotoIds[0] } },
    { ...recipe, originalPhotoIds: ['not-a-uuid', ...recipe.originalPhotoIds.slice(1)] },
    { ...recipe, composite: { ...recipe.composite, photoId: 'not-a-uuid' } },
    ...['layout', 'theme', 'version'].map(field => ({ ...recipe, composite: { ...recipe.composite, [field]: '<script>alert(1)</script>' } })),
    { ...recipe, composite: { ...recipe.composite, extra: 'no' } },
  ];
  for (const body of invalid) assert.equal((await ready(value.sessionId, body)).status, 400);
  assert.equal((await runtime.dispatchFetch(guestUrl(value.sessionId))).status, 404);
  assert.equal(await (await runtime.getR2Bucket('PHOTOS')).head(manifestKey(guestUrl(value.sessionId))), null);
});

test('publication waits for selected photos, corresponding originals and the composite in the same session', async () => {
  const value = fixture(), url = guestUrl(value.sessionId);
  assert.equal((await ready(value.sessionId, value.recipe)).status, 409);
  await upload(value, value.recipe.photoIds);
  assert.equal((await ready(value.sessionId, value.recipe)).status, 409);
  assert.equal((await runtime.dispatchFetch(url)).status, 404);
  await upload(value, value.recipe.originalPhotoIds);
  assert.equal((await ready(value.sessionId, value.recipe)).status, 409);
  assert.equal((await runtime.dispatchFetch(`${url}/photos/${value.recipe.composite.photoId}?download=1`)).status, 404);
  // An object with the same UUID under another session cannot satisfy readiness.
  await upload(value, [value.recipe.composite.photoId], randomUUID());
  assert.equal((await ready(value.sessionId, value.recipe)).status, 409);
  await upload(value, [value.recipe.composite.photoId]);
  const response = await ready(value.sessionId, value.recipe);
  assert.equal(response.status, 200);
  const result = await response.json() as Ready;
  assert.deepEqual(result, { status: 'ready', url, expiresAt: result.expiresAt, ...value.recipe });
  assert.ok(result.expiresAt > Date.now());
});

test('cross-session selected/original UUIDs cannot be imported into a gallery without their own session upload', async () => {
  for (const missing of ['selected', 'original'] as const) {
    const value = fixture(), foreignId = missing === 'selected' ? value.recipe.photoIds[0]! : value.recipe.originalPhotoIds[0]!;
    await upload(value, value.allIds.filter(id => id !== foreignId));
    await upload(value, [foreignId], randomUUID());
    assert.equal((await ready(value.sessionId, value.recipe)).status, 409);
    assert.equal((await runtime.dispatchFetch(guestUrl(value.sessionId))).status, 404);
  }
});

test('stored recipe and every role/order/layout are immutable; replay echoes the exact normalized winning descriptor', async () => {
  const value = fixture(), result = await publish(value);
  const replay = await (await ready(value.sessionId, { ...value.recipe, composite: { version: 'wedding-template-v1', theme: 'classic', layout: 'strip', photoId: value.recipe.composite.photoId } })).json();
  assert.deepEqual(replay, result);
  const capitalized = { photoIds: value.recipe.photoIds.map(id => id.toUpperCase()), originalPhotoIds: value.recipe.originalPhotoIds.map(id => id.toUpperCase()), composite: { ...value.recipe.composite, photoId: value.recipe.composite.photoId.toUpperCase() } };
  assert.deepEqual(await (await ready(value.sessionId, capitalized)).json(), result);
  const replacement = randomUUID(); await put(value.sessionId, replacement, value.bytes.get(value.recipe.composite.photoId)!);
  const mutations = [
    { ...value.recipe, photoIds: [...value.recipe.photoIds].reverse() },
    { ...value.recipe, originalPhotoIds: [...value.recipe.originalPhotoIds].reverse() },
    { ...value.recipe, photoIds: value.recipe.originalPhotoIds, originalPhotoIds: value.recipe.photoIds },
    { ...value.recipe, composite: { ...value.recipe.composite, photoId: replacement } },
    { ...value.recipe, composite: { ...value.recipe.composite, layout: 'grid' } },
    { ...value.recipe, composite: { ...value.recipe.composite, theme: 'coastal' } },
    { photoIds: value.recipe.photoIds },
  ];
  for (const body of mutations) assert.equal((await ready(value.sessionId, body)).status, 409);
  assert.equal((await ready(value.sessionId, { ...value.recipe, composite: { ...value.recipe.composite, version: 'wedding-template-v2' } })).status, 400);
  assert.deepEqual(await (await ready(value.sessionId, value.recipe)).json(), result);
  const saved = await (await (await runtime.getR2Bucket('PHOTOS')).get(manifestKey(result.url)))!.json<Record<string, unknown>>();
  assert.deepEqual(saved.photoIds, value.recipe.photoIds); assert.deepEqual(saved.originalPhotoIds, value.recipe.originalPhotoIds); assert.deepEqual(saved.composite, value.recipe.composite);
  assert.ok(!JSON.stringify(saved).includes(new URL(result.url).pathname.split('/').at(-1)!));
});

test('racing different template recipes publishes one immutable winner and echoes only that winner', async () => {
  const value = fixture(); await upload(value);
  const other = { ...value.recipe, composite: { ...value.recipe.composite, theme: 'botanical' } };
  const responses = await Promise.all([ready(value.sessionId, value.recipe), ready(value.sessionId, other)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = await responses.find(response => response.status === 200)!.json() as Ready;
  const recipe = winner.composite.theme === 'classic' ? value.recipe : other;
  assert.deepEqual(await (await ready(value.sessionId, recipe)).json(), winner);
});

test('a private template page scopes composite, selected photos and camera originals; all downloads retain exact uploaded bytes', async () => {
  const value = fixture(), result = await publish(value), other = fixture(); await upload(other);
  const orphan = randomUUID(); await put(value.sessionId, orphan, value.bytes.get(value.recipe.photoIds[0]!)!);
  const page = await runtime.dispatchFetch(result.url), html = await page.text();
  assert.equal(page.status, 200); assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer'); assert.match(page.headers.get('Content-Security-Policy')!, /default-src 'none'/);
  assert.ok(html.includes('Gizelle &amp; Rami · November 1, 2026')); assert.ok(html.includes('Your wedding keepsake'));
  assert.ok(html.includes('Save photo strip')); assert.ok(html.includes('Your individual photos')); assert.ok(html.includes('Your camera originals'));
  assert.ok(html.indexOf('Your wedding keepsake') < html.indexOf('Your individual photos'));
  assert.equal((html.match(/aria-label="Download camera original \d in full resolution"/g) ?? []).length, 4);
  assert.ok(html.includes(`<time datetime="${new Date(result.expiresAt).toISOString()}">`));
  assert.ok(!html.includes(orphan)); assert.ok(!html.includes(other.recipe.composite.photoId)); assert.ok(!html.includes('https://')); assert.ok(!html.includes('<script'));
  for (const id of value.allIds) {
    assert.ok(html.includes(`/photos/${id}`));
    const response = await runtime.dispatchFetch(`${result.url}/photos/${id}?download=1`);
    assert.equal(response.status, 200); assert.match(response.headers.get('Content-Disposition')!, /^attachment;/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), value.bytes.get(id));
  }
  for (const id of [orphan, other.recipe.photoIds[0]!, other.recipe.originalPhotoIds[0]!, other.recipe.composite.photoId])
    assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${id}`)).status, 404);
  for (const path of ['/g', '/g/', '/photos', `/sessions/${value.sessionId}/photos`, `/v1/sessions/${value.sessionId}/photos`])
    assert.equal((await runtime.dispatchFetch(origin + path, { headers: auth })).status, 404);
});

test('all curated layout/theme combinations work and overlapping selected/original IDs need only one stored object each', async () => {
  for (const layout of ['strip', 'grid'] as const) for (const theme of ['classic', 'botanical', 'coastal'] as const) {
    const value = fixture(true); value.recipe.composite.layout = layout; value.recipe.composite.theme = theme;
    const result = await publish(value);
    const bucket = await runtime.getR2Bucket('PHOTOS');
    assert.equal((await bucket.list({ prefix: `sessions/${value.sessionId}/photos/` })).objects.length, 5);
    const html = await (await runtime.dispatchFetch(result.url)).text();
    assert.ok(html.includes(`Save photo ${layout}`)); assert.ok(html.includes(`Your ${theme} wedding photo ${layout}`));
    assert.deepEqual(await (await ready(value.sessionId, value.recipe)).json(), result);
  }
});

test('mock SMS uses the complete four-photo template URL and expiry/revocation close every role without deleting originals', async () => {
  const value = fixture(), result = await publish(value);
  const share = () => runtime.dispatchFetch(`${origin}/v1/shares`, { method: 'POST', headers: auth,
    body: JSON.stringify({ id: randomUUID(), sessionId: value.sessionId, phone: '+12025550123', consent: true }),
  });
  const shared = await (await share()).json() as { status: string; url: string; expiresAt: number };
  assert.equal(shared.status, 'mocked'); assert.equal(shared.url, result.url); assert.equal(shared.expiresAt, result.expiresAt);
  const revoke = await runtime.dispatchFetch(`${origin}/v1/sessions/${value.sessionId}/gallery`, { method: 'DELETE', headers: auth }); assert.equal(revoke.status, 200);
  assert.equal((await runtime.dispatchFetch(result.url)).status, 410); assert.equal((await ready(value.sessionId, value.recipe)).status, 410); assert.equal((await share()).status, 410);
  for (const id of value.allIds) {
    assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${id}?download=1`)).status, 410);
    assert.ok(await (await runtime.getR2Bucket('PHOTOS')).head(`sessions/${value.sessionId}/photos/${id}.jpg`));
  }
  const expired = fixture(), expiredResult = await publish(expired), bucket = await runtime.getR2Bucket('PHOTOS');
  const manifest = await (await bucket.get(manifestKey(expiredResult.url)))!.json<Record<string, unknown>>();
  await bucket.put(manifestKey(expiredResult.url), JSON.stringify({ ...manifest, expiresAt: Date.now() - 1 }));
  for (const id of expired.allIds) assert.equal((await runtime.dispatchFetch(`${expiredResult.url}/photos/${id}?download=1`)).status, 410);
  assert.equal((await runtime.dispatchFetch(expiredResult.url)).status, 410); assert.equal((await ready(expired.sessionId, expired.recipe)).status, 410);
});


test('v2 descriptors require a strict explicit aspect even for strips; v1 retains exactly its original fields', async () => {
  const value = fixture();
  const invalid = [
    { ...value.recipe.composite, version: 'wedding-template-v2' },
    ...['wide', '', null, 1].map(gridAspect => ({ ...value.recipe.composite, version: 'wedding-template-v2', gridAspect })),
    { ...value.recipe.composite, gridAspect: 'portrait' },
    { ...value.recipe.composite, version: 'wedding-template-v2', gridAspect: 'square', extra: true },
    { ...value.recipe.composite, version: 'wedding-template-v3', gridAspect: 'portrait' },
  ];
  for (const layout of ['strip', 'grid']) for (const composite of invalid)
    assert.equal((await ready(value.sessionId, { ...value.recipe, composite: { ...composite, layout } })).status, 400);
  assert.equal((await runtime.dispatchFetch(guestUrl(value.sessionId))).status, 404);
  const legacy = await publish(value);
  assert.deepEqual(legacy.composite, value.recipe.composite);
  assert.equal(Object.hasOwn(legacy.composite, 'gridAspect'), false);
  assert.equal((await ready(value.sessionId, { ...value.recipe, composite: { ...value.recipe.composite, version: 'wedding-template-v2', gridAspect: 'square' } })).status, 409);
});

test('v2 strip/grid portrait/square aspects persist exactly and cannot drift across ready replay or version changes', async () => {
  for (const layout of ['strip', 'grid'] as const) for (const gridAspect of ['portrait', 'square'] as const) {
    const value = fixture(); value.recipe.composite = { ...value.recipe.composite, version: 'wedding-template-v2', layout, gridAspect };
    const result = await publish(value);
    assert.deepEqual(result.composite, value.recipe.composite);
    assert.deepEqual(await (await ready(value.sessionId, value.recipe)).json(), result);
    const changed = { ...value.recipe, composite: { ...value.recipe.composite, gridAspect: gridAspect === 'portrait' ? 'square' : 'portrait' } };
    assert.equal((await ready(value.sessionId, changed)).status, 409);
    const v1 = { ...value.recipe, composite: { photoId: value.recipe.composite.photoId, layout, theme: value.recipe.composite.theme, version: 'wedding-template-v1' } };
    assert.equal((await ready(value.sessionId, v1)).status, 409);
    const saved = await (await (await runtime.getR2Bucket('PHOTOS')).get(manifestKey(result.url)))!.json<{ composite: Composite }>();
    assert.deepEqual(saved.composite, value.recipe.composite);
    for (const id of value.allIds) {
      const response = await runtime.dispatchFetch(`${result.url}/photos/${id}?download=1`);
      assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), value.bytes.get(id));
    }
  }
});

test('racing v2 aspects preserves one immutable winner and revocation closes every selected/raw/composite role', async () => {
  const value = fixture(); value.recipe.composite = { ...value.recipe.composite, version: 'wedding-template-v2', layout: 'grid', gridAspect: 'portrait' };
  await upload(value);
  const other = { ...value.recipe, composite: { ...value.recipe.composite, gridAspect: 'square' } };
  const responses = await Promise.all([ready(value.sessionId, value.recipe), ready(value.sessionId, other)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const result = await responses.find(response => response.status === 200)!.json() as Ready;
  assert.equal(result.composite.version, 'wedding-template-v2');
  const winner = result.composite.version === 'wedding-template-v2' && result.composite.gridAspect === 'portrait' ? value.recipe : other;
  assert.deepEqual(await (await ready(value.sessionId, winner)).json(), result);
  assert.equal((await runtime.dispatchFetch(`${origin}/v1/sessions/${value.sessionId}/gallery`, { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await runtime.dispatchFetch(result.url)).status, 410);
  for (const id of value.allIds) assert.equal((await runtime.dispatchFetch(`${result.url}/photos/${id}?download=1`)).status, 410);
});

test('v3 artwork strip/grid exact-square metadata persists and cannot be reinterpreted as legacy artwork', async () => {
  for (const layout of ['strip', 'grid'] as const) {
    const value = fixture(); value.recipe.composite = { ...value.recipe.composite, version: 'wedding-template-v3', layout, gridAspect: 'square' };
    const result = await publish(value);
    assert.deepEqual(result.composite, value.recipe.composite);
    assert.deepEqual(await (await ready(value.sessionId, value.recipe)).json(), result);
    assert.equal((await ready(value.sessionId, { ...value.recipe, composite: { ...value.recipe.composite, gridAspect: 'portrait' } })).status, 400);
    assert.equal((await ready(value.sessionId, { ...value.recipe, composite: { ...value.recipe.composite, version: 'wedding-template-v2' } })).status, 409);
    const saved = await (await (await runtime.getR2Bucket('PHOTOS')).get(manifestKey(result.url)))!.json<{ composite: Composite }>();
    assert.deepEqual(saved.composite, value.recipe.composite);
  }
});
