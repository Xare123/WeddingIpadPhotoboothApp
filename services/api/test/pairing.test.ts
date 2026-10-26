import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare } from 'miniflare';
import worker, { type Env } from '../src/index';

const device = 'local-development-only';
const origin = 'http://localhost';
const runtimes: Miniflare[] = [], dirs: string[] = [];
const base = { MODE: 'local', SMS_MODE: 'mock', LOCAL_DEVICE_TOKEN: device, LOCAL_LINK_KEY: 'pairing-local-test-key', PAIRING_ENABLED: 'approved' };
const options = (bindings = {}, r2Persist?: string) => ({ modules: true, script: stripTypeScriptTypes(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')),
  compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'], r2Persist, bindings: { ...base, ...bindings } });
async function runtime(bindings = {}, path?: string) { const mf = new Miniflare(options(bindings, path)); runtimes.push(mf); await mf.ready; return mf; }
after(async () => { await Promise.all(runtimes.map(mf => mf.dispose())); for (const path of dirs) rmSync(path, { recursive: true, force: true }); });
const post = (mf: Miniflare, path: string, body: unknown, token?: string) => mf.dispatchFetch(`${origin}/v1/pairing/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body),
});
type Issued = { code: string; expiresAt: number; origin: string };
async function issue(mf: Miniflare, id = randomUUID()) { const response = await post(mf, 'codes', { id }, device); assert.equal(response.status, 200); return { id, ...await response.json() as Issued }; }
const key = (code: string) => `pairing/${createHash('sha256').update(code).digest('hex')}.json`;

test('pairing defaults disabled and unauthenticated callers cannot issue codes', async () => {
  const disabled = await runtime({ PAIRING_ENABLED: 'disabled' });
  assert.equal((await post(disabled, 'codes', { id: randomUUID() }, device)).status, 503);
  assert.equal((await post(disabled, 'consume', { code: 'a'.repeat(64) })).status, 503);
  const enabled = await runtime();
  for (const token of [undefined, 'incorrect', `${device}suffix`]) assert.equal((await post(enabled, 'codes', { id: randomUUID() }, token)).status, 401);
  assert.equal((await (await enabled.getR2Bucket('PHOTOS')).list()).objects.length, 0);
  for (const code of ['123456', 'A'.repeat(64), 'a'.repeat(65), null]) assert.equal((await post(enabled, 'consume', { code })).status, 400);
  assert.equal((await post(enabled, 'consume', { code: 'f'.repeat(64) })).status, 404);
  assert.equal((await post(enabled, 'consume', { code: 'a'.repeat(64), extra: 'x'.repeat(1024) })).status, 413);
});

test('issued codes are purpose-separated, short-lived, hashed at rest and issuance replay never extends expiry', async () => {
  const mf = await runtime(), issued = await issue(mf);
  assert.match(issued.code, /^[a-f0-9]{64}$/);
  assert.equal(issued.origin, origin);
  assert.ok(issued.expiresAt > Date.now() && issued.expiresAt <= Date.now() + 300_000);
  const replay = await (await post(mf, 'codes', { id: issued.id }, device)).json() as Issued;
  assert.equal(replay.code, issued.code); assert.equal(replay.expiresAt, issued.expiresAt);
  const bucket = await mf.getR2Bucket('PHOTOS');
  const saved = await (await bucket.get(key(issued.code)))!.text();
  assert.ok(!saved.includes(issued.code)); assert.ok(!saved.includes(device)); assert.ok(!saved.includes(base.LOCAL_LINK_KEY));
  const gallery = await mf.dispatchFetch(`${origin}/g/${issued.code}`); assert.equal(gallery.status, 404);
  assert.equal((await post(mf, 'consume', { code: issued.code.slice(0, -1) + (issued.code.endsWith('a') ? 'b' : 'a') })).status, 404);
});

test('one-use CAS permits exactly one concurrent claim and never replays credentials after response loss', async () => {
  const mf = await runtime(), issued = await issue(mf);
  const claims = await Promise.all([post(mf, 'consume', { code: issued.code }), post(mf, 'consume', { code: issued.code })]);
  assert.deepEqual(claims.map(r => r.status).sort(), [200, 409]);
  const winner = claims.find(r => r.status === 200)!;
  assert.equal(winner.headers.get('Cache-Control'), 'private, no-store');
  // Deliberately discard the successful response body, simulating response loss.
  const replay = await post(mf, 'consume', { code: issued.code });
  assert.equal(replay.status, 409); assert.ok(!(await replay.text()).includes(device));
  assert.equal((await post(mf, 'codes', { id: issued.id }, device)).status, 409);
  const next = await issue(mf);
  const paired = await (await post(mf, 'consume', { code: next.code })).json() as { status: string; deviceToken: string; origin: string };
  assert.deepEqual(paired, { status: 'paired', deviceToken: device, origin });
});

test('expired code cannot consume or be reissued with a refreshed lifetime', async () => {
  const mf = await runtime(), issued = await issue(mf), bucket = await mf.getR2Bucket('PHOTOS');
  const saved = await (await bucket.get(key(issued.code)))!.json<Record<string, unknown>>();
  await bucket.put(key(issued.code), JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }));
  assert.equal((await post(mf, 'consume', { code: issued.code })).status, 410);
  assert.equal((await post(mf, 'codes', { id: issued.id }, device)).status, 410);
});

test('rotating either approved server credential revokes pending pairing codes', async () => {
  const path = mkdtempSync(join(tmpdir(), 'booth-pairing-')); dirs.push(path);
  const mf = await runtime({}, path);
  const first = await issue(mf);
  await mf.setOptions(options({ LOCAL_DEVICE_TOKEN: 'replacement-device-token' }, path));
  assert.equal((await post(mf, 'consume', { code: first.code })).status, 410);
  await mf.setOptions(options({}, path));
  const second = await issue(mf);
  await mf.setOptions(options({ LOCAL_LINK_KEY: 'replacement-signing-key' }, path));
  assert.equal((await post(mf, 'consume', { code: second.code })).status, 410);
  assert.ok(await (await mf.getR2Bucket('PHOTOS')).head(key(second.code)));
});


test('an uncertain consume write never releases credentials or rearms a consumed code', async () => {
  const mf = await runtime(), issued = await issue(mf), bucket = await mf.getR2Bucket('PHOTOS');
  const original = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: (left: ArrayBuffer | ArrayBufferView, right: ArrayBuffer | ArrayBufferView) => {
    const bytes = (value: ArrayBuffer | ArrayBufferView) => ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    return timingSafeEqual(bytes(left), bytes(right));
  } });
  try {
    // Use real emulator storage, then lose the acknowledgement after the native
    // conditional write commits. The handler must not return the booth token.
    const failing = new Proxy(bucket, { get(target, property) {
      if (property === 'put') return async (...args: Parameters<typeof bucket.put>) => {
        const result = await target.put(...args);
        if (typeof args[1] === 'string' && args[1].includes('"state":"consumed"')) throw new Error('Injected acknowledgement loss');
        return result;
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await worker.fetch(new Request(`${origin}/v1/pairing/consume`, {
      method: 'POST', body: JSON.stringify({ code: issued.code }),
    }), { ...base, PHOTOS: failing } as unknown as Env);
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(device));
    assert.equal((await post(mf, 'consume', { code: issued.code })).status, 409);
    assert.equal((await post(mf, 'codes', { id: issued.id }, device)).status, 409);
  } finally {
    if (original) Object.defineProperty(crypto.subtle, 'timingSafeEqual', original);
    else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  }
});
