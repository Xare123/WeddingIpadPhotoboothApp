/** Actual Worker HTML + embedded client in Chromium; synthetic data and local R2 only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchBrowser } from '../native-visual/new-session/browser.mjs';
import { startLocalGallery } from './local-server.mjs';
const output = 'artifacts/visual/guest-keepsake-layout';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Actual Worker HTTP/HTML/client + local R2 in Chromium. Synthetic marker JPEGs only. No Safari, iOS, native renderer, production deployment, private guest content or SMS proof.', status: 'running', cases: [], errors: [], blockedExternal: [], faults: [] };
await mkdir(output, { recursive: true });
const sourceFiles=['services/api/src/index.ts','services/api/src/guest-keepsake.client','services/api/test/worker-source.ts','tools/guest-keepsake/local-server.mjs','tools/guest-keepsake/layout-browser-checks.mjs','tools/guest-keepsake/browser-checks.mjs'];
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
  const browserFetches=[];
  await context.route('**/*', route=>{const request=route.request(),url=new URL(request.url());if(url.origin===local.origin){if(request.resourceType()==='fetch')browserFetches.push(url.pathname.includes('/art/')?'art':url.pathname.includes('/photos/')?'photo':'other');return route.continue();}if(['blob:','data:'].includes(url.protocol))return route.continue();report.blockedExternal.push(url.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const ready=async()=>{await page.waitForFunction(()=>['fill','fit'].every(mode=>document.querySelector('#download-'+mode)?.getAttribute('href')?.startsWith('blob:')),null,{timeout:60000});};
  async function select(mode){await page.locator(`[data-variant="${mode}"]`).click();await page.waitForFunction(mode=>{const image=document.querySelector('#variant-preview');return image.complete&&image.naturalWidth>0&&image.src===document.querySelector('#download-'+mode).href&&document.querySelector(`[data-variant="${mode}"]`).getAttribute('aria-pressed')==='true';},mode,{timeout:15000});}
  async function layout(value){await page.locator(`[data-layout="${value}"]`).click();await page.waitForFunction(value=>{const image=document.querySelector('#variant-preview'),selected=document.querySelector('[data-variant][aria-pressed="true"]')?.dataset.variant;return image.complete&&image.naturalWidth>0&&image.src===document.querySelector('#download-'+selected).href&&document.querySelector(`[data-layout="${value}"]`).getAttribute('aria-pressed')==='true'&&image.naturalWidth===(value==='grid'?2400:1200)&&image.naturalHeight===(value==='grid'?2400:3600);},value,{timeout:15000});}
  const refs=()=>page.evaluate(()=>Object.fromEntries(['fill','fit'].map(mode=>[mode,document.querySelector('#download-'+mode).href])));
  async function download(mode,name,selectedLayout){await select(mode);const link=page.locator('#download-'+mode);assert.ok((await link.getAttribute('download')).includes('-'+selectedLayout+'-'));assert.ok((await link.textContent()).includes(selectedLayout==='grid'?'Social Grid':'Photo Strip'));const waiting=page.waitForEvent('download');await link.click();const d=await waiting;assert.equal(await d.failure(),null);const file=`${output}/${name}-${mode}.jpg`;await d.saveAs(file);const bytes=await readFile(file);assert.equal(bytes[0],255);assert.equal(bytes[1],216);return{file,bytes,sha256:hash(bytes),byteLength:bytes.length};}
  async function pixels(bytes,meta,mode){return page.evaluate(async({base64,meta,mode})=>{
    const binary=atob(base64),raw=Uint8Array.from(binary,c=>c.charCodeAt(0)),blob=new Blob([raw],{type:'image/jpeg'}),image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const at=(x,y)=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data].slice(0,3);
    let windows;
    if(meta.layout==='strip') windows=Array.from({length:4},(_,i)=>meta.version==='wedding-template-v3'?{x:100,y:220+i*770,w:1000,h:750}:{x:60,y:60+i*834,w:1080,h:810});
    else if(meta.version==='wedding-template-v1')windows=Array.from({length:4},(_,i)=>({x:96+i%2*1128,y:96+Math.floor(i/2)*858,w:1080,h:810}));
    else if(meta.version==='wedding-template-v3')windows=Array.from({length:4},(_,i)=>({x:184+i%2*1032,y:160+Math.floor(i/2)*1032,w:1000,h:1000}));
    else windows=Array.from({length:4},(_,i)=>meta.aspect==='portrait'?{x:72+i%2*1140,y:72+Math.floor(i/2)*1356,w:1116,h:1332}:{x:96+i%2*1128,y:60+Math.floor(i/2)*1104,w:1080,h:1080});
    return{width:image.width,height:image.height,centers:windows.map(w=>at(w.x+w.w/2,w.y+w.h/2)),edges:windows.map(w=>{const s=Math.min(w.w/320,w.h/480),dx=w.x+(w.w-320*s)/2,dy=w.y+(w.h-480*s)/2;return mode==='fit'?{left:at(dx+8*s,dy+240*s),right:at(dx+312*s,dy+240*s),top:at(dx+160*s,dy+8*s),bottom:at(dx+160*s,dy+472*s)}:{top:at(w.x+w.w/2,w.y+8),bottom:at(w.x+w.w/2,w.y+w.h-8)};})};
  },{base64:bytes.toString('base64'),meta,mode});}

  const variants=[...['strip','grid'].flatMap(sourceLayout=>['classic','botanical','coastal'].map(theme=>({version:'wedding-template-v3',layout:sourceLayout,theme,aspect:'square'}))),{version:'wedding-template-v1',layout:'strip',theme:'classic'},{version:'wedding-template-v2',layout:'grid',theme:'botanical',aspect:'portrait'},{version:'wedding-template-v2',layout:'strip',theme:'coastal',aspect:'square'}];
  const expectedCenters=[[184,60,98],[48,134,95],[54,91,197],[182,138,40]],near=(a,b,t=28)=>a.every((v,i)=>Math.abs(v-b[i])<=t);
  for(const [index,meta]of variants.entries()){
    const seed=await local.seed({...meta,photos}),beforeFetch=browserFetches.length;await page.goto(seed.url);await ready();
    assert.equal(await page.locator('[data-layout="grid"]').getAttribute('aria-pressed'),'true','Social Grid is the default, independent of saved booth layout');
    await page.waitForFunction(()=>{const image=document.querySelector('#variant-preview');return image.complete&&image.naturalWidth===2400&&image.naturalHeight===2400;});
    const preparationFetches=browserFetches.slice(beforeFetch);assert.equal(preparationFetches.filter(x=>x==='photo').length,4,'Decode/fetch each selected photo once for all four outputs');assert.equal(preparationFetches.filter(x=>x==='art').length,meta.version==='wedding-template-v3'?1:0);
    const name=`${meta.version.replace('wedding-template-','')}-source-${meta.layout}-${meta.theme}-${meta.aspect??'legacy'}`,outputs={},cached={};
    for(const selectedLayout of ['grid','strip']){
      await layout(selectedLayout);cached[selectedLayout]=await refs();outputs[selectedLayout]={};
      const renderMeta={...meta,layout:selectedLayout,...(selectedLayout==='grid'?{version:meta.version==='wedding-template-v1'?'wedding-template-v2':meta.version,aspect:'square'}:{})};
      for(const mode of ['fill','fit']){
        const result=await download(mode,name+'-'+selectedLayout,selectedLayout),facts=await pixels(result.bytes,renderMeta,mode);
        assert.deepEqual([facts.width,facts.height],selectedLayout==='grid'?[2400,2400]:[1200,3600]);
        facts.centers.forEach((rgb,i)=>assert.ok(near(rgb,expectedCenters[i]),`Four unique source centers ${name}/${selectedLayout}/${mode}/${i}: ${rgb}`));
        if(mode==='fill')for(const[i,edges]of facts.edges.entries()){assert.ok(near(edges.top,[220,202,40]),`Top-aligned Fill ${name}/${selectedLayout}/${i}`);assert.ok(!near(edges.bottom,[37,184,70]),`Deliberate Fill crop ${name}/${selectedLayout}/${i}`);}
        if(mode==='fit')for(const edges of facts.edges)for(const[key,color]of Object.entries({left:[217,37,37],right:[32,73,220],top:[220,202,40],bottom:[37,184,70]}))assert.ok(near(edges[key],color),`Full-photo edge including EXIF6/2 ${name}/${selectedLayout}/${key}: ${edges[key]}`);
        outputs[selectedLayout][mode]={file:result.file,sha256:result.sha256,bytes:result.byteLength,...facts};
      }
      assert.notEqual(outputs[selectedLayout].fill.sha256,outputs[selectedLayout].fit.sha256);
      for(const[label,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1440,height:1000}})){
        await page.setViewportSize(viewport);await select('fit');const bounds=await page.evaluate(()=>{const root=document.querySelector('#keepsake-editor').getBoundingClientRect();return{scroll:document.documentElement.scrollWidth,view:innerWidth,root:{left:root.left,right:root.right},children:[...document.querySelectorAll('#keepsake-editor .collection-heading>*')].map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right};})};});assert.ok(bounds.scroll<=bounds.view+1,`${label} horizontal overflow`);for(const child of bounds.children)assert.ok(child.left>=bounds.root.left-1&&child.right<=bounds.root.right+1,`${label} heading bounds`);
        if(index<3)await page.locator('#keepsake-editor').screenshot({path:`${output}/${meta.theme}-${selectedLayout}-${label}.png`});
      }
    }
    assert.equal(new Set(Object.values(cached).flatMap(x=>Object.values(x))).size,4,'Four cached distinct outputs');
    if(index===0){
      const fetchesBefore=browserFetches.length;
      for(const mode of ['fill','fit']){
        await select(mode);for(let i=0;i<20;i++){const selectedLayout=i%2?'strip':'grid';await layout(selectedLayout);assert.deepEqual(await refs(),cached[selectedLayout]);assert.equal(await page.locator(`[data-variant="${mode}"]`).getAttribute('aria-pressed'),'true','Layout switching retains fit mode');}
        await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector(`[data-layout="${i%2?'strip':'grid'}"]`).click();});await layout('strip');assert.deepEqual(await refs(),cached.strip);
      }
      assert.equal(browserFetches.length,fetchesBefore,'Repeated layout/fit changes must not refetch/recreate images');report.toggleChecks={sequentialLayoutChanges:40,rapidLayoutChanges:40,bothFitModesRetained:true,sameFourBlobURLs:true,noRefetch:true};
    }
    const intact=await fetch(seed.url+'/photos/'+seed.compositeId+'?download=1');assert.equal(hash(Buffer.from(await intact.arrayBuffer())),hash(seed.composite));for(const[i,id]of seed.ids.entries()){const response=await fetch(seed.url+'/photos/'+id);assert.equal(hash(Buffer.from(await response.arrayBuffer())),seed.sourceHashes[i]);}
    report.cases.push({name,sourceMeta:meta,defaultLayout:'grid',outputs,preparationFetches,originalSourceHashes:seed.sourceHashes,originalBoothUnchanged:true});
  }
  for(const[label,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1440,height:1000}}))for(const fault of ['photo','art']){
    await page.setViewportSize(viewport);const seed=await local.seed({photos,theme:'coastal'});if(fault==='photo')await seed.removePhoto();else await local.removeArt('coastal');await page.goto(seed.url);await page.waitForFunction(()=>{const el=document.querySelector('#variant-retry');return el&&!el.hidden&&getComputedStyle(el).display!=='none';},null,{timeout:60000});const statusBefore=await page.locator('#variant-status').textContent();for(const mode of ['fill','fit'])assert.ok(!(await page.locator('#download-'+mode).getAttribute('href'))?.startsWith('blob:'));if(fault==='photo')await seed.restorePhoto();else await local.restoreArt('coastal');await page.locator('#variant-retry').click();await ready();for(const selectedLayout of ['grid','strip']){await layout(selectedLayout);for(const mode of ['fill','fit'])await select(mode);}report.faults.push({viewport:label,fault,statusBefore,recoveredBothLayoutsAndModes:true});
  }
  assert.deepEqual(report.blockedExternal,[]);assert.deepEqual(local.outbound,[]);assert.equal(local.requests.filter(x=>x.kind==='sms').length,0);assert.deepEqual(report.errors,[]);report.requestCounts=Object.fromEntries(['photo','art','script','page','sms'].map(kind=>[kind,local.requests.filter(x=>x.kind===kind).length]));report.sourceHashes=sourceHashes;for(const file of sourceFiles)assert.equal(hash(await readFile(file)),sourceHashes[file],`Source changed during browser run: ${file}`);report.status='passed';await context.close();
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{await writeFile(`${output}/checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();await local?.close();}
