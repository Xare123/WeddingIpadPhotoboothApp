import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_API_ORIGIN, hostPreferences, normalizePairingCode, pairBooth } from '../../../apps/ipad/src/provisioning';

const code = 'b'.repeat(64);
// Explicit synthetic fixture, never a live credential.
const response = { status: 'paired', origin: DEFAULT_API_ORIGIN, deviceToken: 'synthetic-ONLY-private-setup-fixture-0123456789' };

test('private provisioning authenticates the host before exchange and saves only the fixed origin/booth token', async () => {
  const calls: string[] = [];
  await pairBooth(code, {
    assertCurrent() {}, async authenticate() { calls.push('authenticate'); },
    async request(value) { calls.push('exchange'); assert.equal(value, code); return response; },
    async persist(origin, token) { calls.push('keychain'); assert.equal(origin, DEFAULT_API_ORIGIN); assert.equal(token, response.deviceToken); },
  });
  assert.deepEqual(calls, ['authenticate', 'exchange', 'keychain']);
});

test('cancelled host authentication and invalid private codes never reach provisioning transport', async () => {
  let requests = 0, writes = 0;
  const ports = { assertCurrent() {}, async authenticate() { throw new Error('Cancelled'); }, async request() { requests++; return response; }, async persist() { writes++; } };
  await assert.rejects(pairBooth(code, ports), /Cancelled/);
  for (const invalid of ['', '123456', 'A'.repeat(64), code+'x', `https://other.example/?code=${code}`, `weddingphotobooth://pair?code=${code}&code=${code}`]) {
    await assert.rejects(pairBooth(invalid, ports));
  }
  assert.equal(requests, 0); assert.equal(writes, 0);
  assert.equal(normalizePairingCode(`  ${code}  `), code);
  assert.throws(() => normalizePairingCode(`weddingphotobooth://pair?code=${code}`));
});

test('pairing rejects another origin, incomplete replies and weak tokens without saving', async () => {
  for (const invalid of [null, {}, { ...response, status: 'issued' }, { ...response, origin: 'https://other.example' },
    { ...response, origin: `${DEFAULT_API_ORIGIN}/path` }, { ...response, deviceToken: 'x'.repeat(64) },
    { ...response, deviceToken: 'short' }, { ...response, deviceToken: response.deviceToken+'\n' }]) {
    let writes = 0;
    await assert.rejects(pairBooth(code, { assertCurrent() {}, async authenticate() {}, async request() { return invalid; }, async persist() { writes++; } }));
    assert.equal(writes, 0);
  }
});

test('lost exchange and Keychain failure do not retry or expose a private code/token in errors', async () => {
  for (const stage of ['request', 'persist']) {
    let requests = 0;
    await assert.rejects(pairBooth(code, {
      assertCurrent() {}, async authenticate() {},
      async request() { requests++; if (stage === 'request') throw new Error(code+response.deviceToken); return response; },
      async persist() { throw new Error(code+response.deviceToken); },
    }), error => {
      assert(error instanceof Error); assert(!error.message.includes(code)); assert(!error.message.includes(response.deviceToken)); return true;
    });
    assert.equal(requests, 1);
  }
});

test('host timer preferences use bounded choices and survive malformed legacy preference data safely', () => {
  for (const countdownSeconds of [2, 3, 5, 8, 10]) {
    const migrated = hostPreferences({ countdownSeconds });
    assert.equal(migrated.firstSeconds, countdownSeconds);
    assert.equal(migrated.nextSeconds, 3);
    assert.equal(Object.hasOwn(migrated, 'countdownSeconds'), false, 'Migration never re-saves the deprecated single timer');
  }
  for (const value of [undefined, null, 'bad', { countdownSeconds: 0 }, { countdownSeconds: 60 }, { countdownSeconds: '5' }]) {
    assert.equal(hostPreferences(value).firstSeconds, 5);
    assert.equal(hostPreferences(value).nextSeconds, 3);
  }
  assert.deepEqual(hostPreferences({ firstSeconds: 2, nextSeconds: 10, countdownSeconds: 8 }), { firstSeconds: 2, nextSeconds: 10, photosExportEnabled: true, smsUiEnabled: true, orientation: 'auto' });
  assert.deepEqual(hostPreferences({ firstSeconds: 8, nextSeconds: '5' }), { firstSeconds: 8, nextSeconds: 3, photosExportEnabled: true, smsUiEnabled: true, orientation: 'auto' });
  assert.equal(hostPreferences({ photosExportEnabled: false }).photosExportEnabled, false);
  assert.equal(hostPreferences({ photosExportEnabled: 'false' }).photosExportEnabled, true);
});

