/** Private R2 storage: never enable the bucket's public URL or public listing. */
export interface Env {
  PHOTOS: R2Bucket;
  MODE: string;
  SMS_MODE: string;
  LOCAL_DEVICE_TOKEN?: string;
  LOCAL_LINK_KEY?: string;
  DEVICE_TOKEN?: string;
  LINK_SIGNING_KEY?: string;
  PUBLIC_ORIGIN?: string;
  LINK_TTL_SECONDS?: string;
  PAIRING_ENABLED?: string;
  PAIRING_TTL_SECONDS?: string;
  TEXTBELT_API_KEY?: string;
  TEXTBELT_TEST_ENABLED?: string;
  TEXTBELT_LIVE_APPROVED?: string;
  TEXTBELT_ELIGIBILITY_APPROVED?: string;
  RATE_GALLERY_GLOBAL?: RateLimit;
  RATE_GALLERY_CLIENT?: RateLimit;
  RATE_PHOTO_GLOBAL?: RateLimit;
  RATE_PHOTO_CLIENT?: RateLimit;
  RATE_API_GLOBAL?: RateLimit;
  RATE_API_CLIENT?: RateLimit;
  RATE_SHARE_GLOBAL?: RateLimit;
  RATE_SHARE_CLIENT?: RateLimit;
}

