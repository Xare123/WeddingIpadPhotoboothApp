# 0.3.7 / build 10 — Mac and iPad handoff

**Reviewed application source:** `9ed36b4eac6ce558b82b22db4e08037308b87a2c` on `codex/wedding-photobooth-mvp` in [Xare123/WeddingIpadPhotoboothApp](https://github.com/Xare123/WeddingIpadPhotoboothApp).

The changed orientation loader reads only React Native's Dimensions export. It avoids a reproduced namespace-import path into an unused optional notification module. Normal Expo/App entry is restored; capture, storage, authentication, native image engines, dependencies and the Worker are unchanged. This is a new binary, distinct from the held signed 0.3.6/build9 artifact.

## Evidence and installation gate

| Check on this application commit | Current result |
| --- | --- |
| Cloud local checks | 474 application tests, 138 tooling checks, workspace typechecks and the 1,060-module Hermes export pass. Three actual-Metro adapter cases are included in 474; three installed-source mechanism controls are separate. |
| [Hosted Linux 40463998107](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998107) | Passed in 1m11s. |
| [Release simulator runtime 40463998097](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998097) | Passed in 25m38s: **20 executed, zero failures/skips**, including the app launch/relaunch/rotation smoke. |
| [Unsigned physical-SDK Release 40463998043](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998043) | Passed in 21m08s. Embedded JS/iPad metadata verified; compilation is separate from signing or execution. |
| Matching signed Mac artifact | No matching signed build reported here yet. Preserve existing identity, profile, app container and originals. |
| Physical iPad acceptance | Pending for this candidate. The owner's earlier Photos success and current Host-open confirmation are separate evidence. |

**Both hosted native gates now pass. Prepare/verify a matching signed Mac artifact before the already approved in-place update.** The coordinator can proceed under the existing update approval once those Mac checks pass; physical rehearsal is still required. Do not install the diagnostic d553 build or relabel/reuse the held d44 artifact.

## Mac build preparation

Use the already authorized Mac checkout and warm DerivedData. Inspect an uncertain earlier build's outcome before starting another. Preserve local configuration and changes before fetching/checking out source; do not reset or overwrite the private bundle-ID edit.

1. Verify the full application revision above and source hashes below. Keep any later documentation-only commit separate from the application source being built.
2. Verify `xcodebuild -version`, `xcrun swift --version`, Node 24 and CocoaPods 1.16.2. CI uses Xcode 26.3; the owner's Mac previously passed signed builds with Xcode 27.1/Swift 6.4. Swift must be at least 6.2. A different Xcode is separate provenance, not an identical hosted build.
3. Reapply only the preserved private bundle ID/team configuration before prebuild. Keep version 0.3.7/build10. Never publish the actual bundle/team/device/profile values or credentials. Use the existing Apple Development identity and Personal Team; do not create a replacement certificate, accept agreements or expand capabilities silently.
4. Run the frozen install and native generation from the correct directories:

   ```sh
   npm ci --no-audit --no-fund
   cd apps/ipad
   EXPO_PUBLIC_E2E_FIXTURE=0 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 \
     node ../../node_modules/expo/bin/cli prebuild --platform ios --no-install
   pod _1.16.2_ install --project-directory=ios
   open ios/WeddingPhotobooth.xcworkspace
   ```

5. Build the WeddingPhotobooth scheme in **Release** for the actual iPad using the existing signing configuration and warm DerivedData. Keep `expo.autolinking.ios.buildFromSource: ["expo-camera"]`. Verify patched camera Swift compilation, embedded standalone JS, version/build and signature. Call the [compiled-camera verifier](OWNER_IPAD_HANDOFF.md#check-the-compiled-camera-patch) on the actual built app; a source/JS marker is insufficient. Do not enable fixture mode.
6. Record private artifact hashes/provenance and verify the same bundle/team/profile before an approved in-place update. No uninstall, reset, container removal, queue deletion or Photos re-export. A build alone does not launch or install the app.

| Reviewed application file | SHA-256 |
| --- | --- |
| `apps/ipad/App.tsx` | `d49e6318af58b395d1b90a97359beb4ae542acc7a6f90a7c29b25414b943cd63` |
| `apps/ipad/index.ts` | `af10e01cf5fa6d399a83829926cc80d935c1dca8fb01313ab7cb54aab84c028b` |
| `apps/ipad/src/orientation-native.ts` | `030f647fb04da3538cb96dc9cf9235e5fcbcfee72fbf02c2ed7da11e3acd3e31` |

The owner already approved the in-place update and dedicated test runner; do not ask again for that same scope. The runner still needs the existing Xcode account/profile issue resolved and an explicitly ready harmless test scene. Keep it **NOT_ARMED** until readiness is established. The retargeted source generator's eight Linux checks passed; its new version guard still needs matching Mac unsigned preparation. Runner signing/install and physical execution are separate from building the app.

## Ordered non-destructive device acceptance

1. **Launch and Host:** after the passed-gate update, cold-launch without Metro. Verify Host from welcome, camera, review and sharing with both biometrics and device-passcode fallback, cancellation and background relocking. No authentication bypass or app PIN. Keep all real diagnostics private.
2. **Orientation and timing:** save Auto, Portrait and Landscape in Host, relaunch and verify actual behavior and safe areas. Preference must not apply during capture/save. Restore the intended setting. Exercise guest 5-second first/3-second next controls, pause/resume and individual retake preparation. Next guests must restore host timing defaults.
3. **Originals and Photos:** use a harmless edge-marked test card. Capture four real shots offline; verify each full original, orientation/mirroring and local journal before review success. Verify new Photos copies separately without restoring copies intentionally deleted earlier. Force-close/relaunch and reboot only after exposed originals are safe. Do not clear historical sessions.
4. **Retake All:** preserve a complete previous set, start a new four-shot attempt, cancel a countdown and return to the earlier set. Rehearse a partially captured attempt and recovery without deleting either set. Confirm an abandoned set is not guest-published. Legacy five-photo sessions retain their original count.
5. **Looks and keepsakes:** compare Original/Warm/B&W/Film actual output, then both layouts and all three themes. Check all four unique photos, upright text, explicit Full photo/Fill semantics, correct crop/order, preview/full-resolution parity, retained originals and interruption/reopening. Rapid edits must not save stale output.
6. **Private cloud and QR:** local capture works before pairing. Only after matching V2 Worker setup and the already approved confirmed-queue scope, the owner uses [private setup](OWNER_MANUAL_PRIVATE_SETUP.md). Pairing automatically uploads existing confirmed sessions. Verify full-session readiness, exact private downloads and a real phone scan before reporting guest sharing ready. No public listing or public bucket.
7. **SMS and event rehearsal:** SMS waits for provider/domain eligibility, a real ready page and explicit consent. The coordinator owns at most three approved owner test texts; this executor sends none. Separately test venue Wi-Fi, cellular scanning, charging, stand stability, group framing/lighting, VoiceOver, larger text and a sustained guest sequence. This is a dry wedding; use harmless, drink-free test/demo scenes.

Warm/B&W/Film are post-capture processing. Snapchat-style live face effects are not implemented. Avoid delaying the reliable booth release for an unverified camera-stack replacement.

## Signing and preservation

Free Personal Team signing is the intended path. Inspect the actual embedded profile's expiry in the venue's local time and refresh/rehearse close to November 1 with the same identity; an expiry date that looks later in UTC may still fall during the event. Do not assume a new build renewed the profile. Keep the app container, Keychain, originals, queue and warm build outputs intact.

Physical XCTest diagnostics can include real camera content without explicit screenshot attachments. Keep them on the private Mac; never publish them to this public repository or hosted artifacts. UI save labels are not file hashes or independent Photos proof. A simulator pass cannot validate the real iPad camera, actual Apple Photos copies, phone scanning or venue reliability.
