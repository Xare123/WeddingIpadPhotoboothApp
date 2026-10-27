import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createQueueConsumer, type QueueJob, type QueueStore, type QueueTransport } from '@wedding-booth/core';
import { LocalRepository, type LocalFiles, type LocalIndex, type RenderedPhotoInput } from '../src/local-persistence';
import type { ActiveSession, CompositeRecipe, PhotoLibraryCapability, PhotoTreatment } from '../src/local-types';
import { createNativeFilePorts } from '../src/native-file-ports';
import { createPhotoExporter } from '../src/photo-export';
import { createPhotoLookEditor, type PhotoLookEditorState, type PhotoTreatmentRenderResult } from '../src/photo-look-editor';
import { canonicalPhotoTreatment } from '../src/photo-treatment';
import { createTemplateEditor, templateDimensions, type TemplateEditorState, type TemplateEditorPorts } from '../src/template-editor';

// Composition acceptance only: real Linux files/journals and production controllers,
// repository, exporter, and queue consumer. Metadata/queue indexes are Map substitutes
// (the separate persistence suite exercises real SQLite). Native render, Photos,
// template inspection/raster, and HTTP are injected boundaries. Render outputs use
// existing image_gen synthetic portraits (studio/provenance.json), not processed
// pixels; the template output is opaque bytes. These tests prove neither native
// effects/face geometry, JPEG encoding, template pixels, nor a real Photos/HTTP write.
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = async (uri: string) => sha256(await readFile(fileURLToPath(uri)));
const warmTiara: PhotoTreatment = {
  version: 'wedding-photo-treatment-v1', order: 'look-then-face',
  look: { preset: 'warm', intensity: 0.6, version: 'wedding-ci-srgb-v1' },
  face: { accessory: 'crown', version: 'wedding-face-prototype-v3' }, // UI title: Tiara.
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
function states<T extends { phase: string; error?: string }>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get current() { return value; },
    update(next: T | null) { value = next; for (const listener of [...listeners]) listener(); },
    until(predicate: (state: T) => boolean): Promise<T> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { finish(); reject(new Error('Timed out waiting for controller state')); }, 5000);
        const finish = () => { clearTimeout(timer); listeners.delete(check); };
        const check = () => {
          if (value?.phase === 'error') { finish(); reject(new Error(value.error ?? 'Controller error')); }
          else if (value && predicate(value)) { finish(); resolve(value); }
        };
        listeners.add(check); check();
      });
    },
  };
}

async function diskFixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'booth-treatment-flow-'));
  const deletionJobs: Promise<void>[] = [];
  t.after(async () => { await Promise.all(deletionJobs); await rm(directory, { recursive: true, force: true }); });
  const uri = (relative: string) => pathToFileURL(join(directory, relative)).href;
  class DiskFile {
    constructor(readonly uri: string) {}
    get name() { return basename(fileURLToPath(this.uri)); }
    get exists() { try { return statSync(fileURLToPath(this.uri)).isFile(); } catch { return false; } }
    get size() { try { return statSync(fileURLToPath(this.uri)).size; } catch { return null; } }
    async copy(destination: DiskFile, options?: { overwrite?: boolean }) {
      await copyFile(fileURLToPath(this.uri), fileURLToPath(destination.uri), options?.overwrite ? 0 : constants.COPYFILE_EXCL);
    }
    async move(destination: DiskFile) {
      if (destination.exists) throw new Error('Refusing to overwrite committed file');
      await rename(fileURLToPath(this.uri), fileURLToPath(destination.uri));
    }
    async write(text: string) { await writeFile(fileURLToPath(this.uri), text); }
    async text() { return readFile(fileURLToPath(this.uri), 'utf8'); }
  }
  const files: LocalFiles = createNativeFilePorts({
    uri, file: value => new DiskFile(value),
    directory: {
      async create() { await mkdir(join(directory, 'photobooth'), { recursive: true }); },
      async list() { return (await readdir(join(directory, 'photobooth'))).map(name => new DiskFile(uri('photobooth/' + name))); },
    },
    isFile: (entry): entry is DiskFile => entry instanceof DiskFile,
  });
  files.sha256 = digest; // Hash actual read-back bytes, never URI strings or a stored expected hash.
  const jobs = new Map<string, QueueJob>();
  const store: QueueStore = {
    async list() { return [...jobs.values()].map(job => structuredClone(job)); },
    async save(job) { jobs.set(job.id, structuredClone(job)); },
  };
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  function makeRepository() {
    // A relaunch starts with an empty metadata index and rehydrates filesystem journals.
    const metadata = new Map<string, unknown>();
    const index: LocalIndex = {
      async read(key) { return structuredClone(metadata.get(key) ?? null); },
      async write(key, value) { metadata.set(key, structuredClone(value)); },
      async ensureJob(job) { if (!jobs.has(job.id)) jobs.set(job.id, structuredClone(job)); },
    };
    return new LocalRepository(files, index, () => id('journal'), () => 1000);
  }
  const originals = await Promise.all([1, 2, 3, 4].map(n =>
    readFile(new URL(`../native-tests/fixtures/studio/studio-portrait-${n}.jpg`, import.meta.url))));
  async function captureFour(repository: LocalRepository) {
    let session = await repository.createSession('session', 4);
    for (let slot = 0; slot < 4; slot++) {
      const camera = uri(`camera-${slot}.jpg`);
      await writeFile(fileURLToPath(camera), originals[slot]!);
      session = await repository.saveShot(session, `raw-${slot}`, camera, slot);
    }
    return session;
  }
  const release = (cacheUri: string) => {
    // Catch an ownership error before a fake native release could remove an original.
    assert.ok(fileURLToPath(cacheUri).startsWith(join(directory, 'cache-')));
    const job = rm(fileURLToPath(cacheUri), { force: true });
    deletionJobs.push(job); return job;
  };
  const flushReleases = () => Promise.all(deletionJobs);
  return { directory, uri, files, jobs, store, id, originals, makeRepository, captureFour, release, flushReleases };
}
type DiskFixture = Awaited<ReturnType<typeof diskFixture>>;

