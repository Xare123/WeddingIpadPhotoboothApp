// Owner-operated handoff only. Importing this module performs no I/O or setup.
import * as filesystem from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';

export const OWNER_ORIGIN = 'https://photos.gizelleandrami.com';
export const PAIRING_ENDPOINT = OWNER_ORIGIN + '/v1/pairing/codes';
export const RESPONSE_LIMIT = 8192, REQUEST_DEADLINE_MS = 10_000;
const FILES = ['PAIRING_CODE', 'ISSUANCE.json', 'ISSUED.json'];
const HEX = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class OwnerSetupError extends Error {
  constructor(category) { super(category); this.name = 'OwnerSetupError'; this.category = category; }
}
const fail = category => { throw new OwnerSetupError(category); };

export function validateIssuedReply(response, now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('invalid-reply');
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) fail('request-uncertain');
  if (response.status !== 200) fail('http-' + response.status);
  if (!Buffer.isBuffer(response.body) || response.body.length > RESPONSE_LIMIT) fail('invalid-reply');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); } catch { fail('invalid-reply'); }
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== 'code,expiresAt,origin,status' ||
      value.status !== 'issued' || value.origin !== OWNER_ORIGIN || typeof value.code !== 'string' || !HEX.test(value.code) ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 15 * 60_000) fail('invalid-reply');
  return value;
}

/** One native HTTPS request; no fetch, redirect handling, proxy override or retry.
 * Inject requestImpl in offline tests; it must implement Node ClientRequest events.
 */
export function requestPairingCode(token, id, { requestImpl = httpsRequest, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolveReply, reject) => {
    let request, timer, settled = false;
    const finish = (error, reply) => {
      if (settled) return; settled = true; clearTimer(timer);
      if (error) { request?.destroy(); reject(new OwnerSetupError('request-uncertain')); }
      else resolveReply(reply);
    };
    timer = setTimer(() => finish(true), REQUEST_DEADLINE_MS);
    try {
      const body = JSON.stringify({ id });
      request = requestImpl(PAIRING_ENDPOINT, { method: 'POST', agent: false, rejectUnauthorized: true, maxHeaderSize: RESPONSE_LIMIT,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
        const chunks = []; let bytes = 0;
        response.on('error', () => finish(true)); response.on('aborted', () => finish(true));
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > RESPONSE_LIMIT) { response.destroy(); finish(true); }
          else if (!settled) chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => finish(false, { status: response.statusCode, body: Buffer.concat(chunks) }));
      });
      request.on('error', () => finish(true)); request.end(body);
    } catch { finish(true); }
  });
}

/** Filesystem port is Node fs's sync API; all paths are private owner paths.
 * Tests inject synthetic token/id suppliers and fake transport. Never log return
 * values from validateIssuedReply or read a production credential in tests.
 */
