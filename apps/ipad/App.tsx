import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, AppState, Easing, Image, ImageBackground, Linking, Modal,
  Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput,
  useWindowDimensions, View,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraCapturedPicture, CameraPictureOptions } from 'expo-camera';
import { requireOptionalNativeModule } from 'expo';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';
import { parseQueueFailure, type QueueJob } from '@wedding-booth/core';
import { SmsShare } from './src/SmsShare';
import { authenticateHost, hostAuthenticationCode } from './src/host-auth';
import { loadConnection, loadHostPreferences, provisionBooth, saveHostPreferences } from './src/config';
import { formatGuestExpiry } from './src/sharing';
import { classifyShareReadiness, type SharingConnectionState, type SharingSyncState } from './src/share-readiness';
import {
  clearActiveSession, confirmSession, createSession, getActiveCapture, getActiveSession, getLocalSession, getQueueIndexDiagnostics,
  listLocalSessions, recoverPreservedPhotos, retryStagedPhotos, retryStagedComposites, saveShot, saveRenderedPhoto, saveComposite, selectSavedPhoto, store, updatePhotoExport, type ActiveCapture, type ActiveSession,
} from './src/storage';
import { compositeExportCapture, exportSessionPhotos, getPhotoLibraryCapability } from './src/photo-library';
import { retryPendingNow, syncPending } from './src/sync';
import { nativeFixtureEnabled, nativeFixtureImage, nativeFixturePhotoId, nativeFixtureStorageStatus, takeNativeFixturePhoto } from './src/native-fixture';
import { captureErrorMessage, captureSaveStatus, WEDDING_DATE, WEDDING_IDENTITY, WEDDING_NAMES } from './src/booth-presentation';
import { createHostOriginalActions, hostOriginalStatus, INDEX_REPAIR_DIAGNOSTIC, indexRepairSessions, queueIndexStatus, type HostOriginalRequest } from './src/host-originals';
import { createReviewSelection } from './src/review-selection';
import { createSessionCaptureRunner, nextPhotoSlot, screenForSession, sessionIsComplete, type PendingPhoto } from './src/session-capture';
import { GlassSurface } from './src/GlassSurface';
import { createHostVisibility } from './src/host-visibility';
import { authenticateHostAction, type HostActionLease } from './src/host-action-auth';
import { createPhotoLookEditor, type PhotoLookEditorState, type PhotoLookPreset } from './src/photo-look-editor';
import { loadPhotoEffects, loadTemplateEffects } from './src/native-photo-effects';
import { createTemplateEditor, type TemplateEditorState } from './src/template-editor';
import { TemplateStudio } from './src/TemplateStudio';
import { TimingSheet, TimingControls } from './src/TimingSheet';
import { DEFAULT_CAPTURE_TIMING, normalizeCaptureTiming, type CaptureTiming } from './src/capture-timing';

const CAMERA_UNAVAILABLE_MESSAGE = 'The front camera is unavailable. Please ask the host.';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const LOOKS: { preset: PhotoLookPreset; title: string }[] = [{ preset: 'original', title: 'Original' }, { preset: 'warm', title: 'Warm' }, { preset: 'bw', title: 'B&W' }, { preset: 'film', title: 'Film' }];
const STRENGTHS = [0, 0.25, 0.5, 0.75, 1] as const;
type Screen = 'attract' | 'camera' | 'review' | 'template' | 'share';
type HostPage = 'controls' | 'library' | 'setup';

