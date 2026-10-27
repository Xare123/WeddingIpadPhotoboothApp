import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rename, rm } from 'node:fs/promises';
import { statSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { LocalRepository } from '../../../apps/ipad/src/local-persistence';
import { createNativeFilePorts } from '../../../apps/ipad/src/native-file-ports';
import { ensureUploadJob, type QueueDatabase } from '../../../apps/ipad/src/queue-index';
import { createPhotoExporter } from '../../../apps/ipad/src/photo-export';
import { uploadDocumentPhotoPath } from '../../../apps/ipad/src/local-paths';
import { usableQueueRows } from '../../../apps/ipad/src/queue-index';
import { uploadJob, drainQueue, type QueueJob } from '../src/index';

async function diskFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'booth-storage-'));
  const sql = new DatabaseSync(join(directory, 'booth.sqlite'));
  sql.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE job_quarantine(job_id TEXT,payload TEXT,PRIMARY KEY(job_id,payload)); CREATE TABLE metadata(key TEXT PRIMARY KEY,payload TEXT)');
  t.after(async () => { sql.close(); await rm(directory, { recursive: true, force: true }); });
  const faults = { move: false, queue: false };
  const db: QueueDatabase = {
    async getFirstAsync<T>(query: string, ...args: string[]) { return sql.prepare(query).get(...args) as T ?? null; },
    async runAsync(query, ...args) { return { changes: Number(sql.prepare(query).run(...args).changes) }; },
  };
  const uri = (path: string) => pathToFileURL(join(directory, path)).href;
  class NativeFile {
    constructor(readonly uri: string) {}
    get name() { return basename(fileURLToPath(this.uri)); }
    get exists() { try { return statSync(fileURLToPath(this.uri)).isFile(); } catch { return false; } }
    get size() { try { return statSync(fileURLToPath(this.uri)).size; } catch { return null; } }
    async copy(to: NativeFile, options?: { overwrite?: boolean }) { await copyFile(fileURLToPath(this.uri), fileURLToPath(to.uri), options?.overwrite ? 0 : constants.COPYFILE_EXCL); }
    async move(to: NativeFile) { if (faults.move || to.exists) throw new Error('Native rename refused'); await rename(fileURLToPath(this.uri), fileURLToPath(to.uri)); }
    async write(text: string) { await writeFile(fileURLToPath(this.uri), text); }
    async text() { return readFile(fileURLToPath(this.uri), 'utf8'); }
  }
  const files = createNativeFilePorts({ uri, file: path => new NativeFile(path), directory: {
    async create() { await mkdir(join(directory, 'photobooth'), { recursive: true }); },
    async list() { return (await readdir(join(directory, 'photobooth'))).map(name => new NativeFile(uri('photobooth/' + name))); },
  }, isFile: (value): value is NativeFile => value instanceof NativeFile });
  let nonce = 0;
  const index = {
    async read(key: string) { const row = sql.prepare('SELECT payload FROM metadata WHERE key=?').get(key) as {payload:string}|undefined; return row ? JSON.parse(row.payload) : null; },
    async write(key: string, value: unknown) { sql.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key, JSON.stringify(value)); },
    async ensureJob(job: QueueJob) { if (faults.queue) throw new Error('Database temporarily unavailable'); await ensureUploadJob(db, job.kind === 'upload' ? { ...job, fileUri: 'photobooth/' + basename(new URL(job.fileUri).pathname) } : job); },
  };
  const make = () => new LocalRepository(files, index, () => 'nonce-' + ++nonce, () => 1000);
  await writeFile(join(directory, 'camera.jpg'), Buffer.from([255, 216, 1, 2, 255, 217]));
  const source = uri('camera.jpg');
  const payload = (id: string): QueueJob => JSON.parse((sql.prepare('SELECT payload FROM jobs WHERE id=?').get(id) as {payload:string}).payload);
  return { sql, db, uri, files, faults, make, source, payload };
}
async function complete(f: Awaited<ReturnType<typeof diskFixture>>, id = 'session') {
  const repository = f.make(); let session = await repository.createSession(id, 5);
  for (let i = 0; i < 5; i++) session = await repository.saveShot(session, `${id}-photo-${i}`, f.source, i);
  return { repository, session };
}


