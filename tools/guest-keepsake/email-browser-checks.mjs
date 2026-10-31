/** Actual Worker/client email UI acceptance. Synthetic loopback only; no actual email/network. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startLocalGallery } from './local-server.mjs';
import { launchBrowser } from '../native-visual/new-session/browser.mjs';
const output='artifacts/visual/guest-email';await mkdir(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['services/api/src/index.ts','services/api/src/guest-email.ts','services/api/src/guest-email.client','services/api/test/worker-source.ts','tools/guest-keepsake/local-server.mjs','tools/guest-keepsake/email-browser-checks.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,hash(await readFile(file))])));
const photos=await Promise.all(['studio-portrait-1.jpg','studio-portrait-2.jpg','studio-portrait-4.jpg','studio-landscape-1.jpg'].map(file=>readFile('apps/ipad/native-tests/fixtures/studio/'+file)));
const report={scope:'Actual bundled private Worker HTML/email client with local R2 in Chromium. Resend outbound adapter is intercepted inside Miniflare and never uses network. Synthetic addresses only; no emails, SMS, production or Safari/device claims.',status:'running',sourceHashes:hashes,cases:[],errors:[],external:[]};
const browser=await launchBrowser();let local,context,release;
try{
 for(const[label,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1440,height:1000}})){
  // The normal server has no email configuration; optional UI must disappear completely.
  local=await startLocalGallery();const disabled=await local.seed({photos});context=await browser.newContext({viewport});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===local.origin||['blob:','data:'].includes(url.protocol))return route.continue();report.external.push(url.origin);return route.abort();});
  let page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(disabled.url);assert.equal(await page.locator('#guest-email-form').count(),0);assert.equal(local.outbound.length,0);report.cases.push({viewport:label,outcome:'unconfigured',formHidden:true});await context.close();context=undefined;await local.close();local=undefined;
  for(const outcome of ['accepted','rejected','uncertain']){
   const provider=[];let unblocked=false;const gate=new Promise(ok=>{release=()=>{unblocked=true;ok();};});
   local=await startLocalGallery({emailHarness:{bindings:{EMAIL_MODE:'resend',RESEND_API_KEY:'re_synthetic_browser_only_not_live',EMAIL_FROM:'photos@example.test',EMAIL_SENDER_VERIFIED:'approved',EMAIL_DAILY_LIMIT:'1'},outbound:async request=>{assert.equal(new URL(request.url).href,'https://api.resend.com/emails');assert.equal(request.method,'POST');provider.push({method:request.method});await gate;if(outcome==='accepted')return Response.json({id:'22222222-2222-4222-8222-222222222222'});if(outcome==='rejected')return Response.json({message:'Synthetic provider rejection'},{status:403});throw new Error('Synthetic provider transport uncertainty');}}});
   const seed=await local.seed({photos});context=await browser.newContext({viewport});await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===local.origin||['blob:','data:'].includes(url.protocol))return route.continue();report.external.push(url.origin);return route.abort();});
   page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));const emailResponses=[],emailHeaders=[];page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/email')){const h=request.headers();emailHeaders.push({originMatches:h.origin===local.origin,originNull:h.origin==='null',secFetchSite:h['sec-fetch-site']??'absent',referrerRoot:h.referer===local.origin+'/'});}});page.on('response',async response=>{if(new URL(response.url()).pathname.endsWith('/email')){const entry={httpStatus:response.status(),contentType:response.headers()['content-type']};emailResponses.push(entry);try{const body=await response.text();entry.localBridgeFailure=body==='Local harness failed';try{entry.status=JSON.parse(body)?.status;}catch{}}catch{}}});await page.goto(seed.url);
   const form=page.locator('#guest-email-form'),input=page.locator('#guest-email'),consent=page.locator('#guest-email-consent'),button=page.locator('#guest-email-send'),status=page.locator('#guest-email-status');await form.waitFor();
   assert.equal(await button.isDisabled(),true);await input.fill('fictional-guest@example.invalid');assert.equal(await button.isDisabled(),true,'Email alone is not consent');assert.equal(provider.length,0);assert.equal(local.requests.filter(x=>x.kind==='email').length,0);
   await consent.check();assert.equal(await button.isEnabled(),true);assert.equal(provider.length,0,'No request until explicit submit');
   // Two real form submit events in the same JS task exercise the synchronous guard.
   await form.evaluate(form=>{form.requestSubmit();form.requestSubmit();});
   await page.waitForFunction(()=>document.querySelector('#guest-email-send').disabled&&document.querySelector('#guest-email-send').textContent==='Sending…');
   await page.waitForTimeout(50);assert.equal(await input.isDisabled(),true);assert.equal(await consent.isDisabled(),true);assert.equal(local.requests.filter(x=>x.kind==='email').length,1,'Synchronous duplicate submit must issue one browser request');
   const pendingText=await status.textContent();assert.match(pendingText,/sending/i);if(outcome==='accepted')await form.locator('..').screenshot({path:`${output}/${label}-pending.png`});
   release();release=undefined;
   await page.waitForFunction(()=>document.querySelector('#guest-email-send').textContent!=='Sending…',null,{timeout:30000});
   const resultText=await status.textContent();const localFences={};for(const prefix of ['email-deliveries/','email-quota/']){const listed=await local.bucket.list({prefix});localFences[prefix]=[];for(const object of listed.objects){const body=await(await local.bucket.get(object.key)).json();localFences[prefix].push({status:body.status,claimed:body.claimed});}}report.lastObserved={viewport:label,outcome,resultText,providerRequests:provider.length,outboundOrigins:local.outbound,bridgeErrors:local.bridgeErrors,emailResponses,emailHeaders,localFences};assert.equal(provider.length,1,JSON.stringify(report.lastObserved));assert.equal(await button.isDisabled(),true,'Accepted/rejected/uncertain terminal states prevent accidental resend');
   if(outcome==='accepted'){assert.match(resultText,/accepted/i);assert.match(resultText,/not confirmed/i);assert.equal(await input.inputValue(),'');}
   else if(outcome==='uncertain'){assert.match(resultText,/could not be confirmed/i);assert.match(resultText,/will not be resent/i);assert.equal(await input.inputValue(),'');}
   else{assert.match(resultText,/rejected|unavailable|limit/i);assert.match(resultText,/direct downloads/i);}
   const count=local.requests.filter(x=>x.kind==='email').length;await form.evaluate(form=>{form.requestSubmit();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.waitForTimeout(80);assert.equal(local.requests.filter(x=>x.kind==='email').length,count);assert.equal(provider.length,1);
   const direct=await fetch(seed.url+'/photos/'+seed.compositeId+'?download=1');assert.equal(direct.status,200);assert.equal(hash(Buffer.from(await direct.arrayBuffer())),hash(seed.composite));
   const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));assert.deepEqual(storage,{local:[],session:[]});
   const bounds=await form.evaluate(form=>{const r=form.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth};});assert.ok(bounds.left>=-1&&bounds.right<=bounds.width+1&&bounds.scroll<=bounds.width+1,'Email form fits viewport');await form.locator('..').screenshot({path:`${output}/${label}-${outcome}.png`});
   report.cases.push({viewport:label,outcome,providerRequests:provider.length,pendingText,resultText,duplicateBrowserRequestGuard:true,terminalNoRetry:true,directBoothUnchanged:true,noBrowserAddressStorage:true});
   assert.ok(local.outbound.every(origin=>origin==='https://api.resend.com'),'Only fake Resend adapter may be called');assert.equal(local.requests.filter(x=>x.kind==='sms').length,0);
   await context.close();context=undefined;await local.close();local=undefined;
  }
 }
 // Real Miniflare R2 conditional writes, concurrent galleries: a two-slot cap.
 let quotaProviderCalls=0;
 local=await startLocalGallery({emailHarness:{bindings:{EMAIL_MODE:'resend',RESEND_API_KEY:'re_synthetic_browser_only_not_live',EMAIL_FROM:'photos@example.test',EMAIL_SENDER_VERIFIED:'approved',EMAIL_DAILY_LIMIT:'2'},outbound:async()=>{quotaProviderCalls++;return Response.json({id:'33333333-3333-4333-8333-333333333333'});}}});
 const sessions=await Promise.all(Array.from({length:4},()=>local.seed({photos})));
 const attempt=(seed,index)=>fetch(seed.url+'/email',{method:'POST',headers:{Origin:local.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify({email:`quota-fixture-${index}@example.invalid`,consent:true})}).then(async response=>({httpStatus:response.status,...await response.json()}));
 const outcomes=await Promise.all(sessions.map(attempt));assert.equal(outcomes.filter(x=>x.status==='accepted').length,2);assert.equal(outcomes.filter(x=>x.status==='quota-exhausted').length,2);assert.equal(quotaProviderCalls,2);
 const replay=await Promise.all(sessions.map(attempt));assert.deepEqual(replay.map(x=>x.status),outcomes.map(x=>x.status));assert.equal(quotaProviderCalls,2);
 const slots=await local.bucket.list({prefix:'email-quota/'}),fences=await local.bucket.list({prefix:'email-deliveries/'});assert.equal(slots.objects.length,2);assert.equal(fences.objects.length,4);
 for(const object of fences.objects){const value=await(await local.bucket.get(object.key)).text();assert.ok(!value.includes('@'),'No raw recipient in local durable fence');}
 report.realR2Quota={dailyLimit:2,concurrentGalleries:4,accepted:2,blocked:2,simulatedProviderCalls:quotaProviderCalls,replaysResent:0,durableSlots:slots.objects.length,durableFences:fences.objects.length,noRawRecipientInFences:true};await local.close();local=undefined;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);for(const file of files)assert.equal(hash(await readFile(file)),hashes[file],'Source changed during email browser run: '+file);report.status='passed';
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{release?.();await context?.close();await local?.close();await browser.close();await writeFile(`${output}/checks.json`,JSON.stringify(report,null,2)+'\n');}
