/** Canvas approximation of declared v1/v2/v3 geometry/art. Native CoreImage/CoreText UNVERIFIED. */
import { syntheticTemplates as v1 } from './template-stub';
import { syntheticSource, syntheticRenderedBlobs, renderedImages } from './effects-stub';
import { fixtureControls } from './fixture-controls';
const cancelled = new Set<string>();
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
export function templateV2Geometry(recipe: any) {
  const strip = recipe.layout === 'strip', portrait = recipe.gridAspect === 'portrait';
  if (recipe.version === 'wedding-template-v3') return { width: strip ? 1200 : 2400, height: strip ? 3600 : 2400, windows: Array.from({ length: 4 }, (_, i) => strip ? { x: 100, y: 220 + i * 770, width: 1000, height: 750 } : { x: 160 + i % 2 * 1056, y: 180 + Math.floor(i / 2) * 1036, width: 1024, height: 1024 }) };
  return { width: strip ? 1200 : 2400, height: strip ? 3600 : portrait ? 3000 : 2400,
    windows: Array.from({ length: 4 }, (_, i) => strip ? { x: 60, y: 60 + i * 834, width: 1080, height: 810 }
      : portrait ? { x: 72 + i % 2 * 1140, y: 72 + Math.floor(i / 2) * 1356, width: 1116, height: 1332 }
      : { x: 96 + i % 2 * 1128, y: 60 + Math.floor(i / 2) * 1104, width: 1080, height: 1080 }) };
}
function decoration(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number, recipe: any, windows: any[], accent: string, mat: string) {
  ctx.fillStyle = mat;
  for (const w of windows) ctx.fillRect(w.x - 10, w.y - 10, w.width + 20, w.height + 20);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); for (const w of windows) ctx.rect(w.x, w.y, w.width, w.height); ctx.clip('evenodd'); ctx.strokeStyle = accent;
  if (recipe.theme === 'classic') {
    ctx.lineWidth = 2; ctx.strokeRect(20, 20, width - 40, height - 40); ctx.lineWidth = 1; ctx.strokeRect(30, 30, width - 60, height - 60);
    for (const w of windows) ctx.strokeRect(w.x - 7, w.y - 7, w.width + 14, w.height + 14);
  } else if (recipe.theme === 'botanical') {
    const branch = (x: number, y: number, sign: number, length: number) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(sign, 1); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(length * .35, -4, length * .7, -40, length, -45); ctx.stroke(); ctx.fillStyle = accent;
      for (let i = 1; i <= 6; i++) for (const side of [-1, 1]) { const px = i * length / 7, py = -i * 45 / 7; ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px - 6, py + side * 24, px + 19, py + side * 30); ctx.quadraticCurveTo(px + 28, py + side * 13, px, py); ctx.fill(); }
      ctx.restore();
    };
    const footerTop = Math.max(...windows.map(w => w.y + w.height)), strip = recipe.layout === 'strip', length = strip ? 160 : 270;
    branch(strip ? 75 : 120, footerTop + (height - footerTop) * .67, 1, length); branch(width - (strip ? 75 : 120), footerTop + (height - footerTop) * .38, -1, length);
    branch(20, 57, 1, 170); branch(width - 20, 40, -1, 170);
  } else {
    ctx.lineWidth = 3;
    for (let row = 0; row < 5; row++) { const y = height - 22 - row * 15, wing = recipe.layout === 'strip' ? 210 : 650;
      for (const mirror of [false, true]) { ctx.save(); if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); } ctx.beginPath(); ctx.moveTo(36, y); ctx.bezierCurveTo(wing * .35, y - 24, wing * .7, y + 20, wing, y - 8); ctx.stroke(); ctx.restore(); }
    }
    for (let row = 0; row < 3; row++) { const x = 18 + row * 13; ctx.beginPath(); ctx.moveTo(x, 35); ctx.bezierCurveTo(x + 18, height * .3, x - 10, height * .65, x + 4, height - 40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(width - x, 35); ctx.bezierCurveTo(width - x - 18, height * .3, width - x + 10, height * .65, width - x - 4, height - 40); ctx.stroke(); }
  }
  ctx.restore();
}
const artNames: Record<string, string> = { classic: 'Classic-Ivory', botanical: 'Sage-Botanical', coastal: 'Coastal-Sea-Glass' };
const artCache = new Map<string, Promise<ImageBitmap>>();
async function generatedArt(theme: string) {
  let image = artCache.get(theme);
  if (!image) { image = (async () => {
    const response = await fetch(`/frame-art-v1/${artNames[theme]}-Text-Free-Artwork.png`);
    if (!response.ok) throw new Error('Generated frame artwork unavailable');
    const bitmap = await createImageBitmap(await response.blob());
    if (bitmap.width !== 1254 || bitmap.height !== 1254) throw new Error('Generated artwork dimensions changed');
    return bitmap;
  })(); artCache.set(theme, image); }
  return image;
}
/** Nine-slice stretches only texture/edge fields, keeping each corner's aspect ratio. */
async function decorationV3(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number, recipe: any, windows: any[], accent: string) {
  const image = await generatedArt(recipe.theme), corner = recipe.layout === 'strip' ? 250 : 350;
  const src = [0, 250, 1004, 1254], dstX = [0, corner, width - corner, width], dstY = [0, corner, height - corner, height];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    ctx.drawImage(image, src[col], src[row], src[col + 1] - src[col], src[row + 1] - src[row], dstX[col], dstY[row], dstX[col + 1] - dstX[col], dstY[row + 1] - dstY[row]);
  }
  ctx.strokeStyle = accent; ctx.lineWidth = recipe.theme === 'classic' ? 1.5 : 1;
  const inset = recipe.layout === 'strip' ? 24 : 40;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.fillStyle = '#FAF7EE';
  for (const w of windows) ctx.fillRect(w.x, w.y, w.width, w.height);
}
export const syntheticTemplatesV2 = {
  templateVersion: 'wedding-template-v3',
  async inspectTemplateSources(sources: { photoId: string; uri: string }[]) {
    if (sources.length !== 4 || new Set(sources.map(s => s.photoId)).size !== 4) throw new Error('Invalid synthetic source inspection');
    const inspected = [];
    for (const source of sources) { const { bitmap, hash } = await syntheticSource(source.uri); inspected.push({ photoId: source.photoId, width: bitmap.width, height: bitmap.height, sha256: hash }); }
    const ratios = inspected.map(s => s.width / s.height).sort((a, b) => a - b), median = (ratios[1] + ratios[2]) / 2;
    const result = { version: 'wedding-template-v3' as const, gridAspect: median < .95 ? 'portrait' as const : 'square' as const, sources: inspected };
    fixtureControls.templateInspections.push({ ...result, median }); return result;
  },
  async renderTemplate(sources: { photoId: string; uri: string }[], recipeJSON: string, preview: boolean, requestID: string) {
    const recipe = JSON.parse(recipeJSON);
    if (recipe.version === 'wedding-template-v1') return v1.renderTemplate(sources, recipeJSON, preview, requestID);
    const ids = recipe.photoIds;
    if (!['wedding-template-v2', 'wedding-template-v3'].includes(recipe.version) || recipe.version === 'wedding-template-v3' && recipe.gridAspect !== 'square' || !['portrait', 'square'].includes(recipe.gridAspect) || !['strip', 'grid'].includes(recipe.layout) || !['classic', 'botanical', 'coastal'].includes(recipe.theme) || ids.length !== 4 || new Set(ids).size !== 4 || sources.some((s, i) => s.photoId !== ids[i])) throw new Error('Invalid synthetic v2 recipe');
    const event = { requestID, recipeJSON, preview, status: 'started', uri: '', browserURI: '', jpegSHA256: '', sourceHashes: {} as Record<string, string> }; fixtureControls.templateRenders.push(event);
    if (fixtureControls.templateDelayMs) await new Promise(resolve => setTimeout(resolve, fixtureControls.templateDelayMs));
    if (cancelled.has(requestID) && !fixtureControls.templatesIgnoreCancellation) { event.status = 'cancelled'; throw new Error('Synthetic template cancelled'); }
    const { width, height, windows } = templateV2Geometry(recipe), strip = recipe.layout === 'strip';
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
    const [paper, ink, accent] = ({ classic: ['#F6F0E4', '#372D27', '#B6A07C'], botanical: ['#DCE5D6', '#2D4537', '#6D8367'], coastal: ['#DBEBE7', '#244C49', '#6B9F99'] } as Record<string, string[]>)[recipe.theme];
    ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height);
    if (recipe.version === 'wedding-template-v3') await decorationV3(ctx, width, height, recipe, windows, accent);
    else decoration(ctx, width, height, recipe, windows, accent, recipe.theme === 'classic' ? paper : '#FAF7EE');
    const sourceHashes: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      const { bitmap, hash } = await syntheticSource(sources[i].uri); sourceHashes[ids[i]] = hash;
      const crop = recipe.cropsByPhotoId[ids[i]], w = windows[i];
      if (!['fit', 'fill'].includes(crop.mode) || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || Math.abs(crop.x) > 1 || Math.abs(crop.y) > 1 || crop.zoom < 1 || crop.zoom > 1.5 || crop.mode === 'fit' && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1)) throw new Error('Invalid synthetic v2 crop');
      const scale = (crop.mode === 'fit' ? Math.min(w.width / bitmap.width, w.height / bitmap.height) : Math.max(w.width / bitmap.width, w.height / bitmap.height)) * crop.zoom;
      const dw = bitmap.width * scale, dh = bitmap.height * scale, dx = w.x + (w.width - dw) / 2 - crop.x * Math.max(0, dw - w.width) / 2, dy = w.y + (w.height - dh) / 2 - crop.y * Math.max(0, dh - w.height) / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(w.x, w.y, w.width, w.height); ctx.clip(); ctx.drawImage(bitmap, dx, dy, dw, dh); ctx.restore();
    }
    const footerTop = Math.max(...windows.map(w => w.y + w.height)), compact = !strip && recipe.gridAspect === 'square';
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = `${strip ? 86 : 84}px Georgia, serif`; ctx.fillText('Gizelle & Rami', width / 2, recipe.version === 'wedding-template-v3' ? strip ? 3420 : 2310 : strip ? 3480 : footerTop + (compact ? 86 : 116));
    ctx.font = `${strip ? 36 : 32}px sans-serif`; ctx.fillText('NOVEMBER 1, 2026', width / 2, recipe.version === 'wedding-template-v3' ? strip ? 3490 : 2360 : strip ? 3535 : footerTop + (compact ? 133 : 174));
    const factor = preview ? Math.min(1, 1440 / Math.max(width, height)) : 1, outWidth = Math.round(width * factor), outHeight = Math.round(height * factor), output = new OffscreenCanvas(outWidth, outHeight);
    output.getContext('2d')!.drawImage(canvas, 0, 0, outWidth, outHeight); const blob = await output.convertToBlob({ type: 'image/jpeg', quality: .95 });
    const uri = `file:///synthetic-templates/${crypto.randomUUID()}.jpg`; syntheticRenderedBlobs.set(uri, blob); renderedImages.set(uri, URL.createObjectURL(blob)); event.uri = uri; event.browserURI = renderedImages.get(uri)!;
    event.jpegSHA256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join(''); event.status = 'complete'; event.sourceHashes = sourceHashes;
    return { uri, width: outWidth, height: outHeight, preview, version: recipe.version, recipeJSON: JSON.stringify(canonical(recipe)), sourceHashes };
  },
  cancelTemplate(id: string) { cancelled.add(id); fixtureControls.templateCancellations.push(id); v1.cancelTemplate(id); },
  async releaseTemplate(uri: string) { return v1.releaseTemplate(uri); },
};
