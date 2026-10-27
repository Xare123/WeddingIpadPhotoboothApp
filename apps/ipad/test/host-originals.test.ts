/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostOriginalActions, hostOriginalStatus, indexRepairSessions, queueIndexStatus, type HostExportOptions, type HostOriginalSession } from '../src/host-originals';

const session = (): HostOriginalSession => ({ id: 'session', shots: [{ id: 'selected', exportStatus: 'uncertain' }], retakes: [{ id: 'retake', exportStatus: 'pending' }] });
function fixture() {
  let current = session();
  const calls: string[] = [], exports: Omit<HostExportOptions, 'assertCurrent'>[] = [];
  const actions = createHostOriginalActions({ assertCurrent: () => {},
    load: async () => current,
    authenticate: async () => { calls.push('authenticate'); },
    acknowledge: async (_sessionId, photoId) => { calls.push(`ack:${photoId}`); current = { ...current, shots: current.shots.map(photo => photo.id === photoId ? { ...photo, exportStatus: 'saved' } : photo) }; return current; },
    export: async (value, options) => { calls.push('export'); assert.equal(typeof options.assertCurrent, 'function'); const { assertCurrent, ...payload } = options; exports.push(payload); return value; },
    finishSave: async () => { calls.push('finish'); return current; },
  });
  return { actions, calls, exports, get: () => current };
}

test('uncertain export requires explicit duplicate-risk acceptance before authentication or Photos mutation', async () => {
  const f = fixture();
  const result = await f.actions.run({ kind: 'export', sessionId: 'session', photoId: 'selected', retained: false });
  assert.equal(result.kind, 'confirm-duplicate');
  assert.deepEqual(f.calls, []);
  assert.equal(f.get().shots[0]?.exportStatus, 'uncertain');
});

test('acknowledging a checked Photos copy authenticates and changes no guest selection', async () => {
  const f = fixture();
  await f.actions.run({ kind: 'acknowledge', sessionId: 'session', photoId: 'selected', retained: false });
  assert.deepEqual(f.calls, ['authenticate', 'ack:selected']);
  assert.deepEqual(f.get().shots.map(photo => photo.id), ['selected']);
  assert.deepEqual(f.get().retakes?.map(photo => photo.id), ['retake']);
});

test('deliberate uncertain retry exports exactly that original after host authentication', async () => {
  const f = fixture();
  await f.actions.run({ kind: 'export', sessionId: 'session', photoId: 'selected', retained: false, duplicateRiskAccepted: true });
  assert.deepEqual(f.calls, ['authenticate', 'export']);
  assert.deepEqual(f.exports, [{ photoIds: ['selected'], includeRetakes: false, requestPermission: true, retryUncertain: true }]);
});

test('retained-original export is individually scoped and does not select it for guests', async () => {
  const f = fixture();
  await f.actions.run({ kind: 'export', sessionId: 'session', photoId: 'retake', retained: true });
  assert.deepEqual(f.exports, [{ photoIds: ['retake'], includeRetakes: true, requestPermission: true, retryUncertain: false }]);
  assert.deepEqual(f.get().shots.map(photo => photo.id), ['selected']);
  await assert.rejects(f.actions.run({ kind: 'export', sessionId: 'session', photoId: 'retake', retained: false }), /host collection/);
});

test('host authentication cancellation never acknowledges or exports', async () => {
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => session(), authenticate: async () => { throw new Error('cancel'); }, acknowledge: async () => { throw new Error('must not mutate'); }, export: async () => { throw new Error('must not export'); }, finishSave: async () => null });
  await assert.rejects(actions.run({ kind: 'acknowledge', sessionId: 'session', photoId: 'selected', retained: false }), /cancel/);
});

test('host actions reserve before asynchronous authentication so repeated taps cannot duplicate exports', async () => {
  let unlock!: () => void, exports = 0;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => session(), authenticate: () => gate, acknowledge: async () => null,
    export: async value => { exports++; return value; }, finishSave: async () => null });
  const first = actions.run({ kind: 'export', sessionId: 'session', photoId: 'retake', retained: true });
  assert.equal((await actions.run({ kind: 'export', sessionId: 'session', photoId: 'retake', retained: true })).kind, 'busy');
  unlock(); await first;
  assert.equal(exports, 1);
});

