// services/api/src/index.ts
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var encoder = new TextEncoder();
var PHOTO_LIMIT = 10 * 1024 * 1024;
var privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
var json = (value, status = 200) => Response.json(value, { status, headers: privateHeaders });
var photoKey = (sessionId, photoId) => `sessions/${sessionId}/photos/${photoId}.jpg`;
var galleryKey = (hash) => `galleries/${hash}.json`;
var revokedKey = (hash) => `revocations/${hash}.json`;
var sessionRevokedKey = (sessionId) => `revocations/sessions/${sessionId}.json`;
var hex = (value) => [...new Uint8Array(value)].map((x) => x.toString(16).padStart(2, "0")).join("");
var digest = async (value) => hex(await crypto.subtle.digest("SHA-256", value));
async function signed(value, key) {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}
var tokenFor = (sessionId, key) => signed(`gallery:v1:${sessionId}`, key);
var strongSecret = (value) => !!value && encoder.encode(value).length >= 32 && new Set(value).size >= 12 && value !== "local-development-only" && value !== "local-link-key-not-for-production";
async function deviceAuthorized(request, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(request.headers.get("Authorization") ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${expected}`))
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
var rateBindings = [
  "RATE_GALLERY_GLOBAL",
  "RATE_GALLERY_CLIENT",
  "RATE_PHOTO_GLOBAL",
  "RATE_PHOTO_CLIENT",
  "RATE_API_GLOBAL",
  "RATE_API_CLIENT",
  "RATE_SHARE_GLOBAL",
  "RATE_SHARE_CLIENT"
];
function rateBand(url) {
  if (url.pathname.startsWith("/g/")) return /^\/g\/[^/]+\/photos\//.test(url.pathname) ? "PHOTO" : "GALLERY";
  if (url.pathname === "/v1/shares" || url.pathname.startsWith("/v1/pairing/")) return "SHARE";
  if (url.pathname.startsWith("/v1/")) return "API";
}
function limitResponse(url, status) {
  const page = url.pathname.startsWith("/g/") && !/^\/g\/[^/]+\/photos\//.test(url.pathname);
  const response = page ? unavailableGallery(status) : json({
    error: status === 429 ? "Request limit reached; please retry shortly" : "Request protection unavailable",
    retryable: true
  }, status);
  if (status === 429) response.headers.set("Retry-After", "60");
  return response;
}
async function protectStorage(request, url, env) {
  const present = rateBindings.filter((name) => env[name] !== void 0);
  if (env.MODE === "local" && present.length === 0) return;
  if (!rateBindings.every((name) => typeof env[name]?.limit === "function")) return limitResponse(url, 503);
  const band = rateBand(url);
  if (!band) return;
  const global = env[`RATE_${band}_GLOBAL`];
  const client = env[`RATE_${band}_CLIENT`];
  const edgeIp = request.cf ? request.headers.get("CF-Connecting-IP")?.trim().toLowerCase() : void 0;
  const trustedIp = edgeIp && edgeIp.length <= 45 && /^[0-9a-f:.]+$/.test(edgeIp) ? edgeIp : "anonymous";
  const prefix = `limit:v1:${band.toLowerCase()}`;
  const scopes = [
    [global, `${prefix}:global`],
    [client, `${prefix}:client:${await digest(encoder.encode(trustedIp))}`]
  ];
  const token = /^\/g\/([a-f0-9]{64})(?:\/|$)/.exec(url.pathname)?.[1];
  if (token) scopes.push([client, `${prefix}:gallery:${await digest(encoder.encode(token))}`]);
  try {
    for (const [limiter, key] of scopes) {
      const outcome = await limiter.limit({ key });
      if (!outcome || typeof outcome.success !== "boolean") return limitResponse(url, 503);
      if (!outcome.success) return limitResponse(url, 429);
    }
  } catch {
    return limitResponse(url, 503);
  }
}
function configFor(url, env) {
  const ttl = env.LINK_TTL_SECONDS === void 0 ? 86400 : Number(env.LINK_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 30 * 86400) return;
  if (env.MODE === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !env.LOCAL_DEVICE_TOKEN || !env.LOCAL_LINK_KEY) return;
    return { deviceToken: env.LOCAL_DEVICE_TOKEN, signingKey: env.LOCAL_LINK_KEY, origin: url.origin, ttlMs: ttl * 1e3 };
  }
  if (env.MODE !== "production" || !strongSecret(env.DEVICE_TOKEN) || !strongSecret(env.LINK_SIGNING_KEY) || env.DEVICE_TOKEN === env.LINK_SIGNING_KEY || !env.PUBLIC_ORIGIN) return;
  let origin;
  try {
    origin = new URL(env.PUBLIC_ORIGIN);
  } catch {
    return;
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || url.origin !== origin.origin) return;
  return { deviceToken: env.DEVICE_TOKEN, signingKey: env.LINK_SIGNING_KEY, origin: origin.origin, ttlMs: ttl * 1e3 };
}
async function readLimited(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return;
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function readJson(request, limit = 16384) {
  const bytes = await readLimited(request, limit);
  if (!bytes) return json({ error: "Request too large" }, 413);
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    return json({ error: "Invalid JSON object" }, 400);
  }
}
async function loadGallery(env, hash) {
  if (await env.PHOTOS.head(revokedKey(hash))) return json({ error: "Link revoked" }, 410);
  const object = await env.PHOTOS.get(galleryKey(hash));
  if (!object) return json({ error: "Gallery is not ready" }, 404);
  const gallery = await object.json();
  if (await env.PHOTOS.head(sessionRevokedKey(gallery.sessionId))) return json({ error: "Link revoked" }, 410);
  if (gallery.expiresAt <= Date.now()) return json({ error: "Link expired" }, 410);
  return gallery;
}
var samePhotos = (left, right) => left.length === right.length && left.every((id, i) => id === right[i]);
function parseGalleryRecipe(body) {
  if (Object.keys(body).some((key) => !["photoIds", "originalPhotoIds", "composite"].includes(key)))
    return json({ error: "Unknown gallery field" }, 400);
  const ids = (value) => Array.isArray(value) && value.length >= 1 && value.length <= 100 && value.every((id) => typeof id === "string" && uuid.test(id)) ? value.map((id) => id.toLowerCase()) : void 0;
  const photoIds = ids(body.photoIds);
  if (!photoIds || new Set(photoIds).size !== photoIds.length) return json({ error: "Unique valid photo IDs required" }, 400);
  const hasOriginals = Object.hasOwn(body, "originalPhotoIds"), hasComposite = Object.hasOwn(body, "composite");
  if (!hasOriginals && !hasComposite) return { photoIds };
  if (!hasOriginals || !hasComposite) return json({ error: "Original photo IDs and composite must be supplied together" }, 400);
  const originalPhotoIds = ids(body.originalPhotoIds);
  if (!originalPhotoIds || originalPhotoIds.length !== photoIds.length || new Set(originalPhotoIds).size !== originalPhotoIds.length)
    return json({ error: "Unique original photo IDs must match the selected photo count and order" }, 400);
  const candidate = body.composite;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return json({ error: "Valid composite required" }, 400);
  const composite = candidate;
  if (Object.keys(composite).some((key) => !["photoId", "layout", "theme", "version"].includes(key)) || typeof composite.photoId !== "string" || !uuid.test(composite.photoId) || !["strip", "grid"].includes(composite.layout) || !["classic", "botanical", "coastal"].includes(composite.theme) || composite.version !== "wedding-template-v1") return json({ error: "Unknown or invalid composite recipe" }, 400);
  const photoId = composite.photoId.toLowerCase();
  if (photoIds.includes(photoId) || originalPhotoIds.includes(photoId)) return json({ error: "Composite must have a distinct photo ID" }, 400);
  return { photoIds, originalPhotoIds, composite: { photoId, layout: composite.layout, theme: composite.theme, version: "wedding-template-v1" } };
}
function sameRecipe(left, right) {
  return samePhotos(left.photoIds, right.photoIds) && (left.originalPhotoIds === void 0 && right.originalPhotoIds === void 0 || !!left.originalPhotoIds && !!right.originalPhotoIds && samePhotos(left.originalPhotoIds, right.originalPhotoIds)) && (left.composite === void 0 && right.composite === void 0 || !!left.composite && !!right.composite && left.composite.photoId === right.composite.photoId && left.composite.layout === right.composite.layout && left.composite.theme === right.composite.theme && left.composite.version === right.composite.version);
}
var galleryPhotoIds = (gallery) => [.../* @__PURE__ */ new Set([
  ...gallery.photoIds,
  ...gallery.originalPhotoIds ?? [],
  ...gallery.composite ? [gallery.composite.photoId] : []
])];
var completeShareGallery = (gallery) => gallery.photoIds.length === 5 || gallery.photoIds.length === 4 && gallery.originalPhotoIds?.length === 4 && !!gallery.composite;
function readyGallery(gallery, origin, token) {
  return json({
    status: "ready",
    url: `${origin}/g/${token}`,
    expiresAt: gallery.expiresAt,
    ...gallery.photoIds.length === 4 ? { photoIds: gallery.photoIds, originalPhotoIds: gallery.originalPhotoIds, composite: gallery.composite } : {}
  });
}
function mockProvider(mode) {
  if (mode !== "mock" && mode !== "mock-fail") return;
  return { async send() {
    return mode === "mock" ? { status: "mocked", message: "No text message was sent", retryable: false } : { status: "mock_failed", message: "Simulated provider failure; no text message was sent", retryable: true };
  } };
}
function smsResult(status) {
  switch (status) {
    case "accepted":
      return { status, message: "Textbelt accepted the request; delivery is not confirmed", retryable: false, deliveryStatus: "unconfirmed" };
    case "test_accepted":
      return { status, message: "Textbelt test accepted; no text message was sent", retryable: false };
    case "rejected":
      return { status, message: "Textbelt rejected the request; an operator may explicitly retry", retryable: false, safeToRetry: true };
    case "uncertain":
      return { status, message: "The send outcome is unknown; no automatic resend will occur. Use the gallery link.", retryable: false, safeToRetry: false };
    case "mocked":
      return { status, message: "No text message was sent", retryable: false };
    case "mock_failed":
      return { status, message: "Simulated provider failure; no text message was sent", retryable: true };
  }
}
function createTextbeltProvider(apiKey, testMode, fetcher) {
  return { async send({ to, galleryUrl }) {
    try {
      const response = await fetcher("https://textbelt.com/text", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(1e4),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ phone: to, message: `Your wedding photos are ready: ${galleryUrl}`, key: testMode ? `${apiKey}_test` : apiKey }).toString()
      });
      if (!response.ok) return smsResult("uncertain");
      const bytes = await readLimited(response, 4096);
      if (!bytes) return smsResult("uncertain");
      const result = JSON.parse(new TextDecoder().decode(bytes));
      if (!result || typeof result !== "object" || !("success" in result)) return smsResult("uncertain");
      if (result.success === false) return smsResult("rejected");
      if (result.success !== true) return smsResult("uncertain");
      return smsResult(testMode ? "test_accepted" : "accepted");
    } catch {
      return smsResult("uncertain");
    }
  } };
}
function smsProvider(env) {
  const mock = mockProvider(env.SMS_MODE);
  if (mock) return mock;
  const key = env.TEXTBELT_API_KEY;
  if (!key || key.length > 512 || /\s/.test(key) || key === "textbelt" || key.endsWith("_test")) return;
  if (env.SMS_MODE === "textbelt-test" && env.TEXTBELT_TEST_ENABLED === "approved") return createTextbeltProvider(key, true, fetch);
  if (env.SMS_MODE === "textbelt" && env.TEXTBELT_LIVE_APPROVED === "true" && env.TEXTBELT_ELIGIBILITY_APPROVED === "true")
    return createTextbeltProvider(key, false, fetch);
}
function liveSmsAvailable(env) {
  return env.SMS_MODE === "textbelt" && !!smsProvider(env);
}
async function textbeltShare(env, provider, shareId, fresh, phone, galleryUrl, expiresAt, explicitRetry) {
  const key = `sms-deliveries/textbelt/${fresh.sessionId}.json`;
  await env.PHOTOS.put(key, JSON.stringify({ ...fresh, shareId, mode: env.SMS_MODE }), { onlyIf: { etagDoesNotMatch: "*" } });
  const saved = await env.PHOTOS.get(key);
  if (!saved) throw new Error("Missing delivery fence");
  const record = await saved.json();
  if (record.recipientFingerprint !== fresh.recipientFingerprint || record.mode !== env.SMS_MODE)
    return json({ error: "Session SMS is already reserved; use the gallery link", retryable: false }, 409);
  const respond = (status) => json({ ...smsResult(status), url: galleryUrl, expiresAt }, status === "uncertain" ? 202 : 200);
  if (record.status === "sending" || record.status === "uncertain") return respond("uncertain");
  if (record.status !== "pending" && record.status !== "rejected") return respond(record.status);
  if (record.status === "rejected" && !explicitRetry) return respond("rejected");
  if (record.shareId !== shareId) return json({ error: "Use the original share id for an explicit retry", retryable: false }, 409);
  const attempt = { ...record, status: "sending", attemptId: crypto.randomUUID() };
  const claimed = await env.PHOTOS.put(key, JSON.stringify(attempt), { onlyIf: { etagMatches: saved.etag } });
  if (!claimed) return respond("uncertain");
  const outcome = await provider.send({ idempotencyKey: shareId, to: phone, galleryUrl });
  try {
    const updated = await env.PHOTOS.put(key, JSON.stringify({ ...attempt, status: outcome.status }), { onlyIf: { etagMatches: claimed.etag } });
    if (!updated) return respond("uncertain");
  } catch {
    return respond("uncertain");
  }
  return respond(outcome.status);
}
async function pairing(request, env, config, path) {
  const ttl = env.PAIRING_TTL_SECONDS === void 0 ? 300 : Number(env.PAIRING_TTL_SECONDS);
  if (env.PAIRING_ENABLED !== "approved" || !Number.isInteger(ttl) || ttl < 60 || ttl > 600)
    return json({ error: "Device pairing is disabled" }, 503);
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  if (path === "/v1/pairing/codes" && !await deviceAuthorized(request, config.deviceToken)) return json({ error: "Unauthorized" }, 401);
  const body = await readJson(request, 1024);
  if (body instanceof Response) return body;
  const deviceVersion = await digest(encoder.encode(config.deviceToken));
  const signingVersion = await digest(encoder.encode(config.signingKey));
  if (path === "/v1/pairing/codes") {
    if (typeof body.id !== "string" || !uuid.test(body.id)) return json({ error: "Valid issuance id required" }, 400);
    const issuanceId = body.id.toLowerCase();
    const code = await signed(`pair:v1:${issuanceId}`, config.signingKey);
    const key2 = `pairing/${await digest(encoder.encode(code))}.json`;
    const fresh = { issuanceId, expiresAt: Date.now() + ttl * 1e3, state: "issued", deviceVersion, signingVersion };
    await env.PHOTOS.put(key2, JSON.stringify(fresh), { onlyIf: { etagDoesNotMatch: "*" } });
    const object2 = await env.PHOTOS.get(key2);
    if (!object2) throw new Error("Missing pairing record");
    const saved2 = await object2.json();
    if (saved2.state !== "issued") return json({ error: "Pairing code already consumed; issue a new code" }, 409);
    if (saved2.expiresAt <= Date.now() || saved2.deviceVersion !== deviceVersion || saved2.signingVersion !== signingVersion) return json({ error: "Pairing code expired or revoked; issue a new code" }, 410);
    return json({ status: "issued", code, expiresAt: saved2.expiresAt, origin: config.origin });
  }
  if (path !== "/v1/pairing/consume") return json({ error: "Not found" }, 404);
  if (typeof body.code !== "string" || !/^[a-f0-9]{64}$/.test(body.code)) return json({ error: "Valid pairing code required" }, 400);
  const key = `pairing/${await digest(encoder.encode(body.code))}.json`;
  const object = await env.PHOTOS.get(key);
  if (!object) return json({ error: "Pairing code unavailable" }, 404);
  const saved = await object.json();
  const currentCode = await signed(`pair:v1:${saved.issuanceId}`, config.signingKey);
  if (saved.expiresAt <= Date.now() || saved.deviceVersion !== deviceVersion || saved.signingVersion !== signingVersion || !crypto.subtle.timingSafeEqual(encoder.encode(body.code), encoder.encode(currentCode)))
    return json({ error: "Pairing code expired or revoked" }, 410);
  if (saved.state !== "issued") return json({ error: "Pairing code already consumed; issue a new code" }, 409);
  const consumed = await env.PHOTOS.put(key, JSON.stringify({ ...saved, state: "consumed" }), { onlyIf: { etagMatches: object.etag } });
  if (!consumed) return json({ error: "Pairing code already consumed; issue a new code" }, 409);
  return json({ status: "paired", deviceToken: config.deviceToken, origin: config.origin });
}
var galleryStyles = `
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
function guestDocument(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#f6efe4"><title>${title}</title><style>${galleryStyles}</style></head><body><div class="shell"><header class="masthead"><span class="ornament" aria-hidden="true"></span><span class="brand">Gizelle &amp; Rami \xB7 November 1, 2026</span><span class="ornament" aria-hidden="true"></span></header>${content}<footer class="footer">Made of moments like these.</footer></div></body></html>`;
}
function guestPage(html, status = 200) {
  return new Response(html, { status, headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8" } });
}
function unavailableGallery(status, reason) {
  const expired = reason === "Link expired";
  const title = expired ? "This link has expired." : status === 410 ? "This gallery is closed." : status === 429 ? "A little pause." : "A moment, out of reach.";
  const message = expired ? "For your privacy, photo links are available for a limited time. Ask your hosts about another way to save your memories." : status === 410 ? "This private gallery is no longer available. Please ask your hosts if you need help with your photos." : status === 429 ? "This gallery has received too many requests. Please wait a minute, then open your link again." : status === 503 ? "Your photos are taking a little longer to load. Please try this link again in a moment." : "We couldn\u2019t find a gallery at this address. Check that you opened the complete link, or ask your hosts for help.";
  return guestPage(guestDocument("Your wedding photos", `<main class="error-page reveal"><div class="error-mark" aria-hidden="true">\u2727</div><p class="eyebrow">Your private gallery</p><h1>${title}</h1><p class="intro">${message}</p></main>`), status);
}
function galleryHtml(token, gallery) {
  const items = gallery.photoIds.map((id, i) => `<figure class="photo reveal"><img src="/g/${token}/photos/${id}" alt="Wedding photo ${i + 1}" loading="${i === 0 && !gallery.composite ? "eager" : "lazy"}" decoding="async"><figcaption><div class="photo-label"><span>A moment to keep</span><span>${String(i + 1).padStart(2, "0")}</span></div><a class="download" href="/g/${token}/photos/${id}?download=1" download aria-label="Download photo ${i + 1} in full resolution"><span class="arrow" aria-hidden="true">\u2193</span>${gallery.composite ? "Save individual photo" : "Save original photo"}</a><p class="quality">Full resolution \xB7 JPEG</p></figcaption></figure>`).join("");
  let keepsake = "";
  if (gallery.composite) {
    const composite = gallery.composite, strip = composite.layout === "strip";
    const layout = strip ? "photo strip" : "photo grid";
    const theme = composite.theme === "botanical" ? "Botanical" : composite.theme === "coastal" ? "Coastal" : "Classic";
    keepsake = `<section class="keepsake-section" aria-labelledby="keepsake-title"><div class="collection-heading"><h2 id="keepsake-title">Your wedding keepsake</h2><p>${theme} \xB7 ${strip ? "Photo strip" : "Photo grid"}</p></div><figure class="keepsake${strip ? " keepsake-strip" : ""} reveal"><figcaption><a class="download" href="/g/${token}/photos/${composite.photoId}?download=1" download aria-label="Download your ${layout} in full resolution"><span class="arrow" aria-hidden="true">\u2193</span>Save ${layout}</a><p class="quality">Full resolution \xB7 JPEG</p></figcaption><img src="/g/${token}/photos/${composite.photoId}" alt="Your ${theme.toLowerCase()} wedding ${layout}" loading="eager" decoding="async"></figure></section>`;
  }
  const originals = gallery.originalPhotoIds ? `<section class="original-section" aria-labelledby="originals-title"><div class="collection-heading"><h2 id="originals-title">Your camera originals</h2><p>${gallery.originalPhotoIds.length} original files</p></div><p class="original-intro">Save each camera original, in the same order as your keepsake.</p><ol class="originals">${gallery.originalPhotoIds.map((id, i) => `<li><span class="original-name">Original ${String(i + 1).padStart(2, "0")}</span><a class="download" href="/g/${token}/photos/${id}?download=1" download aria-label="Download camera original ${i + 1} in full resolution">Save original ${i + 1}</a></li>`).join("")}</ol></section>` : "";
  const expires = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "medium", timeZone: "UTC" }).format(new Date(gallery.expiresAt));
  return guestDocument("Your wedding photos", `<main><section class="hero reveal" aria-labelledby="gallery-title"><p class="eyebrow">A keepsake from the celebration</p><h1 id="gallery-title">Your night,<span>beautifully captured.</span></h1><p class="intro">A little joy to take home.</p></section>${keepsake}<section aria-label="Your photos"><div class="collection-heading"><h2>${gallery.composite ? "Your individual photos" : "Your wedding photos"}</h2><p>${gallery.photoIds.length} ${gallery.photoIds.length === 1 ? "memory" : "memories"} \xB7 original quality</p></div><div class="photos">${items}</div></section>${originals}<aside class="privacy"><h2>A private keepsake.</h2><p>Anyone with this link can view and download these photos.<br>Save your favorites, and forward this link only with care.</p><p class="expiry">Available until <time datetime="${new Date(gallery.expiresAt).toISOString()}">${expires} UTC</time>.<br>Link expiry closes access; it does not delete the original photos.</p></aside></main>`);
}
async function handle(request, env) {
  const url = new URL(request.url);
  const config = configFor(url, env);
  if (!config) return json({ error: "Service configuration unavailable" }, 503);
  const protection = await protectStorage(request, url, env);
  if (protection) return protection;
  if (url.pathname === "/health" && request.method === "GET")
    return json({ status: "ok", storage: env.MODE === "local" ? "local-r2" : "private-r2", sms: env.SMS_MODE, smsAvailable: liveSmsAvailable(env) });
  const guest = /^\/g\/([a-f0-9]{64})(?:\/photos\/([0-9a-f-]+))?$/.exec(url.pathname);
  if (guest && request.method === "GET") {
    const token = guest[1];
    const gallery = await loadGallery(env, await digest(encoder.encode(token)));
    if (gallery instanceof Response) {
      if (guest[2]) return gallery;
      const detail = await gallery.json();
      return unavailableGallery(gallery.status, detail.error);
    }
    const currentToken = await tokenFor(gallery.sessionId, config.signingKey);
    if (!crypto.subtle.timingSafeEqual(encoder.encode(token), encoder.encode(currentToken)))
      return guest[2] ? json({ error: "Link revoked" }, 410) : unavailableGallery(410, "Link revoked");
    if (!guest[2]) return guestPage(galleryHtml(token, gallery));
    const photoId = guest[2].toLowerCase();
    if (!uuid.test(photoId) || !galleryPhotoIds(gallery).includes(photoId)) return json({ error: "Photo unavailable" }, 404);
    const photo = await env.PHOTOS.get(photoKey(gallery.sessionId, photoId));
    if (!photo) return json({ error: "Photo unavailable" }, 404);
    const selectedIndex = gallery.photoIds.indexOf(photoId);
    const filename = gallery.composite?.photoId === photoId ? `wedding-keepsake-${gallery.composite.layout === "strip" ? "strip" : "grid"}.jpg` : selectedIndex >= 0 ? `wedding-photo-${selectedIndex + 1}.jpg` : `wedding-original-${gallery.originalPhotoIds.indexOf(photoId) + 1}.jpg`;
    return new Response(photo.body, { headers: {
      ...privateHeaders,
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.size),
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`
    } });
  }
  if (!url.pathname.startsWith("/v1/")) return request.method === "GET" && url.pathname.startsWith("/g/") ? unavailableGallery(404) : json({ error: "Not found" }, 404);
  if (url.pathname === "/v1/pairing/codes" || url.pathname === "/v1/pairing/consume") return pairing(request, env, config, url.pathname);
  if (!await deviceAuthorized(request, config.deviceToken)) return json({ error: "Unauthorized" }, 401);
  const upload = /^\/v1\/sessions\/([0-9a-f-]+)\/photos\/([0-9a-f-]+)$/i.exec(url.pathname);
  if (upload && request.method === "PUT") {
    const sessionId = upload[1].toLowerCase(), photoId = upload[2].toLowerCase();
    if (!uuid.test(sessionId) || !uuid.test(photoId)) return json({ error: "Invalid session or photo id" }, 400);
    if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "image/jpeg") return json({ error: "JPEG required" }, 415);
    const bytes = await readLimited(request, PHOTO_LIMIT);
    if (!bytes) return json({ error: "Photo exceeds 10 MiB" }, 413);
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
      return json({ error: "Invalid JPEG markers" }, 400);
    const sha256 = await digest(bytes);
    const key = photoKey(sessionId, photoId);
    const existing = await env.PHOTOS.head(key);
    if (existing) return existing.customMetadata?.sha256 === sha256 ? json({ id: photoId, sessionId, status: "stored" }) : json({ error: "Photo id already used" }, 409);
    const stored = await env.PHOTOS.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { sha256 }
    });
    if (!stored) {
      const winner = await env.PHOTOS.head(key);
      return winner?.customMetadata?.sha256 === sha256 ? json({ id: photoId, sessionId, status: "stored" }) : json({ error: "Photo id already used" }, 409);
    }
    return json({ id: photoId, sessionId, status: "stored" }, 201);
  }
  const sessionRoute = /^\/v1\/sessions\/([0-9a-f-]+)\/(ready|gallery)$/i.exec(url.pathname);
  if (sessionRoute) {
    const sessionId = sessionRoute[1].toLowerCase();
    if (!uuid.test(sessionId)) return json({ error: "Invalid session id" }, 400);
    const token = await tokenFor(sessionId, config.signingKey);
    const hash = await digest(encoder.encode(token));
    if (sessionRoute[2] === "gallery" && request.method === "DELETE") {
      await env.PHOTOS.put(sessionRevokedKey(sessionId), JSON.stringify({ revokedAt: Date.now() }), { onlyIf: { etagDoesNotMatch: "*" } });
      await env.PHOTOS.put(revokedKey(hash), JSON.stringify({ revokedAt: Date.now() }), { onlyIf: { etagDoesNotMatch: "*" } });
      return json({ status: "revoked" });
    }
    if (sessionRoute[2] === "ready" && request.method === "POST") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const recipe = parseGalleryRecipe(body);
      if (recipe instanceof Response) return recipe;
      if (await env.PHOTOS.head(sessionRevokedKey(sessionId)) || await env.PHOTOS.head(revokedKey(hash)))
        return json({ error: "Link revoked" }, 410);
      const existing = await env.PHOTOS.head(galleryKey(hash));
      if (existing) {
        const saved2 = await loadGallery(env, hash);
        if (saved2 instanceof Response) return saved2;
        if (!sameRecipe(saved2, recipe)) return json({ error: "Ready gallery recipe is immutable" }, 409);
        return readyGallery(saved2, config.origin, token);
      }
      if (recipe.photoIds.length !== 4 && recipe.photoIds.length !== 5) return json({ error: "Four template photos or five legacy photos are required for a new gallery" }, 400);
      if (recipe.photoIds.length === 4 && (!recipe.originalPhotoIds || !recipe.composite))
        return json({ error: "Four-photo galleries require corresponding originals and a composite" }, 400);
      const uploaded = await Promise.all(galleryPhotoIds(recipe).map((id) => env.PHOTOS.head(photoKey(sessionId, id))));
      if (uploaded.some((photo) => !photo?.customMetadata?.sha256)) return json({ error: "All photos must finish uploading before gallery is ready" }, 409);
      const manifest = { version: 1, sessionId, ...recipe, expiresAt: Date.now() + config.ttlMs };
      await env.PHOTOS.put(galleryKey(hash), JSON.stringify(manifest), { onlyIf: { etagDoesNotMatch: "*" } });
      const saved = await loadGallery(env, hash);
      if (saved instanceof Response) return saved;
      if (!sameRecipe(saved, recipe)) return json({ error: "Ready gallery recipe is immutable" }, 409);
      return readyGallery(saved, config.origin, token);
    }
  }
  if (url.pathname === "/v1/shares" && request.method === "POST") {
    const provider = smsProvider(env);
    if (!provider) return json({ error: "Live SMS disabled; an approved provider and sender are required" }, 503);
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (typeof body.id !== "string" || !uuid.test(body.id) || typeof body.sessionId !== "string" || !uuid.test(body.sessionId) || typeof body.phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(body.phone) || body.consent !== true)
      return json({ error: "Valid IDs, an E.164 number and explicit consent are required" }, 400);
    const sessionId = body.sessionId.toLowerCase();
    if (await env.PHOTOS.head(sessionRevokedKey(sessionId))) return json({ error: "Link revoked" }, 410);
    const token = await tokenFor(sessionId, config.signingKey);
    const hash = await digest(encoder.encode(token));
    const gallery = await loadGallery(env, hash);
    if (gallery instanceof Response) return gallery.status === 404 ? json({ error: "Gallery must be ready before sharing" }, 409) : gallery;
    if (!completeShareGallery(gallery)) return json({ error: "A complete four-photo template or five-photo legacy gallery is required before sharing", retryable: false }, 409);
    const key = `shares/${body.id.toLowerCase()}.json`;
    const fingerprint = await signed(`recipient:v1:${body.phone}`, config.signingKey);
    const fresh = { sessionId, recipientFingerprint: fingerprint, status: "pending" };
    await env.PHOTOS.put(key, JSON.stringify(fresh), { onlyIf: { etagDoesNotMatch: "*" } });
    const saved = await env.PHOTOS.get(key);
    if (!saved) throw new Error("Missing share record");
    const record = await saved.json();
    if (record.sessionId !== sessionId || record.recipientFingerprint !== fingerprint) return json({ error: "Share id already used" }, 409);
    const galleryUrl = `${config.origin}/g/${token}`;
    if (record.status === "mocked") return json({ status: "mocked", message: "No text message was sent", retryable: false, url: galleryUrl, expiresAt: gallery.expiresAt });
    if (env.SMS_MODE === "textbelt" || env.SMS_MODE === "textbelt-test")
      return textbeltShare(env, provider, body.id.toLowerCase(), fresh, body.phone, galleryUrl, gallery.expiresAt, body.retryRejected === true);
    const result = await provider.send({ idempotencyKey: body.id.toLowerCase(), to: body.phone, galleryUrl });
    const updated = await env.PHOTOS.put(key, JSON.stringify({ ...record, status: result.status }), { onlyIf: { etagMatches: saved.etag } });
    if (!updated) return json({ error: "Concurrent share attempt; retry with the same id", retryable: true }, 409);
    return json({ ...result, url: galleryUrl, expiresAt: gallery.expiresAt }, result.status === "mock_failed" ? 503 : 200);
  }
  return json({ error: "Not found" }, 404);
}
var index_default = {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      const url = new URL(request.url);
      if (request.method === "GET" && /^\/g\/[^/]+\/?$/.test(url.pathname)) return unavailableGallery(503);
      return json({ error: "Storage operation failed; retry with the same IDs", retryable: true }, 503);
    }
  }
};
export {
  createTextbeltProvider,
  index_default as default
};
