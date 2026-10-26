import type { SessionPublicationAssets } from './local-types';
import { publicationAssets, publicationAssetIds, type PublicationSession } from './publication';
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

// A four-photo success must acknowledge the complete recipe sent by this
// client. Older servers can upload safely but cannot publish a template QR.
export function validateReadyPublication(value: unknown, expected: SessionPublicationAssets): void {
  if (!expected.composite) return;
  if (!value || typeof value !== 'object') throw new Error('Publication was not acknowledged');
  const result = value as Record<string, unknown>;
  const sameIds = (actual: unknown, ids: string[] | undefined) => Array.isArray(actual) && !!ids &&
    actual.length === ids.length && actual.every((id, index) => id === ids[index]);
  const expectedComposite = expected.composite;
  const keys = ['photoId', 'layout', 'theme', 'version', ...(expectedComposite.version === 'wedding-template-v2' ? ['gridAspect'] : [])];
  const composite = result.composite as Record<string, unknown> | null | undefined;
  if (!sameIds(result.photoIds, expected.photoIds) || !sameIds(result.originalPhotoIds, expected.originalPhotoIds) ||
    !composite || typeof composite !== 'object' || Array.isArray(composite) ||
    Object.keys(composite).length !== keys.length || Object.keys(composite).some(key => !keys.includes(key)) ||
    composite.photoId !== expectedComposite.photoId || composite.layout !== expectedComposite.layout || composite.theme !== expectedComposite.theme ||
    composite.version !== expectedComposite.version || (expectedComposite.version === 'wedding-template-v2' &&
      (!['portrait', 'square'].includes(expectedComposite.gridAspect) || composite.gridAspect !== expectedComposite.gridAspect))) throw new Error('Publication was not acknowledged');
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
  session: PublicationSession | null | undefined,
  jobs: { kind: string; state: string; sessionId: string; photoId: string; guestUrl?: string; guestExpiresAt?: number }[],
  now = Date.now(),
): { url: string; expiresAt: number } | null {
  if (!session) return null;
  const assets = publicationAssets(session);
  if (!assets) return null;
  const selected = publicationAssetIds(assets).map(photoId => jobs.find(job => job.kind === 'upload' && job.sessionId === session.id && job.photoId === photoId));
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
