import test from 'node:test';
import assert from 'node:assert/strict';
import { compositeExportCapture, createPhotoExporter } from '../src/photo-export';
import { createHostOriginalActions, type HostExportOptions } from '../src/host-originals';
import type { ActiveSession, PhotoExportStatus, PhotoLibraryCapability } from '../src/local-types';
function session(): ActiveSession {
  const ids = ['one', 'two', 'three', 'four'];
  return { id: 'session', createdAt: 12, targetCount: 4, confirmed: true,
    shots: ids.map(id => ({ id, sessionId: 'session', createdAt: 12, confirmed: true, fileUri: `file:///documents/photobooth/${id}.jpg`, exportStatus: 'pending' })),
    retakes: [{ id: 'retake', sessionId: 'session', createdAt: 12, confirmed: false, fileUri: 'file:///documents/photobooth/retake.jpg', exportStatus: 'pending' }],
    composite: { id: 'composite', fileUri: 'file:///documents/photobooth/composite.jpg', originalPhotoIds: ids,
      recipe: { version: 'wedding-template-v1', layout: 'strip', theme: 'classic', photoIds: ids,
        cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) } } };
}
function fixture() {
  let current = session(), writes = 0, auths = 0;
  let permission: PhotoLibraryCapability = { available: true, permission: 'granted', canAskAgain: true, writeOnly: true };
  const updates: PhotoExportStatus[] = [], exports: Omit<HostExportOptions, 'assertCurrent'>[] = [];
  const ports = {
    get: async () => current,
    update: async (_sessionId: string, id: string, status: PhotoExportStatus) => {
      updates.push(status);
      if (current.composite?.id === id) current = { ...current, composite: { ...current.composite, exportStatus: status } };
      else current = { ...current, shots: current.shots.map(photo => photo.id === id ? { ...photo, exportStatus: status } : photo) };
      return current;
    },
  };
  const library = { capability: async () => permission, requestAddPermission: async () => permission,
    save: async (_uri: string) => { writes++; } };
  const exporter = createPhotoExporter(library, ports);
  const host = createHostOriginalActions({ assertCurrent: () => {}, load: async () => current,
    authenticate: async () => { auths++; }, acknowledge: (id, photoId) => ports.update(id, photoId, 'saved'),
    export: async (value, options) => { assert.equal(typeof options.assertCurrent, 'function'); const { assertCurrent, ...payload } = options; exports.push(payload); return exporter.exportSession(value, options); }, finishSave: async () => current });
  return { ports, library, exporter, host, updates, exports, current: () => current, set: (value: ActiveSession) => { current = value; },
    deny: () => { permission = { ...permission, permission: 'denied' }; }, writes: () => writes, auths: () => auths };
}
const onlyComposite = { includeComposite: true, photoIds: ['composite'] };
test('composite projection is a session-owned capture without changing selected originals', () => {
  const value = session(); const capture = compositeExportCapture(value);
  assert.equal(capture?.id, 'composite'); assert.equal(capture?.sessionId, value.id); assert.equal(capture?.createdAt, 12);
  assert.equal(value.shots.length, 4); assert.equal(value.retakes?.length, 1);
  for (const uri of ['file:///documents/photobooth/composite.partial', 'file:///documents/photobooth/wrong.jpg', 'https://example.invalid/composite.jpg']) {
    assert.equal(compositeExportCapture({ ...value, composite: { ...value.composite!, fileUri: uri } }), null);
  }
  assert.equal(compositeExportCapture({ ...value, shots: value.shots.map(photo => ({ ...photo, sessionId: 'other' })) }), null);
  assert.equal(compositeExportCapture({ ...value, composite: undefined, stagedComposites: [value.composite!] }), null);
});
test('automatic composite export saves once and journals uncertainty before save', async () => {
  const f = fixture(); const originals = structuredClone(f.current().shots); const retakes = structuredClone(f.current().retakes);
  f.library.save = async () => { assert.equal(f.current().composite?.exportStatus, 'uncertain'); };
  let saves = 0; const save = f.library.save; f.library.save = async uri => { saves++; await save(uri); };
  const result = await f.exporter.exportSession(f.current(), onlyComposite);
  await f.exporter.exportSession(result, onlyComposite);
  assert.equal(saves, 1); assert.equal(result.composite?.exportStatus, 'saved');
  assert.deepEqual(f.updates, ['uncertain', 'saved']); assert.deepEqual(result.shots, originals); assert.deepEqual(result.retakes, retakes);
});
test('composite flag without explicit ID cannot export a composite', async () => {
  const f = fixture(); await f.exporter.exportSession(f.current(), { includeComposite: true, photoIds: [] });
  assert.equal(f.writes(), 0);
});
for (const outcome of ['denied', 'failed'] as const) test(`composite ${outcome} leaves four originals and retained originals intact`, async () => {
  const f = fixture(); const before = structuredClone(f.current());
  if (outcome === 'denied') f.deny(); else f.library.save = async () => { throw new Error('native failure'); };
  const result = await f.exporter.exportSession(before, onlyComposite);
  assert.equal(result.composite?.exportStatus, outcome); assert.deepEqual(result.shots, before.shots); assert.deepEqual(result.retakes, before.retakes);
});
test('uncertain composite never retries automatically; host confirmation plus auth permits exactly one copy', async () => {
  const f = fixture(); f.set({ ...f.current(), composite: { ...f.current().composite!, exportStatus: 'uncertain' } });
  await f.exporter.exportSession(f.current(), onlyComposite); assert.equal(f.writes(), 0);
  const request = { kind: 'export' as const, sessionId: 'session', photoId: 'composite', retained: false };
  assert.equal((await f.host.run(request)).kind, 'confirm-duplicate'); assert.equal(f.auths(), 0);
  await f.host.run({ ...request, duplicateRiskAccepted: true });
  assert.equal(f.auths(), 1); assert.equal(f.writes(), 1);
  assert.deepEqual(f.exports, [{ ...onlyComposite, includeRetakes: false, requestPermission: true, retryUncertain: true }]);
});
test('host acknowledgment authenticates and makes zero native copies', async () => {
  const f = fixture(); f.set({ ...f.current(), composite: { ...f.current().composite!, exportStatus: 'uncertain' } });
  await f.host.run({ kind: 'acknowledge', sessionId: 'session', photoId: 'composite', retained: false });
  assert.equal(f.auths(), 1); assert.equal(f.writes(), 0); assert.equal(f.current().composite?.exportStatus, 'saved');
  assert.equal(f.current().shots.length, 4);
});
for (const boundary of ['uncertain', 'saved'] as const) test(`failed ${boundary} journal returns truthful composite uncertainty overlay`, async () => {
  const f = fixture(); const update = f.ports.update;
  f.ports.update = async (sessionId, photoId, status) => { if (status === boundary) throw new Error('journal unavailable'); return update(sessionId, photoId, status); };
  const result = await f.exporter.exportSession(f.current(), onlyComposite);
  assert.equal(result.composite?.exportStatus, 'uncertain'); assert.equal(f.writes(), boundary === 'uncertain' ? 0 : 1);
  assert.ok(result.shots.every(photo => photo.exportStatus === 'pending'));
});
test('host rejects composite replaced during authentication and retained composite routes', async () => {
  let current = session(), saves = 0, acknowledgments = 0;
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => current,
    authenticate: async () => { current = { ...current, composite: { ...current.composite!, id: 'replacement' } }; },
    acknowledge: async () => { acknowledgments++; return current; }, export: async value => { saves++; return value; }, finishSave: async () => current });
  await assert.rejects(actions.run({ kind: 'export', sessionId: 'session', photoId: 'composite', retained: false }), /host collection/);
  await assert.rejects(actions.run({ kind: 'export', sessionId: 'session', photoId: 'replacement', retained: true }), /host collection/);
  assert.equal(saves, 0); assert.equal(acknowledgments, 0);
});
test('staged or stale composite IDs cannot be exported or acknowledged', async () => {
  const f = fixture(); const value = f.current(); f.set({ ...value, composite: undefined, stagedComposites: [value.composite!] });
  await f.exporter.exportSession(f.current(), onlyComposite); assert.equal(f.writes(), 0);
  for (const kind of ['export', 'acknowledge'] as const) await assert.rejects(f.host.run({ kind, sessionId: 'session', photoId: 'composite', retained: false }), /host collection/);
});
