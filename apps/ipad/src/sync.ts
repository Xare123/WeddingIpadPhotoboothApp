import { File } from 'expo-file-system';
import { createQueueConsumer, type QueueTransport } from '@wedding-booth/core';
import { loadConnection } from './config';
import { readyGuestPage } from './sharing';
import { removeCompletedRecipients, resolveRecipient } from './recipients';
import { store } from './storage';
import { nativeFixtureEnabled } from './native-fixture';

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
    const ready = await fetch(`${config.origin}/v1/sessions/${sessionId}/ready`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: [job.photoId] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!ready.ok) throw new Error('Guest page was not acknowledged');
    return readyGuestPage(await ready.json(), config.origin);
  },
  async share(job) {
    if (nativeFixtureEnabled) throw new Error('Synthetic native fixture remains offline');
    const config = await loadConnection();
    if (!config?.token) throw new Error('Offline: API is not configured');
    const phone = await resolveRecipient(job.recipientRef);
    const response = await fetch(`${config.origin}/v1/shares`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, sessionId: job.sessionId, phone, consent: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Simulation was not acknowledged');
    const result = await response.json() as { status?: string };
    if (result.status !== 'mocked') throw new Error('Unexpected simulation status');
    return 'mocked';
  },
};

const consumer = createQueueConsumer(store, transport, removeCompletedRecipients);

export const syncPending = () => consumer.sync();

export const retryPendingNow = () => consumer.retry();
