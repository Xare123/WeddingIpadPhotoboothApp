# Mac-to-iPad handoff

Build exact **`9ed36b4eac6ce558b82b22db4e08037308b87a2c`, version 0.3.7/build 10** on the existing authorized Mac. It passes [all 20 Release simulator tests](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998097), [unsigned device Release](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998043) and [Linux](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998107). [The current handoff](RELEASE_0_3_7.md) gives source hashes, exact checks and ordered device acceptance. The d44 source failed hosted simulator startup; its signed 0.3.6/build 9 Mac artifact remains held and unexecuted. Do not reuse it as the repair.

The coordinator verified matching signed **9ed36b4 /0.3.7/build10 installed in place at08:13UTC**. Preserve its bundle/team/profile, Keychain, app container, originals and queue; do not reinstall merely for the source-only runner correction. Physical startup/relaunch/portrait-landscape welcome passes1/1, and a separate four-ceiling-photo session verifies observed5s/3s timing,4 JPEG sizes matching journals and4 review selections after relaunch, with110 prior file entries unchanged. [Exact reported boundaries](../artifacts/test-results/physical-four-photo-acceptance.json). Individual/whole-shoot retakes remain unexecuted because later automation startup timed out. Photos is journaled saved this run but not independently inspected. Earlier owner-confirmed copies and intentional Photos deletions remain respected.

The actual iPad is an 11-inch M2 iPad Air. The owner's M1 Mac previously built signed candidates on macOS 27.0.1/Xcode 27.1/Swift 6.4; CI uses Xcode 26.3. The matching signed0.3.7 app is already installed; commands below are reproduction instructions, not a prerequisite to continuing acceptance. Use Swift 6.2+, Node 24 and CocoaPods 1.16.2; Xcode 16.4/Swift 6.1 cannot build this dependency set. Keep precompiled React defaults but the camera-only source opt-out and compiled marker check below.

The owner already approved in-place updates and the dedicated runner. Proceed within that scope after passed source/build gates; do not ask again for the same approval. Bounded coordinator physical checks have run; all current configs are NOT_ARMED. The later retake attempt did not reach its test body because enabling automation timed out. Resolve current readiness/account/authentication state at action time rather than assuming an old blocker or bypassing a denied screenshot. Main-app build/install, runner provisioning and actual tests are distinct. Preserve all private identities/diagnostics outside this public repository.

Private confirmed-queue transfer is approved. Pairing starts that queue automatically and is independent of installing this repair. The connector still denies the origin; [owner-operated setup](OWNER_MANUAL_PRIVATE_SETUP.md) is the reviewed route, not agent execution through a different host. No live pairing/upload/SMS occurred in this cloud task. Actual capture/Photos/orientation/Retake All/restart/offline/QR acceptance still requires the iPad.

## Install a standalone release

1. Use reviewed startup-repair source `9ed36b4eac6ce558b82b22db4e08037308b87a2c`, after checking its final results in validation. For an existing Mac checkout, preserve its private bundle-ID configuration before updating and retain warm DerivedData. The following clone commands are for a new checkout; they do not preserve an existing local configuration automatically:

   ```sh
   xcodebuild -version
   xcrun swift --version
   node --version
   pod _1.16.2_ --version
   git clone --branch codex/wedding-photobooth-mvp https://github.com/Xare123/WeddingIpadPhotoboothApp.git
   cd WeddingIpadPhotoboothApp
   PHOTOBOOTH_REVIEWED_COMMIT=9ed36b4eac6ce558b82b22db4e08037308b87a2c
   git checkout --detach "$PHOTOBOOTH_REVIEWED_COMMIT"
   npm ci
   cd apps/ipad
   EXPO_PUBLIC_E2E_FIXTURE=0 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 node ../../node_modules/expo/bin/cli prebuild --platform ios --no-install
   pod _1.16.2_ install --project-directory=ios
   open ios/WeddingPhotobooth.xcworkspace
   ```

   Proceed with Swift **6.2 or newer**, Node **24**, and CocoaPods **1.16.2**. The Mac executor verified earlier signed candidates with Xcode27.1. This source needs its own matching artifact/provenance; reuse warm outputs after checking source and private identity, rather than assuming the old binary matches. The Linux agent cannot execute signing or installation.
   SDK 58's default precompiled camera omits the repository patch. This candidate commits `expo.autolinking.ios.buildFromSource: ["expo-camera"]` in `apps/ipad/package.json`; keep that setting, rerun prebuild and CocoaPods, and check that the Pods project includes the patched Swift source instead of selecting the stock ExpoCamera XCFramework. Keep the other React Native precompiled defaults and the warm DerivedData directory. Verify `preserveFullPhotoAvailable` in the compiled app with the helper below; finding it only in JavaScript or a source file is insufficient.

