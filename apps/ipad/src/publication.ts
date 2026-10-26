import type { SessionComposite, SessionPublicationAssets } from './local-types';

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
  if (recipe.version !== 'wedding-template-v1' || !['strip', 'grid'].includes(recipe.layout) ||
    !['classic', 'botanical', 'coastal'].includes(recipe.theme) || recipe.photoIds.length !== 4 ||
    new Set(recipe.photoIds).size !== 4 || recipe.photoIds.some(id => !ids.includes(id)) ||
    !recipe.cropsByPhotoId || Object.keys(recipe.cropsByPhotoId).length !== 4) return null;
  for (const id of recipe.photoIds) {
    const crop = recipe.cropsByPhotoId[id];
    if (!crop || !['fit', 'fill'].includes(crop.mode) || !Number.isFinite(crop.x) || Math.abs(crop.x) > 1 ||
      !Number.isFinite(crop.y) || Math.abs(crop.y) > 1 || !Number.isFinite(crop.zoom) || crop.zoom < 1 || crop.zoom > 1.5 ||
      (crop.mode === 'fit' && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1))) return null;
  }
  const originals = recipe.photoIds.map(id => {
    const shot = session.shots.find(shot => shot.id === id)!;
    return shot.sourcePhotoId ?? shot.id;
  });
  if (new Set(originals).size !== 4 || originals.includes(composite.id) || composite.originalPhotoIds.length !== 4 ||
    originals.some((id, index) => id !== composite.originalPhotoIds[index])) return null;
  return { photoIds: [...recipe.photoIds], originalPhotoIds: originals, composite: {
    photoId: composite.id, layout: recipe.layout, theme: recipe.theme, version: recipe.version,
  } };
}

export function publicationAssetIds(assets: SessionPublicationAssets): string[] {
  return [...new Set([...assets.photoIds, ...(assets.originalPhotoIds ?? []), ...(assets.composite ? [assets.composite.photoId] : [])])];
}
