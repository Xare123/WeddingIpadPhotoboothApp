import { CAPTURE_TIMER_OPTIONS, type CountdownSeconds } from './capture-timing';

export const TIMING_RAIL_INSET = 14;

/** The labelled stops are evenly spaced; gestures never select hidden values. */
export function timingDetentAt(relativeX: number, width: number): CountdownSeconds | null {
  const usable = width - TIMING_RAIL_INSET * 2;
  if (!Number.isFinite(relativeX) || !Number.isFinite(width) || usable <= 0) return null;
  const position = Math.max(0, Math.min(1, (relativeX - TIMING_RAIL_INSET) / usable));
  return CAPTURE_TIMER_OPTIONS[Math.round(position * (CAPTURE_TIMER_OPTIONS.length - 1))]!;
}

export function stepTimingDetent(value: CountdownSeconds, direction: -1 | 1): CountdownSeconds {
  const index = CAPTURE_TIMER_OPTIONS.indexOf(value);
  return CAPTURE_TIMER_OPTIONS[Math.max(0, Math.min(CAPTURE_TIMER_OPTIONS.length - 1, index + direction))]!;
}
