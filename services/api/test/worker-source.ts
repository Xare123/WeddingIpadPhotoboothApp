import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

let script: string | undefined;
let modulePromise: Promise<typeof import('../src/index')> | undefined;
/** The real Worker entry, including its embedded browser source; no test rewrite. */
export function workerSource(): string {
  if (script === undefined) {
    const result = buildSync({
      entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
      bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
      loader: { '.client': 'text' }, write: false, legalComments: 'eof',
    });
    const output = result.outputFiles[0];
    if (!output) throw new Error('Worker bundle missing');
    script = output.text;
  }
  return script;
}
/** Node cannot import raw .client files; execute the identical ESM bundle instead. */
export function workerModule(): Promise<typeof import('../src/index')> {
  return modulePromise ??= import(`data:text/javascript;base64,${Buffer.from(workerSource()).toString('base64')}`);
}
