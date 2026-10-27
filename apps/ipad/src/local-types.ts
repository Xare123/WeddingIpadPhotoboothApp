import type { CaptureTiming } from './capture-timing';
export type PhotoExportStatus = 'pending' | 'saved' | 'denied' | 'failed' | 'unavailable' | 'uncertain';
export type PhotoLook = { preset: 'warm' | 'bw' | 'film'; intensity: number; version: 'wedding-ci-srgb-v1' };
export type ActiveCapture = {
  id: string; fileUri: string; confirmed: boolean; createdAt: number;
  sourcePhotoId?: string; look?: PhotoLook;
  relativePath?: string; sessionId?: string; shotIndex?: number; exportStatus?: PhotoExportStatus;
};
export type PhotoCrop = { mode: 'fit' | 'fill'; x: number; y: number; zoom: number };
export type GridAspect = 'portrait' | 'square';
type CompositeRecipeFields = { layout: 'strip' | 'grid'; theme: 'classic' | 'botanical' | 'coastal'; photoIds: string[]; cropsByPhotoId: Record<string, PhotoCrop> };
export type CompositeRecipe = CompositeRecipeFields & (
  { version: 'wedding-template-v1' } | { version: 'wedding-template-v2'; gridAspect: GridAspect }
);
export type PublicationComposite = { photoId: string; layout: CompositeRecipe['layout']; theme: CompositeRecipe['theme'] } & (
  { version: 'wedding-template-v1' } | { version: 'wedding-template-v2'; gridAspect: GridAspect }
);
export type SessionComposite = { id: string; fileUri: string; exportStatus?: PhotoExportStatus; recipe: CompositeRecipe; originalPhotoIds: string[] };
export type SessionPublicationAssets = { photoIds: string[]; originalPhotoIds?: string[]; composite?: PublicationComposite };
export type TemplateDefaults = { layout: CompositeRecipe['layout']; theme: CompositeRecipe['theme']; gridAspect?: GridAspect };
export type RetakeSessionFields = { retakeOfSessionId?: string; retakeState?: 'open' | 'abandoned'; captureTiming?: CaptureTiming; templateDefaults?: TemplateDefaults };
export type ActiveSession = RetakeSessionFields & {
  id: string; createdAt: number; targetCount: number; shots: ActiveCapture[]; confirmed: boolean;
  composite?: SessionComposite; stagedComposites?: SessionComposite[];
  retakes?: ActiveCapture[]; stagedOriginals?: ActiveCapture[]; storageWarning?: 'index-repair-pending' | 'original-commit-pending' | 'composite-commit-pending';
};
export type PhotoLibraryCapability = {
  available: boolean; permission: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean; writeOnly: true;
};
