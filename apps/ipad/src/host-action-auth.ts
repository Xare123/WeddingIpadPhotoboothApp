import type { createHostVisibility } from './host-visibility';

export type HostActionLease = Readonly<{ ticket: number; assertCurrent(): void }>;
export type HostActionAuthorization = { authenticate(): Promise<void>; assertCurrent(): void };

/** Each mutation obtains fresh OS authentication; no cached host-screen grant. */
export async function authenticateHostAction(dependencies: {
  visibility: ReturnType<typeof createHostVisibility>;
  authenticate(): Promise<void>;
  isActive(): boolean;
  wait(ms: number): Promise<void>;
  now?: () => number;
}): Promise<HostActionLease> {
  const { visibility } = dependencies;
  if (!dependencies.isActive()) throw new Error('Return to the booth and authenticate Host again before continuing.');
  const ticket = visibility.begin();
  if (ticket === null) throw new Error('Complete or cancel the current iPad authentication before trying this host action again.');
  try {
    const ready = await visibility.authenticate(ticket, dependencies.authenticate, dependencies);
    if (!ready || !visibility.finish(ticket)) throw new Error('The iPad left the booth or authentication did not return to the foreground. Open Host and authenticate again.');
    const lease: HostActionLease = Object.freeze({ ticket, assertCurrent() {
      if (!visibility.current(ticket) || !dependencies.isActive()) {
        throw new Error('This host action is no longer authorized. Return to Host and authenticate again.');
      }
    } });
    lease.assertCurrent();
    return lease;
  } catch (error) {
    // A cancelled/failed action cannot leave a usable ticket. Never revoke a newer one.
    if (visibility.current(ticket)) visibility.close();
    throw error;
  } finally { visibility.finish(ticket); }
}
