import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { emailConfigured, handleGuestEmail, type GuestEmailEnv } from '../src/guest-email';

const now = Date.UTC(2026, 10, 1, 18), url = 'https://photos.example/g/' + 'a'.repeat(64);
const secret = 'email-test-signing-key-only-not-production';
const syntheticAddress = 'guest@example.com';
class MemoryBucket {
  records = new Map<string, { text: string; etag: string }>();
  writes: string[] = []; serial = 0; failQuota = false; failFinal = false;
  async put(key: string, text: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    if (this.failQuota && key.startsWith('email-quota/')) throw new Error('Synthetic storage failure');
    if (this.failFinal && options?.onlyIf?.etagMatches) throw new Error('Synthetic storage failure');
    const old = this.records.get(key), condition = options?.onlyIf;
    if (condition?.etagDoesNotMatch === '*' && old || condition?.etagMatches && old?.etag !== condition.etagMatches) return null;
    const value = { text, etag: String(++this.serial) }; this.records.set(key, value); this.writes.push(key);
    return { etag: value.etag };
  }
  async get(key: string) { const value = this.records.get(key); return value ? { etag: value.etag, json: async () => JSON.parse(value.text) } : null; }
}
const envFor = (bucket = new MemoryBucket()): GuestEmailEnv => ({ PHOTOS: bucket as unknown as R2Bucket,
  MODE: 'production', EMAIL_MODE: 'resend', EMAIL_FROM: 'photos@example.com', EMAIL_SENDER_VERIFIED: 'approved',
  EMAIL_DAILY_LIMIT: '2', RESEND_API_KEY: 're_synthetic_fixture_key_no_value', LINK_SIGNING_KEY: secret });
const gallery = () => ({ sessionId: randomUUID(), expiresAt: now + 60_000 });
const request = (body: unknown = { email: syntheticAddress, consent: true }) => new Request(url + '/email', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const forbidden: typeof fetch = async () => { throw new Error('Provider must not be called'); };
const accepted: typeof fetch = async () => Response.json({ id: randomUUID() });

test('email is disabled unless sender verification, plain sender address, key, mode and bounded quota are configured', () => {
  const env = envFor(); assert.equal(emailConfigured(env), true);
  for (const change of [{ EMAIL_MODE: undefined }, { EMAIL_MODE: 'mock' }, { EMAIL_SENDER_VERIFIED: undefined }, { RESEND_API_KEY: '' },
    { EMAIL_FROM: 'Unverified Name <photos@example.com>' }, { EMAIL_FROM: 'a@bad\r\n.example' }, { LINK_SIGNING_KEY: undefined },
    ...['0', '101', '1.5', '-1', 'Infinity', '002'].map(EMAIL_DAILY_LIMIT => ({ EMAIL_DAILY_LIMIT }))])
    assert.equal(emailConfigured({ ...env, ...change }), false);
  assert.equal(emailConfigured({ ...env, EMAIL_DAILY_LIMIT: undefined }), true);
  assert.equal(emailConfigured({ ...env, EMAIL_DAILY_LIMIT: '100' }), true);
  assert.equal(emailConfigured({ ...env, MODE: 'local', EMAIL_MODE: 'mock', LOCAL_LINK_KEY: 'local-key' }), true);
});

test('requires explicit consent, bounded strict JSON and one valid address; rejects arbitrary content and caller URLs before R2', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket);
  for (const body of [{ email: syntheticAddress }, { email: syntheticAddress, consent: false }, { email: syntheticAddress, consent: 'true' },
    { email: syntheticAddress, consent: true, url: 'https://attacker.example' }, { email: [syntheticAddress], consent: true },
    ...['', 'invalid', 'a@example.com,b@example.com', 'a\r\n@example.com', 'x'.repeat(65) + '@example.com', 'a..b@example.com'].map(email => ({ email, consent: true })),
    '{invalid', ' '.repeat(1025)]) {
    assert.equal((await handleGuestEmail(request(body), env, gallery(), url, forbidden, now)).status, 400);
  }
  assert.equal(bucket.records.size, 0);
  assert.equal((await handleGuestEmail(new Request(url, { method: 'POST', body: JSON.stringify({ email: syntheticAddress, consent: true }) }), env, gallery(), url, forbidden, now)).status, 400);
});

