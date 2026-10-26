/** RN-web rendering with explicitly synthetic lifecycle/settings boundaries. */
export * from 'react-native-web';
export { AppState } from './fixture-controls';
import { Linking as WebLinking } from 'react-native-web';
import { Image as WebImage, Animated as WebAnimated, View as WebView } from 'react-native-web';
import { createElement, forwardRef, useEffect, useRef } from 'react';
import { fixtureControls } from './fixture-controls';
export const Linking = { ...WebLinking, async openSettings() { fixtureControls.openSettingsCalls++; } };
import { durableRenderedImages, renderedImages, originalImageVariants, browserImageURI } from './effects-stub';
function browserSource(source: any): any {
  if (Array.isArray(source)) return source.map(browserSource);
  if (source?.uri && renderedImages.has(source.uri)) return { ...source, uri: renderedImages.get(source.uri) };
  if (source?.uri && durableRenderedImages.has(source.uri)) return { ...source, uri: durableRenderedImages.get(source.uri) };
  if (source?.uri && originalImageVariants.has(source.uri)) return { ...source, uri: browserImageURI(source.uri) };
  const match = source?.uri && /^file:\/\/\/synthetic\/([a-zA-Z0-9-]+)\.jpg$/.exec(source.uri);
  return match ? { ...source, uri: `/synthetic/shot/${match[1]}.png` } : source;
}
// Faults simulate SDK callback delivery, not a browser network/decode failure.
// They execute the actual App Image onError callback and withhold onLoad.
export const Image = Object.assign(forwardRef<any, any>((props, ref) => {
  const uri = props.source?.uri ?? '', testID = props.testID ?? '';
  const fault = useRef<boolean | null>(null);
  if (fault.current === null) {
    const request = fixtureControls.imageFaults.find(value => value.remaining > 0 && value.testID === testID && uri.startsWith(value.prefix));
    fault.current = !!request;
    if (request) request.remaining--;
  }
  useEffect(() => {
    if (props.onError) fixtureControls.imageCallbacks.set(testID + ':' + uri, { testID, uri, onError: props.onError });
    if (fault.current) {
      const timer = setTimeout(() => {
        fixtureControls.imageEvents.push({ kind: 'synthetic-sdk-error', testID, uri });
        props.onError?.({ nativeEvent: { error: 'Synthetic SDK Image load failure; native decoding unverified' } });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [uri, testID]);
  return createElement(WebImage, { ...props, source: browserSource(props.source), ref,
    dataSet: { ...props.dataSet, fixtureNativeUri: uri },
    onLoad: fault.current ? undefined : (event: unknown) => { if (props.onLoad) fixtureControls.imageEvents.push({ kind: 'sdk-load', testID, uri }); props.onLoad?.(event); } });
}), {
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
