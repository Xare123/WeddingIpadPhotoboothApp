import type { HostAuthenticationCode } from './host-auth-policy';
type DiagnosticStage = 'requested' | 'os-success' | 'foreground-ready' | 'blocked' | 'failed' | 'lifecycle';
type Diagnostic = { stage: DiagnosticStage; appState: string; pending: boolean; code?: HostAuthenticationCode };
/** An OS authentication prompt may itself make iOS inactive; background always revokes. */
export function createHostVisibility() {
  let epoch = 0;
  let authenticating: number | null = null;
  let suspension = 0;
  const diagnostics: Diagnostic[] = [];
  const current = (ticket: number) => ticket === epoch;
  return {
    epoch: () => epoch,
    begin() { if (authenticating !== null) return null; authenticating = ++epoch; return authenticating; },
    finish(ticket: number) { if (authenticating === ticket) authenticating = null; return current(ticket); },
    current,
    record(stage: DiagnosticStage, appState: unknown, code?: HostAuthenticationCode) {
      diagnostics.push({ stage, appState: typeof appState === 'string' && ['active', 'inactive', 'background'].includes(appState) ? appState : 'unknown',
        pending: authenticating !== null, ...(code ? { code } : {}) });
      if (diagnostics.length > 12) diagnostics.shift();
    },
    diagnostics: () => diagnostics.map(value => ({ ...value })),
    async authenticate(ticket: number, authenticate: () => Promise<void>, dependencies: {
      isActive(): boolean; wait(ms: number): Promise<void>; now?: () => number;
    }): Promise<boolean> {
      if (!current(ticket) || authenticating !== ticket) return false;
      await authenticate();
      return this.waitForActive(ticket, dependencies);
    },
    /** Keep the prompt's ticket reserved until foreground notifications have settled.
     * A successful OS result alone never restores a revoked/backgrounded lease.
     */
    async waitForActive(ticket: number, dependencies: {
      isActive(): boolean;
      wait(ms: number): Promise<void>;
      now?: () => number;
    }): Promise<boolean> {
      const now = dependencies.now ?? Date.now;
      const deadline = now() + 2000;
      let activeSince: number | null = null;
      let observedSuspension = suspension;
      while (now() < deadline) {
        if (!current(ticket) || authenticating !== ticket) return false;
        if (observedSuspension !== suspension) { activeSince = null; observedSuspension = suspension; }
        if (dependencies.isActive()) {
          activeSince ??= now();
          if (now() - activeSince >= 150) return true;
        } else activeSince = null;
        await dependencies.wait(50);
      }
      return false;
    },
    suspend(state: string) { suspension++; if (state === 'background' || authenticating === null) epoch++; },
    close() { epoch++; },
  };
}
