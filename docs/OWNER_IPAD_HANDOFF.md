# Mac-to-iPad handoff

The repaired candidate is **version 0.3.4 / build 7**, source **`b4e01d3aeb47c3f164f912b829b4807cc3551f8d`**. **Cleared for controlled same-identity iPad installation and rehearsal:** [native run 40418443673](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40418443673) passed all 19 cases with zero failures/skips and all 16 required JPEGs. The authorized Mac executor separately verified the signed candidate, unchanged existing identity/profile, patched-camera Swift compilation, compiled native marker and exclusion of the stock camera framework. The matching hosted unsigned Release also passed in21m29s, including native camera-marker verification. Physical local saving/Photos, recovery and the rest of the device checklist remain unverified; see [exact validation](VALIDATION.md).

Device execution is awaiting the owner's exact approval: automatic review rejected the Mac's in-place 0.3.4/build 7 update before execution. The coordinator requested approval for that same-app update/launch and the separate physical UI-runner App ID/profile setup. No installation or retry occurred. Code/build readiness clearance does not supply that execution approval; preserve the existing app and photos while waiting. Approval for the app update is sufficient to start manual rehearsal. The automation runner has its own separate approval.

The actual device is an **iPad Air 11-inch M2**, not the earlier provisional M1 model. The owner's M1 MacBook Air has macOS 27.0.1 and Xcode 27.1; CI uses Xcode 26.3. An earlier signed 0.3.2/build 5 Release compiled on that Mac using the existing identity, but **was never installed** and selected the stock precompiled camera framework. Keep its warm build outputs, the existing installed app, bundle identifier, team, profile and photo container. Do not uninstall, reset storage or create a replacement identity.

For the first owner rehearsal, follow these priorities:

1. After the pending owner execution approval, update the exact cleared standalone Release using the steps below and the existing Apple team and bundle identifier. Keep the installed app and its data intact.
2. Before pairing, turn Internet off and capture four photos of [the rehearsal card](../artifacts/device/README.md). Confirm four full-size originals in **Host → Saved sessions**. Allow add-only Photos access; if needed use **Export copies to Photos**, then inspect the actual Photos app separately. Quit/relaunch and check both again. Stop and preserve the app/data if a photo is missing; record the visible error and saved count.
3. Check the 5s/3s controls, one retake and Next guests. Try a look and a strip/grid keepsake, then inspect the actual saved JPEG and untouched originals.
4. After the coordinator supplies the matching backend and private pairing, restore Internet, scan the ready QR with another phone and verify its downloads. Keep SMS disabled until its separate approval and capped test.
5. Rehearse in the real stand/backdrop with charging, appropriate kiosk controls and the actual venue connection. Check the free signing profile's expiry and refresh near November 1.

Use a Mac with Xcode providing **Swift 6.2+**, the wedding iPad, Node 24 and CocoaPods 1.16.2. CI selects Xcode 26.3; Xcode 16.4 / Swift 6.1 cannot build the installed ExpoModulesJSI package. Check `xcodebuild -version` and `xcrun swift --version` first, and select the intended installation in Xcode's Locations settings if several are installed. Keep the iPad connected and unlocked. Apple signing/account access is separate from unsigned compilation; do not create certificates, buy membership or accept terms automatically.

The published V2 checkpoint **`00e7a2bf5289d95da8b67babc2426cef1d4ef761`** passed [Linux run 40378513541](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40378513541) in 1m6s and [unsigned physical-SDK Release run 40378513599](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40378513599), job `121768064113`, in 23m17s. Its annotation verifies compilation, embedded JavaScript and iPad metadata only: no XCTest, signing, installation or device testing. The later timer source above has its own passing Linux/physical-SDK verification; these compile checks do not establish native XCTest or iPad behavior.