import { createHash } from 'node:crypto';
import type { PhotoTreatment } from '../../../apps/ipad/src/local-types';
import { canonicalPhotoTreatment, isPhotoTreatment, isOriginalTreatment, samePhotoTreatment, photoTreatmentForCapture } from '../../../apps/ipad/src/photo-treatment';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const treatment: PhotoTreatment = { version: 'wedding-photo-treatment-v1', order: 'look-then-face',
 look: {preset:'warm',intensity:0.5,version:'wedding-ci-srgb-v1'},face:{accessory:'crown',version:'wedding-face-prototype-v3'} };
async function treatedFixture(t: Parameters<typeof diskFixture>[0], count=5) {
 const f=await diskFixture(t);f.files.sha256=async uri=>hash(await readFile(fileURLToPath(uri)));
 const raw=await readFile('apps/ipad/native-tests/fixtures/studio/studio-portrait-1.jpg');
 const output=await readFile('apps/ipad/native-tests/fixtures/studio/studio-portrait-2.jpg');
 await writeFile(fileURLToPath(f.source),raw);const cache=f.uri('approved-cache.jpg');await writeFile(fileURLToPath(cache),output);
 const repository=f.make();let session=await repository.createSession('treated',count);
 for(let slot=0;slot<count;slot++)session=await repository.saveShot(session,'raw-'+slot,f.source,slot);
 const input=(id='treatment-one', expected=session.shots[0]!.id)=>({id,newRenderedURI:cache,sourcePhotoId:'raw-0',expectedSelectedPhotoId:expected,slot:0,treatment:structuredClone(treatment),sourceSha256:hash(raw),outputSha256:hash(output)});
 return {...f,repository,session,raw,output,cache,input};
}

