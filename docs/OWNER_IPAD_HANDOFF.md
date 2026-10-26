# Mac-to-iPad handoff

The current **local V2 candidate is version 0.3.1 / build 4**. It passes 293 integrated local tests, 50 CI contracts and four separate recovery fault sequences. Its final installation commit and fresh physical-SDK/20-method native results are **not pinned yet**. Do not install an earlier branch head expecting these V2 changes. Preserve the existing app container and originals throughout the update. Real-iPad saving and Photos acceptance remain open.

Use a Mac with Xcode providing **Swift 6.2+**, the wedding iPad, Node 24 and CocoaPods 1.16.2. CI selects Xcode 26.3; Xcode 16.4 / Swift 6.1 cannot build the installed ExpoModulesJSI package. Check `xcodebuild -version` and `xcrun swift --version` first, and select the intended installation in Xcode's Locations settings if several are installed. Keep the iPad connected and unlocked. Apple signing/account access is separate from unsigned compilation; do not create certificates, buy membership or accept terms automatically.

The earlier **V1** source `e0506f92f56b8847aa36aa4ce7f59002da54cffc` passed [Linux](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40365263266) and [unsigned physical-SDK Release compilation](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40365263378). Its simulator run failed before runner acquisition; an Intel retry then timed out during cold simulator boot, with no test assertions executed. The CI-only `d1dbc8fd3254005f24ec00132dc07bc998a18308` now has passing [Linux checks](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40372103512) and an [in-progress old 15-method runtime run](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40372103636). Those results do not cover local V2. Use [validation](VALIDATION.md) and the final handoff to choose the full V2 source commit before the installation commands below. The preserved full-bleed five-photo fallback `0dc4385217678f56e8b7ad2d38f9398fc7dcc31f` passed compilation and one launch smoke, not later looks/templates. No hosted job supplies a signed installable app or proves physical-iPad saving, camera, Photos, Keychain, live storage or phone scanning.

## Install a standalone release

1. Wait for the final V2 handoff to pin a full reviewed commit. Set `PHOTOBOOTH_REVIEWED_COMMIT` to that exact SHA in the Mac terminal, then check the tools and make a fresh checkout:

   ```sh
   xcodebuild -version
   xcrun swift --version
   node --version
   pod _1.16.2_ --version
   git clone --branch codex/wedding-photobooth-mvp https://github.com/Xare123/WeddingIpadPhotoboothApp.git
   cd WeddingIpadPhotoboothApp
   : "${PHOTOBOOTH_REVIEWED_COMMIT:?Set the full reviewed V2 commit from the final handoff first}"
   git checkout --detach "$PHOTOBOOTH_REVIEWED_COMMIT"
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

Start with [the four-photo local saving check](SAVING_REPAIR.md) before cloud pairing. The origin is prefilled; [private setup](PRIVATE_PROVISIONING.md) uses a host-only one-time QR/code and Keychain. No normal guest flow asks for API settings or a token. A five-minute setup code should be issued only when this installed iPad is ready to consume it.

Do not uninstall or clear an app that contains event photos. A bundle-identifier change creates a different app container; preserve any existing originals and verify backups before changing identity or installation method.

## Short real-device rehearsal

- Enable the device passcode and appropriate kiosk/Guided Access controls. Verify camera permission, denied-permission recovery, front-camera framing, countdown/cancel, preview, retake and Next guest in both orientations.
- Photograph a readable test card. Verify the saved/downloaded original is sharp, unmirrored and correctly oriented. Test actual booth lighting, glare, stand stability, charging and sustained capture.
- Disable Internet, capture four test-card photos, swipe through every original and retake one. Apply Warm, B&W or Film after capture, compare Original, then use Make it yours. Try Strip and Four-cut grid with Classic Ivory, Sage Botanical and Coastal Sea Glass; default Full photo must retain all marked source edges. Save the keepsake. In **Host → Saved sessions**, verify all four untouched originals, selected derivatives, the keepsake and retained earlier take. Force-quit/relaunch and reboot; every original, recipe and pending job must persist. Reopen an existing five-photo session separately. A working guest QR must remain absent until upload and readiness are acknowledged. Local saving works before pairing.
- Compare the actual saved full-resolution look and keepsake with the review preview, including text orientation, edge markers, order and intended cropping. Use **View larger → Whole / Fit width** to inspect the actual JPEG. V2 grids must stay portrait 4:5 or square across theme changes, swaps and relaunch; strips keep 1:3. Full photo is the default. Newly chosen Fill starts at the top, still crops edges, and needs checking for every face. Original bytes must remain untouched; saved derivatives must contain the effect and no UI overlays. Rapid changes, Cancel and backgrounding must not save a stale choice. Reopen a saved V1 recipe and verify its earlier geometry remains unchanged.
- Check the actual Photos app separately, including the keepsake copy. An **uncertain** copy is deliberately not retried automatically. In the host's saved session, inspect that photo and choose **Already in Photos** only after checking the copy, or **Export this copy again** only if absent and after accepting the duplicate warning. Canceling must make no copy. Exporting a retained take must not add it to the guest gallery. If **Finish local save** appears, keep the app/data intact and retry; a staged exposure must not count as saved or enter a guest link before completion.
- The coordinator reports the V1 backend deployed but pairing disabled and SMS mocked; the V2 app needs its matching backend because `gridAspect` is part of its immutable acknowledgement. After the matching coordinator deployment/provisioning, use **Host → Private setup** to scan or paste the owner's short-lived private pairing code. The HTTPS origin is prefilled; guests never manage a token, and no raw booth credential needs to be pasted. Keep private codes out of public screenshots and chat. Restore Internet; verify no duplicate sessions and inspect an original download from another phone on cellular data.
- Scan QR codes using normal iPhone/Android camera apps at practical distances and brightness levels. Confirm the exact session, readable expiry, expiration/revocation behavior, and that Next guest removes the previous photo/QR. Browser decoding and simulator UI tests do not replace this scan.
- Turn on VoiceOver and check countdown, error, saved/ready announcements and control navigation; test larger text and scrolling. Speech must never reveal the bearer URL.
- Verify a second copy/export of originals before any cleanup. Link expiry closes access and does not delete originals. Real SMS remains disabled until provider eligibility, consent/retention handling and budget are approved.

The [native simulator instructions](../apps/ipad/native-tests/README.md) distinguish the standalone Release lane (actual native effects/template tests plus launch smoke) from the historical, unrun Debug synthetic-camera/real-files/SQLite fixture requiring Metro. Neither substitutes for this physical-iPad rehearsal. The current local Swift module and guarded camera plugin require this rebuilt native binary; Expo Go cannot provide the wedding workflow.
