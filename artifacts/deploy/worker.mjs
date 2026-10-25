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
async function readJson(request) {
  const bytes = await readLimited(request, 16384);
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
function mockProvider(mode) {
  if (mode !== "mock" && mode !== "mock-fail") return;
  return { async send() {
    return mode === "mock" ? { status: "mocked", message: "No text message was sent", retryable: false } : { status: "mock_failed", message: "Simulated provider failure; no text message was sent", retryable: true };
  } };
}
var galleryStyles = `
  :root{color-scheme:light;--paper:#f6efe4;--ink:#3b342b;--muted:#6d6256;--line:#dcd1bf;--white:#fbf6ec;--forest:#9a4f32}
  *{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  a{color:inherit}a:focus-visible{outline:3px solid var(--forest);outline-offset:5px}::selection{background:#d9e4df;color:var(--ink)}
  .shell{max-width:1220px;margin:auto;padding:0 44px}.masthead{display:flex;align-items:center;justify-content:center;gap:18px;padding:35px 0;border-bottom:1px solid var(--line)}
  .brand{font-size:10px;letter-spacing:2.8px;font-weight:600}.ornament{width:7px;height:7px;border:1px solid #b8964f;transform:rotate(45deg);flex:none}
  .hero{text-align:center;max-width:740px;margin:0 auto;padding:72px 0 49px}.eyebrow{margin:0 0 18px;font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted)}
  h1{font:400 clamp(42px,6.2vw,76px)/1.06 Georgia,"Times New Roman",serif;letter-spacing:-2.4px;margin:0 0 24px}h1 span{display:block;font-style:italic;font-weight:400}
  .intro{text-wrap:pretty;max-width:475px;margin:0 auto;color:var(--muted);font-size:16px;line-height:1.8}.collection-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 0 20px;border-top:1px solid var(--line)}
  .collection-heading h2{font-size:10px;letter-spacing:2px;font-weight:600;margin:0;text-transform:uppercase}.collection-heading p{margin:0;font-size:12px;color:var(--muted)}
  .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:24px;align-items:start}.photo{margin:0;padding:12px 12px 0;background:var(--white);border:1px solid #e0d5c4;border-radius:4px;box-shadow:0 8px 24px #3b342b08;min-width:0}
  .photo img{display:block;width:100%;height:auto;background:#ebe3d6;border-radius:1px}.photo figcaption{padding:20px 6px 22px}.photo-label{display:flex;align-items:center;justify-content:space-between;font-size:10px;letter-spacing:1.8px;color:var(--muted);text-transform:uppercase;margin-bottom:16px}.photo-label span:last-child{font:italic 18px Georgia,serif;letter-spacing:0;color:var(--ink)}
  .download{display:flex;align-items:center;justify-content:center;gap:12px;min-height:48px;padding:12px 18px;text-align:center;background:var(--forest);border:1px solid var(--forest);border-radius:30px;text-decoration:none;color:var(--white);font-size:13px;font-weight:500;transition:background .18s,transform .18s}
  .download:hover{background:#813f29;transform:translateY(-1px)}.download:active{transform:translateY(0)}.download .arrow{font-size:19px;line-height:1}.quality{margin:11px 0 0;text-align:center;font-size:10px;color:var(--muted);letter-spacing:.3px}
  .privacy{max-width:520px;text-align:center;margin:56px auto 48px}.privacy h2{font:400 25px Georgia,serif;margin:0 0 12px}.privacy p{color:var(--muted);font-size:13px;line-height:1.85;margin:0}.privacy .expiry{font-size:11px;margin-top:14px}
  .footer{border-top:1px solid var(--line);text-align:center;padding:25px 0 30px;color:var(--muted);font:italic 18px Georgia,serif}.reveal{animation:reveal .65s ease-out both}.photo:nth-child(2){animation-delay:.09s}.photo:nth-child(n+3){animation-delay:.18s}
  .error-page{max-width:650px;min-height:65vh;margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:64px 0}.error-page h1{font-size:clamp(42px,7vw,66px)}.error-page .intro{max-width:390px}.error-mark{width:52px;height:52px;border:1px solid #a9beb5;border-radius:50%;display:grid;place-items:center;margin-bottom:30px;font:italic 28px Georgia,serif;color:#3e6760}
  @keyframes reveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @media(min-width:1100px){.photos:has(.photo:only-child){max-width:650px;margin:auto}}@media(max-width:700px){.shell{padding:0 23px}.masthead{padding:25px 0;gap:13px}.brand{font-size:9px;letter-spacing:2px}.hero{padding:49px 0 36px}h1{letter-spacing:-1.4px}.intro{font-size:14px;max-width:330px}.photos{gap:24px}.collection-heading{padding:19px 0}.collection-heading p{font-size:10px}.privacy{margin:40px auto 34px}.photo{padding:10px 10px 0}.photo figcaption{padding:18px 6px 20px}.footer{font-size:16px}.download{min-height:50px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.download:hover{transform:none}}
`;
function guestDocument(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#f6efe4"><title>${title}</title><style>${galleryStyles}</style></head><body><div class="shell"><header class="masthead"><span class="ornament" aria-hidden="true"></span><span class="brand">THE WEDDING PHOTOBOOTH</span><span class="ornament" aria-hidden="true"></span></header>${content}<footer class="footer">Made of moments like these.</footer></div></body></html>`;
}
function guestPage(html, status = 200) {
  return new Response(html, { status, headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8" } });
}
function unavailableGallery(status, reason) {
  const expired = reason === "Link expired";
  const title = expired ? "This link has expired." : status === 410 ? "This gallery is closed." : "A moment, out of reach.";
  const message = expired ? "For your privacy, photo links are available for a limited time. Ask your hosts about another way to save your memories." : status === 410 ? "This private gallery is no longer available. Please ask your hosts if you need help with your photos." : status === 503 ? "Your photos are taking a little longer to load. Please try this link again in a moment." : "We couldn\u2019t find a gallery at this address. Check that you opened the complete link, or ask your hosts for help.";
  return guestPage(guestDocument("Your wedding photos", `<main class="error-page reveal"><div class="error-mark" aria-hidden="true">\u2727</div><p class="eyebrow">Your private gallery</p><h1>${title}</h1><p class="intro">${message}</p></main>`), status);
}
function galleryHtml(token, gallery) {
  const items = gallery.photoIds.map((id, i) => `<figure class="photo reveal"><img src="/g/${token}/photos/${id}" alt="Wedding photo ${i + 1}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async"><figcaption><div class="photo-label"><span>A moment to keep</span><span>${String(i + 1).padStart(2, "0")}</span></div><a class="download" href="/g/${token}/photos/${id}?download=1" download aria-label="Download photo ${i + 1} in full resolution"><span class="arrow" aria-hidden="true">\u2193</span>Save original photo</a><p class="quality">Full resolution \xB7 JPEG</p></figcaption></figure>`).join("");
  const expires = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(gallery.expiresAt));
  return guestDocument("Your wedding photos", `<main><section class="hero reveal" aria-labelledby="gallery-title"><p class="eyebrow">A keepsake from the celebration</p><h1 id="gallery-title">Your night,<span>beautifully captured.</span></h1><p class="intro">The laughter, the joy, the happy tears.<br>These little moments are yours to keep.</p></section><section aria-label="Your photos"><div class="collection-heading"><h2>Your wedding photos</h2><p>${gallery.photoIds.length} ${gallery.photoIds.length === 1 ? "memory" : "memories"} \xB7 original quality</p></div><div class="photos">${items}</div></section><aside class="privacy"><h2>A private keepsake.</h2><p>Anyone with this link can view these photos.<br>Save your favorites, and share this link with care.</p><p class="expiry">Available until ${expires} UTC.</p></aside></main>`);
}
async function handle(request, env) {
  const url = new URL(request.url);
  const config = configFor(url, env);
  if (!config) return json({ error: "Service configuration unavailable" }, 503);
  if (url.pathname === "/health" && request.method === "GET")
    return json({ status: "ok", storage: env.MODE === "local" ? "local-r2" : "private-r2", sms: env.SMS_MODE });
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
    if (!uuid.test(photoId) || !gallery.photoIds.includes(photoId)) return json({ error: "Photo unavailable" }, 404);
    const photo = await env.PHOTOS.get(photoKey(gallery.sessionId, photoId));
    if (!photo) return json({ error: "Photo unavailable" }, 404);
    return new Response(photo.body, { headers: {
      ...privateHeaders,
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.size),
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="wedding-photo-${gallery.photoIds.indexOf(photoId) + 1}.jpg"`
    } });
  }
  if (!url.pathname.startsWith("/v1/")) return request.method === "GET" && url.pathname.startsWith("/g/") ? unavailableGallery(404) : json({ error: "Not found" }, 404);
  if (request.headers.get("Authorization") !== `Bearer ${config.deviceToken}`) return json({ error: "Unauthorized" }, 401);
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
      if (!Array.isArray(body.photoIds) || body.photoIds.length < 1 || body.photoIds.length > 100 || !body.photoIds.every((id) => typeof id === "string" && uuid.test(id))) return json({ error: "1\u2013100 valid photo IDs required" }, 400);
      const photoIds = body.photoIds.map((id) => id.toLowerCase());
      if (new Set(photoIds).size !== photoIds.length) return json({ error: "Duplicate photo IDs" }, 400);
      if (await env.PHOTOS.head(sessionRevokedKey(sessionId)) || await env.PHOTOS.head(revokedKey(hash)))
        return json({ error: "Link revoked" }, 410);
      const uploaded = await Promise.all(photoIds.map((id) => env.PHOTOS.head(photoKey(sessionId, id))));
      if (uploaded.some((photo) => !photo?.customMetadata?.sha256)) return json({ error: "All photos must finish uploading before gallery is ready" }, 409);
      const manifest = { version: 1, sessionId, photoIds, expiresAt: Date.now() + config.ttlMs };
      await env.PHOTOS.put(galleryKey(hash), JSON.stringify(manifest), { onlyIf: { etagDoesNotMatch: "*" } });
      const saved = await loadGallery(env, hash);
      if (saved instanceof Response) return saved;
      if (!samePhotos(saved.photoIds, photoIds)) return json({ error: "Ready gallery photo list is immutable" }, 409);
      return json({ status: "ready", url: `${config.origin}/g/${token}`, expiresAt: saved.expiresAt });
    }
  }
  if (url.pathname === "/v1/shares" && request.method === "POST") {
    const provider = mockProvider(env.SMS_MODE);
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
  index_default as default
};
