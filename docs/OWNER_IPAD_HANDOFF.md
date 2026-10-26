# Mac-to-iPad handoff

Use a Mac with Xcode providing **Swift 6.2+**, the wedding iPad, Node 24 and CocoaPods 1.16.2. CI selects Xcode 26.3; Xcode 16.4 / Swift 6.1 cannot build the installed ExpoModulesJSI package. Check `xcodebuild -version` and `xcrun swift --version` first, and select the intended installation in Xcode's Locations settings if several are installed. Keep the iPad connected and unlocked. Apple signing/account access is separate from unsigned compilation; do not create certificates, buy membership or accept terms automatically.

## Install a standalone release

1. Clone the repository's `codex/wedding-photobooth-mvp` review branch and run `npm ci` from its root.
2. Follow [iOS setup](IOS.md) to generate/open the native project. Confirm the final bundle identifier and an existing signing team in Xcode before capturing any event photos. The example identifier is not an established distribution identity. Keep the identifier in Expo's `apps/ipad/app.json` consistent with Xcode so a later prebuild does not replace it. Review any Apple account/profile/terms prompts yourself.
3. In the generated `WeddingPhotobooth.xcworkspace`, select the **WeddingPhotobooth** application scheme and the connected iPad. In **Product → Scheme → Edit Scheme → Run → Info**, choose **Release**, then use **Product → Run**. Keep the native test scheme for the separate synthetic simulator checks. This Xcode path requires owner signing and has not been executed by the Linux agent.

   The equivalent Expo CLI route, after signing is configured, is:

   ```sh
   EXPO_PUBLIC_E2E_FIXTURE=0 npm run ios --workspace @wedding-booth/ipad -- --device --configuration Release
   ```

   Choose the connected iPad when prompted. This route also requires Mac/Xcode and has not been run by the Linux cloud agent. A simulator `.app` or the Debug native fixture is not an installable wedding release.
4. Quit Metro, disconnect the Mac, and cold-launch/reboot the iPad. Verify the app opens without a development server. No synthetic-fixture panel or simulated camera should be present. Free personal-team provisioning can expire near the event; inspect the actual profile expiry and renew/rehearse with time to spare rather than assuming seven days will cover it.

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
