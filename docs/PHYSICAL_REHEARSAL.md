# Private physical-device rehearsal

The source-only helper is now retargeted to app **0.3.5/build 8** through strict version and accessibility-source hashes. Its generated plan separately records the previous native-verified app **`b4e01d3aeb47c3f164f912b829b4807cc3551f8d`**; it does not mislabel that earlier commit as the new source. The test uses the already installed app. No provisioning, signing, installation or physical execution is performed by these preparation commands.

The owner approved the app update/launch and dedicated runner at00:18UTC on October27. App0.3.4/build7 is installed in place with preserved identity and no uninstall/reset. The owner subsequently captured a manual session: private inspection found four original files and their journals plus a keepsake; the owner confirmed successful Apple Photos copies and intentionally deleted some Photos copies. This manual evidence is separate from the unexecuted automated case. Optional runner signing is blocked by Xcode **No Accounts** and a missing runner profile, with an existing valid certificate. The owner has been asked to reconnect the existing Apple ID/Personal Team. The runner remains **NOT_ARMED** and uninstalled; a harmless test scene and explicit readiness are also pending. Manual rehearsal can proceed independently when the owner is ready.

## Prepare without arming

The source is [WeddingPhotoboothPhysicalSmokeTests.swift](../apps/ipad/native-tests/WeddingPhotoboothPhysicalSmokeTests.swift). The [Node preparation helper](../scripts/prepare-ios-physical-tests.mjs) uses the existing repository toolchain and adds no dependency. It creates a new independent project with a synchronized source folder and one UI-test target. It does not modify an existing Xcode project or the shipping app.

Configure `PHOTOBOOTH_APP_BUNDLE_ID` from the preserved installed app and `PHOTOBOOTH_DEVELOPMENT_TEAM` from its existing signing team, privately on the Mac. No identifier, certificate, profile or device identity is included in this handoff. Use an output directory that does not exist:

```sh
umask 077
node scripts/prepare-ios-physical-tests.mjs .cache/physical-unarmed
```

Signing is disabled. The generated scheme explicitly passes `PHOTOBOOTH_PHYSICAL_REHEARSAL=NOT_ARMED` to the **test process**, even if `OWNER_READY` happens to be inherited in the shell. It forwards only the app identifier and readiness marker. The project has no application target, target-app dependency or `UITargetAppPath`; it cannot rebuild or install the photobooth. It uses `XCUIApplication(bundleIdentifier:)` to access the configured installed app. Its test bundle is `<APP_BUNDLE_ID>.physicaltests`; Xcode derives a separate `.physicaltests.xctrunner` runner.

A signed runner needs a separate App ID/development profile. Use the existing certificate only under the existing action-specific approval; do not create a new certificate, enroll capabilities, pass automatic provisioning/device-registration flags or accept agreements/security prompts silently. Main-app installation remains a separate action. Keep the existing app/container and all historical photos intact.

## Arm only when the owner is ready

After the required approvals, the owner must position a non-sensitive marked card, unlock the iPad and confirm readiness. The coordinator must verify that the booth is **unpaired**: this runner cannot disable background networking in an already-paired app. Do not collect guests or real private images during the test.

Create a fresh armed project only at that point:

```sh
PHOTOBOOTH_PHYSICAL_REHEARSAL=OWNER_READY \
node scripts/prepare-ios-physical-tests.mjs .cache/physical-ready --owner-ready
```

Both the explicit `--owner-ready` action and the readiness signal are required. This writes the marker into the scheme's **TestAction EnvironmentVariables**, not the target app's launch environment. A shell variable beside `xcodebuild` alone is insufficient. An armed project is not a durable readiness grant: do not reuse it after the owner leaves or the device/card changes.

The authorized Mac validated exact `e8f1883`: eight Node checks, unsigned device-SDK `build-for-testing` on Xcode27.1/iOS27.1, and actual generated `.xctestrun` explicitly **NOT_ARMED**. No app target, dependency or `UITargetAppPath` exists, and the signed shipping app executable hash stayed unchanged. If using an `.xctestrun` artifact, inspect its actual UI-test target `EnvironmentVariables` after building and confirm the configured bundle identifier and `OWNER_READY` reached that target. Stop if the schema or environment differs. Modifying the scheme after an artifact was built does not update that old `.xctestrun`; rebuild the test configuration before executing it. Do not put the marker into the shipping app or bypass the Swift guard.

Run the single physical case only through the approved, configured runner. The source rejects simulator execution, fixture mode and any existing active/recovered guest session. It initially activates without terminating, verifies no captured slots, checks runtime full-original camera capability and applies guest-only 5s/3s timing. It captures four photos and checks each saved thumbnail/review selection. Only then does it terminate/relaunch this new rehearsal and verify restored review. It leaves the session open; it never chooses Next guests, deletes, confirms/shares, pairs, bypasses host authentication or calls SMS.

Recognized camera/add-only Photos alerts are handled within the approved task scope. Unknown prompts, Settings-required denial, a local-save retry or a permission-induced capture pause stop for owner attention while preserving the session. The owner handles biometric/passcode prompts. Do not rerun over the resulting active session automatically.

## Evidence and remaining checks

Keep generated projects, identity configuration, `.xcresult` bundles, screenshots and logs **private**, in ignored `.cache` or outside the public checkout. Automatic XCTest diagnostics can contain camera or existing-session images despite no explicit screenshot attachments. Never commit or upload this physical evidence to public CI. The preparation helper refuses destinations elsewhere inside the public checkout.

Eight Node source-preparation checks pass: isolated target/source copying, disabled signing, default unarmed behavior, explicit test-environment delivery, invalid identity/existing-output and symlink-redirection protection, version/accessibility drift and session-preservation guards. These are not native tests. The reviewed E8 Node/folder-synchronized project also passed its own Mac unsigned physical-SDK build and actual `.xctestrun` environment check as described above. This is build/preparation proof. The runner has not been signed, provisioned, installed or executed; its execution awaits the existing Xcode account/profile and an owner-ready test scene.

The automated case is still unexecuted. Its UI labels and restored review would not by themselves establish file hashes/IDs, actual Photos copies, image quality, measured countdown intervals, offline/no-cable operation, retake or filters/templates. Follow [the owner rehearsal](OWNER_IPAD_HANDOFF.md), inspect Photos independently, and compare real full-size originals. CoreDevice previously used network transport; the owner must assist with disconnection/standalone proof. All new session data stays preserved.

Apple reference: [XCUIApplication](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication).