test('fixed provider message is derived from server URL, uses stable idempotency, and persists neither address nor URL', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket), g = gallery(); let calls = 0;
  const provider: typeof fetch = async (endpoint, init) => {
    calls++; assert.equal(endpoint, 'https://api.resend.com/emails'); assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual');
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers['Idempotency-Key'], `wedding-email-v1-${g.sessionId}`);
    assert.equal(headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
    const body = JSON.parse(init!.body as string); assert.deepEqual(body.to, [syntheticAddress]); assert.equal(body.from, env.EMAIL_FROM);
    assert.ok(body.text.includes(url)); assert.equal(body.html, undefined);
    assert.ok(bucket.records.has(`email-deliveries/v1/${g.sessionId}.json`));
    assert.equal([...bucket.records.keys()].filter(key => key.startsWith('email-quota/')).length, 1);
    return Response.json({ id: randomUUID() });
  };
  const response = await handleGuestEmail(request(), env, g, url, provider, now);
  assert.equal(response.body.status, 'accepted'); assert.match(response.body.message, /not confirmed/);
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'accepted'); assert.equal(calls, 1);
  assert.equal((await handleGuestEmail(request({ email: 'other@example.com', consent: true }), env, g, url, provider, now)).status, 409);
  assert.equal(calls, 1);
  const all = JSON.stringify([...bucket.records]);
  for (const forbiddenValue of [syntheticAddress, 'other@example.com', url, env.RESEND_API_KEY!, secret]) assert.equal(all.includes(forbiddenValue), false);
  const fence = JSON.parse(bucket.records.get(`email-deliveries/v1/${g.sessionId}.json`)!.text);
  assert.equal(fence.fingerprint, createHmac('sha256', secret).update(`guest-email:v1:${syntheticAddress}`).digest('hex'));
});

test('concurrent same-session requests cannot send twice and sending survives uncertain outcomes without retry', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket), g = gallery(); let release!: () => void, calls = 0;
  const provider: typeof fetch = async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); throw new Error('Synthetic lost response'); };
  const first = handleGuestEmail(request(), env, g, url, provider, now);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'pending');
  release(); assert.equal((await first).body.status, 'uncertain');
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'uncertain'); assert.equal(calls, 1);
});

test('strict UTC daily conditional slots cap concurrent sessions, do not refund rejected/uncertain attempts, and reset only next UTC day', async () => {
  const bucket = new MemoryBucket(), env = { ...envFor(bucket), EMAIL_DAILY_LIMIT: '2' }; let calls = 0;
  const provider: typeof fetch = async () => { calls++; return Response.json({ error: 'Synthetic rejected' }, { status: 422 }); };
  const responses = await Promise.all(Array.from({ length: 6 }, () => handleGuestEmail(request(), env, gallery(), url, provider, now)));
  assert.equal(calls, 2); assert.equal(responses.filter(r => r.body.status === 'quota-exhausted').length, 4);
  assert.equal([...bucket.records.keys()].filter(key => key.startsWith('email-quota/v1/2026-11-01/')).length, 2);
  assert.equal((await handleGuestEmail(request(), env, gallery(), url, provider, now)).body.status, 'quota-exhausted'); assert.equal(calls, 2);
  const next = now + 86400000, g = { ...gallery(), expiresAt: next + 60000 };
  await handleGuestEmail(request(), env, g, url, provider, next); assert.equal(calls, 3);
});

test('quota storage failure and invalid existing fences fail closed; final storage uncertainty never resends', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket); let calls = 0;
  const provider: typeof fetch = async () => { calls++; return Response.json({ id: randomUUID() }); };
  bucket.failQuota = true; const quotaSession = gallery();
  assert.equal((await handleGuestEmail(request(), env, quotaSession, url, provider, now)).body.status, 'uncertain'); assert.equal(calls, 0);
  bucket.failQuota = false; bucket.failFinal = true; const g = gallery();
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'uncertain');
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'pending'); assert.equal(calls, 1);
  const broken = gallery(); bucket.records.set(`email-deliveries/v1/${broken.sessionId}.json`, { etag: 'broken', text: '{invalid' });
  assert.equal((await handleGuestEmail(request(), env, broken, url, provider, now)).body.status, 'unavailable'); assert.equal(calls, 1);
});

