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
const temporary = path.join(root, '.cache/new-session-visual');
await mkdir(temporary, { recursive: true });
await mkdir(path.join(root, 'artifacts/visual'), { recursive: true });
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
    api.onResolve({ filter: /^(expo-camera|expo-crypto|expo-secure-store|expo-media-library(?:\/legacy)?|\.\/src\/(config|host-auth|storage|sync)|\.\/storage|\.\/config)$/ }, args => {
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
const forbiddenInputs = inputs.filter(input => /(^|\/)(expo-file-system|expo-sqlite|expo-media-library|expo-glass-effect|react-native-safe-area-context)\/|(^|\/)apps\/ipad\/src\/(native-fixture|storage|sync|config)\.(ts|tsx)$|native-tests\/fixtures\//.test(input));
if (forbiddenInputs.length) throw new Error('Native device implementation leaked into the browser fixture: ' + forbiddenInputs.join(', '));
const sourceHashes = {};
for (const file of ['apps/ipad/App.tsx', 'apps/ipad/src/GlassSurface.tsx', 'apps/ipad/src/glass-policy.ts', 'apps/ipad/src/host-visibility.ts', 'apps/ipad/src/photo-look-editor.ts', 'apps/ipad/src/native-photo-effects.ts', 'apps/ipad/src/local-types.ts', 'apps/ipad/src/template-editor.ts', 'apps/ipad/src/TemplateStudio.tsx', 'apps/ipad/src/publication.ts', 'apps/ipad/src/session-capture.ts', 'apps/ipad/src/review-selection.ts', 'apps/ipad/src/sharing.ts', 'apps/ipad/src/SmsShare.tsx', 'apps/ipad/src/sms-state.ts', 'apps/ipad/src/booth-presentation.ts', 'apps/ipad/src/host-originals.ts', 'apps/ipad/src/photo-export.ts', 'apps/ipad/src/photo-library.ts', 'packages/core/src/index.ts', 'apps/ipad/assets/attract-scene.png']) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const sourceSHA256 = sourceHashes['apps/ipad/App.tsx'];
const boundary = { scope: 'DEV-ONLY browser rendering of actual native JSX; synthetic device adapters, not iOS verification.', sourceSHA256, sourceHashes, developmentUI, nativeFixtureEnabled: false, forbiddenInputs, inputs };
await writeFile(path.join(temporary, 'fixture.js'), result.outputFiles[0].contents);
await writeFile(path.join(root, templateEvidence ? 'artifacts/visual/templates-bundle-boundary.json' : looksEvidence ? 'artifacts/visual/looks-bundle-boundary.json' : 'artifacts/visual/new-session-bundle-boundary.json'), JSON.stringify(boundary, null, 2) + '\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DEV ONLY · Five-shot native JSX browser fixture</title><style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;flex-direction:column;background:#f6efe4}#root{flex:1;min-height:0}#root>div{height:100%}#new-session-fixture-banner{box-sizing:border-box;padding:7px 10px;flex:none;font:11px/16px system-ui,sans-serif;text-align:center;background:#17382d;color:#fff;z-index:2147483647;position:relative}
</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8791');
  if (url.pathname === '/fixture.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(result.outputFiles[0].contents); }
  else if (url.pathname === '/fixture-provenance.json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(boundary)); }
  else if (url.pathname === '/attract-scene.png' || /^\/synthetic\/shot\/[a-zA-Z0-9-]+\.png$/.test(url.pathname)) {
    if (url.searchParams.has('variant')) { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(variants[Number(url.searchParams.get('variant')) % 4]); }
    else { response.writeHead(200, { 'content-type': 'image/png' }); response.end(await readFile(path.join(root, 'apps/ipad/assets/attract-scene.png'))); }
  } else { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); }
});
server.listen(8791, '127.0.0.1', () => console.log('DEV-ONLY five-shot JSX fixture on 127.0.0.1:8791; synthetic camera/files/SQLite/media/sync, not native verification.'));
process.on('SIGTERM', () => server.close());
