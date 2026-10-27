import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('real shipping entry imports and registers the real App without eager native probes or error suppression', () => {
  const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const failure of [undefined, 'expo', './App']) {
    const order: string[] = [], app = {}, error = new Error('synthetic native import failure');
    const execute = () => runInNewContext(compiled, { exports: {}, require(name: string) {
      order.push(name);
      if (name === failure) throw error;
      if (name === 'expo') return { registerRootComponent(component: unknown) { assert.equal(component, app); order.push('registered'); } };
      if (name === './App') return { __esModule: true, default: app };
      throw new Error('Unexpected bootstrap dependency');
    } });
    if (failure) assert.throws(execute, candidate => candidate === error);
    else execute();
    assert.deepEqual(order, failure === 'expo' ? ['expo'] : failure === './App' ? ['expo', './App'] : ['expo', './App', 'registered']);
  }
});
