import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHostAuthenticator, hostAuthenticationCode, type HostAuthenticationAPI } from '../src/host-auth-policy';

function adapter(results: Awaited<ReturnType<HostAuthenticationAPI['authenticateAsync']>>[], level = 1) {
  const calls: Parameters<HostAuthenticationAPI['authenticateAsync']>[0][] = [];
  const api: HostAuthenticationAPI = {
    getEnrolledLevelAsync: async () => level,
    authenticateAsync: async options => { calls.push(options); return results.shift() ?? { success: false, error: 'user_cancel' }; },
  };
  return { api, calls };
}

test('device passcode enrollment is accepted and the OS owns fallback; no app PIN or custom fallback route', async () => {
  for (const level of [1, 3]) {
    const fake = adapter([{ success: true }], level);
    await createHostAuthenticator(fake.api)();
    assert.deepEqual(fake.calls, [{ promptMessage: 'Unlock booth host settings', cancelLabel: 'Cancel', disableDeviceFallback: false }]);
  }
  const source = readFileSync(new URL('../../../node_modules/expo-local-authentication/ios/LocalAuthenticationModule.swift', import.meta.url), 'utf8');
  assert.match(source, /disableDeviceFallback \? LAPolicy\.deviceOwnerAuthenticationWithBiometrics : LAPolicy\.deviceOwnerAuthentication/);
});

test('no passcode never presents or succeeds authentication', async () => {
  const fake = adapter([{ success: true }], 0);
  await assert.rejects(createHostAuthenticator(fake.api)(), /Enable an iPad passcode/);
  assert.equal(fake.calls.length, 0);
});

test('OS cancellation/fallback/interruption failures remain locked with actionable retry messages', async () => {
  for (const code of ['user_cancel', 'user_fallback', 'system_cancel', 'app_cancel', 'lockout',
    'not_available', 'not_enrolled', 'passcode_not_set', 'authentication_failed', 'unknown']) {
    const fake = adapter([{ success: false, error: code }, { success: true }]);
    const authenticate = createHostAuthenticator(fake.api);
    await assert.rejects(authenticate(), /passcode|Tap Host|tap Host/);
    assert.equal(fake.calls.length, 1, 'failure must not silently retry or grant permission');
    await authenticate();
    assert.equal(fake.calls.length, 2, 'an explicit later attempt can authenticate freshly');
  }
});

test('native API rejection never grants host access or exposes raw native diagnostics', async () => {
  const fake = adapter([{ success: true }]);
  fake.api.authenticateAsync = async () => { throw new Error('private native diagnostic'); };
  await assert.rejects(createHostAuthenticator(fake.api)(), error => error instanceof Error &&
    error.message.includes('tap Host') && !error.message.includes('private native'));
  fake.api.getEnrolledLevelAsync = async () => { throw new Error('private enrollment diagnostic'); };
  await assert.rejects(createHostAuthenticator(fake.api)(), /Device authentication is unavailable/);
});

test('diagnostic error codes are allowlisted and never contain native error text', async () => {
  const fake = adapter([{ success: false, error: 'private native content' }]);
  try { await createHostAuthenticator(fake.api)(); assert.fail('must reject'); }
  catch (error) { assert.equal(hostAuthenticationCode(error), 'unknown'); assert.equal(String(error).includes('private native'), false); }
  assert.equal(hostAuthenticationCode(new Error('user_cancel')), 'unknown');
});
