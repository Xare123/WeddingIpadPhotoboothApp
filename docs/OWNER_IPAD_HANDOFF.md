# Mac-to-iPad handoff

The latest recovery/visual candidate is being published for fresh exact-commit CI. The source and run links below describe the previous milestone until [the main report](../artifacts/test-results/summary.json) records the new result. Do not install the old milestone expecting the later staging/SQLite/Photos reconciliation fixes. The owner must preserve the existing app container and originals throughout the update.

Use a Mac with Xcode providing **Swift 6.2+**, the wedding iPad, Node 24 and CocoaPods 1.16.2. CI selects Xcode 26.3; Xcode 16.4 / Swift 6.1 cannot build the installed ExpoModulesJSI package. Check `xcodebuild -version` and `xcrun swift --version` first, and select the intended installation in Xcode's Locations settings if several are installed. Keep the iPad connected and unlocked. Apple signing/account access is separate from unsigned compilation; do not create certificates, buy membership or accept terms automatically.

Install the **five-photo saving repair, version 0.2.0 / build 2**, at reviewed commit **`c0d6f4dd4ae51e7bb5827e3bf9fb6a06bf8ba900`**. Its [unsigned physical-iOS-SDK Release build](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40281388626) and [Linux checks](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40281388547) passed. The previous `82703b6` / `8e473ddd` build is historical and does not contain this repair. CI does not supply a signed installable app. Actual iPad saving, camera, Photos copies, offline recovery, QR scans and profile expiry remain owner checks.

## Install a standalone release

1. On the Mac, check the selected tools, then make a fresh checkout at the reviewed commit:

   ```sh
   xcodebuild -version
   xcrun swift --version
   node --version
   pod _1.16.2_ --version
   git clone --branch codex/wedding-photobooth-mvp https://github.com/Xare123/WeddingIpadPhotoboothApp.git
   cd WeddingIpadPhotoboothApp
   git checkout --detach c0d6f4dd4ae51e7bb5827e3bf9fb6a06bf8ba900
   npm ci
   cd apps/ipad
   EXPO_PUBLIC_E2E_FIXTURE=0 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node ../../node_modules/expo/bin/cli prebuild --platform ios --no-install
   pod _1.16.2_ install --project-directory=ios
   open ios/WeddingPhotobooth.xcworkspace
   ```

   Proceed with Swift **6.2 or newer**, Node **24**, and CocoaPods **1.16.2**. These are owner Mac instructions; the cloud agent has not executed the installation or signing steps on that Mac.
2. Connect and unlock the iPad. Review **Trust This Computer** for the owner's Mac and enable **Developer Mode** if required. The owner confirmed free Apple ID personal-team signing. Select that existing team, and **preserve the installed app's bundle identifier and team** so the update keeps its container. The repository identifier remains `com.example.weddingphotobooth`; do not change it blindly if originals may exist. Keep Expo's app configuration and Xcode consistent. Review account/profile/terms prompts yourself.
3. In the generated `WeddingPhotobooth.xcworkspace`, select the **WeddingPhotobooth** application scheme and the connected iPad. In **Product → Scheme → Edit Scheme → Run → Info**, choose **Release**, then use **Product → Run**. Keep the native test scheme for the separate synthetic simulator checks. This Xcode path requires owner signing and has not been executed by the Linux agent.

   The equivalent Expo CLI route, after signing is configured, is:

   ```sh
   EXPO_PUBLIC_E2E_FIXTURE=0 npm run ios --workspace @wedding-booth/ipad -- --device --configuration Release
   ```

   Choose the connected iPad when prompted. This route also requires Mac/Xcode and has not been run by the Linux cloud agent. A simulator `.app` or the Debug native fixture is not an installable wedding release.
4. Quit Metro, disconnect the Mac, and cold-launch/reboot the iPad. Verify it opens without a development server and has no synthetic-fixture panel or simulated camera. Inspect the personal-team profile's actual expiry and refresh/rehearse near November 1 using the same team and identifier; paid membership is not the default requirement.

Start with [the five-photo local saving check](SAVING_REPAIR.md) before cloud pairing. The origin is prefilled; [private setup](PRIVATE_PROVISIONING.md) uses a host-only one-time QR/code and Keychain. No normal guest flow asks for API settings or a token. A five-minute setup code should be issued only when this installed iPad is ready to consume it.

Do not uninstall or clear an app that contains event photos. A bundle-identifier change creates a different app container; preserve any existing originals and verify backups before changing identity or installation method.

## Short real-device rehearsal

- Enable the device passcode and appropriate kiosk/Guided Access controls. Verify camera permission, denied-permission recovery, front-camera framing, countdown/cancel, preview, retake and Next guest in both orientations.
- Photograph a readable test card. Verify the saved/downloaded original is sharp, unmirrored and correctly oriented. Test actual booth lighting, glare, stand stability, charging and sustained capture.
- Disable Internet, capture and confirm several synthetic/test-card photos, force-quit/relaunch, then reboot. Originals and pending jobs must persist; a working guest QR must remain absent until upload and readiness are acknowledged.
- After the approved backend is deployed, configure only its HTTPS origin and booth token through OS-authenticated Host settings. Keep credentials out of source, public environment variables, screenshots and chat. Restore Internet; verify no duplicate sessions and inspect an original download from another phone on cellular data.
- Scan QR codes using normal iPhone/Android camera apps at practical distances and brightness levels. Confirm the exact session, readable expiry, expiration/revocation behavior, and that Next guest removes the previous photo/QR. Browser decoding and simulator UI tests do not replace this scan.
- Turn on VoiceOver and check countdown, error, saved/ready announcements and control navigation; test larger text and scrolling. Speech must never reveal the bearer URL.
- Verify a second copy/export of originals before any cleanup. Link expiry closes access and does not delete originals. Real SMS remains disabled until provider eligibility, consent/retention handling and budget are approved.

The native XCTest fixture has its own [simulator instructions](../apps/ipad/native-tests/README.md). It exercises actual files/SQLite with a synthetic camera and local Metro. It does not prove standalone offline launch, physical camera behavior, Keychain/biometrics, live storage or delivery.
