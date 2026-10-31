/** Backend-only, one-address-per-gallery email delivery. No recipient or link is logged/stored. */
export type GuestEmailEnv = {
  PHOTOS: R2Bucket; MODE: string; EMAIL_MODE?: string; EMAIL_FROM?: string;
  EMAIL_SENDER_VERIFIED?: string; EMAIL_DAILY_LIMIT?: string; RESEND_API_KEY?: string;
  LINK_SIGNING_KEY?: string; LOCAL_LINK_KEY?: string;
};
type Status = 'accepted' | 'pending' | 'uncertain' | 'rejected' | 'unavailable' | 'quota-exhausted' | 'mocked';
export type GuestEmailResult = { status: number; body: { status: Status; message: string; retryable: false } };
type Fence = { version: 1; fingerprint: string; status: 'sending' | 'accepted' | 'uncertain' | 'rejected' | 'quota-exhausted' | 'mocked' };
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function validAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && value.split('@')[0]!.length <= 64 && address.test(value);
}
function dailyLimit(env: GuestEmailEnv): number | undefined {
  if (env.EMAIL_DAILY_LIMIT === undefined) return 100;
  if (!/^[1-9]\d{0,2}$/.test(env.EMAIL_DAILY_LIMIT)) return;
  const value = Number(env.EMAIL_DAILY_LIMIT);
  if (value <= 100) return value;
}
function signingKey(env: GuestEmailEnv): string | undefined {
  return env.MODE === 'local' ? env.LOCAL_LINK_KEY : env.LINK_SIGNING_KEY;
}
export function emailConfigured(env: GuestEmailEnv): boolean {
  if (env.EMAIL_MODE === 'mock') return env.MODE === 'local' && !!signingKey(env);
  return env.EMAIL_MODE === 'resend' && env.EMAIL_SENDER_VERIFIED === 'approved' &&
    typeof env.RESEND_API_KEY === 'string' && /^re_[A-Za-z0-9_-]{8,}$/.test(env.RESEND_API_KEY) &&
    validAddress(env.EMAIL_FROM) && !!signingKey(env) && dailyLimit(env) !== undefined;
}
function result(status: Status, code = 200): GuestEmailResult {
  const messages: Record<Status, string> = {
    accepted: 'The email provider accepted the request. Delivery is not confirmed.',
    pending: 'This gallery already has an email request in progress. No second email was sent.',
    uncertain: 'The email outcome is unknown. Do not send again; save or share the gallery link instead.',
    rejected: 'The email request was not accepted. Save or share the gallery link instead.',
    unavailable: 'Email sharing is unavailable. Save or share the gallery link instead.',
    'quota-exhausted': 'The daily email allowance is full. Save or share the gallery link instead.',
    mocked: 'Email sharing was simulated locally. No email was sent.',
  };
  return { status: code, body: { status, message: messages[status], retryable: false } };
}
async function recipient(request: Request): Promise<string | undefined> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return;
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1024)) return;
  if (!request.body) return;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 1024) return;
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'email') || body.consent !== true || !validAddress(body.email)) return;
    return body.email.toLowerCase();
  } catch { return; }
}
async function fingerprint(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`guest-email:v1:${email}`));
  return Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, '0')).join('');
}
function validFence(value: unknown): value is Fence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Fence;
  return record.version === 1 && /^[a-f0-9]{64}$/.test(record.fingerprint) &&
    ['sending', 'accepted', 'uncertain', 'rejected', 'quota-exhausted', 'mocked'].includes(record.status);
}
/** Conditional slots cap this booth to EMAIL_DAILY_LIMIT (1..100, default100) per UTC day.
 * Use a lower cap when the Resend account also serves other apps: this is not an account-wide quota.
 * Slots are never refunded after ambiguity/rejection; do not delete them to recover quota. */
