import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare } from 'miniflare';
import { createTextbeltProvider } from '../src/index';

const input = { idempotencyKey: 'test-id', to: '+12025550123', galleryUrl: 'https://gallery.example/g/' + 'a'.repeat(64) };
const testKey = 'synthetic-provider-key-not-a-credential';
const runtimes: Miniflare[] = [];
after(async () => { await Promise.all(runtimes.map(runtime => runtime.dispose())); });

test('injected Textbelt test adapter uses only the fixed endpoint and no-charge suffix, with truthful outcomes', async () => {
  let calls = 0;
  const provider = createTextbeltProvider(testKey, true, async (url, init) => {
    calls++; assert.equal(url, 'https://textbelt.com/text'); assert.equal(init!.method, 'POST'); assert.equal(init!.redirect, 'manual');
    const form = new URLSearchParams(init!.body as string);
    assert.equal(form.get('key'), testKey + '_test'); assert.equal(form.get('phone'), input.to);
    assert.ok(form.get('message')!.includes(input.galleryUrl));
    return Response.json({ success: true, quotaRemaining: 42, textId: 'not-persisted' });
  });
  const result = await provider.send(input);
  assert.equal(calls, 1); assert.equal(result.status, 'test_accepted'); assert.equal(result.retryable, false);
  assert.match(result.message, /no text message was sent/i);
  assert.deepEqual(result.providerDiagnostic, { stage: 'response', quotaRemaining: 42 });
  assert.ok(!JSON.stringify(result).includes('not-persisted'));
});

test('private provider diagnostics retain bounded IDs/quota and fixed rejection categories, never raw error content', async () => {
  const accepted = await createTextbeltProvider(testKey, false, async () =>
    Response.json({ success: true, textId: 12345, quotaRemaining: 7, phone: input.to, message: input.galleryUrl, key: testKey })).send(input);
  assert.deepEqual(accepted.providerDiagnostic, { stage: 'response', messageId: '12345', quotaRemaining: 7 });
  for (const [error, rejection] of [
    ['Out of quota', 'out-of-quota'], ['Incomplete request', 'incomplete-request'],
    ['Invalid API key: ' + testKey, 'invalid-key'], ['Invalid phone ' + input.to, 'invalid-number'],
    ['Too many requests', 'rate-limited'], ['Recipient is blocked', 'blocked-recipient'],
    ['URL rejected ' + input.galleryUrl, 'message-rejected'], ['Unrecognized ' + testKey, 'provider-rejected'],
  ]) {
    const result = await createTextbeltProvider(testKey, false, async () =>
      Response.json({ success: false, error, textId: input.to, quotaRemaining: 0 })).send(input);
    assert.equal(result.status, 'rejected');
    assert.deepEqual(result.providerDiagnostic, { stage: 'response', quotaRemaining: 0, rejection });
    for (const privateValue of [input.to, input.galleryUrl, testKey]) assert.ok(!JSON.stringify(result).includes(privateValue));
  }
  const malformed = await createTextbeltProvider(testKey, false, async () => new Response('{')).send(input);
  assert.equal(malformed.providerDiagnostic?.stage, 'invalid-response');
  const http = await createTextbeltProvider(testKey, false, async () => new Response(testKey, { status: 503 })).send(input);
  assert.deepEqual(http.providerDiagnostic, { stage: 'http', httpStatus: 503 });
});

test('provider acceptance is never called delivery, explicit rejection requires an operator, ambiguous outcomes cannot retry', async () => {
  const accepted = await createTextbeltProvider(testKey, false, async (_url, init) => {
    assert.equal(new URLSearchParams(init!.body as string).get('key'), testKey);
    return Response.json({ success: true });
  }).send(input);
  assert.equal(accepted.status, 'accepted'); assert.equal(accepted.deliveryStatus, 'unconfirmed'); assert.match(accepted.message, /delivery is not confirmed/);
  const rejected = await createTextbeltProvider(testKey, false, async () => Response.json({ success: false, error: input.to + testKey })).send(input);
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.retryable, false); assert.equal(rejected.safeToRetry, true);
  assert.ok(!JSON.stringify(rejected).includes(input.to)); assert.ok(!JSON.stringify(rejected).includes(testKey));
  const failures = [async () => { throw new Error('injected timeout'); }, async () => new Response('', { status: 503 }),
    async () => new Response('{'), async () => Response.json({ success: 'true' }), async () => Response.json({}),
    async () => new Response('x'.repeat(4097))];
  for (const fake of failures) {
    const result = await createTextbeltProvider(testKey, false, fake).send(input);
    assert.equal(result.status, 'uncertain'); assert.equal(result.retryable, false); assert.equal(result.safeToRetry, false);
  }
});

