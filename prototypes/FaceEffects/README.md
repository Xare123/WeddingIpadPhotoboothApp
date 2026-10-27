# Isolated face-effects prototype

**Tested v3 source9335c18:**43 exact native methods pass with nine native JPEGs and two scene-coverage JSON files. Both separated people receive every effect. Touching heads retain both crowns, with intentional one-person fallback for glasses/hearts. New rendered-pixel visual approval and app/device integration remain open. Read the [integration decision](INTEGRATION_DECISION.md) before proposing an app change.

This is **not part of the wedding app**. It is a separate Swift package on `codex/face-effects-prototype`, based on the preserved `c692013` handoff / native-tested `9ed36b4` app source. No app import, Expo module, CocoaPods change, camera patch or autolinking entry consumes it. Do not switch the active Mac/iPad rehearsal checkout to this branch or install it as a replacement for 0.3.7.

The coordinator reports that signed 0.3.7/build10 is installed in place, with physical startup/relaunch/orientation plus a separate four-ceiling-photo persistence/timing/relaunch check passed, with all110 prior saved entries unchanged. That evidence belongs to the working app, not this prototype. Individual/whole-shoot retakes and independent Photos inspection on that run remain unverified; private sharing is still separate.

## What this advances

| Component | Scope |
| --- | --- |
| `FaceGeometry` | Upright, unmirrored anchors; pixel-correct roll; at most six faces. V3 tries up to six compact/higher crown/heart poses, repeating unchanged neighbor/effect/edge protection for every pose. Glasses remain eye-locked with guarded clipping. Preview mapping demonstrates aspect-fill and one mirror transform only. |
| `FrameFreshnessGate` | Actor admission, one outstanding physical request, throttling, stale results/overlays, generation changes, None/background invalidation and pending-work acknowledgement. No camera ownership or face identity. The 150ms/10Hz defaults are proposed budgets, not measured performance. |
| `AppleFaceEffectsWorker` | CPU-only Apple Vision revision3 on an **already-upright CGImage**, followed by original glasses/crown/hearts vectors and a fresh sRGB JPEG. None/no usable face returns the exact input and no lossy re-encoding. Bounded one-job worker; cancellation is cooperative. |
| Shipping app | **Unchanged.** Existing Warm/B&W/Film remain post-capture looks. No face-effect picker, live tracking, live camera output, durable effect recipe or cloud publication is added. |

Apple Vision is an Apple platform framework, not an open-source lens library. This package has no third-party package dependency, downloaded model, telemetry, face recognition, embeddings, network, file/photo-library API or camera API. Accessory art and geometry code are original. The sole photo resource is an exact copy of an already-public generated fictional-adult fixture; provenance and SHA-256 are included.

## Meaningful validation gates

Linux has no Swift/Apple runtime in this environment. The local Node proof guards must pass, but cannot establish native behavior. The separate standard free macOS workflow must:

1. Prove every changed path is confined to this prototype and its independent runner. Compare against exact `c6920138de3fe239571b1c65cf6750dfd96664ff`; never relax the shipping app's20 native acceptance methods.
2. Typecheck all prototype source against the actual iOS16.4-targeted SDK using the selected Xcode26.3 toolchain. This is compilation, not an iOS simulator/device execution.
3. The **v3 candidate requires43 exact XCTest methods** in Release on macOS:17 geometry,13 freshness/ownership and13 Apple Vision/rendering cases, with zero failures/skips. It retains all39 previous identities and adds bounded placement, actual separated two-person coverage and nonsquare pearl regressions. Previous results below do not validate the changed v3 renderer.
4. Verify nine distinct native JPEGs: three touching-head portrait stills plus three controlled-anchor diagnostics at960×1200, and three separated-pair stills at the untouched source's1122×1402. Each style must decorate both separated people and change actual native/decoded-JPEG pixels around each person. Two strict aggregate scene files distinguish detector misses, unusable landmarks and placement protection. Inspect hashes, producer labels and independent headers. Node parser fixtures are not native rendering evidence.

