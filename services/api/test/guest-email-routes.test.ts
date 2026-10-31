import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { workerSource, workerModule } from './worker-source';
const key = 'synthetic-email-route-signing-key';
const sessionId = randomUUID();
const token = createHmac('sha256', key).update(`gallery:v1:${sessionId}`).digest('hex');
const path = `/g/${token}`;
const hash = createHash('sha256').update(token).digest('hex');
const base = { MODE: 'local', SMS_MODE: 'mock', LOCAL_DEVICE_TOKEN: 'local-only', LOCAL_LINK_KEY: key };
async function setup(enabled = false) {
 const runtime = new Miniflare({ modules:true, cf:false, script:workerSource(), compatibilityDate:'2026-07-30',r2Buckets:['PHOTOS'],bindings:{...base,...(enabled?{EMAIL_MODE:'mock'}:{})},outboundService:async()=>{throw new Error('No external requests');} });
 await runtime.ready;
 const bucket=await runtime.getR2Bucket('PHOTOS');
 await bucket.put(`galleries/${hash}.json`,JSON.stringify({version:1,sessionId,photoIds:[randomUUID()],expiresAt:Date.now()+60000}));
 return {runtime,bucket};
}
test('email is hidden and disabled by default without changing original gallery downloads',async()=>{
 const {runtime}=await setup();try{
 const response=await runtime.dispatchFetch(`http://localhost${path}`);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/id="guest-email-form"/);
 assert.equal((await runtime.dispatchFetch(`http://localhost${path}/email.js`)).status,404);
 const result=await runtime.dispatchFetch(`http://localhost${path}/email`,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test',consent:true})});assert.equal(result.status,503);
 }finally{await runtime.dispose();}
});
test('configured email is capability scoped, origin protected, private and revoked with its gallery',async()=>{
 const {runtime,bucket}=await setup(true);try{
 const page=await runtime.dispatchFetch(`http://localhost${path}`);const html=await page.text();assert.match(html,/id="guest-email-form"/);assert.match(html,/id="guest-email-consent"/);assert.match(page.headers.get('Content-Security-Policy')!,/script-src 'self'/);
 const script=await runtime.dispatchFetch(`http://localhost${path}/email.js`);assert.equal(script.status,200);assert.match(await script.text(),/Sending…/);
 const send=(origin:string)=>runtime.dispatchFetch(`http://localhost${path}/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test',consent:true})});
 assert.equal((await send('https://other.example')).status,403);
 const accepted=await send('http://localhost');assert.equal(accepted.headers.get('Cache-Control'),'private, no-store');assert.equal((await accepted.json() as {status:string}).status,'mocked');
 await bucket.put(`revocations/sessions/${sessionId}.json`,'{}');assert.equal((await send('http://localhost')).status,410);assert.equal((await runtime.dispatchFetch(`http://localhost${path}/email.js`)).status,410);
 }finally{await runtime.dispose();}
});

test('email request consumes SHARE protection before any private storage lookup',async()=>{
 const worker=await workerModule();let reads=0,share=0;
 const success={limit:async()=>({success:true})};
 const env={MODE:'production',SMS_MODE:'mock',DEVICE_TOKEN:'unique-device-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789',LINK_SIGNING_KEY:'unique-link-secret-abcdefghijklmnopqrstuvwxyz123456789',PUBLIC_ORIGIN:'https://photos.example.test',PHOTOS:new Proxy({}, {get(){reads++;throw new Error('Must not read storage');}}),RATE_GALLERY_GLOBAL:success,RATE_GALLERY_CLIENT:success,RATE_PHOTO_GLOBAL:success,RATE_PHOTO_CLIENT:success,RATE_API_GLOBAL:success,RATE_API_CLIENT:success,RATE_SHARE_GLOBAL:{limit:async()=>{share++;return{success:false};}},RATE_SHARE_CLIENT:success};
 const response=await worker.default.fetch(new Request(`https://photos.example.test${path}/email`,{method:'POST',headers:{Origin:'https://photos.example.test','Content-Type':'application/json'},body:'{}'}),env as never);
 assert.equal(response.status,429);assert.match(response.headers.get('Content-Type')!,/json/);assert.equal(reads,0);assert.equal(share,1);
});
