import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyShareReadiness, type ShareReadinessInput } from '../src/share-readiness';
import type { ActiveSession } from '../src/local-types';

const now = 10_000;
function fixture() {
  const ids = ['a', 'b', 'c', 'd'];
  const session: ActiveSession = { id: 'session', createdAt: 1, targetCount: 4, confirmed: true,
    shots: ids.map(id => ({ id, sessionId: 'session', fileUri: `file:///${id}.jpg`, confirmed: true, createdAt: 1 })),
    composite: { id: 'keepsake', fileUri: 'file:///keepsake.jpg', originalPhotoIds: ids,
      recipe: { version: 'wedding-template-v2', gridAspect: 'portrait', layout: 'strip', theme: 'classic', photoIds: ids,
        cropsByPhotoId: Object.fromEntries(ids.map(id => [id, { mode: 'fit', x: 0, y: 0, zoom: 1 }])) } } };
  const input: ShareReadinessInput = { session, connection: 'paired', sync: 'idle', now,
    jobs: [...ids, 'keepsake'].map(photoId => ({ kind: 'upload', state: 'pending', sessionId: session.id, photoId, attempts: 0, nextAttemptAt: 0 })) };
  return input;
}
const acknowledged = (input = fixture(), expiresAt = now + 1000): ShareReadinessInput => ({ ...input, jobs: input.jobs.map(job => ({ ...job, state: 'complete', guestUrl: 'https://photos.gizelleandrami.com/g/synthetic-only', guestExpiresAt: expiresAt })) });

