import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

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
