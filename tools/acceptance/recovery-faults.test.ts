import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rename, rm } from 'node:fs/promises';
import { statSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { LocalRepository } from '../../apps/ipad/src/local-persistence';
import { createNativeFilePorts } from '../../apps/ipad/src/native-file-ports';
import { ensureUploadJob, type QueueDatabase } from '../../apps/ipad/src/queue-index';
import { createPhotoExporter } from '../../apps/ipad/src/photo-export';
import { uploadDocumentPhotoPath } from '../../apps/ipad/src/local-paths';
import { usableQueueRows } from '../../apps/ipad/src/queue-index';
import { uploadJob, drainQueue, type QueueJob } from '../../packages/core/src/index';

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


import { createQueueConsumer } from '../../packages/core/src/index';
import { finalizeReadySessions } from '../../apps/ipad/src/session-sync';
import { createHostOriginalActions } from '../../apps/ipad/src/host-originals';
async function rows(f: Awaited<ReturnType<typeof diskFixture>>, repo?: LocalRepository) {
 const result = await usableQueueRows(f.db, f.sql.prepare('SELECT id,payload FROM jobs').all() as {id:string;payload:string}[], job => job.kind === 'upload' ? {...job, fileUri:f.uri(uploadDocumentPhotoPath(job.photoId, job.fileUri))}:job);
 repo?.reportQueueIndexIssues(result.invalidRows); return result;
}
test('independent 1: one-shot failed move, fallback refuses partial, finish and repeat confirmation/recovery preserve five readable JPEG jobs', async t => {
 const f=await diskFixture(t), r=f.make(); let s=await r.createSession('independent-one', 5);
 // Boundary copy succeeds; the first rename alone fails.
 const move=f.files.move; let failures=1; f.files.move=async(a,b)=>{if(failures-- > 0) throw Error('one-shot move'); await move(a,b);};
 await assert.rejects(r.saveShot(s,'independent-one-p0',f.source,0));
 assert.ok((await f.files.list()).includes('independent-one-p0.partial'));
 const fallback=await r.getActiveSession();
 assert.equal(fallback?.shots.length,1);
 assert.match(fallback!.shots[0]!.fileUri,/\.jpg$/);
 assert.deepEqual(await readFile(fileURLToPath(fallback!.shots[0]!.fileUri)),Buffer.from([255,216,1,2,255,217]));
 assert.equal(fallback?.stagedOriginals,undefined); // the one-shot failure has cleared and fallback normalized, never ACKing .partial
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM jobs').get()?.n,0);
 await r.retryStagedPhotos(s.id); s=(await r.getActiveSession())!;
 for(let i=1;i<5;i++) s=await r.saveShot(s,'independent-one-p'+i,f.source,i);
 for(let i=0;i<2;i++){await r.confirmSession(s.id);await r.recover();}
 const jobs=(await rows(f)).jobs; assert.equal(jobs.length,5);
 for(const job of jobs){assert.equal(job.kind,'upload');if(job.kind==='upload'){assert.match(job.fileUri,/\.jpg$/); assert.deepEqual(await readFile(fileURLToPath(job.fileUri)),Buffer.from([255,216,1,2,255,217]));}}
});
test('independent 2: transient ensure failure repaired by same-process retry predrain and five uploads plus ready',async t=>{
 const f=await diskFixture(t),{repository:r,session:s}=await complete(f,'independent-two');
 f.faults.queue=true;await r.confirmSession(s.id);assert.equal((await r.getSession(s.id))?.storageWarning,'index-repair-pending');f.faults.queue=false;
 const uploads:string[]=[],ready:string[][]=[];
 const store={async list(){return(await rows(f,r)).jobs;},async save(job:QueueJob){f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(job),job.id);}};
 const c=createQueueConsumer(store,{async upload(job){await readFile(fileURLToPath(job.fileUri));uploads.push(job.photoId);},async share(){throw Error('no SMS');}},async()=>finalizeReadySessions({store,sessions:()=>r.listLocalSessions(),async ready(id,ids){assert.equal(id,s.id);ready.push(ids);return{value:{status:'ready',url:'https://photos.example/g/independent',expiresAt:100000},origin:'https://photos.example'};}},2000),()=>2000,()=>r.reconcileConfirmedPhotos());
 await c.retry(); await c.sync();assert.equal(uploads.length,5);assert.equal(new Set(uploads).size,5);assert.equal(ready.length,1);assert.equal(ready[0]?.length,5);assert.equal((await r.getSession(s.id))?.storageWarning,undefined);
 assert.ok((await store.list()).every(j=>j.state==='complete'&&j.guestExpiresAt===100000));
});
test('independent 3: automatic uncertain export stays inert, host authorization retries one photo, acknowledge inert, retained exports excluded',async t=>{
 const f=await diskFixture(t),{repository:r,session:s}=await complete(f,'independent-three');
 for(const p of s.shots)await r.updateExport(s.id,p.id,'saved');const id=s.shots[0]!.id;await r.updateExport(s.id,id,'uncertain');
 const calls:string[]=[];const capability={available:true,permission:'granted',canAskAgain:false,writeOnly:true} as const;
 const e=createPhotoExporter({async capability(){return capability;},async requestAddPermission(){return capability;},async save(uri){calls.push(uri);}},{get:id=>r.getSession(id),update:(id,p,status)=>r.updateExport(id,p,status)});
 await e.exportSession((await r.getSession(s.id))!);assert.equal(calls.length,0);
 let rejectAuth=true,auth=0;const host=createHostOriginalActions({ assertCurrent: () => {},async authenticate(){auth++;if(rejectAuth)throw Error('authentication failed');},load:(id:string)=>r.getSession(id),acknowledge:(id:string,p:string)=>r.updateExport(id,p,'saved'),export:(value:typeof s,options:any)=>e.exportSession(value,options),finishSave:(id:string)=>r.retryStagedPhotos(id)});
 const request={kind:'export',sessionId:s.id,photoId:id,retained:false} as const;
 assert.equal((await host.run(request)).kind,'confirm-duplicate');assert.equal(auth,0);
 await assert.rejects(host.run({...request,duplicateRiskAccepted:true}));assert.equal(calls.length,0);rejectAuth=false;await host.run({...request,duplicateRiskAccepted:true});assert.equal(calls.length,1);assert.equal(auth,2);
 await r.updateExport(s.id,id,'uncertain');await host.run({kind:'acknowledge',sessionId:s.id,photoId:id,retained:false});assert.equal(calls.length,1);
 let current=await r.saveShot(s,'independent-three-retake',f.source,0);await r.updateExport(s.id,id,'uncertain');
 assert.ok(current.retakes?.some(p=>p.id===id));await host.run({...request,retained:true,duplicateRiskAccepted:true});assert.equal(calls.length,2);
 await r.confirmSession(s.id);await r.recover();assert.equal(f.sql.prepare('SELECT id FROM jobs WHERE id=?').get(id),undefined);assert.equal((await rows(f)).jobs.length,5);assert.equal((await r.getSession(s.id))?.shots[0]?.id,'independent-three-retake');
});
test('independent 4: invalid JSON quarantines same-ID repair, warnings clear and exact completion/backoff survives repeated repair and CAS',async t=>{
 const f=await diskFixture(t),{repository:r,session:s}=await complete(f,'independent-four');await r.confirmSession(s.id);
 const a={...f.payload(s.shots[0]!.id),state:'complete',attempts:11,nextAttemptAt:5555,guestUrl:'https://photos.example/g/preserved',guestExpiresAt:999999,extra:'preserved'};
 const b={...f.payload(s.shots[1]!.id),attempts:13,nextAttemptAt:8888};for(const j of[a,b])f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(j),j.id);
 const id=s.shots[2]!.id;f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run('{invalid-json',id);
 assert.equal((await rows(f,r)).invalidRows,1);assert.equal((await r.getSession(s.id))?.storageWarning,'index-repair-pending');
 for(let n=0;n<2;n++){await r.reconcileConfirmedPhotos();assert.equal((await rows(f,r)).jobs.length,5);assert.deepEqual(f.payload(a.id),a);assert.deepEqual(f.payload(b.id),b);assert.equal(f.payload(id).id,id);assert.equal((await r.getSession(s.id))?.storageWarning,undefined);}
 assert.equal(f.sql.prepare('SELECT payload FROM job_quarantine WHERE job_id=?').get(id)?.payload,'{invalid-json');
 const expected=f.payload(id);f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run('{cas-corrupt',id);let raced=false;const done={...expected,state:'complete',attempts:17,nextAttemptAt:121212,guestUrl:'https://photos.example/g/cas',guestExpiresAt:777777};
 await ensureUploadJob({getFirstAsync:f.db.getFirstAsync,async runAsync(q,...args){if(!raced&&q.startsWith('UPDATE jobs')){raced=true;f.sql.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(done),id);}return f.db.runAsync(q,...args);}},expected);assert.deepEqual(f.payload(id),done);
});
