import type { CompositeRecipe, PublicationComposite, SessionComposite, SessionPublicationAssets } from './local-types';

const localId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
// Keep the persisted version explicit. Recovery never infers a missing v2
// aspect or interprets an existing v1 recipe using newer template geometry.
export function validCompositeRecipe(value: unknown): value is CompositeRecipe {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const recipe = value as CompositeRecipe;
  if (recipe.version !== 'wedding-template-v1' && recipe.version !== 'wedding-template-v2') return false;
  const keys = ['version', 'layout', 'theme', 'photoIds', 'cropsByPhotoId', ...(recipe.version === 'wedding-template-v2' ? ['gridAspect'] : [])];
  if (Object.keys(recipe).length !== keys.length || Object.keys(recipe).some(key => !keys.includes(key)) ||
    (recipe.version === 'wedding-template-v2' && !['portrait', 'square'].includes(recipe.gridAspect)) ||
    !['strip', 'grid'].includes(recipe.layout) || !['classic', 'botanical', 'coastal'].includes(recipe.theme) ||
    !Array.isArray(recipe.photoIds) || recipe.photoIds.length !== 4 || !recipe.photoIds.every(localId) || new Set(recipe.photoIds).size !== 4 ||
    !recipe.cropsByPhotoId || typeof recipe.cropsByPhotoId !== 'object' || Array.isArray(recipe.cropsByPhotoId) || Object.keys(recipe.cropsByPhotoId).length !== 4) return false;
  return recipe.photoIds.every(id => {
    const crop = recipe.cropsByPhotoId[id];
    return !!crop && typeof crop === 'object' && !Array.isArray(crop) && Object.keys(crop).length === 4 &&
      Object.keys(crop).every(key => ['mode', 'x', 'y', 'zoom'].includes(key)) && ['fit', 'fill'].includes(crop.mode) &&
      Number.isFinite(crop.x) && Math.abs(crop.x) <= 1 && Number.isFinite(crop.y) && Math.abs(crop.y) <= 1 &&
      Number.isFinite(crop.zoom) && crop.zoom >= 1 && crop.zoom <= 1.5 &&
      (crop.mode !== 'fit' || (crop.x === 0 && crop.y === 0 && crop.zoom === 1));
  });
}

export function publicationComposite(photoId: string, recipe: CompositeRecipe): PublicationComposite {
  const common = { photoId, layout: recipe.layout, theme: recipe.theme };
  return recipe.version === 'wedding-template-v2' ? { ...common, version: recipe.version, gridAspect: recipe.gridAspect } : { ...common, version: recipe.version };
}

export type PublicationSession = {
  id: string; confirmed: boolean; targetCount?: number;
  shots: { id: string; sessionId?: string; sourcePhotoId?: string; shotIndex?: number }[];
  composite?: SessionComposite;
};

// A hydrated confirmed manifest supplies durable lineage. Queue acknowledgements
// alone cannot make a stale template or an unrelated original publishable.
export function publicationAssets(session: PublicationSession): SessionPublicationAssets | null {
  const ids = session.shots.map(shot => shot.id);
  if (!session.confirmed || !ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length ||
    (session.targetCount !== undefined && session.targetCount !== ids.length) ||
    session.shots.some(shot => shot.sessionId !== undefined && shot.sessionId !== session.id)) return null;
  if (ids.length !== 4) return session.composite ? null : { photoIds: ids };
  const composite = session.composite;
  if (!composite || !composite.id || !composite.fileUri.startsWith('file://') || ids.includes(composite.id)) return null;
  const recipe = composite.recipe;
  if (!validCompositeRecipe(recipe) || recipe.photoIds.some(id => !ids.includes(id))) return null;
  const originals = recipe.photoIds.map(id => {
    const shot = session.shots.find(shot => shot.id === id)!;
    return shot.sourcePhotoId ?? shot.id;
  });
  if (new Set(originals).size !== 4 || originals.includes(composite.id) || !Array.isArray(composite.originalPhotoIds) || composite.originalPhotoIds.length !== 4 ||
    originals.some((id, index) => id !== composite.originalPhotoIds[index])) return null;
  return { photoIds: [...recipe.photoIds], originalPhotoIds: originals, composite: publicationComposite(composite.id, recipe) };
}

export function publicationAssetIds(assets: SessionPublicationAssets): string[] {
  return [...new Set([...assets.photoIds, ...(assets.originalPhotoIds ?? []), ...(assets.composite ? [assets.composite.photoId] : [])])];
}
