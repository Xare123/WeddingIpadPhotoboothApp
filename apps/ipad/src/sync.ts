import { File } from 'expo-file-system';
import { createQueueConsumer, QueuePreconditionError, QueueRequestFailure, type QueueTransport } from '@wedding-booth/core';
import { loadConnection } from './config';
import { sessionGuestPage } from './sharing';
import { removeCompletedRecipients, resolveRecipient } from './recipients';
import { getSessionPublicationAssets, listLocalSessions, reconcileConfirmedPhotos, store } from './storage';
import { nativeFixtureEnabled } from './native-fixture';
import { finalizeReadySessions } from './session-sync';
import { smsRequestExpired } from './sms-state';
import { createConnectionPreflight, expirePendingShares } from './sync-preflight';
import { performSharingRequest, sharingResponseJson, sharingReadyResponse } from './sharing-request';

const preflight = createConnectionPreflight(loadConnection, () => !nativeFixtureEnabled);
function connectionForPass() {
  const config = preflight.current();
  if (!config) throw new QueuePreconditionError();
  return config;
}

const transport: QueueTransport = {
  async upload(job) {
    const config = connectionForPass();
    const sessionId = encodeURIComponent(job.sessionId);
    const photoId = encodeURIComponent(job.photoId);
    const headers = { Authorization: `Bearer ${config.token}` };
    const bytes = await new File(job.fileUri).bytes();
    const options: RequestInit = {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    };
    await performSharingRequest('upload', () => fetch(`${config.origin}/v1/sessions/${sessionId}/photos/${photoId}`, options));
    // Acknowledging one durable upload cannot publish a partial session page.
    // The serialized after-drain step submits the full confirmed selection.
  },
  async share(job) {
    const jobs = await store.list();
    // Stop retaining a pending number after its acknowledged link lifetime,
    // including a lost provider reply followed by an offline/expired gallery.
    // Do this before pairing or recipient lookup, so missing sharing config
    // cannot keep the phone number in Keychain indefinitely.
    if (smsRequestExpired(job, jobs)) return 'expired';
    const config = connectionForPass();
    const session = (await listLocalSessions()).find(value => value.id === job.sessionId);
    if (!sessionGuestPage(session, jobs)) throw new Error('Session page is not ready');
    const phone = await resolveRecipient(job.recipientRef);
    const options: RequestInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, sessionId: job.sessionId, phone, consent: true }),
      signal: AbortSignal.timeout(30_000),
    };
    const response = await performSharingRequest('share', () => fetch(`${config.origin}/v1/shares`, options));
    const value = await sharingResponseJson(response, 'share');
    const result = value && typeof value === 'object' ? value as { status?: string } : {};
    if (!['mocked', 'accepted', 'test_accepted', 'uncertain', 'rejected'].includes(result.status ?? '')) {
      throw new QueueRequestFailure('share', 'invalid-response', response.status);
    }
    return result.status as 'mocked' | 'accepted' | 'test_accepted' | 'uncertain' | 'rejected';
  },
};

const consumer = createQueueConsumer(store, transport, async () => {
  if (!nativeFixtureEnabled) await finalizeReadySessions({
    store, sessions: listLocalSessions, publicationAssets: getSessionPublicationAssets,
    async ready(sessionId, photoIds, descriptor) {
      const config = connectionForPass();
      const options: RequestInit = {
        method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(descriptor ?? { photoIds }), signal: AbortSignal.timeout(30_000),
      };
      const response = await performSharingRequest('ready', () => fetch(`${config.origin}/v1/sessions/${encodeURIComponent(sessionId)}/ready`, options));
      const value = await sharingReadyResponse(response, descriptor ?? { photoIds }, config.origin);
      return { value, origin: config.origin };
    },
  });
  await removeCompletedRecipients();
}, Date.now, async () => {
  try { await reconcileConfirmedPhotos(); }
  finally {
    try { await expirePendingShares(store); }
    finally { await removeCompletedRecipients(); }
  }
}, () => preflight.check());

export const syncPending = () => consumer.sync();

export const retryPendingNow = () => consumer.retry();
