import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateHostAction } from '../src/host-action-auth';
import { createHostVisibility } from '../src/host-visibility';
import { createPhotoExporter } from '../src/photo-export';
import type { ActiveSession, PhotoLibraryCapability, PhotoExportStatus } from '../src/local-types';

async function fixture() {
  const visibility = createHostVisibility(); let clock = 0;
  const lease = await authenticateHostAction({ visibility, authenticate: async () => {},
    isActive: () => true, now: () => clock, wait: async ms => { clock += ms; } });
  let current: ActiveSession = { id: 'session', createdAt: 1, targetCount: 4, confirmed: false,
    shots: [{ id: 'photo', sessionId: 'session', createdAt: 1, confirmed: false,
      fileUri: 'file:///documents/photobooth/photo.jpg', exportStatus: 'pending' }] };
  const before = structuredClone(current.shots);
  let nativeWrites = 0, permissionPrompts = 0;
  const statuses: PhotoExportStatus[] = [];
  const granted: PhotoLibraryCapability = { available: true, permission: 'granted', canAskAgain: true, writeOnly: true };
  const sessions = { get: async (_id: string) => current,
    update: async (_id: string, photoId: string, status: PhotoExportStatus) => {
      statuses.push(status); current = { ...current, shots: current.shots.map(photo => photo.id === photoId ? { ...photo, exportStatus: status } : photo) }; return current;
    } };
  const library = { capability: async () => granted,
    requestAddPermission: async () => { permissionPrompts++; return granted; },
    save: async (_uri: string) => { nativeWrites++; } };
  const exporter = createPhotoExporter(library, sessions);
  return { visibility, lease, sessions, library, exporter, statuses, before, current: () => current,
    nativeWrites: () => nativeWrites, permissionPrompts: () => permissionPrompts };
}

for (const event of ['background', 'close'] as const) {
  for (const boundary of ['session-read', 'capability', 'permission', 'uncertain-journal'] as const) {
    test(`${event} during explicit host export ${boundary} prevents native Photos mutation`, async () => {
      const f = await fixture();
      const revoke = () => { if (event === 'background') f.visibility.suspend('background'); else f.visibility.close(); };
      if (boundary === 'session-read') f.sessions.get = async () => { revoke(); return f.current(); };
      if (boundary === 'capability') f.library.capability = async () => {
        revoke(); return { available: true, permission: 'undetermined', canAskAgain: true, writeOnly: true };
      };
      if (boundary === 'permission') {
        f.library.capability = async () => ({ available: true, permission: 'undetermined', canAskAgain: true, writeOnly: true });
        const request = f.library.requestAddPermission;
        f.library.requestAddPermission = async () => { const result = await request(); revoke(); return result; };
      }
      if (boundary === 'uncertain-journal') {
        const update = f.sessions.update;
        f.sessions.update = async (id, photoId, status) => { const result = await update(id, photoId, status);
          if (status === 'uncertain') revoke(); return result; };
      }
      await assert.rejects(f.exporter.exportSession(f.current(), { requestPermission: true, assertCurrent: f.lease.assertCurrent }), /no longer authorized/);
      assert.equal(f.nativeWrites(), 0);
      if (boundary === 'capability') assert.equal(f.permissionPrompts(), 0, 'revocation during capability must not open a later permission prompt');
      assert.deepEqual(f.current().shots.map(({ exportStatus, ...photo }) => photo), f.before.map(({ exportStatus, ...photo }) => photo));
      assert.deepEqual(f.statuses, boundary === 'uncertain-journal' ? ['uncertain', 'failed'] : []);
    });
  }
}

test('revoked pre-save journal correction failure remains uncertain and cannot auto-retry a native copy', async () => {
  const f = await fixture(), update = f.sessions.update;
  f.sessions.update = async (id, photoId, status) => {
    if (status === 'failed') throw new Error('journal unavailable');
    const result = await update(id, photoId, status); f.visibility.suspend('background'); return result;
  };
  await assert.rejects(f.exporter.exportSession(f.current(), { assertCurrent: f.lease.assertCurrent }), /no longer authorized/);
  assert.equal(f.current().shots[0]?.exportStatus, 'uncertain'); assert.equal(f.nativeWrites(), 0);
  await f.exporter.exportSession(f.current());
  assert.equal(f.nativeWrites(), 0);
});

test('background after native save begins preserves recorded success and never automatically duplicates it', async () => {
  const f = await fixture(), save = f.library.save;
  f.library.save = async uri => { await save(uri); f.visibility.suspend('background'); };
  await assert.rejects(f.exporter.exportSession(f.current(), { assertCurrent: f.lease.assertCurrent }), /no longer authorized/);
  assert.deepEqual(f.statuses, ['uncertain', 'saved']); assert.equal(f.nativeWrites(), 1);
  assert.equal(f.current().shots[0]?.exportStatus, 'saved');
  await f.exporter.exportSession(f.current()); assert.equal(f.nativeWrites(), 1);
});

test('an explicit host export queued behind another export rechecks its lease before reading or writing', async () => {
  const f = await fixture(); let begin!: () => void, finish!: () => void;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const save = f.library.save;
  f.library.save = async uri => { begin(); await pending; await save(uri); };
  const automatic = f.exporter.exportSession(f.current()); await began;
  const host = f.exporter.exportSession(f.current(), { assertCurrent: f.lease.assertCurrent });
  f.visibility.close(); finish(); await automatic;
  await assert.rejects(host, /no longer authorized/);
  assert.equal(f.nativeWrites(), 1); assert.equal(f.current().shots[0]?.exportStatus, 'saved');
});

test('revoked explicit retry retains earlier uncertainty and its automatic-duplicate protection', async () => {
  const f = await fixture();
  await f.sessions.update('session', 'photo', 'uncertain');
  const update = f.sessions.update;
  f.sessions.update = async (id, photoId, status) => {
    const result = await update(id, photoId, status); f.visibility.close(); return result;
  };
  await assert.rejects(f.exporter.exportSession(f.current(), { retryUncertain: true, assertCurrent: f.lease.assertCurrent }), /no longer authorized/);
  assert.equal(f.nativeWrites(), 0); assert.equal(f.current().shots[0]?.exportStatus, 'uncertain');
  await f.exporter.exportSession(f.current()); assert.equal(f.nativeWrites(), 0);
});
