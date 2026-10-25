/** DEV ONLY: inspectable synthetic signals; never OS or network APIs. */
type State = 'active' | 'background' | 'inactive';
const listeners = new Set<(state: State) => void>();
export const fixtureControls = {
  appState: 'active' as State,
  online: new URLSearchParams(location.search).get('state') !== 'offline-pending',
  cameraCalls: 0,
  permissionRequests: 0,
  openSettingsCalls: 0,
  setOnline(online: boolean) { this.online = online; },
  setAppState(state: State) { this.appState = state; for (const listener of listeners) listener(state); },
};
(globalThis as typeof globalThis & { __NATIVE_VISUAL_FIXTURE__: typeof fixtureControls }).__NATIVE_VISUAL_FIXTURE__ = fixtureControls;
export const AppState = {
  get currentState() { return fixtureControls.appState; },
  addEventListener(_event: string, callback: (state: State) => void) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; },
};