test('provider failures classify acceptance truthfully without exposing provider body and never retry any terminal result', async () => {
  for (const [response, expected] of [[Response.json({ id: randomUUID() }), 'accepted'], [Response.json({ success: true }), 'uncertain'],
    [new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }), 'uncertain'], [new Response('private provider detail', { status: 422 }), 'rejected'], [new Response('private provider detail', { status: 429 }), 'rejected'], [new Response('private provider detail', { status: 500 }), 'uncertain'],
    [new Response('x'.repeat(4097)), 'uncertain']] as const) {
    const bucket = new MemoryBucket(), env = envFor(bucket), g = gallery(); let calls = 0;
    const provider: typeof fetch = async () => { calls++; return response; };
    const result = await handleGuestEmail(request(), env, g, url, provider, now);
    assert.equal(result.body.status, expected); assert.equal(JSON.stringify(result).includes('private provider detail'), false);
    await handleGuestEmail(request(), env, g, url, provider, now); assert.equal(calls, 1);
  }
});

test('only local mode can mock, and expiry/invalid server URLs never write or contact provider', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket);
  for (const invalid of ['http://photos.example/g/' + 'a'.repeat(64), url + '?extra=1', url + '#fragment', 'https://a:b@photos.example/g/' + 'a'.repeat(64), 'https://photos.example/arbitrary'])
    assert.equal((await handleGuestEmail(request(), env, gallery(), invalid, forbidden, now)).body.status, 'unavailable');
  assert.equal((await handleGuestEmail(request(), env, { ...gallery(), expiresAt: now }, url, forbidden, now)).status, 410);
  assert.equal(bucket.records.size, 0);
  const local = { ...env, MODE: 'local', EMAIL_MODE: 'mock', LOCAL_LINK_KEY: 'test-local-key' };
  const result = await handleGuestEmail(request(), local, gallery(), 'http://localhost/g/' + 'a'.repeat(64), forbidden, now);
  assert.equal(result.body.status, 'mocked'); assert.equal([...bucket.records.keys()].some(key => key.startsWith('email-quota/')), false);
});


test('provider response-body stall is aborted after the fixed deadline and remains uncertain without resend', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bucket = new MemoryBucket(), env = envFor(bucket), g = gallery(); let entered = false, calls = 0, aborted = false;
  const provider: typeof fetch = async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) {
        entered = true;
        init!.signal!.addEventListener('abort', () => { aborted = true; controller.error(new Error('Synthetic timeout')); }, { once: true });
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  const pending = handleGuestEmail(request(), env, g, url, provider, now);
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10000);
  assert.equal((await pending).body.status, 'uncertain'); assert.equal(aborted, true);
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, now)).body.status, 'uncertain'); assert.equal(calls, 1);
});


function heldRequest() {
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    finish = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ email: syntheticAddress, consent: true }))); controller.close(); };
  } });
  const req = new Request(url + '/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
  return { req, finish };
}

test('held request body crossing UTC midnight consumes current-day quota, not request-start quota', async () => {
  const bucket = new MemoryBucket(), env = { ...envFor(bucket), EMAIL_DAILY_LIMIT: '1' };
  let time = Date.UTC(2026, 10, 1, 23, 59, 59), calls = 0;
  const nextDay = Date.UTC(2026, 10, 2, 0, 0, 1);
  await bucket.put('email-quota/v1/2026-11-02/000.json', '{"version":1,"claimed":true}');
  const held = heldRequest(), g = { ...gallery(), expiresAt: nextDay + 60000 };
  const provider: typeof fetch = async () => { calls++; return Response.json({ id: randomUUID() }); };
  const pending = handleGuestEmail(held.req, env, g, url, provider, () => time);
  time = nextDay; held.finish();
  assert.equal((await pending).body.status, 'quota-exhausted'); assert.equal(calls, 0);
  assert.equal([...bucket.records.keys()].some(key => key.startsWith('email-quota/v1/2026-11-01/')), false);
});

