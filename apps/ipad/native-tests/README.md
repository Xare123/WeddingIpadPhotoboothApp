# Native simulator UI and persistence checks

The five-photo XCTest source is updated and **UNRUN**. It has received source review only in this Linux environment; no Swift/XCTest compilation, simulator execution, `.xcresult`, or new hosted run is claimed. The optional Debug `[native-ui]` lane remains blocked on Metro startup. Consult [validation](../../../docs/VALIDATION.md) for recorded outcomes.

Hosted modes are separate. A `[native-ci]` review-branch push selects `node scripts/ci-native.mjs release-build`: unsigned Release compilation for the physical iOS SDK, embedded JavaScript verification, and metadata/hash evidence. That mode uses no Metro, simulator, or XCTest and cannot establish whether these UI assertions pass. `[native-ui]` selects `ui-tests`; invoking the script without a mode also selects UI tests for owner reproduction. No CI run is required merely to review this source.

`WeddingPhotoboothUITests.swift` targets the unchanged `com.example.weddingphotobooth` bundle on a **fresh, dedicated iPad simulator app install**. It launches the actual Debug native app and uses the committed synthetic JPEG instead of a hardware camera image. Captures use the normal five-shot runner, durable `saveShot`/journal/SQLite paths, `confirmSession`, pending queue, and startup recovery. Debug JavaScript and the fixture JPEG are supplied by local Metro.

Both `__DEV__` and `EXPO_PUBLIC_E2E_FIXTURE=1` are mandatory. Guarded fixture entrypoints do not activate in Release builds. No credential, hosted API URL, or provider connection is supplied; fixture sharing fails offline before loading a connection or making API requests. The fixture does not bypass host authentication, reset booth data, or seed captures at module load. Its generated photo IDs use the recognizable `e2e00000-…` prefix.

The initial assertion requires no active capture, uploads, drafts, or originals. Existing data fails the test rather than being erased. Do not enable the fixture on an event iPad containing photos. The image is a repository illustration, not a guest photo.

## Intended coverage — not yet executed

One sequential test follows the actual controls and storage observations:

1. `start-session` opens the camera. The test accepts the real iOS camera permission when needed, starts `take-photo`, cancels the first countdown, and waits beyond the fresh-install three-second timer to check that no late original or preview appears.
2. A new automatic run is terminated as soon as the fixture reports exactly one durable original. After relaunch, the app must restore that original and its ID, show the partial camera session, and offer Continue. This is a real termination after a completed file save, not an injected mid-write checkpoint.
3. Continue captures the remaining four shots automatically. Review must contain five saved slots, five verified original files, no queued upload, and `Keep all 5 photos`. Paging must change the selected preview; selecting thumbnail one and retaking it must retain six physical originals while keeping five selections.
4. `use-photo` confirms the selection. Exactly five upload jobs must be pending, with six originals still on disk; the retired shot must not become a sixth queued job. Termination/relaunch must restore the confirmed selection and queue. An offline sharing retry must preserve the jobs and show no `guest-qr`.
5. `next-guest` must return to `start-session`, clear the active capture, and retain all six originals and all five pending uploads. Another relaunch must preserve that attract state and those counts without displaying a stale preview or QR.

The guarded fixture status comes from actual Expo document files and SQLite-backed jobs. The test checks `state`, `photo`, `file`, `bytes`, `md5`, `uploads`, `pending`, `drafts`, `originals`, and `verifiedOriginals`. The active file must be nonempty and retain the committed JPEG MD5 `2619d8590042d44e0786109755db2bf5`. `verifiedOriginals` independently counts non-draft synthetic `.jpg` files with that MD5 and nonzero size; assertions require 1, then 5, then 6, including after active clearing. The count proves retained synthetic file bytes, not visual camera quality or a listing of every selected upload ID.

Photos export is optional to this proof. The test preferentially denies Photos permission, or handles the available Add Photos Only / Allow Access / OK variant, while retaining originals locally. It neither opens authenticated host controls nor changes the export preference through a bypass. System prompt wording, accessibility exposure, swipe behavior, and the first-save termination timing still require real Xcode execution. Screenshot attachments, if a successful native run produces them, are labeled synthetic.

This source does not provide native interrupted-rename/queue-checkpoint coverage. It also does not establish standalone offline launch, real front-camera output/mirroring, physical iPad layouts, Photos export success, Keychain/biometrics, VoiceOver speech, hosted gallery access, or SMS acceptance/delivery. Use an owner Mac/iPad and the app's manual checklist for those behaviors.

## Owner Mac reproduction

Requirements: Xcode with Swift 6.2+ (the hosted setup selects Xcode 26.3), an available iPad simulator running iOS 16.4 or later, the repository's Node/npm versions, and CocoaPods 1.16.2. ExpoModulesJSI's Swift-package requirement exceeds React Native's lower declared Xcode minimum. The generated UI-test target uses Swift language version 5. No Apple account, signing certificate, or provisioning profile is required for the unsigned simulator target. This does not produce a physical-iPad distribution build.

From the repository root:

```sh
npm ci
(cd apps/ipad && EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_E2E_FIXTURE=1 npx expo prebuild --platform ios --no-install)
node scripts/prepare-ios-tests.mjs
pod _1.16.2_ install --project-directory=apps/ipad/ios
xcrun simctl list devices available
```

Choose and boot a fresh dedicated iPad simulator. In a separate terminal, start Metro:

```sh
EXPO_PUBLIC_E2E_FIXTURE=1 EXPO_NO_TELEMETRY=1 npm run start --workspace @wedding-booth/ipad -- --port 8081
```

Replace `SIMULATOR_UUID` with the actual simulator identifier:

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

Use a new result-bundle path for repeat runs. Reset only by uninstalling the test app from the dedicated simulator; do not erase an event iPad or delete its files. `prepare-ios-tests.mjs` adds the isolated UI-test target/shared scheme, copies the committed Swift source, and writes `apps/ipad/ios/native-test-plan.json` in the ignored generated project. It does not modify tracked application native source or the Podfile.

A macOS/Xcode run must compile the source and complete the assertions before anyone describes these native UI tests as passing. Linux source review, TypeScript tests, prebuild, and Metro export do not establish XCTest readiness or simulator behavior.
