/** Two independent full-frame decoders; actual screenshot bytes, no enhancement. */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const tools = createRequire(new URL('../../../.cache/qr-tools/package.json', import.meta.url));
const require = createRequire(import.meta.url);
const { PNG } = tools('pngjs');
const jsQR = tools('jsqr');
const cpp = tools('zxing-wasm/reader');
const encoder = require('qrcode');
cpp.prepareZXingModule({ overrides: { wasmBinary: await readFile(tools.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
export const decoderVersions = { jsQR: '1.4.0', zxingCppWasm: '3.1.6', pngjs: '7.0.0', encoder: '1.5.4' };
export async function decodeFullFrame(bytes, expectedURL) {
  const image = PNG.sync.read(bytes);
  const data = new Uint8ClampedArray(image.data);
  const detected = await cpp.readBarcodes({ data, width: image.width, height: image.height }, { formats: ['QRCode'] });
  const javascript = jsQR(data, image.width, image.height);
  return { width: image.width, height: image.height, expectedURL, jsQR: javascript?.data ?? null, zxingCpp: detected.map(value => ({ text: value.text, error: value.error })), matrixModules: encoder.create(expectedURL, { errorCorrectionLevel: 'M' }).modules.size };
}