test('treatment recipes are strict canonical identities and preserve legacy look conversion',()=>{
 assert.ok(isPhotoTreatment(treatment));assert.ok(samePhotoTreatment(treatment,JSON.parse(canonicalPhotoTreatment(treatment))));
 assert.equal(isPhotoTreatment({...treatment,extra:true}),false);assert.equal(isPhotoTreatment({...treatment,look:{...treatment.look,intensity:NaN}}),false);
 assert.equal(isPhotoTreatment({...treatment,face:{...treatment.face,version:'other'}}),false);
 assert.ok(isOriginalTreatment(photoTreatmentForCapture({})));assert.equal(photoTreatmentForCapture({look:{preset:'bw',intensity:0.25,version:'wedding-ci-srgb-v1'}}).look.preset,'bw');
 assert.equal(isOriginalTreatment(treatment),false);
 const zero={...treatment,look:{...treatment.look,intensity:0}},nativeIdentity={...treatment,look:{preset:'original' as const,intensity:0,version:'wedding-ci-srgb-v1' as const}};
 assert.ok(samePhotoTreatment(zero,nativeIdentity));assert.equal(JSON.parse(canonicalPhotoTreatment(zero)).look.preset,'original');
 assert.ok(samePhotoTreatment({...nativeIdentity,look:{...nativeIdentity.look,intensity:1}},nativeIdentity));assert.equal(samePhotoTreatment(treatment,nativeIdentity),false);
 assert.equal(zero.look.preset,'warm','canonical normalization must not mutate the caller or legacy look');

});
test('actual files and SQLite: approved cache bytes commit separately from root original, recover and reuse same treatment ID',async t=>{
 const f=await treatedFixture(t);let current=await f.repository.saveRenderedPhoto(f.session.id,f.input());
 assert.equal(current.shots[0]!.id,'treatment-one');assert.equal(current.shots[0]!.sourcePhotoId,'raw-0');assert.deepEqual(current.shots[0]!.treatment,treatment);assert.equal(current.shots[0]!.look,undefined);
 assert.deepEqual(await readFile(fileURLToPath(current.shots[0]!.fileUri)),f.output);assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);
 current.shots[0]!.treatment!.face.accessory='hearts';assert.equal((await f.repository.getSession(f.session.id))?.shots[0]?.treatment?.face.accessory,'crown','hydrated recipe mutation must not alter durable model');
 assert.ok(current.retakes?.some(p=>p.id==='raw-0'));assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
 await rm(fileURLToPath(f.cache));for(let n=0;n<2;n++){await f.repository.recover();assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.id,'treatment-one');}
 current=await f.repository.saveRenderedPhoto(f.session.id,f.input('treatment-one','treatment-one'));assert.equal(current.shots[0]!.id,'treatment-one');
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input('treatment-one','treatment-one'),treatment:{...treatment,face:{...treatment.face,accessory:'hearts'}}}),/photo-id-reused/);
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,f.input('raw-0','treatment-one')),/photo-id-reused/);
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input('both','treatment-one'),look:{preset:'warm',intensity:0.5,version:'wedding-ci-srgb-v1'}} as any),/render-recipe/);
});
test('source and approved-cache hash mismatch fail before any derivative bytes are committed',async t=>{
 for(const field of ['sourceSha256','outputSha256'] as const){const f=await treatedFixture(t);await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input(),[field]:'0'.repeat(64)}));
 assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.id,'raw-0');assert.equal((await f.files.list()).some(n=>n.startsWith('treatment-one.')),false);assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);}
});
test('same-size copied-byte corruption is detected and never recovers into the selected set or queue',async t=>{
 const f=await treatedFixture(t),copy=f.files.copy;f.files.copy=async(a,b)=>{await copy(a,b);const bytes=Buffer.from(f.output);bytes[20]=bytes[20]!^1;await writeFile(fileURLToPath(f.uri(b)),bytes);};
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,f.input()),/treatment-copy/);await f.repository.recover();
 assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.id,'raw-0');assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
 assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);
});
test('new-treatment staging cannot auto-select across copy, rename or capture/session journal failure windows',async t=>{
 for(const fault of ['copy','move','capture-journal','selection-journal']){const f=await treatedFixture(t),copy=f.files.copy,write=f.files.write;let fired=false;
 f.files.copy=async(a,b)=>{if(fault==='copy'&&!fired){fired=true;throw Error('injected copy');}return copy(a,b);};
 f.faults.move=fault==='move';
 f.files.write=async(path,text)=>{const r=JSON.parse(text);if(!fired&&((fault==='capture-journal'&&r.kind==='capture'&&r.capture.id==='treatment-one'&&r.capture.relativePath.endsWith('.jpg'))||(fault==='selection-journal'&&r.kind==='session'&&r.session.selected[0]==='treatment-one'))){fired=true;throw Error('injected journal');}return write(path,text);};
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,f.input()));f.files.copy=copy;f.files.write=write;f.faults.move=false;
 for(let n=0;n<2;n++){await f.repository.recover();await f.repository.retryStagedPhotos(f.session.id);assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.id,'raw-0');}
 const selected=await f.repository.saveRenderedPhoto(f.session.id,f.input());assert.equal(selected.shots[0]!.id,'treatment-one');
 assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
 }
});
test('admission revoked during copy retains host-recoverable bytes without selecting on retry or relaunch',async t=>{
 const f=await treatedFixture(t),copy=f.files.copy;let admitted=true;f.files.copy=async(a,b)=>{await copy(a,b);admitted=false;};
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input(),admit:()=>admitted}),/render-admission/);
 f.files.copy=copy;await f.repository.recover();await f.repository.retryStagedPhotos(f.session.id);const current=(await f.repository.getSession(f.session.id))!;
 assert.equal(current.shots[0]!.id,'raw-0');assert.ok(current.retakes?.some(p=>p.id==='treatment-one'));assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
});
test('abandoned retake cannot select a completed stale treatment or displace the preserved parent',async t=>{
 const f=await treatedFixture(t),child=await f.repository.beginRetakeAll(f.session.id,{id:'child',expectedSelectedPhotoIds:f.session.shots.map(p=>p.id),timing:{firstSeconds:5,nextSeconds:3}});
 const shot=await f.repository.saveShot(child,'child-root',f.source,0),copy=f.files.copy;let admitted=true;
 f.files.copy=async(a,b)=>{await copy(a,b);admitted=false;};await assert.rejects(f.repository.saveRenderedPhoto(child.id,{...f.input('stale-child','child-root'),sourcePhotoId:'child-root',admit:()=>admitted}),/render-admission/);
 f.files.copy=copy;await f.repository.cancelRetakeAll(shot.id);await f.repository.recover();
 await assert.rejects(f.repository.saveRenderedPhoto(child.id,{...f.input('stale-child','child-root'),sourcePhotoId:'child-root'}));
 assert.equal((await f.repository.getActiveSession())?.id,f.session.id);assert.equal((await f.repository.getSession(child.id))?.shots[0]!.id,'child-root');assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
});
test('legacy look can be replaced by a treatment rooted at the camera original and Original can still be restored',async t=>{
 const f=await treatedFixture(t);let current=await f.repository.saveRenderedPhoto(f.session.id,{id:'legacy-look',newRenderedURI:f.cache,sourcePhotoId:'raw-0',expectedSelectedPhotoId:'raw-0',slot:0,look:{preset:'bw',intensity:0.5,version:'wedding-ci-srgb-v1'}});
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input('bad-root','legacy-look'),sourcePhotoId:'legacy-look'}),/render-source/);
 current=await f.repository.saveRenderedPhoto(f.session.id,f.input('combined','legacy-look'));assert.equal(current.shots[0]!.sourcePhotoId,'raw-0');
 current=await f.repository.selectSavedPhoto(f.session.id,'raw-0',0,'combined');assert.equal(current.shots[0]!.id,'raw-0');await f.repository.recover();assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.id,'raw-0');
});
test('four-photo publication includes selected treatment, raw source and composite and preserves completed queue history',async t=>{
 const f=await treatedFixture(t,4);let current=await f.repository.saveRenderedPhoto(f.session.id,f.input());const ids=current.shots.map(p=>p.id);
 const recipe={version:'wedding-template-v2' as const,gridAspect:'portrait' as const,layout:'grid' as const,theme:'classic' as const,photoIds:ids,cropsByPhotoId:Object.fromEntries(ids.map(id=>[id,{mode:'fit' as const,x:0,y:0,zoom:1}]))};
 await f.repository.saveComposite(f.session.id,{id:'composite',newRenderedURI:f.cache,recipe,expectedSelectedPhotoIds:ids});await f.repository.confirmSession(f.session.id);
 const assets=await f.repository.getSessionPublicationAssets(f.session.id);assert.deepEqual(assets.photoIds,ids);assert.deepEqual(assets.originalPhotoIds,['raw-0','raw-1','raw-2','raw-3']);
 const saved={...f.payload('treatment-one'),state:'complete',attempts:7,nextAttemptAt:98765,guestUrl:'https://photos.example/g/treatment',guestExpiresAt:999999};f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(saved),'treatment-one');
 for(let n=0;n<2;n++){await f.repository.recover();await f.repository.reconcileConfirmedPhotos();assert.deepEqual(f.payload('treatment-one'),saved);}
 const jobs=(f.sql.prepare('SELECT id FROM jobs').all() as {id:string}[]).map(j=>j.id).sort();assert.deepEqual(jobs,[...ids,'raw-0','composite'].sort());assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);
});
test('five-photo legacy session queues only its five selected identities after treatment confirmation',async t=>{
 const f=await treatedFixture(t);const current=await f.repository.saveRenderedPhoto(f.session.id,f.input());await f.repository.confirmSession(f.session.id);await f.repository.recover();
 assert.deepEqual((f.sql.prepare('SELECT id FROM jobs').all() as {id:string}[]).map(j=>j.id).sort(),current.shots.map(p=>p.id).sort());assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get('raw-0'),undefined);
});
test('new treatments fail closed without a hash port while legacy looks remain usable',async t=>{
 const f=await treatedFixture(t);delete f.files.sha256;await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,f.input()),/treatment-hash/);
 const current=await f.repository.saveRenderedPhoto(f.session.id,{id:'legacy',newRenderedURI:f.cache,sourcePhotoId:'raw-0',expectedSelectedPhotoId:'raw-0',slot:0,look:{preset:'warm',intensity:0.5,version:'wedding-ci-srgb-v1'}});assert.equal(current.shots[0]!.id,'legacy');
});
test('a selected treatment whose canonical bytes change cannot confirm or publish as the approved preview',async t=>{
 const f=await treatedFixture(t);const current=await f.repository.saveRenderedPhoto(f.session.id,f.input());const bytes=Buffer.from(f.output);bytes[20]=bytes[20]!^1;await writeFile(fileURLToPath(current.shots[0]!.fileUri),bytes);
 await assert.rejects(f.repository.confirmSession(f.session.id));assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
});

