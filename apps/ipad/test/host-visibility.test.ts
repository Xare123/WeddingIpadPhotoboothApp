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
