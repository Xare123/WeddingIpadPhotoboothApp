import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { QueueJob } from '@wedding-booth/core';
import { RecipientRetention } from './recipient-retention';
import { normalizePhone } from './sharing';
import { store, type ActiveCapture, type ActiveSession } from './storage';
import { sessionGuestPage } from './sharing';

const key = (ref: string) => `wedding-photobooth.recipient.${ref}`;
const indexKey = 'wedding-photobooth.recipient-index.v1';
const retention = new RecipientRetention({
  readIndex: () => SecureStore.getItemAsync(indexKey),
  writeIndex: value => SecureStore.setItemAsync(indexKey, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  writeSecret: (ref, phone) => SecureStore.setItemAsync(key(ref), phone, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteSecret: ref => SecureStore.deleteItemAsync(key(ref)),
  listJobs: () => store.list(),
  saveJob: job => store.save(job),
});

export async function queueMockShare(capture: ActiveCapture, input: string, consent: boolean): Promise<void> {
  if (!capture.confirmed || !consent) throw new Error('Confirm the photo and consent before testing phone sharing.');
  const phone = normalizePhone(input);
  const id = randomUUID();
  const recipientRef = randomUUID();
  const now = Date.now();
  const job: QueueJob & { kind: 'share' } = {
    id, photoId: capture.id, sessionId: capture.id, kind: 'share', uploadJobId: capture.id,
    recipientRef, consentedAt: now, createdAt: now, attempts: 0, nextAttemptAt: now, state: 'pending',
  };
  await retention.queue(job, phone);
}

export async function queueSessionShare(session: ActiveSession, input: string, consent: boolean): Promise<void> {
  const guest = sessionGuestPage(session, await store.list());
  if (!consent || ![4, 5].includes(session.targetCount) || session.shots.length !== session.targetCount || !guest) throw new Error('A complete ready photo session and explicit consent are required.');
  const phone = normalizePhone(input);
  const jobs = await store.list();
  if (jobs.some(job => job.kind === 'share' && job.sessionId === session.id && job.state !== 'rejected')) {
    throw new Error('A text request already exists for this session. Use the QR code while its outcome is checked.');
  }
  const id = randomUUID(), recipientRef = randomUUID(), now = Date.now();
  try {
    await retention.queue({ id, photoId: session.shots[0]!.id, sessionId: session.id, kind: 'share',
      uploadJobId: session.shots[0]!.id, recipientRef, consentedAt: now, createdAt: now,
      attempts: 0, nextAttemptAt: now, state: 'pending', guestExpiresAt: guest.expiresAt }, phone);
  } catch {
    throw new Error('The text request could not save. Your photos and QR page remain available.');
  }
}

export async function resolveRecipient(ref: string): Promise<string> {
  const phone = await SecureStore.getItemAsync(key(ref));
  if (!phone) throw new Error('Recipient is unavailable');
  return normalizePhone(phone);
}

export async function removeCompletedRecipients(): Promise<void> {
  await retention.cleanup();
}
