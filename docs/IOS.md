# iOS installation and device testing

## What is required

Use a Mac with a compatible Xcode/iOS SDK, CocoaPods and Node 24 (see `.nvmrc`). Install dependencies from the root with `npm ci`. Confirm the iPad's actual model, iPadOS version, free storage and available power. The provisional target is iPad Air M1, fifth generation; no enclosure dimensions or fit have been verified.

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

Expo Go can run supported native modules only when its SDK matches this app. It depends on a development server; its caching, permissions and data lifetime do not establish wedding readiness. A development build can also depend on Metro. The wedding needs a release build whose JavaScript is embedded and that opens after a cold reboot without a laptop or development server.

## Distribution decision (owner action)

The owner confirmed a MacBook, Xcode, the wedding iPad and a **free Apple ID personal team**. Use that route by default. Personal-team provisioning commonly expires within roughly a week; inspect the actual expiry, refresh with the same team/bundle identifier near November 1, and rehearse a cold launch after renewal. Do not depend on an expired build at the event or require paid membership as a default. Signing, account prompts and real-device installation remain owner actions; none was executed by the Linux agent.

The macOS workflow uses an explicitly marked `[native-ci]` push to build an **unsigned Release app for the physical iOS SDK**, without Metro or simulator startup. It checks the executable, embedded `main.jsbundle`, bundle identifier and iPad device family, and records small hash/metadata evidence. Compilation does not run XCTest or install the app.

The separate `[native-ui]` mode builds the Debug XCTest target for synthetic capture with real native files/SQLite and process restarts. It requires nonzero passing test execution; its hosted Metro startup remains unresolved. See [native test instructions](../apps/ipad/native-tests/README.md) and exact outcomes in [validation](VALIDATION.md). Neither mode establishes real-iPad signing, camera, storage protection, image orientation or standalone offline launch. Firebase iOS testing requires a signed XCTest/XCUITest package, not a Metro bundle or a JavaScript test report; the bounded [Firebase assessment](FIREBASE_ASSESSMENT.md) records why it is deferred here.

## Operator configuration

The intended HTTPS origin is prefilled. Use [private one-time pairing](PRIVATE_PROVISIONING.md) through OS-authenticated host settings; guests never enter an origin or token. Enable an iPad passcode first. Capture and the local library work without pairing or Internet. No public Expo variable contains a production credential. Phone collection remains hidden until the backend confirms approved live SMS; QR is the normal sharing path.

## Required physical-device rehearsal

- Install the intended standalone release build, check its provisioning expiry beyond November 1, and restart the iPad with no development server.
- Allow camera permission; deny it once and verify recovery. Verify full-screen framing in both orientations, host timer choices, all five countdowns, thumbnail progress, swipe review, individual retakes and Next guest.
- Use a card with readable text to confirm the final JPEG is not unintentionally mirrored or rotated. Front-camera preview and final capture can differ; inspect the downloaded original.
- Capture five photos with Wi-Fi disabled. Check the host's local library, force-quit/reopen and reboot; verify originals, selected order and pending IDs persist. Restore Wi-Fi and confirm one guest page for all five selected photos, no duplicate uploads, and no QR before complete readiness.
- Grant Photos add-only access and inspect the actual Photos app. Deny access once, verify the app still retains originals, then allow/retry without overwriting originals. Distinguish confirmed Photos copies from failed/unconfirmed exports. Test low storage with synthetic cards; never erase existing originals to create space.
- Scan each QR from a second phone on cellular data. Check that it opens the right session, downloads the original and cannot open another guest's image. Test expiry and revocation without real guest photos.
- Test venue Wi-Fi, access-point isolation, captive portals and cellular backup. A guest phone can scan a QR offline but cannot load a website without connectivity. Never present a local-development URL as a working guest link.
- Rehearse a long capture run, low storage, permission failures, power/charging and thermal conditions in the actual stand/backdrop lighting. Turn off notifications and enable an appropriate iPad kiosk/Guided Access configuration with a host-controlled exit.
- Verify a host backup/export method before clearing or uninstalling the app. Local preservation is not a substitute for a second copy.
