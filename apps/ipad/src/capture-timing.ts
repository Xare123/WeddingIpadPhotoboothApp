export const CAPTURE_TIMER_OPTIONS = [2, 3, 5, 8, 10] as const;
export type CountdownSeconds = typeof CAPTURE_TIMER_OPTIONS[number];
export type CaptureTiming = { firstSeconds: CountdownSeconds; nextSeconds: CountdownSeconds };

export const DEFAULT_CAPTURE_TIMING: Readonly<CaptureTiming> = Object.freeze({ firstSeconds: 5, nextSeconds: 3 });

export function isCountdownSeconds(value: unknown): value is CountdownSeconds {
  return typeof value === 'number' && CAPTURE_TIMER_OPTIONS.includes(value as CountdownSeconds);
}

/** Independent bounded defaults; malformed persisted values never become timers. */
export function normalizeCaptureTiming(value: unknown): CaptureTiming {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    firstSeconds: isCountdownSeconds(input.firstSeconds) ? input.firstSeconds : DEFAULT_CAPTURE_TIMING.firstSeconds,
    nextSeconds: isCountdownSeconds(input.nextSeconds) ? input.nextSeconds : DEFAULT_CAPTURE_TIMING.nextSeconds,
  };
}