export function createOwnerSetup({ fs = filesystem, token = () => randomBytes(32).toString('hex'),
  id = randomUUID, transport = requestPairingCode, now = Date.now, uid = () => process.getuid() } = {}) {
  const exists = path => { try { fs.lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; fail('unsafe-path'); } };
  function ancestors(path) {
    if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_DIRECTORY)) fail('unsafe-path');
    if (typeof path !== 'string' || !isAbsolute(path) || path !== resolve(path)) fail('unsafe-path');
    for (let current = path;; current = dirname(current)) {
      const git = join(current, '.git');
      if (exists(git)) {
        const marker = fs.lstatSync(git);
        // Exact managed-platform protection directories only, never a real or
        // unborn repository. Owner machines normally have neither directory.
        const protection = ['/tmp/.git', '/workspace/.git'].includes(git) && marker.isDirectory() && !marker.isSymbolicLink() &&
          (marker.mode & 0o222) === 0 && fs.readdirSync(git).length === 0;
        if (!protection) fail('git-checkout-refused');
      }
      if (exists(current)) { const s = fs.lstatSync(current); if (s.isSymbolicLink() || !s.isDirectory()) fail('unsafe-path'); }
      if (current === dirname(current)) break;
    }
  }
  function folder(path) {
    ancestors(path);
    const s = fs.lstatSync(path);
    if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o7777) !== 0o700 || s.uid !== uid()) fail('private-permissions');
    return s;
  }
  function file(path) {
    const s = fs.lstatSync(path);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || s.uid !== uid()) fail('private-permissions');
    return s;
  }
  function unchanged(path, before) {
    const after = folder(path);
    if (before.dev !== after.dev || before.ino !== after.ino) fail('unsafe-path');
  }
  function write(path, name, value, before) {
    unchanged(path, before);
    let fd;
    try {
      fd = fs.openSync(join(path, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, value); fs.fsyncSync(fd); file(join(path, name)); unchanged(path, before);
      const directory = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch (e) { if (e instanceof OwnerSetupError) throw e; fail(e.code === 'EEXIST' ? 'already-exists' : 'write-failed'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function readToken(path) {
    const target = join(path, 'DEVICE_TOKEN'), before = file(target);
    if (before.size < 64 || before.size > 65) fail('private-permissions');
    let fd;
    try {
      fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const current = fs.fstatSync(fd);
      if (current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size || current.uid !== uid() || (current.mode & 0o7777) !== 0o600 || current.nlink !== 1) fail('unsafe-path');
      const bytes = Buffer.alloc(66), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      const after = fs.fstatSync(fd);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.uid !== uid() || (after.mode & 0o7777) !== 0o600 || after.nlink !== 1) fail('unsafe-path');
      const value = bytes.subarray(0, length).toString('utf8');
      if (!/^[a-f0-9]{64}\n?$/.test(value)) fail('private-permissions');
      return value.trim();
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return {
    prepare(path) {
      ancestors(path); if (exists(path)) fail('already-exists');
      // This is the ONLY production key-generation call, reached by owner prepare.
      fs.mkdirSync(path, { mode: 0o700 }); const before = folder(path), value = token();
      if (typeof value !== 'string' || !HEX.test(value)) fail('invalid-token-generator');
      write(path, 'DEVICE_TOKEN', value + '\n', before);
    },
    async issue(path) {
      const before = folder(path);
      if (FILES.some(name => exists(join(path, name)))) fail('existing-issuance-manual-review-required');
      const secret = readToken(path), issuance = id();
      if (typeof issuance !== 'string' || !UUID.test(issuance)) fail('invalid-issuance-id');
      // Durable reservation precedes the request. Lost replies/write failures leave
      // this marker, so rerunning issue cannot accidentally make another request.
      write(path, 'ISSUANCE.json', JSON.stringify({ schemaVersion: 1, id: issuance, attemptedAt: now(), origin: OWNER_ORIGIN }) + '\n', before);
      let response;
      try { response = await transport(secret, issuance); } catch { fail('request-uncertain'); }
      const value = validateIssuedReply(response, now());
      write(path, 'PAIRING_CODE', value.code + '\n', before);
      write(path, 'ISSUED.json', JSON.stringify({ schemaVersion: 1, id: issuance, origin: OWNER_ORIGIN, expiresAt: value.expiresAt }) + '\n', before);
    },
    cleanup(path) {
      const before = folder(path);
      for (const name of FILES) if (exists(join(path, name))) {
        file(join(path, name)); unchanged(path, before); fs.unlinkSync(join(path, name));
      }
      // DEVICE_TOKEN and unknown files are intentionally preserved. No network.
    },
  };
}

export async function ownerCLI(args, { input = process.stdin, output = process.stdout,
  setup = createOwnerSetup() } = {}) {
  const [action, path] = args;
  const status = text => output.write(text + '\n');
  try {
    if (!input.isTTY || !output.isTTY) fail('owner-tty-required');
    if (args.length !== 2 || !['prepare', 'issue', 'cleanup'].includes(action)) fail('usage');
    // The explicit owner command is the action; TTY is only a local-use guard,
    // never proof of a human or authorization to bypass connector policy.
    await setup[action](path); status(action.toUpperCase() + '_COMPLETE'); return 0;
  } catch (e) {
    const allowed = new Set(['owner-tty-required', 'usage', 'unsafe-path', 'git-checkout-refused', 'private-permissions',
      'already-exists', 'write-failed', 'invalid-token-generator', 'invalid-issuance-id',
      'existing-issuance-manual-review-required', 'request-uncertain', 'invalid-reply']);
    const category = e instanceof OwnerSetupError && (allowed.has(e.category) || /^http-[1-5][0-9]{2}$/.test(e.category))
      ? e.category : 'local-operation-failed';
    status('FAILED:' + category); return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await ownerCLI(process.argv.slice(2));
}
