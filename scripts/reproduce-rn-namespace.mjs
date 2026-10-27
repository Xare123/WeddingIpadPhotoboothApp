import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';

const nodeRequire = createRequire(import.meta.url);
const babel = nodeRequire('@babel/core');
const paths = {
  loader: 'node_modules/@expo/cli/build/metro-require/require.js',
  reactNative: 'node_modules/react-native/index.js',
  push: 'node_modules/react-native/Libraries/PushNotificationIOS/PushNotificationIOS.js',
  emitter: 'node_modules/react-native/Libraries/EventEmitter/NativeEventEmitter.js',
  async: 'node_modules/expo/src/async-require/asyncRequireModule.ts',
  orientation: 'apps/ipad/src/orientation-native.ts',
};
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]));
function transform(key) {
  return babel.transformSync(sources[key], { filename: paths[key], configFile: false, babelrc: false,
    ...(key === 'async'
      ? { plugins: [nodeRequire.resolve('@babel/plugin-transform-typescript'), nodeRequire.resolve('@babel/plugin-transform-modules-commonjs')] }
      : { presets: [nodeRequire.resolve('babel-preset-expo')], caller: { name: 'metro', platform: 'ios', supportsStaticESM: false } }),
  }).code;
}
const transformed = Object.fromEntries(['reactNative', 'push', 'emitter', 'async'].map(key => [key, transform(key)]));

async function execute(namespaceImport, pushPresent) {
  const visited = [];
  const context = createContext({ __DEV__: false, __METRO_GLOBAL_PREFIX__: '',
    process: { env: { EXPO_OS: 'ios' } }, console: { warn() {}, error() {}, log() {} } });
  runInContext('globalThis.global = globalThis;', context);
  runInContext(sources.loader, context, { filename: paths.loader });
  const ids = { reactNative: 1, push: 2, emitter: 3, async: 4 };
  const dimensions = { publicDimensionsMarker: true };
  const nativePush = pushPresent ? { addListener() {}, removeListeners() {} } : null;
  const asDefault = value => ({ __esModule: true, default: value });
  function requireFor(key) {
    const request = name => {
      if (typeof name === 'number') return context.__r(name);
      visited.push(key + ':' + name);
      if (name === 'invariant') return nodeRequire('invariant');
      if (name.startsWith('@babel/runtime/')) return nodeRequire(name);
      if (key === 'reactNative') {
        if (name.endsWith('/warnOnce')) return asDefault(() => {});
        if (name.endsWith('/Dimensions')) return asDefault(dimensions);
        if (name === './Libraries/PushNotificationIOS/PushNotificationIOS') return context.__r(ids.push);
        return asDefault({}); // All unrelated UI/native dependencies are explicit inert substitutes.
      }
      if (name.endsWith('/Platform')) return asDefault({ OS: 'ios' });
      if (key === 'push' && name === '../EventEmitter/NativeEventEmitter') return context.__r(ids.emitter);
      if (key === 'push' && name === './NativePushNotificationManagerIOS') return asDefault(nativePush);
      if (key === 'emitter' && name === './RCTDeviceEventEmitter') return asDefault({});
      throw new Error('Unexpected fixed-boundary request');
    };
    request.importAll = (...args) => context.__r.importAll(...args);
    return request;
  }
  for (const key of ['reactNative', 'push', 'emitter', 'async']) {
    const factory = runInContext('(function(require,module,exports){' + transformed[key] + '\n})', context, { filename: paths[key] });
    context.__d((global, require, importDefault, importAll, module, exports) => factory(requireFor(key), module, exports), ids[key], []);
  }
  let result, message = null;
  try {
    result = namespaceImport
      ? (await context.__r(ids.async)(ids.reactNative, null, 'react-native')).Dimensions
      : context.__r(ids.reactNative).Dimensions;
  } catch (error) { message = error.message; }
  const output = { mode: namespaceImport ? 'actual-expo-async-import-all' : 'named-commonjs-dimensions', nativePushPresent: pushPresent,
    pushGetterEvaluated: visited.some(value => value.endsWith(':./Libraries/PushNotificationIOS/PushNotificationIOS')),
    realNativeEventEmitterEvaluated: visited.includes('push:../EventEmitter/NativeEventEmitter'),
    dimensionsReturned: result === dimensions, threwExactInvariant: message === '`new NativeEventEmitter()` requires a non-null argument.',
    errorMessage: message };
  if (message && message !== '`new NativeEventEmitter()` requires a non-null argument.') throw new Error('Fixed VM boundary: ' + message);
  if (!namespaceImport) {
    assert.equal(output.dimensionsReturned, true); assert.equal(output.pushGetterEvaluated, false); assert.equal(message, null);
  } else if (!pushPresent) {
    assert.equal(output.pushGetterEvaluated, true); assert.equal(output.realNativeEventEmitterEvaluated, true); assert.equal(output.threwExactInvariant, true);
  } else {
    assert.equal(output.pushGetterEvaluated, true); assert.equal(message, null); assert.equal(result, dimensions);
  }
  return output;
}
const result = {
  result: 'three-controls-passed',
  installedSources: Object.entries(paths).map(([key, path]) => ({ path,
    sha256: createHash('sha256').update(sources[key]).digest('hex') })),
  controls: [await execute(false, false), await execute(true, false), await execute(true, true)],
  actualExpoLoader: 'The same @expo/cli loader path appears in the existing exported iOS source map; source evaluates exports[key] in metroImportAll.',
  limitations: ['Production RN index, PushNotificationIOS, NativeEventEmitter and Expo async-require/loader sources were unmodified; Babel strips types/module syntax for this VM.',
    'Only platform/native dependency boundaries and unrelated RN getters were substituted. No simulator, TurboModule registration, UIKit, Hermes or app lifecycle was executed.',
    'This proves the eager namespace-import failure mechanism, not that the active hosted run reached this call or that the proposed app change passes on iOS.'],
};
writeFileSync('.cache/native-emitter-namespace-repro.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
