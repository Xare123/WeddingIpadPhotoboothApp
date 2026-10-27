import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateHostAction } from '../src/host-action-auth';
import { createHostVisibility } from '../src/host-visibility';

function fixture() {
  const visibility = createHostVisibility();
  let clock = 0, active = true;
  let step: (clock: number) => void = () => {};
  const dependencies = { visibility, isActive: () => active, now: () => clock,
    wait: async (ms: number) => { clock += ms; step(clock); } };
  return { visibility, dependencies, time: () => clock,
    active: (value: boolean) => { active = value; }, step: (value: typeof step) => { step = value; } };
}

test('action reserves fresh OS authentication, redacts old library lease and waits for foreground before granting', async () => {
  const f = fixture(), old = f.visibility.begin()!; f.visibility.finish(old);
  let calls = 0;
  f.step(clock => { if (clock === 200) f.active(true); });
  const pending = authenticateHostAction({ ...f.dependencies, authenticate: async () => {
    calls++; f.visibility.suspend('inactive'); f.active(false);
  } });
  await assert.rejects(authenticateHostAction({ ...f.dependencies, authenticate: async () => { calls++; } }), /Return to the booth|current iPad authentication/);
  const lease = await pending;
  lease.assertCurrent(); assert.equal(calls, 1); assert.equal(f.time(), 350);
  assert.equal(f.visibility.current(old), false);
  assert.equal(f.visibility.current(lease.ticket), true);
});

test('cancelled OS authentication never yields a lease and permits a fresh explicit attempt', async () => {
  const f = fixture();
  await assert.rejects(authenticateHostAction({ ...f.dependencies, authenticate: async () => { throw new Error('cancelled'); } }), /cancelled/);
  const lease = await authenticateHostAction({ ...f.dependencies, authenticate: async () => {} });
  lease.assertCurrent();
});

for (const event of ['background', 'close'] as const) {
  test(`${event} during OS authentication cannot be revived by a later successful result`, async () => {
    const f = fixture();
    await assert.rejects(authenticateHostAction({ ...f.dependencies, authenticate: async () => {
      if (event === 'background') f.visibility.suspend('background'); else f.visibility.close();
    } }), /left the booth|foreground/);
    const fresh = await authenticateHostAction({ ...f.dependencies, authenticate: async () => {} });
    fresh.assertCurrent();
  });
}

test('inactive/background/close after authentication invalidate the action lease and unrelated resume cannot restore it', async () => {
  for (const event of ['inactive', 'background', 'close']) {
    const f = fixture(), lease = await authenticateHostAction({ ...f.dependencies, authenticate: async () => {} });
    if (event === 'close') f.visibility.close(); else f.visibility.suspend(event);
    f.active(true);
    assert.throws(lease.assertCurrent, /no longer authorized/);
    const fresh = await authenticateHostAction({ ...f.dependencies, authenticate: async () => {} });
    assert.throws(lease.assertCurrent, /no longer authorized/); fresh.assertCurrent();
  }
});

test('foreground timeout and unmounted/inactive callers cannot obtain action permission', async () => {
  const f = fixture();
  await assert.rejects(authenticateHostAction({ ...f.dependencies, authenticate: async () => { f.active(false); } }), /foreground/);
  assert.equal(f.time(), 2000);
  let native = 0;
  await assert.rejects(authenticateHostAction({ ...f.dependencies, authenticate: async () => { native++; } }), /Return to the booth/);
  assert.equal(native, 0);
});
