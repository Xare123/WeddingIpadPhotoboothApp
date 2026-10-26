/** Browser Canvas template approximation. Native CoreImage/CoreText UNVERIFIED. */
import { syntheticSource, syntheticRenderedBlobs, renderedImages } from './effects-stub';
import { fixtureControls } from './fixture-controls';
const cancelled = new Set<string>();
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
export const syntheticTemplates = {
  templateVersion: 'wedding-template-v1',
  async renderTemplate(sources: { photoId: string; uri: string }[], recipeJSON: string, preview: boolean, requestID: string) {
    const recipe = JSON.parse(recipeJSON), ids = recipe.photoIds;
    if (recipe.version !== this.templateVersion || !['strip', 'grid'].includes(recipe.layout) || !['classic', 'botanical', 'coastal'].includes(recipe.theme) || ids.length !== 4 || new Set(ids).size !== 4 || sources.some((s, i) => s.photoId !== ids[i])) throw new Error('Invalid synthetic template');
    const event = { requestID, recipeJSON, preview, status: 'started', uri: '', sourceHashes: {} as Record<string, string> };
    fixtureControls.templateRenders.push(event);
    if (fixtureControls.templateDelayMs) await new Promise(resolve => setTimeout(resolve, fixtureControls.templateDelayMs));
    if (cancelled.has(requestID) && !fixtureControls.templatesIgnoreCancellation) { event.status = 'cancelled'; throw new Error('Synthetic template cancelled'); }
    const strip = recipe.layout === 'strip', width = strip ? 1200 : 2400, height = strip ? 3600 : 2100;
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
    const [background, ink, accent] = ({ classic: ['#F6F1E7', '#352B25', '#BCA68B'], botanical: ['#EEF1E8', '#31483A', '#8B9B80'], coastal: ['#EDF4F2', '#274541', '#8FB7AE'] } as Record<string, string[]>)[recipe.theme];
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    const sourceHashes: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      const { bitmap, hash } = await syntheticSource(sources[i].uri); sourceHashes[ids[i]] = hash;
      const crop = recipe.cropsByPhotoId[ids[i]], x = strip ? 60 : 96 + i % 2 * 1128, y = strip ? 60 + i * 834 : 96 + Math.floor(i / 2) * 858, w = 1080, h = 810;
      if (!['fit', 'fill'].includes(crop.mode) || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || Math.abs(crop.x) > 1 || Math.abs(crop.y) > 1 || crop.zoom < 1 || crop.zoom > 1.5 || crop.mode === 'fit' && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1)) throw new Error('Invalid synthetic crop');
      const scale = (crop.mode === 'fit' ? Math.min(w / bitmap.width, h / bitmap.height) : Math.max(w / bitmap.width, h / bitmap.height)) * crop.zoom;
      const dw = bitmap.width * scale, dh = bitmap.height * scale;
      const dx = x + (w - dw) / 2 - crop.x * Math.max(0, dw - w) / 2, dy = y + (h - dh) / 2 - crop.y * Math.max(0, dh - h) / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(bitmap, dx, dy, dw, dh); ctx.restore();
    }
    const center = width / 2, footerY = strip ? 3457 : 1870;
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = `${strip ? 52 : 64}px Georgia, serif`; ctx.fillText('Gizelle & Rami', center, footerY);
    ctx.font = `${strip ? 21 : 25}px sans-serif`; ctx.fillText('NOVEMBER 1, 2026', center, strip ? 3510 : 1936);
    const decorationY = strip ? 3542 : 1982;
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
    if (recipe.theme === 'classic') { ctx.beginPath(); ctx.moveTo(center - 80, decorationY); ctx.lineTo(center + 80, decorationY); ctx.stroke(); }
    if (recipe.theme === 'botanical') {
      for (const sign of [-1, 1]) {
        const x = center + sign * 180;
        ctx.beginPath(); ctx.moveTo(x - 45, decorationY); ctx.lineTo(x + 45, decorationY - 9); ctx.stroke();
        for (let step = 0; step < 5; step++) { const sx = x - 30 + step * 15; ctx.beginPath(); ctx.moveTo(sx, decorationY - 3); ctx.quadraticCurveTo(sx + 2, decorationY - 15, sx + 9, decorationY - 17); ctx.stroke(); }
      }
    }
    if (recipe.theme === 'coastal') {
      for (let row = 0; row < 2; row++) {
        ctx.strokeStyle = row === 0 ? accent : '#D4C1A2'; ctx.beginPath(); ctx.moveTo(center - 150, decorationY + row * 9);
        for (let step = 0; step < 6; step++) { const x = center - 150 + step * 50; ctx.bezierCurveTo(x + 16, decorationY - 10 + row * 9, x + 34, decorationY + 10 + row * 9, x + 50, decorationY + row * 9); } ctx.stroke();
      }
    }
    const factor = preview ? Math.min(1, 1440 / Math.max(width, height)) : 1;
    const outWidth = Math.round(width * factor), outHeight = Math.round(height * factor), output = new OffscreenCanvas(outWidth, outHeight);
    output.getContext('2d')!.drawImage(canvas, 0, 0, outWidth, outHeight);
    const blob = await output.convertToBlob({ type: 'image/jpeg', quality: .95 });
    const uri = `file:///synthetic-templates/${crypto.randomUUID()}.jpg`; syntheticRenderedBlobs.set(uri, blob); renderedImages.set(uri, URL.createObjectURL(blob));
    event.uri = uri; event.status = 'complete'; event.sourceHashes = sourceHashes;
    return { uri, width: outWidth, height: outHeight, preview, version: this.templateVersion, recipeJSON: JSON.stringify(canonical(recipe)), sourceHashes };
  },
  cancelTemplate(id: string) { cancelled.add(id); fixtureControls.templateCancellations.push(id); },
  async releaseTemplate(uri: string) { if (syntheticRenderedBlobs.delete(uri)) { URL.revokeObjectURL(renderedImages.get(uri)!); renderedImages.delete(uri); fixtureControls.templateReleases.push(uri); } },
};