The workflow uploads only bounded logs, a source/case manifest, SwiftPM manifest, XCTest XML, result JSON, two aggregate scene JSON files and the nine named **synthetic** JPEGs. No face coordinates/identities are written. No signing, simulator boot, Expo/Pods build, device grant, owner photo or production service is involved. Test evidence cannot replace a real iPad trial. Read the actual terminal run before reporting any native pass.

For an optional separate trusted Mac source checkout, without changing the active booth build:

```sh
swift test --configuration release --parallel --num-workers 2 --enable-xctest --disable-swift-testing \
  --package-path prototypes/FaceEffects --scratch-path /tmp/wedding-face-prototype-build
```

Tests read two exact, generated fictional-adult fixtures with pinned hashes. They write no evidence unless `FACE_EFFECTS_EVIDENCE_DIR` is explicitly set; then only nine fixed JPEG names and two fixed aggregate JSON names are accepted without overwriting files. Never point that setting at an app container or owner Photos directory. Keep real-device diagnostics private.

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

The first v2 run, [40493829745](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40493829745) at `d1dcfe9`, failed actual native assertions: the coarse envelope suppressed all glasses on the close portrait, and a rolled diagnostic obstacle did not actually cross the intended glasses. The repair adds guarded clipping and corrects that fixture; it preserves the original actual-Vision/nonempty/changed-pixel assertions.

Exact **e886ec596ab3b946f578289f29e0fafd90cd074a** now passes [native40495695167](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40495695167), job122160447855, in1m18s: **39 exact native methods, zero failures/skips; six native JPEGs; iOS SDK typecheck**. [Linux40495694869](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40495694869) passes in1m21s. All11 local proof checks pass. The artifact is `isolated-face-effects-e886ec596ab3b946f578289f29e0fafd90cd074a`; [the validation record](VALIDATION.json) preserves all11 exact source-input hashes, both image producer identities and the remaining gates.

**The new pixels still need visual approval.** This executor has not downloaded or viewed the six JPEGs. Passing native protected-pixel tests does not establish attractive scale, anchoring or natural clipping on the real portrait. The coordinator should inspect the three portrait JPEGs and controlled diagnostics from that exact artifact; the earlier v1 visual rejection remains historical evidence, not v2 approval. No live feature, app integration or installation occurred; the working0.3.7 app stays unchanged.

## V3 multi-person assessment candidate

The coordinator subsequently inspected the e886ec5 portrait outputs: right-face glasses, smaller crown and compact hearts were cleaner, but every effect disappeared from the left person. This is a safe fallback demonstration, **not successful multi-person decoration**. V3 preserves the same protected face rectangles while trying bounded, higher/slightly smaller crown/heart placements. Glasses never move away from their eyes. If no pose is safe, the effect remains omitted.

The tiara is now a small smooth symmetric scalloped circlet with a fine band and round pearls, replacing irregular zigzags. Physical pearl scaling accounts for both image axes; the nonsquare native pixel regression checks the actual opaque cream core against an independent native color swatch. A newly generated alcohol-free, separated pair at1122×1402 receives two actual-Vision decorations for every style. Touching-head results remain separate and report truthful aggregate reasons. Both source files remain unchanged. [Provenance](Tests/FaceEffectsPrototypeTests/Fixtures/provenance.json) and the [integration decision](INTEGRATION_DECISION.md) identify the exact source and open gates.

Exact **9335c1881901dde11da91cbcc1b5304033e25bdd** passes [native40501990970](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40501990970), job122181696272, in1m43s:43 exact methods, zero failures/skips, nine native JPEGs, both count files and iOS SDK typecheck. [Linux40501990986](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40501990986) passes in1m14s;13 local proof checks pass. The first two v3 attempts exposed test-fixture measurement/spacing assumptions, repaired without changing the v3 renderer or weakening genuine protection.

The strict finish gate reports separated2detected/2landmarked/2decorated for every effect. Touching heads report2detected/2landmarked throughout, with glasses1/2, crowns2/2 and hearts1/2: the omissions are placement protection, not detector misses. Artifact `isolated-face-effects-9335c1881901dde11da91cbcc1b5304033e25bdd` contains the exact new outputs and `report.json`. **This executor has not downloaded or viewed those nine outputs; personal visual approval is pending.** Native still-image success is not live-preview, app export-parity or actual-iPad proof. No merge or installation occurred.
