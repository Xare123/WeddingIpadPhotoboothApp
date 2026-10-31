import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const marker = Buffer.from('preserveFullPhotoAvailable');
const macho = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
const maxBytes = 512 * 1024 * 1024;

// A JS reference to the capability is not proof that patched native code was
// linked. Inspect only the app executable and the specific camera framework.
export function verifyNativeCameraMarker(directory, info) {
  const executable = info?.CFBundleExecutable;
  if (typeof executable !== 'string' || !executable || basename(executable) !== executable ||
    !/^[A-Za-z0-9_.-]+$/.test(executable) || executable === '.' || executable === '..') {
    throw new Error('Native camera marker requires a valid app executable name');
  }
  const root = realpathSync(directory);
  const paths = [join(root, executable), join(root, 'Frameworks', 'ExpoCamera.framework', 'ExpoCamera')];
  const scanned = [];
  for (const [index, candidate] of paths.entries()) {
    if (index > 0 && !existsSync(candidate)) continue;
    const file = realpathSync(candidate), stat = statSync(file);
    if (!file.startsWith(root + sep) || !stat.isFile() || stat.size < 4 || stat.size > maxBytes) {
      throw new Error('Native camera marker input is not a bounded app-owned binary');
    }
    const fd = openSync(file, 'r'), buffer = Buffer.allocUnsafe(64 * 1024), digest = createHash('sha256');
    let offset = 0, tail = Buffer.alloc(0), found = false;
    try {
      let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
        const part = buffer.subarray(0, count);
        if (offset === 0 && !macho.has(part.subarray(0, 4).toString('hex'))) {
          throw new Error('Native camera marker input is not a Mach-O binary');
        }
        digest.update(part);
        found ||= Buffer.concat([tail, part]).includes(marker);
        tail = Buffer.from(part.subarray(Math.max(0, part.length - marker.length + 1)));
        offset += count;
        if (offset > maxBytes) throw new Error('Native camera binary changed during inspection');
      }
    } finally { closeSync(fd); }
    if (offset !== stat.size || statSync(file).size !== stat.size) throw new Error('Native camera binary changed during inspection');
    scanned.push({ file: relative(root, file), bytes: offset, sha256: digest.digest('hex'), markerFound: found });
  }
  if (!scanned.some(file => file.markerFound)) {
    throw new Error('Patched camera native marker is absent; check the expo-camera source-build opt-out and rebuild');
  }
  return { marker: marker.toString(), compiledMarkerFound: true, scanned,
    scope: 'Native linked marker presence only; not runtime camera behavior, framing, saving, Photos or physical-device proof.' };
}

const frameArt = Object.freeze([
  ['Classic-Ivory', '3ccb9f0acf030b5bc31b2bbf6d81f3e694e2dd2e045dc77fd930c6d4df59164e'],
  ['Sage-Botanical', '4121598a7aa1d445fed5c223d4b475d706cb93567d90c51a42d1dad86cb36e21'],
  ['Coastal-Sea-Glass', '8f3bbfb131c9454f6ea633a79445e6cd9b32176e9aa80c09080925b0d83884a0'],
]);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function boundedFrameFile(root, filename) {
  const path = join(root, filename), before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size < 24 || before.size > 4 * 1024 * 1024 ||
      realpathSync(path) !== path) throw new Error('Frame artwork must be a bounded owned regular file without symlinks');
  const bytes = readFileSync(path), after = lstatSync(path);
  if (bytes.length !== before.size || before.size !== after.size || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) {
    throw new Error('Frame artwork changed during inspection');
  }
  return bytes;
}

// The pure XCTest target copies art directly and cannot prove CocoaPods copied
// its production resource bundle. Verify the built app independently, byte for byte.
export function verifyNativeFrameArt(directory) {
  const root = realpathSync(directory);
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Frame artwork requires an owned app directory');
  const bundle = join(root, 'WeddingFrameArt.bundle');
  const stat = lstatSync(bundle);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(bundle) !== bundle) {
    throw new Error('Native frame artwork bundle must be an app-owned directory without symlinks');
  }
  const expectedNames = frameArt.map(([name]) => name + '-Text-Free-Artwork.frameart').sort();
  const actualNames = readdirSync(bundle).filter(name => name.endsWith('.frameart')).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error('Native frame artwork bundle inventory is incomplete or unexpected');
  const sourceRoot = realpathSync(join(repository, 'design/frame-art-v1'));
  const entries = frameArt.map(([name, approvedSHA256]) => {
    const filename = name + '-Text-Free-Artwork.frameart';
    const bytes = boundedFrameFile(bundle, filename);
    const source = boundedFrameFile(sourceRoot, name + '-Text-Free-Artwork.png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== approvedSHA256 || !bytes.equals(source)) throw new Error('Native bundled frame artwork differs from the approved original PNG bytes');
    return { file: relative(root, join(bundle, filename)), bytes: bytes.length, sha256 };
  });
  return { bundle: 'WeddingFrameArt.bundle', exactOriginalArtworkFound: true, entries,
    scope: 'Exact artwork presence in the built production resource bundle only; not app rendering, physical-iPad layout or image-export proof.' };
}
