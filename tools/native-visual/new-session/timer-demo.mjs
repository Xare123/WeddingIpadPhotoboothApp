/** Normal-motion actual-JSX timer interaction, synthetic device boundaries. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser,createContext} from './browser.mjs';
const root='artifacts/visual',temporary='.cache/timer-visual/video';await mkdir(temporary,{recursive:true});
const report={status:'running',demoSourceSet:{name:'clean-mixed',content:'Drink-free existing generated fixtures for the dry-wedding showcase; no product or native fixture changes.',sources:['studio-landscape-1.jpg','studio-portrait-1.jpg','studio-landscape-2.jpg','studio-portrait-2.jpg'],productionAttractScene:'Existing drink-free generated attract-scene.png unchanged',functionalMatrixBoundary:'The separate diagnostic13-group matrix and historical keepsake evidence remain unchanged.'},scope:'Normal-motion Chromium recording of actual native JSX and production session runner; explicit synthetic camera/Files/SQLite/Photos/auth/template effects. No native animation performance, iPad camera/VoiceOver/Photos, live sharing/SMS or phone-scan claim.',checks:[],screenshots:[],videos:[],errors:[],mockedHealthRequests:[],unexpectedExternalRequests:[]};
const browser=await launchBrowser();
const sha=b=>createHash('sha256').update(b).digest('hex');
async function shot(p,name){await p.waitForTimeout(300);const f=`${root}/timer-demo-${name}.png`;await p.screenshot({path:f});report.screenshots.push(f);}
try{
 for(const [orientation,viewport] of [['portrait',{width:820,height:1180}],['landscape',{width:1180,height:820}]]){
  const c=await createContext(browser,report,{viewport,reducedMotion:'no-preference',recordVideo:{dir:temporary,size:viewport}}),p=await c.newPage();const video=p.video();
  try{
   await p.goto('http://127.0.0.1:8791/?state=camera&count=4&templates=available&effects=available&photos=clean-mixed&network=offline&reducedMotion=false');await p.getByTestId('timing-chip').waitFor();await shot(p,`chip-${orientation}`);
   await p.getByTestId('timing-chip').tap();await p.waitForTimeout(500);await shot(p,`sheet-${orientation}`);await p.getByTestId('timing-next-minus').tap();await shot(p,`custom-${orientation}`);await p.getByTestId('timing-apply').tap();assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 2s next/);
   await p.getByTestId('take-photo').tap();await p.getByTestId('capture-countdown-value').waitFor();assert.equal(await p.getByTestId('timing-chip').count(),0);await shot(p,`preparation-${orientation}`);
   await p.getByTestId('review-gallery').waitFor({timeout:18000});assert.equal(await p.evaluate(()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),4);await shot(p,`review-${orientation}`);
   await p.getByTestId('use-photo').tap();await p.getByTestId('template-save').waitFor({timeout:10000});await p.waitForFunction(()=>document.querySelector('[data-testid="template-save"]')?.getAttribute('aria-disabled')!=='true');await shot(p,`keepsake-${orientation}`);await p.getByTestId('template-save').tap();await p.getByTestId('next-guest').waitFor();await p.getByTestId('share-link-unavailable').waitFor();await shot(p,`offline-${orientation}`);
   await p.getByTestId('next-guest').tap();await p.getByTestId('start-session').waitFor();await p.waitForTimeout(250);await p.getByTestId('start-session').tap();await p.getByTestId('timing-chip').waitFor();assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/);await shot(p,`next-guests-${orientation}`);
   assert.equal(await p.evaluate(()=>window.__NEW_SESSION_FIXTURE__.events.filter(e=>e.kind==='synthetic-preferences-saved').length),0);
   report.checks.push({orientation,passed:true,steps:['default5/3','normal slide sheet','independent guestnext2 override','capture5/2 x4','review','actual Canvaskeepsake','truthfulofflinehandoff','Nextguests5/3 reset'],realTime:true});
  }finally{await c.close();if(video){const target=`${root}/timer-demo-${orientation}.webm`;await copyFile(await video.path(),target);report.videos.push(target);}}
 }
 const boundary=JSON.parse(await readFile('artifacts/visual/timer-bundle-boundary.json'));report.sourceHashes=boundary.sourceHashes;report.demoSourceSet.fixtureSHA256=boundary.fixturePhotoSets['clean-mixed'].sources.map(value=>value.sha256);for(let i=0;i<report.demoSourceSet.sources.length;i++)assert.equal(sha(await readFile('apps/ipad/native-tests/fixtures/studio/'+report.demoSourceSet.sources[i])),report.demoSourceSet.fixtureSHA256[i],'Demo source must match the existing drink-free fixture');for(const [file,digest]of Object.entries(report.sourceHashes))assert.equal(sha(await readFile(file)),digest,`${file} changed during timer recording`);assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedExternalRequests,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack??String(e);throw e;}
finally{await browser.close();await writeFile(`${root}/timer-demo-checks.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,groups:report.checks.length,screenshots:report.screenshots.length,recordings:report.videos.length}));
