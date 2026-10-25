import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This smoke runner intentionally targets only the local emulator. It cannot send
// an actual text message or operate against production by changing an env var.
const origin = 'http://127.0.0.1:8787';
const headers = { Authorization: 'Bearer local-development-only' };
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
assert.deepEqual(await (await fetch(`${origin}/health`)).json(), {
  status: 'ok', storage: 'local-r2', sms: 'mock',
});
const sessionId = randomUUID(), photoId = randomUUID(), shareId = randomUUID();
const ready = () => fetch(`${origin}/v1/sessions/${sessionId}/ready`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ photoIds: [photoId] }),
});
assert.equal((await ready()).status, 409);
assert.equal((await fetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, { method: 'PUT', body: jpeg })).status, 401);
for (const expected of [201, 200]) {
  const upload = await fetch(`${origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: jpeg,
  });
  assert.equal(upload.status, expected);
}
const completed = await ready();
assert.equal(completed.status, 200);
const result = await completed.json();
assert.equal(result.status, 'ready');
assert.ok(result.expiresAt > Date.now());
assert.equal(new URL(result.url).origin, origin);
assert.match(new URL(result.url).pathname, /^\/g\/[a-f0-9]{64}$/);
const replay = await ready();
assert.deepEqual(await replay.json(), result);
const page = await fetch(result.url);
assert.equal(page.status, 200);
assert.match(page.headers.get('Content-Type'), /text\/html/);
assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
assert.ok((await page.text()).includes(`/photos/${photoId}`));
const photo = await fetch(`${result.url}/photos/${photoId}?download=1`);
assert.equal(photo.status, 200);
assert.match(photo.headers.get('Content-Disposition'), /^attachment;/);
assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), jpeg);
assert.equal((await fetch(`${result.url}/photos/${randomUUID()}`)).status, 404);
const share = consent => fetch(`${origin}/v1/shares`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: shareId, sessionId, phone: '+12025550123', consent }),
});
assert.equal((await share(false)).status, 400);
const shared = await share(true);
assert.equal(shared.status, 200);
const outcome = await shared.json();
assert.equal(outcome.status, 'mocked');
assert.equal(outcome.message, 'No text message was sent');
assert.equal(outcome.url, result.url);
assert.deepEqual(await (await share(true)).json(), outcome);
assert.equal((await fetch(`${origin}/photos/${photoId}.jpg`)).status, 404);
const revoked = await fetch(`${origin}/v1/sessions/${sessionId}/gallery`, { method: 'DELETE', headers });
assert.equal(revoked.status, 200);
assert.equal((await fetch(result.url)).status, 410);
assert.equal((await fetch(`${result.url}/photos/${photoId}?download=1`)).status, 410);
assert.equal((await ready()).status, 410);
console.log('PASS: local authenticated immutable upload/replay, readiness, scoped private gallery/download, consent, mock sharing, and revocation. No SMS sent.');
