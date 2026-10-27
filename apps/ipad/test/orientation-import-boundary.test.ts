import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import type { OrientationPort } from '../src/orientation-controller';

const nodeRequire = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = resolve(root, 'apps/ipad/src/orientation-native.ts');
const loaderPath = resolve(root, 'node_modules/@expo/cli/build/metro-require/require.js');
const asyncPath = nodeRequire.resolve('expo/internal/async-require-module');
type Transformed = {
  dependencies: { name: string; data?: { asyncType?: string | null } }[];
  output: { type: string; data: { code: string } }[];
};
type Module = { exports: unknown };
type RuntimeRequire = ((id: number) => unknown) & { importAll(id: number): unknown };
type Runtime = {
  __r: RuntimeRequire;
  __d(factory: unknown, id: number, dependencies: number[]): void;
};

// Actual installed Release/iOS Metro transform; no source-text-only assertion or injected loadWindow.
async function transform(source: Buffer): Promise<Transformed> {
  const { getDefaultConfig } = nodeRequire('expo/metro-config') as {
    getDefaultConfig(path: string): { transformer: unknown; projectRoot: string };
  };
  const worker = nodeRequire(resolve(root, 'node_modules/@expo/metro-config/build/transform-worker/transform-worker.js')) as {
    transform(config: unknown, projectRoot: string, filename: string, source: Buffer,
      options: Record<string, unknown>): Promise<Transformed>;
  };
  const config = getDefaultConfig(resolve(root, 'apps/ipad'));
  return worker.transform(config.transformer, config.projectRoot, 'src/orientation-native.ts', source, {
    dev: false, hot: false, minify: false, platform: 'ios', type: 'module',
    inlineRequires: false, experimentalImportSupport: false, unstable_transformProfile: 'hermes-stable',
    customTransformOptions: { engine: 'hermes', environment: 'client' },
  });
}

function runtimeHarness() {
  const context = createContext({
    __DEV__: false, __METRO_GLOBAL_PREFIX__: '', process: { env: { EXPO_OS: 'ios' } },
    console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout, queueMicrotask,
  });
  runInContext('globalThis.global = globalThis;', context);
  // These are the installed Expo runtime and asyncRequire, not a rewritten importAll algorithm.
  runInContext(readFileSync(loaderPath, 'utf8'), context, { filename: loaderPath, timeout: 1000 });
  const runtime = context as unknown as Runtime;
  const ids = { reactNative: 1, sdk: 2, async: 3, adapter: 4 };
  const state = {
    dimensionsReads: 0, optionalReads: 0, sdkLoads: 0, requests: 0,
    nativeRemovals: 0, windowRemovals: 0, size: { width: 820, height: 1180 },
    nativeListeners: new Set<() => void>(), windowListeners: new Set<() => void>(),
  };
  const window = {
    get(name: string) { assert.equal(name, 'window'); return { ...state.size }; },
    addEventListener(name: string, callback: () => void) {
      assert.equal(name, 'change');
      state.windowListeners.add(callback);
      return { remove() { state.windowRemovals++; state.windowListeners.delete(callback); } };
    },
  };
  const reactNative = {};
  Object.defineProperties(reactNative, {
    Dimensions: { enumerable: true, get() { state.dimensionsReads++; return window; } },
    PushNotificationIOS: { enumerable: true, get() {
      state.optionalReads++;
      throw new Error('synthetic optional native getter evaluated');
    } },
  });
  const sdk = {
    __esModule: true,
    OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3, LANDSCAPE: 5 },
    Orientation: { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
    async supportsOrientationLockAsync() { return true; },
    async lockAsync() { state.requests++; },
    async unlockAsync() { state.requests++; },
    async getOrientationAsync() { return 1; },
    async getOrientationLockAsync() { return 3; },
    addOrientationChangeListener(callback: () => void) {
      state.nativeListeners.add(callback);
      return { remove() { state.nativeRemovals++; state.nativeListeners.delete(callback); } };
    },
  };
  function value(id: number, exported: unknown, initialized?: () => void) {
    runtime.__d((_global: unknown, _require: unknown, _default: unknown, _all: unknown, module: Module) => {
      initialized?.();
      module.exports = exported;
    }, id, []);
  }
  value(ids.reactNative, reactNative);
  value(ids.sdk, sdk, () => { state.sdkLoads++; });
  const asyncFactory = runInContext('(function(require,module,exports){'
    + readFileSync(asyncPath, 'utf8') + '\n})', context, { filename: asyncPath }) as
    (require: RuntimeRequire, module: Module, exports: unknown) => void;
  runtime.__d((_global: unknown, require: RuntimeRequire, _default: unknown, _all: unknown,
    module: Module, exports: unknown) => asyncFactory(require, module, exports), ids.async, []);

  function adapter(transformed: Transformed): { loadNativeOrientationPort(): Promise<OrientationPort> } {
    const output = transformed.output.find(entry => entry.type === 'js/module');
    assert.ok(output, 'actual Metro module output is required');
    const dependencies = transformed.dependencies.map(({ name }) => {
      if (name === 'react-native') return ids.reactNative;
      if (name === 'expo-screen-orientation') return ids.sdk;
      if (name === 'expo/internal/async-require-module') return ids.async;
      throw new Error('Unexpected dependency outside the bounded import test: ' + name);
    });
    let captured: unknown;
    const define = runtime.__d;
    runtime.__d = factory => { captured = factory; };
    try {
      runInContext(output.data.code, context, { filename: sourcePath + ':Metro', timeout: 1000 });
    } finally { runtime.__d = define; }
    assert.equal(typeof captured, 'function');
    define(captured, ids.adapter, dependencies);
    return runtime.__r(ids.adapter) as { loadNativeOrientationPort(): Promise<OrientationPort> };
  }
  return { state, runtime, ids, adapter };
}
async function flush() { for (let index = 0; index < 40; index++) await Promise.resolve(); }

