# Synthetic iPad Vision probe — isolated source preparation

This probe investigates the two failing post-capture face-effect cases. It does **not** replace or launch the installed wedding app. The stable installed build remains **9ed36b4 / 0.3.7, build 10**; the isolated **0.3.8** feature remains held at **27/29 native cases**. Do not merge, deploy or install it from this handoff.

The current cloud task is authorized for source preparation and an **unsigned generic iOS SDK build only**. The Mac is not authorized for this task context. No device execution, connection, signing, runner installation, account changes or keep-awake action is performed. Do not route through Windows or another machine to bypass unavailable or denied access. Existing owner approvals remain valid; supported access and action-time owner readiness still need confirmation.

## What it exercises

The standalone project copies four unchanged production Swift files and one reviewed XCTest class. It contains **one UI-test target, no application target/dependency, no launch action, and exactly one selected test**:

`WeddingPhotoboothSyntheticVisionProbeTests/testOwnerArmedSyntheticVisionOnPhysicalIPad`

The test uses only the bundled, generated fictional portrait `separated-portrait.png` (2,150,366 bytes, 1122 × 1402; SHA-256 `c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165`). It never reads camera frames, Photos, Keychain, sessions, app files or network data and never calls `XCUIApplication`.

It decodes the pinned image through the existing JPEG/colour-look pipeline, then runs three fresh Vision revision-3, CPU-only `.up` requests: **Warm 40% once, the same Warm `CGImage` again, then B&W 100%**. No hash or rendering materializes Warm pixels between those two requests. It records bounded anonymous face bounds, eye centres, spacing, roll, confidence and safe-effect placements, followed by seven synthetic JPEG attachments and a JSON report.

Coverage/alignment and B&W vector-colour assertions remain strict: two detected/usable faces, two safe effects, independent source-eye windows/roll/spacing, and more than 12 gold pixels in the encoded B&W crown output. The report does not turn missing effects into a pass. Unarmed, wrong-runner and simulator execution **fail**, rather than reporting a skipped success.

The overall work deadline is 150 seconds, each Vision request is capped at 40 seconds, and stop cancels the current request with one shared five-second drain. Late work cannot publish attachments or advance another sample. Native cancellation cannot forcibly interrupt an unresponsive framework call; an unacknowledged drain is an explicit failure and must stop the rehearsal. Source preparation does not prove physical M2 behaviour.

## Review and build provenance

Probe source SHA-256: `6f0416721c06d5cc8cabae1910ea7b8015a2ac80d030d7ef441d9faf8a025175`.

The generator pins every copied source and the fixture, verifies the complete generated inventory, and refuses source drift, existing output directories or redirects into public source. Private files are created owner-only. `vision-probe-plan.json` records the exact source hashes and generated project/scheme hashes.

The cloud compile lane uses a **fictional identity**, `NOT_ARMED`, Xcode 26.3, generic `iphoneos`, and `CODE_SIGNING_ALLOWED=NO`/`CODE_SIGNING_REQUIRED=NO`. The PNG is copied as opaque test data with compression and metadata stripping disabled, matching the native pixel lane. It verifies the actual built `.xctestrun` selects only this method, has no target app, remains unarmed, and bundles the exact uncompressed fixture. It publishes compile status/provenance and bounded redacted logs, not a runner app, raw `.xctestrun`, signing material or private identifiers. **Build-for-testing is zero XCTest executions and zero device-runtime proof.**

Validated producer commit: **`e4b4a57f53c3238dc5abd06e33e4ee10f654e44c`** on `codex/post-capture-face-effects`.

- **173/173** local CI contracts pass, including **27** preparation/build guard cases; zero skipped.
- [Linux CI 40540393296](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40540393296): **passed**.
- [Unsigned iOS build 40540393640](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40540393640): **passed**, Xcode 26.3, real generic `iphoneos` build-for-testing. The built `.xctestrun` remains `NOT_ARMED`; runner/test identities, sole selected method, exact bundled PNG and owned-process cleanup all passed. **Zero XCTest executions.**
- Earlier build [40539422776](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40539422776) compiled but failed the exact bundled-PNG check. Opaque copying and disabled PNG processing corrected packaging; the source fixture and its acceptance hash were not changed.

