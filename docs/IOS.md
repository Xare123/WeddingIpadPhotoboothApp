# iOS installation and device testing

## What is required

Use a Mac with a compatible Xcode/iOS SDK, CocoaPods and Node 24 (see `.nvmrc`). Install dependencies from the root with `npm ci`. The connected device was identified as an **iPad Air 11-inch M2**, replacing the earlier provisional M1 identification. Confirm its installed iPadOS, free storage, power and stand fit. The owner's M1 MacBook Air reports macOS 27.0.1 and Xcode 27.1; that is a separate toolchain from CI's Xcode 26.3.

The installed ExpoModulesJSI Swift package requires **Swift tools 6.2 or newer**. The initial hosted Release build selected Xcode 16.4 / Swift 6.1 and failed that requirement. CI now explicitly selects installed Xcode 26.3; use a compatible Mac/Xcode with Swift 6.2+ for owner builds. Verify both `xcodebuild -version` and `xcrun swift --version` before CocoaPods or compilation. React Native's lower declared Xcode minimum is insufficient for this complete dependency graph. The generated app deployment target and the installed iPadOS remain separate checks.

## Development build on a Mac (not run here)

```sh
cd WeddingIpadPhotoboothApp
npm ci
cd apps/ipad
npx expo prebuild --platform ios --no-install
pod _1.16.2_ install --project-directory=ios
open ios/WeddingPhotobooth.xcworkspace
```

Use the application scheme and connected iPad in Xcode; follow [the standalone Release handoff](OWNER_IPAD_HANDOFF.md). The optional CLI installation route from the same `apps/ipad` directory is:

```sh
npx expo run:ios --device
```

These commands generate ignored native files. They do not create an Apple account, accept terms, buy membership or submit an app automatically. Use the existing personal-team signing identity. If an app is already installed, preserve its bundle identifier and team: changing identity creates a different photo container. Never uninstall or clear an installation containing originals. Do not put certificates or profiles in Git.

The local Core Image module requires a rebuilt native app and is unavailable in Expo Go. A development build can depend on Metro. The wedding needs a Release build whose JavaScript and assets are embedded and that opens after a cold reboot without a laptop or development server.

SDK 58 otherwise selects a precompiled ExpoCamera framework that omits this repository's full-original patch. `apps/ipad/package.json` therefore opts **only `expo-camera`** into source builds through Expo autolinking. Keep React Native's precompiled defaults. Regenerate the native project and run CocoaPods after updating; do not delete warm DerivedData or existing app data. Verify the Pods graph actually includes the patched camera source and run the compiled-marker guard described in [the owner handoff](OWNER_IPAD_HANDOFF.md). Source resolution and a compiled marker do not prove runtime capture or correct framing.

## Distribution decision (owner action)

The owner confirmed a MacBook, Xcode, the wedding iPad and a **free Apple ID personal team**. Use that route by default. Personal-team provisioning commonly expires within roughly a week; inspect the actual expiry, refresh with the same team/bundle identifier near November 1, and rehearse a cold launch after renewal. Do not depend on an expired build at the event or require paid membership as a default. Signing, account prompts and real-device installation remain owner actions; none was executed by the Linux agent.

The macOS workflow uses an explicitly marked `[native-ci]` push to build an **unsigned Release app for the physical iOS SDK**, without Metro or simulator startup. It checks the executable, embedded `main.jsbundle`, bundle identifier and iPad device family, and records small hash/metadata evidence. Compilation does not run XCTest or install the app.

The separate `[native-runtime-ci]` lane builds a standalone Release simulator app without Metro and requires **20 XCTest methods**: 8 actual Core Image effects checks, 11 native template checks and 1 app launch/relaunch/rotation smoke. The preceding full-bleed commit passed the one-method launch smoke; the expanded feature lane has its own exact-commit result in [validation](VALIDATION.md). The optional `[native-ui]` Debug fixture remains unrun because its hosted Metro startup was unresolved. See [native test instructions](../apps/ipad/native-tests/README.md). Simulator tests do not establish real-iPad signing, camera, Photos, Keychain or booth image quality. The owner chose to leave [Firebase deferred](FIREBASE_CURRENT_ASSESSMENT.md).

## Operator configuration

The intended HTTPS origin is prefilled. Use [private one-time pairing](PRIVATE_PROVISIONING.md) through OS-authenticated host settings; guests never enter an origin or token. Enable an iPad passcode first. Capture and the local library work without pairing or Internet. No public Expo variable contains a production credential. Phone collection remains hidden until the backend confirms approved live SMS; QR is the normal sharing path.

## Required physical-device rehearsal

- Install the intended standalone release build, check its provisioning expiry beyond November 1, and restart the iPad with no development server.
- Allow camera permission; deny it once and verify recovery. Verify full-bleed framing in both orientations, host timer choices, all four countdowns, thumbnail progress, swipe review, individual retakes and Next guest.
- Use an asymmetric card with text and a marked left edge. New front-camera JPEGs should match the mirrored preview left/right, including text; rear-camera capture stays unmirrored. Check portrait and both landscape directions, Photos and the downloaded original. Full-original framing can still show more around the edges than the aspect-fill preview.
- Capture four photos with Wi-Fi disabled. Apply a look, compare Original, switch all three themes and both layouts, then save a keepsake. Check the host library, force-quit/reopen and reboot; verify untouched originals, selected derivatives, order/recipe and pending IDs persist. Restore Wi-Fi and confirm one guest page with the keepsake and all required individual files, no duplicate uploads, and no QR before complete readiness. Reopen a retained five-photo session separately to verify compatibility.
- Grant Photos add-only access and inspect the actual Photos app. Deny access once, verify the app still retains originals, then allow/retry without overwriting originals. Distinguish confirmed Photos copies from failed/unconfirmed exports. Check available storage before rehearsal; use the automated injected-storage-failure checks rather than deliberately filling the wedding iPad or erasing originals.
- Scan each QR from a second phone on cellular data. Check that it opens the right session, downloads the original and cannot open another guest's image. Test expiry and revocation without real guest photos.
- Test venue Wi-Fi, access-point isolation, captive portals and cellular backup. A guest phone can scan a QR offline but cannot load a website without connectivity. Never present a local-development URL as a working guest link.
- Rehearse a long capture run with adequate free storage, permission recovery, power/charging and thermal conditions in the actual stand/backdrop lighting. Turn off notifications and enable an appropriate iPad kiosk/Guided Access configuration with a host-controlled exit.
- Verify a host backup/export method before clearing or uninstalling the app. Local preservation is not a substitute for a second copy.