test('local staged-save completion requires host authentication and never invokes Photos export', async () => {
  const calls: string[] = [];
  const staged: HostOriginalSession = { ...session(), stagedOriginals: [{ id: 'stage' }] };
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => staged, authenticate: async () => { calls.push('authenticate'); },
    acknowledge: async () => null, export: async value => { throw new Error('must not export'); }, finishSave: async () => { calls.push('finish'); return staged; } });
  await actions.run({ kind: 'finish-save', sessionId: 'session' });
  assert.deepEqual(calls, ['authenticate', 'finish']);
});

test('pending index repair is distinct from a zero queue count and is deduplicated by session', () => {
  const pending = { ...session(), storageWarning: 'index-repair-pending' };
  assert.equal(indexRepairSessions([null, pending, pending]).length, 1);
  assert.equal(indexRepairSessions([{ ...pending, storageWarning: undefined }]).length, 0);
  assert.match(hostOriginalStatus({ id: 'p', exportStatus: 'uncertain' }), /Check Photos/);
});


test('a result becoming uncertain during authentication asks for confirmation without exporting', async () => {
  let loads = 0, exported = false;
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => ({ ...session(), shots: [{ id: 'selected', exportStatus: ++loads === 1 ? 'pending' : 'uncertain' }] }), authenticate: async () => {}, acknowledge: async () => null,
    export: async value => { exported = true; return value; }, finishSave: async () => null });
  const result = await actions.run({ kind: 'export', sessionId: 'session', photoId: 'selected', retained: false });
  assert.equal(result.kind, 'confirm-duplicate');
  assert.equal(exported, false);
});

test('local save completion cannot claim a disappeared staged original is available', async () => {
  const staged: HostOriginalSession = { ...session(), stagedOriginals: [{ id: 'stage' }] };
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => staged, authenticate: async () => {}, acknowledge: async () => null,
    export: async value => value, finishSave: async () => session() });
  await assert.rejects(actions.run({ kind: 'finish-save', sessionId: 'session' }), /not available yet/);
});


test('orphan index diagnostics remain visible even with no sessions and no queued jobs', () => {
  assert.equal(queueIndexStatus(0, 0), null);
  assert.match(queueIndexStatus(0, 2)!, /2 quarantined upload-index rows need host review/);
  assert.match(queueIndexStatus(0, 2)!, /zero visible queue does not mean sharing is complete/);
});


test('staged originals cannot be addressed through selected or retained Photos-export routes', async () => {
  let exports = 0;
  const value: HostOriginalSession = { ...session(), stagedOriginals: [{ id: 'stage' }] };
  const actions = createHostOriginalActions({ assertCurrent: () => {}, load: async () => value, authenticate: async () => {}, acknowledge: async () => null,
    export: async current => { exports++; return current; }, finishSave: async () => value });
  for (const retained of [false, true]) await assert.rejects(actions.run({ kind: 'export', sessionId: 'session', photoId: 'stage', retained }), /host collection/);
  assert.equal(exports, 0);
});

// These regressions use the production action lease, not a fixture no-op guard.
for (const kind of ['acknowledge', 'export', 'finish-save'] as const) {
  for (const event of ['background', 'close'] as const) test(`${event} during post-auth ${kind} reload prevents the mutation`, async () => {
    const { authenticateHostAction } = await import('../src/host-action-auth');
    const { createHostVisibility } = await import('../src/host-visibility');
    const visibility = createHostVisibility(); let clock = 0, loads = 0, mutations = 0;
    let lease: Awaited<ReturnType<typeof authenticateHostAction>>;
    const value = { ...session(), stagedOriginals: [{ id: 'stage' }] };
    const actions = createHostOriginalActions({
      authenticate: async () => { lease = await authenticateHostAction({ visibility, authenticate: async () => {},
        isActive: () => true, now: () => clock, wait: async ms => { clock += ms; } }); },
      assertCurrent: () => lease.assertCurrent(),
      load: async () => { if (++loads === 2) {
        if (event === 'background') visibility.suspend('background'); else visibility.close();
      } return value; },
      acknowledge: async () => { mutations++; return value; },
      export: async () => { mutations++; return value; },
      finishSave: async () => { mutations++; return value; },
    });
    await assert.rejects(actions.run(kind === 'finish-save' ? { kind, sessionId: 'session' }
      : { kind, sessionId: 'session', photoId: 'selected', retained: false, duplicateRiskAccepted: true }), /no longer authorized/);
    assert.equal(mutations, 0); assert.equal(value.shots[0]?.exportStatus, 'uncertain');
  });
}