Earlier runtime run `40372103636` booted its simulator, but cold preparation plus duplicate arm64/x86_64 compilation exceeded the 35-minute native-step deadline before XCTest output. The targeted repair restricts simulator compilation to the verified host architecture and gives preparation, Xcode and cleanup separate bounded budgets. Boot stays at 600 seconds; the required 20-test suite is unchanged. [Validation](VALIDATION.md) records that history and the current repaired candidate must pass its own exact-source checks. The preserved full-bleed fallback `0dc4385217678f56e8b7ad2d38f9398fc7dcc31f` passed one launch smoke, not later effects/templates/timers. No hosted job supplies a signed installable app or proves camera, saving, Photos, Keychain, live storage or phone scanning.

## Install a standalone release

1. Use reviewed source `b4e01d3aeb47c3f164f912b829b4807cc3551f8d`, after checking its final results in validation. For an existing Mac checkout, preserve its private bundle-ID configuration before updating and retain warm DerivedData. The following clone commands are for a new checkout; they do not preserve an existing local configuration automatically:

   ```sh
   xcodebuild -version
   xcrun swift --version
   node --version
   pod _1.16.2_ --version
   git clone --branch codex/wedding-photobooth-mvp https://github.com/Xare123/WeddingIpadPhotoboothApp.git
   cd WeddingIpadPhotoboothApp
   PHOTOBOOTH_REVIEWED_COMMIT=b4e01d3aeb47c3f164f912b829b4807cc3551f8d
   git checkout --detach "$PHOTOBOOTH_REVIEWED_COMMIT"
   npm ci
   cd apps/ipad
   EXPO_PUBLIC_E2E_FIXTURE=0 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node ../../node_modules/expo/bin/cli prebuild --platform ios --no-install
   pod _1.16.2_ install --project-directory=ios
   open ios/WeddingPhotobooth.xcworkspace
   ```

   Proceed with Swift **6.2 or newer**, Node **24**, and CocoaPods **1.16.2**. The Mac executor has verified this repaired signed candidate with Xcode 27.1; reuse its reviewed build and evidence rather than blindly starting a cold build. The Linux agent cannot execute signing or installation.
   SDK 58's default precompiled camera omits the repository patch. This candidate commits `expo.autolinking.ios.buildFromSource: ["expo-camera"]` in `apps/ipad/package.json`; keep that setting, rerun prebuild and CocoaPods, and check that the Pods project includes the patched Swift source instead of selecting the stock ExpoCamera XCFramework. Keep the other React Native precompiled defaults and the warm DerivedData directory. Verify `preserveFullPhotoAvailable` in the compiled app with the helper below; finding it only in JavaScript or a source file is insufficient.

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

## Check the compiled camera patch

From the repository root, set the actual built `.app` path. This calls the exported verifier function; running its module as a bare script does not perform a check.

```sh
PHOTOBOOTH_APP_PATH=DerivedData/Build/Products/Release-iphoneos/WeddingPhotobooth.app \
node --input-type=module - <<'JS'
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {verifyNativeCameraMarker} from './scripts/native-camera-capability.mjs';
const app = process.env.PHOTOBOOTH_APP_PATH;
const info = JSON.parse(execFileSync('plutil',
  ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], {encoding: 'utf8'}));
console.log(JSON.stringify(verifyNativeCameraMarker(app, info), null, 2));
JS
```

The verifier checks only the app-owned Mach-O executable and designated camera framework, not bundled JavaScript. This marker establishes compiled capability presence, not camera operation, framing, permission handling or successful photo saving. Preserve the actual existing signing identity in the local build; never publish signing profiles or private setup codes with evidence. Record network versus USB transport truthfully when testing connectivity.

The separate [private physical XCUITest preparation](PHYSICAL_REHEARSAL.md) is source-only, unarmed and unsigned by default. Its exact E8 Mac unsigned build and actual NOT_ARMED test environment passed; explicit execution/provisioning approval is still required; its UI checks do not replace the Photos/originals checks below.

## Short real-device rehearsal

