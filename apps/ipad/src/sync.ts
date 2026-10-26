import { File } from 'expo-file-system';
import { createQueueConsumer, type QueueTransport } from '@wedding-booth/core';
import { loadConnection } from './config';
import { sessionGuestPage } from './sharing';
import { removeCompletedRecipients, resolveRecipient } from './recipients';
import { listLocalSessions, store } from './storage';
import { nativeFixtureEnabled } from './native-fixture';
import { finalizeReadySessions } from './session-sync';
import { smsRequestExpired } from './sms-state';

const transport: QueueTransport = {
  async upload(job) {
    if (nativeFixtureEnabled) throw new Error('Synthetic native fixture remains offline');
    const config = await loadConnection();
    if (!config?.token) throw new Error('Offline: API is not configured');
    const sessionId = encodeURIComponent(job.sessionId);
    const photoId = encodeURIComponent(job.photoId);
    const headers = { Authorization: `Bearer ${config.token}` };
    const response = await fetch(`${config.origin}/v1/sessions/${sessionId}/photos/${photoId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
      body: await new File(job.fileUri).bytes(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Upload was not acknowledged');
    // Acknowledging one durable upload cannot publish a partial session page.
    // The serialized after-drain step submits the full confirmed selection.
  },
  async share(job) {
    if (nativeFixtureEnabled) throw new Error('Synthetic native fixture remains offline');
    const jobs = await store.list();
    // Stop retaining a pending number after its acknowledged link lifetime,
    // including a lost provider reply followed by an offline/expired gallery.
    // Do this before pairing or recipient lookup, so missing sharing config
    // cannot keep the phone number in Keychain indefinitely.
    if (smsRequestExpired(job, jobs)) return 'expired';
    const config = await loadConnection();
    if (!config?.token) throw new Error('Offline: API is not configured');
    const session = (await listLocalSessions()).find(value => value.id === job.sessionId);
    if (session?.shots.length !== 5 || !sessionGuestPage(session, jobs)) throw new Error('Five-photo session page is not ready');
    const phone = await resolveRecipient(job.recipientRef);
    const response = await fetch(`${config.origin}/v1/shares`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, sessionId: job.sessionId, phone, consent: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Sharing was not acknowledged');
    const result = await response.json() as { status?: string };
    if (!['mocked', 'accepted', 'test_accepted', 'uncertain', 'rejected'].includes(result.status ?? '')) {
      throw new Error('Sharing outcome was not acknowledged');
    }
    return result.status as 'mocked' | 'accepted' | 'test_accepted' | 'uncertain' | 'rejected';
  },
};

const consumer = createQueueConsumer(store, transport, async () => {
  if (!nativeFixtureEnabled) await finalizeReadySessions({
    store, sessions: listLocalSessions,
    async ready(sessionId, photoIds) {
      const config = await loadConnection();
      if (!config?.token) throw new Error('Offline: booth is not paired');
      const response = await fetch(`${config.origin}/v1/sessions/${encodeURIComponent(sessionId)}/ready`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error('Session page was not acknowledged');
      return { value: await response.json(), origin: config.origin };
    },
  });
  await removeCompletedRecipients();
});

export const syncPending = () => consumer.sync();

export const retryPendingNow = () => consumer.retry();
