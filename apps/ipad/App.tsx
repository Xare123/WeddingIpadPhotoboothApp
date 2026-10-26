import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, AppState, Easing, Image, ImageBackground, Linking, Modal,
  Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput,
  useWindowDimensions, View,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';
import type { QueueJob } from '@wedding-booth/core';
import { SmsShare } from './src/SmsShare';
import { authenticateHost } from './src/host-auth';
import { loadConnection, loadHostPreferences, provisionBooth, saveHostPreferences } from './src/config';
import { formatGuestExpiry, sessionGuestPage } from './src/sharing';
import {
  clearActiveSession, confirmSession, createSession, getActiveCapture, getActiveSession, getLocalSession, getQueueIndexDiagnostics,
  listLocalSessions, recoverPreservedPhotos, retryStagedPhotos, saveShot, store, updatePhotoExport, type ActiveCapture, type ActiveSession,
} from './src/storage';
import { exportSessionPhotos, getPhotoLibraryCapability } from './src/photo-library';
import { retryPendingNow, syncPending } from './src/sync';
import { nativeFixtureEnabled, nativeFixtureImage, nativeFixturePhotoId, nativeFixtureStorageStatus, takeNativeFixturePhoto } from './src/native-fixture';
import { captureErrorMessage, captureSaveStatus, WEDDING_DATE, WEDDING_IDENTITY, WEDDING_NAMES } from './src/booth-presentation';
import { createHostOriginalActions, hostOriginalStatus, INDEX_REPAIR_DIAGNOSTIC, indexRepairSessions, queueIndexStatus, type HostOriginalRequest } from './src/host-originals';
import { createReviewSelection } from './src/review-selection';
import { createSessionCaptureRunner, nextPhotoSlot, screenForSession, sessionIsComplete, type PendingPhoto } from './src/session-capture';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const TIMERS = [2, 3, 5, 8, 10] as const;
type Seconds = typeof TIMERS[number];
type Screen = 'attract' | 'camera' | 'review' | 'share';
type HostPage = 'controls' | 'library' | 'setup';

function photoSlot(photo: ActiveCapture, index: number) { return photo.shotIndex ?? index; }
function needsPhotosExport(session: ActiveSession): boolean {
  return session.shots.some(photo => photo.exportStatus !== 'saved' && String(photo.exportStatus) !== 'uncertain');
}
function photosExportTitle(session: ActiveSession): string {
  if (!session.shots.length) return 'No photos to export';
  if (needsPhotosExport(session)) return 'Export copies to Photos';
  if (session.shots.some(photo => String(photo.exportStatus) === 'uncertain')) return 'Check Photos for unconfirmed copies';
  return 'All copies are saved in Photos';
}
function photosStatus(session: ActiveSession | null): string {
  if (!session?.shots.length) return 'Photos export is separate from your saved originals.';
  const saved = session.shots.filter(photo => photo.exportStatus === 'saved').length;
  if (session.shots.some(photo => String(photo.exportStatus) === 'uncertain')) return 'Photos result unconfirmed · check Photos before retrying';
  if (saved === session.shots.length) return `${saved} of ${session.shots.length} also saved in Photos`;
  if (session.shots.some(photo => photo.exportStatus === 'denied')) return 'Photos access needed · originals are safe here';
  if (session.shots.some(photo => photo.exportStatus === 'failed')) return 'Photos export needs a retry · originals are safe here';
  if (session.shots.some(photo => photo.exportStatus === 'unavailable')) return 'Photos unavailable · originals are safe here';
  return saved ? `${saved} of ${session.shots.length} saved in Photos` : 'Not yet exported to Photos';
}

function Button({ title, onPress, disabled, secondary, light, testID }: {
  title: string; onPress(): void; disabled?: boolean; secondary?: boolean; light?: boolean; testID?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} testID={testID}
    onPress={onPress} disabled={disabled} style={({ pressed }) => [
      styles.button, secondary && styles.secondaryButton, light && styles.lightButton,
      disabled && styles.disabled, pressed && !disabled && styles.pressed,
    ]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText, light && styles.lightButtonText]}>{title}</Text></Pressable>;
}

