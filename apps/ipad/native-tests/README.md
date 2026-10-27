# Native simulator verification

Current application **9ed36b4 /0.3.7/build10** passes [all20 Release simulator cases](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998097), zero failures/skips:19 production engine methods plus app cold launch/relaunch/portrait/landscape without Metro. [Unsigned physical-SDK Release](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998043) also passes. [Current Mac/iPad handoff](../../../docs/RELEASE_0_3_7.md). These are not signing, camera, Photos, full Host interaction or real-device proof. The separate Debug/Metro and physical-runner lanes remain unexecuted.

## Historical B4E engine and camera evidence

At00:18 UTC on October27, the owner approved the app update and dedicated runner. The Mac verified in-place installation of0.3.4/build7 with the existing bundle identity preserved and no uninstall/reset. No launch or capture has occurred. Optional runner signing is blocked by Xcode No Accounts and a missing runner profile; the owner has been asked to reconnect the existing Apple ID/Personal Team. The runner remains NOT_ARMED and uninstalled, and the test scene is not yet ready.

The historical B4E app source was **`b4e01d3aeb47c3f164f912b829b4807cc3551f8d`**, version **0.3.4 / build 7**, for the confirmed **11-inch M2 iPad Air**. **Cleared for controlled same-identity iPad installation and rehearsal**, preserving the existing app container, on the signed Mac camera proof below plus the 19-method/16-JPEG result. The app is now installed in place, with no launch/capture yet; the coordinator has reviewed actual native output; device acceptance can proceed, and launch acceptance remains open. [Native ARM run 40418443673](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40418443673), job `121906520182`, passed in **9m9s with 19 executed, 0 failures and 0 skips**: effects 8/8, templates 11/11, and **16/16 native JPEGs exported**. The exact-source annotation records completed stages and `fullExpoSmokeVerified=false`. [Linux 40418443610](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40418443610) passed in **1m23s**. [Unsigned device-SDK Release 40418443634](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40418443634), job `121906519153`, passed on the hosted toolchain in21m29s, with compiled camera-marker and quiescent cleanup verified by the coordinator. The separate exact signed Mac camera build/marker is verified; installation and physical-device results remain unverified. The shipping source remains frozen; physical-runner source is a separate change.

Local frozen installation, typechecks, **311 app/backend/plugin tests**, the 1,048-module Hermes export with two assets and **89 CI contracts** passed. The six JPEG resources, 19 native methods and all original assertions remain. Local API health, legacy five-photo smoke and Metro readiness also passed; original data was untouched. Browser evidence is historical 0.3.2/build 5 with identical JS/styles, not 0.3.4 native proof.

## Current targeted repair and previous runs

The target compiles byte-verified **production** `PhotoEffectsEngine.swift` and `PhotoTemplateEngine.swift` with their existing **19 methods** (8 effects, 11 templates), using Apple frameworks and generated fixtures without Expo or Pods. In 0.3.4 both engines standardize, resolve symlinks and standardize their cache-root URL without appending an empty component. A Mac Foundation probe reproduced cache components ending in `[effects, "/"]` versus the output parent `[effects]`, while the other release predicates passed. The release guard itself is byte-identical. Tests add roots with one/two/three trailing slashes and all eight orientation/content cases. The current 19-method Apple pass verifies these tested engine paths.

The mixed-EXIF test fixture now counter-rotates stored pixels before tagging orientation 6 and supplies four upright portraits. Added assertions inspect ImageIO input and full/preview content; all previous marker assertions remain. The parent had observed two sideways photos in the previous mixed-EXIF Sage output while Coastal was upright. The new assertions passed and all 16 current native JPEGs were exported, and the coordinator has reviewed actual botanical and corrected EXIF Sage pixels with upright subjects. The prior output remains historical; this executor did not download the JPEGs.

Initial run 40406483517 failed before compilation/tests at the unhosted settings/scheme check; H1 fixed direct-target settings inspection. Run 40408422571 executed 19 methods with **15 passed, 4 failed, 0 skipped** (effects 7/8, templates 8/11). Aae's initial cache-directory/canonicalization attempt was insufficient. CI-only `7b8a2f79c2dad6b10d5ffe6d7270858c185df694` preserved app/engine/test/resource/dependency bytes; [Linux 40415524118](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40415524118) passed in 1m10s. Its [ARM run 40415524140](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40415524140), job `121896759670`, reproduced **19 executed / 15 passed / 4 failed / 0 skipped** in 85.35s with verified cleanup. The same four release calls reported `invalidInput`; this was an engine/test failure, not infrastructure. These are previous-candidate outcomes, not 0.3.4 results.

The earlier run reported six attachments with none retained and an over-64MiB raw result. The repaired collector subsequently retained six actual JPEGs from ARM; ten were missing because render loops aborted on release. It only normalizes observed `_0_UUID.jpeg`/`.jpg` suffixes on 16 approved basenames and retains producer/path/duplicate/hash guards. Partial export is not the required 16-image set. Run 40413800572 separately failed after 4m13s at empty host `simctl list` / 180s timeout before simulator creation, Xcode or tests, with verified cleanup. That justified one fresh ARM retry without increasing 18min preparation / 20min Xcode / 3min artifacts / 2min cleanup, 46min step / 60min job, boot 600s or simulator-list 180s; it did not explain the release failures.

