// Offline only: every prepare injects a SYNTHETIC credential generator; no real
// production randomness, HTTPS, owner CLI prepare entrypoint or private input.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createOwnerSetup, ownerCLI, OwnerSetupError, OWNER_ORIGIN, PAIRING_ENDPOINT,
  REQUEST_DEADLINE_MS, RESPONSE_LIMIT, requestPairingCode, validateIssuedReply } from './owner-private-setup.mjs';
const TOKEN = '0123456789abcdef'.repeat(4), CODE = 'fedcba9876543210'.repeat(4);
const ID = '12345678-1234-4234-9234-123456789abc', NOW = 1_800_000_000_000;
const reply = (value = {}) => ({ status: 200, body: Buffer.from(JSON.stringify({ status: 'issued', code: CODE,
  expiresAt: NOW + 300_000, origin: OWNER_ORIGIN, ...value })) });
function fixture(t, overrides = {}) {
  const parent = fs.mkdtempSync(join(tmpdir(), 'owner-setup-offline-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const path = join(parent, 'private'), calls = [];
  const setup = createOwnerSetup({ token: () => TOKEN, id: () => ID, now: () => NOW,
    transport: async (token, id) => { calls.push({ token, id }); return reply(); }, ...overrides });
  return { parent, path, setup, calls };
}
function mockedRequest(run) {
  let count = 0, options, url, sent, destroyed = 0;
  return { get count() { return count; }, get options() { return options; }, get url() { return url; },
    get sent() { return sent; }, get destroyed() { return destroyed; },
    requestImpl(target, opts, onResponse) {
      count++; url = target; options = opts; const request = new EventEmitter();
      request.destroy = () => { destroyed++; }; request.end = body => { sent = body; queueMicrotask(() => run(onResponse, request)); };
      return request;
    } };
}
function response(status = 200) { const r = new EventEmitter(); r.statusCode = status; r.destroy = () => {}; return r; }

test('synthetic prepare creates a new private directory and exclusive owner-only file, without exposing credentials', t => {
  const f = fixture(t); f.setup.prepare(f.path);
  assert.equal(fs.statSync(f.path).mode & 0o777, 0o700);
  assert.equal(fs.statSync(join(f.path, 'DEVICE_TOKEN')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(join(f.path, 'DEVICE_TOKEN'), 'utf8'), TOKEN + '\n');
  assert.throws(() => f.setup.prepare(f.path), /already-exists/); assert.equal(f.calls.length, 0);
});
test('every real or unborn git directory/file in any ancestor refuses prepare before generation', t => {
  for (const kind of ['file', 'empty', 'nonempty']) {
    const f = fixture(t, { token() { throw Error('generator must not run'); } }); const git = join(f.parent, '.git');
    if (kind === 'file') fs.writeFileSync(git, 'gitdir: elsewhere');
    else { fs.mkdirSync(git); if (kind === 'nonempty') fs.writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/new'); }
    assert.throws(() => f.setup.prepare(f.path), /git-checkout-refused/); assert.equal(fs.existsSync(f.path), false);
  }
});
test('only exact empty read-only managed protection markers are exempt, writable/nonempty markers never are', () => {
  const base = '/tmp/.git', fake = extra => ({ ...fs,
    // This fixture models a managed Linux /tmp, not the host's /tmp symlink on macOS.
    lstatSync(path) { if (path === '/tmp') return { isDirectory: () => true, isSymbolicLink: () => false }; if (path === base) return { isDirectory: () => true, isSymbolicLink: () => false, mode: extra.mode }; return fs.lstatSync(path); },
    readdirSync(path) { return path === base ? extra.entries : fs.readdirSync(path); },
    mkdirSync() { throw new OwnerSetupError('write-failed'); } });
  for (const extra of [{ mode: 0o755, entries: [] }, { mode: 0o555, entries: ['HEAD'] }]) {
    assert.throws(() => createOwnerSetup({ fs: fake(extra), token: () => TOKEN }).prepare('/tmp/never-created-by-this-test'), /git-checkout-refused/);
  }
  assert.throws(() => createOwnerSetup({ fs: fake({ mode: 0o555, entries: [] }), token: () => TOKEN }).prepare('/tmp/never-created-by-this-test'), /write-failed/);
});
test('prepare refuses relative, normalized traversal, ancestor symlinks and existing destinations', t => {
  const f = fixture(t); fs.symlinkSync(f.parent, join(f.parent, 'alias'));
  for (const path of ['relative', f.path + '/../private', join(f.parent, 'alias', 'new'), f.parent]) assert.throws(() => f.setup.prepare(path));
  assert.equal(fs.existsSync(f.path), false);
});
test('issue prechecks every old code/marker before any request, and preserves existing bytes', async t => {
  for (const name of ['PAIRING_CODE', 'ISSUANCE.json', 'ISSUED.json']) {
    const f = fixture(t); f.setup.prepare(f.path); fs.writeFileSync(join(f.path, name), 'synthetic-existing', { mode: 0o600 });
    await assert.rejects(f.setup.issue(f.path), /existing-issuance/); assert.equal(f.calls.length, 0);
    assert.equal(fs.readFileSync(join(f.path, name), 'utf8'), 'synthetic-existing');
  }
});
test('successful offline issue sends only token and fresh ID through its port; code and nonsecret metadata stay private', async t => {
  const f = fixture(t); f.setup.prepare(f.path); await f.setup.issue(f.path);
  assert.deepEqual(f.calls, [{ token: TOKEN, id: ID }]);
  assert.equal(fs.readFileSync(join(f.path, 'PAIRING_CODE'), 'utf8'), CODE + '\n');
  for (const name of ['PAIRING_CODE', 'ISSUANCE.json', 'ISSUED.json']) assert.equal(fs.statSync(join(f.path, name)).mode & 0o777, 0o600);
  for (const name of ['ISSUANCE.json', 'ISSUED.json']) { const text = fs.readFileSync(join(f.path, name), 'utf8'); assert.ok(!text.includes(TOKEN) && !text.includes(CODE)); }
  await assert.rejects(f.setup.issue(f.path), /existing-issuance/); assert.equal(f.calls.length, 1);
});
test('unsafe directory/key permissions, key symlink and hardlink refuse before network', async t => {
  for (const kind of ['folder', 'mode', 'symlink', 'hardlink']) {
    const f = fixture(t); f.setup.prepare(f.path); const key = join(f.path, 'DEVICE_TOKEN');
    if (kind === 'folder') fs.chmodSync(f.path, 0o755);
    if (kind === 'mode') fs.chmodSync(key, 0o644);
    if (kind === 'symlink') { fs.renameSync(key, join(f.parent, 'outside')); fs.symlinkSync(join(f.parent, 'outside'), key); }
    if (kind === 'hardlink') fs.linkSync(key, join(f.parent, 'copy'));
    await assert.rejects(f.setup.issue(f.path), /private-permissions/); assert.equal(f.calls.length, 0);
  }
});
test('invalid and oversized key files never reach network', async t => {
  for (const text of ['secret', 'g'.repeat(64), TOKEN + '\nextra', TOKEN.repeat(100)]) {
    const f = fixture(t); f.setup.prepare(f.path); fs.writeFileSync(join(f.path, 'DEVICE_TOKEN'), text);
    await assert.rejects(f.setup.issue(f.path)); assert.equal(f.calls.length, 0);
  }
});
test('lost reply leaves an fsynced marker and never automatically retries', async t => {
  let calls = 0; const f = fixture(t, { async transport() { calls++; throw Error(TOKEN + CODE); } });
  f.setup.prepare(f.path); await assert.rejects(f.setup.issue(f.path), /^OwnerSetupError: request-uncertain$/);
  assert.equal(fs.existsSync(join(f.path, 'ISSUANCE.json')), true);
  await assert.rejects(f.setup.issue(f.path), /existing-issuance/); assert.equal(calls, 1);
});
test('reply validation rejects redirects, status/schema/code/origin/expiry/UTF8/bounds failures', () => {
  assert.equal(validateIssuedReply(reply(), NOW).code, CODE);
  assert.throws(() => validateIssuedReply(reply(), NaN), /invalid-reply/);
  for (const value of [{ status: 'ready' }, { code: 'bad' }, { code: [CODE] }, { origin: OWNER_ORIGIN + '/' },
    { origin: 'https://alternate.example' }, { expiresAt: NOW }, { expiresAt: NOW + 900_001 }, { expiresAt: NOW + 1.5 }, { extra: true }]) {
    assert.throws(() => validateIssuedReply(reply(value), NOW), /invalid-reply/);
  }
  for (const status of [301, 302, 307, 308, 401, 500]) assert.throws(() => validateIssuedReply({ ...reply(), status }, NOW), new RegExp('http-' + status));
  for (const body of [Buffer.alloc(RESPONSE_LIMIT + 1), Buffer.from([0xff]), Buffer.from('null'), Buffer.from('[]')]) assert.throws(() => validateIssuedReply({ status: 200, body }, NOW), /invalid-reply/);
});
test('a partial code write or final metadata failure preserves the marker and cannot trigger another request', async t => {
  for (const failedWrite of [2, 3]) {
    let writes = 0, calls = 0; const f = fixture(t);
    f.setup.prepare(f.path);
    const setup = createOwnerSetup({ fs: { ...fs, writeFileSync(fd, value) {
      writes++; if (writes === failedWrite) { fs.writeFileSync(fd, String(value).slice(0, 8)); throw Error(TOKEN); } fs.writeFileSync(fd, value);
    } }, id: () => ID, now: () => NOW, transport: async () => { calls++; return reply(); } });
    await assert.rejects(setup.issue(f.path), /write-failed/); assert.equal(calls, 1);
    await assert.rejects(setup.issue(f.path), /existing-issuance/); assert.equal(calls, 1);
    assert.equal(fs.readFileSync(join(f.path, 'DEVICE_TOKEN'), 'utf8'), TOKEN + '\n');
  }
});
test('cleanup removes only known local pairing artifacts, retaining device key, unknown files and no network', async t => {
  const f = fixture(t); f.setup.prepare(f.path); await f.setup.issue(f.path);
  fs.writeFileSync(join(f.path, 'owner-backup'), 'keep'); f.setup.cleanup(f.path); f.setup.cleanup(f.path);
  for (const name of ['PAIRING_CODE', 'ISSUANCE.json', 'ISSUED.json']) assert.equal(fs.existsSync(join(f.path, name)), false);
  assert.equal(fs.readFileSync(join(f.path, 'DEVICE_TOKEN'), 'utf8'), TOKEN + '\n');
  assert.equal(fs.readFileSync(join(f.path, 'owner-backup'), 'utf8'), 'keep'); assert.equal(f.calls.length, 1);
});
test('cleanup refuses an unsafe code symlink and never deletes its target', t => {
  const f = fixture(t); f.setup.prepare(f.path); const outside = join(f.parent, 'outside'); fs.writeFileSync(outside, 'keep');
  fs.symlinkSync(outside, join(f.path, 'PAIRING_CODE')); assert.throws(() => f.setup.cleanup(f.path), /private-permissions/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
});
test('native HTTPS port fixes exact URL/method/TLS/header/body; redirects never issue another request', async () => {
  for (const status of [200, 302]) {
    const port = mockedRequest(callback => { const r = response(status); callback(r); r.emit('data', reply().body); r.emit('end'); });
    const result = await requestPairingCode(TOKEN, ID, port);
    assert.equal(port.url, PAIRING_ENDPOINT); assert.equal(port.options.method, 'POST'); assert.equal(port.options.rejectUnauthorized, true); assert.equal(port.options.maxHeaderSize, RESPONSE_LIMIT);
    assert.equal(port.options.agent, false); assert.equal(port.options.headers.Authorization, 'Bearer ' + TOKEN);
    assert.deepEqual(JSON.parse(port.sent), { id: ID }); assert.equal(port.count, 1); assert.equal(result.status, status);
  }
});
test('native HTTPS port bounds response, handles abort/raw errors, and rejects after its exact wall deadline without retry', async () => {
  for (const mode of ['large', 'abort', 'error', 'timeout']) {
    let deadline;
    const port = mockedRequest((callback, req) => {
      if (mode === 'timeout') { deadline(); return; }
      if (mode === 'error') { req.emit('error', Error(TOKEN)); return; }
      const r = response(); callback(r); if (mode === 'abort') r.emit('aborted'); else r.emit('data', Buffer.alloc(RESPONSE_LIMIT + 1));
    });
    await assert.rejects(requestPairingCode(TOKEN, ID, { ...port, requestImpl: port.requestImpl,
      setTimer(fn, ms) { assert.equal(ms, REQUEST_DEADLINE_MS); deadline = fn; return 1; }, clearTimer() {} }), /^OwnerSetupError: request-uncertain$/);
    assert.equal(port.count, 1); assert.ok(port.destroyed >= 1);
  }
});
test('CLI refuses nonTTY and invalid usage before any setup action; fixed statuses never print secrets, paths or raw errors', async () => {
  let called = 0, text = ''; const setup = { prepare() { called++; throw Error(TOKEN + CODE + '/private/path'); } };
  const output = { isTTY: true, write(value) { text += value; } };
  assert.equal(await ownerCLI(['prepare', '/private/path'], { input: { isTTY: false }, output, setup }), 1);
  assert.equal(called, 0); assert.equal(text, 'FAILED:owner-tty-required\n'); text = '';
  assert.equal(await ownerCLI(['prepare', '/private/path'], { input: { isTTY: true }, output, setup }), 1);
  assert.equal(text, 'FAILED:local-operation-failed\n'); assert.equal(called, 1);
  for (const secret of [TOKEN, CODE, '/private/path']) assert.ok(!text.includes(secret));
  text = ''; await ownerCLI(['issue', '/private/path', TOKEN], { input: { isTTY: true }, output, setup }); assert.equal(text, 'FAILED:usage\n');
});
test('import is inert: no CLI execution, networking, credential generation or output', () => {
  const url = new URL('./owner-private-setup.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('reservation fsync failure stops before network; unsafe platform nofollow support refuses before generation', async t => {
  const f = fixture(t); f.setup.prepare(f.path); let calls = 0;
  const setup = createOwnerSetup({ fs: { ...fs, fsyncSync() { throw Error(TOKEN); } },
    id: () => ID, now: () => NOW, transport: async () => { calls++; return reply(); } });
  await assert.rejects(setup.issue(f.path), /write-failed/); assert.equal(calls, 0);
  assert.equal(fs.existsSync(join(f.path, 'ISSUANCE.json')), true);
  const unsupported = createOwnerSetup({ fs: { ...fs, constants: { ...fs.constants, O_NOFOLLOW: undefined } }, token() { throw Error('must not generate'); } });
  assert.throws(() => unsupported.prepare(join(f.parent, 'unsupported')), /unsafe-path/);
});
