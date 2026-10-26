# iOS installation and device testing

## What is required

Use a Mac with a compatible Xcode/iOS SDK, CocoaPods and Node 24 (see `.nvmrc`). Install dependencies from the root with `npm ci`. Confirm the iPad's actual model, iPadOS version, free storage and available power. The provisional target is iPad Air M1, fifth generation; no enclosure dimensions or fit have been verified.

React Native's installed 0.88 scripts declare iOS 15.1 and Xcode 16.1 minimums, but the complete Expo SDK/native dependency and target-iPadOS combination can require a newer toolchain. Use current supported Xcode for the device and verify the generated project's effective deployment target instead of relying on those lower bounds.

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

These commands generate ignored native files. They install open-source dependencies but do not create an Apple account, agree to new legal terms, enroll a paid developer membership, or submit an app automatically. The installed `expo run:ios` command needs the relevant signing team/profile. Replace the example bundle identifier deliberately before establishing the final signing identity. Do not put certificates or provisioning profiles in Git.

Expo Go can run supported native modules only when its SDK matches this app. It depends on a development server; its caching, permissions and data lifetime do not establish wedding readiness. A development build can also depend on Metro. The wedding needs a release build whose JavaScript is embedded and that opens after a cold reboot without a laptop or development server.

## Distribution decision (owner action)

The owner will use a MacBook to install on the iPad. Apple Developer membership/signing availability is still unknown. Free personal-team device provisioning can expire within roughly a week, which overlaps this wedding's timeline; verify actual profile expiration rather than relying on it. Paid Apple Developer distribution, ad hoc installation and TestFlight have different account, registered-device, review and expiry requirements. TestFlight approval or Apple enrollment should not be assumed immediate. Choose an already-available route, verify its requirements in the current Apple documentation and rehearse installation early. No signing, account enrollment, EAS build, submission or paid build was performed here.

The macOS workflow uses an explicitly marked `[native-ci]` push to build an **unsigned Release app for the physical iOS SDK**, without Metro or simulator startup. It checks the executable, embedded `main.jsbundle`, bundle identifier and iPad device family, and records small hash/metadata evidence. Compilation does not run XCTest or install the app.

The separate `[native-ui]` mode builds the Debug XCTest target for synthetic capture with real native files/SQLite and process restarts. It requires nonzero passing test execution; its hosted Metro startup remains unresolved. See [native test instructions](../apps/ipad/native-tests/README.md) and exact outcomes in [validation](VALIDATION.md). Neither mode establishes real-iPad signing, camera, storage protection, image orientation or standalone offline launch. Firebase iOS testing requires a signed XCTest/XCUITest package, not a Metro bundle or a JavaScript test report; the bounded [Firebase assessment](FIREBASE_ASSESSMENT.md) records why it is deferred here.

## Operator configuration

Keep the default offline until an approved HTTPS backend is deployed. Configure its origin and dedicated device token through the OS-authenticated operator settings on the iPad; enable a device passcode first. Public Expo variables must never contain production credentials. The optional phone-sharing simulation is labeled for fictional test numbers only. Live guest messaging is not enabled until a provider and approved sender are available; a QR to the uploaded guest page is the practical fallback.

## Required physical-device rehearsal

- Install the intended standalone release build, check its provisioning expiry beyond November 1, and restart the iPad with no development server.
- Allow camera permission; deny it once and verify the recovery path. Verify front-camera framing in portrait and landscape, countdown, preview, retake and next-guest reset.
- Use a card with readable text to confirm the final JPEG is not unintentionally mirrored or rotated. Front-camera preview and final capture can differ; inspect the downloaded original.
- Capture several photos with Wi-Fi disabled. Force-quit/reopen and reboot; verify originals and pending IDs persist. Restore Wi-Fi and confirm one guest session per confirmed photo, no duplicate uploads and no QR before actual readiness.
- Scan each QR from a second phone on cellular data. Check that it opens the right session, downloads the original and cannot open another guest's image. Test expiry and revocation without real guest photos.
- Test venue Wi-Fi, access-point isolation, captive portals and cellular backup. A guest phone can scan a QR offline but cannot load a website without connectivity. Never present a local-development URL as a working guest link.
- Rehearse a long capture run, low storage, permission failures, power/charging and thermal conditions in the actual stand/backdrop lighting. Turn off notifications and enable an appropriate iPad kiosk/Guided Access configuration with a host-controlled exit.
- Verify a host backup/export method before clearing or uninstalling the app. Local preservation is not a substitute for a second copy.
