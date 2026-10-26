import * as SecureStore from 'expo-secure-store';
import { validateOrigin, type ConnectionConfig } from './sharing';
import { authenticateHost } from './host-auth';
import { DEFAULT_API_ORIGIN, hostPreferences, pairBooth, type HostPreferences } from './provisioning';

export { DEFAULT_API_ORIGIN, COUNTDOWN_OPTIONS, type HostPreferences } from './provisioning';
export { DEFAULT_CAPTURE_TIMING, CAPTURE_TIMER_OPTIONS, type CaptureTiming, type CountdownSeconds } from './capture-timing';

const CONNECTION_KEY = 'wedding-photobooth.connection.v1';
const PREFERENCES_KEY = 'wedding-photobooth.preferences.v1';

export async function loadConnection(): Promise<ConnectionConfig | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as ConnectionConfig;
  if (!value || typeof value.origin !== 'string' || typeof value.token !== 'string' || !value.token.trim()) {
    throw new Error('Connection settings are invalid. Configure this booth again.');
  }
  return { origin: validateOrigin(value.origin, __DEV__), token: value.token };
}

export async function saveConnection(origin: string, token: string): Promise<void> {
  const config = { origin: validateOrigin(origin, __DEV__), token: token.trim() };
  if (!config.token) throw new Error('Enter the booth access token.');
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(config), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
}

export async function loadHostPreferences(): Promise<HostPreferences> {
  const raw = await SecureStore.getItemAsync(PREFERENCES_KEY);
  try { return hostPreferences(raw ? JSON.parse(raw) : null); }
  catch { return hostPreferences(null); }
}

export async function saveHostPreferences(update: Partial<HostPreferences>): Promise<HostPreferences> {
  const next = hostPreferences({ ...await loadHostPreferences(), ...update });
  await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(next), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return next;
}

export async function provisionBooth(code: string): Promise<void> {
  await pairBooth(code, {
    authenticate: authenticateHost,
    async request(privateCode) {
      const response = await fetch(`${DEFAULT_API_ORIGIN}/v1/pairing/consume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: privateCode }), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error('Private setup was not acknowledged');
      return response.json();
    },
    async persist(origin, token) {
      await saveConnection(origin, token);
      const saved = await loadConnection();
      if (!saved || saved.origin !== origin || saved.token !== token) throw new Error('Secure storage verification failed');
    },
  });
}