function treatmentEditor(f: DiskFixture, repository: LocalRepository, forbidRender = false) {
  const state = states<PhotoLookEditorState>();
  const renders: { sourceUri: string; recipeJSON: string; result: PhotoTreatmentRenderResult }[] = [];
  const saved: RenderedPhotoInput[] = [], sessions: ActiveSession[] = [];
  let renderAttempts = 0;
  const editor = createPhotoLookEditor({
    id: () => f.id('treatment'),
    render: async () => { throw new Error('Legacy preview/full render path is out of scope'); },
    cancel() {}, release: async () => { throw new Error('Legacy release path is out of scope'); },
    async renderTreatment(sourceUri, recipeJSON, requestId) {
      renderAttempts++;
      if (forbidRender) throw new Error('A persisted treatment must reopen without native rendering');
      const recipe = JSON.parse(recipeJSON) as PhotoTreatment;
      const cacheUri = f.uri(`cache-${requestId}.jpg`);
      // Distinct boundary substitutions make an unapplied Warm-only preview observable.
      const bytes = recipe.face.accessory === 'crown' ? f.originals[1]! : f.originals[2]!;
      await writeFile(fileURLToPath(cacheUri), bytes);
      const result: PhotoTreatmentRenderResult = {
        uri: cacheUri, width: 960, height: 1200, recipe,
        originalSha256: await digest(sourceUri), outputSha256: await digest(cacheUri), isOriginal: false,
        detectedFaceCount: recipe.face.accessory === 'none' ? null : 2,
        landmarkedFaceCount: recipe.face.accessory === 'none' ? null : 2,
        decoratedFaceCount: recipe.face.accessory === 'none' ? 0 : 2, fallbackReason: 'none',
      };
      renders.push({ sourceUri, recipeJSON, result }); return result;
    },
    cancelTreatment() {}, releaseTreatment: f.release,
    loadSession: sessionId => repository.getSession(sessionId),
    saveRenderedPhoto: (sessionId, input) => { saved.push(input); return repository.saveRenderedPhoto(sessionId, input); },
    selectSavedPhoto: (sessionId, photoId, slot, expected) => repository.selectSavedPhoto(sessionId, photoId, slot, expected),
    onState: value => state.update(value), onSession: value => { sessions.push(value); },
  });
  async function chooseWarmTiara(session: ActiveSession) {
    editor.open(session, 0);
    editor.choose('warm', 0.6);
    const warm = await state.until(value => value.phase === 'ready' && value.preset === 'warm' && value.faceAccessory === 'none');
    const unapplied = { uri: warm.previewUri, sha256: await digest(warm.previewUri) };
    editor.chooseFace('crown');
    const approved = await state.until(value => value.phase === 'ready' && value.preset === 'warm' && value.faceAccessory === 'crown');
    return { approved, unapplied };
  }
  return { editor, state, renders, saved, sessions, chooseWarmTiara, get renderAttempts() { return renderAttempts; } };
}

