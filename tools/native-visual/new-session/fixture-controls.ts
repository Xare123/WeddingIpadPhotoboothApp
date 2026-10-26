/** Explicit in-memory test controls. No OS events, Photos calls, or live network. */
type AppStatus = 'active' | 'background' | 'inactive';
const listeners = new Set<(status: AppStatus) => void>();
const parameters = new URLSearchParams(location.search);
export const fixtureState = parameters.get('state') ?? 'attract';
export const fixtureControls = {
  appState: 'active' as AppStatus,
  online: !['pending', 'offline'].includes(fixtureState),
  readyAcknowledged: fixtureState !== 'partial-ready',
  cameraCalls: 0,
  cameraPermissionRequests: 0,
  openSettingsCalls: 0,
  photoPermissionRequests: 0,
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