function PhotoThumbnail({ photo, slot, active, onSelect, dark, reduceMotion, compact }: {
  photo?: ActiveCapture; slot: number; active: boolean; onSelect?(slot: number): void; dark: boolean; reduceMotion: boolean; compact?: boolean;
}) {
  const reveal = useRef(new Animated.Value(1)).current;
  const previous = useRef(photo?.id);
  useEffect(() => {
    reveal.stopAnimation();
    const changed = !!photo && previous.current !== photo.id;
    previous.current = photo?.id;
    if (reduceMotion || !changed) { reveal.setValue(1); return; }
    reveal.setValue(0);
    const animation = Animated.timing(reveal, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [photo?.id, reduceMotion, reveal]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Photo ${slot + 1}${photo ? ', saved on this iPad' : ', not taken'}`}
    accessibilityState={{ selected: active, disabled: !photo || !onSelect }} testID={`photo-thumbnail-${slot + 1}`}
    disabled={!photo || !onSelect} onPress={() => onSelect?.(slot)} style={[styles.thumbnail, compact && styles.thumbnailCompact, !dark && styles.thumbnailLight, active && styles.thumbnailSelected]}>
    {photo ? <Animated.Image source={{ uri: photo.fileUri }} style={[StyleSheet.absoluteFill, { opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }] }]} resizeMode="cover" />
      : <Text style={[styles.thumbnailNumber, !dark && styles.thumbnailNumberLight]}>{slot + 1}</Text>}
    {photo && <View style={styles.thumbnailTick}><Text testID={`thumbnail-number-${slot + 1}`} style={styles.thumbnailTickText}>{slot + 1}</Text></View>}
  </Pressable>;
}

function Thumbnails({ session, active, onSelect, dark = true, reduceMotion = true, compact = false }: {
  session: ActiveSession; active: number; onSelect?(slot: number): void; dark?: boolean; reduceMotion?: boolean; compact?: boolean;
}) {
  return <View style={[styles.thumbnails, compact && styles.thumbnailsCompact]}>{Array.from({ length: session.targetCount }, (_, slot) => <PhotoThumbnail key={slot}
    photo={session.shots.find((shot, index) => photoSlot(shot, index) === slot)} slot={slot} active={active === slot}
    onSelect={onSelect} dark={dark} reduceMotion={reduceMotion} compact={compact} />)}</View>;
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const review = useRef<ScrollViewInstance>(null);
  const reviewSelection = useRef(createReviewSelection());
  const reviewWidthRef = useRef(width);
  const mounted = useRef(true);
  const sessionRef = useRef<ActiveSession | null>(null);
  const actionLock = useRef(false);
  const exportLock = useRef(false);
  const pairingLock = useRef(false);
  const hostOriginalLock = useRef(false);
  const hostVisibleRef = useRef(false);
  const librarySessionRef = useRef<ActiveSession | null>(null);
  const screenFade = useRef(new Animated.Value(1)).current;
  const countdownReveal = useRef(new Animated.Value(1)).current;
  const exposureFlash = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(true);
  const [screen, setScreen] = useState<Screen>('attract');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [focusedSlot, setFocusedSlot] = useState(0);
  const [retakeSlot, setRetakeSlot] = useState<number>();
  const [reviewWidth, setReviewWidth] = useState(width);
  const [failedPhoto, setFailedPhoto] = useState<PendingPhoto>();
  const [message, setMessage] = useState('');
  const [hostDiagnostic, setHostDiagnostic] = useState('');
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [invalidQueueRows, setInvalidQueueRows] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [seconds, setSeconds] = useState<Seconds>(3);
  const [exportEnabled, setExportEnabled] = useState(true);
  const preferencesRef = useRef({ countdownSeconds: 3 as Seconds, photosExportEnabled: true });
  const [hostVisible, setHostVisible] = useState(false);
  const [hostPage, setHostPage] = useState<HostPage>('controls');
  const [hostBusy, setHostBusy] = useState(false);
  const [hostMessage, setHostMessage] = useState('');
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [scanningSetup, setScanningSetup] = useState(false);
  const [savedSessions, setSavedSessions] = useState<ActiveSession[]>([]);
  const [librarySession, setLibrarySession] = useState<ActiveSession | null>(null);
  const [libraryMode, setLibraryMode] = useState<'selected' | 'retained'>('selected');
  const [hostDecision, setHostDecision] = useState<Exclude<HostOriginalRequest, { kind: 'finish-save' }> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [libraryPermission, setLibraryPermission] = useState('undetermined');
  const [fixtureStatus, setFixtureStatus] = useState('');

  function focusReview(slot: number) {
    reviewSelection.current.select(slot);
    setFocusedSlot(slot);
  }
  function adoptSession(value: ActiveSession | null) {
    sessionRef.current = value;
    if (value?.storageWarning === 'index-repair-pending') setHostDiagnostic(INDEX_REPAIR_DIAGNOSTIC);
    else setHostDiagnostic(previous => previous === INDEX_REPAIR_DIAGNOSTIC ? '' : previous);
    if (mounted.current) {
      setSession(value);
      setFailedPhoto(current => current && value?.shots.some(photo => photo.id === current.id) ? undefined : current);
    }
  }
  function diagnose(error: unknown) {
    setHostDiagnostic(error instanceof Error ? error.message : 'An operation could not finish.');
  }
  async function refreshQueue() {
    try {
      const values = await store.list();
      if (mounted.current) { setJobs(values); setNow(Date.now()); setInvalidQueueRows(getQueueIndexDiagnostics().invalidRows); }
      if (nativeFixtureEnabled && mounted.current) setFixtureStatus(nativeFixtureStorageStatus(await getActiveCapture(), values));
    } catch (error) { diagnose(error); /* Queue indexing must never disable durable local capture. */ }
  }
  function adoptLibrarySession(value: ActiveSession | null) {
    librarySessionRef.current = value;
    if (mounted.current) setLibrarySession(value);
  }
  async function refreshLibrary() {
    const values = await listLocalSessions();
    if (mounted.current) {
      setSavedSessions([...values].sort((a, b) => b.createdAt - a.createdAt));
      const currentId = librarySessionRef.current?.id;
      const current = values.find(value => value.id === currentId);
      if (current && librarySessionRef.current?.id === current.id) adoptLibrarySession(current);
    }
  }
  async function refreshDisplayedSessions() {
    const ids = new Set([sessionRef.current?.id, librarySessionRef.current?.id].filter((id): id is string => !!id));
    for (const id of ids) {
      const updated = await getLocalSession(id);
      if (!updated || !mounted.current) continue;
      // A retry completing after Next guests must never reopen the old guest.
      if (sessionRef.current?.id === id) adoptSession(updated);
      if (librarySessionRef.current?.id === id) adoptLibrarySession(updated);
    }
  }
  async function refreshCapability() {
    try { setLibraryPermission((await getPhotoLibraryCapability()).permission); }
    catch { setLibraryPermission('unavailable'); }
  }
  async function retrySharing(immediate = false) {
    try { await (immediate ? retryPendingNow() : syncPending()); }
    catch (error) { diagnose(error); }
    await refreshQueue();
    try { await refreshDisplayedSessions(); if (hostVisibleRef.current) await refreshLibrary(); }
    catch (error) { diagnose(error); }
  }
  async function exportPhotos(value: ActiveSession, requestPermission: boolean) {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      const updated = await exportSessionPhotos(value, { requestPermission });
      if (sessionRef.current?.id === updated.id) adoptSession(updated);
      if (librarySessionRef.current?.id === updated.id) adoptLibrarySession(updated);
      await refreshLibrary();
      await refreshCapability();
    } catch (error) {
      diagnose(error);
      setHostMessage('Photos export could not finish. Your originals remain on this iPad.');
    } finally { exportLock.current = false; setExporting(false); }
  }

  const hostOriginalActions = useRef<ReturnType<typeof createHostOriginalActions<ActiveSession>> | null>(null);
  if (!hostOriginalActions.current) hostOriginalActions.current = createHostOriginalActions<ActiveSession>({
    authenticate: authenticateHost, load: getLocalSession,
    acknowledge: (sessionId, photoId) => updatePhotoExport(sessionId, photoId, 'saved'),
    export: (value, options) => exportSessionPhotos(value, options),
    finishSave: retryStagedPhotos,
  });
  async function runHostOriginalAction(request: HostOriginalRequest) {
    if (hostOriginalLock.current || exportLock.current || hostBusy) return;
    hostOriginalLock.current = true; exportLock.current = true;
    setHostBusy(true); setExporting(request.kind === 'export'); setHostMessage('');
    try {
      const result = await hostOriginalActions.current!.run(request);
      if (result.kind === 'confirm-duplicate') {
        if (result.request.kind !== 'finish-save') setHostDecision(result.request);
        return;
      }
      if (result.kind === 'busy') return;
      const updated = result.session;
      if (sessionRef.current?.id === updated.id) adoptSession(updated);
      if (librarySessionRef.current?.id === updated.id) adoptLibrarySession(updated);
      await refreshLibrary(); await refreshCapability();
      if (request.kind === 'finish-save') {
        const remaining = updated.stagedOriginals?.length ?? 0;
        setHostMessage(remaining ? `Local save retried. ${remaining} captured originals still need completion.` : 'Local save completed. The original is now available on this iPad.');
      } else if (result.kind === 'already-saved') setHostMessage('This original is already marked as saved in Photos.');
      else if (request.kind === 'acknowledge') setHostMessage('Marked as saved in Photos based on your check.');
      else {
        const photo = (request.retained ? updated.retakes ?? [] : updated.shots).find(value => value.id === request.photoId);
        setHostMessage(photo ? hostOriginalStatus(photo) : 'Check this original’s Photos status before another export.');
      }
    } catch (error) {
      diagnose(error); setHostMessage(error instanceof Error ? error.message : 'The host action did not finish. Local originals remain on this iPad.');
    } finally { hostOriginalLock.current = false; exportLock.current = false; setExporting(false); setHostBusy(false); }
  }
  function requestHostPhoto(kind: 'acknowledge' | 'export', photo: ActiveCapture, retained: boolean) {
    const value = librarySessionRef.current;
    if (!value || hostBusy || exporting) return;
    const request = { kind, sessionId: value.id, photoId: photo.id, retained };
    if (kind === 'acknowledge' || photo.exportStatus === 'uncertain') setHostDecision(request);
    else void runHostOriginalAction(request);
  }
  function hostPhotoCard(photo: ActiveCapture, retained: boolean) {
    return <View key={photo.id} testID={`host-original-${photo.id}`} style={styles.hostOriginalCard}>
      <Text style={styles.hostSectionTitle}>{retained ? 'Retained take' : 'Selected photo'}{photo.shotIndex !== undefined ? ` · Photo ${photo.shotIndex + 1}` : ''}</Text>
      {retained && <Text style={styles.hostSmall}>Not in the guest gallery. This earlier original remains on this iPad.</Text>}
      <Image source={{ uri: photo.fileUri }} style={styles.hostOriginalPreview} resizeMode="contain" accessibilityLabel={retained ? 'Retained original, not in the guest gallery' : 'Original with an uncertain Photos result'} />
      <Text style={styles.hostBody}>{hostOriginalStatus(photo)}</Text>
      {photo.exportStatus === 'uncertain' ? <>
        <Button title="Already in Photos" testID={`host-photo-ack-${photo.id}`} light secondary disabled={hostBusy || exporting} onPress={() => requestHostPhoto('acknowledge', photo, retained)} />
        <Button title="Export this copy again" testID={`host-photo-export-${photo.id}`} disabled={hostBusy || exporting} onPress={() => requestHostPhoto('export', photo, retained)} />
      </> : <Button title={photo.exportStatus === 'saved' ? 'Saved in Photos' : 'Export this original to Photos'} testID={`host-photo-export-${photo.id}`} disabled={hostBusy || exporting || photo.exportStatus === 'saved'} onPress={() => requestHostPhoto('export', photo, retained)} />}
    </View>;
  }

  async function persistPhoto(value: ActiveSession, photo: PendingPhoto): Promise<ActiveSession> {
    try { return await saveShot(value, photo.id, photo.uri, photo.slot); }
    catch (error) {
      // A verified filesystem journal can survive an index/database error. Ask
      // storage to recover before presenting an exposed photo as unsaved.
      const recovered = await getActiveSession().catch(() => null);
      if (recovered?.id === value.id && recovered.shots.some((shot, index) => shot.id === photo.id && photoSlot(shot, index) === photo.slot)) return recovered;
      throw error;
    }
  }

  const runner = useRef<ReturnType<typeof createSessionCaptureRunner<ActiveSession>> | null>(null);
  if (!runner.current) runner.current = createSessionCaptureRunner<ActiveSession>({
    wait: pause,
    isActive: () => AppState.currentState === 'active',
    async capture() {
      const photo = nativeFixtureEnabled ? await takeNativeFixturePhoto() : await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo?.uri) throw new Error('The camera did not return a photo.');
      if (!reduceMotionRef.current) {
        exposureFlash.stopAnimation(); exposureFlash.setValue(0.2);
        Animated.timing(exposureFlash, { toValue: 0, duration: 130, useNativeDriver: true }).start();
      }
      const id = randomUUID();
      return { id: nativeFixtureEnabled ? nativeFixturePhotoId(id) : id, uri: photo.uri };
    },
    save: persistPhoto,
    onEvent(event) {
      if (!mounted.current) return;
      if (event.kind === 'countdown') {
        setBusy(true); setSaving(false); setActiveSlot(event.slot); setCountdown(event.remaining);
      } else if (event.kind === 'saving') {
        setCountdown(undefined); setSaving(true);
      } else if (event.kind === 'saved') {
        adoptSession(event.session); setFailedPhoto(undefined); setSaving(false);
        void refreshQueue();
      } else if (event.kind === 'done') {
        setBusy(false); setSaving(false); setCountdown(undefined); setRetakeSlot(undefined);
        focusReview(event.retake ? event.slot : 0); setScreen('review'); setCameraReady(false);
        if (preferencesRef.current.photosExportEnabled && sessionIsComplete(event.session)) void exportPhotos(event.session, true);
      } else if (event.kind === 'paused') {
        setBusy(false); setSaving(false); setCountdown(undefined);
      } else if (event.kind === 'error') {
        setBusy(false); setSaving(false); setCountdown(undefined); setFailedPhoto(event.photo);
        diagnose(event.error);
        setMessage(captureErrorMessage(event.session.shots.length, !!event.photo));
      }
    },
  });

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        try { await recoverPreservedPhotos(); } catch (error) { diagnose(error); }
        const active = await getActiveSession();
        if (!mounted.current) return;
        adoptSession(active); setScreen(screenForSession(active)); setActiveSlot(active ? nextPhotoSlot(active) ?? 0 : 0);
        setInitialized(true);
        await refreshQueue();
        try {
          const prefs = await loadHostPreferences();
          preferencesRef.current = prefs; setSeconds(prefs.countdownSeconds); setExportEnabled(prefs.photosExportEnabled);
        } catch (error) { diagnose(error); }
        try { setPaired(!!await loadConnection()); } catch (error) { diagnose(error); }
        void refreshCapability();
        void retrySharing();
      } catch (error) { diagnose(error); setMessage('Local storage needs attention. Please ask the host before starting.'); }
    })();
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const lifecycle = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state !== 'active') { setScanningSetup(false); setPairingCode(''); runner.current?.interrupt(); screenFade.stopAnimation(); screenFade.setValue(1); countdownReveal.stopAnimation(); exposureFlash.stopAnimation(); exposureFlash.setValue(0); }
      else { void retrySharing(); void refreshCapability(); }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') { setNow(Date.now()); void retrySharing(); }
    }, 15_000);
    return () => { mounted.current = false; alive = false; runner.current?.interrupt(); screenFade.stopAnimation(); countdownReveal.stopAnimation(); exposureFlash.stopAnimation(); motion.remove(); lifecycle.remove(); clearInterval(timer); };
  }, []);

  useEffect(() => { reduceMotionRef.current = reduceMotion; if (reduceMotion) { exposureFlash.stopAnimation(); exposureFlash.setValue(0); } }, [reduceMotion, exposureFlash]);

  const guestPage = session?.confirmed ? sessionGuestPage(session, jobs, now) : null;
  const expiry = formatGuestExpiry(guestPage?.expiresAt);
  const pendingCount = jobs.filter(job => job.kind === 'upload' && job.state === 'pending').length;
  useEffect(() => {
    if (!guestPage?.expiresAt) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(guestPage.expiresAt - Date.now() + 1, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [guestPage?.expiresAt]);
  useEffect(() => {
    screenFade.stopAnimation();
    if (reduceMotion) { screenFade.setValue(1); return; }
    screenFade.setValue(0);
    const transition = Animated.timing(screenFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true });
    transition.start(); return () => transition.stop();
  }, [screen, reduceMotion, screenFade]);
  useEffect(() => {
    countdownReveal.stopAnimation();
    if (reduceMotion || countdown === undefined) { countdownReveal.setValue(1); return; }
    countdownReveal.setValue(0);
    const animation = Animated.timing(countdownReveal, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [countdown, reduceMotion, countdownReveal]);
  useEffect(() => { if (Platform.OS === 'ios' && countdown !== undefined) AccessibilityInfo.announceForAccessibility(`Photo ${activeSlot + 1}, in ${countdown}`); }, [countdown, activeSlot]);
  useEffect(() => { if (Platform.OS === 'ios' && message) AccessibilityInfo.announceForAccessibility(message); }, [message]);
  useEffect(() => { if (Platform.OS === 'ios' && guestPage) AccessibilityInfo.announceForAccessibility(`All ${session?.shots.length ?? 5} photos are ready. Scan the QR code to open your photo page.`); }, [!!guestPage]);
  useEffect(() => { if (Platform.OS === 'ios' && hostVisible && hostMessage) AccessibilityInfo.announceForAccessibility(hostMessage); }, [hostVisible, hostMessage]);

  async function startSession() {
    if (actionLock.current || !initialized) return;
    actionLock.current = true; setBusy(true); setMessage('');
    try {
      const value = sessionRef.current ?? await createSession();
      adoptSession(value); setActiveSlot(nextPhotoSlot(value) ?? 0); setCameraReady(false); setScreen(screenForSession(value) === 'attract' ? 'camera' : screenForSession(value));
    } catch (error) { diagnose(error); setMessage('We could not start saving a session. Please ask the host to check this iPad.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function startPhotos() {
    if (!sessionRef.current || !cameraReady || runner.current?.isBusy() || actionLock.current || failedPhoto) return;
    setMessage('');
    await runner.current?.run(sessionRef.current, { seconds: preferencesRef.current.countdownSeconds, ...(retakeSlot !== undefined ? { retakeSlot } : {}) });
    if (mounted.current && !runner.current?.isBusy()) { setBusy(false); setSaving(false); setCountdown(undefined); }
  }
  function cancelPhotos() { runner.current?.cancel(); }
  async function retrySave() {
    if (!failedPhoto || !sessionRef.current || actionLock.current || runner.current?.isBusy()) return;
    actionLock.current = true; setBusy(true); setSaving(true);
    try {
      const updated = await persistPhoto(sessionRef.current, failedPhoto);
      adoptSession(updated); setFailedPhoto(undefined); setMessage(''); setActiveSlot(nextPhotoSlot(updated) ?? failedPhoto.slot);
      if (retakeSlot !== undefined || sessionIsComplete(updated)) { focusReview(failedPhoto.slot); setRetakeSlot(undefined); setCameraReady(false); setScreen('review'); }
      await refreshQueue();
    } catch (error) { diagnose(error); setMessage('Saving still needs attention. Keep this session open and ask the host.'); }
    finally { actionLock.current = false; setBusy(false); setSaving(false); }
  }
  function selectReview(slot: number) {
    const value = sessionRef.current;
    if (!value || busy || saving) return;
    const index = value.shots.findIndex((photo, i) => photoSlot(photo, i) === slot);
    if (index < 0) return;
    // Reserve before React renders or any scrollTo callback can run.
    focusReview(slot); setScreen('review'); setCameraReady(false);
    requestAnimationFrame(() => { if (reviewSelection.current.isTarget(slot)) review.current?.scrollTo({ x: index * reviewWidthRef.current, animated: !reduceMotion }); });
  }
  function reviewSlots() { return sessionRef.current?.shots.map(photoSlot) ?? []; }
  function updateReviewSelection(offset: number) {
    setFocusedSlot(reviewSelection.current.scroll(offset, reviewWidthRef.current, reviewSlots()));
  }
  function beginReviewDrag(offset?: number) {
    setFocusedSlot(reviewSelection.current.beginDrag(reviewWidthRef.current, reviewSlots(), offset));
  }
  function retakePhoto() {
    const value = sessionRef.current;
    if (!value || value.confirmed || busy || exporting) return;
    // Read synchronous intent, never a potentially stale React render closure.
    const slot = reviewSelection.current.current();
    if (!value.shots.some((photo, index) => photoSlot(photo, index) === slot)) return;
    setRetakeSlot(slot); setActiveSlot(slot); setCameraReady(false); setMessage(''); setScreen('camera');
  }
  function leaveRetake() {
    if (saving || failedPhoto) return;
    cancelPhotos(); setRetakeSlot(undefined); setCameraReady(false); setScreen('review');
  }
  async function keepSession() {
    const value = sessionRef.current;
    if (!value || !sessionIsComplete(value) || actionLock.current || runner.current?.isBusy()) return;
    actionLock.current = true; setBusy(true); setMessage('');
    try {
      const updated = await confirmSession(value);
      adoptSession(updated); setScreen('share'); setCameraReady(false); await refreshQueue(); void retrySharing(true);
    } catch (error) { diagnose(error); setMessage('Your originals are safe here. Sharing setup needs a retry; keep this session open.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function nextGuests() {
    if (actionLock.current || runner.current?.isBusy()) return;
    actionLock.current = true; setBusy(true);
    try {
      await clearActiveSession(); adoptSession(null); setJobs([]); setScreen('attract'); focusReview(0); setActiveSlot(0); setRetakeSlot(undefined); setFailedPhoto(undefined); setMessage(''); setCameraReady(false);
      void refreshQueue();
    } catch (error) { diagnose(error); setMessage('Please ask the host to reset this screen. Your originals remain safe.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function openHost() {
    if (hostBusy || busy || saving) return;
    setHostBusy(true);
    try {
      await authenticateHost(); setCameraReady(false); setScanningSetup(false); setHostPage('controls'); setHostMessage(''); hostVisibleRef.current = true; setHostVisible(true); setHostDecision(null); setPairingCode('');
      await refreshLibrary(); await refreshCapability();
      try { setPaired(!!await loadConnection()); } catch (error) { diagnose(error); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Host authentication is unavailable.'); }
    finally { setHostBusy(false); }
  }
  async function savePreferences() {
    setHostBusy(true); setHostMessage('');
    try {
      await authenticateHost();
      const prefs = await saveHostPreferences({ countdownSeconds: seconds, photosExportEnabled: exportEnabled });
      preferencesRef.current = prefs; setHostMessage('Booth settings saved.');
    } catch (error) { setHostMessage(error instanceof Error ? error.message : 'Settings could not save.'); }
    finally { setHostBusy(false); }
  }
  async function pairBooth(scannedCode?: string) {
    const code = (scannedCode ?? pairingCode).trim();
    if (!code || hostBusy || pairingLock.current) return;
    pairingLock.current = true;
    setScanningSetup(false); setPairingCode(''); setHostBusy(true); setHostMessage('');
    try { await provisionBooth(code); setPairingCode(''); setPaired(true); setHostPage('controls'); setHostMessage('Sharing connected securely.'); void retrySharing(true); }
    catch (error) { diagnose(error); setHostMessage('Pairing did not finish. Ask the owner for a fresh private code. Local capture still works.'); }
    finally { pairingLock.current = false; setPairingCode(''); setScanningSetup(false); setHostBusy(false); }
  }

  function closeHost() { hostVisibleRef.current = false; setHostVisible(false); setHostDecision(null); setPairingCode(''); setScanningSetup(false); }
  async function scanPrivateSetup() {
    setHostMessage('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setHostMessage('Camera access is needed to scan. You can paste a private setup code instead.'); return; }
    }
    setPairingCode(''); setScanningSetup(true);
  }

  const selectedPhoto = session?.shots.find((photo, index) => photoSlot(photo, index) === focusedSlot);
  const total = session?.targetCount ?? 5;
  const pendingRepairs = indexRepairSessions([session, librarySession, ...savedSessions]);
  const queueRepairStatus = queueIndexStatus(pendingRepairs.length, invalidQueueRows);
  const decisionSession = hostDecision ? [librarySession, ...savedSessions].find(value => value?.id === hostDecision.sessionId) : null;
  const decisionPhoto = hostDecision && decisionSession ? (hostDecision.retained ? decisionSession.retakes ?? [] : decisionSession.shots).find(photo => photo.id === hostDecision.photoId) : null;
  const lightScreen = screen === 'attract' || screen === 'share';
  return <SafeAreaView style={[styles.page, lightScreen && styles.lightPage]}>
    <StatusBar barStyle={lightScreen ? 'dark-content' : 'light-content'} />
    <Animated.View style={[styles.app, { opacity: screenFade }]}>
      {screen === 'attract' ? <ImageBackground source={require('./assets/attract-scene.png')} resizeMode="cover" style={styles.attract} imageStyle={styles.attractImage}>
        <View style={styles.attractShade} />
        <View style={styles.attractTop}><Text testID="wedding-identity" style={[styles.brand, styles.weddingIdentity]}>{WEDDING_IDENTITY}</Text><Pressable accessibilityRole="button" accessibilityLabel="Open host controls" onPress={() => void openHost()} disabled={hostBusy}><Text style={styles.attractHost}>Host</Text></Pressable></View>
        <View style={[styles.attractContent, landscape && styles.attractContentWide]}>
          <Text style={styles.attractEyebrow}>FIVE FRAMES. ALL YOURS.</Text>
          <Text style={[styles.attractTitle, landscape && styles.attractTitleWide]}>Come{`\n`}closer.</Text>
          <Text style={styles.attractSubtitle}>A little flash. A lot of feeling.</Text>
          <Button title={busy ? 'Opening the booth…' : 'Let’s make memories'} testID="start-session" light disabled={!initialized || busy} onPress={() => void startSession()} />
          <Text style={styles.attractFootnote}>Five photos, one moment together.</Text>
        </View>
      </ImageBackground> : <>
        <View style={[styles.topbar, lightScreen && styles.topbarLight]}>
          <>{screen === 'share' ? <Text testID="wedding-share-identity" style={[styles.brand, styles.weddingIdentity, styles.brandDark]}>{WEDDING_IDENTITY}</Text> : <View accessible accessibilityLabel={WEDDING_IDENTITY} testID="wedding-identity-compact" style={styles.compactIdentity}><Text style={styles.brand}>{WEDDING_NAMES}</Text><Text style={styles.compactDate}>{WEDDING_DATE}</Text></View>}</>
          <Pressable accessibilityRole="button" accessibilityLabel="Open host controls" disabled={busy || hostBusy} onPress={() => void openHost()}><Text style={[styles.hostLink, lightScreen && styles.hostLinkDark]}>Host</Text></Pressable>
        </View>
        {screen === 'camera' && session && <View style={styles.capturePage}>
          <View style={styles.cameraStage}>
            {permission?.granted ? hostVisible ? <View style={StyleSheet.absoluteFill} /> : nativeFixtureEnabled
              ? <Image source={nativeFixtureImage()} resizeMode="cover" style={StyleSheet.absoluteFill} onLoad={() => setCameraReady(true)} accessibilityLabel="Synthetic native camera scene" />
              : <CameraView ref={camera} facing="front" mirror={false} style={StyleSheet.absoluteFill} onCameraReady={() => setCameraReady(true)} onMountError={() => { setCameraReady(false); setMessage('The front camera is unavailable. Please ask the host.'); }} />
              : <View style={styles.permission}><Text style={styles.permissionTitle}>You bring the smiles.</Text><Text style={styles.permissionBody}>We just need the camera.</Text><Button title={permission?.canAskAgain === false ? 'Open iPad Settings' : 'Enable camera'} testID="allow-camera" light onPress={() => void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())} /></View>}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: exposureFlash }]} />
            <View style={styles.cameraTop}><Text style={styles.progressText}>{retakeSlot !== undefined ? 'RETAKE' : 'PHOTO'} {activeSlot + 1} <Text style={styles.progressMuted}>OF {total}</Text></Text><Text style={styles.cameraSaved}>{session.shots.length} saved here</Text></View>
            {countdown !== undefined && <View pointerEvents="none" style={styles.countdownShade}><Animated.Text accessibilityLiveRegion="assertive" style={[styles.countdown, { opacity: countdownReveal.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }), transform: [{ scale: countdownReveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>{countdown}</Animated.Text><Text style={styles.countdownNote}>Make it a good one.</Text></View>}
            {saving && <View style={styles.savingBadge}><Text style={styles.savingText}>Saving original…</Text></View>}
          </View>
          <View style={[styles.captureBottom, landscape && styles.captureBottomWide]}>
            <Thumbnails reduceMotion={reduceMotion || !foreground} session={session} active={activeSlot} onSelect={!busy && !failedPhoto ? selectReview : undefined} />
            <View style={styles.captureActions}>
              {busy ? <Button title={saving ? 'Saving original…' : 'Pause countdown'} testID="cancel-countdown" secondary disabled={saving} onPress={cancelPhotos} />
                : failedPhoto ? <Button title={`Retry saving photo ${failedPhoto.slot + 1}`} testID="retry-save" onPress={() => void retrySave()} />
                : <Button title={retakeSlot !== undefined ? `Retake photo ${retakeSlot + 1}` : session.shots.length ? `Continue · photo ${(nextPhotoSlot(session) ?? 0) + 1}` : `Start ${total} photos`} testID="take-photo" disabled={!cameraReady || !initialized} onPress={() => void startPhotos()} />}
              {retakeSlot !== undefined && !saving && !failedPhoto && <Pressable accessibilityRole="button" style={styles.textAction} onPress={leaveRetake}><Text style={styles.mutedButtonText}>Back to review</Text></Pressable>}
              <Text testID="capture-save-status" style={styles.cameraHint}>{captureSaveStatus({ savedCount: session.shots.length, targetCount: total, seconds: preferencesRef.current.countdownSeconds, saving, failedSlot: failedPhoto?.slot })}</Text>
            </View>
          </View>
        </View>}
        {screen === 'review' && session && <View style={[styles.reviewPage, landscape && styles.reviewPageWide]}>
          {!landscape && <View style={styles.reviewHeading}><View><Text testID="review-navigation-hint" style={styles.reviewEyebrow}>Swipe photos · tap a thumbnail</Text><Text style={styles.reviewTitle}>{sessionIsComplete(session) ? (total === 5 ? 'Five worth keeping.' : 'Worth keeping.') : 'Looking good so far.'}</Text></View><Text style={styles.reviewCount}>{focusedSlot + 1} / {total}</Text></View>}
          <View style={styles.reviewStage} onLayout={event => { const w = event.nativeEvent.layout.width; reviewWidthRef.current = w; setReviewWidth(w); const slot = reviewSelection.current.current(); reviewSelection.current.select(slot); requestAnimationFrame(() => { if (!reviewSelection.current.isTarget(slot)) return; const index = sessionRef.current?.shots.findIndex((photo, i) => photoSlot(photo, i) === slot) ?? 0; review.current?.scrollTo({ x: Math.max(0, index) * w, animated: false }); }); }}>
            <ScrollView ref={review} horizontal pagingEnabled showsHorizontalScrollIndicator={false} testID="review-gallery" scrollEventThrottle={32} onScrollBeginDrag={event => beginReviewDrag(event.nativeEvent.contentOffset.x)} onTouchMove={() => beginReviewDrag()} onScroll={event => updateReviewSelection(event.nativeEvent.contentOffset.x)} onMomentumScrollEnd={event => updateReviewSelection(event.nativeEvent.contentOffset.x)}>
              {session.shots.map(photo => <View key={photo.id} style={[styles.reviewSlide, { width: reviewWidth }]}><Image testID={photo.id === selectedPhoto?.id ? 'photo-preview' : undefined} source={{ uri: photo.fileUri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={`Saved photo ${(photo.shotIndex ?? 0) + 1}`} /></View>)}
            </ScrollView>
          </View>
          <View style={[styles.reviewBottom, landscape && styles.reviewSideRail]}>
            {landscape && <View style={styles.reviewRailHeading}><Text testID="review-navigation-hint" style={styles.reviewEyebrow}>Swipe photos · tap a thumbnail</Text><Text style={styles.reviewTitle}>{sessionIsComplete(session) ? (total === 5 ? 'Five worth keeping.' : 'Worth keeping.') : 'Looking good so far.'}</Text><Text style={styles.reviewCount}>Photo {focusedSlot + 1} of {total}</Text></View>}
            <Thumbnails compact={landscape} reduceMotion={reduceMotion || !foreground} session={session} active={focusedSlot} onSelect={selectReview} />
            <View style={[styles.reviewActions, landscape && styles.reviewActionsWide]}><Button title={`Retake photo ${focusedSlot + 1}`} testID="retake-photo" secondary disabled={busy || exporting} onPress={retakePhoto} />
              <Button title={busy ? 'Preparing your session…' : sessionIsComplete(session) ? `Keep all ${total} photos` : 'Finish the session'} testID="use-photo" disabled={busy} onPress={sessionIsComplete(session) ? () => void keepSession() : () => { setRetakeSlot(undefined); setActiveSlot(nextPhotoSlot(session) ?? 0); setCameraReady(false); setScreen('camera'); }} /></View>
            <Text style={styles.localSaved}>{session.shots.length} originals saved on this iPad</Text><Text style={styles.libraryStatus}>{photosStatus(session)}</Text>
            {needsPhotosExport(session) && <Pressable accessibilityRole="button" disabled={exporting} style={styles.textAction} onPress={() => void exportPhotos(session, true)}><Text style={styles.mutedButtonText}>{exporting ? 'Exporting to Photos…' : 'Save a copy to Photos'}</Text></Pressable>}
          </View>
        </View>}
        {screen === 'share' && session && <ScrollView contentContainerStyle={[styles.sharePage, landscape && styles.sharePageWide]}>
          <View style={styles.shareStory}><Text style={styles.shareEyebrow}>{total === 5 ? 'FIVE FRAMES. ALL YOURS.' : 'YOUR MOMENT. ALL YOURS.'}</Text><Text style={styles.shareTitle}>Yours to keep.</Text><Text style={styles.shareBody}>{guestPage ? `Scan once. Take all ${session.shots.length} home.` : `Your ${session.shots.length} originals are safe on this iPad.`}</Text><Thumbnails reduceMotion={reduceMotion || !foreground} session={session} active={-1} dark={false} />
            <SmsShare key={session.id} session={session} jobs={jobs} onChanged={async () => { await retrySharing(); }} />
            <Text style={styles.shareLocal}>{session.shots.length} originals saved on this iPad</Text><Text style={styles.shareLibrary}>{photosStatus(session)}</Text>
            {needsPhotosExport(session) && <Pressable accessibilityRole="button" disabled={exporting} style={styles.textAction} onPress={() => void exportPhotos(session, true)}><Text style={styles.lightTextAction}>{exporting ? 'Exporting to Photos…' : 'Save a copy to Photos'}</Text></Pressable>}
          </View>
          <View style={styles.shareCard}>{guestPage ? <View testID="guest-qr" style={styles.qrContent}><QRCode value={guestPage.url} size={224} quietZone={32} ecl="M" backgroundColor="#ffffff" color="#1e2723" /><Text style={styles.qrCaption}>YOUR PRIVATE PHOTO PAGE</Text><Text style={styles.expiry} accessibilityLabel={`Photo link expires ${expiry}`}>Available until {expiry}</Text><Text style={styles.sharePrivacy}>Anyone with the link can open your photos until then. Your originals stay private with the host afterward.</Text></View>
              : <View style={styles.offlineCard}><Text style={styles.offlineGlyph}>✓</Text><Text testID="share-link-unavailable" style={styles.offlineTitle}>No download link yet</Text><Text style={styles.sharePrivacy}>The host must reconnect the booth before your photo link is ready. Your originals stay safe on this iPad.</Text><Button title="Retry sharing" testID="retry-sharing" secondary light onPress={() => void retrySharing(true)} /></View>}
            <Button title={busy ? 'Clearing this screen…' : 'Next guests'} testID="next-guest" disabled={busy} onPress={() => void nextGuests()} />
          </View>
        </ScrollView>}
      </>}
      {!!message && <View accessibilityLiveRegion="polite" style={styles.message}><Text style={styles.messageText}>{message}</Text></View>}
      {nativeFixtureEnabled && <View style={styles.fixture}><Text testID="native-fixture-enabled" style={styles.fixtureText}>SYNTHETIC CAMERA · REAL LOCAL STORAGE · OFFLINE SHARING</Text><Text testID="native-fixture-storage" style={styles.fixtureText}>{fixtureStatus}</Text></View>}
    </Animated.View>
    <Modal visible={hostVisible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={closeHost}>
      <SafeAreaView style={styles.hostPage}><ScrollView contentContainerStyle={styles.hostContent} keyboardShouldPersistTaps="handled">
        <View style={styles.hostHeader}><Text style={styles.hostTitle}>{hostPage === 'library' ? 'On this iPad' : hostPage === 'setup' ? 'Private setup' : 'Booth controls'}</Text><Pressable accessibilityRole="button" onPress={closeHost}><Text style={styles.closeHost}>Done</Text></Pressable></View>
        <View style={styles.hostTabs}>{(['controls', 'library', 'setup'] as HostPage[]).map(page => <Pressable key={page} accessibilityRole="button" accessibilityState={{ selected: hostPage === page }} style={[styles.hostTab, hostPage === page && styles.hostTabActive]} onPress={() => { setHostPage(page); setHostMessage(''); setScanningSetup(false); setPairingCode(''); }}><Text style={styles.hostTabText}>{page === 'controls' ? 'Controls' : page === 'library' ? 'Saved sessions' : 'Private setup'}</Text></Pressable>)}</View>
        {hostPage === 'controls' && <>
          <View style={styles.hostCard}><Text style={styles.hostSectionTitle}>Countdown</Text><Text style={styles.hostBody}>Time to settle into each frame.</Text><View style={styles.timerOptions}>{TIMERS.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: seconds === value }} testID={`host-timer-${value}`} onPress={() => setSeconds(value)} style={[styles.timerOption, seconds === value && styles.timerOptionSelected]}><Text style={[styles.timerNumber, seconds === value && styles.timerNumberSelected]}>{value}s</Text></Pressable>)}</View></View>
          <View style={styles.hostCard}><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.hostSectionTitle}>Copies in Photos</Text><Text style={styles.hostBody}>Try an additional Photos export after capture. Local originals always save first.</Text></View><Switch accessibilityLabel="Automatically export copies to Photos" value={exportEnabled} onValueChange={setExportEnabled} trackColor={{ true: '#596857' }} /></View><Text style={styles.hostSmall}>Photos permission: {libraryPermission}. Failed or denied exports keep their local originals.</Text><Pressable accessibilityRole="button" style={styles.textAction} onPress={() => void Linking.openSettings()}><Text style={styles.lightTextAction}>Open iPad permission settings</Text></Pressable></View>
          <Button title={hostBusy ? 'Saving settings…' : 'Save booth settings'} disabled={hostBusy} onPress={() => void savePreferences()} />
          <View style={styles.hostCard}><Text style={styles.hostSectionTitle}>Sharing {paired ? 'paired' : 'offline'}</Text><Text style={styles.hostBody}>{pendingCount} photos currently listed in the upload queue. Local capture and saved sessions work independently.</Text>{queueRepairStatus && <Text testID="host-index-repair-status" style={styles.hostWarning}>{queueRepairStatus}</Text>}<Pressable accessibilityRole="button" style={styles.textAction} onPress={() => void retrySharing(true)}><Text style={styles.lightTextAction}>{queueRepairStatus ? 'Repair index & retry sharing' : 'Retry pending sharing'}</Text></Pressable>{!!hostDiagnostic && <Text selectable style={styles.diagnostic}>{hostDiagnostic}</Text>}</View>
        </>}
        {hostPage === 'library' && <>
          <Text style={styles.hostBody}>Originals saved in this app, available without a network connection. Photos export is listed separately.</Text>
          <Button title="Refresh local sessions" secondary light onPress={() => void refreshLibrary().catch(error => { diagnose(error); setHostMessage('Could not refresh local sessions.'); })} />
          {librarySession && <View style={styles.hostCard}>
            <Text style={styles.hostSectionTitle}>{librarySession.createdAt > 0 ? new Date(librarySession.createdAt).toLocaleString() : 'Recovered session'}</Text>
            <View style={styles.hostTabs}>
              <Pressable accessibilityRole="button" testID="host-selected-originals" accessibilityState={{ selected: libraryMode === 'selected' }} style={[styles.hostTab, libraryMode === 'selected' && styles.hostTabActive]} onPress={() => setLibraryMode('selected')}><Text style={styles.hostTabText}>Guest selections</Text></Pressable>
              <Pressable accessibilityRole="button" testID="host-retained-originals" accessibilityState={{ selected: libraryMode === 'retained' }} style={[styles.hostTab, libraryMode === 'retained' && styles.hostTabActive]} onPress={() => setLibraryMode('retained')}><Text style={styles.hostTabText}>Retained originals ({librarySession.retakes?.length ?? 0})</Text></Pressable>
            </View>
            {librarySession.storageWarning === 'index-repair-pending' && <Text style={styles.hostWarning}>Upload index repair is pending. The selected originals are saved locally even if the upload queue shows zero.</Text>}
            {!!librarySession.stagedOriginals?.length && <View style={styles.hostOriginalCard}>
              <Text style={styles.hostSectionTitle}>Local save not complete</Text>
              <Text style={styles.hostBody}>{librarySession.stagedOriginals.length} captured {librarySession.stagedOriginals.length === 1 ? 'original still needs its' : 'originals still need their'} local save completed. These are not counted in the guest gallery and cannot be exported to Photos yet.</Text>
              <Button title="Finish local save" testID="host-finish-local-save" disabled={hostBusy || exporting} onPress={() => void runHostOriginalAction({ kind: 'finish-save', sessionId: librarySession.id })} />
            </View>}
            {libraryMode === 'retained' ? <>
              <Text style={styles.hostBody}>Earlier takes are retained privately on this iPad. Exporting one here does not add it to the guest photo page.</Text>
              {!librarySession.retakes?.length && <Text style={styles.hostSmall}>No earlier takes in this session.</Text>}
              {(librarySession.retakes ?? []).map(photo => hostPhotoCard(photo, true))}
            </> : <>
              <ScrollView horizontal pagingEnabled style={{ height: Math.min(420, height * 0.4) }}>{librarySession.shots.map(photo => <Image key={photo.id} source={{ uri: photo.fileUri }} style={{ width: Math.min(width - 96, 650), height: '100%' }} resizeMode="contain" />)}</ScrollView>
              <Text style={styles.hostBody}>{librarySession.shots.length} originals on this iPad · {photosStatus(librarySession)}</Text>
              <Button title={exporting ? 'Exporting copies…' : photosExportTitle(librarySession)} disabled={exporting || !needsPhotosExport(librarySession)} onPress={() => void exportPhotos(librarySession, true)} />
              {librarySession.shots.some(photo => photo.exportStatus === 'uncertain') && <Text style={styles.hostWarning}>Check each uncertain original in the Photos app before choosing an action below. No uncertain copy is retried automatically.</Text>}
              {librarySession.shots.filter(photo => photo.exportStatus === 'uncertain').map(photo => hostPhotoCard(photo, false))}
            </>}
          </View>}
          {!savedSessions.length && <Text style={styles.hostBody}>No saved sessions yet.</Text>}
          {savedSessions.map(value => <Pressable key={value.id} accessibilityRole="button" style={styles.hostCard} onPress={() => { adoptLibrarySession(value); setLibraryMode('selected'); setHostMessage(''); }}><Text style={styles.hostSectionTitle}>{value.createdAt > 0 ? new Date(value.createdAt).toLocaleString() : 'Recovered session'}</Text><View style={styles.libraryStrip}>{value.shots.map(photo => <Image key={photo.id} source={{ uri: photo.fileUri }} style={styles.libraryThumb} resizeMode="cover" />)}</View><Text style={styles.hostBody}>{value.shots.length} originals · {photosStatus(value)}</Text>{!!value.stagedOriginals?.length && <Text style={styles.hostWarning}>{value.stagedOriginals.length} captures awaiting local save completion</Text>}{value.storageWarning === 'index-repair-pending' && <Text style={styles.hostWarning}>Upload index repair pending</Text>}<Text style={styles.lightTextAction}>Open saved session →</Text></Pressable>)}
        </>}
        {hostPage === 'setup' && <View style={styles.hostCard}><Text style={styles.hostSectionTitle}>Connect this booth</Text><Text style={styles.hostBody}>Use the one-time pairing code provided by the booth owner. This is separate from guest capture.</Text>{scanningSetup ? <View style={styles.setupScanner}><CameraView facing="back" style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
              if (!hostVisible || hostPage !== 'setup' || pairingLock.current) return;
              if (!/^[a-f0-9]{64}$/i.test(data)) { setHostMessage('This is not a private booth setup code.'); return; }
              // Reserve synchronously inside pairBooth before its first await.
              void pairBooth(data);
            }} onMountError={() => { setScanningSetup(false); setHostMessage('The scanner is unavailable. Paste the private setup code instead.'); }} /></View>
            : <Button title="Scan private setup QR" light secondary disabled={hostBusy} onPress={() => void scanPrivateSetup()} />}
            {scanningSetup && <Button title="Cancel scanner" light secondary onPress={() => setScanningSetup(false)} />}
            <TextInput accessibilityLabel="One-time booth pairing code" value={pairingCode} onChangeText={setPairingCode} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="One-time pairing code" style={styles.pairingInput} /><Button title={hostBusy ? 'Pairing securely…' : 'Pair this iPad'} disabled={hostBusy || !pairingCode.trim()} onPress={() => void pairBooth()} /><Text style={styles.hostSmall}>Local capture needs no cloud connection. Pairing requires owner setup and device authentication.</Text></View>}
        {!!hostMessage && <Text accessibilityLiveRegion="polite" style={styles.hostNotice}>{hostMessage}</Text>}
      </ScrollView>
        {hostDecision && <View accessibilityViewIsModal testID="host-photo-decision" style={styles.hostDecisionOverlay}>
          <View style={styles.hostDecisionCard}>
            <Text style={styles.hostSectionTitle}>{hostDecision.kind === 'acknowledge' ? 'Confirm you checked Photos' : 'A duplicate may be created'}</Text>
            {decisionPhoto && <Image source={{ uri: decisionPhoto.fileUri }} resizeMode="contain" style={styles.hostDecisionPreview} />}
            <Text style={styles.hostBody}>{hostDecision.kind === 'acknowledge'
              ? 'Only mark this original as saved after you have found its copy in the Photos app. This records your check; it does not create a new copy.'
              : 'Photos may already contain this original. Exporting again can create another copy. Check Photos first; continue only if you accept a possible duplicate.'}</Text>
            <Button title={hostDecision.kind === 'acknowledge' ? 'I checked · mark as saved' : 'Export again anyway'} testID="host-photo-decision-confirm" disabled={hostBusy || exporting} onPress={() => { const request = hostDecision; setHostDecision(null); void runHostOriginalAction({ ...request, duplicateRiskAccepted: request.kind === 'export' }); }} />
            <Button title="Cancel" testID="host-photo-decision-cancel" light secondary onPress={() => setHostDecision(null)} />
          </View>
        </View>}
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101512' }, lightPage: { backgroundColor: '#F5F0E8' }, app: { flex: 1 },
  attract: { flex: 1, justifyContent: 'space-between', backgroundColor: '#403A32' }, attractImage: { opacity: 0.96 }, attractShade: { ...StyleSheet.absoluteFill, backgroundColor: '#0B17114D' },
  attractTop: { backgroundColor: '#102117B3', paddingHorizontal: 32, paddingTop: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { fontSize: 11, letterSpacing: 3, fontWeight: '700', color: '#F8F4EB' }, brandDark: { color: '#252B25' }, attractHost: { color: '#fff', fontSize: 14, padding: 14, borderWidth: 1, borderColor: '#FFFFFF70', borderRadius: 24 },
  weddingIdentity: { fontSize: 12, letterSpacing: 1 }, compactIdentity: { gap: 5 }, compactDate: { color: '#D7DBD1', fontSize: 10, letterSpacing: 1 },
  attractContent: { padding: 36, paddingTop: 26, gap: 20, backgroundColor: '#101B13D9' }, attractContentWide: { width: '53%', maxWidth: 620, margin: 32, borderRadius: 24, padding: 34 }, attractEyebrow: { color: '#F0D8B0', fontSize: 11, letterSpacing: 2.5, fontWeight: '600' }, attractTitle: { color: '#fffaf0', fontSize: 72, lineHeight: 73, fontFamily: 'Georgia', letterSpacing: -2 }, attractTitleWide: { fontSize: 68, lineHeight: 69 }, attractSubtitle: { color: '#EEE8D9', fontSize: 19 }, attractFootnote: { color: '#D5D7CA', fontSize: 13, textAlign: 'center' },
  topbar: { height: 62, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, topbarLight: { backgroundColor: '#F5F0E8' }, hostLink: { color: '#D7DBD1', padding: 12, minHeight: 44, fontSize: 14 }, hostLinkDark: { color: '#4D594D' },
  capturePage: { flex: 1, paddingHorizontal: 18, paddingBottom: 16, gap: 16 }, cameraStage: { flex: 1, minHeight: 250, borderRadius: 22, overflow: 'hidden', backgroundColor: '#222B24' }, cameraTop: { zIndex: 1, position: 'absolute', left: 18, right: 18, top: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, progressText: { backgroundColor: '#101512D9', color: '#fff', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 24, fontWeight: '700', letterSpacing: 1, fontSize: 13 }, progressMuted: { color: '#CDD1C7' }, cameraSaved: { backgroundColor: '#101512D9', color: '#E7ECDF', padding: 11, borderRadius: 20, fontSize: 12 },
  countdownShade: { ...StyleSheet.absoluteFill, backgroundColor: '#102117B3', justifyContent: 'center', alignItems: 'center' }, countdown: { color: '#fff', fontSize: 170, fontWeight: '200', fontVariant: ['tabular-nums'] }, countdownNote: { color: '#fff', fontSize: 20, marginTop: 8 }, savingBadge: { position: 'absolute', alignSelf: 'center', bottom: 25, backgroundColor: '#101512EB', borderRadius: 24, padding: 15 }, savingText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  permission: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 22 }, permissionTitle: { color: '#fff', fontFamily: 'Georgia', fontSize: 34, textAlign: 'center' }, permissionBody: { color: '#E4E9DB', fontSize: 19 },
  captureBottom: { gap: 14, alignItems: 'center' }, captureBottomWide: { flexDirection: 'row', justifyContent: 'space-between', gap: 28 }, captureActions: { width: '100%', maxWidth: 440, alignItems: 'center', gap: 8, flexShrink: 1 }, cameraHint: { color: '#B8C0B0', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  thumbnailCompact: { width: 48, height: 62 }, thumbnailsCompact: { gap: 7 },
  thumbnails: { flexDirection: 'row', gap: 9, justifyContent: 'center', paddingVertical: 3 }, thumbnail: { width: 62, height: 76, borderRadius: 10, borderWidth: 1, borderColor: '#65715F', backgroundColor: '#263027', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, thumbnailLight: { backgroundColor: '#E6E8DF', borderColor: '#8B9381' }, thumbnailSelected: { borderColor: '#E8D3AA', borderWidth: 3 }, thumbnailNumber: { fontSize: 19, color: '#D5DDCD', fontVariant: ['tabular-nums'] }, thumbnailNumberLight: { color: '#4A5947' }, thumbnailTick: { position: 'absolute', right: 3, bottom: 3, width: 17, height: 17, borderRadius: 9, backgroundColor: '#FCF9EE', alignItems: 'center', justifyContent: 'center' }, thumbnailTickText: { fontSize: 11, color: '#26432A', fontWeight: '700' },
  button: { minHeight: 64, paddingHorizontal: 25, paddingVertical: 18, borderRadius: 16, backgroundColor: '#D3A06E', flexShrink: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }, buttonText: { color: '#182319', fontSize: 19, fontWeight: '700', textAlign: 'center' }, secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#899581' }, secondaryButtonText: { color: '#DCE4D4' }, lightButton: { backgroundColor: '#FAF4E8' }, lightButtonText: { color: '#172719' }, disabled: { opacity: 0.4 }, pressed: { opacity: 0.8 }, textAction: { paddingVertical: 10, paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }, mutedButtonText: { color: '#CFD7C5', fontSize: 14, textAlign: 'center' },
  reviewPageWide: { flexDirection: 'row', gap: 24 }, reviewSideRail: { width: 300, flexShrink: 0, justifyContent: 'center', gap: 14 }, reviewRailHeading: { gap: 12, width: '100%', paddingBottom: 14 },
  reviewPage: { flex: 1, paddingHorizontal: 18, paddingBottom: 12, gap: 12 }, reviewHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10 }, reviewEyebrow: { color: '#B6C2AB', fontSize: 10, letterSpacing: 2, marginBottom: 6 }, reviewTitle: { color: '#FAF7EF', fontSize: 27, fontFamily: 'Georgia' }, reviewCount: { color: '#D0D8C8', fontSize: 17, fontVariant: ['tabular-nums'] }, reviewStage: { flex: 1, minHeight: 250, borderRadius: 20, overflow: 'hidden', backgroundColor: '#080C09' }, reviewSlide: { height: '100%' }, reviewBottom: { alignItems: 'center', gap: 8 }, reviewActions: { width: '100%', gap: 10, maxWidth: 700, flexDirection: 'row' }, reviewActionsWide: { flexDirection: 'column', width: '100%' }, localSaved: { color: '#E8EDDF', fontSize: 13, fontWeight: '600', marginTop: 2 }, libraryStatus: { color: '#B8C0B0', fontSize: 12, textAlign: 'center' },
  sharePage: { flexGrow: 1, padding: 30, gap: 26, alignItems: 'center', justifyContent: 'center' }, sharePageWide: { flexDirection: 'row', gap: 48, paddingHorizontal: 46 }, shareStory: { alignItems: 'center', gap: 17, flexShrink: 1, maxWidth: 510 }, shareEyebrow: { fontSize: 11, color: '#5A6954', letterSpacing: 1, fontWeight: '700', textAlign: 'center' }, shareTitle: { fontSize: 46, fontFamily: 'Georgia', color: '#263426', textAlign: 'center' }, shareBody: { fontSize: 17, color: '#53614D', lineHeight: 26, textAlign: 'center', maxWidth: 430 }, shareLocal: { color: '#2F482E', fontWeight: '700', fontSize: 14, marginTop: 4 }, shareLibrary: { color: '#53614D', fontSize: 13, textAlign: 'center' }, shareCard: { width: '100%', maxWidth: 350, backgroundColor: '#fff', padding: 22, borderRadius: 24, gap: 20 }, qrContent: { alignItems: 'center', gap: 12 }, qrCaption: { color: '#394F35', fontSize: 10, letterSpacing: 1.8, fontWeight: '700' }, expiry: { color: '#34462F', fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'center' }, sharePrivacy: { color: '#586451', fontSize: 12, lineHeight: 19, textAlign: 'center' }, offlineCard: { alignItems: 'center', gap: 17, paddingVertical: 12 }, offlineGlyph: { color: '#385B34', fontSize: 38 }, offlineTitle: { fontSize: 28, fontFamily: 'Georgia', color: '#2D452A', textAlign: 'center' }, lightTextAction: { color: '#385731', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  message: { padding: 16, backgroundColor: '#652E25', marginHorizontal: 18, marginBottom: 12, borderRadius: 12 }, messageText: { color: '#fff', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  hostPage: { flex: 1, backgroundColor: '#F3F1E9' }, hostContent: { padding: 28, gap: 20, maxWidth: 850, width: '100%', alignSelf: 'center' }, hostHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, hostTitle: { fontSize: 30, color: '#253D25', fontWeight: '600' }, closeHost: { color: '#385731', fontSize: 18, padding: 12 }, hostTabs: { flexDirection: 'row', gap: 8 }, hostTab: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#E6E9DE' }, hostTabActive: { backgroundColor: '#D2DDC7' }, hostTabText: { color: '#2E482B', fontSize: 14, textAlign: 'center', fontWeight: '600' }, hostCard: { backgroundColor: '#fff', borderRadius: 20, padding: 22, gap: 16 }, hostSectionTitle: { color: '#263D25', fontSize: 20, fontWeight: '600' }, hostBody: { color: '#53634D', fontSize: 15, lineHeight: 23 }, hostSmall: { color: '#5E6A57', fontSize: 13, lineHeight: 20 }, timerOptions: { flexDirection: 'row', gap: 9 }, timerOption: { flex: 1, minHeight: 61, borderWidth: 1, borderColor: '#ACB99E', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, timerOptionSelected: { backgroundColor: '#314D2D', borderColor: '#314D2D' }, timerNumber: { fontSize: 22, fontWeight: '600', color: '#314D2D' }, timerNumberSelected: { color: '#fff' }, switchRow: { flexDirection: 'row', gap: 20, alignItems: 'center' }, switchText: { flex: 1, gap: 8 }, pairingInput: { borderWidth: 1, borderColor: '#9BA78E', borderRadius: 12, minHeight: 60, padding: 17, color: '#263D25', backgroundColor: '#FCFDF8', fontSize: 18 }, hostNotice: { color: '#395B31', fontSize: 16, lineHeight: 23 }, diagnostic: { color: '#733C2B', fontSize: 12, lineHeight: 19 }, libraryStrip: { flexDirection: 'row', gap: 7 }, libraryThumb: { width: 62, height: 76, borderRadius: 9 },
  hostWarning: { color: '#713D20', fontSize: 14, lineHeight: 22 }, hostOriginalCard: { borderWidth: 1, borderColor: '#C8D0BF', borderRadius: 16, padding: 16, gap: 14, backgroundColor: '#F8FAF3' }, hostOriginalPreview: { width: '100%', height: 260, borderRadius: 10, backgroundColor: '#172219' }, hostDecisionOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#102117D9', zIndex: 5, alignItems: 'center', justifyContent: 'center', padding: 24 }, hostDecisionCard: { width: '100%', maxWidth: 540, borderRadius: 22, padding: 24, gap: 18, backgroundColor: '#fff' }, hostDecisionPreview: { width: '100%', height: 170, backgroundColor: '#172219', borderRadius: 10 },
  setupScanner: { height: 330, backgroundColor: '#172219', borderRadius: 18, overflow: 'hidden' },
  fixture: { backgroundColor: '#fff7df', padding: 7 }, fixtureText: { color: '#47391C', fontSize: 10 },
});
