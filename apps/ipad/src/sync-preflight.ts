import type { QueueStore } from '@wedding-booth/core';
import type { ConnectionConfig } from './sharing';
import { smsRequestExpired } from './sms-state';

// One immutable connection snapshot per serialized drain. A missing/invalid
// Keychain value is a local setup condition, never a network failure.
export function createConnectionPreflight(read: () => Promise<ConnectionConfig | null>, enabled = () => true) {
  let connection: ConnectionConfig | null = null;
  return {
    async check(): Promise<boolean> {
      connection = null;
      if (!enabled()) return false;
      try {
        const value = await read();
        if (value && typeof value.token === 'string' && value.token.trim() && typeof value.origin === 'string') connection = { ...value };
      } catch { /* No raw Keychain/configuration error enters logs or jobs. */ }
      return connection !== null;
    },
    current: () => connection,
  };
}

// Expire retained recipients even if the booth is unpaired. This changes only
// expired share requests; upload history and completed acknowledgements stay.
export async function expirePendingShares(store: QueueStore, now = Date.now()): Promise<void> {
  const jobs = await store.list();
  for (const job of jobs) if (job.kind === 'share' && job.state === 'pending' && smsRequestExpired(job, jobs, now))
    await store.save({ ...job, state: 'expired' });
}
