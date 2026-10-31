/** Synthetic-only, loopback HTTP harness for the actual Worker. No production access. */
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { workerSource } from '../../services/api/test/worker-source.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const photoKey = (session, id) => `sessions/${session}/photos/${id}.jpg`;
export async function startLocalGallery({ emailHarness } = {}) {
  // Only synthetic test configuration can be injected. No fallback uses real I/O.
  if (emailHarness && (typeof emailHarness.outbound !== 'function' || Object.keys(emailHarness.bindings ?? {}).some(key => !['EMAIL_MODE','RESEND_API_KEY','EMAIL_FROM','EMAIL_DAILY_LIMIT','EMAIL_SENDER_VERIFIED'].includes(key)))) throw new Error('Invalid local email harness');
  const outbound = [], requests = [], bridgeErrors = [];
  const runtime = new Miniflare({ modules: true, cf: false, script: workerSource(), compatibilityDate: '2026-07-30', r2Buckets: ['PHOTOS'],
    bindings: { MODE: 'local', SMS_MODE: 'mock', LOCAL_DEVICE_TOKEN: 'synthetic-browser-only', LOCAL_LINK_KEY: 'synthetic-guest-keepsake-local-key', ...(emailHarness?.bindings ?? {}) },
    outboundService: async request => { const url=new URL(request.url);outbound.push(url.origin);if(emailHarness && url.href==='https://api.resend.com/emails' && request.method==='POST')return emailHarness.outbound(request);throw new Error('No external calls allowed'); },
  });
  let deadline;
  try { await Promise.race([runtime.ready,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Local runtime readiness exceeded60seconds')),60000);})]); } catch(error) { await runtime.dispose(); throw error; } finally { clearTimeout(deadline); }
  const server = createServer(async (req, res) => {
    try {
      const body = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 11 * 1024 * 1024) throw new Error('Request too large'); body.push(chunk); }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      requests.push({ method: req.method, kind: pathname.startsWith('/v1/shares') ? 'sms' : pathname.endsWith('/email') ? 'email' : pathname.includes('/art/') ? 'art' : pathname.includes('/photos/') ? 'photo' : pathname.endsWith('.js') ? 'script' : 'page' });
      const response = await runtime.dispatchFetch(new URL(req.url, origin), { method: req.method, headers: req.headers, ...(body.length ? { body: Buffer.concat(body) } : {}) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error) { bridgeErrors.push({name:error?.name??'unknown',code:typeof error?.code==='string'?error.code:undefined,referrer:/referrer/i.test(error?.message??''),headers:/headers/i.test(error?.message??''),fetch:/fetch/i.test(error?.message??'')}); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Local harness failed'); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bucket = await runtime.getR2Bucket('PHOTOS');
  const arts = { classic: 'Classic-Ivory', botanical: 'Sage-Botanical', coastal: 'Coastal-Sea-Glass' };
  const artBytes = new Map();
  for (const [theme, name] of Object.entries(arts)) {
    const bytes = await readFile(resolve(`design/frame-art-v1/${name}-Text-Free-Artwork.png`)); artBytes.set(theme, bytes);
    await bucket.put(`system/keepsake-art/v3/${theme}.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
  }
  const auth = { Authorization: 'Bearer synthetic-browser-only' };
  async function seed({ version = 'wedding-template-v3', layout = 'grid', theme = 'classic', aspect = 'square', photos }) {
    const sessionId = randomUUID(), ids = photos.map(() => randomUUID()), compositeId = randomUUID();
    const selectedBytes = new Map(ids.map((id, i) => [id, Buffer.from(photos[i])]));
    // Existing booth output is independent from guest variants and must remain byte-for-byte intact.
    const composite = await readFile(resolve('artifacts/visual/frame-art-v3/grid-classic-full.jpg'));
    for (const [id, bytes] of [...selectedBytes, [compositeId, composite]]) {
      const response = await fetch(`${origin}/v1/sessions/${sessionId}/photos/${id}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: bytes });
      if (response.status !== 201) throw new Error(`Synthetic upload failed ${response.status}`);
    }
    const descriptor = { version, photoId: compositeId, layout, theme, ...(version === 'wedding-template-v1' ? {} : { gridAspect: aspect }) };
    const ready = await fetch(`${origin}/v1/sessions/${sessionId}/ready`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: ids, originalPhotoIds: ids, composite: descriptor }) });
    if (ready.status !== 200) throw new Error(`Synthetic readiness failed ${ready.status}`);
    const value = await ready.json();
    return { ...value, sessionId, ids, compositeId, selectedBytes, composite, sourceHashes: ids.map(id => hash(selectedBytes.get(id))),
      async removePhoto(index = 0) { await bucket.delete(photoKey(sessionId, ids[index])); },
      async restorePhoto(index = 0) { const id = ids[index], bytes = selectedBytes.get(id); await bucket.put(photoKey(sessionId, id), bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { sha256: hash(bytes) } }); },
    };
  }
  return { origin, runtime, bucket, seed, requests, outbound, bridgeErrors,
    async removeArt(theme) { await bucket.delete(`system/keepsake-art/v3/${theme}.png`); },
    async restoreArt(theme) { await bucket.put(`system/keepsake-art/v3/${theme}.png`, artBytes.get(theme), { httpMetadata: { contentType: 'image/png' } }); },
    async close() { await new Promise(ok => server.close(ok)); await runtime.dispose(); },
  };
}
