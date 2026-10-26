/** RN-web rendering with explicitly synthetic lifecycle/settings boundaries. */
export * from 'react-native-web';
export { AppState } from './fixture-controls';
import { Linking as WebLinking } from 'react-native-web';
import { Image as WebImage, Animated as WebAnimated } from 'react-native-web';
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
