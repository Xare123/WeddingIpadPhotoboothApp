/** RN-web rendering with explicitly synthetic lifecycle/settings boundaries. */
export * from 'react-native-web';
export { AppState } from './fixture-controls';
import { Linking as WebLinking } from 'react-native-web';
import { Image as WebImage, Animated as WebAnimated, View as WebView } from 'react-native-web';
import { createElement, forwardRef } from 'react';
import { fixtureControls } from './fixture-controls';
export const Linking = { ...WebLinking, async openSettings() { fixtureControls.openSettingsCalls++; } };
function browserSource(source: any): any {
  if (Array.isArray(source)) return source.map(browserSource);
  const match = source?.uri && /^file:\/\/\/synthetic\/([a-zA-Z0-9-]+)\.jpg$/.exec(source.uri);
  return match ? { ...source, uri: `/synthetic/shot/${match[1]}.png` } : source;
}
export const Image = Object.assign(forwardRef<any, any>((props, ref) => createElement(WebImage, { ...props, source: browserSource(props.source), ref })), {
  getSize: WebImage.getSize, prefetch: WebImage.prefetch, resolveAssetSource: WebImage.resolveAssetSource,
});
export const Animated = { ...WebAnimated, Image: WebAnimated.createAnimatedComponent(Image) };

// Explicit synthetic OS accessibility values, including live preference changes.
import { AccessibilityInfo as WebAccessibilityInfo } from 'react-native-web';
import { accessibilityListeners } from './fixture-controls';
export const AccessibilityInfo = {
  ...WebAccessibilityInfo,
  isReduceTransparencyEnabled: async () => fixtureControls.preferences.reduceTransparencyChanged,
  isDarkerSystemColorsEnabled: async () => fixtureControls.preferences.highTextContrastChanged,
  isHighTextContrastEnabled: async () => fixtureControls.preferences.highTextContrastChanged,
  isReduceMotionEnabled: async () => fixtureControls.preferences.reduceMotionChanged,
  addEventListener(event: string, listener: (value: boolean) => void) {
    if (!(event in fixtureControls.preferences)) return WebAccessibilityInfo.addEventListener(event as any, listener);
    const listeners = accessibilityListeners.get(event) ?? new Set();
    accessibilityListeners.set(event, listeners); listeners.add(listener);
    return { remove() { listeners.delete(listener); } };
  },
};

// RN-web does not expose the native accessibilityHint; preserve it as browser
// data attribute for fixture inspection without altering the actual app component.
export const View = forwardRef<any, any>(({ accessibilityHint, ...props }, ref) =>
  createElement(WebView, { ...props, ref, dataSet: { ...props.dataSet, fixtureAccessibilityHint: accessibilityHint } }));