const auth = { Authorization: 'Bearer local-development-only' };
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
const origin = 'http://localhost';
async function setup(bindings: Record<string, string>, outbound: (request: Request) => Promise<Response>) {
  const runtime = new Miniflare({ modules: true, script: stripTypeScriptTypes(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')),
    compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'], outboundService: outbound,
    bindings: { MODE: 'local', SMS_MODE: 'textbelt', LOCAL_DEVICE_TOKEN: 'local-development-only', LOCAL_LINK_KEY: 'test-local-key', TEXTBELT_API_KEY: testKey,
      TEXTBELT_LIVE_APPROVED: 'true', TEXTBELT_ELIGIBILITY_APPROVED: 'true', ...bindings } });
  runtimes.push(runtime); await runtime.ready;
  const sessionId = randomUUID(), photoIds = Array.from({ length: 5 }, () => randomUUID());
  for (const id of photoIds) assert.equal((await runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/photos/${id}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: jpeg,
  })).status, 201);
  assert.equal((await runtime.dispatchFetch(`${origin}/v1/sessions/${sessionId}/ready`, {
    method: 'POST', headers: auth, body: JSON.stringify({ photoIds }),
  })).status, 200);
  return { runtime, sessionId };
}
const share = (runtime: Miniflare, sessionId: string, id: string, overrides = {}) => runtime.dispatchFetch(`${origin}/v1/shares`, {
  method: 'POST', headers: auth, body: JSON.stringify({ id, sessionId, phone: input.to, consent: true, ...overrides }),
});

test('SMS capability stays hidden for mock/test/missing approvals, and no provider request occurs without consent or full approval', async () => {
  let calls = 0;
  for (const bindings of [{ SMS_MODE: 'mock' }, { SMS_MODE: 'textbelt-test', TEXTBELT_TEST_ENABLED: 'approved' }, { TEXTBELT_LIVE_APPROVED: 'false' },
    { TEXTBELT_ELIGIBILITY_APPROVED: 'false' }, { TEXTBELT_API_KEY: '' }]) {
    const { runtime, sessionId } = await setup(bindings, async () => { calls++; throw new Error('No external HTTP permitted in this test'); });
    const health = await (await runtime.dispatchFetch(`${origin}/health`)).json() as { smsAvailable: boolean };
    assert.equal(health.smsAvailable, false);
    if (bindings.SMS_MODE !== 'mock' && bindings.SMS_MODE !== 'textbelt-test') assert.equal((await share(runtime, sessionId, randomUUID())).status, 503);
  }
  const { runtime, sessionId } = await setup({}, async () => { calls++; return Response.json({ success: true }); });
  assert.equal((await (await runtime.dispatchFetch(`${origin}/health`)).json() as { smsAvailable: boolean }).smsAvailable, true);
  assert.equal((await share(runtime, sessionId, randomUUID(), { consent: false })).status, 400);
  assert.equal(calls, 0);
});

test('durable Textbelt claim fences concurrent callers and new IDs, persists no phone or raw gallery token', async () => {
  let calls = 0;
  const { runtime, sessionId } = await setup({}, async request => {
    calls++; assert.equal(request.url, 'https://textbelt.com/text');
    await new Promise(resolve => setTimeout(resolve, 100));
    return Response.json({ success: true });
  });
  const id = randomUUID();
  const responses = await Promise.all([share(runtime, sessionId, id), share(runtime, sessionId, id)]);
  assert.equal(calls, 1, 'Expected one intercepted provider request');
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 202]);
  const winner = responses.find(response => response.status === 200)!;
  const result = await winner.json() as { status: string; url: string }; assert.equal(result.status, 'accepted');
  assert.equal((await (await share(runtime, sessionId, id)).json() as { status: string }).status, 'accepted');
  assert.equal((await (await share(runtime, sessionId, randomUUID())).json() as { status: string }).status, 'accepted');
  assert.equal((await share(runtime, sessionId, randomUUID(), { phone: '+12025550124' })).status, 409);
  assert.equal(calls, 1);
  const bucket = await runtime.getR2Bucket('PHOTOS');
  for (const object of (await bucket.list()).objects.filter(item => item.key.endsWith('.json'))) {
    const saved = await (await bucket.get(object.key))!.text();
    for (const sensitive of [input.to, testKey, new URL(result.url).pathname.split('/').at(-1)!]) assert.ok(!saved.includes(sensitive));
  }
});

