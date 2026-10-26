# Native simulator verification

The local V2 candidate is **0.3.1 / build 4**. Linux prebuild and Release test preparation verify **20 required XCTest methods**, five exact Swift sources and six owned generated JPEG resources (824,109 bytes). This preparation is not Apple compilation or execution. The V2 native run and full/preview JPEG attachments remain pending; use [validation](../../../docs/VALIDATION.md) for the final exact commit and results. The current CI-only `d1dbc8f` runtime run targets the older 15-method V1 suite, not these local V2 sources.

`[native-ci]` selects unsigned physical-SDK Release compilation; `[native-runtime-ci]` selects the standalone Release simulator suite without Metro. Both standard hosted lanes select Xcode 26.3 and preflight Swift tools 6.2 or newer. The runtime workflow uses the standard `macos-15-intel` runner after an observed ARM allocation failure, and a bounded 600-second cold boot allowance after an observed progressing iOS 26.2 boot hit the former 180-second deadline. Neither adjustment reduces the required test count or proves simulator success. Do not retry another failed run without inspecting its actual failing stage.

## Historical Debug synthetic-camera fixture

The separate Debug five-photo XCTest source is **UNRUN** and still describes the earlier five-shot workflow. It is not current four-photo guest-flow coverage. It has received source review only in this Linux environment; no executed native capture/persistence assertions are claimed. The optional Debug `[native-ui]` lane remains blocked on Metro startup. Its source would need updating and actual execution before it could validate the current four-photo UI.

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


## Release simulator offline-launch smoke lane

The separate `[native-runtime-ci]` review-branch opt-in runs `node scripts/ci-native.mjs release-runtime` on the pinned macOS/Xcode toolchain. The attract-only lane passed on commit `0dc4385` (hosted runtime run `40343542363`); the current expanded V2 effects/template pixel tests described below are **UNRUN** until a fresh exact-commit hosted result executes the complete required inventory. V1 attempts stopped at runner allocation and cold simulator boot before XCTest. This lane does not replace `[native-ci]`, which compiles the unsigned physical iPhoneOS Release app without XCTest.

The runner builds the genuine Release app and isolated `WeddingPhotoboothReleaseRuntime` scheme, with `EXPO_PUBLIC_E2E_FIXTURE=0` explicitly supplied during prebuild and bundling. It creates a fresh dedicated iPad simulator and starts no Metro server. `WeddingPhotoboothReleaseSmokeTests.swift` checks embedded-JavaScript cold launch and termination/relaunch, visible wedding identity, enabled and hittable accessible Start/Host controls, actual portrait/landscape geometry, and absence of fixture/private photo UI. It never enters the camera or changes host settings.

The same isolated Release XCTest target also compiles byte-identical copies of production `PhotoEffectsEngine.swift` and `PhotoTemplateEngine.swift`, plus their committed native XCTest suites. The engine copies live in the XCTest runner namespace, separate from the production Expo module. They use built-in Core Image/CoreText/ImageIO/CryptoKit frameworks, generated synthetic JPEGs and temporary cache directories; no Expo import, camera or hosted service is involved. The current V2 required inventory is **20 test methods**: one attract smoke, eight effects tests and eleven template tests. The pixel suites check deterministic recipes, original hashes, EXIF orientation, metadata scrubbing, preview/full agreement, color management, template composition/cropping, invalid input, cancellation and cache ownership. Added V2 assertions cover oriented-source inspection and choose-once median geometry, strict V1/V2 compatibility, all six clean portrait layout/theme combinations, mixed square/EXIF output, decoration exclusion and edge preservation. Explicit top/bottom Fill marker assertions retain original source hashes. Six generated clean JPEGs are copied as verified test resources; the tests request 16 labeled full/preview JPEG attachments. A method inventory or requested attachment is not proof that Apple executed or produced it.

Preparation requires every engine/test file and clean JPEG resource, and records source/resource SHA-256, copied path and exact XCTest method names in the generated plan. It verifies copied resources and rejects missing, changed or duplicate project entries. Before building, the runner verifies original and copied bytes against that manifest and writes `runtime-sources.json` into diagnostics. It rejects fewer executed tests than the complete discovered inventory, any failure or any skip; a successful app build or attract-only run cannot pass the expanded lane. Repeating preparation adds no duplicate source or resource references. Legacy Debug synthetic-camera tests remain a separate, unrun lane.

An executed test run retains labeled screenshots of the actual empty simulator attract screen and native JPEG pixel attachments, bounded to 32 MiB by the native source contract. Bounded diagnostics and an `.xcresult` up to 64 MiB are retained for three days; oversized result bundles are omitted with a size note and test-summary metadata. App binaries and DerivedData are not uploaded. A passing source-contract check or generated Xcode scheme does not establish runtime success.

On an owner Mac with the prerequisites above, run `node scripts/ci-native.mjs release-runtime` from the repository root. The runner owns simulator creation and cleanup. No service, account or signing credential is required. This smoke test cannot establish camera output, photo preservation/saving, Photos export, Keychain/biometrics, guest sharing, physical iPad layouts or signing readiness.
