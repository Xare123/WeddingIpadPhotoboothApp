/** Human-readable, fictional-adult showcase of the actual guest Worker/client. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startLocalGallery } from './local-server.mjs';
import { launchBrowser } from '../native-visual/new-session/browser.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const output='artifacts/visual/guest-keepsake-clean';await mkdir(output,{recursive:true});
const sources=['studio-portrait-1.jpg','studio-portrait-2.jpg','studio-portrait-4.jpg','studio-landscape-1.jpg'].map(name=>'apps/ipad/native-tests/fixtures/studio/'+name);
const photos=await Promise.all(sources.map(path=>readFile(path)));
const tracked=['services/api/src/index.ts','services/api/src/guest-keepsake.client','services/api/test/worker-source.ts','tools/guest-keepsake/local-server.mjs','tools/guest-keepsake/clean-showcase.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(tracked.map(async path=>[path,hash(await readFile(path))])));
const report={scope:'Actual private guest HTML/client and local Miniflare R2. Existing independently generated fictional adult photos, no guest photographs. Chromium only; not Safari/native/device or production proof.',status:'running',recipe:{version:'wedding-template-v3',layout:'grid',theme:'coastal',gridAspect:'square'},sources:sources.map((file,index)=>({file,sha256:hash(photos[index]),provenance:'Existing repository image_gen studio fixtures; full-frame proportional downsample/JPEG only. Each input was visually inspected before use; no drinks or diagnostic markers.'})),sourceHashes,outputs:[],screenshots:[],errors:[],external:[]};
const browser=await launchBrowser();let local;
try{
 local=await startLocalGallery();const seed=await local.seed({photos,version:report.recipe.version,layout:report.recipe.layout,theme:report.recipe.theme,aspect:report.recipe.gridAspect});
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===local.origin||url.protocol==='blob:'||url.protocol==='data:')return route.continue();report.external.push(url.origin);return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(seed.url);
 await page.waitForFunction(()=>['fill','fit'].every(mode=>document.querySelector('#download-'+mode)?.getAttribute('href')?.startsWith('blob:')),null,{timeout:60000});
 for(const mode of ['fill','fit']){
  await page.locator(`[data-variant="${mode}"]`).click();await page.waitForFunction(mode=>{const image=document.querySelector('#variant-preview');return image.complete&&image.naturalWidth&&image.src===document.querySelector('#download-'+mode).href;},mode);
  const wait=page.waitForEvent('download');await page.locator('#download-'+mode).click();const download=await wait;assert.equal(await download.failure(),null);const file=`${output}/coastal-square-${mode}.jpg`;await download.saveAs(file);const bytes=await readFile(file);
  const dimensions=await page.evaluate(()=>{const image=document.querySelector('#variant-preview');return[image.naturalWidth,image.naturalHeight];});assert.deepEqual(dimensions,[2400,2400]);report.outputs.push({file,sha256:hash(bytes),bytes:bytes.length,dimensions});
  for(const[label,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1440,height:1000}})){await page.setViewportSize(viewport);await page.locator('#variant-preview').evaluate(image=>image.decode());const screenshot=`${output}/coastal-square-${mode}-${label}.png`;await page.locator('#keepsake-editor').screenshot({path:screenshot});report.screenshots.push({file:screenshot,viewport,sha256:hash(await readFile(screenshot))});}
 }
 for(const[i,id]of seed.ids.entries()){const response=await fetch(seed.url+'/photos/'+id);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(photos[i]));}
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(local.outbound,[]);assert.equal(local.requests.filter(x=>x.kind==='sms').length,0);report.unchangedSources=true;report.smsRequests=0;report.outboundRequests=0;
 for(const file of tracked)assert.equal(hash(await readFile(file)),sourceHashes[file],'Source changed during showcase: '+file);report.status='passed';await context.close();
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{await writeFile(`${output}/showcase-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();await local?.close();}
