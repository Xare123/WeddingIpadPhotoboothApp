/** Actual Worker HTML + embedded client in Chromium; synthetic data and local R2 only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchBrowser } from '../native-visual/new-session/browser.mjs';
import { startLocalGallery } from './local-server.mjs';
const output = 'artifacts/visual/guest-keepsake';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Actual Worker HTTP/HTML/client + local R2 in Chromium. Synthetic marker JPEGs only. No Safari, iOS, native renderer, production deployment, private guest content or SMS proof.', status: 'running', cases: [], errors: [], blockedExternal: [], faults: [] };
await mkdir(output, { recursive: true });
const sourceFiles=['services/api/src/index.ts','services/api/src/guest-keepsake.client','services/api/test/worker-source.ts','tools/guest-keepsake/local-server.mjs','tools/guest-keepsake/browser-checks.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(file))])));
const browser = await launchBrowser(); let local;
try {
  const setup = await browser.newPage();
  const photos = (await setup.evaluate(async () => {
    const result = [];
    for (const [i, color] of ['#B83C62','#30865F','#365BC5','#B68A28'].entries()) {
      const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=480;
      const ctx=canvas.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,320,480);
      ctx.fillStyle='#D92525';ctx.fillRect(0,0,20,480);ctx.fillStyle='#2049DC';ctx.fillRect(300,0,20,480);
      ctx.fillStyle='#DCCA28';ctx.fillRect(0,0,320,20);ctx.fillStyle='#25B846';ctx.fillRect(0,460,320,20);
      ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC '+(i+1),50,65);
      result.push(canvas.toDataURL('image/jpeg',.98).split(',')[1]);
    } return result;
  })).map(x=>Buffer.from(x,'base64'));
  // An upright marker image stored counterclockwise with EXIF=6 must decode
  // to the same portrait composition. This tests real browser EXIF handling.
  const rotated = execFileSync('python3', ['-c', `import sys,io,base64
from PIL import Image
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB').transpose(Image.Transpose.ROTATE_90)
exif=im.getexif(); exif[274]=6
out=io.BytesIO(); im.save(out,format='JPEG',quality=98,exif=exif); sys.stdout.buffer.write(out.getvalue())`], { input: photos[2] });
  photos[2] = rotated;
  // A horizontally flipped stored raster tagged EXIF=2 must restore the same
  // left-red/right-blue edge oracle, not mirror it a second time.
  const mirrored = execFileSync('python3', ['-c', `import sys,io
from PIL import Image
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB').transpose(Image.Transpose.FLIP_LEFT_RIGHT)
exif=im.getexif(); exif[274]=2
out=io.BytesIO(); im.save(out,format='JPEG',quality=98,exif=exif); sys.stdout.buffer.write(out.getvalue())`], { input: photos[3] });
  photos[3] = mirrored;
  report.fixture = { count: 4, storedDimensions: [[320,480],[320,480],[480,320],[320,480]], thirdExifOrientation: 6, fourthExifOrientation: 2, allExpectedUpright: [320,480], fourthExpectedLeftRight: 'Left red, right blue after EXIF2; same edge oracle as unmirrored source.' };
  await setup.close(); local=await startLocalGallery();
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.route('**/*', route=>{ const url=new URL(route.request().url()); if(url.origin===local.origin||url.protocol==='blob:'||url.protocol==='data:') return route.continue(); report.blockedExternal.push(url.origin); return route.abort(); });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const ready=async()=>{await page.waitForFunction(()=>['fill','fit'].every(mode=>document.querySelector('#download-'+mode)?.getAttribute('href')?.startsWith('blob:')),null,{timeout:60000});};
  async function select(mode){await page.locator(`[data-variant="${mode}"]`).click();await page.waitForFunction(mode=>{const p=document.querySelector('#variant-preview'),button=document.querySelector(`[data-variant="${mode}"]`);return p instanceof HTMLImageElement&&p.complete&&p.naturalWidth>0&&(button?.getAttribute('aria-pressed')==='true'||button?.getAttribute('aria-selected')==='true'||p.dataset.variant===mode);},mode,{timeout:15000});}
  async function download(mode,name){await select(mode);const waiting=page.waitForEvent('download');await page.locator('#download-'+mode).click();const downloaded=await waiting;assert.equal(await downloaded.failure(),null);await downloaded.saveAs(`${output}/${name}-${mode}.jpg`);const bytes=await readFile(`${output}/${name}-${mode}.jpg`);assert.equal(bytes[0],255);assert.equal(bytes[1],216);return{bytes,sha256:hash(bytes),byteLength:bytes.length};}
  async function pixels(bytes,meta,mode){return page.evaluate(async({base64,meta,mode})=>{
    const binary=atob(base64),raw=Uint8Array.from(binary,c=>c.charCodeAt(0)),blob=new Blob([raw],{type:'image/jpeg'}),image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const at=(x,y)=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data].slice(0,3);
    let windows;
    if(meta.layout==='strip') windows=Array.from({length:4},(_,i)=>meta.version==='wedding-template-v3'?{x:100,y:220+i*770,w:1000,h:750}:{x:60,y:60+i*834,w:1080,h:810});
    else if(meta.version==='wedding-template-v1')windows=Array.from({length:4},(_,i)=>({x:96+i%2*1128,y:96+Math.floor(i/2)*858,w:1080,h:810}));
    else if(meta.version==='wedding-template-v3')windows=Array.from({length:4},(_,i)=>({x:184+i%2*1032,y:160+Math.floor(i/2)*1032,w:1000,h:1000}));
    else windows=Array.from({length:4},(_,i)=>meta.aspect==='portrait'?{x:72+i%2*1140,y:72+Math.floor(i/2)*1356,w:1116,h:1332}:{x:96+i%2*1128,y:60+Math.floor(i/2)*1104,w:1080,h:1080});
    return{width:image.width,height:image.height,centers:windows.map(w=>at(w.x+w.w/2,w.y+w.h/2)),edges:windows.map(w=>{const s=Math.min(w.w/320,w.h/480),dx=w.x+(w.w-320*s)/2,dy=w.y+(w.h-480*s)/2;return mode==='fit'?{left:at(dx+8*s,dy+240*s),right:at(dx+312*s,dy+240*s),top:at(dx+160*s,dy+8*s),bottom:at(dx+160*s,dy+472*s)}:{top:at(w.x+w.w/2,w.y+8),bottom:at(w.x+w.w/2,w.y+w.h-8)};})};
  },{base64:bytes.toString('base64'),meta,mode});}
  const variants=[...['strip','grid'].flatMap(layout=>['classic','botanical','coastal'].map(theme=>({version:'wedding-template-v3',layout,theme,aspect:'square'}))),{version:'wedding-template-v1',layout:'grid',theme:'classic'},{version:'wedding-template-v2',layout:'grid',theme:'botanical',aspect:'portrait'},{version:'wedding-template-v2',layout:'grid',theme:'coastal',aspect:'square'}];
  const expectedCenters=[[184,60,98],[48,134,95],[54,91,197],[182,138,40]],near=(a,b,t=28)=>a.every((v,i)=>Math.abs(v-b[i])<=t);
  for(const [index,meta] of variants.entries()){
    const seed=await local.seed({...meta,photos}); await page.goto(seed.url);await ready();
    const name=`${meta.version.replace('wedding-template-','')}-${meta.layout}-${meta.theme}-${meta.aspect??'legacy'}`;
    const outputs={};for(const mode of ['fill','fit']){const value=await download(mode,name),facts=await pixels(value.bytes,meta,mode);const height=meta.layout==='strip'?3600:meta.version==='wedding-template-v1'?2100:meta.aspect==='portrait'?3000:2400;assert.deepEqual([facts.width,facts.height],[meta.layout==='strip'?1200:2400,height]);facts.centers.forEach((rgb,i)=>assert.ok(near(rgb,expectedCenters[i]),`Four unique source centers ${name}/${mode}/${i}: ${rgb}`));
      if(mode==='fill')for(const [i,edges] of facts.edges.entries()){assert.ok(near(edges.top,[220,202,40]),`Top-aligned Fill retains top edge ${name}/${i}`);assert.ok(!near(edges.bottom,[37,184,70]),`Fill deliberately crops lower edge ${name}/${i}`);}
      if(mode==='fit')for(const edges of facts.edges){for(const [key,color] of Object.entries({left:[217,37,37],right:[32,73,220],top:[220,202,40],bottom:[37,184,70]}))assert.ok(near(edges[key],color),`Full-photo edge preserved ${name}/${key}: ${edges[key]}`);}outputs[mode]={sha256:value.sha256,bytes:value.byteLength,...facts};}
    assert.notEqual(outputs.fill.sha256,outputs.fit.sha256);
    if(index===0){for(let i=0;i<20;i++)await select(i%2?'fit':'fill');const beforeRapid=await page.evaluate(()=>Object.fromEntries(['fill','fit'].map(mode=>[mode,document.querySelector('#download-'+mode).href])));await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector(`[data-variant="${i%2?'fit':'fill'}"]`).click();});await page.waitForFunction(()=>document.querySelector('#variant-preview').src===document.querySelector('#download-fit').href);const refs=await page.locator('#keepsake-editor').evaluate(root=>Object.fromEntries(['fill','fit'].map(mode=>[mode,root.querySelector('#download-'+mode).href])));assert.ok(refs.fill.startsWith('blob:')&&refs.fit.startsWith('blob:'));assert.deepEqual(refs,beforeRapid);report.toggleChecks={sequential:20,rapid:20,reusedSameDownloadBlobs:true};}
    const intact=await fetch(seed.url+'/photos/'+seed.compositeId+'?download=1');assert.equal(hash(Buffer.from(await intact.arrayBuffer())),hash(seed.composite));
    for(const [i,id]of seed.ids.entries()){const response=await fetch(seed.url+'/photos/'+id);assert.equal(hash(Buffer.from(await response.arrayBuffer())),seed.sourceHashes[i]);}
    for(const [label,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1440,height:1000}})){await page.setViewportSize(viewport);await select('fit');const dimensions=await page.evaluate(()=>{const root=document.querySelector('#keepsake-editor').getBoundingClientRect();return{scroll:document.documentElement.scrollWidth,view:innerWidth,root:{left:root.left,right:root.right},heading:[...document.querySelectorAll('#keepsake-editor .collection-heading>*')].map(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,left:r.left,right:r.right};})};});assert.ok(dimensions.scroll<=dimensions.view+1,`${label} overflow`);for(const item of dimensions.heading)assert.ok(item.left>=dimensions.root.left-1&&item.right<=dimensions.root.right+1,`${label} heading clipped: ${JSON.stringify(dimensions)}`);if(index<6)await page.locator('#keepsake-editor').screenshot({path:`${output}/${name}-${label}.png`});}
    report.cases.push({name,meta,outputs,originalSourceHashes:seed.sourceHashes,originalBoothUnchanged:true});
  }
  // Faults are injected only in local R2. Retry must reconstruct both choices after recovery.
  for(const fault of ['photo','art']){const seed=await local.seed({photos,theme:'coastal'});if(fault==='photo')await seed.removePhoto();else await local.removeArt('coastal');await page.goto(seed.url);await page.waitForFunction(()=>{const el=document.querySelector('#variant-retry');return el&&!el.hidden&&getComputedStyle(el).display!=='none';},null,{timeout:60000});const before=await page.locator('#variant-status').textContent();assert.ok(!(await page.locator('#download-fit').getAttribute('href'))?.startsWith('blob:'));if(fault==='photo')await seed.restorePhoto();else await local.restoreArt('coastal');await page.locator('#variant-retry').click();await ready();report.faults.push({fault,statusBefore:before,recovered:true});}
  assert.deepEqual(report.blockedExternal,[]);assert.deepEqual(local.outbound,[]);assert.equal(local.requests.filter(x=>x.kind==='sms').length,0);assert.deepEqual(report.errors,[]);report.requestCounts=Object.fromEntries(['photo','art','script','page','sms'].map(kind=>[kind,local.requests.filter(x=>x.kind===kind).length]));report.sourceHashes=sourceHashes;for(const file of sourceFiles)assert.equal(hash(await readFile(file)),sourceHashes[file],`Source changed during browser run: ${file}`);report.status='passed';await context.close();
} catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{await writeFile(`${output}/checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();await local?.close();}
