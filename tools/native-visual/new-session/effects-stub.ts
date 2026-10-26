/** DEV ONLY: Canvas approximation of recipe v1; never CoreImage/native pixel proof. */
import { fixtureControls } from './fixture-controls';
export const durableRenderedImages = new Map<string, string>();
export const renderedImages = new Map<string, string>();
const rendered = new Map<string, Blob>();
const cancelled = new Set<string>();
export const originalImageVariants = new Map<string, number>();
const originals = new Map<string, Promise<{ bitmap: ImageBitmap; hash: string }>>();
export function browserImageURI(uri: string): string {
  if (durableRenderedImages.has(uri)) return durableRenderedImages.get(uri)!;
  if (renderedImages.has(uri)) return renderedImages.get(uri)!;
  const match = /^file:\/\/\/synthetic\/([a-zA-Z0-9-]+)\.jpg$/.exec(uri);
  if (match) return originalImageVariants.has(uri) ? `/synthetic/shot/${match[1]}.png?variant=${originalImageVariants.get(uri)}` : `/synthetic/shot/${match[1]}.png`;
  return uri;
}
export async function syntheticSource(uri: string) {
  const route = browserImageURI(uri);
  let pending = originals.get(route);
  if (!pending) { pending = (async () => {
    const bytes = await (await fetch(route)).arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    return { bitmap: await createImageBitmap(new Blob([bytes])), hash };
  })(); originals.set(route, pending); }
  return pending;
}
export async function copyRenderedImage(uri: string, canonical: string) {
  const blob = rendered.get(uri);
  if (!blob || blob.type !== 'image/jpeg') throw new Error('Synthetic rendered JPEG missing');
  durableRenderedImages.set(canonical, URL.createObjectURL(blob.slice(0, blob.size, 'image/jpeg')));
}
export const syntheticPhotoEffects = {
  capabilityVersion: 1, recipeVersion: 'wedding-ci-srgb-v1',
  async render(sourceUri: string, preset: string, intensity: number, preview: boolean, requestID: string) {
    if (!/^file:\/\/\/synthetic\/[a-zA-Z0-9-]+\.jpg$/.test(sourceUri) || durableRenderedImages.has(sourceUri)) throw new Error('Only immutable synthetic originals are accepted');
    if (!['original', 'warm', 'bw', 'film'].includes(preset) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new Error('Invalid synthetic look');
    const event = { requestID, sourceUri, preset, intensity, preview, status: 'started', uri: '' };
    fixtureControls.effectRenders.push(event);
    const { bitmap, hash } = await syntheticSource(sourceUri);
    if (fixtureControls.effectDelayMs) await new Promise(resolve => setTimeout(resolve, fixtureControls.effectDelayMs));
    if (cancelled.has(requestID) && !fixtureControls.effectsIgnoreCancellation) { event.status = 'cancelled'; throw new Error('Synthetic render cancelled'); }
    const scale = preview ? Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height)) : 1;
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    if (!preview && (preset === 'original' || intensity === 0)) { event.status = 'original'; return { uri: sourceUri, width, height, recipeVersion: this.recipeVersion, preset, intensity, originalSha256: hash, isOriginal: true, preview }; }
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height), data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [data[i], data[i + 1], data[i + 2]].map(v => v / 255);
      const luma = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      let effect = rgb;
      if (preset === 'warm') effect = rgb.map((v, c) => v * [1.045, 1.008, .955][c]);
      if (preset === 'bw') effect = rgb.map(() => (luma - .5) * 1.035 + .5);
      if (preset === 'film') effect = rgb.map((v, c) => ((luma + .86 * (v - luma)) - .5) * .94 + .5 + [.018, .012, .005][c]);
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(255 * Math.max(0, Math.min(1, rgb[c] + intensity * (effect[c] - rgb[c]))));
    }
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .95 });
    const uri = `file:///synthetic-effects/${crypto.randomUUID()}.jpg`; rendered.set(uri, blob); renderedImages.set(uri, URL.createObjectURL(blob)); event.uri = uri; event.status = 'complete';
    return { uri, width, height, recipeVersion: this.recipeVersion, preset, intensity, originalSha256: hash, isOriginal: false, preview };
  },
  cancel(requestID: string) { cancelled.add(requestID); fixtureControls.effectCancellations.push(requestID); },
  async release(uri: string) { if (rendered.delete(uri)) { URL.revokeObjectURL(renderedImages.get(uri)!); renderedImages.delete(uri); fixtureControls.effectReleases.push(uri); } },
};

export const syntheticRenderedBlobs = rendered;