async function assertOriginalsUnchanged(f: DiskFixture) {
  for (let slot = 0; slot < 4; slot++)
    assert.equal(await digest(f.uri(`photobooth/raw-${slot}.jpg`)), sha256(f.originals[slot]!), `camera original ${slot}`);
}

test('approved treatment bytes survive Apply/relaunch and feed Photos, template, publication and the queue', async t => {
  const f = await diskFixture(t), repository = f.makeRepository();
  const captured = await f.captureFour(repository), h = treatmentEditor(f, repository);
  const { approved, unapplied } = await h.chooseWarmTiara(captured);
  const approvedBytes = await readFile(fileURLToPath(approved.previewUri)), approvedHash = sha256(approvedBytes);
  assert.deepEqual(approved.effectiveRecipe, warmTiara);
  assert.equal(h.renders.length, 2, 'each explicit choice produces its full-size preview');
  assert.equal(h.renders[1]!.recipeJSON, canonicalPhotoTreatment(warmTiara));
  assert.equal(h.renders[1]!.sourceUri, captured.shots[0]!.fileUri);
  assert.equal(h.renders[1]!.result.outputSha256, approvedHash);
  assert.notEqual(approvedHash, unapplied.sha256);
  const renderCount = h.renderAttempts;
  assert.equal(await h.editor.apply(), true);
  assert.equal(h.renderAttempts, renderCount, 'Apply must copy the acknowledged result without a second render');
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0]!.newRenderedURI, approved.previewUri);
  assert.equal(h.saved[0]!.sourceSha256, sha256(f.originals[0]!));
  assert.equal(h.saved[0]!.outputSha256, approvedHash);
  assert.equal(h.saved[0]!.sourcePhotoId, 'raw-0');
  const applied = (await repository.getSession(captured.id))!, selected = applied.shots[0]!;
  assert.notEqual(selected.id, 'raw-0');
  assert.equal(selected.sourcePhotoId, 'raw-0');
  assert.deepEqual(selected.treatment, warmTiara);
  assert.notEqual(selected.fileUri, approved.previewUri);
  assert.deepEqual(await readFile(fileURLToPath(selected.fileUri)), approvedBytes);
  assert.equal(await digest(selected.fileUri), approvedHash);
  assert.equal(f.jobs.size, 0, 'unconfirmed choices do not upload');
  await assertOriginalsUnchanged(f);
  h.editor.close(); await f.flushReleases();

  const reopenedRepository = f.makeRepository(); await reopenedRepository.recover();
  const reopened = (await reopenedRepository.getSession(captured.id))!, relaunched = treatmentEditor(f, reopenedRepository, true);
  relaunched.editor.open(reopened, 0);
  assert.equal(relaunched.state.current?.phase, 'ready');
  assert.equal(relaunched.state.current?.previewUri, selected.fileUri);
  assert.deepEqual(relaunched.state.current?.effectiveRecipe, warmTiara);
  assert.equal(relaunched.renderAttempts, 0);
  relaunched.editor.close();

  const photosWrites: { uri: string; hash: string; statusDuringWrite: string | undefined }[] = [];
  const capability: PhotoLibraryCapability = { available: true, permission: 'granted', canAskAgain: false, writeOnly: true };
  const exporterFor = (repo: LocalRepository) => createPhotoExporter({
    capability: async () => capability,
    requestAddPermission: async () => { throw new Error('Permission is already granted at the Photos boundary'); },
    async save(uri) {
      const current = await repo.getSession(captured.id);
      photosWrites.push({ uri, hash: await digest(uri), statusDuringWrite: current?.shots.find(photo => photo.id === selected.id)?.exportStatus });
    },
  }, { get: id => repo.getSession(id), update: (id, photoId, status) => repo.updateExport(id, photoId, status) });
  await exporterFor(reopenedRepository).exportSession(reopened, { photoIds: [selected.id] });
  // Restart the exporter and repository, then retry with a stale caller snapshot.
  const finalRepository = f.makeRepository(); await finalRepository.recover();
  const exported = await exporterFor(finalRepository).exportSession(reopened, { photoIds: [selected.id] });
  assert.deepEqual(photosWrites, [{ uri: selected.fileUri, hash: approvedHash, statusDuringWrite: 'uncertain' }]);
  assert.equal(exported.shots[0]!.exportStatus, 'saved');

  const templateState = states<TemplateEditorState>();
  const inspections: { photoId: string; uri: string; hash: string }[][] = [];
  const templateRenders: { preview: boolean; sources: { photoId: string; uri: string; hash: string }[] }[] = [];
  const inspectBytes = async (sources: { photoId: string; uri: string }[]) =>
    Promise.all(sources.map(async source => ({ ...source, hash: await digest(source.uri) })));
  const templatePorts: TemplateEditorPorts = {
    id: () => f.id('template'),
    async inspectTemplateSources(sources) {
      const actual = await inspectBytes(sources); inspections.push(actual);
      return { version: 'wedding-template-v2', gridAspect: 'portrait', sources: actual.map(source => ({ photoId: source.photoId, sha256: source.hash, width: 960, height: 1200 })) };
    },
    async renderTemplate(sources, recipeJSON, preview, requestId) {
      const actual = await inspectBytes(sources); templateRenders.push({ preview, sources: actual });
      const recipe = JSON.parse(recipeJSON) as CompositeRecipe, dimensions = templateDimensions(recipe);
      const uri = f.uri(`cache-${requestId}.jpg`);
      await writeFile(fileURLToPath(uri), Buffer.from(`OPAQUE TEMPLATE BOUNDARY SUBSTITUTE\n${recipeJSON}\n`));
      return { uri, width: preview ? dimensions[0] / 3 : dimensions[0], height: preview ? dimensions[1] / 3 : dimensions[1],
        preview, version: recipe.version, recipeJSON, sourceHashes: Object.fromEntries(actual.map(source => [source.photoId, source.hash])) };
    },
    cancelTemplate() {}, releaseTemplate: f.release,
    loadSession: id => finalRepository.getSession(id), saveComposite: (id, input) => finalRepository.saveComposite(id, input),
    onState: value => templateState.update(value), onSession() {},
  };
  const templateEditor = createTemplateEditor(templatePorts);
  templateEditor.open(exported);
  await templateState.until(value => value.phase === 'ready' && Object.keys(value.themePreviews).length === 3);
  assert.equal(await templateEditor.save(), true);
  assert.equal(inspections.length, 1);
  assert.equal(templateRenders.length, 4, 'three theme previews and one full-size template boundary render');
  assert.equal(templateRenders.filter(render => !render.preview).length, 1);
  const selectedInput = { photoId: selected.id, uri: selected.fileUri, hash: approvedHash };
  for (const input of [inspections[0]!, ...templateRenders.map(render => render.sources)]) {
    assert.deepEqual(input.find(source => source.photoId === selected.id), selectedInput);
    assert.equal(input.some(source => source.photoId === 'raw-0'), false);
  }
  const composed = (await finalRepository.getSession(captured.id))!;
  assert.ok(composed.composite);
  assert.deepEqual(composed.composite.recipe.photoIds, exported.shots.map(photo => photo.id));
  assert.deepEqual(composed.composite.originalPhotoIds, ['raw-0', 'raw-1', 'raw-2', 'raw-3']);
  assert.equal((await finalRepository.confirmSession(captured.id)).confirmed, true);
  const assets = await finalRepository.getSessionPublicationAssets(captured.id);
  assert.deepEqual(assets.photoIds, exported.shots.map(photo => photo.id));
  assert.deepEqual(assets.originalPhotoIds, ['raw-0', 'raw-1', 'raw-2', 'raw-3']);
  assert.equal(assets.photoIds[0], selected.id);
  assert.notEqual(assets.photoIds[0], assets.originalPhotoIds[0]);
  assert.equal(assets.composite?.photoId, composed.composite.id);

  const uploads: { id: string; uri: string; hash: string }[] = [];
  let shares = 0;
  const transport: QueueTransport = {
    async upload(job) { uploads.push({ id: job.photoId, uri: job.fileUri, hash: await digest(job.fileUri) }); },
    async share() { shares++; throw new Error('No SMS/share jobs are authorized in this flow'); },
  };
  const consumer = createQueueConsumer(f.store, transport, undefined, () => 1000, () => finalRepository.reconcileConfirmedPhotos());
  await consumer.sync(); await consumer.sync();
  const expectedUploadIds = [...assets.photoIds, 'raw-0', composed.composite.id].sort();
  assert.deepEqual(uploads.map(upload => upload.id).sort(), expectedUploadIds);
  assert.deepEqual(uploads.find(upload => upload.id === selected.id), { id: selected.id, uri: selected.fileUri, hash: approvedHash });
  assert.ok(uploads.every(upload => upload.uri.startsWith(f.uri('photobooth/'))));
  assert.ok(uploads.every(upload => upload.uri !== approved.previewUri && upload.uri !== unapplied.uri));
  assert.equal(shares, 0);
  assert.ok([...f.jobs.values()].every(job => job.kind === 'upload' && job.state === 'complete'));
  await assertOriginalsUnchanged(f);
  await f.flushReleases();
  t.diagnostic(`Approved cache/durable/Photos/template/upload SHA-256: ${approvedHash}`);
});

