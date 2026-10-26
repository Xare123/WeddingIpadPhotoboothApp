import type { QueueJob } from '@wedding-booth/core';

export function smsCapability(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const health = value as Record<string, unknown>;
  return health.status === 'ok' && health.sms === 'textbelt' && health.smsAvailable === true;
}

export function smsOutcome(job: QueueJob | undefined): string | null {
  if (!job || job.kind !== 'share') return null;
  switch (job.state) {
    case 'pending': return 'Text request saved. Waiting for the sharing service.';
    case 'complete': return 'The provider accepted your text. Delivery is not yet confirmed.';
    case 'mocked': return 'Practice only. No text was sent.';
    case 'test_accepted': return 'Provider test accepted. No text was sent.';
    case 'uncertain': return 'The text result could not be confirmed. We will not send it again automatically. Please use your QR code.';
    case 'rejected': return 'The provider did not accept the text. Please use your QR code.';
    case 'expired': return 'This photo link has expired and the text result is unconfirmed. No further text will be requested automatically. Please ask the host.';
  }
}

export function smsRequestExpired(job: QueueJob, jobs: QueueJob[], now = Date.now()): boolean {
  if (job.kind !== 'share') return false;
  const expiries = [job.guestExpiresAt, ...jobs.filter(value =>
    value.kind === 'upload' && value.sessionId === job.sessionId).map(value => value.guestExpiresAt)]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return expiries.length > 0 && Math.min(...expiries) <= now;
}
