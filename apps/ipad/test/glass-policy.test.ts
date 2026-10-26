import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeGlassAllowed, observeGlassPreferences, type GlassPreferences, type PreferencePort } from '../src/glass-policy';
const clear: GlassPreferences = { reduceTransparency: false, increasedContrast: false, reduceMotion: false };
const supported = { platform: 'ios', version: '26.1', liquidGlass: true, apiAvailable: true, preferences: clear };
test('glass requires iOS26 and both actual native capability checks', () => {
  assert.equal(nativeGlassAllowed(supported), true);
  for (const change of [{ platform: 'web' }, { version: '25.9' }, { version: 'unknown' }, { liquidGlass: false }, { apiAvailable: false }]) assert.equal(nativeGlassAllowed({ ...supported, ...change }), false);
  for (const name of Object.keys(clear)) assert.equal(nativeGlassAllowed({ ...supported, preferences: { ...clear, [name]: true } }), false);
});
test('new accessibility event wins over an outstanding stale preference query', async () => {
  const callbacks = new Map<keyof GlassPreferences, (value: boolean) => void>();
  const queries = new Map<keyof GlassPreferences, (value: boolean) => void>();
  const values: GlassPreferences[] = []; let removed = 0;
  const stop = observeGlassPreferences({ read: name => new Promise(resolve => queries.set(name, resolve)), subscribe(name, listener) { callbacks.set(name, listener); return { remove() { removed++; } }; } }, value => values.push(value));
  for (const name of ['reduceMotion', 'increasedContrast'] as const) queries.get(name)!(false);
  callbacks.get('reduceTransparency')!(true); queries.get('reduceTransparency')!(false);
  await Promise.resolve(); assert.equal(values.at(-1)!.reduceTransparency, true);
  callbacks.get('reduceTransparency')!(false); assert.equal(values.at(-1)!.reduceTransparency, false);
  const count = values.length; stop(); callbacks.get('reduceMotion')!(true);
  assert.equal(values.length, count); assert.equal(removed, 3);
});
test('failed accessibility reads retain opaque defaults until a real event supplies state', async () => {
  const values: GlassPreferences[] = [];
  const port: PreferencePort = { read: async () => { throw new Error('unavailable'); }, subscribe: () => ({ remove() {} }) };
  const stop = observeGlassPreferences(port, value => values.push(value)); await Promise.resolve(); await Promise.resolve();
  assert.equal(values.length, 0); stop();
});