test('malformed treatment journals reserve retained JPEG IDs and never import them as camera originals',async t=>{
 const f=await treatedFixture(t);let admitted=true;const copy=f.files.copy;f.files.copy=async(a,b)=>{await copy(a,b);admitted=false;};
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,{...f.input(),admit:()=>admitted}),/render-admission/);f.files.copy=copy;
 for(const name of await f.files.list()){if(!name.endsWith('.json'))continue;const path='photobooth/'+name,r=JSON.parse(await f.files.read(path));
 if(r.kind==='capture'&&r.capture.id==='treatment-one'){r.capture.treatment.face.version='invalid-recipe';await f.files.write(path,JSON.stringify(r));}}
 await f.repository.recover();assert.equal((await f.repository.getActiveSession())?.shots[0]!.id,'raw-0');assert.equal((await f.repository.listLocalSessions()).length,1);
 await assert.rejects(f.repository.saveShot(f.session.id,'treatment-one',f.source,0),/photo-id-reused/);
 await assert.rejects(f.repository.saveRenderedPhoto(f.session.id,f.input()),/photo-id-reused/);
 assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/treatment-one.jpg'))),f.output);assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.jpg'))),f.raw);
});

test('legacy five-shot draft root remains hash-verifiable without renaming after one or persistent root move failures',async t=>{
 for(const failures of [1,Infinity]){
  const f=await treatedFixture(t);await f.files.move('photobooth/raw-0.jpg','photobooth/raw-0.draft.jpg');
  for(const name of await f.files.list()){if(!name.endsWith('.json'))continue;const path='photobooth/'+name,r=JSON.parse(await f.files.read(path));
   if(r.kind==='capture'&&r.capture.id==='raw-0'){r.capture.relativePath='photobooth/raw-0.draft.jpg';await f.files.write(path,JSON.stringify(r));}}
  const move=f.files.move;let refused=0;f.files.move=async(a,b)=>{if(a==='photobooth/raw-0.draft.jpg'&&refused<failures){refused++;throw Error('legacy root rename refused');}return move(a,b);};
  await f.repository.recover();assert.equal((await f.repository.getSession(f.session.id))?.shots[0]!.fileUri,f.uri('photobooth/raw-0.draft.jpg'));
  await assert.rejects(f.repository.confirmSession(f.session.id),/original-commit/);assert.equal(refused,1);
  const treated=await f.repository.saveRenderedPhoto(f.session.id,f.input());assert.equal(treated.shots[0]!.id,'treatment-one');
  await f.repository.confirmSession(f.session.id);const restored=f.make();await restored.recover();await restored.confirmSession(f.session.id);
  assert.equal((await restored.getSession(f.session.id))?.shots[0]!.id,'treatment-one');assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,5);
  assert.deepEqual(await readFile(fileURLToPath(f.uri('photobooth/raw-0.draft.jpg'))),f.raw);assert.equal((await f.files.list()).includes('raw-0.jpg'),false);
  assert.equal((await restored.getSession(f.session.id))?.retakes?.find(p=>p.id==='raw-0')?.fileUri,f.uri('photobooth/raw-0.draft.jpg'));
 }
});
