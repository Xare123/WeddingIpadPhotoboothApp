// Pure validation shared by native transport and readiness display.
export type ConnectionConfig = { origin: string; token: string };

export function validateOrigin(input: string, development: boolean): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid HTTPS API origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) {
    throw new Error('Use HTTPS. HTTP loopback is available only in development.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the API origin, without a path or credentials.');
  }
  return url.origin;
}

export function readyGuestPage(value: unknown, origin: string, now = Date.now()): {
  guestUrl: string; guestExpiresAt: number;
} {
  if (!value || typeof value !== 'object') throw new Error('Guest page is not ready');
  const result = value as Record<string, unknown>;
  if (result.status !== 'ready' || typeof result.url !== 'string' || typeof result.expiresAt !== 'number') {
    throw new Error('Guest page is not ready');
  }
  const url = new URL(result.url);
  if (url.origin !== origin || !/^\/g\/[^/]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Guest page address is invalid');
  }
  if (!Number.isFinite(result.expiresAt) || !Number.isFinite(new Date(result.expiresAt).getTime()) || result.expiresAt <= now) {
    throw new Error('Guest page has expired');
  }
  return { guestUrl: url.href, guestExpiresAt: result.expiresAt };
}

export function qrForJob(job: {
  kind: string; state: string; guestUrl?: string; guestExpiresAt?: number;
} | undefined, now = Date.now()): string | undefined {
  if (!job || job.kind !== 'upload' || job.state !== 'complete' || !job.guestUrl || !job.guestExpiresAt) return;
  if (!Number.isFinite(job.guestExpiresAt) || !Number.isFinite(new Date(job.guestExpiresAt).getTime()) || job.guestExpiresAt <= now) return;
  // Completed records are created only from readyGuestPage; defend against legacy
  // records with malformed URLs before handing them to a QR encoder.
  try {
    const url = new URL(job.guestUrl);
    // Emulator success is useful for local API testing, but a phone cannot use
    // the iPad's loopback/private network address. Guest QRs require a public
    // HTTPS hostname, never IP literals or local-only suffixes.
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !hostname.includes('.') || hostname.includes(':') || hostname.includes('[')) return;
    if (/^\d+(\.\d+){3}$/.test(hostname) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)) return;
    if (!/^\/g\/[^/]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) return;
    return url.href;
  } catch { return; }
}

export function normalizePhone(input: string): string {
  const phone = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error('Use an international phone number, including + and country code.');
  }
  return phone;
}

export function sessionGuestPage(
  session: { id: string; confirmed: boolean; targetCount?: number; shots: { id: string }[] } | null | undefined,
  jobs: { kind: string; state: string; sessionId: string; photoId: string; guestUrl?: string; guestExpiresAt?: number }[],
  now = Date.now(),
): { url: string; expiresAt: number } | null {
  if (!session?.confirmed || !session.shots.length || new Set(session.shots.map(s => s.id)).size !== session.shots.length) return null;
  if (session.targetCount !== undefined && session.shots.length !== session.targetCount) return null;
  const selected = session.shots.map(shot => jobs.find(job => job.kind === 'upload' && job.sessionId === session.id && job.photoId === shot.id));
  const first = selected[0];
  const url = qrForJob(first, now);
  if (!url || !first?.guestExpiresAt || selected.some(job =>
    qrForJob(job, now) !== url || job?.guestExpiresAt !== first.guestExpiresAt)) return null;
  return { url, expiresAt: first.guestExpiresAt };
}

// Uses the iPad's locale/time zone in production; explicit options make the
// acknowledged server expiry inspectable in deterministic tests.
export function formatGuestExpiry(
  expiresAt: number | undefined, locale?: string, timeZone?: string,
): string | undefined {
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) return;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(expiresAt));
  } catch { return; }
}
