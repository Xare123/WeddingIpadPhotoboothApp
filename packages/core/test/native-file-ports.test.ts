import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeFilePorts, type NativePhotoFile } from '../../../apps/ipad/src/native-file-ports';
import { LocalRepository } from '../../../apps/ipad/src/local-persistence';

type Operation = 'copy' | 'move' | 'write' | 'read' | 'directory' | 'list';
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeFixture() {
  const disk = new Map<string, Uint8Array>();
  const gates: Partial<Record<Operation, ReturnType<typeof deferred>>> = {};
  const calls: string[] = [];
  const faults = { truncateNextCopy: false };
  const uri = (relative: string) => 'file:///documents/' + relative;
  disk.set('file:///cache/camera.jpg', new Uint8Array([255, 216, 1, 2, 255, 217]));
  class NativeFile implements NativePhotoFile<NativeFile> {
    constructor(readonly uri: string) {}
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return disk.has(this.uri); }
    get size() { return disk.get(this.uri)?.byteLength ?? null; }
    async copy(destination: NativeFile, options?: { overwrite?: boolean }) {
      calls.push('copy'); await gates.copy?.promise;
      const source = disk.get(this.uri); if (!source) throw new Error('Missing native source');
      if (disk.has(destination.uri) && !options?.overwrite) throw new Error('Native destination exists');
      if (faults.truncateNextCopy) {
        faults.truncateNextCopy = false;
        disk.set(destination.uri, source.slice(0, 2));
        throw new Error('Native copy interrupted by disk full');
      }
      disk.set(destination.uri, source.slice());
    }
    async move(destination: NativeFile) {
      calls.push('move'); await gates.move?.promise;
      const source = disk.get(this.uri); if (!source) throw new Error('Missing native source');
      if (disk.has(destination.uri)) throw new Error('Native destination exists');
      disk.set(destination.uri, source); disk.delete(this.uri);
    }
    async write(text: string) { calls.push('write'); await gates.write?.promise; disk.set(this.uri, new TextEncoder().encode(text)); }
    async text() { calls.push('read'); await gates.read?.promise; return new TextDecoder().decode(disk.get(this.uri)); }
  }
  const ports = createNativeFilePorts<NativeFile>({ uri, file: path => new NativeFile(path),
    directory: {
      async create() { calls.push('directory'); await gates.directory?.promise; },
      async list() { calls.push('list'); await gates.list?.promise; return [...disk.keys()].filter(path => path.startsWith(uri('photobooth/'))).map(path => new NativeFile(path)); },
    }, isFile: (entry): entry is NativeFile => entry instanceof NativeFile,
  });
  return { disk, gates, calls, faults, ports, uri };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

for (const operation of ['copy', 'move', 'write'] as const) {
  test('production file adapter waits for deferred native ' + operation + ' before resolving', async () => {
    const f = nativeFixture(); f.gates[operation] = deferred();
    f.disk.set(f.uri('photobooth/source.jpg'), new Uint8Array([1, 2, 3]));
    let complete = false;
    const pending = (operation === 'copy' ? f.ports.copy('file:///cache/camera.jpg', 'photobooth/target.jpg') :
      operation === 'move' ? f.ports.move('photobooth/source.jpg', 'photobooth/target.jpg') :
      f.ports.write('photobooth/target.jpg', 'journal')).then(() => { complete = true; });
    await flush();
    assert.equal(complete, false);
    assert.equal((await f.ports.stat(f.uri('photobooth/target.jpg'))).exists, false);
    f.gates[operation]!.resolve(); await pending;
    assert.equal(complete, true);
    assert.equal((await f.ports.stat(f.uri('photobooth/target.jpg'))).exists, true);
  });
  test('production file adapter propagates rejected native ' + operation + ' without a detached rejection', async () => {
    const f = nativeFixture(); f.gates[operation] = deferred();
    f.disk.set(f.uri('photobooth/source.jpg'), new Uint8Array([1, 2, 3]));
    const pending = operation === 'copy' ? f.ports.copy('file:///cache/camera.jpg', 'photobooth/target.jpg') :
      operation === 'move' ? f.ports.move('photobooth/source.jpg', 'photobooth/target.jpg') : f.ports.write('photobooth/target.jpg', 'journal');
    const checked = assert.rejects(pending, /native operation rejected/);
    f.gates[operation]!.reject(new Error('native operation rejected'));
    await checked;
    assert.equal((await f.ports.stat(f.uri('photobooth/target.jpg'))).exists, false);
  });
}

