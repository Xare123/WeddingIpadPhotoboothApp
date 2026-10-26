import { validateOrigin } from './sharing';

export const DEFAULT_API_ORIGIN = 'https://photos.gizelleandrami.com';
export const COUNTDOWN_OPTIONS = [2, 3, 5, 8, 10] as const;
export type CountdownSeconds = typeof COUNTDOWN_OPTIONS[number];
export type HostPreferences = { countdownSeconds: CountdownSeconds; photosExportEnabled: boolean };
export const DEFAULT_HOST_PREFERENCES: HostPreferences = { countdownSeconds: 3, photosExportEnabled: true };

export function hostPreferences(value: unknown): HostPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    countdownSeconds: COUNTDOWN_OPTIONS.includes(input.countdownSeconds as CountdownSeconds)
      ? input.countdownSeconds as CountdownSeconds : DEFAULT_HOST_PREFERENCES.countdownSeconds,
    photosExportEnabled: typeof input.photosExportEnabled === 'boolean'
      ? input.photosExportEnabled : DEFAULT_HOST_PREFERENCES.photosExportEnabled,
  };
}

export function normalizePairingCode(input: string): string {
  const code = input.trim();
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Use the complete private booth setup code.');
  return code;
}

type PairingPorts = {
  authenticate(): Promise<void>;
  request(code: string): Promise<unknown>;
  persist(origin: string, token: string): Promise<void>;
};

// The one-time code is consumed privately. It is never stored in preferences,
// screenshots, analytics or the application bundle. A lost response needs a new
// code, rather than an unsafe automatic second claim.
export async function pairBooth(input: string, ports: PairingPorts): Promise<void> {
  const code = normalizePairingCode(input);
  await ports.authenticate();
  let response: unknown;
  try { response = await ports.request(code); }
  catch { throw new Error('Setup could not finish. Ask the host for a fresh private setup code. Photos still save locally.'); }
  const value = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  if (value.status !== 'paired' || typeof value.origin !== 'string' ||
    validateOrigin(value.origin, false) !== DEFAULT_API_ORIGIN || typeof value.deviceToken !== 'string' ||
    value.deviceToken.length < 32 || value.deviceToken.length > 512 ||
    new Set(value.deviceToken).size < 12 || !/^[\x21-\x7e]+$/.test(value.deviceToken)) {
    throw new Error('The private setup response was invalid. Ask the host for a fresh code.');
  }
  try { await ports.persist(DEFAULT_API_ORIGIN, value.deviceToken); }
  catch { throw new Error('The setup code was used, but secure storage could not save it. Ask for a fresh private code. Local photos are safe.'); }
}