test('closing the generation during an actual cache copy cannot select or publish its retained treatment on recovery', async t => {
  const f = await diskFixture(t), repository = f.makeRepository();
  const captured = await f.captureFour(repository), h = treatmentEditor(f, repository);
  const { approved } = await h.chooseWarmTiara(captured), approvedHash = await digest(approved.previewUri);
  const copied = deferred<{ destination: string; hash: string }>(), resumeCopy = deferred<void>();
  const copy = f.files.copy;
  f.files.copy = async (source, destination) => {
    await copy(source, destination);
    if (source === approved.previewUri) {
      // Actual bytes exist, while the repository is still awaiting this copy call.
      copied.resolve({ destination, hash: await digest(f.uri(destination)) });
      await resumeCopy.promise;
    }
  };
  const applying = h.editor.apply();
  const reached = await Promise.race([copied.promise, applying.then(() => { throw new Error('Apply ended before the actual copy boundary'); })]);
  const input = h.saved[0]!;
  const admittedBeforeClose = input.admit?.();
  h.editor.close();
  const admittedAfterClose = input.admit?.(), stateAfterClose = h.state.current;
  const cacheRetainedDuringCopy = (await f.files.stat(approved.previewUri)).exists;
  resumeCopy.resolve();
  const applied = await applying; f.files.copy = copy;
  assert.equal(reached.hash, approvedHash);
  assert.match(reached.destination, /^photobooth\/treatment-[0-9]+\.partial$/);
  assert.equal(admittedBeforeClose, true);
  assert.equal(admittedAfterClose, false, 'the controller generation guard reaches actual persistence');
  assert.equal(stateAfterClose, null);
  assert.equal(cacheRetainedDuringCopy, true, 'close must not delete the cache being copied');
  assert.equal(applied, false);
  assert.equal(h.sessions.length, 0, 'a revoked generation cannot acknowledge a selection');
  assert.equal((await repository.getSession(captured.id))?.shots[0]!.id, 'raw-0');

  const reopenedRepository = f.makeRepository();
  await reopenedRepository.recover(); await reopenedRepository.retryStagedPhotos(captured.id);
  const recovered = (await reopenedRepository.getSession(captured.id))!;
  assert.equal(recovered.confirmed, false);
  assert.deepEqual(recovered.shots.map(photo => photo.id), ['raw-0', 'raw-1', 'raw-2', 'raw-3']);
  const retained = recovered.retakes?.find(photo => photo.id === input.id);
  assert.ok(retained, 'recovery retains host-recoverable bytes without automatically selecting them');
  assert.equal(retained.sourcePhotoId, 'raw-0');
  assert.deepEqual(retained.treatment, warmTiara);
  assert.equal(await digest(retained.fileUri), approvedHash);
  assert.equal(f.jobs.size, 0);
  const relaunched = treatmentEditor(f, reopenedRepository, true);
  relaunched.editor.open(recovered, 0);
  assert.equal(relaunched.state.current?.phase, 'ready');
  assert.equal(relaunched.state.current?.previewUri, captured.shots[0]!.fileUri);
  assert.equal(relaunched.state.current?.faceAccessory, 'none');
  assert.equal(relaunched.renderAttempts, 0);
  relaunched.editor.close();
  await assertOriginalsUnchanged(f); await f.flushReleases();
});
