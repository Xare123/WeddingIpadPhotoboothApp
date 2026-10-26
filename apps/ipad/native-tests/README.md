# Native simulator UI and persistence checks

Hosted modes are separate. A `[native-ci]` review-branch push now selects `node scripts/ci-native.mjs release-build`: unsigned Release compilation for the physical iOS SDK, embedded JavaScript verification and small metadata/hash evidence, with no Metro, simulator or XCTest. A `[native-ui]` push selects `ui-tests`, described below. Running the script without a mode still selects UI tests for owner reproduction. Consult [validation](../../../docs/VALIDATION.md) for actual outcomes; the Release build is not a UI-test result, and hosted Metro startup remains unresolved.

`WeddingPhotoboothUITests.swift` is an XCTest UI test for a fresh iPad simulator app install. It launches the actual Debug native application, accepts the actual iOS camera permission dialog, and uses a committed **synthetic JPEG** in place of physical camera hardware. The synthetic image then travels through the normal `preserveCapture`, `confirmCapture`, SQLite queue and startup recovery paths.

Both `__DEV__` and `EXPO_PUBLIC_E2E_FIXTURE=1` are required. Each fixture entrypoint checks the guard itself. Release builds never activate it. No credentials, test URL or provider connection is supplied; fixture upload/share requests fail offline before reading Keychain or making API requests. The fixture does not bypass host authentication, reset/delete existing booth data or seed data at module load. Its captures use a recognizable `e2e00000-…` UUID prefix, and the interrupted-confirmation mutator accepts only those draft files in the app's photo directory.

Use a fresh simulator or fresh app install. The test rejects existing uploads instead of clearing user data. Do not enable this mode on an event iPad with existing photos. The source image is the repository's synthetic illustration, not a guest photo.

## Checks exercised

The single sequential test checks native launch/permission grant, countdown cancellation with no late capture, draft file bytes (including the committed fixture’s MD5) and active SQLite state across terminate/relaunch, retake preserving the old draft, ordinary confirmation creating a pending job, API-offline retry showing no QR, next-guest clearing surviving restart, and confirmed-file journal recovery.

For the journal checkpoint, the fixture renames its synthetic draft to a confirmed `.jpg` but deliberately leaves the active SQLite row pointing to the old draft and creates no upload row. XCTest terminates the app immediately afterward. Real startup recovery must reconstruct one pending job, update the active file URI, retain readable bytes, and remain idempotent on another relaunch. Screenshot attachments in the `.xcresult` are labeled synthetic.

This is **API-offline native storage coverage**. Debug JavaScript and the JPEG come from local Metro, so it does not establish standalone offline launch. It does not test real front-camera output, camera quality/mirroring, physical iPad layouts, Keychain/biometrics, VoiceOver speech, the public guest API or delivery. Those still need an owner Mac/iPad and the manual checklist in the app README.

## Owner Mac reproduction

Requirements: Xcode with Swift 6.2+ (CI selects Xcode 26.3), an available iPad simulator running iOS 16.4 or later, Node/npm versions from the repository, and CocoaPods 1.16.2. ExpoModulesJSI's Swift-package requirement exceeds React Native's lower declared Xcode minimum. No Apple account, signing certificate or provisioning profile is required for the unsigned simulator target. This does not produce an installable physical-iPad distribution.

From the repository root:

```sh
npm ci
(cd apps/ipad && EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_E2E_FIXTURE=1 npx expo prebuild --platform ios --no-install)
node scripts/prepare-ios-tests.mjs
pod _1.16.2_ install --project-directory=apps/ipad/ios
xcrun simctl list devices available
```

Choose/boot a fresh iPad simulator from that list. In a separate terminal, start Metro:

```sh
EXPO_PUBLIC_E2E_FIXTURE=1 EXPO_NO_TELEMETRY=1 npm run start --workspace @wedding-booth/ipad -- --port 8081
```

Then replace `SIMULATOR_UUID` below with its actual identifier:

```sh
xcodebuild \
  -workspace apps/ipad/ios/WeddingPhotobooth.xcworkspace \
  -scheme WeddingPhotoboothNativeTests \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UUID' \
  -derivedDataPath /tmp/WeddingPhotobooth-native-derived \
  -resultBundlePath /tmp/WeddingPhotobooth-native.xcresult \
  -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO \
  test
```

Use a new result-bundle path for repeat runs. Reset by uninstalling this test app from the dedicated simulator, not by erasing an event iPad or deleting production files. The generated native project is ignored; `prepare-ios-tests.mjs` adds an isolated UI-test target and shared scheme through the existing Xcode project API, copies the committed Swift test, and writes `apps/ipad/ios/native-test-plan.json`. Its paths are repository-relative. The setup is repeatable and does not edit the tracked Podfile or application native source.

Linux can verify Expo prebuild, generated-project structure, TypeScript and Metro export. Only an actual macOS/Xcode run can establish whether the native target builds and these XCTest assertions pass; do not describe unrun native tests as passing.
