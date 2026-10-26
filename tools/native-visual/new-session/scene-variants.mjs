/** Four labeled variants of the owned fictional scene; not different real poses. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
export async function sceneVariants(asset) {
  const image = await loadImage(asset), colors = ['#CC352D', '#218D43', '#266BCE', '#AD46B1'];
  return colors.map((color, slot) => {
    const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0); ctx.lineWidth = 24; ctx.strokeStyle = color; ctx.strokeRect(12, 12, image.width - 24, image.height - 24);
    ctx.fillStyle = color; ctx.fillRect(24, 24, 340, 64); ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 36px sans-serif'; ctx.fillText(`FIXTURE ${slot + 1}`, 38, 70);
    for (const [x, y, name] of [[24, image.height - 92, 'BL'], [image.width - 118, 24, 'TR'], [image.width - 118, image.height - 92, 'BR']]) {
      ctx.fillStyle = color; ctx.fillRect(x, y, 94, 68); ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(`${slot + 1}${name}`, x + 8, y + 44);
    }
    return canvas.toBuffer('image/jpeg', 95);
  });
}
