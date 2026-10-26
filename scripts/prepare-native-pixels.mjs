import { mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPixelProject } from './native-pixel-project.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.RUNNER_TEMP ?? join(root, '.cache');
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(join(base, 'wedding-native-pixels-'));
console.log(JSON.stringify(createPixelProject(root, directory), null, 2));