test('gallery expiring while the request body is held cannot reserve or send email', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket), held = heldRequest(); let time = now;
  const pending = handleGuestEmail(held.req, env, { ...gallery(), expiresAt: now + 1000 }, url, forbidden, () => time);
  time = now + 1000; held.finish();
  assert.equal((await pending).status, 410); assert.equal(bucket.records.size, 0);
});

test('quota admission refreshes time after asynchronous fence work and rejects newly expired galleries', async () => {
  const bucket = new MemoryBucket(), env = envFor(bucket); let time = now;
  const originalPut = bucket.put.bind(bucket);
  bucket.put = async (...args) => { const result = await originalPut(...args); if (args[0].startsWith('email-deliveries/')) time = now + 2000; return result; };
  const response = await handleGuestEmail(request(), env, { ...gallery(), expiresAt: now + 1000 }, url, forbidden, () => time);
  assert.equal(response.status, 410);
  assert.equal([...bucket.records.keys()].some(key => key.startsWith('email-quota/')), false);
});


test('actual workerd fetch reaches only fixed intercepted provider and never follows redirects', async () => {
  const { Miniflare } = await import('miniflare');
  const { buildSync } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const script = buildSync({ stdin: { contents: `import {handleGuestEmail} from './guest-email';
    export default {async fetch(request,env){const id=new URL(request.url).searchParams.get('session');const r=await handleGuestEmail(request,env,{sessionId:id,expiresAt:Date.now()+60000},'https://photos.example/g/'+'a'.repeat(64));return Response.json(r.body,{status:r.status});}};`,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022' }).outputFiles[0]!.text;
  let calls = 0, redirect = false;
  const runtime = new Miniflare({ modules: true, cf: false, script, compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'],
    bindings: { MODE: 'local', LOCAL_LINK_KEY: secret, EMAIL_MODE: 'resend', EMAIL_FROM: 'photos@example.com',
      EMAIL_SENDER_VERIFIED: 'approved', EMAIL_DAILY_LIMIT: '2', RESEND_API_KEY: 're_synthetic_fixture_key_no_value' },
    outboundService: async request => {
      calls++; assert.equal(request.url, 'https://api.resend.com/emails'); assert.equal(request.method, 'POST');
      return redirect ? new Response(null, { status: 302, headers: { Location: 'https://attacker.example/never-follow' } }) : Response.json({ id: randomUUID() });
    },
  });
  try {
    const send = (session: string) => runtime.dispatchFetch(`http://localhost/?session=${session}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: syntheticAddress, consent: true }),
    });
    const id = randomUUID();
    assert.equal((await (await send(id)).json() as { status: string }).status, 'accepted');
    assert.equal((await (await send(id)).json() as { status: string }).status, 'accepted'); assert.equal(calls, 1);
    redirect = true;
    assert.equal((await (await send(randomUUID())).json() as { status: string }).status, 'uncertain'); assert.equal(calls, 2);
  } finally { await runtime.dispose(); }
});


test('quota put crossing UTC midnight never sends against yesterday slot or refunds the consumed claim', async () => {
  const bucket = new MemoryBucket(), env = { ...envFor(bucket), EMAIL_DAILY_LIMIT: '1' };
  let time = Date.UTC(2026, 10, 1, 23, 59, 59), calls = 0;
  const nextDay = Date.UTC(2026, 10, 2, 0, 0, 1), originalPut = bucket.put.bind(bucket);
  bucket.put = async (...args) => {
    const value = await originalPut(...args);
    if (value && args[0].startsWith('email-quota/v1/2026-11-01/')) time = nextDay;
    return value;
  };
  const g = { ...gallery(), expiresAt: nextDay + 60000 };
  const provider: typeof fetch = async () => { calls++; return Response.json({ id: randomUUID() }); };
  const response = await handleGuestEmail(request(), env, g, url, provider, () => time);
  assert.equal(response.body.status, 'rejected'); assert.notEqual(response.status, 410); assert.equal(calls, 0);
  assert.equal(bucket.records.has('email-quota/v1/2026-11-01/000.json'), true);
  assert.equal(bucket.records.has('email-quota/v1/2026-11-02/000.json'), false);
  assert.equal((await handleGuestEmail(request(), env, g, url, provider, () => time)).body.status, 'rejected'); assert.equal(calls, 0);
});
