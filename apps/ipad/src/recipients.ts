import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { QueueJob } from '@wedding-booth/core';
import { normalizePhone } from './sharing';
import { store, type ActiveCapture } from './storage';

const key = (ref: string) => `wedding-photobooth.recipient.${ref}`;

export async function queueMockShare(capture: ActiveCapture, input: string, consent: boolean): Promise<void> {
  if (!capture.confirmed || !consent) throw new Error('Confirm the photo and consent before testing phone sharing.');
  const phone = normalizePhone(input);
  const id = randomUUID();
  const recipientRef = randomUUID();
  await SecureStore.setItemAsync(key(recipientRef), phone, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  const now = Date.now();
  const job: QueueJob = {
    id, photoId: capture.id, sessionId: capture.id, kind: 'share', uploadJobId: capture.id,
    recipientRef, consentedAt: now, createdAt: now, attempts: 0, nextAttemptAt: now, state: 'pending',
  };
  try { await store.save(job); }
  catch (error) {
    await SecureStore.deleteItemAsync(key(recipientRef));
    throw error;
  }
}

export async function resolveRecipient(ref: string): Promise<string> {
  const phone = await SecureStore.getItemAsync(key(ref));
  if (!phone) throw new Error('Recipient is unavailable');
  return normalizePhone(phone);
}

export async function removeCompletedRecipients(): Promise<void> {
  for (const job of await store.list()) {
    // Completion is already durable. Never delete a pending recipient: retries
    // resolve this same opaque reference after network errors or process death.
    if (job.kind === 'share' && (job.state === 'mocked' || job.state === 'complete')) {
      await SecureStore.deleteItemAsync(key(job.recipientRef));
    }
  }
}
