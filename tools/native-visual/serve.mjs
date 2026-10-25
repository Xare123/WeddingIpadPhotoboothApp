/** Local DEV-ONLY review harness. No production build or deployment target. */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const stubs = path.join(root, 'tools/native-visual/stubs.tsx');
const result = await build({
  absWorkingDir: root, entryPoints: ['tools/native-visual/entry.tsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.js': 'jsx' }, define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: { 'react-native': 'react-native-web', 'react-native-svg': path.join(root, 'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js'), '@react-native/assets-registry/registry': path.join(root, 'node_modules/react-native-web/dist/modules/AssetRegistry/index.js') },
  plugins: [{ name: 'synthetic-device-adapters', setup(api) {
    api.onResolve({ filter: /^(expo-camera|expo-crypto|expo-secure-store|\.\/src\/(config|host-auth|storage|sync)|\.\/storage)$/ }, args => ({ path: stubs }));
    api.onResolve({ filter: /NativeSvgSoundModule$/ }, () => ({ path: 'fixture-sound', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default { playSound: () => {} };' }));
  } }],
});
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DEV ONLY · Native JSX browser visual fixture</title><style>
html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;flex-direction:column;background:#f6efe4}#root{flex:1;min-height:0}#root>div{height:100%}#fixture-banner{box-sizing:border-box;padding:8px 12px;flex:none;font:11px/16px system-ui,sans-serif;text-align:center;background:#19372b;color:#fff;z-index:2147483647;position:relative}
</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(result.outputFiles[0].contents); }
  else if (req.url === '/synthetic-scene.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(await readFile(path.join(root, 'artifacts/visual/sample-scene-1.jpg'))); }
  else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
});
server.listen(8791, '127.0.0.1', () => console.log('DEV-ONLY browser fixture listening on 127.0.0.1:8791; actual App JSX with synthetic in-memory device boundaries.'));
process.on('SIGTERM', () => server.close());
