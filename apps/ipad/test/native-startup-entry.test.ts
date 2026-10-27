import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { probeNativeStartupModules } from '../src/native-startup-diagnostics';

test('real entry records fixed module availability before view/Expo imports and always registers the real App once', () => {
  const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const outcome of ['available', 'missing', 'throw', 'logger-throw']) {
    const order: string[] = [], messages: string[] = [], app = {};
    runInNewContext(compiled, { exports: {}, console: { error(message: string) {
      order.push('diagnostic'); messages.push(message);
      if (outcome === 'logger-throw') throw new Error('private logger metadata');
    } }, require(name: string) {
      if (name === './src/native-startup-diagnostics') return { probeNativeStartupModules };
      if (name === 'react-native/Libraries/TurboModule/TurboModuleRegistry') return { get(module: string) {
        order.push('lookup:' + module);
        if (outcome === 'throw') throw new Error('private native metadata');
        return outcome === 'missing' ? null : {};
      } };
      if (name === 'expo') { order.push('expo'); return { registerRootComponent(component: unknown) { assert.equal(component, app); order.push('registered'); } }; }
      if (name === './App') { order.push('app'); return { default: app }; }
      throw new Error('Unexpected bootstrap dependency');
    } });
    assert.deepEqual(order, ['lookup:KeyboardObserver', 'lookup:AppState', 'lookup:WebSocketModule',
      'lookup:NativeAnimatedModule', 'lookup:NativeAnimatedTurboModule', 'diagnostic', 'expo', 'app', 'registered']);
    assert.equal(messages.length, 1);
    assert.ok(messages[0]!.startsWith('Native module bootstrap:'));
    assert.ok(!messages[0]!.includes('private'));
  }
});
