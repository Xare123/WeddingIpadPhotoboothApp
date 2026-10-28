import { validateOrigin } from './sharing';
import { CAPTURE_TIMER_OPTIONS, DEFAULT_CAPTURE_TIMING, isCountdownSeconds, normalizeCaptureTiming, type CaptureTiming } from './capture-timing';

export { type CountdownSeconds } from './capture-timing';

export const DEFAULT_API_ORIGIN = 'https://photos.gizelleandrami.com';
export const COUNTDOWN_OPTIONS = CAPTURE_TIMER_OPTIONS;
export type HostPreferences = CaptureTiming & { photosExportEnabled: boolean; smsUiEnabled?: boolean; orientation: 'auto' | 'portrait' | 'landscape' };
export const DEFAULT_HOST_PREFERENCES: Readonly<HostPreferences> = Object.freeze({ ...DEFAULT_CAPTURE_TIMING, photosExportEnabled: true, smsUiEnabled: true, orientation: 'auto' });

export function hostPreferences(value: unknown): HostPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    // Keep a valid legacy host choice as the preparation timer. Subsequent
    // photos adopt the new three-second default rather than a second legacy gap.
    ...normalizeCaptureTiming({
      firstSeconds: isCountdownSeconds(input.firstSeconds) ? input.firstSeconds : input.countdownSeconds,
      nextSeconds: input.nextSeconds,
    }),
    smsUiEnabled: typeof input.smsUiEnabled === 'boolean' ? input.smsUiEnabled : true,
    photosExportEnabled: typeof input.photosExportEnabled === 'boolean'
      ? input.photosExportEnabled : DEFAULT_HOST_PREFERENCES.photosExportEnabled,
    orientation: input.orientation === 'portrait' || input.orientation === 'landscape' ? input.orientation : 'auto',
  };
}

export function normalizePairingCode(input: string): string {
  const code = input.trim();
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Use the complete private booth setup code.');
  return code;
}

type PairingPorts = {
  authenticate(): Promise<void>;
  assertCurrent(): void;
  request(code: string): Promise<unknown>;
  persist(origin: string, token: string): Promise<void>;
};

// The one-time code is consumed privately. It is never stored in preferences,
// screenshots, analytics or the application bundle. A lost response needs a new
// code, rather than an unsafe automatic second claim.
export async function pairBooth(input: string, ports: PairingPorts): Promise<void> {
  const code = normalizePairingCode(input);
  await ports.authenticate();
  ports.assertCurrent();
  let response: unknown;
  try { response = await ports.request(code); }
  catch { throw new Error('Setup could not finish. Ask the host for a fresh private setup code. Photos still save locally.'); }
  // A response can consume the one-time code even when the owner leaves before it arrives.
  // Never persist its token under an expired lease or automatically consume the code again.
  ports.assertCurrent();
  const value = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  if (value.status !== 'paired' || typeof value.origin !== 'string' ||
    validateOrigin(value.origin, false) !== DEFAULT_API_ORIGIN || typeof value.deviceToken !== 'string' ||
    value.deviceToken.length < 32 || value.deviceToken.length > 512 ||
    new Set(value.deviceToken).size < 12 || !/^[\x21-\x7e]+$/.test(value.deviceToken)) {
    throw new Error('The private setup response was invalid. Ask the host for a fresh code.');
  }
  ports.assertCurrent();
  try { await ports.persist(DEFAULT_API_ORIGIN, value.deviceToken); }
  catch { throw new Error('The setup code was used, but secure storage could not save it. Ask for a fresh private code. Local photos are safe.'); }
}

export async function saveGuardedHostPreferences(update: Partial<HostPreferences>, ports: {
  load(): Promise<HostPreferences>;
  assertCurrent(): void;
  persist(value: HostPreferences): Promise<void>;
}): Promise<HostPreferences> {
  const next = hostPreferences({ ...await ports.load(), ...update });
  ports.assertCurrent();
  await ports.persist(next);
  return next;
}
