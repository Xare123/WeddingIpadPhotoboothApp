import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QueueJob } from '@wedding-booth/core';
import { RecipientRetention, RECIPIENT_ORPHAN_MAX_AGE_MS, RECIPIENT_INDEX_LIMIT, type RecipientRetentionPorts } from '../src/recipient-retention';
const job = (ref = 'opaque-ref'): QueueJob & { kind: 'share' } => ({ id: ref, photoId: 'photo', sessionId: 'session', kind: 'share', uploadJobId: 'photo', recipientRef: ref, consentedAt: 1, createdAt: 1, attempts: 0, nextAttemptAt: 1, state: 'pending' });
function fixture() {
  let index: string | null = null, now = 1;
  const secrets = new Map<string, string>();
  const jobs: QueueJob[] = [];
  const ports: RecipientRetentionPorts = {
    readIndex: async () => index, writeIndex: async value => { index = value; },
    writeSecret: async (ref, value) => { secrets.set(ref, value); },
    deleteSecret: async ref => { secrets.delete(ref); },
    listJobs: async () => jobs, saveJob: async value => { jobs.push(value); },
  };
  return { ports, secrets, jobs, index: () => index, advance: () => { now += RECIPIENT_ORPHAN_MAX_AGE_MS; }, restart: () => new RecipientRetention(ports, () => now) };
}
// The secret is generated in memory; no raw telephone fixture is persisted.
const secret = () => String.fromCharCode(43) + [1, 2, 0, 2, 5, 5, 5, 0, 1, 2, 3].join('');
for (const boundary of ['index', 'secret', 'job'] as const) {
  test(`termination after durable ${boundary} write recovers safely`, async () => {
    const f = fixture();
    const name = { index: 'writeIndex', secret: 'writeSecret', job: 'saveJob' }[boundary] as 'writeIndex' | 'writeSecret' | 'saveJob';
    const original = f.ports[name];
    (f.ports as any)[name] = async (...args: any[]) => { await (original as any)(...args); throw new Error('terminated'); };
    await assert.rejects(f.restart().queue(job(), secret()));
    (f.ports as any)[name] = original;
    assert.ok(f.index());
    f.advance();
    await f.restart().cleanup();
    assert.equal(f.secrets.has('opaque-ref'), boundary === 'job');
    assert.equal(JSON.parse(f.index()!).length, boundary === 'job' ? 1 : 0);
  });
}
test('DB outage retains even expired orphan and recovery removes it', async () => {
  const f = fixture(); f.ports.saveJob = async () => { throw new Error('offline'); };
  await assert.rejects(f.restart().queue(job(), secret())); f.advance();
  f.ports.listJobs = async () => { throw new Error('offline'); };
  await assert.rejects(f.restart().cleanup()); assert.equal(f.secrets.size, 1);
  f.ports.listJobs = async () => []; await f.restart().cleanup(); assert.equal(f.secrets.size, 0);
});
test('deletion then index-write termination retries without losing other pending secrets', async () => {
  const f = fixture(); const manager = f.restart();
  await manager.queue(job('first'), secret()); await manager.queue(job('second'), secret());
  f.jobs[0]!.state = 'complete'; const write = f.ports.writeIndex;
  f.ports.writeIndex = async () => { throw new Error('terminated'); };
  await assert.rejects(manager.cleanup()); assert.equal(f.secrets.has('second'), true);
  f.ports.writeIndex = write; await f.restart().cleanup();
  assert.deepEqual(JSON.parse(f.index()!).map((entry: any) => entry.ref), ['second']);
});
test('bounded capacity refuses a secret write and retains pending jobs regardless age', async () => {
  const f = fixture(); const manager = f.restart();
  for (let i = 0; i < RECIPIENT_INDEX_LIMIT; i++) await manager.queue(job(`ref-${i}`), secret());
  f.advance(); await manager.cleanup();
  await assert.rejects(manager.queue(job('overflow'), secret()));
  assert.equal(f.secrets.size, RECIPIENT_INDEX_LIMIT);
  assert.equal(f.index()!.includes(secret()), false);
});
test('failed reservation never writes secret; recent orphan survives grace period', async () => {
  const f = fixture(); const write = f.ports.writeIndex;
  f.ports.writeIndex = async () => { throw new Error('failed'); };
  await assert.rejects(f.restart().queue(job(), secret())); assert.equal(f.secrets.size, 0);
  f.ports.writeIndex = write; f.ports.saveJob = async () => { throw new Error('failed'); };
  await assert.rejects(f.restart().queue(job(), secret())); await f.restart().cleanup(); assert.equal(f.secrets.size, 1);
});
test('secret write failure and secret deletion failure preserve recoverable reservation', async () => {
  const f = fixture(); const write = f.ports.writeSecret;
  f.ports.writeSecret = async () => { throw new Error('unavailable'); };
  await assert.rejects(f.restart().queue(job(), secret())); assert.equal(f.secrets.size, 0);
  f.ports.writeSecret = write; f.advance(); await f.restart().cleanup();
  await f.restart().queue(job(), secret()); f.jobs[0]!.state = 'complete';
  const remove = f.ports.deleteSecret;
  f.ports.deleteSecret = async () => { throw new Error('locked'); };
  await assert.rejects(f.restart().cleanup());
  assert.equal(JSON.parse(f.index()!).length, 1); assert.equal(f.secrets.size, 1);
  f.ports.deleteSecret = remove; await f.restart().cleanup(); assert.equal(f.secrets.size, 0);
});
test('serialized reconciliation cannot delete a reservation during its secret/job write', async () => {
  const f = fixture(); const manager = f.restart(); const write = f.ports.writeSecret;
  let resume!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.ports.writeSecret = async (ref, value) => { await write(ref, value); entered(); await blocked; };
  const queue = manager.queue(job(), secret()); await started; f.advance();
  const cleanup = manager.cleanup(); resume(); await Promise.all([queue, cleanup]);
  assert.equal(f.secrets.size, 1); assert.equal(f.jobs.length, 1);
});
test('malformed metadata fails closed before secret mutation', async () => {
  const f = fixture(); await f.ports.writeIndex('{');
  await assert.rejects(f.restart().queue(job(), secret()));
  await assert.rejects(f.restart().cleanup()); assert.equal(f.secrets.size, 0);
});
