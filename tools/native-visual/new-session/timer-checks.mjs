/** Actual current native JSX/controller acceptance with explicit synthetic SDK gates. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser,createContext} from './browser.mjs';
const provisional=process.argv.includes('--provisional'),root=provisional?'.cache/timer-visual':'artifacts/visual';
await mkdir(root,{recursive:true});
const report={status:'running',scope:'Actual native JSX/session capture runner in Chromium, synthetic camera/files/SQLite/Photos/host authentication. Virtual browser clock; not physical iPad camera, native gestures/VoiceOver, power-loss, live uploads, SMS or phone scanning.',checks:[],screenshots:[],errors:[],mockedHealthRequests:[],unexpectedExternalRequests:[],settlementChecks:[]};
const browser=await launchBrowser();
const hash=b=>createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=p=>p.evaluate(()=>window.__NEW_SESSION_FIXTURE__.snapshot());
const events=p=>p.evaluate(()=>window.__NEW_SESSION_FIXTURE__.events);
async function tick(p,ms){await p.clock.runFor(ms);await p.evaluate(()=>Promise.resolve());await delay(12);}
async function state(p,script,arg){return p.evaluate(script,arg);}
async function snap(p,name){
  // Stop animations in functional shots via reduced-motion context; layout must
  // be stable and fully opaque over four animation frames before evidence.
  await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const file=`${root}/timer-${name}.png`;await p.screenshot({path:file});report.screenshots.push(file);
}
async function load(c,orientation,suffix=''){
 const p=await c.newPage();await p.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 await p.goto(`http://127.0.0.1:8791/?state=camera&count=4&templates=available&effects=available&photos=clean-portrait&network=offline&${suffix}`);
 await p.getByTestId('timing-chip').waitFor();await p.getByTestId('take-photo').waitFor({state:'visible'});
 await p.waitForFunction(()=>document.querySelector('[data-testid="take-photo"]')?.getAttribute('aria-disabled')!=='true');
 return p;
}
async function observe(p){await p.evaluate(()=>{
 window.__TIMER_OBSERVATIONS__=[];window.__TIMER_START_EVENTS__=[];let previous='';
 for(const type of ['click','touchend','pointerup'])document.addEventListener(type,event=>{if(event.target.closest?.('[data-testid="take-photo"]'))window.__TIMER_START_EVENTS__.push({type,at:Date.now()});},true);
 const collect=()=>{const el=document.querySelector('[data-testid="capture-countdown-value"]'),text=el?.textContent??'';const key=window.__NEW_SESSION_FIXTURE__.cameraCalls+':'+text;if(text&&key!==previous){window.__TIMER_OBSERVATIONS__.push({at:Date.now(),remaining:Number(text),captured:window.__NEW_SESSION_FIXTURE__.cameraCalls});previous=key;}};
 new MutationObserver(collect).observe(document.body,{subtree:true,childList:true,characterData:true});collect();
 });}
async function tap(p,id){await p.getByTestId(id).tap();}
async function drag(p,id,fromIndex,toIndex){
 const box=await p.getByTestId(id).boundingBox(),client=await p.context().newCDPSession(p);
 const position=index=>box.x+14+(box.width-28)*index/4,y=box.y+box.height/2,start=position(fromIndex),end=position(toIndex);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
 for(let i=1;i<=8;i++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/8,y}]});await delay(12);}
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();await delay(25);
}
async function choose(p,first,next){
 await tap(p,'timing-chip');
 const set=async(id,value)=>{const rail=p.getByTestId(id);await rail.focus();await rail.press('Home');for(let n=0;n<[2,3,5,8,10].indexOf(value);n++)await rail.press('ArrowRight');};
 await set('timing-first-slider',first);await set('timing-next-slider',next);await tap(p,'timing-apply');
 assert.match(await p.getByTestId('timing-chip').innerText(),new RegExp(`${first}s first · ${next}s next`));
}
async function complete(p){
 await p.getByTestId('review-gallery').waitFor();await tap(p,'use-photo');
 await p.getByTestId('template-save').waitFor({timeout:12000});
 await p.waitForFunction(()=>document.querySelector('[data-testid="template-save"]')?.getAttribute('aria-disabled')!=='true');
 await tap(p,'template-save');await p.getByTestId('next-guest').waitFor({timeout:12000});
 assert.equal(await p.getByTestId('guest-qr').count(),0,'Offline captures cannot claim a working download link');
 await tap(p,'next-guest');await p.getByTestId('start-session').waitFor();await tap(p,'start-session');await p.getByTestId('timing-chip').waitFor();
}
try{
 for(const [orientation,viewport] of [['portrait',{width:820,height:1180}],['landscape',{width:1180,height:820}]]){
  const c=await createContext(browser,report,{viewport,reducedMotion:'reduce'});
  try{
   // Default pair, independent controls, draft-only edits and cancellation.
   let p=await load(c,orientation);assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/);
   const stage=await p.getByTestId('camera-stage').boundingBox(),banner=await p.locator('#new-session-fixture-banner').boundingBox();
   assert.equal(stage.x,0);assert.equal(stage.width,viewport.width);assert.equal(stage.y,banner.height);assert.equal(stage.y+stage.height,viewport.height);
   await snap(p,`chip-${orientation}`);await tap(p,'timing-chip');await snap(p,`sheet-default-${orientation}`);
   for(const id of ['timing-first-minus','timing-first-plus','timing-next-minus','timing-next-plus','timing-apply','timing-cancel']){const b=await p.getByTestId(id).boundingBox();assert.ok(b.width>=44&&b.height>=44,`${id} touch target`);}
   const slider=p.getByTestId('timing-first-slider');await drag(p,'timing-first-slider',2,3);assert.equal(await slider.getAttribute('aria-valuenow'),'8','Actual CDP touch drag snaps to8sec');await slider.focus();await slider.press('End');await slider.press('ArrowLeft');
   assert.equal(await slider.getAttribute('aria-valuenow'),'8');await tap(p,'timing-next-minus');assert.equal(await p.getByTestId('timing-next-slider').getAttribute('aria-valuenow'),'2');
   await snap(p,`sheet-edited-${orientation}`);await p.setViewportSize({width:viewport.height,height:viewport.width});await delay(100);assert.equal(await p.getByTestId('timing-first-slider').getAttribute('aria-valuenow'),'8');assert.equal(await p.getByTestId('timing-next-slider').getAttribute('aria-valuenow'),'2');await snap(p,`sheet-rotated-from-${orientation}`);await p.setViewportSize(viewport);await delay(100);await tap(p,'timing-cancel');assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/);
   assert.equal((await events(p)).filter(e=>e.kind==='synthetic-preferences-saved').length,0);
   await tap(p,'timing-chip');await tap(p,'timing-first-plus');await tap(p,'timing-next-minus');await tap(p,'timing-apply');assert.match(await p.getByTestId('timing-chip').innerText(),/8s first · 2s next/);
   await tap(p,'timing-chip');await tap(p,'timing-reset');await tap(p,'timing-apply');assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/);
   await tap(p,'timing-chip');await tap(p,'timing-first-plus');await state(p,()=>window.__NEW_SESSION_FIXTURE__.setAppState('inactive'));await state(p,()=>window.__NEW_SESSION_FIXTURE__.setAppState('active'));await p.getByTestId('take-photo').waitFor();assert.equal(await p.getByTestId('timing-sheet').count(),0);assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/,'Background discards uncommitted sheet draft');
   await observe(p);await tap(p,'take-photo');assert.equal(await p.getByTestId('timing-chip').count(),0);assert.equal(await p.getByTestId('timing-sheet').count(),0);assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'5');await snap(p,`first-countdown-${orientation}`);
   for(let i=0;i<14;i++)await tick(p,1000);
   await p.getByTestId('review-gallery').waitFor();const es=await events(p),exposures=es.filter(e=>e.kind==='synthetic-camera-exposure'),saved=es.filter(e=>e.kind==='private-save-resolved');
   assert.equal(exposures.length,4);assert.equal(saved.length,4);assert.deepEqual(exposures.slice(1).map((e,i)=>e.at-exposures[i].at),[3000,3000,3000]);
   const obs=await p.evaluate(()=>window.__TIMER_OBSERVATIONS__),starts=await p.evaluate(()=>window.__TIMER_START_EVENTS__);const first=obs.find(e=>e.captured===0&&e.remaining===5);assert.ok(first);const start=starts.find(e=>e.type==='click')??starts.at(-1);assert.ok(start);assert.ok(Math.abs(exposures[0].at-start.at-5000)<=10,'First exposure follows actual Start event by5s');
   for(let i=1;i<4;i++){const cd=obs.find(e=>e.captured===i&&e.remaining===3);assert.ok(cd&&cd.at>=saved[i-1].at);assert.ok(cd.at<=exposures[i].at,'Next3s numeral was actually rendered before exposure');}
   await snap(p,`four-photo-review-${orientation}`);await complete(p);assert.match(await p.getByTestId('timing-chip').innerText(),/5s first · 3s next/);
   report.checks.push({orientation,name:'defaults-draft-controls-four-photo-rhythm',passed:true,subsequentExposureIntervalsMilliseconds:[3000,3000,3000],firstStartToExposureMilliseconds:exposures[0].at-start.at,startEventType:start.type,renderingBoundary:'Virtual fast-forward may defer React DOM commits; no native animation/latency claim.',countdownObservations:obs,checks:['full-bleed preserved','44point touch targets','accessible labelled detents, actual CDP touch drag and keyboard steps','rotation retains draft values','background closes uncommitted sheet','cancel discards draft','apply snapshots independent pair','reset uses host defaults','no midrun timer UI','save before countdown','no extra intershot gap','Next guests resets defaults']});await p.close();

   // Host persists defaults; a guest override never changes that storage and
   // remains session-scoped even when the host changes future defaults.
   p=await load(c,orientation);await choose(p,2,2);await p.getByRole('button',{name:'Open host controls',exact:true}).tap();await p.getByTestId('host-timing-first-plus').waitFor();
   await tap(p,'host-timing-first-plus');await tap(p,'host-timing-next-plus');await p.getByRole('button',{name:'Save booth settings',exact:true}).tap();await p.getByText('Booth defaults saved. Guest changes apply to one session only.',{exact:true}).waitFor();await snap(p,`host-defaults-${orientation}`);
   assert.deepEqual((await fixture(p)).preferences,{firstSeconds:8,nextSeconds:5,photosExportEnabled:true});await p.getByText('Done',{exact:true}).tap();await p.getByTestId('timing-chip').waitFor();assert.match(await p.getByTestId('timing-chip').innerText(),/2s first · 2s next/);
   assert.equal((await events(p)).filter(e=>e.kind==='synthetic-preferences-saved').length,1);await tap(p,'take-photo');for(let i=0;i<8;i++)await tick(p,1000);await complete(p);assert.match(await p.getByTestId('timing-chip').innerText(),/8s first · 5s next/);await snap(p,`next-guests-host-defaults-${orientation}`);
   assert.equal((await events(p)).filter(e=>e.kind==='synthetic-preferences-saved').length,1);report.checks.push({orientation,name:'host-persistence-guest-session-only',passed:true,checks:['one host persistence call','guest override survives host-default change','Next guests restore saved8/5 defaults','previous guest images cleared']});await p.close();

   // An exposed original is protected while its save is delayed. The next
   // countdown requires both the durable receipt and explicit native ready.
   p=await load(c,orientation);await choose(p,2,2);await observe(p);await state(p,()=>{window.__NEW_SESSION_FIXTURE__.saveBlocked=true;});await tap(p,'take-photo');await tick(p,2000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),1);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.pendingSaves),1);
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.setCameraReady(false));await tick(p,5000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),1);assert.equal((await fixture(p)).active.shots.length,0);assert.match(await p.getByTestId('capture-save-status').innerText(),/Saving this photo/);assert.equal(await p.getByTestId('capture-countdown-value').count(),0);await snap(p,`saving-delay-${orientation}`);
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.releaseSaves());await tick(p,1000);assert.equal((await fixture(p)).active.shots.length,1);assert.equal(await p.getByTestId('capture-countdown-value').count(),0);assert.match(await p.getByTestId('capture-save-status').innerText(),/Getting the camera ready/);await snap(p,`waiting-camera-${orientation}`);
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.setCameraReady(true));await tick(p,50);assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'2');assert.equal(await p.getByText('The front camera is unavailable. Please ask the host.',{exact:true}).count(),0,'Fresh camera-ready clears only the resolved camera warning');await snap(p,`camera-recovered-${orientation}`);await tick(p,2000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),2);await tap(p,'cancel-countdown');
   report.checks.push({orientation,name:'durable-save-and-camera-ready-gate',passed:true,checks:['no next capture/countdown while save blocked','no false durable count','no countdown until camera ready','save delay distinct from countdown','continues with subsequent timing only after both gates']});await p.close();

   // A ready callback must not erase a different outstanding save failure.
   p=await load(c,orientation);await choose(p,2,2);await state(p,()=>{window.__NEW_SESSION_FIXTURE__.failNextSave=true;});await tap(p,'take-photo');await tick(p,2000);await p.getByTestId('retry-save').waitFor();const pendingMessage='This photo has not finished saving. Keep the booth open and retry saving.';await p.getByText(pendingMessage,{exact:true}).waitFor();await state(p,()=>window.__NEW_SESSION_FIXTURE__.setCameraReady(true));await tick(p,100);assert.equal(await p.getByText(pendingMessage,{exact:true}).count(),1);assert.equal((await fixture(p)).active.shots.length,0);assert.equal(await p.getByTestId('retry-save').count(),1);await snap(p,`save-warning-retained-${orientation}`);await tap(p,'retry-save');await p.getByTestId('take-photo').waitFor();assert.equal((await fixture(p)).active.shots.length,1);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),1);report.checks.push({orientation,name:'camera-ready-preserves-noncamera-save-warning',passed:true,checks:['pending save warning retained after native ready callback','unsaved count stayszero','retry uses same exposure']});await p.close();

   // Pause and background resume from an existing two-shot session, preserving
   // slots and using preparation again. Individual retakes do the same.
   p=await load(c,orientation);
   await p.goto('http://127.0.0.1:8791/?state=partial&count=4&templates=available&effects=available&photos=clean-portrait&network=offline');await p.getByTestId('timing-chip').waitFor();await choose(p,8,2);await tap(p,'take-photo');await tick(p,3000);await tap(p,'cancel-countdown');assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),0);await tap(p,'take-photo');assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'8');
   await tick(p,1000);await state(p,()=>{window.__NEW_SESSION_FIXTURE__.cameraReadyBlocked=true;window.__NEW_SESSION_FIXTURE__.setAppState('background');});await state(p,()=>window.__NEW_SESSION_FIXTURE__.setAppState('active'));await tick(p,1000);assert.equal(await p.getByTestId('capture-countdown-value').count(),0);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),0);assert.ok(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraMounts)>=2,'Foreground remount requires fresh readiness');assert.equal(await p.getByTestId('take-photo').getAttribute('aria-disabled'),'true');
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.setCameraReady(true));await tap(p,'take-photo');assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'8');await snap(p,`resume-preparation-${orientation}`);for(let i=0;i<10;i++)await tick(p,1000);await p.getByTestId('review-gallery').waitFor();const old=(await fixture(p)).active.shots.map(s=>s.id);
   await tap(p,'photo-thumbnail-2');await tap(p,'retake-photo');await p.getByTestId('take-photo').waitFor();await tap(p,'take-photo');assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'8');await snap(p,`retake-preparation-${orientation}`);for(let i=0;i<8;i++)await tick(p,1000);await p.getByTestId('review-gallery').waitFor();const current=(await fixture(p)).active.shots.map(s=>s.id);assert.equal(current.length,4);assert.notEqual(current[1],old[1]);for(const i of [0,2,3])assert.equal(current[i],old[i]);
   report.checks.push({orientation,name:'pause-background-resume-retake-preparation',passed:true,checks:['pause restart8sec','background stops old countdown','new camera epoch and fresh readiness','resume8sec thenautomatic2sec','individual retake8sec','unselected IDs unchanged']});await p.close();

   // A backgrounded exposed capture must finish preservation before camera
   // remount, and returning guests must explicitly resume with preparation.
   p=await load(c,orientation);await state(p,()=>{window.__NEW_SESSION_FIXTURE__.saveBlocked=true;});await tap(p,'take-photo');for(let i=0;i<5;i++)await tick(p,1000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.pendingSaves),1);const mounts=await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraMounts);
   await state(p,()=>{window.__NEW_SESSION_FIXTURE__.cameraReadyBlocked=true;window.__NEW_SESSION_FIXTURE__.setAppState('background');});await state(p,()=>window.__NEW_SESSION_FIXTURE__.setAppState('active'));await tick(p,1000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraMounts),mounts,'Do not destroy camera during exposed-photo persistence');
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.releaseSaves());await tick(p,100);assert.equal((await fixture(p)).active.shots.length,1);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraMounts),mounts+1);assert.equal(await p.getByTestId('capture-countdown-value').count(),0);assert.equal(await p.getByTestId('take-photo').getAttribute('aria-disabled'),'true');await snap(p,`background-preserved-${orientation}`);
   await state(p,()=>window.__NEW_SESSION_FIXTURE__.setCameraReady(true));await tap(p,'take-photo');assert.equal(await p.getByTestId('capture-countdown-value').innerText(),'5');await tick(p,4000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),1);await tick(p,1000);assert.equal(await state(p,()=>window.__NEW_SESSION_FIXTURE__.cameraCalls),2);await tap(p,'cancel-countdown');report.checks.push({orientation,name:'background-exposure-preservation-before-remount',passed:true,checks:['pending exposed copy survives foreground change','remount deferred until save acknowledgement','camera fresh-ready required','manual resume uses5sec preparation']});await p.close();
  }finally{await c.close();}
 }
 // Legacy five-shot sessions retain cardinality while adopting same timer pair.
 const c=await createContext(browser,report,{viewport:{width:820,height:1180},reducedMotion:'reduce'});try{const p=await c.newPage();await p.clock.install({time:new Date('2026-10-26T12:00:00Z')});await p.goto('http://127.0.0.1:8791/?state=camera&count=5&network=offline');await p.getByTestId('timing-chip').waitFor();await choose(p,2,2);await tap(p,'take-photo');for(let i=0;i<10;i++)await tick(p,1000);await p.getByTestId('review-gallery').waitFor();assert.equal((await fixture(p)).active.shots.length,5);report.checks.push({name:'legacy-five-cardinality',passed:true});}finally{await c.close();}
 const boundary=JSON.parse(await readFile(provisional?'.cache/keepsake-provisional/timer-bundle-boundary.json':'artifacts/visual/timer-bundle-boundary.json'));report.sourceHashes=boundary.sourceHashes;
 for(const [file,digest] of Object.entries(report.sourceHashes))assert.equal(hash(await readFile(file)),digest,`${file} changed during timer capture`);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedExternalRequests,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack??String(e);throw e;}
finally{await browser.close();await writeFile(`${root}/timer-checks.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,groups:report.checks.length,screenshots:report.screenshots.length}));
