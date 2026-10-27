# Isolated face-effects prototype

This is **not part of the wedding app**. It is a separate Swift package on `codex/face-effects-prototype`, based on the preserved `c692013` handoff / native-tested `9ed36b4` app source. No app import, Expo module, CocoaPods change, camera patch or autolinking entry consumes it. Do not switch the active Mac/iPad rehearsal checkout to this branch or install it as a replacement for 0.3.7.

The coordinator reports that signed 0.3.7/build10 is installed in place, with physical startup/relaunch/orientation plus a separate four-ceiling-photo persistence/timing/relaunch check passed, with all110 prior saved entries unchanged. That evidence belongs to the working app, not this prototype. Individual/whole-shoot retakes and independent Photos inspection on that run remain unverified; private sharing is still separate.

## What this advances

| Component | Scope |
| --- | --- |
| `FaceGeometry` | Converts Vision face-local/bottom-left eyes into upright, unmirrored, top-left anchors; pixel-correct roll and original vector placements; maximum six usable faces. The v2 candidate adds smaller ornaments and conservative neighbor/effect/edge suppression. Preview mapping demonstrates aspect-fill and one mirror transform only. |
| `FrameFreshnessGate` | Actor admission, one outstanding physical request, throttling, stale results/overlays, generation changes, None/background invalidation and pending-work acknowledgement. No camera ownership or face identity. The 150ms/10Hz defaults are proposed budgets, not measured performance. |
| `AppleFaceEffectsWorker` | CPU-only Apple Vision revision3 on an **already-upright CGImage**, followed by original glasses/crown/hearts vectors and a fresh sRGB JPEG. None/no usable face returns the exact input and no lossy re-encoding. Bounded one-job worker; cancellation is cooperative. |
| Shipping app | **Unchanged.** Existing Warm/B&W/Film remain post-capture looks. No face-effect picker, live tracking, live camera output, durable effect recipe or cloud publication is added. |

Apple Vision is an Apple platform framework, not an open-source lens library. This package has no third-party package dependency, downloaded model, telemetry, face recognition, embeddings, network, file/photo-library API or camera API. Accessory art and geometry code are original. The sole photo resource is an exact copy of an already-public generated fictional-adult fixture; provenance and SHA-256 are included.

## Meaningful validation gates

Linux has no Swift/Apple runtime in this environment. The local Node proof guards must pass, but cannot establish native behavior. The separate standard free macOS workflow must:

1. Prove every changed path is confined to this prototype and its independent runner. Compare against exact `c6920138de3fe239571b1c65cf6750dfd96664ff`; never relax the shipping app's20 native acceptance methods.
2. Typecheck all prototype source against the actual iOS16.4-targeted SDK using the selected Xcode26.3 toolchain. This is compilation, not an iOS simulator/device execution.
3. The **v2 candidate requires39 exact XCTest methods** in Release on macOS:15 geometry,13 freshness/ownership and11 Apple Vision/rendering cases, with zero failures/skips. It retains all31 previous identities and adds neighbor/collision/edge and clipping regressions. The verified v1 checkpoints below cover29 and31 methods; they do not validate the changed v2 renderer.
4. Verify six distinct actual JPEGs,960×1200, from the Apple test producers: three actual-Vision portrait stills and three deterministic controlled-anchor diagnostics. Inspect hashes, producer labels and independent JPEG headers. Apple tests also decode the outputs with ImageIO and verify changed/protected pixels and source preservation. Node validator fixtures are not native rendering evidence.

The workflow uploads only bounded logs, a source/case manifest, SwiftPM manifest, XCTest XML, result JSON and the six named **synthetic** JPEGs. No signing, simulator boot, Expo/Pods build, device grant, owner photo or production service is involved. Test evidence cannot replace a real iPad trial. Read the actual terminal run before reporting any native pass.

For an optional separate trusted Mac source checkout, without changing the active booth build:

```sh
swift test --configuration release --parallel --num-workers 2 --enable-xctest --disable-swift-testing \
  --package-path prototypes/FaceEffects --scratch-path /tmp/wedding-face-prototype-build
```

Tests read the bundled synthetic fixture. They write no image files unless `FACE_EFFECTS_EVIDENCE_DIR` is explicitly set; then only six fixed names are accepted without overwriting existing files. Never point that setting at an app container or owner Photos directory. Keep real-device diagnostics private.

## Before any live feature or app integration

- Prove a supported RN/Fabric camera-view attachment and video-output capacity on the actual M2 iPad without changing the PhotoOutput, full-original preservation, capture preset or existing scanner. Expo Camera58 has no public frame-processor API. Do not depend silently on its private `_cameraRef` or add a camera-stack replacement.
- Feed one consistent monotonic clock to the frame gate. Native cancellation cannot atomically revoke a callback already being delivered: every UI/save admission must recheck its current ticket/generation. Do not release physical ownership merely because None/background was selected.
- A preview layer and a captured still can differ in crop, orientation, mirroring, FOV and time. Detect on the actual saved original for final decoration. Never scale the last live overlay into a final photo or replace the original with a screenshot. All eight source orientations and both landscape directions still need integration tests.
- Keep face geometry ephemeral and unlogged. Persist only a chosen accessory identifier and the flattened derivative through the existing durable pipeline, with untouched originals and explicit save/export acknowledgement. Derive review thumbnails from the actual final derivative to avoid pretending two independent detection passes are identical.
- Factor the same original vector paths into any future live layer; do not implement a separate CSS/emoji approximation. This package currently proves a still renderer and placement math, not a live overlay.
- Rehearse groups, occlusion, varied skin tones/lighting, crossings, small/distant faces, lost faces, reduced motion, latency, memory and thermal pressure on the actual iPad. No face association/smoothing or stable-person identity is implemented here. On failure/overload keep None and the ordinary camera available.

