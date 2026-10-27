export type NativeModuleAvailability = 'available' | 'missing' | 'unknown';
export type NativeStartupAvailability = Readonly<{
  KeyboardObserver: NativeModuleAvailability;
  AppState: NativeModuleAvailability;
  WebSocketModule: NativeModuleAvailability;
  Animated: NativeModuleAvailability;
}>;

/** Availability only: never invokes module methods or inspects returned/error metadata. */
export function probeNativeStartupModules(
  lookup: (name: string) => unknown,
  logger: (safeFixedString: string) => void,
): NativeStartupAvailability {
  const probe = (name: string): NativeModuleAvailability => {
    try {
      const value = lookup(name);
      return value === null || value === undefined ? 'missing' : 'available';
    } catch {
      return 'unknown';
    }
  };
  const KeyboardObserver = probe('KeyboardObserver');
  const AppState = probe('AppState');
  const WebSocketModule = probe('WebSocketModule');
  const classic = probe('NativeAnimatedModule');
  const turbo = probe('NativeAnimatedTurboModule');
  const Animated: NativeModuleAvailability = classic === 'available' || turbo === 'available'
    ? 'available' : classic === 'missing' && turbo === 'missing' ? 'missing' : 'unknown';
  const result = { KeyboardObserver, AppState, WebSocketModule, Animated };
  try {
    logger('Native module bootstrap: KeyboardObserver=' + KeyboardObserver
      + '; AppState=' + AppState + '; WebSocketModule=' + WebSocketModule + '; Animated=' + Animated);
  } catch { /* Diagnostics must never interrupt ordinary app bootstrap. */ }
  return result;
}
