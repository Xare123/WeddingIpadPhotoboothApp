import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'artifacts/deploy');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['services/api/src/index.ts'],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  outfile: resolve(output, 'worker.mjs'), legalComments: 'eof',
});
const bytes = await readFile(resolve(output, 'worker.mjs'));
const source = await readFile(resolve(root, 'services/api/src/index.ts'));
const manifest = {
  artifact: 'worker.mjs', format: 'esm', generatedAt: new Date().toISOString(),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  bytes: bytes.length, compatibilityDate: '2026-10-25',
  existingPrivateBucket: 'gizelleandrami-photoboothphotos',
  proposedOrigin: 'https://photos.gizelleandrami.com',
  variables: { MODE: 'production', SMS_MODE: 'mock',
    PUBLIC_ORIGIN: 'https://photos.gizelleandrami.com', LINK_TTL_SECONDS: '86400' },
  secretNames: ['DEVICE_TOKEN', 'LINK_SIGNING_KEY'],
  binding: { type: 'r2_bucket', name: 'PHOTOS', bucket_name: 'gizelleandrami-photoboothphotos' },
  deployed: false,
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared local Worker artifact (${bytes.length} bytes). No deployment performed.`);