Keep the reliable wedding app available throughout. Do not hold its installation, durable saving or private sharing for this enhancement. No Snapchat/Lens parity or live-tracking readiness is claimed.

## Initial native harness result

At6edb84d, [prototype run40477207626](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40477207626) failed in1m36s at evidence collection because `tests.xml` was absent; [Linux40477207510](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40477207510) passed in1m40s. Do not infer verified native counts from that failed evidence gate. Official [SwiftPM6.3 source](https://github.com/swiftlang/swift-package-manager/blob/swift-6.3-RELEASE/Sources/Commands/SwiftTestCommand.swift#L306) calls its xUnit generator only inside the parallel-runner branch. The bounded repair adds `--parallel --num-workers 2`; it keeps the native implementation and all29 required cases unchanged. A fresh exact-source result is required.

## Verified prototype checkpoint

Exact **537c352f4a0ca56cb4d82582911549d10c16b8cd** now passes [the isolated Apple workflow40477995823](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40477995823), job122100889924, in1m28s: **29 exact native methods, zero failures/skips, iOS SDK typecheck and three distinct native still JPEGs**. [Linux40477995974](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40477995974) passes in1m24s;11 local Node proof cases pass. [The validation record](VALIDATION.json) preserves exact source hashes and boundaries. The native artifact is named `isolated-face-effects-537c352f4a0ca56cb4d82582911549d10c16b8cd`; its three synthetic images await independent visual review by the coordinator. This cloud executor has not downloaded or viewed those outputs. Documentation-only follow-up does not change the tested native implementation or runner.

The public artifact contains actual still-renderer evidence, not app screenshots or live tracking. It is not included in the shipping app or installed on the iPad. Keep the existing wedding app branch/candidate unchanged while deciding whether any later integration is worthwhile.

The [review handoff and staged plan](REVIEW_AND_NEXT_STEPS.md) records the three actual output names, the outstanding pixel review, the focused asymmetric regression candidate and the gates before post-capture or live integration. Still-image XCTest success is not live tracking or physical-device acceptance.

Latest exact **4c127fee22b0bbb90ba9639af07d78b684d38fea** passes [native40487787704](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40487787704), job122133828705, in1m39s: **31 exact native tests, zero failures/skips**, iOS SDK typecheck and all three native still JPEGs. [Linux40487787627](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40487787627) passes in1m23s. All11 local Node proof checks pass; independent source review found no blocker in the added asymmetric fixtures or hardcoded EXIF permutations. The original29 test identities remain, all three renderer sources are unchanged, and no shipping app path changed. The latest artifact is `isolated-face-effects-4c127fee22b0bbb90ba9639af07d78b684d38fea`; actual output visual inspection remains blocked on supported transfer to this executor. No live feature has been integrated or installed.

## V2 visual refinement candidate

The coordinator independently downloaded authorized artifact12725782780 from the31-case run, verified its hashes/960×1200 dimensions and personally viewed all three native JPEGs. **Visual quality was not approved:** crowns were too large and low, glasses temples crossed the neighboring face, and hearts interleaved when heads touched. The cloud executor has seen the original generated portrait but not these rendered artifact files; this refinement uses the coordinator's concrete pixel findings.

V2 reduces and raises crowns, narrows glasses and shortens their arms, and reduces the heart cluster. Automatic geometry conservatively rejects a rotated effect envelope that crosses an image edge or an already accepted ornament. Other faces' padded bounds remain protective regardless of confidence or eye usability. Crowns/hearts and uncertain neighbors use conservative suppression. Glasses may trim temples beside a reliably detected neighbor only when both own eye cores stay clear: explicit per-placement exclusions clip every protected rectangle in the native renderer. Overlapping exclusions must intersect sequentially, never re-include their overlap through one combined even-odd mask. This is bounding-box protection and may omit an effect on close or partly hidden faces; it is **not** semantic hair/hand segmentation or depth-aware occlusion.

The first v2 run, [40493829745](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40493829745) at `d1dcfe9`, failed actual native assertions: the coarse envelope suppressed all glasses on the close portrait, and a rolled diagnostic obstacle did not actually cross the intended glasses. The repair adds guarded clipping and corrects that fixture; it preserves the original actual-Vision/nonempty/changed-pixel assertions. Fresh39-case native execution, six exports and a new visual acceptance pass remain required. V1 native success is not v2 acceptance. The installed app is unchanged.
