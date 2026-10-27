import type { CaptureTiming } from './capture-timing';

export const WEDDING_NAMES = 'Gizelle & Rami';
export const WEDDING_DATE = 'November 1, 2026';
export const WEDDING_IDENTITY = `${WEDDING_NAMES} · ${WEDDING_DATE}`;

export function durableSaveLabel(savedCount: number, targetCount: number): string {
  if (savedCount === 0) return 'No photos saved for this set yet';
  return `${savedCount} of ${targetCount} originals saved on this iPad`;
}

export function captureSaveStatus(options: {
  savedCount: number; targetCount: number; saving: boolean; failedSlot?: number;
} & ({ timing: CaptureTiming; seconds?: never } | { seconds: number; timing?: never })): string {
  const saved = durableSaveLabel(options.savedCount, options.targetCount);
  if (options.failedSlot !== undefined) return `Photo ${options.failedSlot + 1} still needs saving · ${saved}`;
  if (options.saving) return `Saving this photo · ${saved}`;
  if (options.timing) return `Each original saves before the next countdown · ${saved}`;
  return `${options.seconds} seconds per photo · ${saved}`;
}

export function captureErrorMessage(savedCount: number, pendingPhoto: boolean): string {
  if (pendingPhoto) return 'This photo has not finished saving. Keep the booth open and retry saving.';
  if (savedCount === 0) return 'The camera could not finish this photo. No photos have been saved in this set yet. Try again.';
  return `The camera could not finish this photo. Your ${savedCount} saved ${savedCount === 1 ? 'original is' : 'originals are'} safe on this iPad. Try again.`;
}
