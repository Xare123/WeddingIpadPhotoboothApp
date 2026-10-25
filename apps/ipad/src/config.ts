import * as SecureStore from 'expo-secure-store';
import { validateOrigin, type ConnectionConfig } from './sharing';

const CONNECTION_KEY = 'wedding-photobooth.connection.v1';

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
