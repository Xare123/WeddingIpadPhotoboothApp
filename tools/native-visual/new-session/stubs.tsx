/** DEV ONLY. In-memory synthetic native boundaries; no Files/SQLite/Photos/cloud/SMS. */
import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { uploadJob, type QueueJob } from '@wedding-booth/core';
import type { ActiveCapture, ActiveSession, PhotoExportStatus } from '../../../apps/ipad/src/local-types';
import { fixtureControls, fixtureState } from './fixture-controls';

import { originalImageVariants } from './effects-stub';
import { syntheticTemplates } from './template-stub';
const parameters = new URLSearchParams(location.search);
const targetCount = parameters.get('count') === '5' ? 5 : 4;
const clone = <T,>(value: T): T => structuredClone(value);
const sessionID = '0f1e2d3c-4b5a-4678-9abc-000000000001';
const shotURI = (id: string) => `file:///synthetic/${id}.jpg`;
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
if (['camera', 'partial', 'review', 'review4', 'photos-denied', 'photos-uncertain', 'pending', 'ready', 'partial-ready', 'host-uncertain', 'staged', 'staged-empty', 'index-repair'].includes(fixtureState)) {
  const count = ['camera', 'staged-empty'].includes(fixtureState) ? 0 : fixtureState === 'partial' ? 2 : fixtureState === 'staged' ? targetCount - 1 : targetCount;
  const confirmed = ['pending', 'ready', 'partial-ready', 'host-uncertain', 'index-repair'].includes(fixtureState);
  active = { id: sessionID, createdAt: Date.now(), targetCount, confirmed, shots: Array.from({ length: count }, (_, slot) => {
    const id = `10000000-0000-4000-8000-00000000000${slot + 1}`;
    if (fixtureControls.templatesAvailable) originalImageVariants.set(shotURI(id), slot % 4);
    return { id, fileUri: shotURI(id), confirmed, createdAt: Date.now() + slot, sessionId: sessionID, shotIndex: slot, exportStatus: fixtureState === 'photos-uncertain' || (fixtureState === 'host-uncertain' && slot < 2) ? 'uncertain' : photosPermission === 'denied' ? 'denied' : 'saved' };
  }) };
  if (fixtureState === 'host-uncertain') active.retakes = [0, 1].map(slot => {
    const id = `20000000-0000-4000-8000-00000000000${slot + 1}`;
    return { id, fileUri: shotURI(id), confirmed: false, createdAt: Date.now() - 1000, sessionId: sessionID, shotIndex: slot, exportStatus: slot === 0 ? 'pending' : 'uncertain' };
  });
  if (['staged', 'staged-empty'].includes(fixtureState)) {
    const id = '30000000-0000-4000-8000-000000000001';
    active.stagedOriginals = [{ id, fileUri: shotURI(id), confirmed: false, createdAt: Date.now(), sessionId: sessionID, shotIndex: count, exportStatus: 'pending' }];
    active.storageWarning = 'original-commit-pending';
  }
  if (fixtureState === 'index-repair') { active.storageWarning = 'index-repair-pending'; fixtureControls.online = false; }
  histories.set(active.id, clone(active));
  if (confirmed && fixtureState !== 'index-repair') for (const photo of active.shots) jobs.push({
    ...uploadJob(photo.id, shotURI(photo.id), photo.createdAt, active.id),
    ...(['ready', 'host-uncertain'].includes(fixtureState) ? { state: 'complete' as const, guestUrl: fixtureGuestURL, guestExpiresAt: expiry } : {}),
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
  active = { id: crypto.randomUUID(), createdAt: Date.now(), targetCount, shots: [], confirmed: false };
  event('session-created', active.id);
  return commit(active);
};
export const saveShot = async (session: ActiveSession, id: string, _temporaryURI: string, slot: number): Promise<ActiveSession> => {
  if (session.confirmed || slot < 0 || slot >= session.targetCount) throw new Error('Invalid synthetic shot slot');
  event('private-save-started', id, slot);
  if (fixtureControls.failNextSave) { fixtureControls.failNextSave = false; throw new Error('Synthetic private-save failure'); }
  // Preserve an asynchronous boundary so the actual capture runner must await it.
  await Promise.resolve();
  if (fixtureControls.templatesAvailable) originalImageVariants.set(shotURI(id), slot % 4);
  const previous = session.shots.find(photo => photo.shotIndex === slot);
  const photo: ActiveCapture = { id, fileUri: shotURI(id), createdAt: Date.now(), confirmed: false, sessionId: session.id, shotIndex: slot, exportStatus: 'pending' };
  const updated = { ...session, composite: undefined, shots: [...session.shots.filter(photo => photo.shotIndex !== slot), photo].sort((a, b) => a.shotIndex! - b.shotIndex!), retakes: [...(session.retakes ?? []), ...(previous ? [previous] : [])] };
  const result = commit(updated);
  event('private-save-resolved', id, slot);
  return result;
};
export const confirmSession = async (session: ActiveSession): Promise<ActiveSession> => {
  if (session.shots.length !== session.targetCount || new Set(session.shots.map(photo => photo.shotIndex)).size !== session.targetCount) throw new Error('All synthetic shots required');
  if (session.targetCount === 4 && !session.composite) throw new Error('Synthetic composite required');
  const confirmed = { ...session, confirmed: true, shots: session.shots.map(photo => ({ ...photo, confirmed: true })) };
  for (const id of new Set([...confirmed.shots.map(p => p.id), ...(confirmed.composite?.originalPhotoIds ?? []), ...(confirmed.composite ? [confirmed.composite.id] : [])])) if (!jobs.some(job => job.id === id)) await store.save(uploadJob(id, id === confirmed.composite?.id ? confirmed.composite.fileUri : [...confirmed.shots, ...(confirmed.retakes ?? [])].find(p => p.id === id)?.fileUri ?? shotURI(id), Date.now(), session.id));
  event('session-confirmed', session.id);
  return commit(confirmed);
};
export const clearActiveSession = async () => { event('active-session-cleared', active?.id); active = null; };
export const getQueueIndexDiagnostics = () => ({ invalidRows: 0 });
export const updatePhotoExport = async (sessionId: string, photoId: string, status: PhotoExportStatus): Promise<ActiveSession | null> => {
  const session = histories.get(sessionId); if (!session) return null;
  fixtureControls.photoStatusUpdates.push({ sessionId, photoId, status });
  const update = (photo: ActiveCapture) => photo.id === photoId ? { ...photo, exportStatus: status } : photo;
  return commit({ ...session, shots: session.shots.map(update), retakes: session.retakes?.map(update), composite: session.composite?.id === photoId ? { ...session.composite, exportStatus: status } : session.composite });
};
export const retryStagedPhotos = async (sessionId: string): Promise<ActiveSession | null> => {
  const session = histories.get(sessionId); if (!session) return null;
  event('synthetic-staged-save-completed', sessionId);
  return commit({ ...session, shots: [...session.shots, ...(session.stagedOriginals ?? [])].sort((a, b) => a.shotIndex! - b.shotIndex!), stagedOriginals: [], storageWarning: undefined });
};
export const reconcileConfirmedPhotos = async () => {
  if (!fixtureControls.indexWritable) return;
  for (const session of [...histories.values()]) if (session.confirmed) {
    for (const photo of session.shots) if (!jobs.some(job => job.id === photo.id)) await store.save(uploadJob(photo.id, shotURI(photo.id), photo.createdAt, session.id));
    if (session.storageWarning === 'index-repair-pending') { commit({ ...session, storageWarning: undefined }); event('synthetic-index-repair-completed', session.id); }
  }
};
// Actual photo-library.ts/photo-export.ts execute against these native SDK ports.
export const isAvailableAsync = async () => true;
export const getPermissionsAsync = async () => ({ granted: photosPermission === 'granted', status: photosPermission, canAskAgain: photosPermission !== 'denied' });
export const requestPermissionsAsync = async () => { fixtureControls.photoPermissionRequests++; return getPermissionsAsync(); };
export const saveToLibraryAsync = async (uri: string) => {
  const match = /^file:\/\/\/synthetic\/(?:photobooth\/)?([a-zA-Z0-9-]+)\.jpg$/.exec(uri);
  if (!match) throw new Error('Only a synthetic native file URI can reach the mock Photos SDK');
  fixtureControls.photoExportCalls.push({ uri, photoId: match[1] }); event('synthetic-photos-write', match[1]);
};
export const syncPending = async () => {
  await reconcileConfirmedPhotos();
  if (!fixtureControls.online) return;
  for (const job of jobs) if (job.kind === 'upload' && job.state === 'pending') job.state = 'complete';
  if (fixtureControls.readyAcknowledged) {
    for (const session of histories.values()) {
      if (!session.confirmed || session.shots.length !== session.targetCount) continue;
      const required = [...session.shots.map(p => p.id), ...(session.composite?.originalPhotoIds ?? []), ...(session.composite ? [session.composite.id] : [])];
      const selected = [...new Set(required)].map(id => jobs.find(job => job.kind === 'upload' && job.photoId === id && job.sessionId === session.id));
      if (selected.some(job => job?.state !== 'complete')) continue;
      for (const job of selected) Object.assign(job!, { guestUrl: fixtureGuestURL, guestExpiresAt: expiry });
      event('synthetic-all-assets-ready-ack', session.id);
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
export const CameraView = forwardRef(function SyntheticCamera({ onCameraReady, style, testID }: { onCameraReady?: () => void; style?: object; testID?: string }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => {
    fixtureControls.cameraCalls++;
    event('synthetic-camera-exposure', undefined, fixtureControls.cameraCalls - 1);
    return { uri: '/attract-scene.png' };
  } }), []);
  useEffect(() => { onCameraReady?.(); }, []);
  return <View testID={testID} style={style}><View testID="synthetic-browser-camera" style={StyleSheet.absoluteFill}><Image source={{ uri: '/attract-scene.png' }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Generated synthetic camera scene; no live camera" /></View></View>;
});

// Browser has no Expo native-module capability; never claim native preservation.
export const requireOptionalNativeModule = (name: string) => name === 'WeddingPhotoEffects' && (fixtureControls.effectsAvailable || fixtureControls.templatesAvailable) ? { ...(fixtureControls.effectsAvailable ? syntheticPhotoEffects : {}), ...(fixtureControls.templatesAvailable ? syntheticTemplates : {}) } : undefined;

import { syntheticPhotoEffects, copyRenderedImage } from './effects-stub';
import type { RenderedPhotoInput } from '../../../apps/ipad/src/local-persistence';
export async function saveRenderedPhoto(sessionId: string, input: RenderedPhotoInput): Promise<ActiveSession> {
  const session = histories.get(sessionId);
  if (!session || session.confirmed || session.shots[input.slot]?.id !== input.expectedSelectedPhotoId) throw new Error('stale-selection');
  const original = [...session.shots, ...(session.retakes ?? [])].find(photo => photo.id === input.sourcePhotoId);
  if (!original || original.sourcePhotoId || original.look) throw new Error('render-source');
  const uri = shotURI(input.id);
  await copyRenderedImage(input.newRenderedURI, uri);
  const derivative: ActiveCapture = { id: input.id, fileUri: uri, createdAt: Date.now(), confirmed: false, sourcePhotoId: original.id, look: clone(input.look), sessionId, shotIndex: input.slot, exportStatus: 'pending' };
  const previous = session.shots[input.slot];
  event('synthetic-rendered-save', derivative.id, input.slot);
  return commit({ ...session, composite: undefined, shots: session.shots.map((photo, slot) => slot === input.slot ? derivative : photo), retakes: [...(session.retakes ?? []), previous] });
}
export async function selectSavedPhoto(sessionId: string, photoId: string, slot: number, expectedSelectedPhotoId: string): Promise<ActiveSession> {
  const session = histories.get(sessionId);
  if (!session || session.confirmed || session.shots[slot]?.id !== expectedSelectedPhotoId) throw new Error('stale-selection');
  const chosen = [...session.shots, ...(session.retakes ?? [])].find(photo => photo.id === photoId);
  if (!chosen || chosen.shotIndex !== slot) throw new Error('render-source');
  const previous = session.shots[slot];
  return commit({ ...session, composite: undefined, shots: session.shots.map((photo, index) => index === slot ? chosen : photo), retakes: [...(session.retakes ?? []).filter(photo => photo.id !== chosen.id), previous] });
}

import type { CompositeInput } from '../../../apps/ipad/src/local-persistence';
export async function saveComposite(sessionId: string, input: CompositeInput): Promise<ActiveSession> {
  const session = histories.get(sessionId);
  if (!session || session.confirmed || session.targetCount !== 4 || session.shots.length !== 4 || session.shots.some((p, i) => p.id !== input.expectedSelectedPhotoIds[i])) throw new Error('composite-selection');
  const originals = input.recipe.photoIds.map(id => {
    const selected = session.shots.find(p => p.id === id);
    const original = [...session.shots, ...(session.retakes ?? [])].find(p => p.id === (selected?.sourcePhotoId ?? selected?.id));
    if (!selected || !original || original.sourcePhotoId || original.look) throw new Error('composite-source');
    return original.id;
  });
  const uri = `file:///synthetic/photobooth/${input.id}.jpg`;
  await copyRenderedImage(input.newRenderedURI, uri);
  event('synthetic-composite-save', input.id);
  return commit({ ...session, composite: { id: input.id, fileUri: uri, exportStatus: 'pending', recipe: clone(input.recipe), originalPhotoIds: originals } });
}
export async function getSessionPublicationAssets(sessionId: string) {
  const session = histories.get(sessionId);
  if (!session) throw new Error('capture-session');
  if (session.targetCount !== 4) return { photoIds: session.shots.map(p => p.id) };
  if (!session.composite) throw new Error('composite-required');
  return { photoIds: [...session.composite.recipe.photoIds], originalPhotoIds: [...session.composite.originalPhotoIds], composite: { photoId: session.composite.id, layout: session.composite.recipe.layout, theme: session.composite.recipe.theme, version: session.composite.recipe.version } };
}
export const retryStagedComposites = async (sessionId: string) => clone(histories.get(sessionId) ?? null);
