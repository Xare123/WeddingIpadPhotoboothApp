import { createContext, useCallback, useContext, useLayoutEffect, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import type { ModalProps } from 'react-native';

type Layer = { id: string; content: ReactNode; close?: ModalProps['onRequestClose'] };
type Registry = { put(id: string, content: ReactNode, close?: ModalProps['onRequestClose']): void; remove(id: string): void; hasActive(): boolean };
const Context = createContext<Registry | null>(null);
const Activity = createContext(false);
export function useWindowOverlayActivity() {
  const registry = useContext(Context);
  if (!registry) throw new Error('Window overlay provider missing');
  return { active: useContext(Activity), hasActive: registry.hasActive };
}

/** Same UIWindow/scene as the booth: never presents a UIKit modal or requests scene geometry. */
export function WindowOverlayProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const active = useRef(new Set<string>());
  const put = useCallback((id: string, content: ReactNode, close?: ModalProps['onRequestClose']) => { active.current.add(id); setLayers(previous => {
    const index = previous.findIndex(layer => layer.id === id);
    if (index < 0) return [...previous, { id, content, close }];
    const next = [...previous]; next[index] = { id, content, close }; return next;
  }); }, []);
  const remove = useCallback((id: string) => { active.current.delete(id); setLayers(previous => previous.some(layer => layer.id === id) ? previous.filter(layer => layer.id !== id) : previous); }, []);
  const hasActive = useCallback(() => active.current.size > 0, []);
  const current = useRef(layers); current.current = layers;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const top = current.current.at(-1); if (!top) return false;
      top.close?.({} as never); return true;
    });
    return () => subscription.remove();
  }, []);
  const registry = useMemo(() => ({ put, remove, hasActive }), [put, remove, hasActive]);
  return <Context.Provider value={registry}><Activity.Provider value={layers.length > 0}><View style={styles.root}>
    <View style={styles.root} pointerEvents={layers.length ? 'none' : 'auto'} accessibilityElementsHidden={layers.length > 0} importantForAccessibility={layers.length ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {layers.map((layer, index) => <View key={layer.id} style={StyleSheet.absoluteFill} pointerEvents={index === layers.length - 1 ? 'auto' : 'none'} accessibilityElementsHidden={index !== layers.length - 1} importantForAccessibility={index === layers.length - 1 ? 'yes' : 'no-hide-descendants'}>{layer.content}</View>)}
  </View></Activity.Provider></Context.Provider>;
}

/** Modal-compatible call sites, rendered in the existing root window rather than another controller. */
export function Modal({ visible = true, children, transparent, testID, onRequestClose }: ModalProps) {
  const registry = useContext(Context);
  if (!registry) throw new Error('Booth overlays require the window overlay provider');
  const id = useId();
  // Update existing layers in place so input, scroll and nested-editor state survive rerenders.
  useLayoutEffect(() => {
    if (visible) registry.put(id, <View testID={testID} accessibilityViewIsModal onAccessibilityEscape={() => onRequestClose?.({} as never)} style={[styles.root, !transparent && styles.opaque]}>{children}</View>, onRequestClose);
    else registry.remove(id);
  }, [registry, id, visible, children, transparent, testID, onRequestClose]);
  useLayoutEffect(() => () => registry.remove(id), [registry, id]);
  return null;
}
const styles = StyleSheet.create({ root: { flex: 1 }, opaque: { backgroundColor: '#f6f1e7' } });