## Lightweight interface and owner Mac boundary

`node scripts/prepare-native-pixels.mjs` generates an independent unhosted Xcode project and JSON source/fixture/19-method manifest in a fresh owned directory. It does not clone/rewrite the engines or install Expo/Pods. The JSON supplies the actual project and scheme. `node scripts/ci-native-pixels.mjs` is the bounded hosted runner and **hard-pins Xcode 26.3**; do not describe it as compatible with the owner's different Xcode 27.1.

The verified owner Mac is **M1/macOS 27.0.1 / Xcode 27.1**. Its local route uses the generator plus manual `xcodebuild test` with the returned project/scheme and an **existing iOS simulator**, Release/iphonesimulator, unsigned signing settings and only the verified host architecture. Use fresh DerivedData and result-bundle paths outside app data; stop at the 20-minute build/test budget and record the actual SDK/toolchain and per-test timeout. Do not duplicate the generator/engine implementation, create profiles, download runtimes or accept new agreements. See [the owner Mac route](../../../docs/IOS.md) for the coordinated invocation; no command here should target the physical iPad or a private profile.

The prior signed 0.3.2/build 5 Mac build used the existing private identity and completed, but **was not installed** and had the precompiled-camera mismatch below. A Mac Foundation probe now ran, and the 19-method target compiled, but simulator startup stalled with OS 27 migration failure before test execution; cleanup followed. This does not establish a passing local engine run or an installation. Preserve private bundle/team/profile overrides and never publish their actual values or private Mac paths. Physical XCUITest runner provisioning needs separate approval and none was created. CoreDevice's NETWORK transport is not verified USB.

## Camera source build and marker gate

Stock precompiled ExpoCamera was confirmed to exclude the patched Swift. The committed camera-only opt-out is `expo.autolinking.ios.buildFromSource=["expo-camera"]`; core React Native and other precompiled dependency defaults remain enabled, without forcing a full React Native source build. Eight plugin checks run the actual installed autolinking CLI with ios/apple variants and a no-opt-out 18-module control. The exact b4e01d3 0.3.4/build 7 signed Mac app now verifies signature and embedded JavaScript, preserves the existing bundle/team/profile, compiles all three patched camera Swift files, excludes stale precompiled ExpoCamera and passes Mach-O marker verification. Twelve camera contracts passed. Timing was about 8min total, 3m41s compilation and 24s bundling; this is actual signed native build/source-linkage evidence.

[scripts/native-camera-capability.mjs](../../../scripts/native-camera-capability.mjs) exports **`verifyNativeCameraMarker`**. It is a function, not a CLI to invoke by running that file. It scans only bounded app-executable/ExpoCamera-framework Mach-O files, records hashes and requires the compiled marker; a JavaScript string does not count. Marker presence is not runtime camera, framing, saving or Photos proof. The signed Mac marker is verified for this exact candidate, clearing that installation gate. The coordinator directs controlled installation through the existing Mac executor; no signing or installation is performed from this cloud workspace. Actual capture, saving, Photos, offline recovery and full-app acceptance remain open, and actual device acceptance is still pending. The coordinator separately verified all16 native JPEG hashes/dimensions/bytes and reviewed upright botanical/corrected-EXIF output.

## Separate full-app gate and older history

The 19-method image-engine pass with 16 exported JPEGs establishes that engine coverage only; visual output review remains pending. It is **not equivalent to all 20 methods**, the Expo bridge, full-app launch or device behavior. The **one full-app launch/relaunch/rotation test remains a separate unresolved required gate**. The original full 20 Expo lane stays intact on its historical Intel 40min-Xcode/63min-step/90min-job settings; no further full cold run or deadline extension is planned now.

Older runtime40386078606 booted303s/prepared650s before the 25-minute inner build deadline expired compiling RNSVG, with no XCTest and quiescent cleanup. Its budget-only retry40393553131 failed53m30s: authenticated artifact `12687954017` showed boot 297s / preparation 602s and x86_64-only compilation, then 2411s/SIGTERM during main-app resource/storyboard building. No compiler/assertion error was established. Shutdown timed out and group observation was unavailable, so quiescence was unproven and outputs were correctly held. Earlier d2 and V1 allocation/boot/dual-architecture failures retain historical scope; none is a current19-method engine verdict.

Environment draft **revision19 / ref b4e01d3** has complete setup/startup instructions with exact readback and unchanged network/secrets. The documentation/tooling ref is saved/read back after publication; consult environment settings for that later checkpoint; snapshot publication and fresh restore remain unverified. Actual app/bridge/camera/Photos/iPad and production sharing still need their own acceptance. [Validation](../../../docs/VALIDATION.md) holds final run outcomes.

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

