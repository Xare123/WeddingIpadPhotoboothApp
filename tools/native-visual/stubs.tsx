/** DEV ONLY. No persistence, real device API, real guest URL, upload, or SMS. */
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { uploadJob, type QueueJob } from '@wedding-booth/core';

export const fixtureMode = new URLSearchParams(location.search).get('state') ?? 'camera';
if (!['camera', 'review', 'offline-pending', 'ready', 'mock-share'].includes(fixtureMode)) throw new Error('Unknown visual fixture state');
const image = '/synthetic-scene.jpg';
export const fakeGuestURL = 'https://photobooth.example/g/' + 'a7'.repeat(32);
type ActiveCapture = { id: string; fileUri: string; confirmed: boolean; createdAt: number };
let active: ActiveCapture | null = fixtureMode === 'camera' ? null : {
  id: 'synthetic-fixture-photo', fileUri: image, confirmed: fixtureMode !== 'review', createdAt: Date.now(),
};
const jobs: QueueJob[] = active?.confirmed ? [{
  ...uploadJob(active.id, 'file://synthetic-fixture-photo.jpg'),
  ...(fixtureMode === 'offline-pending' ? {} : { state: 'complete' as const, guestUrl: fakeGuestURL, guestExpiresAt: Date.now() + 86_400_000 }),
}] : [];
if (fixtureMode === 'mock-share') jobs.push({
  id: 'synthetic-fixture-share', photoId: active!.id, sessionId: active!.id, kind: 'share', uploadJobId: active!.id,
  recipientRef: 'synthetic-vault-reference', consentedAt: Date.now(), createdAt: Date.now(), attempts: 0, nextAttemptAt: 0, state: 'mocked',
});
const vault = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'fixture-only';
export const getItemAsync = async (key: string) => vault.get(key) ?? null;
export const setItemAsync = async (key: string, value: string) => { vault.set(key, value); };
export const deleteItemAsync = async (key: string) => { vault.delete(key); };
export const randomUUID = () => crypto.randomUUID();
export const authenticateHost = async () => {};
let connection: { origin: string; token: string } | null = fixtureMode === 'offline-pending' ? null : { origin: 'https://photobooth.example', token: 'synthetic-fixture-only' };
export const loadConnection = async () => connection;
export const saveConnection = async (origin: string, token: string) => { connection = { origin, token }; };
export const clearConnection = async () => { connection = null; };
export const store = {
  list: async () => jobs.map(job => ({ ...job })),
  save: async (job: QueueJob) => { const i = jobs.findIndex(j => j.id === job.id); if (i < 0) jobs.push({ ...job }); else jobs[i] = { ...job }; },
};
export const getActiveCapture = async () => active;
export const setActiveCapture = async (value: ActiveCapture | null) => { active = value; };
export const recoverPreservedPhotos = async () => {};
export const preserveCapture = async (id: string, uri: string) => {
  active = { id, fileUri: uri, confirmed: false, createdAt: Date.now() };
  return active;
};
export const confirmCapture = async (capture: ActiveCapture) => {
  active = { ...capture, confirmed: true };
  await store.save(uploadJob(active.id, 'file://synthetic-fixture-photo.jpg'));
  return active;
};
export const syncPending = async () => {
  if (fixtureMode === 'offline-pending') return;
  for (const job of jobs) {
    if (job.state !== 'pending') continue;
    if (job.kind === 'upload') Object.assign(job, { state: 'complete', guestUrl: fakeGuestURL, guestExpiresAt: Date.now() + 86_400_000 });
    else job.state = 'mocked';
  }
};
export const retryPendingNow = syncPending;
export const useCameraPermissions = () => [{ granted: true, canAskAgain: true }, async () => ({ granted: true })] as const;
export const CameraView = forwardRef(function FixtureCamera({ onCameraReady, style }: { onCameraReady?: () => void; style?: object }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => ({ uri: image }) }), []);
  useEffect(() => { onCameraReady?.(); }, []);
  return <View style={style}><Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Synthetic illustration standing in for camera; no live camera" /></View>;
});
