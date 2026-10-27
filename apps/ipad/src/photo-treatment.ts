import type { ActiveCapture, PhotoTreatment } from './local-types';
const keys = (value: unknown, expected: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).sort().join() === [...expected].sort().join();
export function isPhotoTreatment(value: unknown): value is PhotoTreatment {
  if (!keys(value, ['version', 'order', 'look', 'face']) || value.version !== 'wedding-photo-treatment-v1' || value.order !== 'look-then-face' ||
    !keys(value.look, ['preset', 'intensity', 'version']) || !keys(value.face, ['accessory', 'version'])) return false;
  return value.look.version === 'wedding-ci-srgb-v1' && ['original', 'warm', 'bw', 'film'].includes(value.look.preset as string) &&
    typeof value.look.intensity === 'number' && Number.isFinite(value.look.intensity) && value.look.intensity >= 0 && value.look.intensity <= 1 &&
    value.face.version === 'wedding-face-prototype-v3' && ['none', 'glasses', 'crown', 'hearts'].includes(value.face.accessory as string);
}
export function canonicalPhotoTreatment(value: PhotoTreatment): string {
  if (!isPhotoTreatment(value)) throw new Error('invalid-photo-treatment');
  // Identity looks share the exact native recipe; legacy journal fields are never rewritten.
  const identity = value.look.preset === 'original' || value.look.intensity === 0;
  // Recursively sorted keys match the native JSONEncoder.sortedKeys receipt.
  return JSON.stringify({ face: { accessory: value.face.accessory, version: value.face.version },
    look: { intensity: identity ? 0 : value.look.intensity, preset: identity ? 'original' : value.look.preset, version: value.look.version },
    order: value.order, version: value.version });
}
export function samePhotoTreatment(left: unknown, right: unknown): boolean {
  return isPhotoTreatment(left) && isPhotoTreatment(right) && canonicalPhotoTreatment(left) === canonicalPhotoTreatment(right);
}
export function isOriginalTreatment(value: PhotoTreatment): boolean {
  return isPhotoTreatment(value) && (value.look.preset === 'original' || value.look.intensity === 0) && value.face.accessory === 'none';
}
export function photoTreatmentForCapture(capture: Pick<ActiveCapture, 'look' | 'treatment'>): PhotoTreatment {
  if (capture.treatment !== undefined) return JSON.parse(canonicalPhotoTreatment(capture.treatment)) as PhotoTreatment;
  return { version: 'wedding-photo-treatment-v1', order: 'look-then-face',
    look: capture.look ? { ...capture.look } : { preset: 'original', intensity: 0, version: 'wedding-ci-srgb-v1' },
    face: { accessory: 'none', version: 'wedding-face-prototype-v3' } };
}
export function isDerivedCapture(capture: Pick<ActiveCapture, 'sourcePhotoId' | 'look' | 'treatment'>): boolean {
  return capture.sourcePhotoId !== undefined || capture.look !== undefined || capture.treatment !== undefined;
}