2. Connect and unlock the iPad. Review **Trust This Computer** for the owner's Mac and enable **Developer Mode** if required. The owner confirmed free Apple ID personal-team signing. Select that existing team, and **preserve the installed app's bundle identifier and team** so the update keeps its container. The repository identifier remains `com.example.weddingphotobooth`; do not change it blindly if originals may exist. Keep Expo's app configuration and Xcode consistent. Review account/profile/terms prompts yourself.
3. In the generated `WeddingPhotobooth.xcworkspace`, select the **WeddingPhotobooth** application scheme and the connected iPad. In **Product → Scheme → Edit Scheme → Run → Info**, choose **Release**, then use **Product → Run**. Keep the native test scheme for the separate synthetic simulator checks. This Xcode path requires owner signing and has not been executed by the Linux agent.

   The equivalent Expo CLI route, after signing is configured, is:

   ```sh
   EXPO_PUBLIC_E2E_FIXTURE=0 npm run ios --workspace @wedding-booth/ipad -- --device --configuration Release
   ```

   Choose the connected iPad when prompted. This route also requires Mac/Xcode and has not been run by the Linux cloud agent. A simulator `.app` or the Debug native fixture is not an installable wedding release.
4. Quit Metro, disconnect the Mac, and cold-launch/reboot the iPad. Verify it opens without a development server and has no synthetic-fixture panel or simulated camera. Inspect the personal-team profile's actual expiry and refresh/rehearse near November 1 using the same team and identifier; paid membership is not the default requirement.

Start with [the four-photo local saving check](SAVING_REPAIR.md) before cloud pairing. The origin is prefilled; [private setup](PRIVATE_PROVISIONING.md) uses a host-only one-time QR/code and Keychain. No normal guest flow asks for API settings or a token. A five-minute setup code should be issued only when this installed iPad is ready and explicit data-scope approval covers the existing confirmed queue that pairing automatically uploads. Five pending jobs / attempt count 15 / no URL / no error do not prove network traffic or pairing; the latest check did not read Keychain.

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

The separate [private physical XCUITest preparation](PHYSICAL_REHEARSAL.md) is source-only, unarmed and unsigned by default. Its exact E8 Mac unsigned build and actual NOT_ARMED test environment passed. The owner authorized the update and runner; the coordinator now reports physical startup and four-photo checks, while all current configs remain NOT_ARMED. The repository empty-filmstrip source correction has not been physically rerun here. UI checks do not replace independent Photos/originals inspection or the unexecuted retake checks.

## Short real-device rehearsal

