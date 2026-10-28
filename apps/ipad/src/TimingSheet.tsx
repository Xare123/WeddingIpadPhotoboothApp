import { Modal } from './window-overlay';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import {
  AccessibilityInfo, PanResponder, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CAPTURE_TIMER_OPTIONS, normalizeCaptureTiming, type CaptureTiming, type CountdownSeconds,
} from './capture-timing';
import { stepTimingDetent, timingDetentAt } from './timing-controls';

type TimingControlsProps = {
  value: CaptureTiming;
  onChange(value: CaptureTiming): void;
  disabled?: boolean;
  testIDPrefix?: string;
};
// The browser substitute must hand horizontal gestures to the slider rather
// than scrolling/history navigation. This CSS is never sent to native views.
const webRailStyle: ViewStyle & { touchAction: 'none' } = { touchAction: 'none' };

function TimingSlider({ value, onChange, disabled = false, label, hint, testID, wide }: {
  value: CountdownSeconds; onChange(value: CountdownSeconds): void;
  disabled?: boolean; label: string; hint: string; testID: string; wide: boolean;
}) {
  const rail = useRef<ComponentRef<typeof View>>(null), mounted = useRef(true), counter = useRef(0);
  const latest = useRef({ value, onChange, disabled, label });
  latest.current = { value, onChange, disabled, label };
  const geometry = useRef<{ left: number; width: number } | null>(null);
  const pointer = useRef<{ id: number; pageX: number; ended: boolean; announced: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pointer.current = null; }; }, []);
  useEffect(() => { if (disabled) { pointer.current = null; counter.current++; } }, [disabled]);

  function announce(next: CountdownSeconds) {
    if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(`${latest.current.label}, ${next} seconds`);
  }
  function commit(next: CountdownSeconds, speak: boolean) {
    if (!mounted.current || latest.current.disabled) return;
    if (next !== latest.current.value) {
      // Keep rapid taps/drag callbacks atomic before the next controlled render.
      latest.current.value = next;
      latest.current.onChange(next);
    }
    if (speak) announce(next);
  }
  function step(direction: -1 | 1, speak = true) {
    commit(stepTimingDetent(latest.current.value, direction), speak);
  }
  function applyPointer() {
    const gesture = pointer.current, bounds = geometry.current;
    if (!gesture || !bounds || latest.current.disabled) return;
    const next = timingDetentAt(gesture.pageX - bounds.left, bounds.width);
    if (next === null) return;
    const speak = gesture.ended && !gesture.announced;
    if (speak) gesture.announced = true;
    commit(next, speak);
  }
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: (_event, gesture) => !latest.current.disabled && Math.abs(gesture.dx) > 3 && Math.abs(gesture.dx) >= Math.abs(gesture.dy),
    onPanResponderGrant: (event) => {
      if (latest.current.disabled) return;
      const id = ++counter.current;
      pointer.current = { id, pageX: event.nativeEvent.pageX, ended: false, announced: false };
      // pageX + a fresh window measurement avoids child-relative locationX jumps.
      geometry.current = null;
      rail.current?.measureInWindow((left, _top, measuredWidth) => {
        if (!mounted.current || pointer.current?.id !== id || latest.current.disabled) return;
        geometry.current = { left, width: measuredWidth };
        applyPointer();
      });
    },
    onPanResponderMove: (event) => {
      if (!pointer.current) return;
      pointer.current.pageX = event.nativeEvent.pageX;
      applyPointer();
    },
    onPanResponderRelease: (event) => {
      if (!pointer.current) return;
      pointer.current.pageX = event.nativeEvent.pageX;
      pointer.current.ended = true;
      applyPointer();
    },
    onPanResponderTerminate: () => { pointer.current = null; counter.current++; },
    onPanResponderTerminationRequest: () => true,
  }), []);
  const index = CAPTURE_TIMER_OPTIONS.indexOf(value), fraction = index / (CAPTURE_TIMER_OPTIONS.length - 1);
  const webKeys = Platform.OS === 'web' ? {
    'aria-valuemin': 2, 'aria-valuemax': 10, 'aria-valuenow': value,
    'aria-valuetext': `${value} seconds`, 'aria-disabled': disabled,
    onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?(): void }) => {
      const key = event.key ?? event.nativeEvent?.key;
      if (latest.current.disabled || !['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End'].includes(key ?? '')) return;
      event.preventDefault?.();
      if (key === 'Home') commit(CAPTURE_TIMER_OPTIONS[0], false);
      else if (key === 'End') commit(CAPTURE_TIMER_OPTIONS[CAPTURE_TIMER_OPTIONS.length - 1]!, false);
      else step(key === 'ArrowRight' || key === 'ArrowUp' ? 1 : -1, false);
    },
  } : {};
  return <View style={[s.control, wide && s.controlWide, disabled && s.disabled]}>
    <View style={s.controlHeading}><View style={s.controlCopy}><Text style={s.controlTitle}>{label}</Text><Text style={s.controlHint}>{hint}</Text></View><Text testID={`${testID}-value`} accessibilityLiveRegion="polite" style={s.value}>{value}<Text style={s.unit}>s</Text></Text></View>
    <View ref={rail} testID={`${testID}-slider`} accessible accessibilityRole="adjustable" focusable={!disabled}
      accessibilityLabel={label} accessibilityHint="Choose a labelled stop, swipe up or down, or use the minus and plus buttons."
      accessibilityValue={{ min: 2, max: 10, now: value, text: `${value} seconds` }} accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment', label: 'More time' }, { name: 'decrement', label: 'Less time' }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') step(1, false); else if (event.nativeEvent.actionName === 'decrement') step(-1, false); }}
      onLayout={event => { setWidth(event.nativeEvent.layout.width); geometry.current = null; pointer.current = null; counter.current++; }}
      style={[s.railHit, Platform.OS === 'web' && webRailStyle]} {...pan.panHandlers} {...webKeys}>
      <View pointerEvents="none" style={s.track}><View style={[s.trackFill, { width: `${fraction * 100}%` }]} />{CAPTURE_TIMER_OPTIONS.map((seconds, stop) => <View key={seconds} style={[s.stop, { left: `${stop / (CAPTURE_TIMER_OPTIONS.length - 1) * 100}%` }, stop <= index && s.stopActive]} />)}</View>
      <View pointerEvents="none" style={[s.thumb, { left: fraction * Math.max(0, width - 28) }]}><View style={s.thumbCenter} /></View>
    </View>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.labels}>{CAPTURE_TIMER_OPTIONS.map(seconds => <Text key={seconds} style={[s.stopLabel, value === seconds && s.stopLabelSelected]}>{seconds}</Text>)}</View>
    <View style={s.steps}>
      <Pressable testID={`${testID}-minus`} accessibilityRole="button" accessibilityLabel={`${label}: less time`} accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => step(-1)} style={({ pressed }) => [s.stepButton, (disabled || index === 0) && s.stepDisabled, pressed && s.pressed]}><Text style={s.stepSymbol}>−</Text></Pressable>
      <Text style={s.stepNote}>seconds</Text>
      <Pressable testID={`${testID}-plus`} accessibilityRole="button" accessibilityLabel={`${label}: more time`} accessibilityState={{ disabled: disabled || index === CAPTURE_TIMER_OPTIONS.length - 1 }} disabled={disabled || index === CAPTURE_TIMER_OPTIONS.length - 1} onPress={() => step(1)} style={({ pressed }) => [s.stepButton, (disabled || index === CAPTURE_TIMER_OPTIONS.length - 1) && s.stepDisabled, pressed && s.pressed]}><Text style={s.stepSymbol}>+</Text></Pressable>
    </View>
  </View>;
}