The separate `[native-runtime-ci]` review-branch opt-in runs `node scripts/ci-native.mjs release-runtime` on the pinned macOS/Xcode toolchain. The attract-only lane passed on commit `0dc4385` (hosted runtime run `40343542363`); the full20-method lane now passes at9ed36b4 as recorded above. Earlier full-app attempts stopped during compilation or later crashed at startup; those historical outcomes do not override the current exact-source pass. The separate production-Swift engine target progressed from historical 15-pass / 4-fail runs to the current **19-pass / 16-JPEG** result. That engine-only success does not close the full-app gate. V1 attempts included runner allocation failure, the former cold-boot deadline, and a later duplicate-architecture compilation timeout after successful boot; none established a passing XCTest suite. The later app-source single-architecture attempt also expired during compilation; the final 40-minute budget-only retry also failed before tests, as recorded above. This lane does not replace `[native-ci]`, which compiles the unsigned physical iPhoneOS Release app without XCTest.

The runner builds the genuine Release app and isolated `WeddingPhotoboothReleaseRuntime` scheme, with `EXPO_PUBLIC_E2E_FIXTURE=0` explicitly supplied during prebuild and bundling. It creates a fresh dedicated iPad simulator and starts no Metro server. `WeddingPhotoboothReleaseSmokeTests.swift` checks embedded-JavaScript cold launch and termination/relaunch, visible wedding identity, enabled and hittable accessible Start/Host controls, actual portrait/landscape geometry, and absence of fixture/private photo UI. It never enters the camera or changes host settings.

The same isolated Release XCTest target also compiles byte-identical copies of production `PhotoEffectsEngine.swift` and `PhotoTemplateEngine.swift`, plus their committed native XCTest suites. The engine copies live in the XCTest runner namespace, separate from the production Expo module. They use built-in Core Image/CoreText/ImageIO/CryptoKit frameworks, generated synthetic JPEGs and temporary cache directories; no Expo import, camera or hosted service is involved. The current V2 required inventory is **20 test methods**: one attract smoke, eight effects tests and eleven template tests. The pixel suites check deterministic recipes, original hashes, EXIF orientation, metadata scrubbing, preview/full agreement, color management, template composition/cropping, invalid input, cancellation and cache ownership. Added V2 assertions cover oriented-source inspection and choose-once median geometry, strict V1/V2 compatibility, all six clean portrait layout/theme combinations, mixed square/EXIF output, decoration exclusion and edge preservation. Explicit top/bottom Fill marker assertions retain original source hashes. Six generated clean JPEGs are copied as verified test resources; the tests request 16 labeled full/preview JPEG attachments. A method inventory or requested attachment is not proof that Apple executed or produced it.

Preparation requires every engine/test file and clean JPEG resource, and records source/resource SHA-256, copied path and exact XCTest method names in the generated plan. It verifies copied resources and rejects missing, changed or duplicate project entries. Before building, the runner verifies original and copied bytes against that manifest and writes `runtime-sources.json` into diagnostics. It rejects fewer executed tests than the complete discovered inventory, any failure or any skip; a successful app build or attract-only run cannot pass the expanded lane. Repeating preparation adds no duplicate source or resource references. Legacy Debug synthetic-camera tests remain a separate, unrun lane.

An executed test run retains labeled screenshots of the actual empty simulator attract screen and native JPEG pixel attachments, bounded to 32 MiB by the native source contract. Bounded diagnostics are retained for three days. A valid completed `.xcresult` up to 64MiB is uploaded separately as `release-runtime-xcresult-<SHA>`, including clean assertion failures. Incomplete, over-limit or unverified-writer bundles are excluded from upload with a note; raw ephemeral outputs are retained instead of being deleted while writers are uncertain. App binaries and DerivedData are not uploaded. A passing source-contract check or generated Xcode scheme does not establish runtime success.

On an owner Mac with the prerequisites above, run `node scripts/ci-native.mjs release-runtime` from the repository root. The runner owns simulator creation and cleanup. No service, account or signing credential is required. This smoke test cannot establish camera output, photo preservation/saving, Photos export, Keychain/biometrics, guest sharing, physical iPad layouts or signing readiness.

## Separate private physical runner source

[Physical rehearsal instructions](../../../docs/PHYSICAL_REHEARSAL.md) and source-only tooling at `e8f18833444ed3867805a9ffa51754fbd962f13a` preserve the b4e01d3 shipping app. The Node generator uses an independent synchronized UI-test target, signing disabled, default actual test-process marker NOT_ARMED and explicit owner-ready action/signal. Eight source contracts pass; combined CI guards are now97. [Tooling Linux40423117679](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40423117679) passes in1m25s. The exact E8 generator/Swift adaptation passed Mac unsigned physical-SDK build-for-testing on Xcode27.1/iOS27.1 and actual xctestrun NOT_ARMED validation; signed shipping app hash was unchanged. No physical execution occurred. Runner provisioning, installation and physical execution await the existing Xcode account/profile and an owner-ready test scene; private diagnostics must never enter public artifacts.
