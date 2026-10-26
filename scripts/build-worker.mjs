import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'artifacts/deploy');
const configPath = resolve(root, 'services/api/wrangler.production.EXAMPLE.jsonc');
const parsed = ts.parseConfigFileTextToJson(configPath, await readFile(configPath, 'utf8'));
if (parsed.error) throw new Error('Production example configuration is invalid');
const config = parsed.config;
const secretNames = ['DEVICE_TOKEN', 'LINK_SIGNING_KEY', 'TEXTBELT_API_KEY'];
if (secretNames.some(name => Object.hasOwn(config.vars, name))) {
  throw new Error('Production secrets must not be included in configuration or artifacts');
}
const bindings = [
  ...config.r2_buckets.map(({ binding, ...value }) => ({ name: binding, type: 'r2_bucket', ...value })),
  ...config.ratelimits.map(value => ({ type: 'ratelimit', ...value })),
  ...Object.entries(config.vars).map(([name, text]) => ({ name, type: 'plain_text', text })),
];
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
  bytes: bytes.length, compatibilityDate: config.compatibility_date,
  proposedWorker: config.name,
  existingPrivateBucket: config.r2_buckets[0].bucket_name,
  proposedOrigin: config.vars.PUBLIC_ORIGIN,
  variables: config.vars,
  secretNames,
  requiredSecretNames: ['DEVICE_TOKEN', 'LINK_SIGNING_KEY'],
  optionalSecretNames: { approvedSms: ['TEXTBELT_API_KEY'] },
  pairingUsesExistingBoothAuthority: true,
  binding: bindings.find(value => value.type === 'r2_bucket'),
  bindings,
  rateLimitNamespaceIdsRequireReview: true,
  rateLimitScope: 'Approximate per Cloudflare POP; not a strict global request budget or financial cap',
  staticAssetsBindingRequired: false,
  deploymentMetadata: {
    main_module: 'worker.mjs', compatibility_date: config.compatibility_date,
    bindings, observability: config.observability,
    keep_bindings: ['secret_text'],
    logpush: false, tail_consumers: [],
  },
  exposure: { workers_dev: config.workers_dev, preview_urls: config.preview_urls },
  deployed: false,
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared local Worker artifact (${bytes.length} bytes). No deployment performed.`);