function photoSlot(photo: ActiveCapture, index: number) { return photo.shotIndex ?? index; }
function needsPhotosExport(session: ActiveSession): boolean {
  return session.shots.some(photo => photo.exportStatus !== 'saved' && String(photo.exportStatus) !== 'uncertain') ||
    !!(session.composite && session.composite.exportStatus !== 'saved' && session.composite.exportStatus !== 'uncertain');
}
function photosExportTitle(session: ActiveSession): string {
  if (!session.shots.length) return 'No photos to export';
  if (needsPhotosExport(session)) return 'Export copies to Photos';
  if (session.shots.some(photo => String(photo.exportStatus) === 'uncertain') || session.composite?.exportStatus === 'uncertain') return 'Check Photos for unconfirmed copies';
  return 'All copies were exported to Photos';
}
function photosStatus(session: ActiveSession | null): string {
  if (!session?.shots.length) return 'Photos export is separate from your saved originals.';
  const saved = session.shots.filter(photo => photo.exportStatus === 'saved').length;
  if (session.shots.some(photo => String(photo.exportStatus) === 'uncertain')) return 'Photos result unconfirmed · check Photos before retrying';
  if (saved === session.shots.length) return `${saved} of ${session.shots.length} exported to Photos`;
  if (session.shots.some(photo => photo.exportStatus === 'denied')) return 'Photos access needed · originals are safe here';
  if (session.shots.some(photo => photo.exportStatus === 'failed')) return 'Photos export needs a retry · originals are safe here';
  if (session.shots.some(photo => photo.exportStatus === 'unavailable')) return 'Photos unavailable · originals are safe here';
  return saved ? `${saved} of ${session.shots.length} exported to Photos` : 'Not yet exported to Photos';
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

export default function App() { return <SafeAreaProvider><Photobooth /></SafeAreaProvider>; }

function Photobooth() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  const hostMutationLock = useRef(false);
  const hostVisibleRef = useRef(false);
  const hostVisibility = useRef(createHostVisibility());
  const lookActive = useRef(false);
  const lookSaving = useRef(false);
  const templateActive = useRef(false);
  const templateSaving = useRef(false);
  const librarySessionRef = useRef<ActiveSession | null>(null);
  const screenFade = useRef(new Animated.Value(1)).current;
  const countdownReveal = useRef(new Animated.Value(1)).current;
  const exposureFlash = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(true);
  const [screen, setScreen] = useState<Screen>('attract');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraReadyRef = useRef(false);
  function updateCameraReady(value: boolean) { cameraReadyRef.current = value; setCameraReady(value); }
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const cameraEpochRef = useRef(0);
  const cameraNeedsRemount = useRef(false);
  const capturePersisting = useRef(false);
  function refreshInterruptedCamera() {
    if (!cameraNeedsRemount.current || capturePersisting.current || AppState.currentState !== 'active') return;
    // SDK58 resumes a session without emitting onCameraReady. Remount only after
    // an already exposed photo has finished preserving, then await fresh readiness.
    cameraNeedsRemount.current = false; updateCameraReady(false);
    cameraEpochRef.current += 1; setCameraEpoch(cameraEpochRef.current);
  }
  function acknowledgeCameraReady(epoch: number) {
    if (epoch === cameraEpochRef.current && !cameraNeedsRemount.current && AppState.currentState === 'active') {
      updateCameraReady(true);
      setMessage(current => current === CAMERA_UNAVAILABLE_MESSAGE ? '' : current);
    }
  }
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [focusedSlot, setFocusedSlot] = useState(0);
  const [retakeSlot, setRetakeSlot] = useState<number>();
  const [reviewWidth, setReviewWidth] = useState(width);
  const [failedPhoto, setFailedPhoto] = useState<PendingPhoto>();
  const [message, setMessage] = useState('');
  const [hostDiagnostic, setHostDiagnostic] = useState('');
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [sharingConnection, setSharingConnection] = useState<SharingConnectionState>('checking');
  const [sharingSync, setSharingSync] = useState<SharingSyncState>('idle');
  const connectionRead = useRef(0);
  const sharingPasses = useRef(0);
  const sharingPassFailed = useRef(false);
  const [invalidQueueRows, setInvalidQueueRows] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [hostTiming, setHostTiming] = useState<CaptureTiming>({ ...DEFAULT_CAPTURE_TIMING });
  const [guestTiming, setGuestTiming] = useState<CaptureTiming>({ ...DEFAULT_CAPTURE_TIMING });
  const guestTimingRef = useRef<CaptureTiming>({ ...DEFAULT_CAPTURE_TIMING });
  const guestTimingOverride = useRef(false);
  const [timingVisible, setTimingVisible] = useState(false);
  const [exportEnabled, setExportEnabled] = useState(true);
  const preferencesRef = useRef({ ...DEFAULT_CAPTURE_TIMING, photosExportEnabled: true });
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
  const [photoEffects] = useState(loadPhotoEffects);
  const [lookState, setLookState] = useState<PhotoLookEditorState | null>(null);
  const [lookPreviewPresented, setLookPreviewPresented] = useState<string | null>(null);
  const [lookImageFailed, setLookImageFailed] = useState(false);
  const [lookImageEpoch, setLookImageEpoch] = useState(0);
  const lookPreviewRef = useRef<string | null>(null);
  const [lookApplying, setLookApplying] = useState(false);
  const [templateEffects] = useState(loadTemplateEffects);
  const [templateState, setTemplateState] = useState<TemplateEditorState | null>(null);
  const [templateApplying, setTemplateApplying] = useState(false);
  const [templatePreviewPresented, setTemplatePreviewPresented] = useState<string | null>(null);
  const templatePreviewRef = useRef<string | null>(null);
  const templateEditor = useRef<ReturnType<typeof createTemplateEditor> | null>(null);
  if (!templateEditor.current && templateEffects) templateEditor.current = createTemplateEditor({
    ...templateEffects, id: randomUUID, loadSession: getLocalSession, saveComposite,
    onState(value) {
      templateActive.current = !!value;
      if (mounted.current) {
        const uri = value?.previewUri ?? null;
        if (templatePreviewRef.current !== uri) { templatePreviewRef.current = uri; setTemplatePreviewPresented(null); }
        setTemplateState(value); if (value?.error) setHostDiagnostic(value.error);
      }
    },
    onSession(value) { if (sessionRef.current?.id === value.id && mounted.current) { adoptSession(value); void refreshQueue(); } },
  });
  const lookEditor = useRef<ReturnType<typeof createPhotoLookEditor> | null>(null);
  if (!lookEditor.current && photoEffects) lookEditor.current = createPhotoLookEditor({
    ...photoEffects, id: randomUUID, loadSession: getLocalSession, saveRenderedPhoto, selectSavedPhoto,
    onState(value) {
      lookActive.current = !!value;
      if (mounted.current) {
        const uri = value?.previewUri ?? null;
        if (lookPreviewRef.current !== uri) { lookPreviewRef.current = uri; setLookPreviewPresented(null); setLookImageFailed(false); }
        setLookState(value); if (value?.error) setHostDiagnostic(value.error);
      }
    },
    onSession(value) {
      if (sessionRef.current?.id === value.id && mounted.current) { adoptSession(value); void refreshQueue(); }
    },
  });
  const [fullPhotoSupported, setFullPhotoSupported] = useState(() => {
    try { return Platform.OS === 'ios' && requireOptionalNativeModule<{ preserveFullPhotoAvailable?: boolean }>('ExpoCamera')?.preserveFullPhotoAvailable === true; } catch { return false; }
  });

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
    const lease = hostVisibility.current.epoch();
    const values = await listLocalSessions();
    if (mounted.current && hostVisibleRef.current && hostVisibility.current.current(lease)) {
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
  async function refreshSharingConnection(): Promise<SharingConnectionState> {
    const request = ++connectionRead.current;
    let result: SharingConnectionState;
    try { result = await loadConnection() ? 'paired' : 'unpaired'; }
    catch { result = 'unavailable'; }
    if (mounted.current && request === connectionRead.current) {
      setSharingConnection(result); setPaired(result === 'paired');
    }
    return result;
  }
  async function retrySharing(immediate = false) {
    const connection = await refreshSharingConnection();
    const canUpload = connection === 'paired';
    if (canUpload) {
      if (!sharingPasses.current) sharingPassFailed.current = false;
      sharingPasses.current++;
      if (mounted.current) setSharingSync('running');
    }
    try {
      // Local index/recipient maintenance still runs without pairing. The sync
      // layer checks setup before any job claim, retry reset or network request.
      await (immediate ? retryPendingNow() : syncPending());
    } catch {
      sharingPassFailed.current = true;
      if (mounted.current) setHostDiagnostic('Sharing did not complete. Check private setup and the saved session status; local originals are retained.');
    } finally {
      if (canUpload) sharingPasses.current = Math.max(0, sharingPasses.current - 1);
      if (mounted.current && !sharingPasses.current) setSharingSync(sharingPassFailed.current ? 'failed' : 'idle');
    }
    await refreshQueue();
    try { await refreshDisplayedSessions(); if (hostVisibleRef.current) await refreshLibrary(); }
    catch (error) { diagnose(error); }
  }
  async function exportPhotos(value: ActiveSession, requestPermission: boolean, includeKeepsake = !!value.composite, authorization?: { assertCurrent(): void }) {
    authorization?.assertCurrent();
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      let updated = await exportSessionPhotos(value, { requestPermission, ...(authorization ? { assertCurrent: authorization.assertCurrent } : {}) });
      authorization?.assertCurrent();
      if (includeKeepsake && compositeExportCapture(updated)) updated = await exportSessionPhotos(updated, { requestPermission, includeComposite: true, photoIds: [updated.composite!.id], ...(authorization ? { assertCurrent: authorization.assertCurrent } : {}) });
      authorization?.assertCurrent();
      if (sessionRef.current?.id === updated.id) adoptSession(updated);
      if (librarySessionRef.current?.id === updated.id) adoptLibrarySession(updated);
      await refreshLibrary();
      await refreshCapability();
    } catch (error) {
      diagnose(error);
      setHostMessage('Photos export could not finish. Your originals remain on this iPad.');
    } finally { exportLock.current = false; setExporting(false); }
  }

  // Each protected mutation gets a fresh OS-authenticated lease. The system
  // prompt may redact the sheet; only its still-current foreground lease can
  // restore the intended page or start an effect after a later asynchronous read.
  function hostActionAuthorization(page: HostPage, selectedSessionId?: string) {
    let lease: HostActionLease | null = null;
    const intendedLibraryMode = libraryMode;
    return {
      async authenticate() {
        if (!hostVisibleRef.current || !mounted.current || AppState.currentState !== 'active') {
          throw new Error('Host settings locked. Return to the booth and authenticate again.');
        }
        lease = await authenticateHostAction({
          visibility: hostVisibility.current, authenticate: authenticateHost,
          isActive: () => mounted.current && AppState.currentState === 'active', wait: pause,
        });
        lease.assertCurrent();
        setHostPage(page); setScanningSetup(false); setPairingCode(''); setHostDecision(null);
        if (page === 'library') setLibraryMode(intendedLibraryMode);
        hostVisibleRef.current = true; setHostVisible(true);
        if (selectedSessionId) {
          const selected = await getLocalSession(selectedSessionId);
          lease.assertCurrent(); adoptLibrarySession(selected);
        }
        await refreshLibrary();
        lease.assertCurrent();
      },
      assertCurrent() {
        if (!lease) throw new Error('This host action needs fresh iPad authentication.');
        lease.assertCurrent();
      },
    };
  }
  function reportHostActionFailure(error: unknown) {
    diagnose(error);
    if (hostVisibleRef.current && AppState.currentState === 'active') {
      setHostMessage(error instanceof Error ? error.message : 'The host action did not finish. Local originals remain on this iPad.');
    } else {
      setMessage('The host action stopped or was interrupted. Return to Host and authenticate to check its saved result. Local originals remain on this iPad.');
    }
  }
  async function runHostOriginalAction(request: HostOriginalRequest) {
    if (hostMutationLock.current || hostOriginalLock.current || exportLock.current || hostBusy) return;
    hostMutationLock.current = true;
    hostOriginalLock.current = true; exportLock.current = true;
    setHostBusy(true); setExporting(request.kind === 'export'); setHostMessage('');
    const authorization = hostActionAuthorization('library', request.sessionId);
    const actions = createHostOriginalActions<ActiveSession>({
      ...authorization, load: getLocalSession,
      acknowledge: (sessionId, photoId) => updatePhotoExport(sessionId, photoId, 'saved'),
      export: (value, options) => exportSessionPhotos(value, { ...options, assertCurrent: authorization.assertCurrent }),
      finishSave: retryStagedPhotos,
    });
    try {
      const result = await actions.run(request);
      if (result.kind === 'confirm-duplicate') {
        if (result.request.kind !== 'finish-save') setHostDecision(result.request);
        return;
      }
      if (result.kind === 'busy') return;
      authorization.assertCurrent();
      const updated = result.session;
      if (sessionRef.current?.id === updated.id) adoptSession(updated);
      if (librarySessionRef.current?.id === updated.id) adoptLibrarySession(updated);
      await refreshLibrary(); await refreshCapability(); authorization.assertCurrent();
      if (request.kind === 'finish-save') {
        const remaining = (updated.stagedOriginals?.length ?? 0) + (updated.stagedComposites?.length ?? 0);
        setHostMessage(remaining ? `Local save retried. ${remaining} captured originals still need completion.` : 'Local save completed. The original is now available on this iPad.');
      } else if (result.kind === 'already-saved') setHostMessage('This original already has a successful Photos export recorded.');
      else if (request.kind === 'acknowledge') setHostMessage('Marked as saved in Photos based on your check.');
      else {
        const photo = (request.retained ? updated.retakes ?? [] : updated.shots).find(value => value.id === request.photoId);
        setHostMessage(photo ? hostOriginalStatus(photo) : 'Check this original’s Photos status before another export.');
      }
    } catch (error) {
      reportHostActionFailure(error);
    } finally { hostMutationLock.current = false; hostOriginalLock.current = false; exportLock.current = false; setExporting(false); setHostBusy(false); }
  }
  function requestHostPhoto(kind: 'acknowledge' | 'export', photo: ActiveCapture, retained: boolean) {
    const value = librarySessionRef.current;
    if (!value || hostBusy || exporting) return;
    const request = { kind, sessionId: value.id, photoId: photo.id, retained };
    if (kind === 'acknowledge' || photo.exportStatus === 'uncertain') setHostDecision(request);
    else void runHostOriginalAction(request);
  }
  function hostPhotoCard(photo: ActiveCapture, retained: boolean, keepsake = false) {
    const sourceOriginal = retained && librarySessionRef.current?.composite?.originalPhotoIds.includes(photo.id);
    return <View key={photo.id} testID={`host-original-${photo.id}`} style={styles.hostOriginalCard}>
      <Text style={styles.hostSectionTitle}>{keepsake ? 'Saved keepsake' : sourceOriginal ? 'Source original' : retained ? 'Retained take' : 'Selected photo'}{photo.shotIndex !== undefined ? ` · Photo ${photo.shotIndex + 1}` : ''}</Text>
      {retained && <Text style={styles.hostSmall}>{sourceOriginal ? 'Included with this keepsake as an untouched original.' : 'Not in the guest gallery. This earlier original remains on this iPad.'}</Text>}
      <Image source={{ uri: photo.fileUri }} style={styles.hostOriginalPreview} resizeMode="contain" accessibilityLabel={keepsake ? 'Saved keepsake' : sourceOriginal ? 'Untouched source original included with the keepsake' : retained ? 'Retained original, not in the guest gallery' : 'Original with an uncertain Photos result'} />
      <Text style={styles.hostBody}>{hostOriginalStatus(photo)}</Text>
      {photo.exportStatus === 'uncertain' ? <>
        <Button title="Already in Photos" testID={`host-photo-ack-${photo.id}`} light secondary disabled={hostBusy || exporting} onPress={() => requestHostPhoto('acknowledge', photo, retained)} />
        <Button title="Export this copy again" testID={`host-photo-export-${photo.id}`} disabled={hostBusy || exporting} onPress={() => requestHostPhoto('export', photo, retained)} />
      </> : <Button title={photo.exportStatus === 'saved' ? 'Exported to Photos' : 'Export this original to Photos'} testID={`host-photo-export-${photo.id}`} disabled={hostBusy || exporting || photo.exportStatus === 'saved'} onPress={() => requestHostPhoto('export', photo, retained)} />}
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
    isCameraReady: () => cameraReadyRef.current && !hostVisibleRef.current,
    async capture() {
      const options: CameraPictureOptions & { preserveFullPhoto?: boolean } = { quality: 1, skipProcessing: false, ...(fullPhotoSupported ? { preserveFullPhoto: true } : {}) };
      const photo = nativeFixtureEnabled ? await takeNativeFixturePhoto() : await camera.current?.takePictureAsync(options);
      if (!photo?.uri) throw new Error('The camera did not return a photo.');
      if (fullPhotoSupported && !nativeFixtureEnabled && !(photo as CameraCapturedPicture & { originalPreserved?: boolean }).originalPreserved) {
        setFullPhotoSupported(false);
        setMessage('Camera framing needs host attention. This captured file will still be saved.');
        diagnose(new Error('Native full-photo preservation was not acknowledged. Keep the captured file and verify the installed native build.'));
      }
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
      if (event.kind === 'preparing') {
        setTimingVisible(false); setBusy(true); setPreparing(true); setSaving(false); setActiveSlot(event.slot); setCountdown(undefined);
      } else if (event.kind === 'countdown') {
        setTimingVisible(false); setPreparing(false); setBusy(true); setSaving(false); setActiveSlot(event.slot); setCountdown(event.remaining);
      } else if (event.kind === 'saving') {
        capturePersisting.current = true; setPreparing(false); setCountdown(undefined); setSaving(true);
      } else if (event.kind === 'saved') {
        capturePersisting.current = false; adoptSession(event.session); setFailedPhoto(undefined); setSaving(false);
        void refreshQueue();
      } else if (event.kind === 'done') {
        capturePersisting.current = false; refreshInterruptedCamera(); setBusy(false); setSaving(false); setPreparing(false); setCountdown(undefined); setRetakeSlot(undefined);
        focusReview(event.retake ? event.slot : 0); setScreen('review'); updateCameraReady(false);
        if (preferencesRef.current.photosExportEnabled && sessionIsComplete(event.session)) void exportPhotos(event.session, true);
      } else if (event.kind === 'paused') {
        capturePersisting.current = false; refreshInterruptedCamera(); setBusy(false); setSaving(false); setPreparing(false); setCountdown(undefined);
      } else if (event.kind === 'error') {
        capturePersisting.current = false; refreshInterruptedCamera(); setBusy(false); setSaving(false); setPreparing(false); setCountdown(undefined); setFailedPhoto(event.photo);
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
        try {
          const prefs = await loadHostPreferences();
          if (!mounted.current) return;
          preferencesRef.current = prefs; setHostTiming(normalizeCaptureTiming(prefs)); setExportEnabled(prefs.photosExportEnabled);
          guestTimingRef.current = normalizeCaptureTiming(prefs); setGuestTiming(guestTimingRef.current);
        } catch (error) { diagnose(error); }
        if (!mounted.current) return;
        setInitialized(true);
        await refreshQueue();
        await refreshSharingConnection();
        void refreshCapability();
        void retrySharing();
      } catch (error) { diagnose(error); setMessage('Local storage needs attention. Please ask the host before starting.'); }
    })();
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const lifecycle = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      hostVisibility.current.record('lifecycle', state);
      if (state !== 'active') {
        cameraNeedsRemount.current = true; updateCameraReady(false);
        const wasTemplate = templateActive.current;
        templateEditor.current?.close(); if (wasTemplate) setScreen('review');
        lookEditor.current?.close();
        hostVisibility.current.suspend(state);
        hostVisibleRef.current = false; setHostVisible(false); setHostDecision(null);
        librarySessionRef.current = null; setLibrarySession(null); setSavedSessions([]); setLibraryMode('selected'); setHostPage('controls'); setHostMessage('');
        setTimingVisible(false); setScanningSetup(false); setPairingCode(''); runner.current?.interrupt(); screenFade.stopAnimation(); screenFade.setValue(1); countdownReveal.stopAnimation(); exposureFlash.stopAnimation(); exposureFlash.setValue(0);
      }
      else { refreshInterruptedCamera(); void retrySharing(); void refreshCapability(); }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') { setNow(Date.now()); void retrySharing(); }
    }, 15_000);
    return () => { hostVisibility.current.close(); mounted.current = false; alive = false; lookEditor.current?.close(); templateEditor.current?.close(); runner.current?.interrupt(); screenFade.stopAnimation(); countdownReveal.stopAnimation(); exposureFlash.stopAnimation(); motion.remove(); lifecycle.remove(); clearInterval(timer); };
  }, []);

  useEffect(() => { reduceMotionRef.current = reduceMotion; if (reduceMotion) { exposureFlash.stopAnimation(); exposureFlash.setValue(0); } }, [reduceMotion, exposureFlash]);

  const shareReadiness = classifyShareReadiness({ session, jobs, connection: sharingConnection, sync: sharingSync, now });
  const guestPage = shareReadiness.guestPage;
  const latestSharingFailure = jobs.flatMap(job => {
    const diagnostic = parseQueueFailure(job.lastFailure);
    return diagnostic ? [diagnostic] : [];
  }).sort((left, right) => right.at - left.at)[0];
  const sharingSetupDetail = sharingConnection === 'unpaired'
    ? 'This iPad has not completed private pairing. Uploads wait for setup; local originals are retained.'
    : sharingConnection === 'unavailable'
      ? 'Private sharing settings could not be read or validated. Check Setup; this does not establish a network outage.'
      : sharingConnection === 'checking' ? 'Checking saved private connection settings.'
        : session?.confirmed ? shareReadiness.hostMessage
          : 'Private connection settings are saved. Open Saved sessions to inspect a queued session. This does not prove server authorization.';
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
      adoptSession(value); setActiveSlot(nextPhotoSlot(value) ?? 0); updateCameraReady(false); setScreen(screenForSession(value) === 'attract' ? 'camera' : screenForSession(value));
    } catch (error) { diagnose(error); setMessage('We could not start saving a session. Please ask the host to check this iPad.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function startPhotos() {
    if (!sessionRef.current || !cameraReadyRef.current || timingVisible || runner.current?.isBusy() || actionLock.current || failedPhoto || AppState.currentState !== 'active') return;
    setMessage('');
    await runner.current?.run(sessionRef.current, { timing: { ...guestTimingRef.current }, ...(retakeSlot !== undefined ? { retakeSlot } : {}) });
    if (mounted.current && !runner.current?.isBusy()) { setBusy(false); setSaving(false); setPreparing(false); setCountdown(undefined); }
  }
  function openTiming() {
    if (runner.current?.isBusy() || actionLock.current || failedPhoto || hostVisibleRef.current || !initialized || AppState.currentState !== 'active') return;
    setTimingVisible(true);
  }
  function applyGuestTiming(value: CaptureTiming) {
    if (runner.current?.isBusy() || actionLock.current || hostVisibleRef.current || screen !== 'camera' || AppState.currentState !== 'active') return;
    guestTimingRef.current = normalizeCaptureTiming(value);
    guestTimingOverride.current = true;
    setGuestTiming({ ...guestTimingRef.current }); setTimingVisible(false);
  }
  function restoreGuestTimingDefaults() {
    guestTimingOverride.current = false;
    guestTimingRef.current = normalizeCaptureTiming(preferencesRef.current);
    setGuestTiming({ ...guestTimingRef.current }); setTimingVisible(false);
  }
  function cancelPhotos() { runner.current?.cancel(); }
  async function retrySave() {
    if (!failedPhoto || !sessionRef.current || actionLock.current || runner.current?.isBusy()) return;
    actionLock.current = true; setBusy(true); setSaving(true);
    try {
      const updated = await persistPhoto(sessionRef.current, failedPhoto);
      adoptSession(updated); setFailedPhoto(undefined); setMessage(''); setActiveSlot(nextPhotoSlot(updated) ?? failedPhoto.slot);
      if (retakeSlot !== undefined || sessionIsComplete(updated)) { focusReview(failedPhoto.slot); setRetakeSlot(undefined); updateCameraReady(false); setScreen('review'); }
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
    focusReview(slot); setScreen('review'); updateCameraReady(false);
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
    if (!value || value.confirmed || busy || exporting || lookActive.current || lookSaving.current || templateActive.current || templateSaving.current) return;
    // Read synchronous intent, never a potentially stale React render closure.
    const slot = reviewSelection.current.current();
    if (!value.shots.some((photo, index) => photoSlot(photo, index) === slot)) return;
    setRetakeSlot(slot); setActiveSlot(slot); updateCameraReady(false); setMessage(''); setScreen('camera');
  }
  function leaveRetake() {
    if (saving || failedPhoto) return;
    cancelPhotos(); setRetakeSlot(undefined); updateCameraReady(false); setScreen('review');
  }
  async function keepSession() {
    const value = sessionRef.current;
    if (!value || !sessionIsComplete(value) || actionLock.current || runner.current?.isBusy() || lookActive.current || lookSaving.current || templateActive.current || templateSaving.current) return;
    if (value.targetCount === 4) {
      if (!templateEffects || !templateEditor.current) { setMessage('Your four photos are saved. Keepsake templates need the latest native iPad build; please ask the host.'); return; }
      templateEditor.current.open(value); setScreen('template'); return;
    }
    actionLock.current = true; setBusy(true); setMessage('');
    try {
      const updated = await confirmSession(value);
      adoptSession(updated); setScreen('share'); updateCameraReady(false); await refreshQueue(); void retrySharing(true);
    } catch (error) { diagnose(error); setMessage('Your originals are safe here. Sharing setup needs a retry; keep this session open.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function nextGuests() {
    if (actionLock.current || runner.current?.isBusy() || lookActive.current || lookSaving.current || templateActive.current || templateSaving.current) return;
    actionLock.current = true; setBusy(true);
    try {
      await clearActiveSession(); restoreGuestTimingDefaults(); adoptSession(null); setJobs([]); setScreen('attract'); focusReview(0); setActiveSlot(0); setRetakeSlot(undefined); setFailedPhoto(undefined); setMessage(''); updateCameraReady(false);
      void refreshQueue();
    } catch (error) { diagnose(error); setMessage('Please ask the host to reset this screen. Your originals remain safe.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function openHost(initialPage: HostPage = 'controls') {
    if (!mounted.current) return;
    if (AppState.currentState !== 'active') {
      hostVisibility.current.record('blocked', AppState.currentState);
      setMessage('Return to the booth, then tap Host to unlock settings.'); return;
    }
    if (hostBusy || hostMutationLock.current) {
      setMessage('Complete or cancel the iPad authentication prompt, then tap Host again.'); return;
    }
    if (busy || saving || lookActive.current || lookSaving.current || templateActive.current || templateSaving.current) {
      hostVisibility.current.record('blocked', AppState.currentState);
      setMessage('Finish the current capture, save or photo editor, then tap Host. Your photos stay saved.'); return;
    }
    const ticket = hostVisibility.current.begin();
    if (ticket === null) {
      setMessage('Complete or cancel the iPad authentication prompt before trying Host again.'); return;
    }
    setHostBusy(true); setMessage('Unlock host settings with this iPad’s passcode or biometrics. Complete or cancel the iPad prompt to continue.');
    hostVisibility.current.record('requested', AppState.currentState);
    try {
      const foregroundReady = await hostVisibility.current.authenticate(ticket, async () => {
        await authenticateHost();
        hostVisibility.current.record('os-success', AppState.currentState);
      }, {
        isActive: () => mounted.current && AppState.currentState === 'active', wait: pause,
      });
      if (!foregroundReady || !mounted.current || !hostVisibility.current.finish(ticket) || AppState.currentState !== 'active') {
        throw new Error('Host settings stayed locked because the iPad left the booth or authentication did not return to the foreground. Return to the booth and tap Host to authenticate again.');
      }
      hostVisibility.current.record('foreground-ready', AppState.currentState); setMessage('');
      setTimingVisible(false); setHostTiming(normalizeCaptureTiming(preferencesRef.current)); setExportEnabled(preferencesRef.current.photosExportEnabled); updateCameraReady(false); setScanningSetup(false); setHostPage(initialPage); setHostMessage(''); hostVisibleRef.current = true; setHostVisible(true); setHostDecision(null); setPairingCode('');
      await refreshLibrary(); await refreshCapability();
      try { const connection = await loadConnection(); if (hostVisibleRef.current && hostVisibility.current.current(ticket)) setPaired(!!connection); } catch (error) { diagnose(error); }
    } catch (error) {
      hostVisibility.current.record('failed', AppState.currentState, hostAuthenticationCode(error));
      // Fixed stages/allowlisted state and result codes only. Never log the
      // native error payload, credentials, PIN, pairing code or guest content.
      console.info('[host-access-state]', hostVisibility.current.diagnostics());
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Host authentication is unavailable. Tap Host to try again.');
    }
    finally { hostVisibility.current.finish(ticket); if (mounted.current) setHostBusy(false); }
  }
  async function savePreferences() {
    if (hostMutationLock.current || hostBusy || !hostVisibleRef.current) return;
    hostMutationLock.current = true;
    const update = { ...hostTiming, photosExportEnabled: exportEnabled };
    const authorization = hostActionAuthorization('controls');
    setHostBusy(true); setHostMessage('');
    try {
      await authorization.authenticate();
      const prefs = await saveHostPreferences(update, authorization);
      preferencesRef.current = prefs; setHostTiming(normalizeCaptureTiming(prefs));
      if (!guestTimingOverride.current && !runner.current?.isBusy()) { guestTimingRef.current = normalizeCaptureTiming(prefs); setGuestTiming({ ...guestTimingRef.current }); }
      authorization.assertCurrent();
      setHostMessage('Booth defaults saved. Guest changes apply to one session only.');
    } catch (error) { reportHostActionFailure(error); }
    finally { hostMutationLock.current = false; setHostBusy(false); }
  }
  async function pairBooth(scannedCode?: string) {
    const code = (scannedCode ?? pairingCode).trim();
    if (!code || hostMutationLock.current || hostBusy || pairingLock.current) return;
    hostMutationLock.current = true;
    pairingLock.current = true;
    const authorization = hostActionAuthorization('setup');
    setScanningSetup(false); setPairingCode(''); setHostBusy(true); setHostMessage('');
    try {
      await provisionBooth(code, authorization);
      authorization.assertCurrent();
      setPairingCode(''); setPaired(true); setSharingConnection('paired'); setHostPage('controls'); setHostMessage('Private setup saved. Confirmed queued sessions can now upload.'); void retrySharing(true);
    }
    catch (error) { reportHostActionFailure(error); }
    finally { hostMutationLock.current = false; pairingLock.current = false; setPairingCode(''); setScanningSetup(false); setHostBusy(false); }
  }

  function closeHost() { hostVisibility.current.close(); hostVisibleRef.current = false; setHostVisible(false); setHostDecision(null); librarySessionRef.current = null; setLibrarySession(null); setSavedSessions([]); setPairingCode(''); setScanningSetup(false); }
  async function scanPrivateSetup() {
    setHostMessage('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setHostMessage('Camera access is needed to scan. You can paste a private setup code instead.'); return; }
    }
    setPairingCode(''); setScanningSetup(true);
  }

  function openLookEditor() {
    const value = sessionRef.current;
    if (!value || value.confirmed || !photoEffects || busy || exporting || lookSaving.current || lookActive.current) return;
    lookEditor.current?.open(value, reviewSelection.current.current());
  }
  async function applyLook() {
    if (lookSaving.current || !lookState || lookState.phase !== 'ready' || lookPreviewPresented !== lookState.previewUri || lookImageFailed) return;
    const slot = lookState.slot;
    lookSaving.current = true; setLookApplying(true);
    try {
      if (await lookEditor.current?.apply()) {
        focusReview(slot);
        const current = sessionRef.current;
        if (current && preferencesRef.current.photosExportEnabled) void exportPhotos(current, true);
      }
    } finally { lookSaving.current = false; if (mounted.current) setLookApplying(false); }
  }

  async function saveKeepsake() {
    if (templateSaving.current || !templateState || templateState.phase !== 'ready' || templatePreviewPresented !== templateState.previewUri) return;
    const sessionId = templateState.sessionId;
    templateSaving.current = true; setTemplateApplying(true);
    try {
      if (!await templateEditor.current?.save()) return;
      const current = await getLocalSession(sessionId);
      if (!current || sessionRef.current?.id !== sessionId) return;
      if (AppState.currentState !== 'active') { adoptSession(current); setScreen('review'); return; }
      actionLock.current = true; setBusy(true); setMessage('');
      const updated = await confirmSession(current);
      adoptSession(updated); setScreen('share'); updateCameraReady(false);
      await refreshQueue(); void retrySharing(true);
      if (preferencesRef.current.photosExportEnabled) void exportPhotos(updated, true, true);
    } catch (error) { diagnose(error); setScreen('review'); setMessage('Your photos remain saved. The keepsake needs a retry before sharing.'); }
    finally { actionLock.current = false; templateSaving.current = false; if (mounted.current) { setBusy(false); setTemplateApplying(false); } }
  }
  async function finishKeepsakeSave(sessionId: string) {
    if (hostMutationLock.current || hostBusy || hostOriginalLock.current) return;
    hostMutationLock.current = true;
    hostOriginalLock.current = true; setHostBusy(true);
    const authorization = hostActionAuthorization('library', sessionId);
    try {
      await authorization.authenticate();
      authorization.assertCurrent();
      const updated = await retryStagedComposites(sessionId);
      authorization.assertCurrent();
      if (updated) {
        if (sessionRef.current?.id === updated.id) adoptSession(updated);
        if (librarySessionRef.current?.id === updated.id) adoptLibrarySession(updated);
        setHostMessage(updated.stagedComposites?.length ? 'The keepsake still needs its local save completed.' : 'Keepsake save checked. Your originals are retained.');
      }
      await refreshLibrary(); authorization.assertCurrent();
    } catch (error) { reportHostActionFailure(error); }
    finally { hostMutationLock.current = false; hostOriginalLock.current = false; setHostBusy(false); }
  }
  async function exportHostPhotos(value: ActiveSession) {
    if (hostMutationLock.current || hostBusy || exportLock.current || !hostVisibleRef.current) return;
    hostMutationLock.current = true;
    const authorization = hostActionAuthorization('library', value.id);
    setHostBusy(true); setHostMessage('');
    try {
      await authorization.authenticate();
      const current = await getLocalSession(value.id);
      authorization.assertCurrent();
      if (!current) throw new Error('The local session is unavailable.');
      await exportPhotos(current, true, !!current.composite, authorization);
      authorization.assertCurrent();
    } catch (error) { reportHostActionFailure(error); }
    finally { hostMutationLock.current = false; setHostBusy(false); }
  }

  const selectedPhoto = session?.shots.find((photo, index) => photoSlot(photo, index) === focusedSlot);
  const total = session?.targetCount ?? 4;
  const pendingRepairs = indexRepairSessions([session, librarySession, ...savedSessions]);
  const queueRepairStatus = queueIndexStatus(pendingRepairs.length, invalidQueueRows);
  const decisionSession = hostDecision ? [librarySession, ...savedSessions].find(value => value?.id === hostDecision.sessionId) : null;
  const decisionPhoto = hostDecision && decisionSession ? (hostDecision.retained ? decisionSession.retakes ?? [] : [...decisionSession.shots, ...(compositeExportCapture(decisionSession) ? [compositeExportCapture(decisionSession)!] : [])]).find(photo => photo.id === hostDecision.photoId) : null;
  const lightScreen = screen === 'attract' || screen === 'share' || screen === 'template';
  return <SafeAreaView edges={screen === 'camera' ? [] : ['top', 'right', 'bottom', 'left']} style={[styles.page, lightScreen && styles.lightPage]}>
    <StatusBar hidden={screen === 'camera'} barStyle={lightScreen ? 'dark-content' : 'light-content'} />
    <Animated.View style={[styles.app, { opacity: screen === 'camera' ? 1 : screenFade }]}>
      {screen === 'attract' ? <ImageBackground source={require('./assets/attract-scene.png')} resizeMode="cover" style={styles.attract} imageStyle={styles.attractImage}>
        <View style={styles.attractShade} />
        <View style={styles.attractTop}><Text testID="wedding-identity" style={[styles.brand, styles.weddingIdentity]}>{WEDDING_IDENTITY}</Text><Pressable accessibilityRole="button" accessibilityLabel="Open host controls" onPress={() => void openHost()} disabled={hostBusy}><Text style={styles.attractHost}>Host</Text></Pressable></View>
        <View style={[styles.attractContent, landscape && styles.attractContentWide]}>
          <Text style={styles.attractEyebrow}>FOUR FRAMES. ALL YOURS.</Text>
          <Text style={[styles.attractTitle, landscape && styles.attractTitleWide]}>Come{`\n`}closer.</Text>
          <Text style={styles.attractSubtitle}>A little flash. A lot of feeling.</Text>
          <Button title={busy ? 'Opening the booth…' : 'Let’s make memories'} testID="start-session" light disabled={!initialized || busy} onPress={() => void startSession()} />
          <Text style={styles.attractFootnote}>Four photos. A keepsake that feels like you.</Text>
        </View>
      </ImageBackground> : <>
        {screen !== 'camera' && <View style={[styles.topbar, lightScreen && styles.topbarLight]}>
          <>{screen === 'share' || screen === 'template' ? <Text testID={screen === 'share' ? 'wedding-share-identity' : 'wedding-template-identity'} style={[styles.brand, styles.weddingIdentity, styles.brandDark]}>{WEDDING_IDENTITY}</Text> : <View accessible accessibilityLabel={WEDDING_IDENTITY} testID="wedding-identity-compact" style={styles.compactIdentity}><Text style={styles.brand}>{WEDDING_NAMES}</Text><Text style={styles.compactDate}>{WEDDING_DATE}</Text></View>}</>
          <Pressable accessibilityRole="button" accessibilityLabel="Open host controls" disabled={busy || hostBusy} onPress={() => void openHost()}><Text style={[styles.hostLink, lightScreen && styles.hostLinkDark]}>Host</Text></Pressable>
        </View>}
        {screen === 'camera' && session && <View style={styles.capturePage}>
          <View testID="camera-stage" style={styles.cameraStage}>
            {permission?.granted ? hostVisible ? <View style={StyleSheet.absoluteFill} /> : nativeFixtureEnabled
              ? <Image key={`fixture-${cameraEpoch}`} testID="camera-surface" source={nativeFixtureImage()} resizeMode="cover" style={StyleSheet.absoluteFill} onLoad={() => acknowledgeCameraReady(cameraEpoch)} accessibilityLabel="Synthetic native camera scene" />
              : <CameraView key={`camera-${cameraEpoch}`} testID="camera-surface" ref={camera} facing="front" mirror={false} style={StyleSheet.absoluteFill} onCameraReady={() => acknowledgeCameraReady(cameraEpoch)} onMountError={() => { if (cameraEpoch !== cameraEpochRef.current) return; updateCameraReady(false); setMessage(CAMERA_UNAVAILABLE_MESSAGE); }} />
              : <View style={styles.permission}><Text style={styles.permissionTitle}>You bring the smiles.</Text><Text style={styles.permissionBody}>We just need the camera.</Text><Button title={permission?.canAskAgain === false ? 'Open iPad Settings' : 'Enable camera'} testID="allow-camera" light onPress={() => void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())} /></View>}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: exposureFlash }]} />
            <View style={[styles.cameraTop, { top: insets.top + 16, left: insets.left + 20, right: insets.right + 20 }]}>
              <View style={styles.cameraIdentity}><Text style={styles.cameraNames}>{WEDDING_NAMES}</Text><Text style={styles.cameraDate}>{WEDDING_DATE}</Text></View>
              <Text style={styles.progressText}>{retakeSlot !== undefined ? 'RETAKE' : 'PHOTO'} {activeSlot + 1} <Text style={styles.progressMuted}>OF {total}</Text></Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Open host controls" disabled={busy || hostBusy} onPress={() => void openHost()} style={styles.cameraHost}><Text style={styles.cameraHostText}>Host</Text></Pressable>
            </View>
            {countdown !== undefined && <View pointerEvents="none" style={styles.countdownShade}><View style={styles.countdownDisc}><Animated.Text testID="capture-countdown-value" accessibilityLiveRegion="assertive" style={[styles.countdown, { opacity: countdownReveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }), transform: [{ scale: countdownReveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>{countdown}</Animated.Text></View></View>}
          </View>
          <View pointerEvents="box-none" style={[styles.captureFloating, { bottom: insets.bottom + 16, left: insets.left + 18, right: insets.right + 18 }]}>
          <GlassSurface testID="camera-action-glass" style={styles.captureIsland}>
            <View testID="camera-controls" style={[styles.captureBottom, landscape && styles.captureBottomWide]}>
            {session.shots.length > 0 && <View style={styles.captureFilmstrip}><Text style={styles.cameraSaved}>{session.shots.length} saved here</Text><Thumbnails compact reduceMotion={reduceMotion || !foreground} session={session} active={activeSlot} onSelect={!busy && !failedPhoto ? selectReview : undefined} /></View>}
            <View style={styles.captureActions}>
              {!busy && !failedPhoto && <Pressable accessibilityRole="button" accessibilityLabel={`Photo timing, ${guestTiming.firstSeconds} seconds to prepare, ${guestTiming.nextSeconds} seconds for following photos. Edit for this session.`} testID="timing-chip" onPress={openTiming} disabled={!initialized || hostBusy || hostVisible} style={styles.timingChip}><Text style={styles.timingChipText}>{guestTiming.firstSeconds}s first · {guestTiming.nextSeconds}s next</Text><Text aria-hidden style={styles.timingChipEdit}>Edit</Text></Pressable>}
              {busy ? <Button title={saving ? 'Saving original…' : preparing ? 'Pause preparation' : 'Pause countdown'} testID="cancel-countdown" secondary disabled={saving} onPress={cancelPhotos} />
                : failedPhoto ? <Button title={`Retry saving photo ${failedPhoto.slot + 1}`} testID="retry-save" onPress={() => void retrySave()} />
                : <Button title={retakeSlot !== undefined ? `Retake photo ${retakeSlot + 1}` : session.shots.length ? `Continue · photo ${(nextPhotoSlot(session) ?? 0) + 1}` : `Start ${total} photos`} testID="take-photo" disabled={!cameraReady || !initialized || timingVisible} onPress={() => void startPhotos()} />}
              {retakeSlot !== undefined && !saving && !failedPhoto && <Pressable accessibilityRole="button" style={styles.textAction} onPress={leaveRetake}><Text style={styles.mutedButtonText}>Back to review</Text></Pressable>}
              <Text testID="capture-save-status" style={styles.cameraHint}>{preparing ? `Getting the camera ready · ${session.shots.length} of ${total} saved here` : captureSaveStatus({ savedCount: session.shots.length, targetCount: total, timing: guestTiming, saving, failedSlot: failedPhoto?.slot })}</Text>
              {!busy && !failedPhoto && <Text testID="capture-framing-hint" style={styles.cameraHint}>{fullPhotoSupported ? 'Full original kept · screen preview crops the edges' : 'Preview fills the screen · check your full photo in review'}</Text>}
            </View>
            </View>
          </GlassSurface>
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
            <View style={[styles.reviewActions, landscape && styles.reviewActionsWide]}><Button title={`Retake photo ${focusedSlot + 1}`} testID="retake-photo" secondary disabled={busy || exporting || lookApplying || !!lookState} onPress={retakePhoto} />
              <Button title={lookApplying ? 'Finishing this photo…' : busy ? 'Preparing your session…' : sessionIsComplete(session) ? total === 4 ? 'Make my keepsake' : `Keep all ${total} photos` : 'Finish the session'} testID="use-photo" disabled={busy || lookApplying || !!lookState || templateApplying} onPress={sessionIsComplete(session) ? () => void keepSession() : () => { setRetakeSlot(undefined); setActiveSlot(nextPhotoSlot(session) ?? 0); updateCameraReady(false); setScreen('camera'); }} /></View>
            {photoEffects && <Pressable accessibilityRole="button" testID="choose-look" disabled={busy || exporting || lookApplying || !!lookState} onPress={openLookEditor} style={styles.lookEntry}><Text style={styles.lookEntryText}>Choose a look{selectedPhoto?.look ? ` · ${LOOKS.find(value => value.preset === selectedPhoto.look?.preset)?.title}` : ''}</Text></Pressable>}
            <Text style={styles.localSaved}>{session.shots.length} originals saved on this iPad</Text><Text style={styles.libraryStatus}>{photosStatus(session)}</Text>
            {needsPhotosExport(session) && <Pressable accessibilityRole="button" disabled={exporting} style={styles.textAction} onPress={() => void exportPhotos(session, true)}><Text style={styles.mutedButtonText}>{exporting ? 'Exporting to Photos…' : 'Save a copy to Photos'}</Text></Pressable>}
          </View>
        </View>}
        {screen === 'template' && session && (templateState ? <TemplateStudio state={templateState} session={session} landscape={landscape} saving={templateApplying} foreground={foreground} reduceMotion={reduceMotion} onRetryInspection={() => templateEditor.current?.retryInspection()} onInspect={() => templateEditor.current?.renderInspection() ?? Promise.resolve(null)} onCrops={value => templateEditor.current?.setCrops(value)} previewPresented={templatePreviewPresented === templateState.previewUri} onPreviewLoaded={uri => { if (templatePreviewRef.current === uri) setTemplatePreviewPresented(uri); }} onPreviewError={uri => templateEditor.current?.previewFailed(uri)} onLayout={value => templateEditor.current?.chooseLayout(value)} onTheme={value => templateEditor.current?.chooseTheme(value)} onSwap={(a, b) => templateEditor.current?.swapPhotos(a, b)} onCrop={(id, crop) => templateEditor.current?.setCrop(id, crop)} onSave={() => void saveKeepsake()} onBack={() => { if (!templateSaving.current) { templateEditor.current?.close(); setScreen('review'); } }} /> : <View style={styles.permission}><Text style={[styles.permissionTitle, styles.brandDark]}>Finishing your keepsake…</Text></View>)}
        {screen === 'share' && session && <ScrollView contentContainerStyle={[styles.sharePage, (landscape || width >= 760) && styles.sharePageWide]}>
          <View style={styles.shareStory}><Text style={styles.shareEyebrow}>{total === 4 ? 'FOUR FRAMES. ALL YOURS.' : total === 5 ? 'FIVE FRAMES. ALL YOURS.' : 'YOUR MOMENT. ALL YOURS.'}</Text><Text style={styles.shareTitle}>Yours to keep.</Text><Text style={styles.shareBody}>{guestPage ? session.composite ? 'Your keepsake and all four originals, in one private page.' : `Scan once. Take all ${session.shots.length} home.` : `Your ${session.shots.length} originals are safe on this iPad.`}</Text>{session.composite && <Image testID="saved-keepsake-preview" source={{ uri: session.composite.fileUri }} style={styles.keepsakePreview} resizeMode="contain" accessibilityLabel="Saved full-resolution keepsake" />}<Thumbnails reduceMotion={reduceMotion || !foreground} session={session} active={-1} dark={false} />
            <SmsShare key={session.id} session={session} jobs={jobs} onChanged={async () => { await retrySharing(); }} />
            <Text style={styles.shareLocal}>{session.shots.length} originals saved on this iPad</Text><Text style={styles.shareLibrary}>{photosStatus(session)}</Text>
            {session.composite && <Text testID="keepsake-photos-status" style={styles.shareLibrary}>{session.composite.exportStatus === 'saved' ? 'Your keepsake was exported to Photos' : session.composite.exportStatus === 'uncertain' ? 'Keepsake Photos result unconfirmed · ask the host to check' : 'Keepsake saved here · Photos copy is separate'}</Text>}
            {needsPhotosExport(session) && <Pressable accessibilityRole="button" disabled={exporting} style={styles.textAction} onPress={() => void exportPhotos(session, true)}><Text style={styles.lightTextAction}>{exporting ? 'Exporting to Photos…' : 'Save a copy to Photos'}</Text></Pressable>}
          </View>
          <View style={styles.shareCard}>{guestPage ? <View testID="guest-qr" style={styles.qrContent}><QRCode value={guestPage.url} size={224} quietZone={32} ecl="M" backgroundColor="#ffffff" color="#1e2723" /><Text style={styles.qrCaption}>YOUR PRIVATE PHOTO PAGE</Text><Text style={styles.expiry} accessibilityLabel={`Photo link expires ${expiry}`}>Available until {expiry}</Text><Text style={styles.sharePrivacy}>Anyone with the link can open your photos until then. Your originals stay private with the host afterward.</Text></View>
              : <View style={styles.offlineCard}><Text style={styles.offlineGlyph}>✓</Text><Text testID="share-link-unavailable" style={styles.offlineTitle}>{shareReadiness.title}</Text><Text testID="share-readiness-message" style={styles.sharePrivacy}>{shareReadiness.message}</Text>{shareReadiness.action === 'private-setup' || shareReadiness.action === 'check-connection'
                ? <Button title="Ask the host for sharing setup" testID="sharing-setup-host" secondary light onPress={() => void openHost('setup')} />
                : shareReadiness.action === 'retry' ? <Button title="Retry sharing" testID="retry-sharing" secondary light disabled={sharingSync === 'running'} onPress={() => void retrySharing(true)} /> : null}</View>}
            <Button title={busy ? 'Clearing this screen…' : 'Next guests'} testID="next-guest" disabled={busy} onPress={() => void nextGuests()} />
          </View>
        </ScrollView>}
      </>}
      {!!message && <View testID="booth-status-message" accessibilityLiveRegion="polite" style={[styles.message, screen === 'camera' && styles.cameraMessage, screen === 'camera' && { left: insets.left + 18, right: insets.right + 18, top: insets.top + 80 }]}><Text style={styles.messageText}>{message}</Text></View>}
      {nativeFixtureEnabled && <View style={styles.fixture}><Text testID="native-fixture-enabled" style={styles.fixtureText}>SYNTHETIC CAMERA · REAL LOCAL STORAGE · OFFLINE SHARING</Text><Text testID="native-fixture-storage" style={styles.fixtureText}>{fixtureStatus}</Text></View>}
    </Animated.View>
    <TimingSheet visible={timingVisible && foreground && !hostVisible && !busy} timing={guestTiming} defaults={normalizeCaptureTiming(preferencesRef.current)} onApply={applyGuestTiming} onClose={() => setTimingVisible(false)} reduceMotion={reduceMotion} disabled={busy} />
    <Modal visible={hostVisible && foreground} animationType={reduceMotion || !foreground ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={closeHost}>
      <SafeAreaView style={styles.hostPage}><ScrollView contentContainerStyle={styles.hostContent} keyboardShouldPersistTaps="handled">
        <View style={styles.hostHeader}><Text style={styles.hostTitle}>{hostPage === 'library' ? 'On this iPad' : hostPage === 'setup' ? 'Private setup' : 'Booth controls'}</Text><Pressable accessibilityRole="button" onPress={closeHost}><Text style={styles.closeHost}>Done</Text></Pressable></View>
        <View style={styles.hostTabs}>{(['controls', 'library', 'setup'] as HostPage[]).map(page => <Pressable key={page} accessibilityRole="button" accessibilityState={{ selected: hostPage === page }} style={[styles.hostTab, hostPage === page && styles.hostTabActive]} onPress={() => { setHostPage(page); setHostMessage(''); setScanningSetup(false); setPairingCode(''); }}><Text style={styles.hostTabText}>{page === 'controls' ? 'Controls' : page === 'library' ? 'Saved sessions' : 'Private setup'}</Text></Pressable>)}</View>
        {hostPage === 'controls' && <>
          <View style={styles.hostCard}><Text style={styles.hostSectionTitle}>Booth timing defaults</Text><Text style={styles.hostBody}>A little longer to get ready, then a quicker rhythm. Guests can adjust their own session before starting.</Text><TimingControls value={hostTiming} onChange={setHostTiming} disabled={hostBusy} testIDPrefix="host-timing" /><Text style={styles.hostSmall}>Next guests start with these saved defaults. Retakes and paused sessions use the first-photo preparation time again.</Text></View>
          <View style={styles.hostCard}><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.hostSectionTitle}>Copies in Photos</Text><Text style={styles.hostBody}>Try an additional Photos export after capture. Local originals always save first.</Text></View><Switch accessibilityLabel="Automatically export copies to Photos" value={exportEnabled} onValueChange={setExportEnabled} trackColor={{ true: '#596857' }} /></View><Text style={styles.hostSmall}>Photos permission: {libraryPermission}. Failed or denied exports keep their local originals.</Text><Pressable accessibilityRole="button" style={styles.textAction} onPress={() => void Linking.openSettings()}><Text style={styles.lightTextAction}>Open iPad permission settings</Text></Pressable></View>
          <Button title={hostBusy ? 'Saving settings…' : 'Save booth settings'} disabled={hostBusy} onPress={() => void savePreferences()} />
          <View style={styles.hostCard}><Text style={styles.hostSectionTitle}>{sharingConnection === 'paired' ? 'Private sharing setup saved' : sharingConnection === 'checking' ? 'Checking sharing setup' : 'Sharing setup needs attention'}</Text><Text testID="host-sharing-status" style={styles.hostBody}>{sharingSetupDetail}</Text><Text style={styles.hostBody}>{pendingCount} files currently listed in the upload queue. Local originals are saved independently. Older attempt counters may include configuration waits, not network requests.</Text>{latestSharingFailure && <Text testID="host-sharing-diagnostic" selectable style={styles.diagnostic}>Last recorded request issue: {latestSharingFailure.operation} · {latestSharingFailure.category}{latestSharingFailure.httpStatus ? ` · HTTP ${latestSharingFailure.httpStatus}` : ''}</Text>}{queueRepairStatus && <Text testID="host-index-repair-status" style={styles.hostWarning}>{queueRepairStatus}</Text>}{sharingConnection !== 'paired' && <Button title="Open private setup" testID="open-sharing-setup" secondary light onPress={() => { setHostMessage(''); setHostPage('setup'); }} />}<Pressable accessibilityRole="button" style={styles.textAction} onPress={() => void retrySharing(true)}><Text style={styles.lightTextAction}>{queueRepairStatus ? 'Repair index & retry sharing' : 'Refresh sharing status'}</Text></Pressable>{!!hostDiagnostic && <Text selectable style={styles.diagnostic}>{hostDiagnostic}</Text>}</View>
        </>}
        {hostPage === 'library' && <>
          <Text style={styles.hostBody}>Originals saved in this app, available without a network connection. Photos export is listed separately. Export records do not track later deletions in Photos.</Text>
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
            {!!librarySession.stagedComposites?.length && <View style={styles.hostOriginalCard}><Text style={styles.hostSectionTitle}>Kept photos · keepsake save pending</Text><Text style={styles.hostBody}>Your originals are saved. A rendered keepsake still needs its local save finished before it can be shared.</Text><Button title="Finish keepsake save" testID="host-finish-keepsake-save" disabled={hostBusy || exporting} onPress={() => void finishKeepsakeSave(librarySession.id)} /></View>}
            {libraryMode === 'retained' ? <>
              <Text style={styles.hostBody}>Earlier takes remain on this iPad. Source originals named by the current keepsake are included with it; other retakes remain private. Exporting a copy here does not change the guest page.</Text>
              {!librarySession.retakes?.length && <Text style={styles.hostSmall}>No earlier takes in this session.</Text>}
              {(librarySession.retakes ?? []).map(photo => hostPhotoCard(photo, true))}
            </> : <>
              <ScrollView horizontal pagingEnabled style={{ height: Math.min(420, height * 0.4) }}>{librarySession.shots.map(photo => <Image key={photo.id} source={{ uri: photo.fileUri }} style={{ width: Math.min(width - 96, 650), height: '100%' }} resizeMode="contain" />)}</ScrollView>
              <Text style={styles.hostBody}>{librarySession.shots.length} originals on this iPad · {photosStatus(librarySession)}</Text>
              <Button title={exporting ? 'Exporting copies…' : photosExportTitle(librarySession)} disabled={hostBusy || exporting || !needsPhotosExport(librarySession)} onPress={() => void exportHostPhotos(librarySession)} />
              {librarySession.shots.some(photo => photo.exportStatus === 'uncertain') && <Text style={styles.hostWarning}>Check each uncertain original in the Photos app before choosing an action below. No uncertain copy is retried automatically.</Text>}
              {librarySession.shots.filter(photo => photo.exportStatus === 'uncertain').map(photo => hostPhotoCard(photo, false))}
              {compositeExportCapture(librarySession) && hostPhotoCard(compositeExportCapture(librarySession)!, false, true)}
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
    <Modal visible={!!lookState && foreground} animationType={reduceMotion || !foreground ? 'none' : 'fade'} onRequestClose={() => lookEditor.current?.close()}>
      {lookState && <SafeAreaView testID="look-editor" style={styles.lookPage}>
        <View style={styles.lookHeader}><View><Text style={styles.reviewEyebrow}>PHOTO {lookState.slot + 1} OF {total}</Text><Text style={styles.reviewTitle}>Make it yours.</Text></View><Pressable accessibilityRole="button" testID="look-cancel" onPress={() => lookEditor.current?.close()} style={styles.lookCancel}><Text style={styles.lookEntryText}>Cancel</Text></Pressable></View>
        <View style={[styles.lookBody, landscape && styles.lookBodyWide]}>
          <View style={styles.lookStage}><Image key={`${lookState.previewUri}:${lookImageEpoch}`} testID="look-preview" source={{ uri: lookState.previewUri }} resizeMode="contain" style={StyleSheet.absoluteFill} onLoad={() => { if (lookPreviewRef.current === lookState.previewUri) { setLookImageFailed(false); setLookPreviewPresented(lookState.previewUri); } }} onError={() => { if (lookPreviewRef.current === lookState.previewUri) { setLookImageFailed(true); lookEditor.current?.previewFailed(lookState.previewUri); } }} accessibilityLabel={`${lookState.phase === 'error' || lookState.intensity === 0 ? 'Original' : LOOKS.find(value => value.preset === lookState.preset)?.title ?? 'Original'} photo preview`} />
            {lookState.phase === 'previewing' && <View style={styles.lookRenderBadge}><Text style={styles.savingLookText}>Preparing preview…</Text></View>}
          </View>
          <View style={[styles.lookControls, landscape && styles.lookControlsWide]}>
            <Text style={styles.lookNote}>Looks apply after capture.{`\n`}Your untouched original stays on this iPad.</Text>
            <View style={styles.lookOptions}>{LOOKS.map(look => <Pressable key={look.preset} testID={`look-preset-${look.preset}`} accessibilityRole="button" accessibilityState={{ selected: lookState.preset === look.preset, disabled: lookApplying }} disabled={lookApplying} onPress={() => lookEditor.current?.choose(look.preset, look.preset === 'original' ? 0 : lookState.intensity || 0.75)} style={[styles.lookOption, lookState.preset === look.preset && styles.lookOptionSelected]}><Text style={[styles.lookOptionText, lookState.preset === look.preset && styles.lookOptionTextSelected]}>{look.title}</Text></Pressable>)}</View>
            <View style={styles.lookStrength}><Text style={styles.lookNote}>Strength</Text><View style={styles.lookOptions}>{STRENGTHS.map(intensity => <Pressable key={intensity} testID={`look-intensity-${intensity * 100}`} accessibilityRole="button" accessibilityLabel={`Look strength ${intensity * 100} percent`} accessibilityState={{ selected: lookState.intensity === intensity, disabled: lookApplying || lookState.preset === 'original' }} disabled={lookApplying || lookState.preset === 'original'} onPress={() => lookEditor.current?.choose(lookState.preset, intensity)} style={[styles.lookOption, lookState.intensity === intensity && styles.lookOptionSelected]}><Text style={[styles.lookOptionText, lookState.intensity === intensity && styles.lookOptionTextSelected]}>{intensity * 100}%</Text></Pressable>)}</View></View>
            <Text testID="look-status" accessibilityLiveRegion="polite" style={styles.lookStatus}>{lookImageFailed ? 'This preview could not open. The original is retained.' : lookState.phase === 'ready' && lookPreviewPresented === lookState.previewUri ? 'Preview ready' : lookState.phase === 'previewing' || lookState.phase === 'ready' ? 'Preparing preview…' : lookState.phase === 'saving' ? 'Saving your full-size look…' : 'Original kept. This preview needs a retry.'}</Text>
            {(lookImageFailed || lookState.phase === 'error') && <Button testID="look-retry" title="Retry preview" secondary onPress={() => { setLookImageFailed(false); setLookImageEpoch(value => value + 1); lookEditor.current?.choose(lookState.preset, lookState.intensity); }} />}
            <Button testID="look-apply" title={lookApplying ? 'Saving your look…' : lookState.preset === 'original' || lookState.intensity === 0 ? 'Use original' : `Use ${LOOKS.find(value => value.preset === lookState.preset)?.title}`} disabled={lookState.phase !== 'ready' || lookPreviewPresented !== lookState.previewUri || lookApplying || lookImageFailed} onPress={() => void applyLook()} />
          </View>
        </View>
      </SafeAreaView>}
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
  capturePage: { flex: 1 }, cameraStage: { ...StyleSheet.absoluteFill, overflow: 'hidden', backgroundColor: '#111A14' },
  cameraTop: { zIndex: 1, position: 'absolute', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cameraIdentity: { backgroundColor: '#102219', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 10, gap: 3 }, cameraNames: { color: '#FAF7EF', fontSize: 12, fontWeight: '600', letterSpacing: 1 }, cameraDate: { color: '#D4DECF', fontSize: 10 },
  cameraHost: { minHeight: 48, minWidth: 60, padding: 14, borderRadius: 24, backgroundColor: '#102219', alignItems: 'center', justifyContent: 'center' }, cameraHostText: { color: '#F4F8EF', fontWeight: '600', fontSize: 13 },
  progressText: { backgroundColor: '#102219', color: '#fff', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 24, fontWeight: '700', letterSpacing: 1, fontSize: 13 }, progressMuted: { color: '#D9E4D3' }, cameraSaved: { color: '#E7ECDF', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  timingChip: { minHeight: 44, alignSelf: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#91A58A', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, timingChipText: { color: '#F7F4E8', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }, timingChipEdit: { color: '#D5C6A5', fontSize: 12, fontWeight: '600' },
  countdownShade: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' }, countdownDisc: { backgroundColor: '#0B1C12E6', width: 208, height: 208, borderRadius: 104, alignItems: 'center', justifyContent: 'center' }, countdown: { color: '#fff', fontSize: 156, lineHeight: 185, fontWeight: '200', fontVariant: ['tabular-nums'], textAlign: 'center' },
  permission: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 22 }, permissionTitle: { color: '#fff', fontFamily: 'Georgia', fontSize: 34, textAlign: 'center' }, permissionBody: { color: '#E4E9DB', fontSize: 19 },
  captureFloating: { position: 'absolute', alignItems: 'center' }, captureIsland: { borderRadius: 30, padding: 18, width: '100%', maxWidth: 760, overflow: 'hidden' }, captureFilmstrip: { gap: 7, alignItems: 'center' },
  captureBottom: { gap: 12, alignItems: 'center', justifyContent: 'center' }, captureBottomWide: { flexDirection: 'row', gap: 24 }, captureActions: { width: '100%', maxWidth: 440, alignItems: 'center', gap: 8, flexShrink: 1 }, cameraHint: { color: '#E0E7D9', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  thumbnailCompact: { width: 48, height: 62 }, thumbnailsCompact: { gap: 7 },
  thumbnails: { flexDirection: 'row', gap: 9, justifyContent: 'center', paddingVertical: 3 }, thumbnail: { width: 62, height: 76, borderRadius: 10, borderWidth: 1, borderColor: '#65715F', backgroundColor: '#263027', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, thumbnailLight: { backgroundColor: '#E6E8DF', borderColor: '#8B9381' }, thumbnailSelected: { borderColor: '#E8D3AA', borderWidth: 3 }, thumbnailNumber: { fontSize: 19, color: '#D5DDCD', fontVariant: ['tabular-nums'] }, thumbnailNumberLight: { color: '#4A5947' }, thumbnailTick: { position: 'absolute', right: 3, bottom: 3, width: 17, height: 17, borderRadius: 9, backgroundColor: '#FCF9EE', alignItems: 'center', justifyContent: 'center' }, thumbnailTickText: { fontSize: 11, color: '#26432A', fontWeight: '700' },
  button: { minHeight: 64, paddingHorizontal: 25, paddingVertical: 18, borderRadius: 16, backgroundColor: '#D3A06E', flexShrink: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }, buttonText: { color: '#182319', fontSize: 19, fontWeight: '700', textAlign: 'center' }, secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#899581' }, secondaryButtonText: { color: '#DCE4D4' }, lightButton: { backgroundColor: '#FAF4E8' }, lightButtonText: { color: '#172719' }, disabled: { opacity: 0.4 }, pressed: { opacity: 0.8 }, textAction: { paddingVertical: 10, paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }, mutedButtonText: { color: '#CFD7C5', fontSize: 14, textAlign: 'center' },
  reviewPageWide: { flexDirection: 'row', gap: 24 }, reviewSideRail: { width: 300, flexShrink: 0, justifyContent: 'center', gap: 14 }, reviewRailHeading: { gap: 12, width: '100%', paddingBottom: 14 },
  reviewPage: { flex: 1, paddingHorizontal: 18, paddingBottom: 12, gap: 12 }, reviewHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10 }, reviewEyebrow: { color: '#B6C2AB', fontSize: 10, letterSpacing: 2, marginBottom: 6 }, reviewTitle: { color: '#FAF7EF', fontSize: 27, fontFamily: 'Georgia' }, reviewCount: { color: '#D0D8C8', fontSize: 17, fontVariant: ['tabular-nums'] }, reviewStage: { flex: 1, minHeight: 250, borderRadius: 20, overflow: 'hidden', backgroundColor: '#080C09' }, reviewSlide: { height: '100%' }, reviewBottom: { alignItems: 'center', gap: 8 }, reviewActions: { width: '100%', gap: 10, maxWidth: 700, flexDirection: 'row' }, reviewActionsWide: { flexDirection: 'column', width: '100%' }, localSaved: { color: '#E8EDDF', fontSize: 13, fontWeight: '600', marginTop: 2 }, libraryStatus: { color: '#B8C0B0', fontSize: 12, textAlign: 'center' },
  sharePage: { flexGrow: 1, padding: 30, gap: 26, alignItems: 'center', justifyContent: 'center' }, sharePageWide: { flexDirection: 'row', gap: 48, paddingHorizontal: 46 }, shareStory: { alignItems: 'center', gap: 17, flexShrink: 1, maxWidth: 510 }, shareEyebrow: { fontSize: 11, color: '#5A6954', letterSpacing: 1, fontWeight: '700', textAlign: 'center' }, shareTitle: { fontSize: 46, fontFamily: 'Georgia', color: '#263426', textAlign: 'center' }, shareBody: { fontSize: 17, color: '#53614D', lineHeight: 26, textAlign: 'center', maxWidth: 430 }, shareLocal: { color: '#2F482E', fontWeight: '700', fontSize: 14, marginTop: 4 }, shareLibrary: { color: '#53614D', fontSize: 13, textAlign: 'center' }, shareCard: { width: '100%', maxWidth: 350, backgroundColor: '#fff', padding: 22, borderRadius: 24, gap: 20 }, qrContent: { alignItems: 'center', gap: 12 }, qrCaption: { color: '#394F35', fontSize: 10, letterSpacing: 1.8, fontWeight: '700' }, expiry: { color: '#34462F', fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'center' }, sharePrivacy: { color: '#586451', fontSize: 12, lineHeight: 19, textAlign: 'center' }, offlineCard: { alignItems: 'center', gap: 17, paddingVertical: 12 }, offlineGlyph: { color: '#385B34', fontSize: 38 }, offlineTitle: { fontSize: 28, fontFamily: 'Georgia', color: '#2D452A', textAlign: 'center' }, lightTextAction: { color: '#385731', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  message: { padding: 16, backgroundColor: '#652E25', marginHorizontal: 18, marginBottom: 12, borderRadius: 12 }, cameraMessage: { position: 'absolute', margin: 0, marginHorizontal: 0, marginBottom: 0, zIndex: 3 }, messageText: { color: '#fff', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  hostPage: { flex: 1, backgroundColor: '#F3F1E9' }, hostContent: { padding: 28, gap: 20, maxWidth: 850, width: '100%', alignSelf: 'center' }, hostHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, hostTitle: { fontSize: 30, color: '#253D25', fontWeight: '600' }, closeHost: { color: '#385731', fontSize: 18, padding: 12 }, hostTabs: { flexDirection: 'row', gap: 8 }, hostTab: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#E6E9DE' }, hostTabActive: { backgroundColor: '#D2DDC7' }, hostTabText: { color: '#2E482B', fontSize: 14, textAlign: 'center', fontWeight: '600' }, hostCard: { backgroundColor: '#fff', borderRadius: 20, padding: 22, gap: 16 }, hostSectionTitle: { color: '#263D25', fontSize: 20, fontWeight: '600' }, hostBody: { color: '#53634D', fontSize: 15, lineHeight: 23 }, hostSmall: { color: '#5E6A57', fontSize: 13, lineHeight: 20 }, timerOptions: { flexDirection: 'row', gap: 9 }, timerOption: { flex: 1, minHeight: 61, borderWidth: 1, borderColor: '#ACB99E', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, timerOptionSelected: { backgroundColor: '#314D2D', borderColor: '#314D2D' }, timerNumber: { fontSize: 22, fontWeight: '600', color: '#314D2D' }, timerNumberSelected: { color: '#fff' }, switchRow: { flexDirection: 'row', gap: 20, alignItems: 'center' }, switchText: { flex: 1, gap: 8 }, pairingInput: { borderWidth: 1, borderColor: '#9BA78E', borderRadius: 12, minHeight: 60, padding: 17, color: '#263D25', backgroundColor: '#FCFDF8', fontSize: 18 }, hostNotice: { color: '#395B31', fontSize: 16, lineHeight: 23 }, diagnostic: { color: '#733C2B', fontSize: 12, lineHeight: 19 }, libraryStrip: { flexDirection: 'row', gap: 7 }, libraryThumb: { width: 62, height: 76, borderRadius: 9 },
  hostWarning: { color: '#713D20', fontSize: 14, lineHeight: 22 }, hostOriginalCard: { borderWidth: 1, borderColor: '#C8D0BF', borderRadius: 16, padding: 16, gap: 14, backgroundColor: '#F8FAF3' }, hostOriginalPreview: { width: '100%', height: 260, borderRadius: 10, backgroundColor: '#172219' }, hostDecisionOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#102117D9', zIndex: 5, alignItems: 'center', justifyContent: 'center', padding: 24 }, hostDecisionCard: { width: '100%', maxWidth: 540, borderRadius: 22, padding: 24, gap: 18, backgroundColor: '#fff' }, hostDecisionPreview: { width: '100%', height: 170, backgroundColor: '#172219', borderRadius: 10 },
  setupScanner: { height: 330, backgroundColor: '#172219', borderRadius: 18, overflow: 'hidden' },
  fixture: { backgroundColor: '#fff7df', padding: 7 }, fixtureText: { color: '#47391C', fontSize: 10 },
  lookEntry: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }, lookEntryText: { color: '#E6DEC6', fontSize: 16, fontWeight: '600' },
  keepsakePreview: { width: '100%', maxWidth: 320, height: 300, backgroundColor: '#E9E3D7', borderRadius: 14 },
  lookPage: { flex: 1, backgroundColor: '#101512' }, lookHeader: { minHeight: 76, paddingHorizontal: 26, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, lookCancel: { minWidth: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  lookBody: { flex: 1, padding: 18, gap: 18 }, lookBodyWide: { flexDirection: 'row' }, lookStage: { flex: 1, minHeight: 200, backgroundColor: '#070D09', borderRadius: 16, overflow: 'hidden' }, lookControls: { gap: 14, width: '100%', maxWidth: 740, alignSelf: 'center' }, lookControlsWide: { width: 322, alignSelf: 'center' },
  lookOptions: { flexDirection: 'row', gap: 6 }, lookOption: { minHeight: 48, flex: 1, borderRadius: 13, borderWidth: 1, borderColor: '#879580', justifyContent: 'center', alignItems: 'center', paddingVertical: 11 }, lookOptionSelected: { backgroundColor: '#E8D7B6', borderColor: '#E8D7B6' }, lookOptionText: { color: '#D7E1CD', fontSize: 13, fontWeight: '600' }, lookOptionTextSelected: { color: '#203423' }, lookNote: { color: '#D0D9C7', fontSize: 13, lineHeight: 21, textAlign: 'center' }, lookStrength: { gap: 8 }, lookStatus: { color: '#E4E8D8', fontSize: 13, lineHeight: 21, textAlign: 'center', minHeight: 24 }, lookRenderBadge: { position: 'absolute', alignSelf: 'center', bottom: 18, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#102219', borderRadius: 20 }, savingLookText: { color: '#fff', fontSize: 14 },
});
