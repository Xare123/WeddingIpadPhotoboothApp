// services/api/src/guest-keepsake.client
var guest_keepsake_default = "/* Private guest-page enhancement. Browser renders are new keepsakes, not exact copies of booth crops or fonts. */\n(() => {\n  'use strict';\n  const panel = document.getElementById('keepsake-editor');\n  if (!panel) return;\n  const status = document.getElementById('variant-status');\n  const preview = document.getElementById('variant-preview');\n  const retry = document.getElementById('variant-retry');\n  const buttons = Array.from(panel.querySelectorAll('button[data-variant]'));\n  const layoutButtons = Array.from(panel.querySelectorAll('button[data-layout]'));\n  const links = { fill: document.getElementById('download-fill'), fit: document.getElementById('download-fit') };\n  if (!status || !preview || !retry || !links.fill || !links.fit || buttons.length !== 2 || layoutButtons.length !== 2) return;\n  const MAX_BYTES = 10 * 1024 * 1024;\n  let generation = 0, busy = false, disposed = false, controller;\n  let selected = 'fill', layout = 'grid', ready = null;\n  const liveUrls = new Set();\n  const message = value => { status.textContent = value; };\n  const revoke = url => { if (url && liveUrls.delete(url)) URL.revokeObjectURL(url); };\n  const objectUrl = blob => { const url = URL.createObjectURL(blob); liveUrls.add(url); return url; };\n  function configuration() {\n    const value = JSON.parse(panel.dataset.config || 'null');\n    const token = /^\\/g\\/([a-f0-9]{64})\\/?$/.exec(location.pathname)?.[1];\n    if (!token || !value || !['wedding-template-v1', 'wedding-template-v2', 'wedding-template-v3'].includes(value.version) ||\n        !['strip', 'grid'].includes(value.layout) || !['classic', 'botanical', 'coastal'].includes(value.theme) ||\n        (value.version === 'wedding-template-v1' ? value.gridAspect !== undefined : !['portrait', 'square'].includes(value.gridAspect)) ||\n        (value.version === 'wedding-template-v3' && value.gridAspect !== 'square') ||\n        !Array.isArray(value.photoUrls) || value.photoUrls.length !== 4 || new Set(value.photoUrls).size !== 4) throw new Error('configuration');\n    function checkedUrl(raw, pattern) {\n      if (typeof raw !== 'string' || raw.length > 512) throw new Error('configuration');\n      const url = new URL(raw, location.origin);\n      if (url.origin !== location.origin || url.username || url.password || url.search || url.hash || !pattern.test(url.pathname)) throw new Error('configuration');\n      return url.href;\n    }\n    const photoPattern = new RegExp('^/g/' + token + '/photos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'i');\n    value.photoUrls = value.photoUrls.map(raw => checkedUrl(raw, photoPattern));\n    if (new Set(value.photoUrls).size !== 4) throw new Error('configuration');\n    if (value.version === 'wedding-template-v3') value.artUrl = checkedUrl(value.artUrl, new RegExp('^/g/' + token + '/art/' + value.theme + '$'));\n    else if (value.artUrl !== undefined) throw new Error('configuration');\n    return value;\n  }\n  function geometry(config) {\n    const strip = config.layout === 'strip', v1 = config.version === 'wedding-template-v1', v3 = config.version === 'wedding-template-v3';\n    return { width: strip ? 1200 : 2400, height: strip ? 3600 : v1 ? 2100 : config.gridAspect === 'portrait' ? 3000 : 2400,\n      windows: Array.from({ length: 4 }, (_, i) => v3 ? strip ? { x: 100, y: 220 + i * 770, width: 1000, height: 750 } : { x: 184 + i % 2 * 1032, y: 160 + Math.floor(i / 2) * 1032, width: 1000, height: 1000 }\n        : strip ? { x: 60, y: 60 + i * 834, width: 1080, height: 810 } : v1 ? { x: 96 + i % 2 * 1128, y: 96 + Math.floor(i / 2) * 858, width: 1080, height: 810 }\n        : config.gridAspect === 'portrait' ? { x: 72 + i % 2 * 1140, y: 72 + Math.floor(i / 2) * 1356, width: 1116, height: 1332 } : { x: 96 + i % 2 * 1128, y: 60 + Math.floor(i / 2) * 1104, width: 1080, height: 1080 }) };\n  }\n  function palette(config) {\n    return (config.version === 'wedding-template-v1' ? {\n      classic: ['#F6F1E7', '#352B25', '#BCA68B', '#BCA68B'], botanical: ['#EEF1E8', '#31483A', '#8B9B80', '#8B9B80'], coastal: ['#EDF4F2', '#274541', '#8FB7AE', '#D4C1A2']\n    } : { classic: ['#F6F0E4', '#372D27', '#B6A07C', '#FAF7EE'], botanical: ['#DCE5D6', '#2D4537', '#6D8367', '#FAF7EE'], coastal: ['#DBEBE7', '#244C49', '#6B9F99', '#FAF7EE'] })[config.theme];\n  }\n  function decorateV2(ctx, config, size, colors) {\n    const { width, height, windows } = size, [paper, , accent, sand] = colors;\n    ctx.fillStyle = config.theme === 'classic' ? paper : sand;\n    for (const w of windows) ctx.fillRect(w.x - 10, w.y - 10, w.width + 20, w.height + 20);\n    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); for (const w of windows) ctx.rect(w.x, w.y, w.width, w.height); ctx.clip('evenodd'); ctx.strokeStyle = accent;\n    if (config.theme === 'classic') {\n      ctx.lineWidth = 2; ctx.strokeRect(20, 20, width - 40, height - 40); ctx.lineWidth = 1; ctx.strokeRect(30, 30, width - 60, height - 60);\n      for (const w of windows) ctx.strokeRect(w.x - 7, w.y - 7, w.width + 14, w.height + 14);\n    } else if (config.theme === 'botanical') {\n      function branch(x, y, sign, length) {\n        ctx.save(); ctx.translate(x, y); ctx.scale(sign, 1); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(length * .35, -4, length * .7, -40, length, -45); ctx.stroke(); ctx.fillStyle = accent;\n        for (let i = 1; i <= 6; i++) for (const side of [-1, 1]) { const px = i * length / 7, py = -i * 45 / 7; ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px - 6, py + side * 24, px + 19, py + side * 30); ctx.quadraticCurveTo(px + 28, py + side * 13, px, py); ctx.fill(); }\n        ctx.restore();\n      }\n      const footerTop = Math.max(...windows.map(w => w.y + w.height)), strip = config.layout === 'strip', length = strip ? 160 : 270;\n      branch(strip ? 75 : 120, footerTop + (height - footerTop) * .67, 1, length); branch(width - (strip ? 75 : 120), footerTop + (height - footerTop) * .38, -1, length);\n      branch(20, 57, 1, 170); branch(width - 20, 40, -1, 170);\n    } else {\n      ctx.lineWidth = 3;\n      for (let row = 0; row < 5; row++) { const y = height - 22 - row * 15, wing = config.layout === 'strip' ? 210 : 650;\n        for (const mirror of [false, true]) { ctx.save(); if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); } ctx.beginPath(); ctx.moveTo(36, y); ctx.bezierCurveTo(wing * .35, y - 24, wing * .7, y + 20, wing, y - 8); ctx.stroke(); ctx.restore(); }\n      }\n      for (let row = 0; row < 3; row++) { const x = 18 + row * 13; ctx.beginPath(); ctx.moveTo(x, 35); ctx.bezierCurveTo(x + 18, height * .3, x - 10, height * .65, x + 4, height - 40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(width - x, 35); ctx.bezierCurveTo(width - x - 18, height * .3, width - x + 10, height * .65, width - x - 4, height - 40); ctx.stroke(); }\n    }\n    ctx.restore();\n  }\n  function background(ctx, config, size, art) {\n    const colors = palette(config), { width, height } = size;\n    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, width, height);\n    if (config.version === 'wedding-template-v2') decorateV2(ctx, config, size, colors);\n    if (config.version === 'wedding-template-v3') {\n      const edge = config.layout === 'strip' ? 250 : 350, input = [0, 250, 1004, 1254], xs = [0, edge, width - edge, width], ys = [0, edge, height - edge, height];\n      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ctx.drawImage(art, input[col], input[row], input[col + 1] - input[col], input[row + 1] - input[row], xs[col], ys[row], xs[col + 1] - xs[col], ys[row + 1] - ys[row]);\n      if (config.theme !== 'classic') { const inset = config.layout === 'strip' ? 24 : 40; ctx.strokeStyle = colors[2]; ctx.lineWidth = 1; ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2); }\n    }\n  }\n  function footer(ctx, config, size) {\n    const strip = config.layout === 'strip', v1 = config.version === 'wedding-template-v1', v3 = config.version === 'wedding-template-v3';\n    const [ , ink, accent, sand] = palette(config), center = size.width / 2, bottom = Math.max(...size.windows.map(w => w.y + w.height));\n    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';\n    ctx.font = `${v1 ? strip ? 52 : 64 : strip ? 86 : 84}px Georgia, serif`;\n    ctx.fillText('Gizelle & Rami', center, v1 ? strip ? 3457 : 1870 : v3 ? strip ? 3420 : 2280 : strip ? 3480 : bottom + (config.gridAspect === 'square' ? 86 : 116));\n    ctx.font = `${v1 ? strip ? 21 : 25 : strip ? 36 : 32}px HelveticaNeue, Arial, sans-serif`;\n    ctx.fillText('NOVEMBER 1, 2026', center, v1 ? strip ? 3510 : 1936 : v3 ? strip ? 3490 : 2330 : strip ? 3535 : bottom + (config.gridAspect === 'square' ? 133 : 174));\n    if (!v1) return;\n    const y = strip ? 3542 : 1982; ctx.strokeStyle = accent; ctx.lineWidth = 2.5;\n    if (config.theme === 'classic') { ctx.beginPath(); ctx.moveTo(center - 80, y); ctx.lineTo(center + 80, y); ctx.stroke(); }\n    else if (config.theme === 'botanical') {\n      for (const sign of [-1, 1]) { const x = center + sign * 180; ctx.beginPath(); ctx.moveTo(x - 45, y); ctx.lineTo(x + 45, y - 9); ctx.stroke();\n        for (let step = 0; step < 5; step++) { const sx = x - 30 + step * 15; ctx.beginPath(); ctx.moveTo(sx, y - 3); ctx.quadraticCurveTo(sx + 2, y - 15, sx + 9, y - 17); ctx.stroke(); }\n      }\n    } else for (let row = 0; row < 2; row++) { ctx.strokeStyle = row ? sand : accent; ctx.beginPath(); ctx.moveTo(center - 150, y + row * 9); for (let step = 0; step < 6; step++) { const x = center - 150 + step * 50; ctx.bezierCurveTo(x + 16, y - 10 + row * 9, x + 34, y + 10 + row * 9, x + 50, y + row * 9); } ctx.stroke(); }\n  }\n  const failure = code => Object.assign(new Error('Keepsake preparation failed'), { code });\n  // Read JPEG frame dimensions before allocating a decoded image. EXIF orientation\n  // remains the browser's responsibility; these limits apply identically if swapped.\n  function jpegDimensions(chunks, total) {\n    const bytes = new Uint8Array(total); let offset = 0;\n    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }\n    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw failure('image');\n    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);\n    offset = 2;\n    while (offset < bytes.length) {\n      if (bytes[offset++] !== 0xff) throw failure('image');\n      while (offset < bytes.length && bytes[offset] === 0xff) offset++;\n      if (offset >= bytes.length) throw failure('image');\n      const marker = bytes[offset++];\n      if (!marker || marker === 0xd8 || marker === 0xd9 || marker === 0xda) throw failure('image');\n      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;\n      if (offset + 2 > bytes.length) throw failure('image');\n      const length = bytes[offset] * 256 + bytes[offset + 1];\n      if (length < 2 || offset + length > bytes.length) throw failure('image');\n      if (frames.has(marker)) {\n        if (length < 8 || !bytes[offset + 7] || length !== 8 + 3 * bytes[offset + 7]) throw failure('image');\n        const height = bytes[offset + 3] * 256 + bytes[offset + 4], width = bytes[offset + 5] * 256 + bytes[offset + 6];\n        if (!width || !height || width > 24000 || height > 24000 || width * height > 24000000) throw failure('dimensions');\n        return { width, height };\n      }\n      offset += length;\n    }\n    throw failure('image');\n  }\n  async function loadImage(url, type, runController) {\n    const signal = runController.signal;\n    const timeout = setTimeout(() => runController.abort(), 15000);\n    let image, temporary;\n    try {\n      const response = await fetch(url, { mode: 'same-origin', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal });\n      if (!response.ok) {\n        if (response.status === 410) throw failure('expired');\n        if (response.status === 429) throw failure('rate-limited');\n        if (response.status === 404) throw failure(type === 'image/jpeg' ? 'missing-photo' : 'not-ready');\n        if (response.status === 503) throw failure('not-ready');\n        throw failure('image');\n      }\n      if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith(type)) throw failure('image');\n      const declared = response.headers.get('content-length');\n      if (declared && (!/^\\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error('size');\n      const reader = response.body.getReader(), chunks = []; let total = 0;\n      try { while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > MAX_BYTES) throw new Error('size'); chunks.push(part.value); } }\n      finally { await reader.cancel().catch(() => {}); }\n      if (!total) throw failure('image');\n      if (type === 'image/jpeg') jpegDimensions(chunks, total);\n      temporary = objectUrl(new Blob(chunks, { type }));\n      image = new Image(); image.decoding = 'async'; image.src = temporary;\n      await new Promise((resolve, reject) => {\n        const aborted = () => reject(new Error('cancelled'));\n        signal.addEventListener('abort', aborted, { once: true });\n        if (signal.aborted) { signal.removeEventListener('abort', aborted); return reject(new Error('cancelled')); }\n        image.decode().then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));\n      });\n      const width = image.naturalWidth, height = image.naturalHeight;\n      if (!width || !height || width > 24000 || height > 24000 || width * height > 24000000 || (type === 'image/png' && (width !== 1254 || height !== 1254))) throw new Error('dimensions');\n      if (signal.aborted) throw new Error('cancelled');\n      return { image, release() { image.src = ''; revoke(temporary); } };\n    } catch (error) { if (image) image.src = ''; revoke(temporary); throw error; }\n    finally { clearTimeout(timeout); }\n  }\n  function encode(canvas) {\n    return new Promise((resolve, reject) => {\n      let settled = false;\n      const timeout = setTimeout(() => { settled = true; reject(failure('encoding-timeout')); }, 15000);\n      try {\n        canvas.toBlob(blob => {\n          if (settled) return;\n          settled = true; clearTimeout(timeout);\n          if (!blob || blob.type !== 'image/jpeg' || !blob.size) reject(failure('encoding')); else resolve(blob);\n        }, 'image/jpeg', .95);\n      } catch (error) { settled = true; clearTimeout(timeout); reject(error); }\n    });\n  }\n  function setVariant(mode) {\n    if (!ready || busy || !['fill', 'fit'].includes(mode)) return;\n    selected = mode; preview.src = ready[layout][mode];\n    preview.closest('figure').classList.toggle('variant-strip', layout === 'strip');\n    preview.alt = (layout === 'grid' ? 'Social Grid' : 'Photo Strip') + ' \xB7 ' + (mode === 'fill' ? 'Fill Frames' : 'Full Photo');\n    for (const button of layoutButtons) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));\n    for (const choice of ['fill', 'fit']) { links[choice].href = ready[layout][choice]; links[choice].download = 'wedding-keepsake-' + layout + '-' + (choice === 'fill' ? 'fill-frames' : 'full-photo') + '.jpg'; links[choice].textContent = 'Download ' + (layout === 'grid' ? 'Social Grid' : 'Photo Strip') + ' \xB7 ' + (choice === 'fill' ? 'Fill Frames' : 'Full Photo'); } preview.hidden = false;\n    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.variant === mode));\n    message(mode === 'fill' ? 'Fill frames ready. Photos align at the top and edges may be cropped; camera originals stay unchanged.' : 'Full photo ready. Every edge stays visible; camera originals stay unchanged.');\n  }\n  async function prepare() {\n    if (busy || disposed) return;\n    const ticket = ++generation, runController = new AbortController(); busy = true; controller = runController;\n    ready = null; retry.hidden = true; preview.hidden = true; preview.removeAttribute('src');\n    for (const button of [...buttons, ...layoutButtons]) button.disabled = true;\n    for (const link of Object.values(links)) { link.hidden = true; link.removeAttribute('href'); }\n    message('Preparing both keepsake downloads on this device\u2026');\n    const produced = [], canvases = [];\n    let art;\n    try {\n      const config = configuration();\n      if (config.version === 'wedding-template-v3') art = await loadImage(config.artUrl, 'image/png', runController);\n      for (const outputLayout of ['grid', 'strip']) for (const mode of ['fill', 'fit']) {\n        const outputConfig = { ...config, layout: outputLayout, ...(outputLayout === 'grid' ? { version: config.version === 'wedding-template-v1' ? 'wedding-template-v2' : config.version, gridAspect: 'square' } : {}) }, size = geometry(outputConfig);\n        const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;\n        const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('canvas');\n        background(ctx, outputConfig, size, art?.image); canvases.push({ canvas, ctx, mode, layout: outputLayout, config: outputConfig, size });\n      }\n      art?.release(); art = undefined;\n      for (let index = 0; index < 4; index++) {\n        if (ticket !== generation || disposed) throw new Error('cancelled');\n        message('Preparing photo ' + (index + 1) + ' of 4\u2026');\n        const photo = await loadImage(config.photoUrls[index], 'image/jpeg', runController);\n        try {\n          const image = photo.image;\n          for (const item of canvases) {\n            const w = item.size.windows[index];\n            const factor = item.mode === 'fit' ? Math.min(w.width / image.naturalWidth, w.height / image.naturalHeight) : Math.max(w.width / image.naturalWidth, w.height / image.naturalHeight);\n            const width = image.naturalWidth * factor, height = image.naturalHeight * factor;\n            const x = w.x + (w.width - width) / 2, y = item.mode === 'fit' ? w.y + (w.height - height) / 2 : w.y;\n            item.ctx.save(); item.ctx.beginPath(); item.ctx.rect(w.x, w.y, w.width, w.height); item.ctx.clip(); item.ctx.drawImage(image, x, y, width, height); item.ctx.restore();\n          }\n        } finally { photo.release(); }\n      }\n      const outputs = { grid: {}, strip: {} };\n      for (const item of canvases) {\n        footer(item.ctx, item.config, item.size); const blob = await encode(item.canvas);\n        if (ticket !== generation || disposed) throw new Error('cancelled');\n        outputs[item.layout][item.mode] = objectUrl(blob); produced.push(outputs[item.layout][item.mode]);\n        item.canvas.width = 1; item.canvas.height = 1;\n      }\n      ready = outputs;\n      for (const link of Object.values(links)) link.hidden = false;\n      busy = false; for (const button of [...buttons, ...layoutButtons]) button.disabled = false; setVariant(selected);\n    } catch (error) {\n      for (const url of produced) revoke(url);\n      if (ticket === generation && !disposed) {\n        ready = null;\n        const messages = {\n          expired: 'This private link has expired or been revoked. Alternate keepsakes are unavailable.',\n          'rate-limited': 'Too many requests. Please wait a moment, then try again.',\n          'missing-photo': 'One of the selected photos is unavailable, so these alternate keepsakes cannot be recreated.',\n          'not-ready': 'The keepsake artwork or photos are not ready. Alternate downloads could not be prepared. The original booth download has not been changed.',\n          dimensions: 'A selected image exceeds the safe processing size. Alternate keepsakes could not be prepared. The original booth download has not been changed.',\n          'encoding-timeout': 'Preparing the JPEG downloads took too long. Please try again. The original booth download has not been changed.'\n        };\n        message(messages[error?.code] || 'These alternate keepsakes could not be prepared. The original booth download has not been changed. Try again when the connection is ready.');\n        retry.hidden = error?.code === 'expired';\n      }\n    } finally {\n      art?.release(); for (const item of canvases) { item.canvas.width = 1; item.canvas.height = 1; }\n      if (ticket === generation) busy = false;\n    }\n  }\n  for (const button of buttons) button.addEventListener('click', () => setVariant(button.dataset.variant));\n  for (const button of layoutButtons) button.addEventListener('click', () => { if (!ready || busy || !['grid', 'strip'].includes(button.dataset.layout)) return; layout = button.dataset.layout; setVariant(selected); });\n  retry.addEventListener('click', prepare);\n  preview.addEventListener('error', () => { if (ready && !busy && !disposed) message('The preview could not be displayed. Both generated JPEG downloads remain available below.'); });\n  window.addEventListener('pagehide', event => {\n    if (event.persisted) return;\n    disposed = true; generation++; controller?.abort(); ready = null;\n    for (const url of Array.from(liveUrls)) revoke(url);\n  });\n  prepare();\n})();\n";

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
  if (url.pathname.startsWith("/g/")) return /^\/g\/[^/]+\/(?:photos\/|art\/|keepsake\.js$)/.test(url.pathname) ? "PHOTO" : "GALLERY";
  if (url.pathname === "/v1/shares" || url.pathname.startsWith("/v1/pairing/")) return "SHARE";
  if (url.pathname.startsWith("/v1/")) return "API";
}
function limitResponse(url, status) {
  const page = url.pathname.startsWith("/g/") && !/^\/g\/[^/]+\/(?:photos\/|art\/|keepsake\.js$)/.test(url.pathname);
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
  const v2 = composite.version === "wedding-template-v2", v3 = composite.version === "wedding-template-v3";
  const keys = ["photoId", "layout", "theme", "version", ...v2 || v3 ? ["gridAspect"] : []];
  if (Object.keys(composite).length !== keys.length || Object.keys(composite).some((key) => !keys.includes(key)) || typeof composite.photoId !== "string" || !uuid.test(composite.photoId) || !["strip", "grid"].includes(composite.layout) || !["classic", "botanical", "coastal"].includes(composite.theme) || !v2 && !v3 && composite.version !== "wedding-template-v1" || v2 && !["portrait", "square"].includes(composite.gridAspect) || v3 && composite.gridAspect !== "square") return json({ error: "Unknown or invalid composite recipe" }, 400);
  const photoId = composite.photoId.toLowerCase();
  if (photoIds.includes(photoId) || originalPhotoIds.includes(photoId)) return json({ error: "Composite must have a distinct photo ID" }, 400);
  const common = { photoId, layout: composite.layout, theme: composite.theme };
  return { photoIds, originalPhotoIds, composite: v3 ? { ...common, version: "wedding-template-v3", gridAspect: "square" } : v2 ? { ...common, version: "wedding-template-v2", gridAspect: composite.gridAspect } : { ...common, version: "wedding-template-v1" } };
}
function sameRecipe(left, right) {
  return samePhotos(left.photoIds, right.photoIds) && (left.originalPhotoIds === void 0 && right.originalPhotoIds === void 0 || !!left.originalPhotoIds && !!right.originalPhotoIds && samePhotos(left.originalPhotoIds, right.originalPhotoIds)) && (left.composite === void 0 && right.composite === void 0 || !!left.composite && !!right.composite && left.composite.photoId === right.composite.photoId && left.composite.layout === right.composite.layout && left.composite.theme === right.composite.theme && left.composite.version === right.composite.version && (left.composite.version === "wedding-template-v1" || right.composite.version !== "wedding-template-v1" && left.composite.gridAspect === right.composite.gridAspect));
}
var galleryPhotoIds = (gallery) => [.../* @__PURE__ */ new Set([
  ...gallery.photoIds,
  ...gallery.originalPhotoIds ?? [],
  ...gallery.composite ? [gallery.composite.photoId] : []
])];
var guestArtwork = {
  classic: { key: "system/keepsake-art/v3/classic.png", sha256: "3ccb9f0acf030b5bc31b2bbf6d81f3e694e2dd2e045dc77fd930c6d4df59164e" },
  botanical: { key: "system/keepsake-art/v3/botanical.png", sha256: "4121598a7aa1d445fed5c223d4b475d706cb93567d90c51a42d1dad86cb36e21" },
  coastal: { key: "system/keepsake-art/v3/coastal.png", sha256: "8f3bbfb131c9454f6ea633a79445e6cd9b32176e9aa80c09080925b0d83884a0" }
};
function editableGallery(gallery) {
  const composite = gallery.composite;
  return gallery.photoIds.length === 4 && new Set(gallery.photoIds).size === 4 && gallery.photoIds.every((id) => uuid.test(id)) && gallery.originalPhotoIds?.length === 4 && new Set(gallery.originalPhotoIds).size === 4 && gallery.originalPhotoIds.every((id) => uuid.test(id)) && !!composite && uuid.test(composite.photoId) && ["strip", "grid"].includes(composite.layout) && ["classic", "botanical", "coastal"].includes(composite.theme) && (composite.version === "wedding-template-v1" || composite.version === "wedding-template-v2" && ["portrait", "square"].includes(composite.gridAspect) || composite.version === "wedding-template-v3" && composite.gridAspect === "square");
}
function keepsakeEditorHtml(token, gallery) {
  if (!editableGallery(gallery)) return "";
  const composite = gallery.composite;
  const config = JSON.stringify({
    version: composite.version,
    layout: composite.layout,
    theme: composite.theme,
    ...composite.version !== "wedding-template-v1" ? { gridAspect: composite.gridAspect } : {},
    photoUrls: gallery.photoIds.map((id) => `/g/${token}/photos/${id}`),
    ...composite.version === "wedding-template-v3" ? { artUrl: `/g/${token}/art/${composite.theme}` } : {}
  }).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<section class="variant-section" id="keepsake-editor" data-config="${config}" aria-labelledby="variant-title">
    <div class="collection-heading"><h2 id="variant-title">Make room for every memory</h2><p>Your photos, your layout</p></div>
    <p class="variant-intro">Start with Social Grid, or choose a classic Photo Strip. Download either with filled frames or every photo edge visible.</p>
    <div class="variant-options" role="group" aria-label="Keepsake layout"><button type="button" data-layout="grid" aria-pressed="true">Social Grid</button><button type="button" data-layout="strip" aria-pressed="false">Photo Strip</button></div>
    <div class="variant-options" role="group" aria-label="Photo placement"><button type="button" data-variant="fill" aria-pressed="true">Fill Frames</button><button type="button" data-variant="fit" aria-pressed="false">Full Photo</button></div>
    <p class="variant-note">Fill Frames crops from the top. Full Photo keeps every edge and may leave side space.</p>
    <p id="variant-status" class="variant-status" role="status" aria-live="polite">Preparing both versions\u2026</p>
    <button id="variant-retry" class="variant-retry" type="button" hidden>Retry versions</button>
    <figure class="variant-result"><img id="variant-preview" alt="Your new keepsake preview" hidden></figure>
    <div class="variant-downloads"><a id="download-fill" class="download" hidden>Download Fill Frames</a><a id="download-fit" class="download" hidden>Download Full Photo</a></div>
    <p class="quality">Full-resolution JPEGs \xB7 Made on your device</p><p class="variant-note">Made from your four selected photos, with your chosen layout and saved theme. Your saved booth keepsake and camera originals below stay unchanged.</p>
    <noscript><p>Enable JavaScript to prepare both versions. Your existing booth and original-photo downloads below still work.</p></noscript>
  </section><script src="/g/${token}/keepsake.js" defer></script>`;
}
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
  function diagnostic(value, phone) {
    const result = { stage: "response" };
    const id = typeof value.textId === "number" && Number.isSafeInteger(value.textId) ? String(value.textId) : value.textId;
    if (value.success === true && typeof id === "string" && /^\d{1,32}$/.test(id) && id !== apiKey && id !== phone.replace(/\D/g, "")) result.messageId = id;
    if (typeof value.quotaRemaining === "number" && Number.isSafeInteger(value.quotaRemaining) && value.quotaRemaining >= 0 && value.quotaRemaining <= 1e9) result.quotaRemaining = value.quotaRemaining;
    if (value.success === false) {
      const error = typeof value.error === "string" ? value.error : "";
      result.rejection = /out of quota|insufficient quota|quota.*(?:exhausted|exceeded|empty)/i.test(error) ? "out-of-quota" : /incomplete request|missing required/i.test(error) ? "incomplete-request" : /invalid.*key|key.*invalid/i.test(error) ? "invalid-key" : /invalid.*(?:phone|number)|(?:phone|number).*invalid/i.test(error) ? "invalid-number" : /too many|rate.?limit/i.test(error) ? "rate-limited" : /blocked|opt.?out|unsubscrib/i.test(error) ? "blocked-recipient" : /url|domain|link|message.*reject/i.test(error) ? "message-rejected" : "provider-rejected";
    }
    return result;
  }
  return { async send({ to, galleryUrl }) {
    try {
      const response = await fetcher("https://textbelt.com/text", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(1e4),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ phone: to, message: `Your wedding photos are ready: ${galleryUrl}`, key: testMode ? `${apiKey}_test` : apiKey }).toString()
      });
      if (!response.ok) return { ...smsResult("uncertain"), providerDiagnostic: { stage: "http", httpStatus: response.status } };
      const bytes = await readLimited(response, 4096);
      if (!bytes) return { ...smsResult("uncertain"), providerDiagnostic: { stage: "invalid-response" } };
      let result;
      try {
        result = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return { ...smsResult("uncertain"), providerDiagnostic: { stage: "invalid-response" } };
      }
      if (!result || typeof result !== "object" || !("success" in result) || typeof result.success !== "boolean")
        return { ...smsResult("uncertain"), providerDiagnostic: { stage: "invalid-response" } };
      const providerDiagnostic = diagnostic(result, to);
      if (result.success === false) return { ...smsResult("rejected"), providerDiagnostic };
      return { ...smsResult(testMode ? "test_accepted" : "accepted"), providerDiagnostic };
    } catch {
      return { ...smsResult("uncertain"), providerDiagnostic: { stage: "transport" } };
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
  const { providerDiagnostic: _previousDiagnostic, ...reserved } = record;
  const attempt = { ...reserved, status: "sending", attemptId: crypto.randomUUID() };
  const claimed = await env.PHOTOS.put(key, JSON.stringify(attempt), { onlyIf: { etagMatches: saved.etag } });
  if (!claimed) return respond("uncertain");
  const outcome = await provider.send({ idempotencyKey: shareId, to: phone, galleryUrl });
  try {
    const updated = await env.PHOTOS.put(key, JSON.stringify({
      ...attempt,
      status: outcome.status,
      ...outcome.providerDiagnostic ? { providerDiagnostic: outcome.providerDiagnostic } : {}
    }), { onlyIf: { etagMatches: claimed.etag } });
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
  .variant-section{margin:0 auto 48px}.variant-section .collection-heading{flex-wrap:wrap;align-items:flex-start;gap:8px;padding-right:4px}.variant-section .collection-heading h2{flex:1 1 220px;line-height:1.6}.variant-section .collection-heading p{line-height:1.6}.variant-intro{font-size:16px;color:var(--muted);max-width:620px;line-height:1.7}.variant-note{font-size:12px;line-height:1.7;color:var(--muted);max-width:740px}.variant-options{display:flex;gap:6px;max-width:510px;background:#e9e6dc;padding:5px;border-radius:30px;margin:20px auto 12px}.variant-options button{flex:1;min-height:48px;border:0;border-radius:26px;background:transparent;color:var(--ink);font:inherit;font-size:14px;font-weight:500;cursor:pointer;padding:12px}.variant-options button[aria-pressed="true"]{background:var(--forest);color:var(--white)}.variant-options button:focus-visible,.variant-retry:focus-visible,.variant-downloads a:focus-visible{outline:3px solid #b8964f;outline-offset:3px}.variant-status{text-align:center;color:var(--muted);font-size:13px;min-height:22px}.variant-result{margin:20px auto;max-width:820px}.variant-result img{display:block;width:100%;height:auto;border-radius:2px}.variant-result.variant-strip{max-width:360px}.variant-downloads{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.variant-downloads a{flex:1;max-width:340px;min-width:210px}.variant-retry{display:block;margin:12px auto;padding:12px 25px;min-height:48px;border:1px solid #b4aa98;border-radius:26px;background:transparent;color:var(--ink);font:inherit;cursor:pointer}.variant-section [hidden]{display:none!important}
  @media(min-width:1100px){.photos:has(.photo:only-child){max-width:650px;margin:auto}}@media(max-width:700px){.shell{padding:0 23px}.masthead{padding:25px 0;gap:13px}.brand{font-size:10px;letter-spacing:.8px}.hero{padding:49px 0 36px}h1{letter-spacing:-1.4px}.intro{font-size:14px;max-width:330px}.photos{gap:24px}.collection-heading{padding:19px 0}.collection-heading p{font-size:10px}.privacy{margin:40px auto 34px}.photo{padding:10px 10px 0}.photo figcaption{padding:18px 6px 20px}.footer{font-size:16px}.download{min-height:50px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.download:hover{transform:none}}
`;
function guestDocument(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#f6efe4"><title>${title}</title><style>${galleryStyles}</style></head><body><div class="shell"><header class="masthead"><span class="ornament" aria-hidden="true"></span><span class="brand">Gizelle &amp; Rami \xB7 November 1, 2026</span><span class="ornament" aria-hidden="true"></span></header>${content}<footer class="footer">Made of moments like these.</footer></div></body></html>`;
}
function guestPage(html, status = 200, editor = false) {
  return new Response(html, { status, headers: {
    ...privateHeaders,
    "Content-Type": "text/html; charset=utf-8",
    ...editor ? { "Content-Security-Policy": "default-src 'none'; img-src 'self' blob:; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'" } : {}
  } });
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
  return guestDocument("Your wedding photos", `<main><section class="hero reveal" aria-labelledby="gallery-title"><p class="eyebrow">A keepsake from the celebration</p><h1 id="gallery-title">Your night,<span>beautifully captured.</span></h1><p class="intro">A little joy to take home.</p></section>${keepsakeEditorHtml(token, gallery)}${keepsake}<section aria-label="Your photos"><div class="collection-heading"><h2>${gallery.composite ? "Your individual photos" : "Your wedding photos"}</h2><p>${gallery.photoIds.length} ${gallery.photoIds.length === 1 ? "memory" : "memories"} \xB7 original quality</p></div><div class="photos">${items}</div></section>${originals}<aside class="privacy"><h2>A private keepsake.</h2><p>Anyone with this link can view and download these photos.<br>Save your favorites, and forward this link only with care.</p><p class="expiry">Available until <time datetime="${new Date(gallery.expiresAt).toISOString()}">${expires} UTC</time>.<br>Link expiry closes access; it does not delete the original photos.</p></aside></main>`);
}
async function handle(request, env) {
  const url = new URL(request.url);
  const config = configFor(url, env);
  if (!config) return json({ error: "Service configuration unavailable" }, 503);
  const protection = await protectStorage(request, url, env);
  if (protection) return protection;
  if (url.pathname === "/health" && request.method === "GET")
    return json({ status: "ok", storage: env.MODE === "local" ? "local-r2" : "private-r2", sms: env.SMS_MODE, smsAvailable: liveSmsAvailable(env) });
  const guest = /^\/g\/([a-f0-9]{64})(?:\/photos\/([0-9a-f-]+)|\/(keepsake\.js)|\/art\/(classic|botanical|coastal))?$/.exec(url.pathname);
  if (guest && request.method === "GET") {
    const token = guest[1];
    const gallery = await loadGallery(env, await digest(encoder.encode(token)));
    if (gallery instanceof Response) {
      if (guest[2] || guest[3] || guest[4]) return gallery;
      const detail = await gallery.json();
      return unavailableGallery(gallery.status, detail.error);
    }
    const currentToken = await tokenFor(gallery.sessionId, config.signingKey);
    if (!crypto.subtle.timingSafeEqual(encoder.encode(token), encoder.encode(currentToken)))
      return guest[2] || guest[3] || guest[4] ? json({ error: "Link revoked" }, 410) : unavailableGallery(410, "Link revoked");
    if (guest[3]) {
      if (!editableGallery(gallery)) return json({ error: "Four source photos and a keepsake are required" }, 404);
      return new Response(guest_keepsake_default, { headers: { ...privateHeaders, "Content-Type": "application/javascript; charset=utf-8" } });
    }
    if (guest[4]) {
      if (!editableGallery(gallery) || gallery.composite?.version !== "wedding-template-v3" || gallery.composite.theme !== guest[4])
        return json({ error: "Artwork unavailable" }, 404);
      const art = guestArtwork[guest[4]];
      const object = await env.PHOTOS.get(art.key);
      if (!object || object.size > 4 * 1024 * 1024) return json({ error: "Artwork unavailable" }, 503);
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (await digest(bytes) !== art.sha256) return json({ error: "Artwork unavailable" }, 503);
      return new Response(bytes, { headers: { ...privateHeaders, "Content-Type": "image/png", "Content-Length": String(bytes.length) } });
    }
    if (!guest[2]) return guestPage(galleryHtml(token, gallery), 200, editableGallery(gallery));
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