- Enable the device passcode and appropriate kiosk/Guided Access controls. Verify camera permission, denied-permission recovery, front-camera framing, countdown/cancel, preview, retake and Next guest in both orientations.
- Check the [two-stage timer rehearsal](TIMING.md): new defaults 5s first/3s next, independent snapping sliders and accessible step controls before capture, draft Cancel/Apply, no mid-run edits, and preparation time again after pause/background/retake. A valid legacy host timer is retained as preparation time, so inspect the actual saved defaults.
- Apply a guest override, finish the session and choose Next guests; the saved host defaults must return. Save a different host pair, relaunch and confirm that pair persists while a guest override does not. Restore the intended wedding defaults. Saving/readiness delays must remain visibly separate and must not start the next countdown early. Backgrounding during an exposed save must preserve it before camera remount/readiness; verify this on the actual iPad without deleting photos or filling storage deliberately.
- Photograph a readable test card. Verify the saved/downloaded original is sharp, unmirrored and correctly oriented. Test actual booth lighting, glare, stand stability, charging and sustained capture.
- Disable Internet, capture four test-card photos, swipe through every original and retake one. Apply Warm, B&W or Film after capture, compare Original, then use Make it yours. Try Strip and Four-cut grid with Classic Ivory, Sage Botanical and Coastal Sea Glass; default Full photo must retain all marked source edges. Save the keepsake. In **Host → Saved sessions**, verify all four untouched originals, selected derivatives, the keepsake and retained earlier take. Force-quit/relaunch and reboot; every original, recipe and pending job must persist. Reopen an existing five-photo session separately. A working guest QR must remain absent until upload and readiness are acknowledged. Local saving works before pairing.
- Compare the actual saved full-resolution look and keepsake with the review preview, including text orientation, edge markers, order and intended cropping. Use **View larger → Whole / Fit width** to inspect the actual JPEG. V2 grids must stay portrait 4:5 or square across theme changes, swaps and relaunch; strips keep 1:3. Full photo is the default. Newly chosen Fill starts at the top, still crops edges, and needs checking for every face. Original bytes must remain untouched; saved derivatives must contain the effect and no UI overlays. Rapid changes, Cancel and backgrounding must not save a stale choice. Reopen a saved V1 recipe and verify its earlier geometry remains unchanged.
- Check the actual Photos app separately, including the keepsake copy. An **uncertain** copy is deliberately not retried automatically. In the host's saved session, inspect that photo and choose **Already in Photos** only after checking the copy, or **Export this copy again** only if absent and after accepting the duplicate warning. Canceling must make no copy. Exporting a retained take must not add it to the guest gallery. If **Finish local save** appears, keep the app/data intact and retry; a staged exposure must not count as saved or enter a guest link before completion.
- The coordinator reports the V1 backend deployed but pairing disabled and SMS mocked; the V2 app needs its matching backend because `gridAspect` is part of its immutable acknowledgement. After the matching coordinator deployment/provisioning, use **Host → Private setup** to scan or paste the owner's short-lived private pairing code. The HTTPS origin is prefilled; guests never manage a token, and no raw booth credential needs to be pasted. Keep private codes out of public screenshots and chat. Restore Internet; verify no duplicate sessions and inspect an original download from another phone on cellular data.
- Scan QR codes using normal iPhone/Android camera apps at practical distances and brightness levels. Confirm the exact session, readable expiry, expiration/revocation behavior, and that Next guest removes the previous photo/QR. Browser decoding and simulator UI tests do not replace this scan.
- Turn on VoiceOver and check countdown, error, saved/ready announcements and control navigation; test larger text and scrolling. Speech must never reveal the bearer URL.
- Verify a second copy/export of originals before any cleanup. Link expiry closes access and does not delete originals. Real SMS remains disabled until provider eligibility, consent/retention handling and budget are approved.

The [native simulator instructions](../apps/ipad/native-tests/README.md) distinguish the standalone Release lane (actual native effects/template tests plus launch smoke) from the historical, unrun Debug synthetic-camera/real-files/SQLite fixture requiring Metro. Neither substitutes for this physical-iPad rehearsal. The current local Swift module and guarded camera plugin require this rebuilt native binary; Expo Go cannot provide the wedding workflow.
