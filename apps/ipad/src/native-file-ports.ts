import type { LocalFiles } from './local-persistence';

export interface NativePhotoFile<F> {
  readonly name: string;
  readonly exists: boolean;
  readonly size: number | null;
  copy(destination: F, options?: { overwrite?: boolean }): Promise<void> | void;
  move(destination: F): Promise<void> | void;
  write(text: string): Promise<void> | void;
  text(): Promise<string>;
}
export function createNativeFilePorts<F extends NativePhotoFile<F>>({ file, directory, uri, isFile }: {
  file(uri: string): F;
  directory: {
    create(options: { idempotent: boolean; intermediates: boolean }): unknown | Promise<unknown>;
    list(): unknown[] | Promise<unknown[]>;
  };
  uri(relative: string): string;
  isFile(entry: unknown): entry is F;
}): LocalFiles {
  return {
    uri,
    async ensureDirectory() { await directory.create({ idempotent: true, intermediates: true }); },
    async list() { return (await directory.list()).filter(isFile).map(entry => entry.name); },
    async stat(path) { const entry = file(path); return { exists: entry.exists, size: entry.exists ? entry.size : null }; },
    // Expo SDK 58 exposes these as native AsyncFunction methods. Returning before
    // they settle races verification and detaches native write failures.
    async copy(source, destination) {
      // Only an owned, uncommitted staging file may be replaced on retry.
      // SDK 58 otherwise refuses existing destinations by default.
      const staging = /^photobooth\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.partial$/.test(destination);
      await file(source).copy(file(uri(destination)), staging ? { overwrite: true } : undefined);
    },
    async move(from, to) { await file(uri(from)).move(file(uri(to))); },
    async read(path) { return await file(uri(path)).text(); },
    async write(path, text) { await file(uri(path)).write(text); },
  };
}
