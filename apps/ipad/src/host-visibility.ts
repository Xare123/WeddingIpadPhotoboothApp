/** An OS authentication prompt may itself make iOS inactive; background always revokes. */
export function createHostVisibility() {
  let epoch = 0;
  let authenticating: number | null = null;
  return {
    epoch: () => epoch,
    begin() { if (authenticating !== null) return null; authenticating = ++epoch; return authenticating; },
    finish(ticket: number) { if (authenticating === ticket) authenticating = null; return ticket === epoch; },
    current: (ticket: number) => ticket === epoch,
    suspend(state: string) { if (state === 'background' || authenticating === null) epoch++; },
    close() { epoch++; },
  };
}
