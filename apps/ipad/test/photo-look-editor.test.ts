import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoLookEditor, type PhotoLookEditorState, type PhotoLookRenderResult } from '../src/photo-look-editor';
import type { ActiveSession } from '../src/local-types';
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let session: ActiveSession = { id:'s', createdAt:1, targetCount:1, confirmed:false, shots:[{id:'o',fileUri:'file:///original.jpg',createdAt:1,confirmed:false,sessionId:'s',shotIndex:0}] };
  let state: PhotoLookEditorState | null = null, serial=0;
  const jobs: {source:string;preset:string;preview:boolean;id:string;d:ReturnType<typeof deferred<PhotoLookRenderResult>>}[] = [];
  const released: string[] = [], cancelled:string[] = [], saved: unknown[] = [], selected:string[] = [], sessions: ActiveSession[]=[];
  let saveError: Error | undefined, copyWait: ReturnType<typeof deferred<ActiveSession>> | undefined;
  const editor = createPhotoLookEditor({
    id:()=>`id-${++serial}`, render:(source,preset,_intensity,preview,id)=> { const d=deferred<PhotoLookRenderResult>(); jobs.push({source,preset,preview,id,d}); return d.promise; },
    cancel:id=>{cancelled.push(id);}, release:async uri=>{released.push(uri);}, loadSession:async()=>session,
    saveRenderedPhoto:async(_id,input)=>{saved.push(input); if(saveError) throw saveError; if(copyWait) return copyWait.promise; return session;},
    selectSavedPhoto:async(_id,id)=>{selected.push(id);return session;}, onState:s=>{state=s;},onSession:s=>{sessions.push(s);}
  });
  const result = (i:number, overrides:Partial<PhotoLookRenderResult>={}) => ({uri:`file:///cache-${i}.jpg`,width:jobs[i]!.preview?100:1000,height:jobs[i]!.preview?80:800,recipeVersion:'wedding-ci-srgb-v1',preset:jobs[i]!.preset as 'warm',intensity:1,originalSha256:'a'.repeat(64),isOriginal:false,preview:jobs[i]!.preview,...overrides});
  return {editor,jobs,released,cancelled,saved,selected,sessions,result,get state(){return state;},get session(){return session;},set session(s:ActiveSession){session=s;},set saveError(e:Error|undefined){saveError=e;},set copyWait(d:ReturnType<typeof deferred<ActiveSession>>|undefined){copyWait=d;}};
}
test('out of order previews cannot replace the current native image; close disposes late outputs',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.editor.choose('bw',1);
 h.jobs[1]!.d.resolve(h.result(1));await tick();assert.equal(h.state?.previewUri,'file:///cache-1.jpg');
 h.jobs[0]!.d.resolve(h.result(0));await tick();assert.equal(h.state?.preset,'bw');assert.deepEqual(h.released,['file:///cache-0.jpg']);
 h.editor.choose('film',1);h.editor.close();h.jobs[2]!.d.resolve(h.result(2));await tick();assert.equal(h.state,null);assert.ok(h.cancelled.length>=2);assert.ok(h.released.includes('file:///cache-2.jpg'));assert.ok(!h.released.includes('file:///original.jpg'));
});
test('close while full render pending prevents disk writes',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();
 const apply=h.editor.apply();await tick();h.editor.close();h.jobs[1]!.d.resolve(h.result(1));assert.equal(await apply,false);assert.equal(h.saved.length,0);assert.ok(h.released.includes('file:///cache-1.jpg'));
});
test('double apply shares one operation; closing during durable copy preserves it without reopening',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();const d=deferred<ActiveSession>();h.copyWait=d;
 const a=h.editor.apply(),b=h.editor.apply();assert.equal(a,b);await tick();h.jobs[1]!.d.resolve(h.result(1));await tick();assert.equal(h.saved.length,1);h.editor.close();assert.ok(!h.released.includes('file:///cache-1.jpg'));d.resolve(h.session);assert.equal(await a,true);assert.equal(h.state,null);assert.ok(h.released.includes('file:///cache-1.jpg'));
});
for(const bad of [{recipeVersion:'wrong'},{originalSha256:'bad'},{preset:'film' as const},{preview:true},{width:0}]) test(`invalid full acknowledgement ${JSON.stringify(bad)} cannot save`,async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();const a=h.editor.apply();await tick();h.jobs[1]!.d.resolve(h.result(1,bad));assert.equal(await a,false);assert.equal(h.saved.length,0);assert.equal(h.session.shots[0]!.id,'o');assert.equal(h.state?.phase,'error');h.editor.close();
});
test('hash mismatch between valid preview and full render is rejected',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();const a=h.editor.apply();await tick();h.jobs[1]!.d.resolve(h.result(1,{originalSha256:'b'.repeat(64)}));assert.equal(await a,false);assert.equal(h.saved.length,0);
});
test('native and disk errors retain original and allow retry',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.reject(new Error('native failed'));await tick();assert.equal(h.state?.phase,'error');h.editor.choose('warm',1);h.jobs[1]!.d.resolve(h.result(1));await tick();h.saveError=new Error('disk failed');const a=h.editor.apply();await tick();h.jobs[2]!.d.resolve(h.result(2));assert.equal(await a,false);assert.equal(h.session.shots[0]!.fileUri,'file:///original.jpg');assert.ok(h.sessions.length);h.saveError=undefined;h.editor.choose('original',0);assert.equal(await h.editor.apply(),true);assert.deepEqual(h.selected,['o']);
});
test('restores original or reuses prior matching derivative without full render',async()=>{
 const h=harness();const o=h.session.shots[0]!;const look={preset:'warm' as const,intensity:1,version:'wedding-ci-srgb-v1' as const};h.session={...h.session,shots:[{...o,id:'derived',fileUri:'file:///derived.jpg',sourcePhotoId:'o',look}],retakes:[o]};
 h.editor.open(h.session,0);assert.equal(h.jobs[0]!.source,o.fileUri);h.jobs[0]!.d.resolve(h.result(0));await tick();assert.equal(await h.editor.apply(),true);assert.deepEqual(h.selected,['derived']);assert.equal(h.jobs.length,1);
 h.editor.open(h.session,0);h.editor.choose('original',1);assert.equal(await h.editor.apply(),true);assert.equal(h.selected.at(-1),'o');
});
test('retake uses fresh source; changed selection or confirmed session rejects apply before native work',async()=>{
 const h=harness();const old=h.session.shots[0]!;h.session={...h.session,shots:[{...old,id:'retake',fileUri:'file:///retake.jpg'}],retakes:[old]};h.editor.open(h.session,0);h.editor.choose('film',1);assert.equal(h.jobs[0]!.source,'file:///retake.jpg');h.jobs[0]!.d.resolve(h.result(0));await tick();h.session={...h.session,confirmed:true};assert.equal(await h.editor.apply(),false);assert.equal(h.jobs.length,1);assert.equal(h.saved.length,0);
});
test('missing, derived, and foreign originals cannot open',()=>{
 for(const patch of [{sourcePhotoId:'missing'},{sessionId:'foreign'},{sourcePhotoId:'o',look:{preset:'warm' as const,intensity:1,version:'wedding-ci-srgb-v1' as const}}]) { const h=harness();h.session={...h.session,shots:[{...h.session.shots[0]!,...patch}]};h.editor.open(h.session,0);assert.equal(h.state,null);assert.equal(h.jobs.length,0); }
});
test('partial sessions resolve a selected nonzero slot by shotIndex',async()=>{
 const h=harness();h.session={...h.session,targetCount:5,shots:[{...h.session.shots[0]!,shotIndex:3}]};h.editor.open(h.session,3);assert.equal(h.state?.slot,3);h.editor.choose('warm',1);assert.equal(h.jobs[0]!.source,'file:///original.jpg');h.jobs[0]!.d.resolve(h.result(0));await tick();const a=h.editor.apply();await tick();h.jobs[1]!.d.resolve(h.result(1));assert.equal(await a,true);assert.equal((h.saved[0] as {slot:number}).slot,3);
});
test('full render and disk errors display original and release temporary previews',async()=>{
 for(const diskError of [false,true]) {
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();assert.equal(h.state?.previewUri,'file:///cache-0.jpg');if(diskError) h.saveError=new Error('disk');const a=h.editor.apply();await tick();if(diskError) h.jobs[1]!.d.resolve(h.result(1));else h.jobs[1]!.d.reject(new Error('native'));assert.equal(await a,false);assert.equal(h.state?.previewUri,'file:///original.jpg');assert.equal(h.state?.phase,'error');assert.ok(h.released.includes('file:///cache-0.jpg'));assert.ok(!h.released.includes('file:///original.jpg'));assert.equal(await h.editor.apply(),false);
 }
});
for(const uri of ['https://example.com/photo.jpg','blob:synthetic','file://remote/photo.jpg','file:///cache.png']) test(`rejects nonlocal JPEG output ${uri}`,async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0,{uri}));await tick();assert.equal(h.state?.phase,'error');assert.equal(h.state?.previewUri,'file:///original.jpg');assert.equal(await h.editor.apply(),false);assert.equal(h.saved.length,0);
});
test('zero strength retains the chosen preset, resumes it at 25%, and applies original without encoding',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',0);assert.equal(h.state?.preset,'warm');assert.equal(h.state?.intensity,0);assert.equal(h.state?.previewUri,'file:///original.jpg');assert.equal(h.jobs.length,0);
 h.editor.choose(h.state!.preset,0.25);assert.equal(h.state?.preset,'warm');assert.equal(h.jobs.length,1);h.jobs[0]!.d.resolve(h.result(0,{intensity:0.25}));await tick();assert.equal(h.state?.phase,'ready');
 h.editor.choose('warm',0);assert.equal(await h.editor.apply(),true);assert.deepEqual(h.selected,['o']);assert.equal(h.jobs.length,1);assert.equal(h.saved.length,0);
 h.editor.open(h.session,0);h.editor.choose('original',0.75);assert.equal(h.state?.intensity,0);assert.equal(h.state?.preset,'original');
});
test('image load failure is URI scoped and same preset retries fresh native output',async()=>{
 const h=harness();h.editor.open(h.session,0);h.editor.choose('warm',1);h.jobs[0]!.d.resolve(h.result(0));await tick();h.editor.choose('bw',1);h.jobs[1]!.d.resolve(h.result(1));await tick();h.editor.previewFailed('file:///cache-0.jpg');assert.equal(h.state?.phase,'ready');h.editor.previewFailed('file:///cache-1.jpg');assert.equal(h.state?.phase,'error');assert.equal(h.state?.previewUri,'file:///original.jpg');assert.ok(h.released.includes('file:///cache-1.jpg'));h.editor.choose('bw',1);assert.equal(h.jobs.length,3);h.jobs[2]!.d.resolve(h.result(2));await tick();assert.equal(h.state?.previewUri,'file:///cache-2.jpg');h.editor.previewFailed('file:///cache-1.jpg');assert.equal(h.state?.phase,'ready');assert.ok(!h.released.includes('file:///original.jpg'));
 const a=h.editor.apply();h.editor.previewFailed('file:///cache-2.jpg');assert.equal(h.state?.phase,'saving');await tick();h.editor.close();h.editor.previewFailed('file:///cache-2.jpg');assert.equal(h.state,null);h.jobs[3]!.d.resolve(h.result(3));assert.equal(await a,false);
});