async function claimDailySlot(env: GuestEmailEnv, clock: () => number, expiresAt: number): Promise<{ day: string } | 'full' | 'expired' | 'day-changed'> {
  const limit = dailyLimit(env); if (!limit) throw new Error('Unavailable email quota');
  for (let slot = 0; slot < limit; slot++) {
    // Admission is charged to the current UTC day, not request/body-start time.
    const now = clock();
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) || expiresAt <= now) return 'expired';
    const day = new Date(now).toISOString().slice(0, 10);
    const claimed = await env.PHOTOS.put(`email-quota/v1/${day}/${String(slot).padStart(3, '0')}.json`,
      '{"version":1,"claimed":true}', { onlyIf: { etagDoesNotMatch: '*' } });
    if (claimed) {
      const completedAt = clock();
      if (!Number.isFinite(completedAt) || !Number.isFinite(new Date(completedAt).getTime()) || expiresAt <= completedAt) return 'expired';
      // A storage write may finish after UTC rollover. Keep the consumed slot, but never send against yesterday's quota.
      if (new Date(completedAt).toISOString().slice(0, 10) !== day) return 'day-changed';
      return { day };
    }
  }
  return 'full';
}
async function boundedProviderResult(response: Response): Promise<'accepted' | 'rejected' | 'uncertain'> {
  if (response.status >= 400 && response.status < 500) return 'rejected';
  if (!response.ok || !response.body) return 'uncertain';
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > 4096) return 'uncertain'; chunks.push(part.value); }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    return typeof value.id === 'string' && uuid.test(value.id) ? 'accepted' : 'uncertain';
  } catch { return 'uncertain'; }
  finally { await reader.cancel().catch(() => {}); }
}
/** Root must validate the capability, expiry/revocation, Origin and SHARE rate limits first. */
export async function handleGuestEmail(request: Request, env: GuestEmailEnv,
  gallery: { sessionId: string; expiresAt: number }, galleryUrl: string,
  fetcher: typeof fetch = fetch, time: number | (() => number) = Date.now): Promise<GuestEmailResult> {
  const clock = typeof time === 'function' ? time : () => time;
  const alive = () => {
    try { const now = clock(); return Number.isFinite(now) && Number.isFinite(new Date(now).getTime()) && gallery.expiresAt > now; }
    catch { return false; }
  };
  if (!emailConfigured(env) || request.method !== 'POST') return result('unavailable', 503);
  if (!uuid.test(gallery.sessionId) || !Number.isFinite(gallery.expiresAt) || !alive())
    return result('unavailable', 410);
  try {
    const url = new URL(galleryUrl);
    if ((url.protocol !== 'https:' && !(env.MODE === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || !/^\/g\/[a-f0-9]{64}$/.test(url.pathname)) return result('unavailable', 503);
  } catch { return result('unavailable', 503); }
  let email: string | undefined;
  try { email = await recipient(request); } catch { return result('rejected', 400); }
  if (!email) return result('rejected', 400);
  if (!alive()) return result('unavailable', 410);
  const key = `email-deliveries/v1/${gallery.sessionId.toLowerCase()}.json`;
  try {
    const fresh: Fence = { version: 1, fingerprint: await fingerprint(email, signingKey(env)!), status: 'sending' };
    const claim = await env.PHOTOS.put(key, JSON.stringify(fresh), { onlyIf: { etagDoesNotMatch: '*' } });
    if (!claim) {
      const object = await env.PHOTOS.get(key); if (!object) return result('unavailable', 503);
      const saved: unknown = await object.json(); if (!validFence(saved)) return result('unavailable', 503);
      if (saved.fingerprint !== fresh.fingerprint) return result('rejected', 409);
      return saved.status === 'sending' ? result('pending', 202) : result(saved.status, saved.status === 'uncertain' ? 202 : 200);
    }
    let outcome: Fence['status'];
    if (env.EMAIL_MODE === 'mock') outcome = 'mocked';
    else {
      try {
        const admission = await claimDailySlot(env, clock, gallery.expiresAt);
        if (admission === 'expired' || !alive()) return result('unavailable', 410);
        if (admission === 'full') outcome = 'quota-exhausted';
        else if (admission === 'day-changed' || new Date(clock()).toISOString().slice(0, 10) !== admission.day) outcome = 'rejected';
        else {
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetcher('https://api.resend.com/emails', {
              // Workerd supports manual/follow, not redirect:error. Never forward key/body to a redirect.
              method: 'POST', redirect: 'manual', signal: controller.signal,
              headers: { Authorization: `Bearer ${env.RESEND_API_KEY!}`, 'Content-Type': 'application/json',
                'Idempotency-Key': `wedding-email-v1-${gallery.sessionId.toLowerCase()}` },
              body: JSON.stringify({ from: env.EMAIL_FROM!, to: [email], subject: 'Your wedding photobooth photos',
                text: `Your private wedding photos are ready.\n\nView and download: ${galleryUrl}\n\nAnyone with this link can access these photos. Share it only with care. The gallery link expires; save your favorites while it is available.`,
              }),
            });
            outcome = await boundedProviderResult(response);
          } catch { outcome = 'uncertain'; }
          finally { clearTimeout(timer); }
        }
      } catch { outcome = 'uncertain'; }
    }
    try {
      const saved = await env.PHOTOS.put(key, JSON.stringify({ ...fresh, status: outcome }), { onlyIf: { etagMatches: claim.etag } });
      if (!saved) return result('uncertain', 202);
    } catch { return result('uncertain', 202); }
    return result(outcome, outcome === 'uncertain' ? 202 : outcome === 'quota-exhausted' ? 429 : 200);
  } catch { return result('unavailable', 503); }
}
export const handleGalleryEmail = handleGuestEmail;
