import { Image } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { QueueJob } from '@wedding-booth/core';
import type { ActiveCapture } from './storage';

// Both conditions are mandatory. Release builds can never activate this fixture.
export const nativeFixtureEnabled = __DEV__ && process.env.EXPO_PUBLIC_E2E_FIXTURE === '1';

function requireNativeFixture(): void {
  if (!nativeFixtureEnabled) throw new Error('Native fixture is disabled');
}

export function nativeFixturePhotoId(uuid: string): string {
  requireNativeFixture();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(uuid)) throw new Error('A synthetic UUID is required');
  return `e2e00000${uuid.slice(8)}`;
}

export function nativeFixtureImage(): number {
  requireNativeFixture();
  return require('../native-tests/fixtures/capture.jpg') as number;
}

export async function takeNativeFixturePhoto(): Promise<{ uri: string }> {
  requireNativeFixture();
  const source = Image.resolveAssetSource(nativeFixtureImage());
  if (!source?.uri) throw new Error('Synthetic camera asset is unavailable');
  if (source.uri.startsWith('file://')) return { uri: source.uri };
  // Debug Metro serves the committed synthetic scene. Download only its resolved
  // asset URI into cache; preserveCapture still performs the real durable copy.
  const target = new File(Paths.cache, 'native-synthetic-camera.jpg');
  const file = await File.downloadFileAsync(source.uri, target, { idempotent: true });
  return { uri: file.uri };
}

export function nativeFixtureStorageStatus(active: ActiveCapture | null, jobs: QueueJob[]): string {
  requireNativeFixture();
  const directory = new Directory(Paths.document, 'photobooth');
  const files = directory.exists ? directory.list().filter((entry): entry is File => entry instanceof File) : [];
  const original = active ? new File(active.fileUri) : null;
  const exists = original?.exists ?? false;
  return [
    `state=${active ? active.confirmed ? 'confirmed' : 'draft' : 'none'}`,
    `photo=${active?.id ?? 'none'}`,
    `file=${exists ? 'present' : 'none'}`,
    `bytes=${exists ? original!.size : 0}`,
    `md5=${exists ? original!.md5 ?? 'unavailable' : 'none'}`,
    `uploads=${jobs.filter(job => job.kind === 'upload').length}`,
    `pending=${jobs.filter(job => job.kind === 'upload' && job.state === 'pending').length}`,
    `drafts=${files.filter(file => file.name.endsWith('.draft.jpg')).length}`,
    `originals=${files.filter(file => file.name.endsWith('.jpg') && !file.name.endsWith('.draft.jpg')).length}`,
    `verifiedOriginals=${files.filter(file => file.name.startsWith('e2e00000-') && file.name.endsWith('.jpg') && !file.name.endsWith('.draft.jpg') && file.size > 0 && file.md5 === '2619d8590042d44e0786109755db2bf5').length}`,
  ].join(';');
}

// Simulate the precise termination window after the confirmed-file rename and
// before the queue/active-row commits. Do not touch SQLite here: real startup
// recovery must reconstruct exactly one pending job on the next native launch.
export function interruptNativeFixtureConfirmation(capture: ActiveCapture): Promise<void> {
  requireNativeFixture();
  const expected = new File(Paths.document, 'photobooth', `${capture.id}.draft.jpg`);
  if (!capture.id.startsWith('e2e00000-') || capture.confirmed || capture.fileUri !== expected.uri) {
    throw new Error('A synthetic draft preview is required');
  }
  const source = new File(capture.fileUri);
  if (!source.exists || source.size <= 0) throw new Error('Synthetic draft is missing');
  const destination = new File(Paths.document, 'photobooth', `${capture.id}.jpg`);
  if (destination.exists) throw new Error('Synthetic checkpoint already exists');
  // SDK58 native relocation is asynchronous. A caller must await the checkpoint
  // before terminating; the synchronous guard above still rejects Release use.
  return source.move(destination);
}