type Config = { deviceToken: string; signingKey: string; origin: string; ttlMs: number };
type GalleryComposite = { photoId: string; layout: 'strip' | 'grid'; theme: 'classic' | 'botanical' | 'coastal' } & (
  { version: 'wedding-template-v1' } | { version: 'wedding-template-v2'; gridAspect: 'portrait' | 'square' } | { version: 'wedding-template-v3'; gridAspect: 'square' }
);
type GalleryRecipe = { photoIds: string[]; originalPhotoIds?: string[]; composite?: GalleryComposite };
type Gallery = GalleryRecipe & { version: 1; sessionId: string; expiresAt: number };
type SmsStatus = 'mocked' | 'mock_failed' | 'accepted' | 'test_accepted' | 'rejected' | 'uncertain';
type SmsResult = { status: SmsStatus; message: string; retryable: boolean; safeToRetry?: boolean; deliveryStatus?: 'unconfirmed' };
type ProviderDiagnostic = {
  stage: 'response' | 'http' | 'transport' | 'invalid-response';
  httpStatus?: number; messageId?: string; quotaRemaining?: number;
  rejection?: 'out-of-quota' | 'incomplete-request' | 'invalid-key' | 'invalid-number' | 'rate-limited' | 'blocked-recipient' | 'message-rejected' | 'provider-rejected';
};
type ShareRecord = { sessionId: string; recipientFingerprint: string; status: 'pending' | 'sending' | SmsStatus };
type DeliveryRecord = ShareRecord & { shareId: string; mode: string; attemptId?: string; providerDiagnostic?: ProviderDiagnostic };
type PairingRecord = { issuanceId: string; expiresAt: number; state: 'issued' | 'consumed'; deviceVersion: string; signingVersion: string };
export interface SmsProvider {
  // Textbelt has no provider-side idempotency guarantee. The caller must claim
  // a durable delivery fence before calling send, and never retry uncertainty.
  send(input: { idempotencyKey: string; to: string; galleryUrl: string }): Promise<{
    status: SmsStatus; message: string; retryable: boolean; safeToRetry?: boolean; deliveryStatus?: 'unconfirmed';
    // Private adapter result only: never returned in the guest/device response.
    providerDiagnostic?: ProviderDiagnostic;
  }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const PHOTO_LIMIT = 10 * 1024 * 1024;
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });
const photoKey = (sessionId: string, photoId: string) => `sessions/${sessionId}/photos/${photoId}.jpg`;
const galleryKey = (hash: string) => `galleries/${hash}.json`;
const revokedKey = (hash: string) => `revocations/${hash}.json`;
// Session revocation is independent of the signing key, so rotating credentials
// cannot create a fresh link for a permanently revoked session.
const sessionRevokedKey = (sessionId: string) => `revocations/sessions/${sessionId}.json`;
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
const digest = async (value: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', value));
async function signed(value: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}
const tokenFor = (sessionId: string, key: string) => signed(`gallery:v1:${sessionId}`, key);
const strongSecret = (value: string | undefined): value is string =>
  !!value && encoder.encode(value).length >= 32 && new Set(value).size >= 12 &&
  value !== 'local-development-only' && value !== 'local-link-key-not-for-production';
async function deviceAuthorized(request: Request, expected: string): Promise<boolean> {
  // Both comparisons always receive fixed-size digests, including missing,
  // malformed, and differently sized Authorization header values.
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('Authorization') ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${expected}`)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
const rateBindings = [
  'RATE_GALLERY_GLOBAL', 'RATE_GALLERY_CLIENT', 'RATE_PHOTO_GLOBAL', 'RATE_PHOTO_CLIENT',
  'RATE_API_GLOBAL', 'RATE_API_CLIENT', 'RATE_SHARE_GLOBAL', 'RATE_SHARE_CLIENT',
] as const;
type RateBand = 'GALLERY' | 'PHOTO' | 'API' | 'SHARE';
function rateBand(url: URL): RateBand | undefined {
  if (url.pathname.startsWith('/g/')) return /^\/g\/[^/]+\/photos\//.test(url.pathname) ? 'PHOTO' : 'GALLERY';
  if (url.pathname === '/v1/shares' || url.pathname.startsWith('/v1/pairing/')) return 'SHARE';
  if (url.pathname.startsWith('/v1/')) return 'API';
}
function limitResponse(url: URL, status: 429 | 503): Response {
  const page = url.pathname.startsWith('/g/') && !/^\/g\/[^/]+\/photos\//.test(url.pathname);
  const response = page ? unavailableGallery(status) : json({
    error: status === 429 ? 'Request limit reached; please retry shortly' : 'Request protection unavailable', retryable: true,
  }, status);
  if (status === 429) response.headers.set('Retry-After', '60');
  return response;
}
async function protectStorage(request: Request, url: URL, env: Env): Promise<Response | undefined> {
  const present = rateBindings.filter(name => env[name] !== undefined);
  // Tests may omit the complete policy in loopback-only mode. Wrangler local
  // development supplies the same native bindings through Miniflare. Never use
  // isolate memory, an optional flag, or this local bypass in production.
  if (env.MODE === 'local' && present.length === 0) return;
  if (!rateBindings.every(name => typeof env[name]?.limit === 'function')) return limitResponse(url, 503);
  const band = rateBand(url);
  if (!band) return; // Health/unknown routes perform no storage operations.
  const global = env[`RATE_${band}_GLOBAL`]!;
  const client = env[`RATE_${band}_CLIENT`]!;
  // Only the edge-generated CF-Connecting-IP is considered, and only on a
  // Cloudflare request. Ignore X-Forwarded-For/X-Real-IP and untrusted direct
  // headers; an unavailable client identity uses a shared anonymous bucket.
  const edgeIp = request.cf ? request.headers.get('CF-Connecting-IP')?.trim().toLowerCase() : undefined;
  const trustedIp = edgeIp && edgeIp.length <= 45 && /^[0-9a-f:.]+$/.test(edgeIp) ? edgeIp : 'anonymous';
  const prefix = `limit:v1:${band.toLowerCase()}`;
  const scopes: [RateLimit, string][] = [
    [global, `${prefix}:global`],
    [client, `${prefix}:client:${await digest(encoder.encode(trustedIp))}`],
  ];
  const token = /^\/g\/([a-f0-9]{64})(?:\/|$)/.exec(url.pathname)?.[1];
  if (token) scopes.push([client, `${prefix}:gallery:${await digest(encoder.encode(token))}`]);
  try {
    // Global route keys bound storage amplification even when attackers rotate
    // tokens or addresses. Native limits are approximate and POP-scoped, never
    // a strict globally coordinated request budget or financial spend cap.
    for (const [limiter, key] of scopes) {
      const outcome = await limiter.limit({ key });
      if (!outcome || typeof outcome.success !== 'boolean') return limitResponse(url, 503);
      if (!outcome.success) return limitResponse(url, 429);
    }
  } catch { return limitResponse(url, 503); }
}
function configFor(url: URL, env: Env): Config | undefined {
  const ttl = env.LINK_TTL_SECONDS === undefined ? 86_400 : Number(env.LINK_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 30 * 86_400) return;
  if (env.MODE === 'local') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !env.LOCAL_DEVICE_TOKEN || !env.LOCAL_LINK_KEY) return;
    return { deviceToken: env.LOCAL_DEVICE_TOKEN, signingKey: env.LOCAL_LINK_KEY, origin: url.origin, ttlMs: ttl * 1000 };
  }
  if (env.MODE !== 'production' || !strongSecret(env.DEVICE_TOKEN) ||
    !strongSecret(env.LINK_SIGNING_KEY) || env.DEVICE_TOKEN === env.LINK_SIGNING_KEY || !env.PUBLIC_ORIGIN) return;
  let origin: URL;
  try { origin = new URL(env.PUBLIC_ORIGIN); } catch { return; }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
    origin.search || origin.hash || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
    url.origin !== origin.origin) return;
  return { deviceToken: env.DEVICE_TOKEN, signingKey: env.LINK_SIGNING_KEY, origin: origin.origin, ttlMs: ttl * 1000 };
}
async function readLimited(request: Pick<Request, 'body'>, limit: number): Promise<Uint8Array | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > limit) { await reader.cancel(); return; }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function readJson(request: Request, limit = 16_384): Promise<Record<string, unknown> | Response> {
  const bytes = await readLimited(request, limit);
  if (!bytes) return json({ error: 'Request too large' }, 413);
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { return json({ error: 'Invalid JSON object' }, 400); }
}
async function loadGallery(env: Env, hash: string): Promise<Gallery | Response> {
  if (await env.PHOTOS.head(revokedKey(hash))) return json({ error: 'Link revoked' }, 410);
  const object = await env.PHOTOS.get(galleryKey(hash));
  if (!object) return json({ error: 'Gallery is not ready' }, 404);
  const gallery = await object.json<Gallery>();
  if (await env.PHOTOS.head(sessionRevokedKey(gallery.sessionId))) return json({ error: 'Link revoked' }, 410);
  if (gallery.expiresAt <= Date.now()) return json({ error: 'Link expired' }, 410);
  return gallery;
}
const samePhotos = (left: string[], right: string[]) => left.length === right.length && left.every((id, i) => id === right[i]);
function parseGalleryRecipe(body: Record<string, unknown>): GalleryRecipe | Response {
  if (Object.keys(body).some(key => !['photoIds', 'originalPhotoIds', 'composite'].includes(key)))
    return json({ error: 'Unknown gallery field' }, 400);
  const ids = (value: unknown): string[] | undefined => Array.isArray(value) && value.length >= 1 && value.length <= 100 &&
    value.every(id => typeof id === 'string' && uuid.test(id)) ? (value as string[]).map(id => id.toLowerCase()) : undefined;
  const photoIds = ids(body.photoIds);
  if (!photoIds || new Set(photoIds).size !== photoIds.length) return json({ error: 'Unique valid photo IDs required' }, 400);
  const hasOriginals = Object.hasOwn(body, 'originalPhotoIds'), hasComposite = Object.hasOwn(body, 'composite');
  if (!hasOriginals && !hasComposite) return { photoIds };
  if (!hasOriginals || !hasComposite) return json({ error: 'Original photo IDs and composite must be supplied together' }, 400);
  const originalPhotoIds = ids(body.originalPhotoIds);
  if (!originalPhotoIds || originalPhotoIds.length !== photoIds.length || new Set(originalPhotoIds).size !== originalPhotoIds.length)
    return json({ error: 'Unique original photo IDs must match the selected photo count and order' }, 400);
  const candidate = body.composite;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return json({ error: 'Valid composite required' }, 400);
  const composite = candidate as Record<string, unknown>;
  const v2 = composite.version === 'wedding-template-v2', v3 = composite.version === 'wedding-template-v3';
  const keys = ['photoId', 'layout', 'theme', 'version', ...(v2 || v3 ? ['gridAspect'] : [])];
  if (Object.keys(composite).length !== keys.length || Object.keys(composite).some(key => !keys.includes(key)) ||
    typeof composite.photoId !== 'string' || !uuid.test(composite.photoId) ||
    !['strip', 'grid'].includes(composite.layout as string) || !['classic', 'botanical', 'coastal'].includes(composite.theme as string) ||
    (!v2 && !v3 && composite.version !== 'wedding-template-v1') ||
    (v2 && !['portrait', 'square'].includes(composite.gridAspect as string)) ||
    (v3 && composite.gridAspect !== 'square')) return json({ error: 'Unknown or invalid composite recipe' }, 400);
  const photoId = composite.photoId.toLowerCase();
  if (photoIds.includes(photoId) || originalPhotoIds.includes(photoId)) return json({ error: 'Composite must have a distinct photo ID' }, 400);
  const common = { photoId, layout: composite.layout as GalleryComposite['layout'], theme: composite.theme as GalleryComposite['theme'] };
  return { photoIds, originalPhotoIds, composite: v3 ? { ...common, version: 'wedding-template-v3', gridAspect: 'square' } : v2 ? { ...common, version: 'wedding-template-v2', gridAspect: composite.gridAspect as 'portrait' | 'square' } : { ...common, version: 'wedding-template-v1' } };
}
function sameRecipe(left: GalleryRecipe, right: GalleryRecipe): boolean {
  return samePhotos(left.photoIds, right.photoIds) &&
    (left.originalPhotoIds === undefined && right.originalPhotoIds === undefined ||
      !!left.originalPhotoIds && !!right.originalPhotoIds && samePhotos(left.originalPhotoIds, right.originalPhotoIds)) &&
    (left.composite === undefined && right.composite === undefined || !!left.composite && !!right.composite &&
      left.composite.photoId === right.composite.photoId && left.composite.layout === right.composite.layout &&
      left.composite.theme === right.composite.theme && left.composite.version === right.composite.version &&
      (left.composite.version === 'wedding-template-v1' || right.composite.version !== 'wedding-template-v1' && left.composite.gridAspect === right.composite.gridAspect));
}
const galleryPhotoIds = (gallery: GalleryRecipe): string[] => [...new Set([
  ...gallery.photoIds, ...(gallery.originalPhotoIds ?? []), ...(gallery.composite ? [gallery.composite.photoId] : []),
])];
const completeShareGallery = (gallery: GalleryRecipe): boolean => gallery.photoIds.length === 5 ||
  gallery.photoIds.length === 4 && gallery.originalPhotoIds?.length === 4 && !!gallery.composite;
function readyGallery(gallery: Gallery, origin: string, token: string): Response {
  return json({ status: 'ready', url: `${origin}/g/${token}`, expiresAt: gallery.expiresAt,
    ...(gallery.photoIds.length === 4 ? { photoIds: gallery.photoIds, originalPhotoIds: gallery.originalPhotoIds, composite: gallery.composite } : {}),
  });
}
function mockProvider(mode: string): SmsProvider | undefined {
  if (mode !== 'mock' && mode !== 'mock-fail') return;
  return { async send() {
    return mode === 'mock' ? { status: 'mocked', message: 'No text message was sent', retryable: false } :
      { status: 'mock_failed', message: 'Simulated provider failure; no text message was sent', retryable: true };
  } };
}
function smsResult(status: SmsStatus): SmsResult {
  switch (status) {
    case 'accepted': return { status, message: 'Textbelt accepted the request; delivery is not confirmed', retryable: false, deliveryStatus: 'unconfirmed' };
    case 'test_accepted': return { status, message: 'Textbelt test accepted; no text message was sent', retryable: false };
    case 'rejected': return { status, message: 'Textbelt rejected the request; an operator may explicitly retry', retryable: false, safeToRetry: true };
    case 'uncertain': return { status, message: 'The send outcome is unknown; no automatic resend will occur. Use the gallery link.', retryable: false, safeToRetry: false };
    case 'mocked': return { status, message: 'No text message was sent', retryable: false };
    case 'mock_failed': return { status, message: 'Simulated provider failure; no text message was sent', retryable: true };
  }
}
/** Injectable boundary. Tests MUST pass a fake fetch; never call a real provider. */
export function createTextbeltProvider(apiKey: string, testMode: boolean, fetcher: typeof fetch): SmsProvider {
  function diagnostic(value: Record<string, unknown>, phone: string): ProviderDiagnostic {
    const result: ProviderDiagnostic = { stage: 'response' };
    const id = typeof value.textId === 'number' && Number.isSafeInteger(value.textId) ? String(value.textId) : value.textId;
    if (value.success === true && typeof id === 'string' && /^\d{1,32}$/.test(id) && id !== apiKey && id !== phone.replace(/\D/g, '')) result.messageId = id;
    if (typeof value.quotaRemaining === 'number' && Number.isSafeInteger(value.quotaRemaining) && value.quotaRemaining >= 0 && value.quotaRemaining <= 1_000_000_000) result.quotaRemaining = value.quotaRemaining;
    if (value.success === false) {
      // Classify into fixed strings. Never retain an untrusted error body,
      // recipient, message/link or key, even if the provider echoes them.
      const error = typeof value.error === 'string' ? value.error : '';
      result.rejection = /out of quota|insufficient quota|quota.*(?:exhausted|exceeded|empty)/i.test(error) ? 'out-of-quota'
        : /incomplete request|missing required/i.test(error) ? 'incomplete-request'
          : /invalid.*key|key.*invalid/i.test(error) ? 'invalid-key'
            : /invalid.*(?:phone|number)|(?:phone|number).*invalid/i.test(error) ? 'invalid-number'
              : /too many|rate.?limit/i.test(error) ? 'rate-limited'
                : /blocked|opt.?out|unsubscrib/i.test(error) ? 'blocked-recipient'
                  : /url|domain|link|message.*reject/i.test(error) ? 'message-rejected' : 'provider-rejected';
    }
    return result;
  }
  return { async send({ to, galleryUrl }) {
    try {
      const response = await fetcher('https://textbelt.com/text', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ phone: to, message: `Your wedding photos are ready: ${galleryUrl}`, key: testMode ? `${apiKey}_test` : apiKey }).toString(),
      });
      // A transport/HTTP/parser failure can happen after a provider accepted the
      // request. Textbelt offers no deduplication contract, so never resend it.
      if (!response.ok) return { ...smsResult('uncertain'), providerDiagnostic: { stage: 'http', httpStatus: response.status } };
      const bytes = await readLimited(response, 4096);
      if (!bytes) return { ...smsResult('uncertain'), providerDiagnostic: { stage: 'invalid-response' } };
      let result: unknown;
      try { result = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return { ...smsResult('uncertain'), providerDiagnostic: { stage: 'invalid-response' } }; }
      if (!result || typeof result !== 'object' || !('success' in result) || typeof result.success !== 'boolean')
        return { ...smsResult('uncertain'), providerDiagnostic: { stage: 'invalid-response' } };
      const providerDiagnostic = diagnostic(result as Record<string, unknown>, to);
      if (result.success === false) return { ...smsResult('rejected'), providerDiagnostic };
      return { ...smsResult(testMode ? 'test_accepted' : 'accepted'), providerDiagnostic };
    } catch { return { ...smsResult('uncertain'), providerDiagnostic: { stage: 'transport' } }; }
  } };
}
function smsProvider(env: Env): SmsProvider | undefined {
  const mock = mockProvider(env.SMS_MODE);
  if (mock) return mock;
  const key = env.TEXTBELT_API_KEY;
  if (!key || key.length > 512 || /\s/.test(key) || key === 'textbelt' || key.endsWith('_test')) return;
  if (env.SMS_MODE === 'textbelt-test' && env.TEXTBELT_TEST_ENABLED === 'approved') return createTextbeltProvider(key, true, fetch);
  if (env.SMS_MODE === 'textbelt' && env.TEXTBELT_LIVE_APPROVED === 'true' && env.TEXTBELT_ELIGIBILITY_APPROVED === 'true')
    return createTextbeltProvider(key, false, fetch);
}
function liveSmsAvailable(env: Env): boolean {
  return env.SMS_MODE === 'textbelt' && !!smsProvider(env);
}
async function textbeltShare(env: Env, provider: SmsProvider, shareId: string, fresh: ShareRecord,
  phone: string, galleryUrl: string, expiresAt: number, explicitRetry: boolean): Promise<Response> {
  // One recipient per session. This independent session fence survives gallery
  // signing-key rotation and prevents new share IDs from bypassing uncertainty.
  const key = `sms-deliveries/textbelt/${fresh.sessionId}.json`;
  await env.PHOTOS.put(key, JSON.stringify({ ...fresh, shareId, mode: env.SMS_MODE }), { onlyIf: { etagDoesNotMatch: '*' } });
  const saved = await env.PHOTOS.get(key);
  if (!saved) throw new Error('Missing delivery fence');
  const record = await saved.json<DeliveryRecord>();
  if (record.recipientFingerprint !== fresh.recipientFingerprint || record.mode !== env.SMS_MODE)
    return json({ error: 'Session SMS is already reserved; use the gallery link', retryable: false }, 409);
  const respond = (status: SmsStatus) => json({ ...smsResult(status), url: galleryUrl, expiresAt }, status === 'uncertain' ? 202 : 200);
  if (record.status === 'sending' || record.status === 'uncertain') return respond('uncertain');
  if (record.status !== 'pending' && record.status !== 'rejected') return respond(record.status);
  if (record.status === 'rejected' && !explicitRetry) return respond('rejected');
  if (record.shareId !== shareId) return json({ error: 'Use the original share id for an explicit retry', retryable: false }, 409);
  // Each claim changes its content-derived R2 ETag, including explicit retries.
  // An old attempt can never satisfy the current attempt's conditional write.
  const { providerDiagnostic: _previousDiagnostic, ...reserved } = record;
  const attempt = { ...reserved, status: 'sending', attemptId: crypto.randomUUID() };
  const claimed = await env.PHOTOS.put(key, JSON.stringify(attempt), { onlyIf: { etagMatches: saved.etag } });
  if (!claimed) return respond('uncertain');
  // Persisted 'sending' is intentionally never reset by timeout or a new ID.
  // A process crash, lost response, or failed final write cannot cause a resend.
  const outcome = await provider.send({ idempotencyKey: shareId, to: phone, galleryUrl });
  try {
    const updated = await env.PHOTOS.put(key, JSON.stringify({ ...attempt, status: outcome.status,
      ...(outcome.providerDiagnostic ? { providerDiagnostic: outcome.providerDiagnostic } : {}) }), { onlyIf: { etagMatches: claimed.etag } });
    if (!updated) return respond('uncertain');
  } catch { return respond('uncertain'); }
  return respond(outcome.status);
}
async function pairing(request: Request, env: Env, config: Config, path: string): Promise<Response> {
  const ttl = env.PAIRING_TTL_SECONDS === undefined ? 300 : Number(env.PAIRING_TTL_SECONDS);
  if (env.PAIRING_ENABLED !== 'approved' || !Number.isInteger(ttl) || ttl < 60 || ttl > 600)
    return json({ error: 'Device pairing is disabled' }, 503);
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (path === '/v1/pairing/codes' && !await deviceAuthorized(request, config.deviceToken)) return json({ error: 'Unauthorized' }, 401);
  const body = await readJson(request, 1024);
  if (body instanceof Response) return body;
  const deviceVersion = await digest(encoder.encode(config.deviceToken));
  const signingVersion = await digest(encoder.encode(config.signingKey));
  if (path === '/v1/pairing/codes') {
    if (typeof body.id !== 'string' || !uuid.test(body.id)) return json({ error: 'Valid issuance id required' }, 400);
    const issuanceId = body.id.toLowerCase();
    const code = await signed(`pair:v1:${issuanceId}`, config.signingKey);
    const key = `pairing/${await digest(encoder.encode(code))}.json`;
    const fresh: PairingRecord = { issuanceId, expiresAt: Date.now() + ttl * 1000, state: 'issued', deviceVersion, signingVersion };
    await env.PHOTOS.put(key, JSON.stringify(fresh), { onlyIf: { etagDoesNotMatch: '*' } });
    const object = await env.PHOTOS.get(key);
    if (!object) throw new Error('Missing pairing record');
    const saved = await object.json<PairingRecord>();
    if (saved.state !== 'issued') return json({ error: 'Pairing code already consumed; issue a new code' }, 409);
    if (saved.expiresAt <= Date.now() || saved.deviceVersion !== deviceVersion || saved.signingVersion !== signingVersion) return json({ error: 'Pairing code expired or revoked; issue a new code' }, 410);
    return json({ status: 'issued', code, expiresAt: saved.expiresAt, origin: config.origin });
  }
  if (path !== '/v1/pairing/consume') return json({ error: 'Not found' }, 404);
  if (typeof body.code !== 'string' || !/^[a-f0-9]{64}$/.test(body.code)) return json({ error: 'Valid pairing code required' }, 400);
  const key = `pairing/${await digest(encoder.encode(body.code))}.json`;
  const object = await env.PHOTOS.get(key);
  if (!object) return json({ error: 'Pairing code unavailable' }, 404);
  const saved = await object.json<PairingRecord>();
  const currentCode = await signed(`pair:v1:${saved.issuanceId}`, config.signingKey);
  if (saved.expiresAt <= Date.now() || saved.deviceVersion !== deviceVersion || saved.signingVersion !== signingVersion ||
    !crypto.subtle.timingSafeEqual(encoder.encode(body.code), encoder.encode(currentCode)))
    return json({ error: 'Pairing code expired or revoked' }, 410);
  if (saved.state !== 'issued') return json({ error: 'Pairing code already consumed; issue a new code' }, 409);
  const consumed = await env.PHOTOS.put(key, JSON.stringify({ ...saved, state: 'consumed' }), { onlyIf: { etagMatches: object.etag } });
  if (!consumed) return json({ error: 'Pairing code already consumed; issue a new code' }, 409);
  // Single-use, fail-closed claim. A lost response requires a fresh owner-issued
  // code; it never replays a credential. OS authentication and Keychain storage
  // belong to the app; the server does not claim hardware/Face ID attestation.
  return json({ status: 'paired', deviceToken: config.deviceToken, origin: config.origin });
}
const galleryStyles = `
  :root{color-scheme:light;--paper:#f6efe4;--ink:#3b342b;--muted:#6d6256;--line:#dcd1bf;--white:#fbf6ec;--forest:#9a4f32}
  *{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  a{color:inherit}a:focus-visible{outline:3px solid var(--forest);outline-offset:5px}::selection{background:#d9e4df;color:var(--ink)}
  .shell{max-width:1220px;margin:auto;padding:0 44px}.masthead{display:flex;align-items:center;justify-content:center;gap:18px;padding:35px 0;border-bottom:1px solid var(--line)}
  .brand{font-size:12px;letter-spacing:1.2px;font-weight:500}.ornament{width:7px;height:7px;border:1px solid #b8964f;transform:rotate(45deg);flex:none}
  .hero{text-align:center;max-width:740px;margin:0 auto;padding:72px 0 49px}.eyebrow{margin:0 0 18px;font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted)}
  h1{font:400 clamp(42px,6.2vw,76px)/1.06 Georgia,"Times New Roman",serif;letter-spacing:-2.4px;margin:0 0 24px}h1 span{display:block;font-style:italic;font-weight:400}
  .intro{text-wrap:pretty;max-width:475px;margin:0 auto;color:var(--muted);font-size:16px;line-height:1.8}.collection-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 0 20px;border-top:1px solid var(--line)}
  .collection-heading h2{font-size:10px;letter-spacing:2px;font-weight:600;margin:0;text-transform:uppercase}.collection-heading p{margin:0;font-size:12px;color:var(--muted)}
  .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:24px;align-items:start}.photo{margin:0;padding:12px 12px 0;background:var(--white);border:1px solid #e0d5c4;border-radius:4px;box-shadow:0 8px 24px #3b342b08;min-width:0}
  .photo img{display:block;width:100%;height:auto;background:#ebe3d6;border-radius:1px}.photo figcaption{padding:20px 6px 22px}.photo-label{display:flex;align-items:center;justify-content:space-between;font-size:10px;letter-spacing:1.8px;color:var(--muted);text-transform:uppercase;margin-bottom:16px}.photo-label span:last-child{font:italic 18px Georgia,serif;letter-spacing:0;color:var(--ink)}
  .download{display:flex;align-items:center;justify-content:center;gap:12px;min-height:48px;padding:12px 18px;text-align:center;background:var(--forest);border:1px solid var(--forest);border-radius:30px;text-decoration:none;color:var(--white);font-size:13px;font-weight:500;transition:background .18s,transform .18s}
  .download:hover{background:#813f29;transform:translateY(-1px)}.download:active{transform:translateY(0)}.download .arrow{font-size:19px;line-height:1}.quality{margin:11px 0 0;text-align:center;font-size:10px;color:var(--muted);letter-spacing:.3px}
  .keepsake-section{margin-bottom:48px}.keepsake{margin:0 auto;padding:18px;background:var(--white);border:1px solid #e0d5c4;border-radius:4px;max-width:820px;box-shadow:0 8px 24px #3b342b08}.keepsake-strip{max-width:390px}.keepsake img{display:block;width:100%;height:auto}.keepsake figcaption{padding:2px 0 20px}.keepsake .download{max-width:340px;margin:auto}.original-section{margin-top:48px}.original-intro{color:var(--muted);font-size:14px;margin:0 0 12px}.originals{list-style:none;margin:0;padding:0}.originals li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}.original-name{font:400 21px Georgia,serif}.originals .download{background:transparent;color:var(--ink);border-color:#b4aa98;min-width:165px}.originals .download:hover{background:#eee5d7}
  .privacy{max-width:520px;text-align:center;margin:56px auto 48px}.privacy h2{font:400 25px Georgia,serif;margin:0 0 12px}.privacy p{color:var(--muted);font-size:13px;line-height:1.85;margin:0}.privacy .expiry{font-size:11px;margin-top:14px}
  .footer{border-top:1px solid var(--line);text-align:center;padding:25px 0 30px;color:var(--muted);font:italic 18px Georgia,serif}.reveal{animation:reveal .65s ease-out both}.photo:nth-child(2){animation-delay:.09s}.photo:nth-child(n+3){animation-delay:.18s}
  .error-page{max-width:650px;min-height:65vh;margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:64px 0}.error-page h1{font-size:clamp(42px,7vw,66px)}.error-page .intro{max-width:390px}.error-mark{width:52px;height:52px;border:1px solid #a9beb5;border-radius:50%;display:grid;place-items:center;margin-bottom:30px;font:italic 28px Georgia,serif;color:#3e6760}
  @keyframes reveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @media(min-width:1100px){.photos:has(.photo:only-child){max-width:650px;margin:auto}}@media(max-width:700px){.shell{padding:0 23px}.masthead{padding:25px 0;gap:13px}.brand{font-size:10px;letter-spacing:.8px}.hero{padding:49px 0 36px}h1{letter-spacing:-1.4px}.intro{font-size:14px;max-width:330px}.photos{gap:24px}.collection-heading{padding:19px 0}.collection-heading p{font-size:10px}.privacy{margin:40px auto 34px}.photo{padding:10px 10px 0}.photo figcaption{padding:18px 6px 20px}.footer{font-size:16px}.download{min-height:50px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.download:hover{transform:none}}
`;
function guestDocument(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#f6efe4"><title>${title}</title><style>${galleryStyles}</style></head><body><div class="shell"><header class="masthead"><span class="ornament" aria-hidden="true"></span><span class="brand">Gizelle &amp; Rami · November 1, 2026</span><span class="ornament" aria-hidden="true"></span></header>${content}<footer class="footer">Made of moments like these.</footer></div></body></html>`;
}
function guestPage(html: string, status = 200): Response {
  return new Response(html, { status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}
function unavailableGallery(status: number, reason?: string): Response {
  const expired = reason === 'Link expired';
  const title = expired ? 'This link has expired.' : status === 410 ? 'This gallery is closed.' : status === 429 ? 'A little pause.' : 'A moment, out of reach.';
  const message = expired ? 'For your privacy, photo links are available for a limited time. Ask your hosts about another way to save your memories.' :
    status === 410 ? 'This private gallery is no longer available. Please ask your hosts if you need help with your photos.' :
    status === 429 ? 'This gallery has received too many requests. Please wait a minute, then open your link again.' :
    status === 503 ? 'Your photos are taking a little longer to load. Please try this link again in a moment.' :
    'We couldn’t find a gallery at this address. Check that you opened the complete link, or ask your hosts for help.';
  return guestPage(guestDocument('Your wedding photos', `<main class="error-page reveal"><div class="error-mark" aria-hidden="true">✧</div><p class="eyebrow">Your private gallery</p><h1>${title}</h1><p class="intro">${message}</p></main>`), status);
}
function galleryHtml(token: string, gallery: Gallery): string {
  const items = gallery.photoIds.map((id, i) => `<figure class="photo reveal"><img src="/g/${token}/photos/${id}" alt="Wedding photo ${i + 1}" loading="${i === 0 && !gallery.composite ? 'eager' : 'lazy'}" decoding="async"><figcaption><div class="photo-label"><span>A moment to keep</span><span>${String(i + 1).padStart(2, '0')}</span></div><a class="download" href="/g/${token}/photos/${id}?download=1" download aria-label="Download photo ${i + 1} in full resolution"><span class="arrow" aria-hidden="true">↓</span>${gallery.composite ? 'Save individual photo' : 'Save original photo'}</a><p class="quality">Full resolution · JPEG</p></figcaption></figure>`).join('');
  let keepsake = '';
  if (gallery.composite) {
    const composite = gallery.composite, strip = composite.layout === 'strip';
    const layout = strip ? 'photo strip' : 'photo grid';
    const theme = composite.theme === 'botanical' ? 'Botanical' : composite.theme === 'coastal' ? 'Coastal' : 'Classic';
    keepsake = `<section class="keepsake-section" aria-labelledby="keepsake-title"><div class="collection-heading"><h2 id="keepsake-title">Your wedding keepsake</h2><p>${theme} · ${strip ? 'Photo strip' : 'Photo grid'}</p></div><figure class="keepsake${strip ? ' keepsake-strip' : ''} reveal"><figcaption><a class="download" href="/g/${token}/photos/${composite.photoId}?download=1" download aria-label="Download your ${layout} in full resolution"><span class="arrow" aria-hidden="true">↓</span>Save ${layout}</a><p class="quality">Full resolution · JPEG</p></figcaption><img src="/g/${token}/photos/${composite.photoId}" alt="Your ${theme.toLowerCase()} wedding ${layout}" loading="eager" decoding="async"></figure></section>`;
  }
  const originals = gallery.originalPhotoIds ? `<section class="original-section" aria-labelledby="originals-title"><div class="collection-heading"><h2 id="originals-title">Your camera originals</h2><p>${gallery.originalPhotoIds.length} original files</p></div><p class="original-intro">Save each camera original, in the same order as your keepsake.</p><ol class="originals">${gallery.originalPhotoIds.map((id, i) => `<li><span class="original-name">Original ${String(i + 1).padStart(2, '0')}</span><a class="download" href="/g/${token}/photos/${id}?download=1" download aria-label="Download camera original ${i + 1} in full resolution">Save original ${i + 1}</a></li>`).join('')}</ol></section>` : '';
  const expires = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(gallery.expiresAt));
  return guestDocument('Your wedding photos', `<main><section class="hero reveal" aria-labelledby="gallery-title"><p class="eyebrow">A keepsake from the celebration</p><h1 id="gallery-title">Your night,<span>beautifully captured.</span></h1><p class="intro">A little joy to take home.</p></section>${keepsake}<section aria-label="Your photos"><div class="collection-heading"><h2>${gallery.composite ? 'Your individual photos' : 'Your wedding photos'}</h2><p>${gallery.photoIds.length} ${gallery.photoIds.length === 1 ? 'memory' : 'memories'} · original quality</p></div><div class="photos">${items}</div></section>${originals}<aside class="privacy"><h2>A private keepsake.</h2><p>Anyone with this link can view and download these photos.<br>Save your favorites, and forward this link only with care.</p><p class="expiry">Available until <time datetime="${new Date(gallery.expiresAt).toISOString()}">${expires} UTC</time>.<br>Link expiry closes access; it does not delete the original photos.</p></aside></main>`);
}
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const config = configFor(url, env);
  if (!config) return json({ error: 'Service configuration unavailable' }, 503);
  const protection = await protectStorage(request, url, env);
  if (protection) return protection;
  if (url.pathname === '/health' && request.method === 'GET')
    return json({ status: 'ok', storage: env.MODE === 'local' ? 'local-r2' : 'private-r2', sms: env.SMS_MODE, smsAvailable: liveSmsAvailable(env) });

  const guest = /^\/g\/([a-f0-9]{64})(?:\/photos\/([0-9a-f-]+))?$/.exec(url.pathname);
  if (guest && request.method === 'GET') {
    const token = guest[1]!;
    const gallery = await loadGallery(env, await digest(encoder.encode(token)));
    if (gallery instanceof Response) {
      if (guest[2]) return gallery;
      const detail = await gallery.json<{ error: string }>();
      return unavailableGallery(gallery.status, detail.error);
    }
    // A token is a bearer credential. Checking the current signature makes key
    // rotation revoke every old link, including existing hashed R2 manifests.
    const currentToken = await tokenFor(gallery.sessionId, config.signingKey);
    if (!crypto.subtle.timingSafeEqual(encoder.encode(token), encoder.encode(currentToken)))
      return guest[2] ? json({ error: 'Link revoked' }, 410) : unavailableGallery(410, 'Link revoked');
    if (!guest[2]) return guestPage(galleryHtml(token, gallery));
    const photoId = guest[2].toLowerCase();
    if (!uuid.test(photoId) || !galleryPhotoIds(gallery).includes(photoId)) return json({ error: 'Photo unavailable' }, 404);
    const photo = await env.PHOTOS.get(photoKey(gallery.sessionId, photoId));
    if (!photo) return json({ error: 'Photo unavailable' }, 404);
    const selectedIndex = gallery.photoIds.indexOf(photoId);
    const filename = gallery.composite?.photoId === photoId ? `wedding-keepsake-${gallery.composite.layout === 'strip' ? 'strip' : 'grid'}.jpg` :
      selectedIndex >= 0 ? `wedding-photo-${selectedIndex + 1}.jpg` : `wedding-original-${gallery.originalPhotoIds!.indexOf(photoId) + 1}.jpg`;
    return new Response(photo.body, { headers: {
      ...privateHeaders, 'Content-Type': 'image/jpeg', 'Content-Length': String(photo.size),
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
    } });
  }
  if (!url.pathname.startsWith('/v1/')) return request.method === 'GET' && url.pathname.startsWith('/g/') ? unavailableGallery(404) : json({ error: 'Not found' }, 404);
  if (url.pathname === '/v1/pairing/codes' || url.pathname === '/v1/pairing/consume') return pairing(request, env, config, url.pathname);
  if (!await deviceAuthorized(request, config.deviceToken)) return json({ error: 'Unauthorized' }, 401);
  const upload = /^\/v1\/sessions\/([0-9a-f-]+)\/photos\/([0-9a-f-]+)$/i.exec(url.pathname);
  if (upload && request.method === 'PUT') {
    const sessionId = upload[1]!.toLowerCase(), photoId = upload[2]!.toLowerCase();
    if (!uuid.test(sessionId) || !uuid.test(photoId)) return json({ error: 'Invalid session or photo id' }, 400);
    if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'image/jpeg') return json({ error: 'JPEG required' }, 415);
    const bytes = await readLimited(request, PHOTO_LIMIT);
    if (!bytes) return json({ error: 'Photo exceeds 10 MiB' }, 413);
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
      return json({ error: 'Invalid JPEG markers' }, 400);
    const sha256 = await digest(bytes);
    const key = photoKey(sessionId, photoId);
    const existing = await env.PHOTOS.head(key);
    if (existing) return existing.customMetadata?.sha256 === sha256
      ? json({ id: photoId, sessionId, status: 'stored' }) : json({ error: 'Photo id already used' }, 409);
    const stored = await env.PHOTOS.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { sha256 },
    });
    if (!stored) {
      const winner = await env.PHOTOS.head(key);
      return winner?.customMetadata?.sha256 === sha256 ? json({ id: photoId, sessionId, status: 'stored' }) : json({ error: 'Photo id already used' }, 409);
    }
    return json({ id: photoId, sessionId, status: 'stored' }, 201);
  }
  const sessionRoute = /^\/v1\/sessions\/([0-9a-f-]+)\/(ready|gallery)$/i.exec(url.pathname);
  if (sessionRoute) {
    const sessionId = sessionRoute[1]!.toLowerCase();
    if (!uuid.test(sessionId)) return json({ error: 'Invalid session id' }, 400);
    const token = await tokenFor(sessionId, config.signingKey);
    const hash = await digest(encoder.encode(token));
    if (sessionRoute[2] === 'gallery' && request.method === 'DELETE') {
      await env.PHOTOS.put(sessionRevokedKey(sessionId), JSON.stringify({ revokedAt: Date.now() }), { onlyIf: { etagDoesNotMatch: '*' } });
      await env.PHOTOS.put(revokedKey(hash), JSON.stringify({ revokedAt: Date.now() }), { onlyIf: { etagDoesNotMatch: '*' } });
      return json({ status: 'revoked' });
    }
    if (sessionRoute[2] === 'ready' && request.method === 'POST') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const recipe = parseGalleryRecipe(body);
      if (recipe instanceof Response) return recipe;
      if (await env.PHOTOS.head(sessionRevokedKey(sessionId)) || await env.PHOTOS.head(revokedKey(hash)))
        return json({ error: 'Link revoked' }, 410);
      const existing = await env.PHOTOS.head(galleryKey(hash));
      if (existing) {
        const saved = await loadGallery(env, hash);
        if (saved instanceof Response) return saved;
        if (!sameRecipe(saved, recipe)) return json({ error: 'Ready gallery recipe is immutable' }, 409);
        return readyGallery(saved, config.origin, token);
      }
      if (recipe.photoIds.length !== 4 && recipe.photoIds.length !== 5) return json({ error: 'Four template photos or five legacy photos are required for a new gallery' }, 400);
      if (recipe.photoIds.length === 4 && (!recipe.originalPhotoIds || !recipe.composite))
        return json({ error: 'Four-photo galleries require corresponding originals and a composite' }, 400);
      const uploaded = await Promise.all(galleryPhotoIds(recipe).map(id => env.PHOTOS.head(photoKey(sessionId, id))));
      if (uploaded.some(photo => !photo?.customMetadata?.sha256)) return json({ error: 'All photos must finish uploading before gallery is ready' }, 409);
      const manifest: Gallery = { version: 1, sessionId, ...recipe, expiresAt: Date.now() + config.ttlMs };
      await env.PHOTOS.put(galleryKey(hash), JSON.stringify(manifest), { onlyIf: { etagDoesNotMatch: '*' } });
      const saved = await loadGallery(env, hash);
      if (saved instanceof Response) return saved;
      if (!sameRecipe(saved, recipe)) return json({ error: 'Ready gallery recipe is immutable' }, 409);
      return readyGallery(saved, config.origin, token);
    }
  }
  if (url.pathname === '/v1/shares' && request.method === 'POST') {
    const provider = smsProvider(env);
    if (!provider) return json({ error: 'Live SMS disabled; an approved provider and sender are required' }, 503);
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (typeof body.id !== 'string' || !uuid.test(body.id) || typeof body.sessionId !== 'string' || !uuid.test(body.sessionId) ||
      typeof body.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(body.phone) || body.consent !== true)
      return json({ error: 'Valid IDs, an E.164 number and explicit consent are required' }, 400);
    const sessionId = body.sessionId.toLowerCase();
    if (await env.PHOTOS.head(sessionRevokedKey(sessionId))) return json({ error: 'Link revoked' }, 410);
    const token = await tokenFor(sessionId, config.signingKey);
    const hash = await digest(encoder.encode(token));
    const gallery = await loadGallery(env, hash);
    if (gallery instanceof Response) return gallery.status === 404 ? json({ error: 'Gallery must be ready before sharing' }, 409) : gallery;
    if (!completeShareGallery(gallery)) return json({ error: 'A complete four-photo template or five-photo legacy gallery is required before sharing', retryable: false }, 409);
    const key = `shares/${body.id.toLowerCase()}.json`;
    const fingerprint = await signed(`recipient:v1:${body.phone}`, config.signingKey);
    const fresh: ShareRecord = { sessionId, recipientFingerprint: fingerprint, status: 'pending' };
    await env.PHOTOS.put(key, JSON.stringify(fresh), { onlyIf: { etagDoesNotMatch: '*' } });
    const saved = await env.PHOTOS.get(key);
    if (!saved) throw new Error('Missing share record');
    const record = await saved.json<ShareRecord>();
    if (record.sessionId !== sessionId || record.recipientFingerprint !== fingerprint) return json({ error: 'Share id already used' }, 409);
    const galleryUrl = `${config.origin}/g/${token}`;
    if (record.status === 'mocked') return json({ status: 'mocked', message: 'No text message was sent', retryable: false, url: galleryUrl, expiresAt: gallery.expiresAt });
    if (env.SMS_MODE === 'textbelt' || env.SMS_MODE === 'textbelt-test')
      return textbeltShare(env, provider, body.id.toLowerCase(), fresh, body.phone, galleryUrl, gallery.expiresAt, body.retryRejected === true);
    const result = await provider.send({ idempotencyKey: body.id.toLowerCase(), to: body.phone, galleryUrl });
    // CAS prevents a late retry from overwriting another attempt's successful result.
    const updated = await env.PHOTOS.put(key, JSON.stringify({ ...record, status: result.status }), { onlyIf: { etagMatches: saved.etag } });
    if (!updated) return json({ error: 'Concurrent share attempt; retry with the same id', retryable: true }, 409);
    return json({ ...result, url: galleryUrl, expiresAt: gallery.expiresAt }, result.status === 'mock_failed' ? 503 : 200);
  }
  return json({ error: 'Not found' }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    // Never log phone numbers, bearer credentials, full URLs, or gallery tokens.
    catch {
      const url = new URL(request.url);
      if (request.method === 'GET' && /^\/g\/[^/]+\/?$/.test(url.pathname)) return unavailableGallery(503);
      return json({ error: 'Storage operation failed; retry with the same IDs', retryable: true }, 503);
    }
  },
};
