import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { QueueJob } from '@wedding-booth/core';
import { normalizePhone } from './sharing';
import { store, type ActiveCapture, type ActiveSession } from './storage';
import { sessionGuestPage } from './sharing';

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

export async function queueSessionShare(session: ActiveSession, input: string, consent: boolean): Promise<void> {
  const guest = sessionGuestPage(session, await store.list());
  if (!consent || session.shots.length !== 5 || !guest) throw new Error('A ready five-photo session and explicit consent are required.');
  const phone = normalizePhone(input);
  const jobs = await store.list();
  if (jobs.some(job => job.kind === 'share' && job.sessionId === session.id && job.state !== 'rejected')) {
    throw new Error('A text request already exists for this session. Use the QR code while its outcome is checked.');
  }
  const id = randomUUID(), recipientRef = randomUUID(), now = Date.now();
  await SecureStore.setItemAsync(key(recipientRef), phone, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  try {
    await store.save({ id, photoId: session.shots[0]!.id, sessionId: session.id, kind: 'share',
      uploadJobId: session.shots[0]!.id, recipientRef, consentedAt: now, createdAt: now,
      attempts: 0, nextAttemptAt: now, state: 'pending', guestExpiresAt: guest.expiresAt });
  } catch {
    await SecureStore.deleteItemAsync(key(recipientRef));
    throw new Error('The text request could not save. Your photos and QR page remain available.');
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
    if (job.kind === 'share' && job.state !== 'pending') {
      await SecureStore.deleteItemAsync(key(job.recipientRef));
    }
  }
}
