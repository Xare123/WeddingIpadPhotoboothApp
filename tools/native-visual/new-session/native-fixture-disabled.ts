/** The separate hosted-native test fixture can never activate in this browser. */
export const nativeFixtureEnabled = false;
const disabled = (): never => { throw new Error('Native XCTest fixture is disabled in the browser visual harness'); };
export const nativeFixtureImage = disabled;
export const nativeFixturePhotoId = disabled;
export const nativeFixtureStorageStatus = disabled;
export const takeNativeFixturePhoto = disabled;
export const interruptNativeFixtureConfirmation = disabled;
