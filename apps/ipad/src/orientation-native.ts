import type {
  OrientationPort, OrientationObservation, RequestedOrientationLock,
  ObservedOrientation, ObservedOrientationLock, OrientationError,
} from './orientation-controller';

type Subscription = { remove(): void };
export type OrientationSDK = {
  OrientationLock: Readonly<{ DEFAULT: 0; PORTRAIT_UP: 3; LANDSCAPE: 5 }>;
  Orientation: Readonly<{ UNKNOWN: number; PORTRAIT_UP: number; PORTRAIT_DOWN: number; LANDSCAPE_LEFT: number; LANDSCAPE_RIGHT: number }>;
  supportsOrientationLockAsync(lock: 0 | 3 | 5): Promise<boolean>;
  lockAsync(lock: 0 | 3 | 5): Promise<void>;
  unlockAsync(): Promise<void>;
  getOrientationAsync(): Promise<number>;
  getOrientationLockAsync(): Promise<number>;
  addOrientationChangeListener(listener: () => void): Subscription;
};
export type OrientationWindow = {
  get(name: 'window'): { width: number; height: number };
  addEventListener(name: 'change', listener: () => void): Subscription;
};
export type NativeOrientationOptions = {
  loadSDK?: () => Promise<OrientationSDK>;
  loadWindow?: () => Promise<OrientationWindow>;
  schedule?: OrientationPort['schedule'];
};
class NativeUnavailable extends Error {
  readonly code = 'native-unavailable';
  constructor() { super('Native orientation is unavailable in this app build.'); }
}
const schedule: OrientationPort['schedule'] = (delay, callback) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};
function numberFor(lock: RequestedOrientationLock, sdk: OrientationSDK): 0 | 3 | 5 {
  return lock === 'default' ? sdk.OrientationLock.DEFAULT
    : lock === 'portrait-up' ? sdk.OrientationLock.PORTRAIT_UP : sdk.OrientationLock.LANDSCAPE;
}
function orientationFor(value: number, sdk: OrientationSDK): ObservedOrientation {
  if (value === sdk.Orientation.PORTRAIT_UP) return 'portrait-up';
  if (value === sdk.Orientation.PORTRAIT_DOWN) return 'portrait-down';
  if (value === sdk.Orientation.LANDSCAPE_LEFT) return 'landscape-left';
  if (value === sdk.Orientation.LANDSCAPE_RIGHT) return 'landscape-right';
  return 'unknown';
}
function lockFor(value: number, sdk: OrientationSDK): ObservedOrientationLock {
  if (value === sdk.OrientationLock.DEFAULT) return 'default';
  if (value === sdk.OrientationLock.PORTRAIT_UP) return 'portrait-up';
  if (value === sdk.OrientationLock.LANDSCAPE) return 'landscape';
  return value === 9 ? 'unknown' : 'other';
}
function unavailable(timer: OrientationPort['schedule']): OrientationPort {
  const reject = async (): Promise<never> => { throw new NativeUnavailable(); };
  return Object.freeze({
    available: false, supports: reject, request: reject, readObservation: reject,
    subscribe: () => () => {}, schedule: timer,
  });
}

/** Lazy loading keeps missing native modules out of the app's synchronous startup path.
 * No listener/request/Keychain operation is admitted by loading the port itself.
 */
export async function loadNativeOrientationPort(options: NativeOrientationOptions = {}): Promise<OrientationPort> {
  const timer = options.schedule ?? schedule;
  let sdk: OrientationSDK;
  let window: OrientationWindow;
  try {
    [sdk, window] = await Promise.all([
      (options.loadSDK ?? (() => import('expo-screen-orientation')))(),
      (options.loadWindow ?? (async () => (await import('react-native')).Dimensions))(),
    ]);
    if (!sdk || !window || typeof sdk.supportsOrientationLockAsync !== 'function'
      || typeof sdk.lockAsync !== 'function' || typeof sdk.unlockAsync !== 'function'
      || typeof sdk.getOrientationAsync !== 'function' || typeof sdk.getOrientationLockAsync !== 'function'
      || typeof sdk.addOrientationChangeListener !== 'function' || typeof window.get !== 'function'
      || typeof window.addEventListener !== 'function' || !sdk.Orientation
      || ![sdk.Orientation.UNKNOWN, sdk.Orientation.PORTRAIT_UP, sdk.Orientation.PORTRAIT_DOWN,
        sdk.Orientation.LANDSCAPE_LEFT, sdk.Orientation.LANDSCAPE_RIGHT].every(Number.isFinite)
      || sdk.OrientationLock.DEFAULT !== 0 || sdk.OrientationLock.PORTRAIT_UP !== 3 || sdk.OrientationLock.LANDSCAPE !== 5) {
      return unavailable(timer);
    }
  } catch {
    return unavailable(timer);
  }
  const readObservation = async (): Promise<OrientationObservation> => {
    const [orientation, lock] = await Promise.all([sdk.getOrientationAsync(), sdk.getOrientationLockAsync()]);
    const size = window.get('window'); // Actual window, never device/screen dimensions.
    return Object.freeze({
      orientation: orientationFor(orientation, sdk), lock: lockFor(lock, sdk),
      width: size.width, height: size.height,
    });
  };
  return Object.freeze({
    available: true,
    supports: (lock: RequestedOrientationLock) => sdk.supportsOrientationLockAsync(numberFor(lock, sdk)),
    request: (lock: RequestedOrientationLock) => lock === 'default'
      ? sdk.unlockAsync() : sdk.lockAsync(numberFor(lock, sdk)),
    readObservation,
    subscribe(listener: (observation: OrientationObservation) => void, onError?: (code: OrientationError) => void) {
      let closed = false;
      let generation = 0;
      let native: Subscription | undefined;
      let geometry: Subscription | undefined;
      const remove = () => {
        try { native?.remove(); } catch { /* Cleanup must still remove the window subscription. */ }
        try { geometry?.remove(); } catch { /* No raw native error leaves cleanup. */ }
      };
      const notify = () => {
        const current = ++generation;
        queueMicrotask(() => {
          if (closed || current !== generation) return;
          void readObservation().then(value => {
            if (!closed && current === generation) listener(value);
          }).catch(() => {
            if (!closed && current === generation) onError?.('observation-unavailable');
          });
        });
      };
      try {
        native = sdk.addOrientationChangeListener(notify);
        geometry = window.addEventListener('change', notify);
      } catch {
        remove();
        throw new NativeUnavailable();
      }
      return () => {
        if (closed) return;
        closed = true;
        generation++;
        remove();
      };
    },
    schedule: timer,
  });
}