test('provider diagnostics persist only in the private delivery fence and never enter the app response', async () => {
  let calls = 0;
  const { runtime, sessionId } = await setup({}, async () => {
    calls++; return Response.json({ success: true, textId: '987654321', quotaRemaining: 6 });
  });
  const id = randomUUID();
  const response = await share(runtime, sessionId, id);
  const value = await response.json() as Record<string, unknown>;
  assert.equal(value.status, 'accepted');
  for (const field of ['providerDiagnostic', 'messageId', 'textId', 'quotaRemaining']) assert.equal(Object.hasOwn(value, field), false);
  const bucket = await runtime.getR2Bucket('PHOTOS');
  const saved = await (await bucket.get(`sms-deliveries/textbelt/${sessionId}.json`))!.json<{ providerDiagnostic: unknown }>();
  assert.deepEqual(saved.providerDiagnostic, { stage: 'response', messageId: '987654321', quotaRemaining: 6 });
  await share(runtime, sessionId, id); await share(runtime, sessionId, randomUUID());
  assert.equal(calls, 1, 'Diagnostics must not change the duplicate-send fence');
});

test('unknown outcomes never resend even with new IDs or operator retry; only explicit rejection can be manually retried', async () => {
  let unknownCalls = 0;
  const unknown = await setup({}, async () => { unknownCalls++; return new Response('', { status: 503 }); });
  const id = randomUUID();
  for (const [requestId, overrides] of [[id, {}], [id, { retryRejected: true }], [randomUUID(), {}]] as const) {
    const response = await share(unknown.runtime, unknown.sessionId, requestId, overrides);
    assert.equal(response.status, 202); assert.equal((await response.json() as { status: string }).status, 'uncertain');
  }
  assert.equal(unknownCalls, 1);
  let rejectedCalls = 0;
  const rejected = await setup({}, async () => { rejectedCalls++; return Response.json({ success: rejectedCalls > 1 }); });
  const retryId = randomUUID();
  assert.equal((await (await share(rejected.runtime, rejected.sessionId, retryId)).json() as { status: string }).status, 'rejected');
  assert.equal((await (await share(rejected.runtime, rejected.sessionId, retryId)).json() as { status: string }).status, 'rejected');
  assert.equal(rejectedCalls, 1);
  assert.equal((await share(rejected.runtime, rejected.sessionId, randomUUID(), { retryRejected: true })).status, 409);
  assert.equal((await (await share(rejected.runtime, rejected.sessionId, retryId, { retryRejected: true })).json() as { status: string }).status, 'accepted');
  assert.equal(rejectedCalls, 2);
});

test('approved no-charge mode always suffixes the key and reports test_accepted without enabling phone capability', async () => {
  let calls = 0;
  const { runtime, sessionId } = await setup({ SMS_MODE: 'textbelt-test', TEXTBELT_TEST_ENABLED: 'approved' }, async request => {
    calls++; assert.equal(new URLSearchParams(await request.text()).get('key'), testKey + '_test'); return Response.json({ success: true });
  });
  assert.equal((await (await share(runtime, sessionId, randomUUID())).json() as { status: string }).status, 'test_accepted');
  assert.equal((await (await runtime.dispatchFetch(`${origin}/health`)).json() as { smsAvailable: boolean }).smsAvailable, false);
  assert.equal(calls, 1);
});


test('a persisted sending claim left by a crash never triggers a new provider request', async () => {
  let calls = 0;
  const { runtime, sessionId } = await setup({}, async () => { calls++; return Response.json({ success: true }); });
  const id = randomUUID(), bucket = await runtime.getR2Bucket('PHOTOS');
  await bucket.put(`sms-deliveries/textbelt/${sessionId}.json`, JSON.stringify({
    sessionId, shareId: id, mode: 'textbelt', status: 'sending', attemptId: randomUUID(),
    recipientFingerprint: createHmac('sha256', 'test-local-key').update(`recipient:v1:${input.to}`).digest('hex'),
  }));
  for (const shareId of [id, randomUUID()]) {
    const response = await share(runtime, sessionId, shareId, { retryRejected: true });
    assert.equal(response.status, 202); assert.equal((await response.json() as { status: string }).status, 'uncertain');
  }
  assert.equal(calls, 0);
});


test('legacy one-photo galleries remain readable but cannot create any Textbelt share', async () => {
  let calls = 0;
  const { runtime, sessionId } = await setup({}, async () => { calls++; throw new Error('Legacy share must not invoke a provider'); });
  const bucket = await runtime.getR2Bucket('PHOTOS');
  const manifests = await bucket.list({ prefix: 'galleries/' });
  const key = manifests.objects[0]!.key;
  const saved = await (await bucket.get(key))!.json<{ photoIds: string[] }>();
  await bucket.put(key, JSON.stringify({ ...saved, photoIds: saved.photoIds.slice(0, 1) }));
  const response = await share(runtime, sessionId, randomUUID());
  assert.equal(response.status, 409);
  const result = await response.json() as { retryable: boolean; error: string };
  assert.equal(result.retryable, false); assert.match(result.error, /five-photo/);
  assert.equal(calls, 0);
  assert.equal((await bucket.list({ prefix: 'sms-deliveries/' })).objects.length, 0);
  assert.equal((await bucket.list({ prefix: 'shares/' })).objects.length, 0);
});