test('unpaired setup overrides failed queued attempts and offers only private host setup', () => {
  const input = fixture(); input.connection = 'unpaired'; input.sync = 'failed'; input.network = 'offline';
  input.jobs = input.jobs.map(job => ({ ...job, attempts: 4 }));
  const result = classifyShareReadiness(input);
  assert.equal(result.status, 'setup-required'); assert.equal(result.action, 'private-setup'); assert.equal(result.guestPage, null);
  assert.equal(result.title, 'Ask the host to connect sharing'); assert.equal(result.savedMessage, '4 originals saved on this iPad');
  assert.match(result.hostMessage, /one-time code/); assert.doesNotMatch(result.message, /API|token|phone|offline|uploading/i);
});
test('unknown, missing and unreadable connection settings remain distinct', () => {
  const input = fixture();
  for (const [connection, status] of [['checking', 'checking'], ['unpaired', 'setup-required'], ['unavailable', 'connection-unavailable']] as const) {
    const result = classifyShareReadiness({ ...input, connection });
    assert.equal(result.status, status); assert.equal(result.guestPage, null); assert.equal(result.savedCount, 4);
  }
});
test('pending queued uploads do not prove offline or upload activity', () => {
  const input = fixture();
  assert.equal(classifyShareReadiness(input).status, 'queued');
  assert.equal(classifyShareReadiness({ ...input, network: 'online' }).status, 'queued');
  const waiting = { ...input, sync: 'running' as const, jobs: input.jobs.map(job => ({ ...job, nextAttemptAt: now + 1000 })) };
  assert.equal(classifyShareReadiness(waiting).status, 'queued');
  assert.equal(classifyShareReadiness({ ...input, sync: 'running' }).status, 'uploading');
});
test('offline requires explicit network evidence; generic request failure stays retryable and unknown', () => {
  const input = fixture();
  assert.equal(classifyShareReadiness({ ...input, network: 'offline' }).status, 'offline');
  const result = classifyShareReadiness({ ...input, sync: 'failed' });
  assert.equal(result.status, 'upload-failed'); assert.equal(result.action, 'retry'); assert.doesNotMatch(result.message, /offline|reconnect/i);
  assert.equal(classifyShareReadiness({ ...input, jobs: input.jobs.map(job => ({ ...job, attempts: 1 })) }).status, 'upload-failed');
});
test('missing index rows and other-session jobs cannot create progress or readiness', () => {
  const input = fixture();
  input.jobs = input.jobs.map(job => ({ ...job, sessionId: 'another-session', state: 'complete' }));
  const result = classifyShareReadiness({ ...input, sync: 'running' });
  assert.equal(result.status, 'queued'); assert.match(result.hostMessage, /index repair/); assert.equal(result.guestPage, null);
});
test('all selected/raw/composite uploads without the ready acknowledgement are publishing, never QR ready', () => {
  const input = fixture(); input.jobs = input.jobs.map(job => ({ ...job, state: 'complete' }));
  const result = classifyShareReadiness(input);
  assert.equal(result.status, 'publishing'); assert.equal(result.guestPage, null); assert.equal(result.action, 'retry');
  assert.equal(classifyShareReadiness({ ...input, sync: 'running' }).action, 'none');
});
test('only an exact whole-session public URL acknowledgement is ready, even if pairing is later absent', () => {
  const input = acknowledged();
  for (const connection of ['paired', 'unpaired', 'unavailable', 'checking'] as const) {
    const result = classifyShareReadiness({ ...input, connection, network: 'offline' });
    assert.equal(result.status, 'ready'); assert.equal(result.action, 'none'); assert.equal(result.guestPage?.url, 'https://photos.gizelleandrami.com/g/synthetic-only');
  }
});
test('partial, mixed, local-only and missing-composite acknowledgements never expose a QR', () => {
  const input = acknowledged();
  const variants = [input.jobs.slice(0, 4), input.jobs.map((job, i) => i ? job : { ...job, guestUrl: undefined }),
    input.jobs.map((job, i) => i ? job : { ...job, guestExpiresAt: now + 2000 }),
    input.jobs.map(job => ({ ...job, guestUrl: 'http://127.0.0.1:8790/g/example' })),
    input.jobs.map((job, i) => i ? job : { ...job, guestUrl: 'https://photos.gizelleandrami.com/g/other' })];
  for (const jobs of variants) assert.equal(classifyShareReadiness({ ...input, jobs }).guestPage, null);
});
test('expired means a previously consistent complete acknowledgement, not an arbitrary expired queue field', () => {
  const input = acknowledged(fixture(), now);
  const result = classifyShareReadiness({ ...input, connection: 'unpaired' });
  assert.equal(result.status, 'expired'); assert.equal(result.guestPage, null); assert.equal(result.action, 'none'); assert.match(result.hostMessage, /does not extend/);
  const broken = { ...input, jobs: input.jobs.map((job, i) => i ? job : { ...job, guestExpiresAt: now - 1 }) };
  assert.notEqual(classifyShareReadiness(broken).status, 'expired');
});
test('draft/incomplete recipes remain saved without implying a confirmed cloud session', () => {
  const input = fixture();
  assert.equal(classifyShareReadiness({ ...input, session: { ...input.session!, confirmed: false } }).status, 'saved');
  assert.equal(classifyShareReadiness({ ...input, session: { ...input.session!, composite: undefined } }).status, 'saved');
  const empty = classifyShareReadiness({ ...input, session: null });
  assert.equal(empty.savedCount, 0); assert.equal(empty.savedMessage, 'No saved photos in this session'); assert.equal(empty.guestPage, null);
});
test('legacy five-photo ready acknowledgement is preserved and inputs are never mutated', () => {
  const input = fixture(); input.session = { ...input.session!, targetCount: 5, composite: undefined,
    shots: [...input.session!.shots, { id: 'e', sessionId: 'session', fileUri: 'file:///e.jpg', confirmed: true, createdAt: 1 }] };
  input.jobs = [...input.jobs.filter(job => job.photoId !== 'keepsake'), { ...input.jobs[0]!, photoId: 'e' }];
  const ready = acknowledged(input); const snapshot = JSON.stringify(ready);
  assert.equal(classifyShareReadiness(ready).status, 'ready'); assert.equal(JSON.stringify(ready), snapshot);
});
test('only a relevant sanitized authorization diagnostic points the host to private setup; historical attempts remain unclassified', () => {
  const input = fixture();
  const failed = { ...input, jobs: input.jobs.map(job => ({ ...job, attempts: 15, lastFailure: { operation: 'upload' as const, category: 'authorization' as const, at: now, httpStatus: 401 } })) };
  const result = classifyShareReadiness(failed);
  assert.equal(result.status, 'upload-failed'); assert.equal(result.action, 'private-setup'); assert.match(result.hostMessage, /HTTP 401/);
  assert.equal(classifyShareReadiness({ ...input, jobs: input.jobs.map(job => ({ ...job, attempts: 15 })) }).action, 'retry');
  assert.equal(classifyShareReadiness({ ...failed, sync: 'running' }).status, 'uploading');
  const unrelated = { ...input, jobs: [...input.jobs, ...failed.jobs.map(job => ({ ...job, sessionId: 'another-session' }))] };
  assert.equal(classifyShareReadiness(unrelated).status, 'queued');
});
test('ready-request diagnostics do not turn complete uploads into a misleading ready state; network diagnostics never assert offline', () => {
  const input = fixture();
  const readyFailed = { ...input, jobs: input.jobs.map(job => ({ ...job, state: 'complete' as const, lastFailure: { operation: 'ready' as const, category: 'authorization' as const, at: now, httpStatus: 403 } })) };
  assert.equal(classifyShareReadiness(readyFailed).action, 'private-setup'); assert.equal(classifyShareReadiness(readyFailed).guestPage, null);
  const network = { ...input, jobs: input.jobs.map(job => ({ ...job, lastFailure: { operation: 'upload' as const, category: 'network' as const, at: now } })) };
  const result = classifyShareReadiness(network); assert.equal(result.status, 'upload-failed'); assert.equal(result.action, 'retry');
  assert.match(result.hostMessage, /does not prove.*offline/); assert.doesNotMatch(result.message, /offline|reconnect/i);
});
