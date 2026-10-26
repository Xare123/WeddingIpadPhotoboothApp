/** Explicit in-memory test controls. No OS events, Photos calls, or live network. */
type AppStatus = 'active' | 'background' | 'inactive';
const listeners = new Set<(status: AppStatus) => void>();
const parameters = new URLSearchParams(location.search);
export const accessibilityListeners = new Map<string, Set<(value: boolean) => void>>();
const insetValues = (parameters.get('insets') ?? '24,0,20,0').split(',').map(Number);
export const fixtureInsets = { top: insetValues[0] || 0, right: insetValues[1] || 0, bottom: insetValues[2] || 0, left: insetValues[3] || 0 };
export const fixtureState = parameters.get('state') ?? 'attract';
export const fixtureControls = {
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
  cameraCalls: 0,
  cameraPermissionRequests: 0,
  openSettingsCalls: 0,
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
