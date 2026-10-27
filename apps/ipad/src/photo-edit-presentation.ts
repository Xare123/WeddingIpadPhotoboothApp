import type { PhotoLookEditorState } from './photo-look-editor';

export const FACE_CHOICES = [
  { accessory: 'none', title: 'None' },
  { accessory: 'glasses', title: 'Glasses' },
  { accessory: 'crown', title: 'Tiara' },
  { accessory: 'hearts', title: 'Hearts' },
] as const;
const lookTitles: Record<string, string> = { original: 'Original', warm: 'Warm', bw: 'B&W', film: 'Film' };
const lookTitle = (preset: string) => lookTitles[preset] ?? 'Photo';

export function photoEditStatus(state: PhotoLookEditorState, imageReady: boolean, imageFailed: boolean): string {
  if (imageFailed) return 'This preview could not open. Your original is retained.';
  if (state.phase === 'error') return 'Original kept. Try this edit again.';
  if (state.phase === 'saving') return state.faceSupported ? 'Saving your photo…' : 'Saving your full-size look…';
  if (state.phase !== 'ready' || !imageReady) return state.faceSupported ? 'Preparing your photo…' : 'Preparing preview…';
  if (!state.faceSupported) return 'Preview ready';
  if (state.fallbackReason === 'no-face') return 'No face was found. Your photo is kept without an accessory.';
  if (state.fallbackReason === 'no-usable-face') return 'No accessory could be placed safely. Your photo is kept.';
  if (state.fallbackReason === 'partial') return typeof state.decoratedFaceCount === 'number' && typeof state.detectedFaceCount === 'number'
    ? `${state.decoratedFaceCount} of ${state.detectedFaceCount} faces decorated. Applied where safe.` : 'Accessory applied where safe.';
  if (state.faceAccessory && state.faceAccessory !== 'none' && typeof state.decoratedFaceCount === 'number')
    return state.decoratedFaceCount === 1 ? 'Photo ready · 1 face decorated' : `Photo ready · ${state.decoratedFaceCount} faces decorated`;
  return 'Photo ready';
}

export function photoEditApplyTitle(state: PhotoLookEditorState, applying: boolean): string {
  if (applying) return state.faceSupported ? 'Saving your photo…' : 'Saving your look…';
  if (state.faceSupported) {
    const recipe = state.effectiveRecipe;
    const colourOriginal = recipe ? recipe.look.preset === 'original' || recipe.look.intensity === 0 : state.preset === 'original' || state.intensity === 0;
    const accessory = recipe?.face.accessory ?? state.faceAccessory ?? 'none';
    return colourOriginal && accessory === 'none' ? 'Use original' : 'Use this photo';
  }
  return state.preset === 'original' || state.intensity === 0 ? 'Use original' : `Use ${lookTitle(state.preset)}`;
}

export function photoEditPreviewLabel(state: PhotoLookEditorState): string {
  if (state.phase === 'error' || state.phase === 'previewing') return 'Original photo while the edit prepares';
  const preset = state.effectiveRecipe?.look.preset ?? state.preset;
  const intensity = state.effectiveRecipe?.look.intensity ?? state.intensity;
  const colour = preset === 'original' || intensity === 0 ? 'Original' : lookTitle(preset);
  const accessory = state.effectiveRecipe?.face.accessory ?? state.faceAccessory ?? 'none';
  return `${colour} photo${accessory === 'none' ? '' : ` with ${FACE_CHOICES.find(value => value.accessory === accessory)?.title ?? 'accessory'}`}`;
}
