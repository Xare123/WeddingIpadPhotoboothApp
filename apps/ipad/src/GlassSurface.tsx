import { useEffect, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { conservativeGlassPreferences, nativeGlassAllowed, observeGlassPreferences } from './glass-policy';

/** A single navigation/control material. Never used for the camera/photo itself. */
export function GlassSurface({ children, style, testID }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; testID?: string }>) {
  const [preferences, setPreferences] = useState(conservativeGlassPreferences);
  useEffect(() => observeGlassPreferences({
    read(name) {
      if (name === 'reduceTransparency') return AccessibilityInfo.isReduceTransparencyEnabled();
      if (name === 'reduceMotion') return AccessibilityInfo.isReduceMotionEnabled();
      return Platform.OS === 'ios' ? AccessibilityInfo.isDarkerSystemColorsEnabled() : AccessibilityInfo.isHighTextContrastEnabled();
    },
    subscribe(name, listener) {
      const event = name === 'reduceTransparency' ? 'reduceTransparencyChanged' : name === 'reduceMotion' ? 'reduceMotionChanged'
        : Platform.OS === 'ios' ? 'darkerSystemColorsChanged' : 'highTextContrastChanged';
      return AccessibilityInfo.addEventListener(event, listener);
    },
  }, setPreferences), []);
  let available = false;
  try { available = nativeGlassAllowed({ platform: Platform.OS, version: Platform.Version,
    liquidGlass: Platform.OS === 'ios' && isLiquidGlassAvailable(), apiAvailable: Platform.OS === 'ios' && isGlassEffectAPIAvailable(), preferences }); } catch {}
  const hint = `Reduced transparency ${preferences.reduceTransparency ? 'on' : 'off'}; increased contrast ${preferences.increasedContrast ? 'on' : 'off'}; reduced motion ${preferences.reduceMotion ? 'on' : 'off'}`;
  if (available) return <GlassView testID={testID} accessibilityLabel="Native glass controls surface" accessibilityHint={hint}
    glassEffectStyle={{ style: 'regular', animate: false }} tintColor="#10251D" colorScheme="dark" isInteractive={false} style={style}>{children}</GlassView>;
  return <View testID={testID} accessibilityLabel="Opaque controls surface" accessibilityHint={hint} style={[style, styles.opaque]}>{children}</View>;
}
const styles = StyleSheet.create({ opaque: { backgroundColor: '#14271D', borderWidth: 1, borderColor: '#9AAE9B' } });
