/** Browser-only boundary: native XCTest hooks must never activate here. */
export const nativeFixtureEnabled = false;
function disabled(): never { throw new Error('Native-only fixture is disabled in the browser visual harness'); }
export function nativeFixtureImage(): never { return disabled(); }
export function nativeFixturePhotoId(_uuid: string): never { return disabled(); }
export function nativeFixtureStorageStatus(..._args: unknown[]): never { return disabled(); }
export function takeNativeFixturePhoto(): never { return disabled(); }
export function interruptNativeFixtureConfirmation(..._args: unknown[]): never { return disabled(); }