test('production adapter also adopts directory creation/list and asynchronous text reads', async () => {
  const f = nativeFixture(); f.gates.directory = deferred(); f.gates.list = deferred(); f.gates.read = deferred();
  let created = false, listed = false, read = false;
  const creating = f.ports.ensureDirectory().then(() => { created = true; });
  f.disk.set(f.uri('photobooth/record.json'), new TextEncoder().encode('{"saved":true}'));
  const listing = f.ports.list().then(names => { listed = true; return names; });
  const reading = f.ports.read('photobooth/record.json').then(text => { read = true; return text; });
  await flush(); assert.deepEqual([created, listed, read], [false, false, false]);
  f.gates.directory.resolve(); f.gates.list.resolve(); f.gates.read.resolve();
  await creating; assert.deepEqual(await listing, ['record.json']); assert.equal(await reading, '{"saved":true}');
});

test('repository cannot acknowledge or read back a capture ahead of deferred production-native writes', async () => {
  const f = nativeFixture(); f.gates.write = deferred();
  let nonce = 0, created = false;
  const repository = new LocalRepository(f.ports, { async read() { return null; }, async write() {}, async ensureJob() {} }, () => 'nonce-' + ++nonce, () => 1000);
  const creating = repository.createSession('session').then(value => { created = true; return value; });
  await flush(); assert.equal(created, false, 'session journal must finish native writing before readback');
  f.gates.write.resolve(); const session = await creating;
  f.gates.copy = deferred();
  let acknowledged = false;
  const saving = repository.saveShot(session, 'photo', 'file:///cache/camera.jpg', 0).then(value => { acknowledged = true; return value; });
  await flush(); assert.equal(acknowledged, false); assert.ok(f.calls.includes('copy'));
  f.gates.copy.resolve(); const saved = await saving;
  assert.equal(acknowledged, true); assert.equal(saved.shots.length, 1);
  assert.equal((await f.ports.stat(saved.shots[0]!.fileUri)).size, 6);
});

test('same-photo retry replaces only its truncated native staging file and commits the complete original', async () => {
  const f = nativeFixture(); let nonce = 0;
  const repository = new LocalRepository(f.ports, { async read() { return null; }, async write() {}, async ensureJob() {} }, () => 'nonce-' + ++nonce, () => 1000);
  const session = await repository.createSession('session');
  f.faults.truncateNextCopy = true;
  await assert.rejects(repository.saveShot(session, 'same-photo', 'file:///cache/camera.jpg', 0), /original-copy/);
  assert.equal((await f.ports.stat(f.uri('photobooth/same-photo.partial'))).size, 2);
  const saved = await repository.saveShot(session, 'same-photo', 'file:///cache/camera.jpg', 0);
  assert.equal(saved.shots.length, 1);
  assert.equal(saved.shots[0]?.id, 'same-photo');
  assert.equal((await f.ports.stat(saved.shots[0]!.fileUri)).size, 6);
  assert.deepEqual(f.disk.get(saved.shots[0]!.fileUri), f.disk.get('file:///cache/camera.jpg'));
});

test('native copy retains no-overwrite behavior for originals, drafts and non-owned staging paths', async () => {
  const f = nativeFixture();
  for (const path of ['photobooth/original.jpg', 'photobooth/retake.draft.jpg', 'photobooth/not-owned.name.partial', 'other/photo.partial']) {
    const original = new Uint8Array([9, 8, 7]);
    f.disk.set(f.uri(path), original);
    await assert.rejects(f.ports.copy('file:///cache/camera.jpg', path), /destination exists/);
    assert.deepEqual(f.disk.get(f.uri(path)), original);
  }
});
