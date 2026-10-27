import { parseQueueFailure, type QueueJob } from '@wedding-booth/core';
import type { ActiveSession } from './local-types';
import { publicationAssetIds, publicationAssets } from './publication';
import { sessionGuestPage } from './sharing';

// These describe observed local state, not whether the server accepts a token.
// A Keychain read failure is different from an absent connection. A failed
// request does not establish that the iPad is offline.
export type SharingConnectionState = 'checking' | 'unpaired' | 'paired' | 'unavailable';
export type SharingSyncState = 'idle' | 'running' | 'failed';
export type SharingNetworkState = 'unknown' | 'online' | 'offline';
export type SharingAction = 'none' | 'private-setup' | 'retry' | 'check-connection';
export type SharingStatus = 'saved' | 'checking' | 'setup-required' | 'connection-unavailable' |
  'queued' | 'offline' | 'upload-failed' | 'uploading' | 'publishing' | 'ready' | 'expired';
type SharingJob = Pick<QueueJob, 'kind' | 'state' | 'sessionId' | 'photoId' | 'attempts' | 'nextAttemptAt' | 'guestUrl' | 'guestExpiresAt' | 'lastFailure'>;
type Presentation = {
  title: string; message: string; hostMessage: string; action: SharingAction;
  savedCount: number; savedMessage: string;
};
export type ShareReadiness = Presentation & (
  { status: 'ready'; guestPage: { url: string; expiresAt: number } } |
  { status: Exclude<SharingStatus, 'ready'>; guestPage: null }
);
export type ShareReadinessInput = {
  session: ActiveSession | null | undefined;
  jobs: readonly SharingJob[];
  connection: SharingConnectionState;
  sync: SharingSyncState;
  // Leave unknown unless an independent connectivity observation exists.
  network?: SharingNetworkState;
  now?: number;
};

export function classifyShareReadiness(input: ShareReadinessInput): ShareReadiness {
  const { session, connection, sync } = input;
  const now = input.now ?? Date.now();
  const jobs = [...input.jobs];
  const savedCount = session?.shots.length ?? 0;
  const savedMessage = savedCount ? `${savedCount} original${savedCount === 1 ? '' : 's'} saved on this iPad` : 'No saved photos in this session';
  const base = { savedCount, savedMessage };
  const state = (status: Exclude<SharingStatus, 'ready'>, title: string, message: string, hostMessage: string, action: SharingAction): ShareReadiness =>
    ({ ...base, status, title, message, hostMessage, action, guestPage: null });

  // This is the existing complete-selection/role acknowledgement boundary.
  // A successful upload, share outcome, or partial URL never creates a QR.
  const guestPage = sessionGuestPage(session, jobs, now);
  if (guestPage) return { ...base, status: 'ready', title: 'Your photos are ready', message: 'Scan to save your private photo page.',
    hostMessage: 'The complete session has an acknowledged photo link.', action: 'none', guestPage };
  const previousPage = sessionGuestPage(session, jobs, 0);
  if (previousPage && previousPage.expiresAt <= now) return state('expired', 'This photo link has expired',
    'Your originals remain saved on this iPad. Ask the host for help saving a copy.',
    'The acknowledged gallery has expired. Retrying does not extend its lifetime; use the saved-session export.', 'none');

  const assets = session ? publicationAssets(session) : null;
  if (!session) return state('saved', 'No saved session',
    'Take and keep your photos on this iPad before creating a photo link.',
    'There is no active saved session to share.', 'none');
  if (!assets) return state('saved', 'Saved here on the iPad',
    'Finish and keep your session before creating a photo link.',
    'Complete and confirm the saved session and its keepsake before sharing.', 'none');
  if (connection === 'checking') return state('checking', 'Checking sharing setup',
    'Your photos stay saved while the booth checks its connection settings.',
    'Read the saved private connection settings before starting an upload.', 'none');
  if (connection === 'unpaired') return state('setup-required', 'Ask the host to connect sharing',
    'Your photos are saved on this iPad. The host needs to finish private setup before a download link can be made.',
    'Open private Setup and pair this iPad using an owner-issued one-time code. Retrying uploads cannot finish missing setup.', 'private-setup');
  if (connection === 'unavailable') return state('connection-unavailable', 'Sharing settings need attention',
    'Your photos are saved on this iPad. Ask the host to check sharing setup.',
    'The saved connection could not be read or validated. Check private Setup; this does not establish a network outage.', 'check-connection');
  if (input.network === 'offline') return state('offline', 'Waiting for a connection',
    'Your photos are saved on this iPad. Sharing can resume when the booth reconnects.',
    'The iPad reports no network connection. Reconnect, then retry sharing.', 'retry');

  const selected = publicationAssetIds(assets).map(photoId => jobs.find(job => job.kind === 'upload' && job.sessionId === session.id && job.photoId === photoId));
  const unfinished = selected.filter(job => !job || job.state !== 'complete');
  if (sync === 'running' && unfinished.some(job => job?.state === 'pending' && job.nextAttemptAt <= now)) return state('uploading', 'Preparing your download link',
    'Sharing is in progress. Your originals remain saved on this iPad.',
    'A sharing pass is running with eligible session uploads. Wait for the complete session acknowledgement.', 'none');
  const latestFailure = selected.flatMap(job => {
    const failure = parseQueueFailure(job?.lastFailure);
    return failure && failure.operation !== 'share' ? [failure] : [];
  }).sort((left, right) => right.at - left.at)[0];
  if (latestFailure?.category === 'authorization') return state('upload-failed', 'Sharing needs the host',
    'Your photos are saved on this iPad. Ask the host to check private sharing setup.',
    `The sharing server refused authorization${latestFailure.httpStatus ? ` (HTTP ${latestFailure.httpStatus})` : ''}. Check private Setup; a saved connection alone does not prove current server authorization.`, 'private-setup');
  if (latestFailure) return state('upload-failed', 'Sharing needs a retry',
    'Your photos are saved on this iPad. Ask the host to retry sharing.',
    latestFailure.category === 'rate-limited' ? 'The sharing server asked the booth to slow down. Wait before retrying.' :
      latestFailure.category === 'server' ? 'The sharing server could not complete the request. Retry later; originals remain saved.' :
      latestFailure.category === 'network' ? 'A sharing fetch was not acknowledged. This does not prove the iPad is offline or that bytes reached the server. Retry sharing.' :
      latestFailure.category === 'invalid-response' ? 'The server response did not acknowledge the complete session. Retry; no photo link is ready.' :
      'The sharing server rejected the request. Retry and check private Setup if it continues.', 'retry');
  if (sync === 'failed' || unfinished.some(job => job && job.attempts > 0)) return state('upload-failed', 'Sharing needs a retry',
    'Your photos are saved on this iPad. Ask the host to retry sharing.',
    'Sharing was not acknowledged. Retry and check private setup if it continues; the failure does not establish that the iPad is offline.', 'retry');
  if (!unfinished.length) return state('publishing', 'Finishing your photo link',
    'Your photos have uploaded. The complete private page still needs confirmation.',
    'All required uploads are acknowledged; wait for or retry the immutable session-ready request. Do not display an upload URL as a QR.', sync === 'running' ? 'none' : 'retry');
  return state('queued', 'Your photos are waiting to share',
    'Your originals are saved on this iPad. Their download link is not ready yet.',
    selected.some(job => !job) ? 'The saved session needs upload-index repair before all assets can upload. Retry sharing to repair and resume.' :
      'The session has queued uploads. Retry sharing to resume; no network outage has been established.', 'retry');
}
