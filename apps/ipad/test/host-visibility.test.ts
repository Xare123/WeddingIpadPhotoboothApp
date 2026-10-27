import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostVisibility } from '../src/host-visibility';
test('inactive host screens revoke their lease and foreground does not unlock', () => {
  const gate = createHostVisibility(); const ticket = gate.begin()!; assert.ok(gate.finish(ticket));
  gate.suspend('inactive'); assert.equal(gate.current(ticket), false);
  const second = gate.begin()!; assert.ok(gate.finish(second)); gate.suspend('background'); assert.equal(gate.current(second), false);
});
test('an authentication prompt may go inactive, but actual background revokes it', () => {
  const gate = createHostVisibility(); const ticket = gate.begin()!;
  assert.equal(gate.begin(), null); gate.suspend('inactive'); assert.ok(gate.finish(ticket));
  const next = gate.begin()!; gate.suspend('background'); assert.equal(gate.finish(next), false);
});
test('closing rejects a late authentication or private library read', () => {
  const gate = createHostVisibility(); const ticket = gate.begin()!; gate.close();
  assert.equal(gate.finish(ticket), false); const newTicket = gate.begin()!; assert.ok(gate.finish(newTicket));
  assert.equal(gate.current(ticket), false); assert.ok(gate.current(newTicket));
});

function foreground(initial = false) {
  let clock = 0, active = initial;
  const steps: ((clock: number) => void)[] = [];
  return {
    dependencies: { isActive: () => active, now: () => clock,
      wait: async (ms: number) => { clock += ms; for (const step of steps) step(clock); } },
    setActive(value: boolean) { active = value; },
    onWait(step: (clock: number) => void) { steps.push(step); },
    time: () => clock,
  };
}

test('fresh authentication waits for the OS inactive-to-active transition before opening', async () => {
  const gate = createHostVisibility(), ticket = gate.begin()!, state = foreground();
  gate.suspend('inactive');
  state.onWait(clock => { if (clock === 250) state.setActive(true); });
  assert.equal(await gate.waitForActive(ticket, state.dependencies), true);
  assert.equal(state.time(), 400);
  assert.equal(gate.begin(), null, 'ticket stays reserved during foreground settling');
  assert.equal(gate.finish(ticket), true);
  assert.equal(gate.current(ticket), true);
});

test('background during OS authentication, unrelated resume, and explicit close stay locked', async () => {
  for (const revoke of ['background', 'close'] as const) {
    const gate = createHostVisibility(), ticket = gate.begin()!, state = foreground(true);
    state.onWait(clock => { if (clock === 50) {
      if (revoke === 'background') gate.suspend('background'); else gate.close();
    } });
    assert.equal(await gate.waitForActive(ticket, state.dependencies), false);
    assert.equal(gate.finish(ticket), false);
    assert.equal(gate.current(ticket), false);
    const next = gate.begin()!;
    assert.notEqual(next, ticket);
    assert.equal(await gate.waitForActive(ticket, state.dependencies), false, 'old result cannot open a new attempt');
    assert.equal(await gate.waitForActive(next, state.dependencies), true);
    assert.equal(gate.finish(next), true);
  }
});

test('foreground settling resets on another inactive transition and has a finite deadline', async () => {
  const gate = createHostVisibility(), ticket = gate.begin()!, state = foreground(true);
  state.onWait(clock => { if (clock === 100) { state.setActive(false); gate.suspend('inactive'); }
    if (clock === 200) state.setActive(true); });
  assert.equal(await gate.waitForActive(ticket, state.dependencies), true);
  assert.equal(state.time(), 350);
  gate.finish(ticket);
  const pending = gate.begin()!, neverActive = foreground();
  assert.equal(await gate.waitForActive(pending, neverActive.dependencies), false);
  assert.equal(neverActive.time(), 2000);
  gate.finish(pending);
  const fresh = gate.begin()!;
  assert.equal(await gate.waitForActive(fresh, foreground(true).dependencies), true, 'timeout must permit a new attempt');
});

test('finishing a cancelled attempt or a stale waiter cannot unlock or revoke a later host lease', async () => {
  const gate = createHostVisibility(), cancelled = gate.begin()!;
  gate.finish(cancelled); // Cancellation never calls the successful-auth foreground path.
  assert.equal(await gate.waitForActive(cancelled, foreground(true).dependencies), false);
  const ticket = gate.begin()!;
  assert.equal(await gate.waitForActive(ticket, foreground(true).dependencies), true);
  gate.finish(cancelled);
  assert.equal(gate.current(ticket), true);
  gate.finish(ticket);
  gate.suspend('inactive');
  assert.equal(gate.current(ticket), false, 'visible host/private reads revoke on inactive');
});

test('shared Host authentication flow waits after native success and never waits after cancellation', async () => {
  const gate = createHostVisibility(), ticket = gate.begin()!, state = foreground(true);
  let nativeCalls = 0;
  const accepted = gate.authenticate(ticket, async () => {
    nativeCalls++; gate.suspend('inactive'); state.setActive(false);
    // Native success may arrive before the JS active notification.
  }, state.dependencies);
  state.onWait(clock => { if (clock === 200) state.setActive(true); });
  assert.equal(await accepted, true);
  assert.equal(nativeCalls, 1); assert.equal(state.time(), 350);
  assert.equal(gate.finish(ticket), true);
  const cancelled = gate.begin()!, cancellationState = foreground();
  await assert.rejects(gate.authenticate(cancelled, async () => { throw new Error('cancelled'); }, cancellationState.dependencies), /cancelled/);
  assert.equal(cancellationState.time(), 0);
  gate.finish(cancelled);
  assert.equal(await gate.authenticate(cancelled, async () => { throw new Error('stale invoked OS'); }, state.dependencies), false);
});

test('diagnostic state is bounded, excludes arbitrary app-state data, and returns detached snapshots', () => {
  const gate = createHostVisibility(); gate.begin();
  for (let index = 0; index < 30; index++) gate.record('lifecycle', 'active');
  gate.record('failed', 'private arbitrary state', 'user_cancel');
  const snapshot = gate.diagnostics();
  assert.equal(snapshot.length, 12);
  assert.deepEqual(snapshot.at(-1), { stage: 'failed', appState: 'unknown', pending: true, code: 'user_cancel' });
  assert.equal(JSON.stringify(snapshot).includes('private arbitrary'), false);
  snapshot[0]!.appState = 'modified';
  assert.notEqual(gate.diagnostics()[0]!.appState, 'modified');
});

test('even a brief inactive event between samples resets the foreground settling interval', async () => {
  const gate = createHostVisibility(), ticket = gate.begin()!, state = foreground(true);
  state.onWait(clock => { if (clock === 100) gate.suspend('inactive'); });
  assert.equal(await gate.waitForActive(ticket, state.dependencies), true);
  assert.equal(state.time(), 250);
});
