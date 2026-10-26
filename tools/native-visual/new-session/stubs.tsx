/** DEV ONLY. In-memory synthetic native boundaries; no Files/SQLite/Photos/cloud/SMS. */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { uploadJob, type QueueJob } from '@wedding-booth/core';
import type { ActiveCapture, ActiveSession, PhotoLibraryCapability } from '../../../apps/ipad/src/local-types';
import { fixtureControls, fixtureState } from './fixture-controls';

const parameters = new URLSearchParams(location.search);
const clone = <T,>(value: T): T => structuredClone(value);
const sessionID = '0f1e2d3c-4b5a-4678-9abc-000000000001';
const shotURI = (id: string) => `/synthetic/shot/${id}.png`;
const guestURLs: Record<string, string> = {
  reserved: 'https://photobooth.example/g/' + 'a7'.repeat(32),
  realistic: 'https://photos.gizelleandrami.com/g/d948b21e9fbc4a03952beed701f680cf09e8d382f5c421a9f7da6034cbb16e52',
  'reserved-numeric': 'https://photobooth.example/g/' + '1'.repeat(64),
  'realistic-numeric': 'https://photos.gizelleandrami.com/g/' + '1'.repeat(64),
  'short-numeric': 'https://a.example/g/' + '1'.repeat(64),
};
export const fixtureGuestURL = guestURLs[parameters.get('payload') ?? 'reserved'] ?? guestURLs.reserved;
const expiry = Date.now() + 7 * 86_400_000;
const histories = new Map<string, ActiveSession>();
const jobs: QueueJob[] = [];
let active: ActiveSession | null = null;
let preferences = { countdownSeconds: 3, photosExportEnabled: true };
let photosPermission = fixtureState === 'photos-denied' || parameters.get('photos') === 'denied' ? 'denied' : 'granted';
if (parameters.get('network') === 'offline') fixtureControls.online = false;
if (['camera', 'partial', 'review', 'photos-denied', 'photos-uncertain', 'pending', 'ready', 'partial-ready'].includes(fixtureState)) {
  const count = fixtureState === 'camera' ? 0 : fixtureState === 'partial' ? 2 : 5;
  const confirmed = ['pending', 'ready', 'partial-ready'].includes(fixtureState);
  active = { id: sessionID, createdAt: Date.now(), targetCount: 5, confirmed, shots: Array.from({ length: count }, (_, slot) => {
    const id = `10000000-0000-4000-8000-00000000000${slot + 1}`;
    return { id, fileUri: shotURI(id), confirmed, createdAt: Date.now() + slot, sessionId: sessionID, shotIndex: slot, exportStatus: fixtureState === 'photos-uncertain' ? 'uncertain' : photosPermission === 'denied' ? 'denied' : 'saved' };
  }) };
  histories.set(active.id, clone(active));
  if (confirmed) for (const photo of active.shots) jobs.push({
    ...uploadJob(photo.id, `file://synthetic/${photo.id}.jpg`, photo.createdAt, active.id),
    ...(fixtureState === 'ready' ? { state: 'complete' as const, guestUrl: fixtureGuestURL, guestExpiresAt: expiry } : {}),
  });
}
function commit(session: ActiveSession): ActiveSession {
  const value = clone(session);
  histories.set(value.id, value);
  if (active?.id === value.id) active = value;
  return clone(value);
}
function event(kind: string, id?: string, slot?: number) { fixtureControls.events.push({ kind, id, slot, at: Date.now() }); }
fixtureControls.snapshot = () => clone({ active, sessions: [...histories.values()], jobs, preferences, photosPermission });
export const store = {
  list: async () => clone(jobs),
  save: async (job: QueueJob) => { const index = jobs.findIndex(value => value.id === job.id); if (index < 0) jobs.push(clone(job)); else jobs[index] = clone(job); },
};
export const getActiveSession = async () => clone(active);
export const getLocalSession = async (id: string) => clone(histories.get(id) ?? null);
export const getActiveCapture = async () => clone(active?.shots.at(-1) ?? null);
export const listLocalSessions = async () => clone([...histories.values()]);
export const recoverPreservedPhotos = async () => { event('synthetic-recovery-noop'); };
export const createSession = async (): Promise<ActiveSession> => {
  active = { id: crypto.randomUUID(), createdAt: Date.now(), targetCount: 5, shots: [], confirmed: false };
  event('session-created', active.id);
  return commit(active);
};
export const saveShot = async (session: ActiveSession, id: string, _temporaryURI: string, slot: number): Promise<ActiveSession> => {
  if (session.confirmed || slot < 0 || slot >= session.targetCount) throw new Error('Invalid synthetic shot slot');
  event('private-save-started', id, slot);
  if (fixtureControls.failNextSave) { fixtureControls.failNextSave = false; throw new Error('Synthetic private-save failure'); }
  // Preserve an asynchronous boundary so the actual capture runner must await it.
  await Promise.resolve();
  const previous = session.shots.find(photo => photo.shotIndex === slot);
  const photo: ActiveCapture = { id, fileUri: shotURI(id), createdAt: Date.now(), confirmed: false, sessionId: session.id, shotIndex: slot, exportStatus: 'pending' };
  const updated = { ...session, shots: [...session.shots.filter(photo => photo.shotIndex !== slot), photo].sort((a, b) => a.shotIndex! - b.shotIndex!), retakes: [...(session.retakes ?? []), ...(previous ? [previous] : [])] };
  const result = commit(updated);
  event('private-save-resolved', id, slot);
  return result;
};
export const confirmSession = async (session: ActiveSession): Promise<ActiveSession> => {
  if (session.shots.length !== 5 || new Set(session.shots.map(photo => photo.shotIndex)).size !== 5) throw new Error('Five synthetic shots required');
  const confirmed = { ...session, confirmed: true, shots: session.shots.map(photo => ({ ...photo, confirmed: true })) };
  for (const photo of confirmed.shots) if (!jobs.some(job => job.id === photo.id)) await store.save(uploadJob(photo.id, `file://synthetic/${photo.id}.jpg`, photo.createdAt, session.id));
  event('session-confirmed', session.id);
  return commit(confirmed);
};
export const clearActiveSession = async () => { event('active-session-cleared', active?.id); active = null; };
export const getPhotoLibraryCapability = async (): Promise<PhotoLibraryCapability> => ({ available: true, permission: photosPermission as 'granted' | 'denied', canAskAgain: photosPermission !== 'denied', writeOnly: true });
export const exportSessionPhotos = async (session: ActiveSession, options: { requestPermission?: boolean } = {}): Promise<ActiveSession> => {
  if (options.requestPermission) fixtureControls.photoPermissionRequests++;
  event('synthetic-photos-export', session.id);
  return commit({ ...session, shots: session.shots.map(photo => ({ ...photo, exportStatus: photosPermission === 'granted' ? 'saved' : 'denied' })) });
};
export const syncPending = async () => {
  if (!fixtureControls.online) return;
  for (const job of jobs) if (job.kind === 'upload' && job.state === 'pending') job.state = 'complete';
  if (fixtureControls.readyAcknowledged) {
    for (const session of histories.values()) {
      if (!session.confirmed || session.shots.length !== 5) continue;
      const selected = session.shots.map(photo => jobs.find(job => job.kind === 'upload' && job.photoId === photo.id && job.sessionId === session.id));
      if (selected.some(job => job?.state !== 'complete')) continue;
      for (const job of selected) Object.assign(job!, { guestUrl: fixtureGuestURL, guestExpiresAt: expiry });
      event('synthetic-all-five-ready-ack', session.id);
    }
  }
};
export const retryPendingNow = syncPending;
export const randomUUID = () => crypto.randomUUID();
const vault = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'synthetic-only';
export const getItemAsync = async (key: string) => vault.get(key) ?? null;
export const setItemAsync = async (key: string, value: string) => { vault.set(key, value); };
export const deleteItemAsync = async (key: string) => { vault.delete(key); };
export const authenticateHost = async () => { event('synthetic-host-auth'); };
export const loadConnection = async () => ({ origin: 'https://photobooth.example', token: 'synthetic-browser-fixture-only-never-a-real-credential' });
export const loadHostPreferences = async () => clone(preferences);
export const saveHostPreferences = async (update: Partial<typeof preferences>) => { preferences = { ...preferences, ...update }; event('synthetic-preferences-saved'); return clone(preferences); };
export const provisionBooth = async () => { throw new Error('Real device pairing is disabled in this browser fixture'); };
export const useCameraPermissions = () => {
  const mode = parameters.get('permission');
  const [granted, setGranted] = useState(mode !== 'denied' && mode !== 'blocked');
  return [{ granted, canAskAgain: mode !== 'blocked' }, async () => {
    fixtureControls.cameraPermissionRequests++;
    if (mode !== 'blocked') setGranted(true);
    return { granted: mode !== 'blocked' };
  }] as const;
};
export const CameraView = forwardRef(function SyntheticCamera({ onCameraReady, style }: { onCameraReady?: () => void; style?: object }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => {
    fixtureControls.cameraCalls++;
    event('synthetic-camera-exposure', undefined, fixtureControls.cameraCalls - 1);
    return { uri: '/attract-scene.png' };
  } }), []);
  useEffect(() => { onCameraReady?.(); }, []);
  return <View testID="synthetic-browser-camera" style={style}><Image source={{ uri: '/attract-scene.png' }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Generated synthetic camera scene; no live camera" /></View>;
});