test('negative control: actual Expo async importAll touches an optional RN lazy getter', () => {
  const t = runtimeHarness();
  const asyncRequire = t.runtime.__r(t.ids.async) as (id: number, paths: unknown, name: string) => unknown;
  assert.throws(() => asyncRequire(t.ids.reactNative, undefined, 'react-native'),
    /synthetic optional native getter evaluated/);
  assert.equal(t.state.optionalReads, 1);
  assert.equal(t.state.dimensionsReads, 1, 'real importAll enumerated the CommonJS export getters');
});

test('actual Metro default adapter loads only Dimensions and preserves observation/subscription lifecycle', async () => {
  const transformed = await transform(readFileSync(sourcePath));
  assert.equal(transformed.dependencies.find(entry => entry.name === 'expo-screen-orientation')?.data?.asyncType, 'async',
    'the orientation SDK must retain its lazy native loading boundary');
  const t = runtimeHarness();
  const adapter = t.adapter(transformed);
  assert.equal(t.state.dimensionsReads, 0);
  assert.equal(t.state.sdkLoads, 0);
  const port = await adapter.loadNativeOrientationPort(); // Intentionally no loadWindow or loadSDK override.
  assert.equal(port.available, true, 'namespace-import regressions must not silently return unavailable');
  assert.equal(t.state.sdkLoads, 1);
  assert.equal(t.state.dimensionsReads, 1);
  assert.equal(t.state.optionalReads, 0);
  assert.deepEqual({ ...await port.readObservation() },
    { orientation: 'portrait-up', lock: 'portrait-up', width: 820, height: 1180 });
  const observations: { width: number; height: number }[] = [];
  const stop = port.subscribe(value => observations.push({ width: value.width, height: value.height }));
  assert.equal(t.state.nativeListeners.size, 1);
  assert.equal(t.state.windowListeners.size, 1);
  t.state.size = { width: 1180, height: 820 };
  for (const callback of t.state.windowListeners) callback();
  await flush();
  assert.deepEqual(observations, [{ width: 1180, height: 820 }]);
  stop();
  stop();
  for (const callback of t.state.nativeListeners) callback();
  await flush();
  assert.equal(t.state.nativeListeners.size, 0);
  assert.equal(t.state.windowListeners.size, 0);
  assert.equal(t.state.nativeRemovals, 1);
  assert.equal(t.state.windowRemovals, 1);
  assert.equal(t.state.requests, 0);
  assert.equal(t.state.optionalReads, 0, 'neither lifecycle nor Dimensions reads may touch optional native APIs');
});

test('in-memory old default import reproduces failure through the same actual Metro/runtime harness', async () => {
  const current = readFileSync(sourcePath, 'utf8');
  const old = current.replace("require('react-native').Dimensions", "(await import('react-native')).Dimensions");
  assert.notEqual(old, current, 'negative source control requires the reviewed named CommonJS load');
  const t = runtimeHarness();
  const adapter = t.adapter(await transform(Buffer.from(old)));
  const port = await adapter.loadNativeOrientationPort();
  assert.equal(port.available, false);
  assert.equal(t.state.optionalReads, 1);
  assert.equal(t.state.dimensionsReads, 1);
  assert.equal(t.state.requests, 0);
  assert.equal(readFileSync(sourcePath, 'utf8'), current, 'the negative control never edits production source');
});

// Boundary: Metro/Expo import behavior is real; SDK, Dimensions and the optional getter are substitutes.
// This does not execute Hermes, NativeEventEmitter, TurboModule registration, UIKit or the actual iPad.
