import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { QueueJob } from '@wedding-booth/core';
import { editPhone } from './phone-pad';
import { loadConnection } from './config';
import { queueSessionShare } from './recipients';
import { smsCapability, smsOutcome } from './sms-state';
import { sessionGuestPage } from './sharing';
import type { ActiveSession } from './storage';

export function SmsShare({ session, jobs, onChanged, enabled = true }: {
  enabled?: boolean; session: ActiveSession; jobs: QueueJob[]; onChanged(): Promise<void>;
}) {
  const [available, setAvailable] = useState(false);
  const [visible, setVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phoneSelection, setPhoneSelection] = useState({ start: 0, end: 0 });
  const selection = useRef({ start: 0, end: 0 });
  const sending = useRef(false);
  const mounted = useRef(true);
  const share = jobs.find(job => job.kind === 'share' && job.sessionId === session.id);
  const outcome = smsOutcome(share);
  const ready = [4, 5].includes(session.targetCount) && session.shots.length === session.targetCount && !!sessionGuestPage(session, jobs);

  useEffect(() => {
    if (!enabled) { setVisible(false); setPhone(''); setConsent(false); setError(''); selection.current = { start: 0, end: 0 }; setPhoneSelection(selection.current); }
  }, [enabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { setVisible(false); setPhone(''); setConsent(false); setError(''); }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const config = await loadConnection();
        if (!config || !active) return;
        const response = await fetch(`${config.origin}/health`, { signal: controller.signal });
        if (response.ok) {
          const enabled = smsCapability(await response.json());
          if (active) setAvailable(enabled);
        }
      } catch { /* Sharing availability never blocks capture or QR downloads. */ }
    })();
    return () => { active = false; mounted.current = false; controller.abort(); };
  }, [session.id]);

  function dismiss() { setVisible(false); setPhone(''); setConsent(false); setError(''); }
  async function submit() {
    if (!enabled || sending.current || !consent || !ready || !available) return;
    sending.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try {
      await queueSessionShare(session, phone, consent);
      setPhone(''); setConsent(false);
      await onChanged();
      if (mounted.current) setVisible(false);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Text sharing could not save. Please use the QR code.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!enabled) return null;
  if (outcome) return <Text accessibilityLiveRegion="polite" style={styles.outcome}>{outcome}</Text>;
  if (!available || !ready) return null;
  return <>
    <Pressable testID="sms-entry" accessibilityRole="button" accessibilityLabel={`Text a link to these ${session.shots.length} photos`} style={styles.entry} onPress={() => setVisible(true)}>
      <Text style={styles.entryText}>Text me the link</Text>
    </Pressable>
    <Modal testID="sms-modal" visible={visible} transparent animationType="none" presentationStyle="overFullScreen" supportedOrientations={['portrait', 'portrait-upside-down', 'landscape']} onRequestClose={dismiss}>
      <View style={styles.backdrop}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.eyebrow}>A link to keep</Text>
          <Text style={styles.title}>Your photos, by text.</Text>
          <Text style={styles.copy}>One text with this private photo page. The QR code works without sharing a phone number.</Text>
          <TextInput value={phone} onChangeText={value => { setPhone(value); selection.current = { start: value.length, end: value.length }; setPhoneSelection(selection.current); }} selection={phoneSelection} onSelectionChange={event => { selection.current = event.nativeEvent.selection; setPhoneSelection(selection.current); }} accessibilityLabel="U.S. phone number" placeholder="(202) 555-0123" keyboardType="phone-pad" showSoftInputOnFocus={false} autoComplete="tel-national" textContentType="telephoneNumber" autoCorrect={false} style={styles.input} editable={!busy}/>
          <View testID="sms-number-pad" style={styles.numberPad}>{['1','2','3','4','5','6','7','8','9','+','0','⌫'].map(digit => <Pressable key={digit} accessibilityRole="button" accessibilityLabel={digit === '⌫' ? 'Delete last digit' : digit} disabled={busy} onPress={() => { const next = editPhone(phone, selection.current.start, selection.current.end, digit); selection.current = { start: next.caret, end: next.caret }; setPhoneSelection(selection.current); setPhone(next.value); }} accessibilityState={{ disabled: busy }} style={styles.numberKey}><Text style={styles.numberText}>{digit}</Text></Pressable>)}</View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: busy }} disabled={busy} onPress={() => setConsent(value => !value)} style={styles.consent}>
            <View style={[styles.check, consent && styles.checked]}><Text style={styles.checkText}>{consent ? '✓' : ''}</Text></View>
            <Text style={styles.consentText}>I agree to receive one text with my photo link. Message and data rates may apply.</Text>
          </Pressable>
          <Text style={styles.privacy}>Your number is used for this photo request and removed from the iPad after the request is resolved. Anyone with your link can view these photos.</Text>
          {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !consent }} disabled={busy || !consent} onPress={() => void submit()} style={[styles.primary, (busy || !consent) && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send my photo link'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={dismiss} style={styles.button}><Text style={styles.buttonText}>Use QR instead</Text></Pressable>
        </View>
      </ScrollView></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  numberPad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  numberKey: { width: '30%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eee5d8' },
  numberText: { fontSize: 22, color: '#272723' },
  entry: { width: '100%', minHeight: 64, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: '#272723' },
  entryText: { color: '#fffaf3', fontSize: 20, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 14, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#453b31', fontSize: 16, fontWeight: '600' },
  outcome: { color: '#51483d', fontSize: 15, lineHeight: 22, maxWidth: 420, textAlign: 'center', padding: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(24,23,20,.76)' },
  modalScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fbf6ec', borderRadius: 26, padding: 32, width: '100%', maxWidth: 540 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 2.6, color: '#665444', fontSize: 11, fontWeight: '600' },
  title: { fontFamily: 'Georgia', fontSize: 36, color: '#272723', marginTop: 12, marginBottom: 12 },
  copy: { fontSize: 16, lineHeight: 24, color: '#51483d', marginBottom: 22 },
  input: { borderWidth: 1, borderColor: '#998575', borderRadius: 12, padding: 16, minHeight: 56, fontSize: 20, color: '#272723', backgroundColor: '#fffaf3' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 20, minHeight: 52, gap: 12 },
  check: { borderWidth: 1.5, borderColor: '#665444', width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: '#3e6760', borderColor: '#3e6760' },
  checkText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  consentText: { flex: 1, color: '#453b31', fontSize: 15, lineHeight: 22 },
  privacy: { fontSize: 13, lineHeight: 19, color: '#655b4e', marginBottom: 22 },
  primary: { minHeight: 54, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#272723', padding: 16 },
  primaryText: { color: '#fffaf3', fontSize: 17, fontWeight: '600' },
  disabled: { opacity: 0.55 }, error: { color: '#9a3a2b', fontSize: 14, lineHeight: 20, marginBottom: 16 },
});
