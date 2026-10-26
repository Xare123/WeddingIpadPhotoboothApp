/** Deterministic browser insets, never an OS safe-area measurement. */
import React, { createContext, useContext } from 'react';
import { View } from 'react-native';
import { fixtureInsets } from './fixture-controls';
export const SafeAreaInsetsContext = createContext(fixtureInsets);
export function SafeAreaProvider({ children }: any) {
  return <SafeAreaInsetsContext.Provider value={fixtureInsets}>{children}</SafeAreaInsetsContext.Provider>;
}
export const useSafeAreaInsets = () => useContext(SafeAreaInsetsContext);
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
export const initialWindowMetrics = { insets: fixtureInsets, frame: { x: 0, y: 0, width: innerWidth, height: innerHeight } };
export const SafeAreaView = View;
