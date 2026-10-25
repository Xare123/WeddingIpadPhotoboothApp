import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, AppState, Easing, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';
import type { QueueJob } from '@wedding-booth/core';
import { clearConnection, loadConnection, saveConnection } from './src/config';
import { qrForJob } from './src/sharing';
import { queueMockShare } from './src/recipients';
import { authenticateHost } from './src/host-auth';
import { captureTransition, createCaptureState } from './src/capture-state';
import {
  confirmCapture, getActiveCapture, preserveCapture, recoverPreservedPhotos,
  setActiveCapture, store, type ActiveCapture,
} from './src/storage';
import { retryPendingNow, syncPending } from './src/sync';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function App() {
  const { width, height } = useWindowDimensions();
  const landscape = width > height * 1.15;
  const camera = useRef<CameraView>(null);
  const flow = useRef(createCaptureState());
  const reveal = useRef(new Animated.Value(1)).current;
  const countdownScale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const mounted = useRef(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capture, setCapture] = useState<ActiveCapture | null>(null);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [countdown, setCountdown] = useState<number>();
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [origin, setOrigin] = useState('');
  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => { if (alive) setReduceMotion(enabled); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; listener.remove(); };
  }, []);

  function cancelCountdown() {
    if (flow.current.phase !== 'countdown') return;
    flow.current = captureTransition(flow.current, { type: 'interrupt' });
    setCountdown(undefined);
    setBusy(false);
  }

  async function refresh() {
    const list = await store.list();
    if (mounted.current) { setJobs(list); setNow(Date.now()); }
  }
  async function retry(immediate = false) {
    await (immediate ? retryPendingNow() : syncPending());
    await refresh();
  }
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        await recoverPreservedPhotos();
        const active = await getActiveCapture();
        if (!mounted.current) return;
        setCapture(active);
        if (active) flow.current = captureTransition(flow.current, { type: 'restore', photoId: active.id, confirmed: active.confirmed });
        await refresh();
        setInitialized(true);
        // A Keychain/configuration problem must never prevent offline capture.
        try {
          const config = await loadConnection();
          setConfigured(!!config);
          setOrigin(config?.origin ?? '');
        } catch {
          setMessage('Sharing settings could not open. You can still take photos offline.');
        }
        void retry().catch(() => setMessage('Your photo is saved on this iPad. Sharing will retry.'));
      } catch {
        setMessage('Local photo storage could not open. Ask the booth host for help.');
      }
    })();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void retry().catch(() => setMessage('Your photo is saved on this iPad. Sharing will retry.'));
      } else {
        // A countdown interrupted by another app must never take a surprise photo.
        cancelCountdown();
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void retry().catch(() => {});
    }, 15_000);
    return () => {
      mounted.current = false;
      flow.current = captureTransition(flow.current, { type: 'interrupt' });
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  const currentJob = capture?.confirmed ? jobs.find(job => job.kind === 'upload' && job.photoId === capture.id) : undefined;
  const qr = qrForJob(currentJob, now);
  const currentShare = capture?.confirmed ? jobs.find(job => job.kind === 'share' && job.sessionId === capture.id) : undefined;
  const pendingCount = jobs.filter(job => job.kind === 'upload' && job.state === 'pending').length;

  useEffect(() => {
    if (!currentJob?.guestExpiresAt || currentJob.guestExpiresAt <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(currentJob.guestExpiresAt - Date.now() + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [currentJob?.guestExpiresAt]);

  useEffect(() => {
    if (qr && capture) flow.current = captureTransition(flow.current, { type: 'ready', photoId: capture.id, guestUrl: qr });
    reveal.stopAnimation();
    if (reduceMotion) { reveal.setValue(1); return; }
    reveal.setValue(0);
    const animation = Animated.timing(reveal, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [capture?.id, capture?.confirmed, qr, reduceMotion, reveal]);

  useEffect(() => {
    countdownScale.stopAnimation();
    if (reduceMotion || countdown === undefined) { countdownScale.setValue(1); return; }
    countdownScale.setValue(0.92);
    const animation = Animated.timing(countdownScale, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [countdown, reduceMotion, countdownScale]);

  async function takePhoto() {
    if (busy || !cameraReady || !initialized || capture) return;
    const started = captureTransition(flow.current, { type: 'start' });
    if (started === flow.current) return;
    flow.current = started;
    const attempt = started.attempt;
    setBusy(true);
    setMessage('');
    try {
      while (flow.current.phase === 'countdown' && flow.current.attempt === attempt) {
        setCountdown(flow.current.remaining);
        await pause(1_000);
        if (AppState.currentState !== 'active') flow.current = captureTransition(flow.current, { type: 'interrupt' });
        if (attempt !== flow.current.attempt) return;
        flow.current = captureTransition(flow.current, { type: 'tick', attempt });
      }
      if (flow.current.phase !== 'saving' || flow.current.attempt !== attempt) return;
      setCountdown(undefined);
      const photo = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo?.uri) throw new Error('No photo');
      const saved = await preserveCapture(randomUUID(), photo.uri);
      flow.current = captureTransition(flow.current, { type: 'saved', attempt, photoId: saved.id });
      if (mounted.current) { setCapture(saved); setCameraReady(false); }
    } catch {
      flow.current = captureTransition(flow.current, { type: 'failed', attempt });
      if (mounted.current) {
        setBusy(false);
        setMessage('Could not save your photo. Ask the booth host to check storage, then try again.');
      }
    } finally {
      // A canceled timer may finish after a new countdown has started. Only
      // the current attempt owns these UI flags.
      if (mounted.current && flow.current.attempt === attempt) { setBusy(false); setCountdown(undefined); }
    }
  }

  async function usePhoto() {
    if (!capture || capture.confirmed || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await confirmCapture(capture);
      flow.current = captureTransition(flow.current, { type: 'confirm', photoId: saved.id });
      setCapture(saved);
      await refresh();
      void retry(true).catch(() => setMessage('Saved on this iPad. Sharing will retry when the connection returns.'));
    } catch {
      // The confirmed-file journal can recover even if the database write failed.
      try {
        await recoverPreservedPhotos();
        const recovered = await getActiveCapture();
        setCapture(recovered);
        if (recovered) flow.current = captureTransition(flow.current, { type: 'restore', photoId: recovered.id, confirmed: recovered.confirmed });
        await refresh();
      } catch { /* Keep the current preview visible for the host. */ }
      setMessage('Your original remains on this iPad. Ask the booth host to check storage before continuing.');
    } finally { setBusy(false); }
  }

  async function startAgain() {
    if (busy) return;
    setBusy(true);
    try {
      // Clear the persisted guest selection before the UI. Pending uploads and
      // originals remain durable, while the next guest sees no previous QR.
      await setActiveCapture(null);
      flow.current = captureTransition(flow.current, { type: 'reset' });
      setCapture(null);
      setCameraReady(false);
      setMessage('');
      setPhone('');
      setConsent(false);
      setPhoneVisible(false);
      setShareMessage('');
    } catch { setMessage('Could not reset this session. Ask the booth host for help.'); }
    finally { setBusy(false); }
  }

  async function openSettings() {
    if (busy || shareBusy || settingsBusy) return;
    setSettingsBusy(true);
    try { await authenticateHost(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Host authentication is unavailable.'); setSettingsBusy(false); return; }
    setSettingsBusy(false);
    setToken('');
    setSettingsMessage('');
    try {
      const config = await loadConnection();
      setOrigin(config?.origin ?? '');
      setConfigured(!!config);
    } catch { setSettingsMessage('Could not read the device connection settings.'); }
    setSettingsVisible(true);
  }

  async function saveSettings() {
    setSettingsBusy(true);
    try {
      await authenticateHost();
      // An empty token keeps the existing credential only for the same origin.
      const existing = await loadConnection().catch(() => null);
      const accessToken = token.trim() || (origin.trim().replace(/\/$/, '') === existing?.origin ? existing.token : '');
      await saveConnection(origin, accessToken);
      setConfigured(true);
      setToken('');
      setSettingsVisible(false);
      void retry(true).catch(() => setMessage('Connection saved. Photos remain on this iPad while sharing retries.'));
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Could not save connection settings.');
    } finally { setSettingsBusy(false); }
  }

  async function submitMockShare() {
    if (!__DEV__ || !capture?.confirmed || shareBusy || currentShare) return;
    setShareBusy(true);
    setShareMessage('');
    try {
      await queueMockShare(capture, phone, consent);
      setPhone('');
      setConsent(false);
      setPhoneVisible(false);
      await refresh();
      void retry(true).catch(() => setShareMessage('Your test request is queued. No text was sent.'));
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Could not save the sharing test. Please try again.');
    } finally { setShareBusy(false); }
  }

  const heading = !capture ? 'A moment to keep' : !capture.confirmed ? 'Made for remembering' : qr ? 'Take your memory home' : 'Your moment is safe';
  const description = !capture ? 'Gather close, find your light, and let the good times show.'
    : !capture.confirmed ? 'Love this one? Keep it, or step back in for another.'
    : qr ? 'Scan with your phone to open your private photo page.'
    : 'Your original is saved on this iPad. You can keep celebrating while sharing catches up.';

  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={[styles.content, landscape && styles.wideContent]} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}>
        <Text style={styles.eyebrow}>THE WEDDING PHOTOBOOTH</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open host settings" disabled={busy || shareBusy || settingsBusy} onPress={() => void openSettings()} hitSlop={12}>
          <Text style={styles.hostLink}>Host settings</Text>
        </Pressable>
      </View>
      <View style={styles.header}>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.body}>{description}</Text>
      </View>
      <Animated.View style={[styles.booth, landscape && styles.boothWide, { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }] }]}>
        <View style={[styles.preview, landscape && { flex: 1, aspectRatio: undefined, height: Math.max(300, height - 350) }, !landscape && capture?.confirmed && { aspectRatio: undefined, height: Math.min(390, height * 0.31) }]}>
          {capture ? <Image source={{ uri: capture.fileUri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Your captured wedding photo" />
            : permission?.granted ? <CameraView ref={camera} facing="front" mirror={false}
                onCameraReady={() => setCameraReady(true)}
                onMountError={() => { setCameraReady(false); setMessage('Front camera unavailable. Ask the booth host to check this iPad.'); }}
                style={StyleSheet.absoluteFill} />
            : <View style={styles.permissionBox}>
                <Text style={styles.permissionTitle}>A little camera magic</Text>
                <Text style={styles.permissionText}>Allow the front camera to take your photo.</Text>
                <Pressable accessibilityRole="button" style={styles.lightButton} onPress={() => void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())}>
                  <Text style={styles.darkButtonText}>{permission?.canAskAgain === false ? 'Open iPad settings' : 'Allow camera'}</Text>
                </Pressable>
              </View>}
          {countdown !== undefined && <View style={styles.countdownOverlay}><Animated.Text accessibilityLiveRegion="assertive" style={[styles.countdown, { transform: [{ scale: countdownScale }] }]}>{countdown}</Animated.Text><Text style={styles.countdownLabel}>Make it a memory</Text></View>}
          {!capture && permission?.granted && countdown === undefined && <View style={styles.cameraLabel}><Text style={styles.cameraLabelText}>FRONT CAMERA · FIND YOUR PEOPLE</Text></View>}
        </View>
        <View style={[styles.actions, landscape && styles.sideActions]}>
          {!capture ? <>
            <Text style={styles.step}>01 / MAKE A MEMORY</Text>
            <Pressable accessibilityRole="button" disabled={!cameraReady || busy || !initialized} style={[styles.button, (!cameraReady || busy || !initialized) && styles.disabled]} onPress={() => void takePhoto()}>
              <Text style={styles.buttonText}>{countdown ? 'Get ready…' : busy ? 'Saving your photo…' : 'Take our photo'}</Text>
            </Pressable>
            {countdown !== undefined && <Pressable accessibilityRole="button" accessibilityLabel="Cancel countdown" style={styles.secondaryButton} onPress={cancelCountdown}><Text style={styles.secondaryText}>Cancel countdown</Text></Pressable>}
            <Text style={styles.note}>A 3-second countdown. A memory for a lifetime.</Text>
          </> : !capture.confirmed ? <>
            <Text style={styles.step}>02 / PICK YOUR FAVORITE</Text>
            <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => void usePhoto()}><Text style={styles.buttonText}>{busy ? 'Keeping your photo…' : 'Use this photo'}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.secondaryButton} onPress={() => void startAgain()}><Text style={styles.secondaryText}>Retake photo</Text></Pressable>
            <Text style={styles.note}>Sharing starts only when you choose “Use this photo”.</Text>
          </> : <>
            <Text style={styles.step}>03 / KEEP THE GOOD TIMES</Text>
            {qr ? <View style={styles.qrCard}>
              <QRCode value={qr} size={landscape ? 208 : 224} backgroundColor="#ffffff" color="#1e2723" quietZone={12} />
              <Text style={styles.qrCaption}>YOUR PRIVATE PHOTO PAGE</Text>
              <Text style={styles.smallNote}>Anyone with this link can open the photo until it expires.</Text>
            </View> : <View style={styles.savedCard}>
              <Text style={styles.savedIcon}>✓</Text>
              <Text style={styles.savedTitle}>Saved on this iPad</Text>
              <Text style={styles.note}>{currentJob?.state === 'complete' ? (currentJob.guestExpiresAt && currentJob.guestExpiresAt <= now ? 'This sharing link has expired. Ask the host about your saved original.' : 'Local emulator test complete. Configure a public HTTPS API to show a guest QR.') : configured ? 'Preparing your photo page. The QR appears only after the server confirms it is ready.' : 'Sharing is offline. Ask the host to connect the booth to enable a photo link.'}</Text>
            </View>}
            {!qr && currentJob?.state !== 'complete' && <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void retry(true).catch(() => setMessage('Saved on this iPad. Sharing will retry.'))}><Text style={styles.secondaryText}>Retry sharing</Text></Pressable>}
            {__DEV__ && <>
            {currentShare ? <Text accessibilityLiveRegion="polite" style={styles.note}>{currentShare.state === 'mocked' ? 'Phone-sharing simulation complete. No text was sent.' : 'Phone-sharing test queued. No text was sent.'}</Text> : <>
              <Pressable accessibilityRole="button" onPress={() => { setPhoneVisible(!phoneVisible); setPhone(''); setConsent(false); setShareMessage(''); }} style={styles.phoneToggle}><Text style={styles.hostLink}>{phoneVisible ? 'Close sharing test' : 'Test phone sharing · no SMS'}</Text></Pressable>
              {phoneVisible && <View style={styles.phoneForm}>
                <Text style={styles.note}>Use a fictional test number only. No text messages will be sent.</Text>
                <TextInput accessibilityLabel="International phone number for simulation" value={phone} onChangeText={setPhone} placeholder="+1 555 123 4567" keyboardType="phone-pad" autoComplete="tel" style={styles.phoneInput} />
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={styles.consentRow}>
                  <Text style={styles.check}>{consent ? '☑' : '☐'}</Text><Text style={styles.consentText}>I agree to use this test number for this simulation.</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!consent || shareBusy} style={[styles.secondaryButton, (!consent || shareBusy) && styles.disabled]} onPress={() => void submitMockShare()}><Text style={styles.secondaryText}>{shareBusy ? 'Saving test…' : 'Queue simulated share'}</Text></Pressable>
              </View>}
            </>}
            {!!shareMessage && <Text accessibilityLiveRegion="polite" style={styles.message}>{shareMessage}</Text>}
            </>}
            <Pressable accessibilityRole="button" disabled={busy || shareBusy} style={[styles.button, (busy || shareBusy) && styles.disabled]} onPress={() => void startAgain()}><Text style={styles.buttonText}>Next guest</Text></Pressable>
            {!qr && <Text style={styles.note}>The host can recover your original. Starting the next guest clears this screen.</Text>}
          </>}
          {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
        </View>
      </Animated.View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>{pendingCount ? `${pendingCount} confirmed ${pendingCount === 1 ? 'photo' : 'photos'} waiting to share · originals stay on this iPad` : 'Made with love · originals stay on this iPad'}</Text>
        <Text style={styles.footerText}>No text messages are sent.</Text>
      </View>
    </ScrollView>
    <Modal visible={settingsVisible} animationType={reduceMotion ? "none" : "slide"} presentationStyle="pageSheet" onRequestClose={() => setSettingsVisible(false)}>
      <SafeAreaView style={styles.page}>
        <ScrollView contentContainerStyle={styles.settings} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>BOOTH HOST</Text>
          <Text style={styles.settingsTitle}>Connection settings</Text>
          <Text style={styles.body}>Configure the booth’s authenticated API to create guest photo links. Leaving this disconnected keeps confirmed photos queued on the iPad.</Text>
          <Text style={styles.fieldLabel}>HTTPS API origin</Text>
          <TextInput accessibilityLabel="HTTPS API origin" value={origin} onChangeText={setOrigin} placeholder="https://photos.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
          <Text style={styles.fieldLabel}>Booth access token</Text>
          <TextInput accessibilityLabel="Booth access token" value={token} onChangeText={setToken} placeholder={configured ? 'Saved securely · enter to replace' : 'Enter the operator-provided token'} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="none" style={styles.input} />
          <Text style={styles.note}>Credentials are stored in this iPad’s Keychain. No credentials are bundled with the app. Use a token issued for this booth.</Text>
          {!!settingsMessage && <Text accessibilityLiveRegion="polite" style={styles.message}>{settingsMessage}</Text>}
          <Pressable accessibilityRole="button" disabled={settingsBusy} style={[styles.button, settingsBusy && styles.disabled]} onPress={() => void saveSettings()}><Text style={styles.buttonText}>Save & retry sharing</Text></Pressable>
          {configured && <Pressable accessibilityRole="button" disabled={settingsBusy} style={styles.secondaryButton} onPress={() => {
            setSettingsBusy(true);
            void authenticateHost().then(() => clearConnection()).then(() => { setConfigured(false); setOrigin(''); setToken(''); setSettingsMessage('Disconnected. Photos remain on this iPad.'); })
              .catch(error => setSettingsMessage(error instanceof Error ? error.message : 'Could not disconnect. Try again.')).finally(() => setSettingsBusy(false));
          }}><Text style={styles.secondaryText}>Disconnect sharing</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={settingsBusy} style={styles.secondaryButton} onPress={() => { setToken(''); setSettingsVisible(false); }}><Text style={styles.secondaryText}>Back to booth</Text></Pressable>
          <Text style={styles.smallNote}>Native iPad MVP · one confirmed photo per guest session. Retakes remain local. Phone sharing is simulated; no SMS is sent.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F6EFE4' },
  content: { padding: 28, gap: 24, width: '100%', maxWidth: 1120, alignSelf: 'center', flexGrow: 1 },
  wideContent: { maxWidth: 1440, paddingHorizontal: 34, gap: 18 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  eyebrow: { fontSize: 11, letterSpacing: 2.5, color: '#6E6557', fontWeight: '600' },
  hostLink: { fontSize: 13, color: '#6E6557', paddingVertical: 8 },
  header: { gap: 10, alignItems: 'center' },
  title: { fontSize: 42, textAlign: 'center', color: '#3B342B', fontFamily: 'Georgia' },
  body: { fontSize: 17, lineHeight: 25, textAlign: 'center', color: '#62594B', maxWidth: 680 },
  booth: { gap: 24, alignItems: 'center' },
  boothWide: { flexDirection: 'row', alignItems: 'center' },
  preview: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#3B342B', borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  actions: { width: '100%', alignItems: 'center', gap: 14 },
  sideActions: { width: 306, flexShrink: 0 },
  step: { fontSize: 11, letterSpacing: 2, color: '#8A7654', fontWeight: '600', textAlign: 'center' },
  button: { backgroundColor: '#9A4F32', paddingVertical: 21, paddingHorizontal: 26, borderRadius: 12, minHeight: 68, width: '100%', maxWidth: 500, justifyContent: 'center' },
  buttonText: { color: '#FBF6EC', fontSize: 21, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  secondaryButton: { borderWidth: 1, borderColor: '#CEBFA6', paddingVertical: 17, paddingHorizontal: 20, borderRadius: 12, minHeight: 58, width: '100%', maxWidth: 500, justifyContent: 'center' },
  secondaryText: { fontSize: 18, color: '#9A4F32', textAlign: 'center', fontWeight: '500' },
  note: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: '#736958', maxWidth: 560 },
  smallNote: { fontSize: 12, lineHeight: 18, textAlign: 'center', color: '#736958', maxWidth: 380 },
  message: { fontSize: 15, textAlign: 'center', color: '#9A4F32', lineHeight: 23 },
  permissionBox: { padding: 28, gap: 18, alignItems: 'center' },
  permissionTitle: { color: '#FBF6EC', fontSize: 28, fontFamily: 'Georgia', textAlign: 'center' },
  permissionText: { color: '#E8DFD1', fontSize: 17, textAlign: 'center' },
  lightButton: { backgroundColor: '#FBF6EC', paddingHorizontal: 24, paddingVertical: 18, borderRadius: 12, minHeight: 60 },
  darkButtonText: { color: '#3B342B', fontSize: 19, fontWeight: '600' },
  cameraLabel: { position: 'absolute', bottom: 20, backgroundColor: '#3B342Bbb', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  cameraLabelText: { color: '#FBF6EC', fontSize: 10, letterSpacing: 2 },
  countdownOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#15251d55', alignItems: 'center', justifyContent: 'center' },
  countdown: { color: '#fff', fontSize: 144, fontFamily: 'Georgia' },
  countdownLabel: { color: '#fff', fontSize: 20, marginTop: 8 },
  savedCard: { padding: 22, gap: 12, backgroundColor: '#F0E7D8', borderRadius: 16, width: '100%', maxWidth: 500, alignItems: 'center' },
  savedIcon: { fontSize: 34, color: '#9A4F32' },
  savedTitle: { fontSize: 23, color: '#9A4F32', fontFamily: 'Georgia', textAlign: 'center' },
  qrCard: { backgroundColor: '#fff', padding: 14, borderRadius: 16, gap: 10, alignItems: 'center', maxWidth: 300 },
  qrCaption: { fontSize: 10, letterSpacing: 1.5, color: '#9A4F32', fontWeight: '600' },
  footer: { gap: 6, alignItems: 'center', marginTop: 'auto', paddingTop: 10 },
  footerText: { fontSize: 12, color: '#8A7F6D', textAlign: 'center' },
  phoneToggle: { paddingVertical: 2, minHeight: 44, justifyContent: 'center' },
  phoneForm: { width: '100%', gap: 12, maxWidth: 500 },
  phoneInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#CEBFA6', borderRadius: 10, padding: 14, fontSize: 17, minHeight: 54, color: '#3B342B' },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 6 },
  check: { fontSize: 28, color: '#9A4F32' },
  consentText: { fontSize: 13, lineHeight: 19, color: '#62594B', flex: 1 },
  settings: { padding: 32, gap: 18, maxWidth: 680, width: '100%', alignSelf: 'center' },
  settingsTitle: { fontSize: 34, color: '#3B342B', fontFamily: 'Georgia' },
  fieldLabel: { color: '#9A4F32', fontSize: 16, marginTop: 6, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#CEBFA6', borderRadius: 12, padding: 18, fontSize: 17, minHeight: 60, color: '#3B342B' },
});
