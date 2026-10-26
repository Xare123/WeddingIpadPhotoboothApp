/** Browser fixture only. Availability is synthetic; this never renders native glass. */
import React from 'react';
import { View } from 'react-native';
import { fixtureControls } from './fixture-controls';
export const isLiquidGlassAvailable = () => fixtureControls.glassAvailable;
export const isGlassEffectAPIAvailable = () => fixtureControls.glassAvailable;
export function GlassView(props: any) {
  return <View {...props} accessibilityLabel="Synthetic browser glass stand-in; not native Liquid Glass" />;
}
export const GlassContainer = GlassView;