See the [machine-readable preparation report](../artifacts/test-results/synthetic-ipad-probe-preparation.json). A successful unsigned compile is preparation evidence; it does not clear the held feature's acceptance failures. No new full-app runtime, physical Vision or camera/Photos tests were executed in this phase.

## Future owner-attended preparation

These steps are for a future supported Mac session. They are not instructions for the current cloud agent to connect or execute on a device.

1. The coordinator confirms supported Mac access, owner availability and the actual wedding **M2 iPad Air**. Record the iPadOS and Xcode versions privately for comparison. The source only enforces physical iOS, not the device's processor model. Preserve the installed app, bundle identity, files and queue.
2. Reuse the **already authorized physical-test runner bundle ID and existing Apple team/certificate/profile** from private local records. Do not invent an identifier, create certificates/profiles, register devices, accept agreements or use automatic-provisioning flags. If the existing signing assets are unavailable, stop and report the missing asset.
3. In a private local shell, set `PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID` and `PHOTOBOOTH_DEVELOPMENT_TEAM` from those records. These are identifiers, not app/API secrets; still keep the generated project and diagnostics out of the public repository. Use a new directory inside ignored `.cache` or a private directory outside the checkout.
4. Generate the default **NOT_ARMED** project:

   ```bash
   node scripts/prepare-ios-vision-probe.mjs .cache/synthetic-ipad-probe --reuse-existing-runner
   ```

   This command only writes source/project files. An inherited `OWNER_READY` value does not arm it. The generated plan and test-action environment must be reviewed before any later signing or test action. There is no target app to rebuild or reinstall.
5. Only after supported access and owner readiness are confirmed, explicitly regenerate into a **new** private directory with both `PHOTOBOOTH_SYNTHETIC_VISION_PROBE=OWNER_READY` and `--owner-ready`. Neither value alone arms the project. Do not arm the unrelated physical capture-smoke runner or add its test to this selection.
6. A future authorized Mac operator may build/sign the dedicated runner using only existing assets, verify the actual `.xctestrun` runner identity and sole selected method, then execute that test on the agreed iPad. The cloud build's fictional runner is deliberately unusable for this purpose. This handoff does not execute or silently enable that step.
7. Stop on identity mismatch, unexpected security prompts, failed source/fixture verification, timeout or unacknowledged cancellation. Do not retry indefinitely, change thresholds to hide failures, or touch the stable app to diagnose this probe.
8. After the attended run, unset the readiness variable and return any retained test configuration to `NOT_ARMED`. Confirm owned test processes have stopped before cleanup. Retain the result privately for review; preserve all existing app data.

## Private evidence and conclusions

Expect seven named JPEGs: Warm 1 and Warm 2 each with Glasses, Tiara/Crown and Hearts; B&W with Crown. JSON attachment name: `synthetic-physical-vision-probe`. Failures may produce fewer attachments and a bounded stop reason; report the actual count.

XCTest can automatically collect device-context diagnostics even though this test adds only synthetic attachments. Keep the **entire physical result bundle private**. Publish only separately reviewed, allowlisted synthetic outputs/numeric facts; no raw device result bundle, screenshots, device IDs, accounts or signing metadata.

Compare repeated Warm geometry, source-eye alignment and B&W gold output with the existing simulator results. A physical pass or failure narrows the cause; it does not establish live tracking, general group coverage, wedding lighting/thermal performance, capture saving, export parity or app integration. Keep the original **27/29** result visible until those exact feature gates are genuinely resolved.

Before spending owner time on optional face effects, follow the [owner-attended release checklist](OWNER_ATTENDED_RELEASE_CHECKLIST.md): local saving and retakes, supported private pairing, approved queued upload, real-phone QR/downloads, then consent-based SMS within the coordinator's approved test allowance.