- Enable the device passcode and appropriate kiosk/Guided Access controls. Verify camera permission, denied-permission recovery, front-camera framing, countdown/cancel, preview, retake and Next guest in both orientations.
- Check the [two-stage timer rehearsal](TIMING.md): new defaults 5s first/3s next, independent snapping sliders and accessible step controls before capture, draft Cancel/Apply, no mid-run edits, and preparation time again after pause/background/retake. A valid legacy host timer is retained as preparation time, so inspect the actual saved defaults.
- Apply a guest override, finish the session and choose Next guests; the saved host defaults must return. Save a different host pair, relaunch and confirm that pair persists while a guest override does not. Restore the intended wedding defaults. Saving/readiness delays must remain visibly separate and must not start the next countdown early. Backgrounding during an exposed save must preserve it before camera remount/readiness; verify this on the actual iPad without deleting photos or filling storage deliberately.
- Photograph a readable test card. Verify the saved/downloaded original is sharp, correctly oriented and mirrored left/right exactly like the front-camera preview (including text). Test actual booth lighting, glare, stand stability, charging and sustained capture.
- Disable Internet, capture four test-card photos, swipe through every original and retake one. Apply Warm, B&W or Film after capture, compare Original, then use Make it yours. Try Strip and Four-cut grid with Classic Ivory, Sage Botanical and Coastal Sea Glass; default Full photo must retain all marked source edges. Save the keepsake. In **Host → Saved sessions**, verify all four untouched originals, selected derivatives, the keepsake and retained earlier take. Force-quit/relaunch and reboot; every original, recipe and pending job must persist. Reopen an existing five-photo session separately. A working guest QR must remain absent until upload and readiness are acknowledged. Local saving works before pairing.
- Compare the actual saved full-resolution look and keepsake with the review preview, including text orientation, edge markers, order and intended cropping. Use **View larger → Whole / Fit width** to inspect the actual JPEG. V2 grids must stay portrait 4:5 or square across theme changes, swaps and relaunch; strips keep 1:3. Full photo is the default. Newly chosen Fill starts at the top, still crops edges, and needs checking for every face. Original bytes must remain untouched; saved derivatives must contain the effect and no UI overlays. Rapid changes, Cancel and backgrounding must not save a stale choice. Reopen a saved V1 recipe and verify its earlier geometry remains unchanged.
- Check the actual Photos app separately, including the keepsake copy. Do not restore or re-export copies the owner intentionally deleted. An **uncertain** copy is deliberately not retried automatically. In the host's saved session, inspect that photo and choose **Already in Photos** only after checking the copy, or **Export this copy again** only if absent and after accepting the duplicate warning. Canceling must make no copy. Exporting a retained take must not add it to the guest gallery. If **Finish local save** appears, keep the app/data intact and retry; a staged exposure must not count as saved or enter a guest link before completion.
- The last verified production state has `DEVICE_TOKEN` absent, pairing disabled and SMS mocked; no fresh live check is implied. The V2 app requires its matching immutable `gridAspect` acknowledgement. After the coordinator verifies matching setup for the already approved **existing confirmed queued real-photo uploads**, use **Host → Private setup** only under that coordinated scope. Consuming its private code automatically starts the existing confirmed queue. The HTTPS origin is prefilled; guests never manage a token, and no raw booth credential needs to be pasted. Keep private codes out of public screenshots and chat. Restore Internet; verify no duplicate sessions and inspect an original download from another phone on cellular data.
- Scan QR codes using normal iPhone/Android camera apps at practical distances and brightness levels. Confirm the exact session, readable expiry, expiration/revocation behavior, and that Next guest removes the previous photo/QR. Browser decoding and simulator UI tests do not replace this scan.
- Turn on VoiceOver and check countdown, error, saved/ready announcements and control navigation; test larger text and scrolling. Speech must never reveal the bearer URL.
- Verify a second copy/export of originals before any cleanup. Link expiry closes access and does not delete originals. Real SMS remains disabled until provider eligibility, consent/retention handling and budget are approved.

The [native simulator instructions](../apps/ipad/native-tests/README.md) distinguish the standalone Release lane (actual native effects/template tests plus launch smoke) from the historical, unrun Debug synthetic-camera/real-files/SQLite fixture requiring Metro. Neither substitutes for this physical-iPad rehearsal. The current local Swift module and guarded camera plugin require this rebuilt native binary; Expo Go cannot provide the wedding workflow.

After creating Retake All records in0.3.6, stay on0.3.6 or newer. Older clients do not understand attempt state; do not downgrade or reset storage as a repair. Preserve every original and coordinate recovery.
