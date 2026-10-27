/** DEV ONLY. No browser face detector/artwork. Actual controller, synthetic native port.
 * Accessory choices return explicit original/color-only no-face results or errors.
 * Canvas color approximation remains separately labeled, never Vision output.
 */
import type { PhotoTreatment } from '../../../apps/ipad/src/local-types';
import { canonicalPhotoTreatment, isOriginalTreatment, isPhotoTreatment } from '../../../apps/ipad/src/photo-treatment';
import { fixtureControls } from './fixture-controls';
import { syntheticPhotoEffects, syntheticRenderedBlobs, syntheticSource } from './effects-stub';
const cancelled = new Set<string>();
const owned = new Set<string>();
async function sha256(bytes: ArrayBuffer) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); }
export const syntheticPhotoTreatments = {
  treatmentVersion: 'wedding-photo-treatment-v1',
  async renderTreatment(sourceUri: string, recipeJSON: string, requestID: string) {
    const requested = JSON.parse(recipeJSON) as PhotoTreatment;
    if (!isPhotoTreatment(requested)) throw new Error('Invalid synthetic treatment');
    const event: typeof fixtureControls.faceRenders[number] = { requestID, sourceUri, requestedRecipeJSON: canonicalPhotoTreatment(requested), status: 'started' };
    fixtureControls.faceRenders.push(event);
    const outcome = fixtureControls.faceNativeOutcome;
    const original = await syntheticSource(sourceUri);
    if (fixtureControls.faceBlocked) await new Promise<void>(resolve => fixtureControls.faceWaiters.add(resolve));
    if (fixtureControls.faceDelayMs) await new Promise<void>(resolve => setTimeout(resolve, fixtureControls.faceDelayMs));
    if (cancelled.has(requestID) && !fixtureControls.faceIgnoreCancellation) { event.status = 'cancelled'; throw Object.assign(new Error('Synthetic cancelled treatment'), { code: 'cancelled' }); }
    if (outcome === 'error') { event.status = 'error'; throw Object.assign(new Error('Synthetic SDK payload must not be guest text'), { code: 'processingFailed' }); }
    const effective = structuredClone(requested);
    const hadAccessory = effective.face.accessory !== 'none';
    // Deliberately no fabricated accessory pixels or positive face counts.
    effective.face.accessory = 'none';
    const counts = hadAccessory ? { detectedFaceCount: outcome === 'no-usable-face' ? 2 : 0, landmarkedFaceCount: 0, decoratedFaceCount: 0,
      fallbackReason: outcome } : { detectedFaceCount: null, landmarkedFaceCount: null, decoratedFaceCount: 0, fallbackReason: 'none' };
    if (isOriginalTreatment(effective)) {
      event.status = 'original-fallback'; event.uri = sourceUri; event.effectiveRecipeJSON = canonicalPhotoTreatment(effective); event.outputSha256 = original.hash;
      return { uri: sourceUri, width: original.bitmap.width, height: original.bitmap.height, recipe: effective, originalSha256: original.hash, outputSha256: original.hash, isOriginal: true, ...counts };
    }
    const result = await syntheticPhotoEffects.render(sourceUri, effective.look.preset, effective.look.intensity, false, requestID);
    const blob = syntheticRenderedBlobs.get(result.uri);
    if (!blob) throw new Error('Synthetic full-resolution color JPEG missing');
    owned.add(result.uri);
    const outputSha256 = await sha256(await blob.arrayBuffer());
    event.status = 'color-only-fallback'; event.uri = result.uri; event.effectiveRecipeJSON = canonicalPhotoTreatment(effective); event.outputSha256 = outputSha256;
    return { uri: result.uri, width: result.width, height: result.height, recipe: effective, originalSha256: original.hash, outputSha256, isOriginal: false, ...counts };
  },
  cancelTreatment(id: string) { cancelled.add(id); syntheticPhotoEffects.cancel(id); fixtureControls.faceCancellations.push(id); },
  async releaseTreatment(uri: string) { if (owned.delete(uri)) { fixtureControls.faceReleases.push(uri); await syntheticPhotoEffects.release(uri); } },
};