export function TimingControls({ value, onChange, disabled = false, testIDPrefix = 'timing' }: TimingControlsProps) {
  const [width, setWidth] = useState(0), { fontScale } = useWindowDimensions();
  const wide = width >= 650 && fontScale < 1.45;
  const current = useRef(value);
  current.current = value;
  const update = (key: keyof CaptureTiming, seconds: CountdownSeconds) => {
    if (disabled) return;
    const next = { ...current.current, [key]: seconds };
    current.current = next;
    onChange(next);
  };
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[s.controls, wide && s.controlsWide]}>
    <TimingSlider value={value.firstSeconds} onChange={seconds => update('firstSeconds', seconds)} disabled={disabled} label="First photo" hint="Time to get into position." testID={`${testIDPrefix}-first`} wide={wide} />
    <TimingSlider value={value.nextSeconds} onChange={seconds => update('nextSeconds', seconds)} disabled={disabled} label="Next photos" hint="Time for each following photo." testID={`${testIDPrefix}-next`} wide={wide} />
  </View>;
}

export function TimingSheet({ visible, timing, defaults, onApply, onClose, reduceMotion, disabled = false }: {
  visible: boolean; timing: CaptureTiming; defaults: CaptureTiming;
  onApply(value: CaptureTiming): void; onClose(): void; reduceMotion: boolean; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<CaptureTiming>(() => normalizeCaptureTiming(timing));
  const wasOpen = useRef(false), insets = useSafeAreaInsets(), { height, width } = useWindowDimensions();
  const presentedDraft = visible && !wasOpen.current ? normalizeCaptureTiming(timing) : draft;
  const current = useRef(presentedDraft); current.current = presentedDraft;
  useEffect(() => {
    if (visible && !wasOpen.current) { const next = normalizeCaptureTiming(timing); current.current = next; setDraft(next); }
    wasOpen.current = visible;
  }, [visible, timing.firstSeconds, timing.nextSeconds]);
  useEffect(() => { if (visible && disabled) onClose(); }, [visible, disabled, onClose]);
  const change = (value: CaptureTiming) => { if (!disabled) { current.current = value; setDraft(value); } };
  return <Modal presentationStyle="overFullScreen" supportedOrientations={['portrait', 'portrait-upside-down', 'landscape']} visible={visible && !disabled} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
    <View style={s.overlay}>
      <Pressable testID="timing-backdrop" accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View testID="timing-sheet" accessibilityViewIsModal style={[s.sheet, { width: Math.max(0, width - Math.max(12, insets.left) - Math.max(12, insets.right)), maxHeight: Math.max(160, height - insets.top - 20), paddingBottom: Math.max(18, insets.bottom) }]}>
        <View accessible={false} style={s.grabber} />
        <View style={s.header}><View style={s.heading}><Text style={s.eyebrow}>YOUR PACE</Text><Text accessibilityRole="header" style={s.title}>Your timing.</Text></View><Pressable testID="timing-cancel" accessibilityRole="button" accessibilityLabel="Cancel timing changes" onPress={onClose} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable></View>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator>
          <Text style={s.intro}>A little time to settle in, then a quicker rhythm.</Text>
          <TimingControls value={presentedDraft} onChange={change} disabled={disabled} />
          <Pressable testID="timing-reset" accessibilityRole="button" accessibilityLabel={`Reset to booth defaults, ${defaults.firstSeconds} seconds first and ${defaults.nextSeconds} seconds next`} disabled={disabled} onPress={() => change(normalizeCaptureTiming(defaults))} style={s.reset}><Text style={s.resetText}>Use booth defaults · {defaults.firstSeconds}s first / {defaults.nextSeconds}s next</Text></Pressable>
        </ScrollView>
        <View style={s.footer}><Text style={s.sessionNote}>Just for your photos. The next guests get the booth defaults.</Text><Pressable testID="timing-apply" accessibilityRole="button" accessibilityLabel={`Use ${presentedDraft.firstSeconds} seconds for the first photo and ${presentedDraft.nextSeconds} seconds for following photos`} disabled={disabled} onPress={() => { if (!disabled) onApply({ ...current.current }); }} style={({ pressed }) => [s.apply, disabled && s.disabled, pressed && s.pressed]}><Text style={s.applyText}>Use this timing</Text></Pressable></View>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0B1C1299', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 860, flexShrink: 1, backgroundColor: '#F6F1E7', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, overflow: 'hidden' },
  grabber: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#AEB8A6', alignSelf: 'center', marginBottom: 10 },
  header: { paddingHorizontal: 24, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  heading: { flex: 1 }, eyebrow: { color: '#66715F', fontSize: 10, fontWeight: '600', letterSpacing: 1.8, marginBottom: 5 }, title: { fontFamily: 'Georgia', fontSize: 30, color: '#2D392F' },
  cancel: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center' }, cancelText: { fontSize: 15, fontWeight: '600', color: '#3F5C3F' },
  scroll: { flexShrink: 1 }, scrollContent: { paddingHorizontal: 24, gap: 16, paddingBottom: 8 }, intro: { fontSize: 15, lineHeight: 22, color: '#53614F' },
  controls: { gap: 12 }, controlsWide: { flexDirection: 'row' }, control: { backgroundColor: '#FBF8F0', borderWidth: 1, borderColor: '#D7DCCF', borderRadius: 18, padding: 18, minWidth: 0 }, controlWide: { flex: 1 },
  controlHeading: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 7 }, controlCopy: { flex: 1, gap: 5 }, controlTitle: { color: '#2D4433', fontSize: 17, fontWeight: '600' }, controlHint: { color: '#63705C', fontSize: 12, lineHeight: 18 }, value: { fontSize: 38, fontWeight: '500', color: '#314D3B', fontVariant: ['tabular-nums'] }, unit: { fontSize: 18, fontWeight: '400' },
  railHit: { height: 52, justifyContent: 'center' }, track: { position: 'absolute', left: 14, right: 14, height: 4, borderRadius: 2, backgroundColor: '#CBD3C2' }, trackFill: { height: 4, borderRadius: 2, backgroundColor: '#456248' }, stop: { position: 'absolute', top: -1, marginLeft: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#8C9C83' }, stopActive: { backgroundColor: '#456248' }, thumb: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#314D3B', borderWidth: 3, borderColor: '#FBF8F0', justifyContent: 'center', alignItems: 'center' }, thumbCenter: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F6F1E7' },
  labels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10 }, stopLabel: { color: '#66735E', fontSize: 11, fontVariant: ['tabular-nums'] }, stopLabelSelected: { color: '#314D3B', fontWeight: '700' }, steps: { marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, stepButton: { minHeight: 44, minWidth: 48, borderRadius: 12, borderWidth: 1, borderColor: '#9BAE90', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, stepSymbol: { color: '#314D3B', fontSize: 24, lineHeight: 30 }, stepNote: { color: '#64715D', fontSize: 11 }, stepDisabled: { opacity: 0.35 }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.8 },
  reset: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 6 }, resetText: { color: '#3B5C3D', fontSize: 13, lineHeight: 20, textAlign: 'center', fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 12 }, sessionNote: { color: '#5E6B56', fontSize: 12, lineHeight: 18, textAlign: 'center' }, apply: { minHeight: 60, backgroundColor: '#314D3B', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16 }, applyText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
