import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

// Only loopback, committed generated fixtures, and local development auth.
// No pairing, real credentials, SMS endpoint or production destination.
const origin = 'http://127.0.0.1:8787';
const auth = {Authorization: 'Bearer local-development-only'};
const session = randomUUID();
const originals = Array.from({length: 4}, () => randomUUID());
const composite = randomUUID();
const fixtures = originals.map((id, i) => [id, readFileSync(`apps/ipad/native-tests/fixtures/studio/studio-portrait-${i + 1}.jpg`)]);
fixtures.push([composite, readFileSync('artifacts/visual/keepsake-clean-portrait-grid-botanical.jpg')]);
const recipe = {photoIds: originals, originalPhotoIds: originals,
  composite: {photoId: composite, layout: 'grid', theme: 'botanical', version: 'wedding-template-v2', gridAspect: 'portrait'}};
let checks = 0;
const equal = (value, expected) => {assert.deepEqual(value, expected); checks++;};
const hash = data => createHash('sha256').update(data).digest('hex');
const ready = (body = recipe) => fetch(`${origin}/v1/sessions/${session}/ready`, {
  method: 'POST', headers: {...auth, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
});
equal(await (await fetch(`${origin}/health`)).json(), {status: 'ok', storage: 'local-r2', sms: 'mock', smsAvailable: false});
equal((await ready()).status, 409);
equal((await fetch(`${origin}/v1/sessions/${session}/photos/${originals[0]}`, {method: 'PUT', body: fixtures[0][1]})).status, 401);
for (const [id, bytes] of fixtures.slice(0, 4)) {
  for (const status of [201, 200]) {
    equal((await fetch(`${origin}/v1/sessions/${session}/photos/${id}`, {
      method: 'PUT', headers: {...auth, 'Content-Type': 'image/jpeg'}, body: bytes,
    })).status, status);
  }
}
equal((await ready()).status, 409); // Four originals are insufficient without the keepsake.
equal((await fetch(`${origin}/v1/sessions/${session}/photos/${composite}`, {
  method: 'PUT', headers: {...auth, 'Content-Type': 'image/jpeg'}, body: fixtures[4][1],
})).status, 201);
const published = await ready();
equal(published.status, 200);
const result = await published.json();
equal(result.status, 'ready');
equal(new URL(result.url).origin, origin);
equal(result.photoIds, originals);
equal(result.originalPhotoIds, originals);
equal(result.composite, recipe.composite);
equal(await (await ready()).json(), result);
equal((await ready({...recipe, composite: {...recipe.composite, gridAspect: 'square'}})).status, 409);
const page = await fetch(result.url);
equal(page.status, 200);
equal(page.headers.get('Cache-Control'), 'private, no-store');
for (const [id, bytes] of fixtures) {
  const download = await fetch(`${result.url}/photos/${id}?download=1`);
  equal(download.status, 200);
  equal(download.headers.get('Content-Disposition')?.startsWith('attachment;'), true);
  equal(hash(new Uint8Array(await download.arrayBuffer())), hash(bytes));
}
equal((await fetch(`${result.url}/photos/${randomUUID()}?download=1`)).status, 404);
equal((await fetch(`${origin}/v1/sessions/${session}/gallery`, {method: 'DELETE', headers: auth})).status, 200);
equal((await fetch(result.url)).status, 410);
for (const [id] of fixtures) equal((await fetch(`${result.url}/photos/${id}?download=1`)).status, 410);
const report = {scope: 'loopback local Worker/R2 only', assertionsPassed: checks,
  selectedOriginals: 4, keepsakes: 1, downloadedFilesWithMatchingSHA256: 5,
  fixtureScope: 'committed synthetic photos and browser-rendered JPEG; no renderer or device claim',
  readinessWaitedForKeepsake: true, immutableV2RecipeReplay: true, revokedAllRoles: true,
  smsEndpointInvoked: false, productionRequests: 0};
writeFileSync('.cache/runtime-checkpoint-four-local.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