for (const event of ['background', 'close'] as const) {
  for (const phase of ['authentication', 'response', 'preferences-read'] as const) {
    test(`${event} during ${phase} prevents the next provisioning or preference mutation`, async () => {
      const { authenticateHostAction } = await import('../../../apps/ipad/src/host-action-auth');
      const { createHostVisibility } = await import('../../../apps/ipad/src/host-visibility');
      const { saveGuardedHostPreferences } = await import('../../../apps/ipad/src/provisioning');
      const visibility = createHostVisibility(); let clock = 0, requests = 0, writes = 0;
      const revoke = () => { if (event === 'background') visibility.suspend('background'); else visibility.close(); };
      let lease: Awaited<ReturnType<typeof authenticateHostAction>>;
      const authenticate = async () => { lease = await authenticateHostAction({ visibility, authenticate: async () => {
        if (phase === 'authentication') revoke();
      }, isActive: () => true, now: () => clock, wait: async ms => { clock += ms; } }); };
      if (phase === 'preferences-read') {
        await authenticate();
        await assert.rejects(saveGuardedHostPreferences({ firstSeconds: 8 }, {
          assertCurrent: () => lease.assertCurrent(), load: async () => { revoke(); return hostPreferences(null); },
          persist: async () => { writes++; },
        }), /no longer authorized/);
      } else {
        await assert.rejects(pairBooth(code, { authenticate, assertCurrent: () => lease.assertCurrent(),
          request: async () => { requests++; if (phase === 'response') revoke(); return response; },
          persist: async () => { writes++; },
        }), /authorized|left the booth|foreground/);
        assert.equal(requests, phase === 'authentication' ? 0 : 1, 'never re-consume the private code');
      }
      assert.equal(writes, 0);
    });
  }
}

test('guarded preference save authenticates freshly, waits through OS inactive, and preserves unrelated settings', async () => {
  const { authenticateHostAction } = await import('../../../apps/ipad/src/host-action-auth');
  const { createHostVisibility } = await import('../../../apps/ipad/src/host-visibility');
  const { saveGuardedHostPreferences } = await import('../../../apps/ipad/src/provisioning');
  const visibility = createHostVisibility(); let clock = 0, active = false, writes = 0;
  const lease = await authenticateHostAction({ visibility, authenticate: async () => { visibility.suspend('inactive'); active = false; },
    isActive: () => active || clock === 0, now: () => clock, wait: async ms => { clock += ms; if (clock === 100) active = true; } });
  const previous = hostPreferences({ photosExportEnabled: false, firstSeconds: 3, nextSeconds: 8 });
  const saved = await saveGuardedHostPreferences({ firstSeconds: 5 }, { assertCurrent: lease.assertCurrent,
    load: async () => previous, persist: async value => { writes++; assert.equal(value.photosExportEnabled, false); } });
  assert.equal(writes, 1); assert.deepEqual(saved, { ...previous, firstSeconds: 5 });
});


test('display preference defaults to Auto and preserves explicit valid choices independently of timers', () => {
  for (const value of [undefined, null, {}, { orientation: 'PORTRAIT' }, { orientation: true }]) {
    assert.equal(hostPreferences(value).orientation, 'auto');
  }
  for (const orientation of ['auto', 'portrait', 'landscape'] as const) {
    const result = hostPreferences({ orientation, firstSeconds: 8, nextSeconds: 2, photosExportEnabled: false });
    assert.equal(result.orientation, orientation);
    assert.equal(result.firstSeconds, 8);
    assert.equal(result.nextSeconds, 2);
    assert.equal(result.photosExportEnabled, false);
  }
});

test('SMS visibility persists without changing the other host defaults', () => {
  const old = hostPreferences({ firstSeconds: 8, nextSeconds: 2, orientation: 'landscape', photosExportEnabled: false });
  const hidden = hostPreferences({ ...old, smsUiEnabled: false });
  assert.deepEqual(hidden, { ...old, smsUiEnabled: false });
  assert.deepEqual(hostPreferences({ ...hidden, smsUiEnabled: true }), old);
});
