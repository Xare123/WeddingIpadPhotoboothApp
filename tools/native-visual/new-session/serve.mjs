/** DEV ONLY. Actual JSX; in-memory native boundaries; never a deployment target. */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sceneVariants } from './scene-variants.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const variants = await sceneVariants(path.join(root, 'apps/ipad/assets/attract-scene.png'));
const cleanDirectory = path.join(root, '.cache/clean-design-fixtures/v2-studio');
async function cleanPhotos(files) {
  try { return await Promise.all(files.map(async file => {
    try { return { file, bytes: await readFile(path.join(root, 'apps/ipad/native-tests/fixtures/studio', file)) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { file, bytes: await readFile(path.join(cleanDirectory, file)) }; }
  })); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
const cleanPortrait = await cleanPhotos(['portrait-1.jpg', 'portrait-2.jpg', 'portrait-3.jpg', 'portrait-4.jpg']);
const cleanMixed = await cleanPhotos(['landscape-1.jpg', 'portrait-1.jpg', 'landscape-2.jpg', 'portrait-2.jpg']);
const photoSets = { marker: variants, ...(cleanPortrait ? { 'clean-portrait': cleanPortrait.map(p => p.bytes) } : {}), ...(cleanMixed ? { 'clean-mixed': cleanMixed.map(p => p.bytes) } : {}) };
const fixturePhotoSets = Object.fromEntries(Object.entries(photoSets).map(([name, photos]) => [name, { scope: name === 'marker' ? 'Owned fictional scene with diagnostic edge markers; correctness fixtures.' : 'Distinct newly image_gen-generated fictional scenes; clean design fixtures, not marker edge proof.', sources: photos.map((bytes, index) => ({ index, sha256: createHash('sha256').update(bytes).digest('hex') })) }]));
const temporary = path.join(root, '.cache/new-session-visual');
await mkdir(temporary, { recursive: true });
await mkdir(path.join(root, 'artifacts/visual'), { recursive: true });
const provisional = process.argv.includes('--provisional');
const hostSharingEvidence = process.argv.includes('--host-sharing-evidence');
const orientationRetakeEvidence = process.argv.includes('--orientation-retake-evidence');
const evidenceRoot = provisional ? orientationRetakeEvidence ? '.cache/orientation-retake-provisional' : hostSharingEvidence ? '.cache/host-sharing-provisional' : '.cache/keepsake-provisional' : 'artifacts/visual';
await mkdir(path.join(root, evidenceRoot), { recursive: true });
const keepsakeEvidence = process.argv.includes('--keepsake-evidence');
const timerEvidence = process.argv.includes('--timer-evidence');
const templateEvidence = process.argv.includes('--template-evidence');
const looksEvidence = process.argv.includes('--looks-evidence');
const developmentUI = process.argv.includes('--development-ui');
const result = await build({
  absWorkingDir: root, entryPoints: ['tools/native-visual/new-session/entry.tsx'], bundle: true, write: false, metafile: true,
  format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { global: 'globalThis', __DEV__: String(developmentUI), 'process.env.NODE_ENV': '"development"', 'process.env.EXPO_PUBLIC_E2E_FIXTURE': '"0"' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: { 'react-native': path.join(here, 'native-runtime.ts'), 'expo-glass-effect': path.join(here, 'glass-stub.tsx'), 'expo': path.join(here, 'stubs.tsx'), 'react-native-safe-area-context': path.join(here, 'safe-area-stub.tsx'), 'react-native-svg': path.join(root, 'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js'), '@react-native/assets-registry/registry': path.join(root, 'node_modules/react-native-web/dist/modules/AssetRegistry/index.js') },
  plugins: [{ name: 'explicit-synthetic-device-boundaries', setup(api) {
    api.onResolve({ filter: /^(expo-camera|expo-crypto|expo-secure-store|expo-media-library(?:\/legacy)?|\.\/src\/(config|host-auth|storage|sync|orientation-native)|\.\/(storage|config|orientation-native))$/ }, args => {
      if (args.path.startsWith('.') && !args.importer.startsWith(path.join(root, 'apps/ipad/'))) return;
      return { path: path.join(here, 'stubs.tsx') };
    });
    api.onResolve({ filter: /^(\.\/src\/native-fixture|\.\/native-fixture)$/ }, () => ({ path: path.join(here, 'native-fixture-disabled.ts') }));
    api.onResolve({ filter: /(^|\/)assets\/attract-scene\.png$/ }, () => ({ path: 'attract-scene', namespace: 'fixture-asset' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture-asset' }, () => ({ contents: 'module.exports={uri:"/attract-scene.png"};', loader: 'js' }));
    api.onResolve({ filter: /NativeSvgSoundModule$/ }, () => ({ path: 'native-svg-sound', namespace: 'fixture-sound' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture-sound' }, () => ({ contents: 'export default {playSound:()=>{}};' }));
  } }],
});
const inputs = Object.keys(result.metafile.inputs);
const forbiddenInputs = inputs.filter(input => /(^|\/)(expo-file-system|expo-sqlite|expo-media-library|expo-glass-effect|expo-screen-orientation|react-native-safe-area-context)\/|(^|\/)apps\/ipad\/src\/(native-fixture|storage|sync|config|orientation-native)\.(ts|tsx)$|native-tests\/fixtures\//.test(input));
if (forbiddenInputs.length) throw new Error('Native device implementation leaked into the browser fixture: ' + forbiddenInputs.join(', '));
const sourceHashes = {};
for (const file of ['apps/ipad/app.json', 'apps/ipad/src/config.ts', 'apps/ipad/src/TimingSheet.tsx', 'apps/ipad/src/capture-timing.ts', 'apps/ipad/src/timing-controls.ts', 'apps/ipad/src/provisioning.ts', 'apps/ipad/App.tsx', 'apps/ipad/src/window-overlay.tsx', 'apps/ipad/src/orientation-controller.ts', 'apps/ipad/src/GlassSurface.tsx', 'apps/ipad/src/glass-policy.ts', 'apps/ipad/src/host-visibility.ts', 'apps/ipad/src/photo-look-editor.ts', 'apps/ipad/src/native-photo-effects.ts', 'apps/ipad/src/local-types.ts', 'apps/ipad/src/template-editor.ts', 'apps/ipad/src/TemplateStudio.tsx', 'apps/ipad/src/publication.ts', 'apps/ipad/src/session-capture.ts', 'apps/ipad/src/review-selection.ts', 'apps/ipad/src/sharing.ts', 'apps/ipad/src/SmsShare.tsx', 'apps/ipad/src/sms-state.ts', 'apps/ipad/src/booth-presentation.ts', 'apps/ipad/src/host-originals.ts', 'apps/ipad/src/photo-export.ts', 'apps/ipad/src/photo-library.ts', 'packages/core/src/index.ts', 'apps/ipad/assets/attract-scene.png']) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const sourceSHA256 = sourceHashes['apps/ipad/App.tsx'];
if (hostSharingEvidence || orientationRetakeEvidence) for (const file of ['apps/ipad/src/host-auth.ts', 'apps/ipad/src/host-auth-policy.ts', 'apps/ipad/src/host-action-auth.ts', 'apps/ipad/src/share-readiness.ts', 'apps/ipad/src/sharing-request.ts', 'apps/ipad/src/sync-preflight.ts', 'apps/ipad/src/sync.ts', 'apps/ipad/src/session-sync.ts', 'apps/ipad/src/queue-index.ts']) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
if (orientationRetakeEvidence) for (const file of ['apps/ipad/src/orientation-controller.ts', 'apps/ipad/src/orientation-native.ts', 'apps/ipad/src/local-persistence.ts', 'apps/ipad/src/storage.ts', 'apps/ipad/package.json', 'package-lock.json']) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const fixtureSourceHashes = {};
if (hostSharingEvidence || orientationRetakeEvidence) for (const file of ['serve.mjs', 'entry.tsx', 'fixture-controls.ts', 'stubs.tsx', 'native-runtime.ts', 'safe-area-stub.tsx', 'glass-stub.tsx', 'effects-stub.ts', 'template-stub.ts', 'template-v2-stub.ts', 'native-fixture-disabled.ts']) fixtureSourceHashes['tools/native-visual/new-session/' + file] = createHash('sha256').update(await readFile(path.join(here, file))).digest('hex');
const boundary = { scope: 'DEV-ONLY browser rendering of actual native JSX; synthetic device adapters, not iOS verification.', sourceSHA256, sourceHashes, ...(hostSharingEvidence || orientationRetakeEvidence ? { fixtureSourceHashes } : {}), developmentUI, nativeFixtureEnabled: false, defaultPhotoSet: 'marker', fixturePhotoSets, templateAdapter: 'wedding-template-v3 generated artwork Canvas approximation; legacy-v1/v2 renderer retained unchanged', forbiddenInputs, inputs };
await writeFile(path.join(temporary, 'fixture.js'), result.outputFiles[0].contents);
await writeFile(path.join(root, orientationRetakeEvidence ? path.join(evidenceRoot, 'orientation-retake-bundle-boundary.json') : hostSharingEvidence ? path.join(evidenceRoot, 'host-sharing-bundle-boundary.json') : timerEvidence ? path.join(evidenceRoot, 'timer-bundle-boundary.json') : keepsakeEvidence ? path.join(evidenceRoot, 'keepsake-bundle-boundary.json') : templateEvidence ? 'artifacts/visual/templates-bundle-boundary.json' : looksEvidence ? 'artifacts/visual/looks-bundle-boundary.json' : 'artifacts/visual/new-session-bundle-boundary.json'), JSON.stringify(boundary, null, 2) + '\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEV ONLY · Native JSX browser fixture</title><style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;flex-direction:column;background:#f6efe4}#root{flex:1;min-height:0}#root>div{height:100%}#new-session-fixture-banner{box-sizing:border-box;padding:7px 10px;flex:none;font:11px/16px system-ui,sans-serif;text-align:center;background:#17382d;color:#fff;z-index:2147483647;position:relative}
</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8791');
  if (url.pathname === '/fixture.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(result.outputFiles[0].contents); }
  else if (/^\/frame-art-v1\/(Classic-Ivory|Sage-Botanical|Coastal-Sea-Glass)-Text-Free-Artwork\.png$/.test(url.pathname)) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(await readFile(path.join(root, 'design', url.pathname))); }
  else if (url.pathname === '/fixture-provenance.json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(boundary)); }
  else if (url.pathname === '/attract-scene.png' || /^\/synthetic\/shot\/[a-zA-Z0-9-]+\.png$/.test(url.pathname)) {
    if (url.searchParams.has('variant')) { const photos = photoSets[url.searchParams.get('photos') ?? 'marker']; if (!photos) { response.writeHead(400); response.end('Unknown synthetic photo set'); return; } response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(photos[Number(url.searchParams.get('variant')) % 4]); }
    else { response.writeHead(200, { 'content-type': 'image/png' }); response.end(await readFile(path.join(root, 'apps/ipad/assets/attract-scene.png'))); }
  } else { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); }
});
server.listen(8791, '127.0.0.1', () => console.log('DEV-ONLY native JSX fixture on 127.0.0.1:8791; synthetic camera/files/SQLite/media/sync, not native verification.'));
process.on('SIGTERM', () => server.close());
