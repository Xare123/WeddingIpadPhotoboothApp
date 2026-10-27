/** Explicit in-memory test controls. No OS events, Photos calls, or live network. */
type AppStatus = 'active' | 'background' | 'inactive';
type SyntheticHostAuthOutcome = 'success' | 'throw' | 'passcode_not_set' | 'user_cancel' | 'system_cancel' | 'app_cancel' | 'user_fallback' | 'lockout' | 'not_enrolled' | 'not_available' | 'authentication_failed' | 'unknown';
import type { ObservedOrientation, ObservedOrientationLock, RequestedOrientationLock } from '../../../apps/ipad/src/orientation-controller';
const listeners = new Set<(status: AppStatus) => void>();
const parameters = new URLSearchParams(location.search);
export const accessibilityListeners = new Map<string, Set<(value: boolean) => void>>();
const insetValues = (parameters.get('insets') ?? '24,0,20,0').split(',').map(Number);
export const fixtureInsets = { top: insetValues[0] || 0, right: insetValues[1] || 0, bottom: insetValues[2] || 0, left: insetValues[3] || 0 };
export const fixtureState = parameters.get('state') ?? 'attract';
export const fixtureControls = {
  imageFaults: [] as { testID: string; prefix: string; remaining: number }[],
  imageCallbacks: new Map<string, { testID: string; uri: string; onError: (event: unknown) => void }>(),
  imageEvents: [] as { kind: string; testID: string; uri: string }[],
  failNextImage(testID: string, prefix = '') { this.imageFaults.push({ testID, prefix, remaining: 1 }); },
  replayImageError(testID: string, uri: string) {
    const callback = this.imageCallbacks.get(testID + ':' + uri);
    if (!callback) throw new Error('No captured SDK Image callback for ' + testID);
    this.imageEvents.push({ kind: 'synthetic-sdk-error-replay', testID, uri });
    callback.onError({ nativeEvent: { error: 'Synthetic late SDK Image error' } });
  },
  appState: 'active' as AppStatus,
  glassAvailable: parameters.get('glass') === 'available',
  preferences: {
    reduceTransparencyChanged: parameters.get('reducedTransparency') === 'true',
    highTextContrastChanged: parameters.get('highContrast') === 'true',
    reduceMotionChanged: parameters.get('reducedMotion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches,
  } as Record<string, boolean>,
  setAccessibilityPreference(event: string, value: boolean) {
    if (!(event in this.preferences)) throw new Error('Unknown synthetic accessibility preference: ' + event);
    this.preferences[event] = value;
    for (const listener of accessibilityListeners.get(event) ?? []) listener(value);
  },
  online: !['pending', 'offline'].includes(fixtureState),
  readyAcknowledged: fixtureState !== 'partial-ready',
  photoSet: parameters.get('photos') ?? 'marker',
  templateInspections: [] as { version: string; gridAspect: string; median: number; sources: { photoId: string; width: number; height: number; sha256: string }[] }[],
  templatesAvailable: parameters.get('templates') === 'available',
  templateDelayMs: 0,
  templatesIgnoreCancellation: false,
  templateRenders: [] as { requestID: string; recipeJSON: string; preview: boolean; status: string; uri: string; sourceHashes: Record<string, string> }[],
  templateCancellations: [] as string[],
  templateReleases: [] as string[],
  effectsAvailable: parameters.get('effects') === 'available',
  effectDelayMs: 0,
  effectsIgnoreCancellation: false,
  effectRenders: [] as { requestID: string; sourceUri: string; preset: string; intensity: number; preview: boolean; status: string; uri: string }[],
  effectCancellations: [] as string[],
  effectReleases: [] as string[],
  // Explicit synthetic SDK gates for actual-runner readiness/save sequencing.
  saveBlocked: false,
  saveDelayMs: 0,
  pendingSaves: 0,
  saveWaiters: new Set<() => void>(),
  releaseSaves() { this.saveBlocked = false; for (const resolve of this.saveWaiters) resolve(); this.saveWaiters.clear(); },
  captureBlocked: false,
  pendingCaptures: 0,
  captureWaiters: new Set<() => void>(),
  releaseCaptures() { this.captureBlocked = false; for (const resolve of this.captureWaiters) resolve(); this.captureWaiters.clear(); },
  orientationAvailable: parameters.get('orientationNative') !== 'unavailable',
  orientationSupported: parameters.get('orientationNative') !== 'unsupported',
  orientationRejectRequests: parameters.get('orientationNative') === 'rejected',
  orientationSupportBlocked: parameters.get('orientationNative') === 'support-timeout',
  orientationSupportWaiters: new Set<() => void>(),
  releaseOrientationSupport() { this.orientationSupportBlocked = false; for (const resolve of this.orientationSupportWaiters) resolve(); this.orientationSupportWaiters.clear(); },
  orientationRequestBlocked: parameters.get('orientationNative') === 'request-timeout',
  orientationRequestWaiters: new Set<() => void>(),
  releaseOrientationRequest() { this.orientationRequestBlocked = false; for (const resolve of this.orientationRequestWaiters) resolve(); this.orientationRequestWaiters.clear(); },
  orientationReadFailure: false,
  orientationLoadBlocked: parameters.get('orientationLoad') === 'blocked',
  orientationLoadWaiters: new Set<() => void>(),
  releaseOrientationLoad() { this.orientationLoadBlocked = false; for (const resolve of this.orientationLoadWaiters) resolve(); this.orientationLoadWaiters.clear(); },
  orientationLoads: 0,
  orientationReads: 0,
  orientationSupports: [] as RequestedOrientationLock[],
  orientationRequests: [] as { lock: RequestedOrientationLock; at: number; appState: AppStatus; pendingCaptures: number; pendingSaves: number; countdown: string | null }[],
  orientationObservedLock: 'default' as ObservedOrientationLock,
  orientationObserved: null as ObservedOrientation | null,
  orientationSubscriptions: 0,
  orientationUnsubscriptions: 0,
  orientationListeners: new Set<() => void>(),
  emitOrientation() { for (const listener of this.orientationListeners) listener(); },
  cameraReadyBlocked: false,
  cameraMounts: 0,
  cameraReadyCallbacks: new Set<() => void>(),
  cameraErrorCallbacks: new Set<() => void>(),
  setCameraReady(ready: boolean) {
    this.cameraReadyBlocked = !ready;
    for (const callback of ready ? this.cameraReadyCallbacks : this.cameraErrorCallbacks) callback();
  },
  cameraCalls: 0,
  cameraPermissionRequests: 0,
  openSettingsCalls: 0,
  // Synthetic OS-auth result/lifecycle ports exercise the actual host policy.
  // They never accept a PIN, biometrics, device passcode, pairing code or secret.
  hostAuthOutcome: 'success' as SyntheticHostAuthOutcome,
  hostAuthLifecycle: 'none' as 'none' | 'inactive' | 'background',
  hostAuthBlocked: false,
  hostAuthRequests: 0,
  hostAuthPending: 0,
  hostAuthWaiters: new Set<() => void>(),
  releaseHostAuth() { this.hostAuthBlocked = false; for (const resolve of this.hostAuthWaiters) resolve(); this.hostAuthWaiters.clear(); },
  connection: (parameters.get('connection') ?? 'paired') as 'paired' | 'unpaired' | 'unavailable',
  sharingBlocked: parameters.get('sharing') === 'blocked',
  sharingFailure: false,
  sharingCalls: 0,
  sharingWaiters: new Set<() => void>(),
  releaseSharing() { this.sharingBlocked = false; for (const resolve of this.sharingWaiters) resolve(); this.sharingWaiters.clear(); },
  photoPermissionRequests: 0,
  photoExportCalls: [] as { uri: string; photoId: string }[],
  photoStatusUpdates: [] as { sessionId: string; photoId: string; status: string }[],
  indexWritable: fixtureState !== 'index-repair',
  failNextSave: false,
  events: [] as { kind: string; id?: string; slot?: number; at: number }[],
  snapshot: () => ({} as unknown),
  setOnline(online: boolean) { this.online = online; },
  acknowledgeReady(value: boolean) { this.readyAcknowledged = value; },
  setAppState(status: AppStatus) { this.appState = status; for (const listener of listeners) listener(status); },
};
(globalThis as typeof globalThis & { __NEW_SESSION_FIXTURE__: typeof fixtureControls }).__NEW_SESSION_FIXTURE__ = fixtureControls;
export const AppState = {
  get currentState() { return fixtureControls.appState; },
  addEventListener(_event: string, callback: (status: AppStatus) => void) {
    listeners.add(callback);
    return { remove() { listeners.delete(callback); } };
  },
};
