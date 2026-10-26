import { requireOptionalNativeModule } from 'expo';
import type { PhotoLookEditorPorts } from './photo-look-editor';
import type { TemplateEditorPorts } from './template-editor';

export type NativePhotoEffects = Pick<PhotoLookEditorPorts, 'render' | 'cancel' | 'release'>;
/** A rebuilt iOS binary supplies this module. Expo Go does not. */
export function loadPhotoEffects(): NativePhotoEffects | null {
  try {
    const module = requireOptionalNativeModule<NativePhotoEffects & { capabilityVersion?: number; recipeVersion?: string }>('WeddingPhotoEffects');
    if (module?.capabilityVersion !== 1 || module.recipeVersion !== 'wedding-ci-srgb-v1' ||
      typeof module.render !== 'function' || typeof module.cancel !== 'function' || typeof module.release !== 'function') return null;
    return { render: (...args) => module.render(...args), cancel: id => module.cancel(id), release: uri => module.release(uri) };
  } catch { return null; }
}
export type NativeTemplateEffects = Pick<TemplateEditorPorts, 'renderTemplate' | 'cancelTemplate' | 'releaseTemplate'>;
export function loadTemplateEffects(): NativeTemplateEffects | null {
  try {
    const module = requireOptionalNativeModule<NativeTemplateEffects & { templateVersion?: string }>('WeddingPhotoEffects');
    if (module?.templateVersion !== 'wedding-template-v1' || typeof module.renderTemplate !== 'function' || typeof module.cancelTemplate !== 'function' || typeof module.releaseTemplate !== 'function') return null;
    return { renderTemplate: (...args) => module.renderTemplate(...args), cancelTemplate: id => module.cancelTemplate(id), releaseTemplate: uri => module.releaseTemplate(uri) };
  } catch { return null; }
}
