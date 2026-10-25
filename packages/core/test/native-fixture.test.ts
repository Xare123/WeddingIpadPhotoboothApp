import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

type FixtureModule = {
  nativeFixtureEnabled: boolean;
  nativeFixturePhotoId(value: string): string;
  nativeFixtureImage(): number;
  nativeFixtureStorageStatus(active: unknown, jobs: unknown[]): string;
  takeNativeFixturePhoto(): Promise<unknown>;
  interruptNativeFixtureConfirmation(active: unknown): void;
};

async function loadGuardedFixture(development: boolean, optIn: string) {
  const operations: string[] = [];
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../../apps/ipad/src/native-fixture.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    define: { __DEV__: JSON.stringify(development), 'process.env.EXPO_PUBLIC_E2E_FIXTURE': JSON.stringify(optIn) },
    plugins: [{
      name: 'native-boundary-tripwires',
      setup(api) {
        api.onResolve({ filter: /^(react-native|expo-file-system)$/ }, args => ({ path: args.path, namespace: 'tripwire' }));
        api.onResolve({ filter: /capture\.jpg$/ }, () => ({ path: 'capture', namespace: 'tripwire' }));
        api.onLoad({ filter: /.*/, namespace: 'tripwire' }, args => ({
          contents: args.path === 'react-native'
            ? 'export const Image={resolveAssetSource(){globalThis.__fixtureOperations.push("image");throw new Error("Native image touched");}};'
            : args.path === 'expo-file-system'
              ? 'export class File{constructor(){globalThis.__fixtureOperations.push("file");throw new Error("Native file touched");}};export const Directory=File;export const Paths={document:"file:///documents",cache:"file:///cache"};'
              : 'globalThis.__fixtureOperations.push("asset");export default 0;',
          loader: 'js',
        }));
      },
    }],
  });
  const globals = { __fixtureOperations: operations };
  const module = { exports: {} };
  new Function('module', 'exports', 'globalThis', result.outputFiles![0]!.text)(module, module.exports, globals);
  return { fixture: module.exports as FixtureModule, operations };
}

for (const [description, development, optIn] of [
  ['Release stays disabled even when the public test flag is set', false, '1'],
  ['Debug stays disabled without explicit native-test opt-in', true, '0'],
] as const) {
  test(description, async () => {
    const { fixture, operations } = await loadGuardedFixture(development, optIn);
    assert.equal(fixture.nativeFixtureEnabled, false);
    assert.deepEqual(operations, [], 'Importing the fixture must not touch data or image assets');
    for (const invoke of [
      () => fixture.nativeFixturePhotoId('11111111-1111-4111-8111-111111111111'),
      () => fixture.nativeFixtureImage(),
      () => fixture.nativeFixtureStorageStatus(null, []),
      () => fixture.interruptNativeFixtureConfirmation({ id: 'e2e00000-1111-4111-8111-111111111111' }),
    ]) assert.throws(invoke, /Native fixture is disabled/);
    await assert.rejects(fixture.takeNativeFixturePhoto(), /Native fixture is disabled/);
    assert.deepEqual(operations, [], 'Disabled entrypoints must reject before native operations');
  });
}
