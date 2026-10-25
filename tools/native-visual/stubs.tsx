/** DEV ONLY. No persistence, real device API, real guest URL, upload, or SMS. */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { uploadJob, type QueueJob } from '@wedding-booth/core';
import { fixtureControls } from './fixture-controls';

export const fixtureMode = new URLSearchParams(location.search).get('state') ?? 'camera';
if (!['camera', 'review', 'offline-pending', 'ready', 'mock-share'].includes(fixtureMode)) throw new Error('Unknown visual fixture state');
const image = '/synthetic-scene.jpg';
// Payload-only realistic hostname: never requested. All fixture traffic stays on loopback.
const qrPayload = new URLSearchParams(location.search).get('qrPayload') ?? 'reserved';
const fixtureURLs: Record<string, string> = {
  reserved: 'https://photobooth.example/g/' + 'a7'.repeat(32),
  realistic: 'https://photos.gizelleandrami.com/g/d948b21e9fbc4a03952beed701f680cf09e8d382f5c421a9f7da6034cbb16e52',
  'reserved-numeric': 'https://photobooth.example/g/' + '1'.repeat(64),
  'realistic-numeric': 'https://photos.gizelleandrami.com/g/' + '1'.repeat(64),
  'short-numeric': 'https://a.example/g/' + '1'.repeat(64),
};
export const fakeGuestURL = fixtureURLs[qrPayload] ?? fixtureURLs.reserved;
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
  if (!fixtureControls.online) return;
  for (const job of jobs) {
    if (job.state !== 'pending') continue;
    if (job.kind === 'upload') Object.assign(job, { state: 'complete', guestUrl: fakeGuestURL, guestExpiresAt: Date.now() + 86_400_000 });
    else job.state = 'mocked';
  }
};
export const retryPendingNow = syncPending;
export const useCameraPermissions = () => {
  const mode = new URLSearchParams(location.search).get('permission');
  const [granted, setGranted] = useState(mode !== 'denied' && mode !== 'blocked');
  return [{ granted, canAskAgain: mode !== 'blocked' }, async () => {
    fixtureControls.permissionRequests++;
    if (mode !== 'blocked') setGranted(true);
    return { granted: mode !== 'blocked' };
  }] as const;
};
export const CameraView = forwardRef(function FixtureCamera({ onCameraReady, style }: { onCameraReady?: () => void; style?: object }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => { fixtureControls.cameraCalls++; return { uri: image }; } }), []);
  useEffect(() => { onCameraReady?.(); }, []);
  return <View style={style}><Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Synthetic illustration standing in for camera; no live camera" /></View>;
});
