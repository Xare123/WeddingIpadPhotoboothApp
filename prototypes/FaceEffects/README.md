# Isolated face-effects prototype

This is **not part of the wedding app**. It is a separate Swift package on `codex/face-effects-prototype`, based on the preserved `c692013` handoff / native-tested `9ed36b4` app source. No app import, Expo module, CocoaPods change, camera patch or autolinking entry consumes it. Do not switch the active Mac/iPad rehearsal checkout to this branch or install it as a replacement for 0.3.7.

The coordinator reports that signed 0.3.7/build10 is installed in place, with one physical startup/relaunch/orientation check passed and all110 existing saved entries preserved. That evidence belongs to the working app, not this prototype. Current capture/Photos/private-sharing acceptance remains separate.

## What this advances

| Component | Scope |
| --- | --- |
| `FaceGeometry` | Converts Vision face-local/bottom-left eyes into upright, unmirrored, top-left anchors; pixel-correct roll and original vector placements; maximum six usable faces; explicit invalid/small/profile fallback. Preview mapping demonstrates aspect-fill and one mirror transform only. |
| `FrameFreshnessGate` | Actor admission, one outstanding physical request, throttling, stale results/overlays, generation changes, None/background invalidation and pending-work acknowledgement. No camera ownership or face identity. The 150ms/10Hz defaults are proposed budgets, not measured performance. |
| `AppleFaceEffectsWorker` | CPU-only Apple Vision revision3 on an **already-upright CGImage**, followed by original glasses/crown/hearts vectors and a fresh sRGB JPEG. None/no usable face returns the exact input and no lossy re-encoding. Bounded one-job worker; cancellation is cooperative. |
| Shipping app | **Unchanged.** Existing Warm/B&W/Film remain post-capture looks. No face-effect picker, live tracking, live camera output, durable effect recipe or cloud publication is added. |

Apple Vision is an Apple platform framework, not an open-source lens library. This package has no third-party package dependency, downloaded model, telemetry, face recognition, embeddings, network, file/photo-library API or camera API. Accessory art and geometry code are original. The sole photo resource is an exact copy of an already-public generated fictional-adult fixture; provenance and SHA-256 are included.

## Meaningful validation gates

Linux has no Swift/Apple runtime in this environment. The local Node proof guards must pass, but cannot establish native behavior. The separate standard free macOS workflow must:

1. Prove every changed path is confined to this prototype and its independent runner. Compare against exact `c6920138de3fe239571b1c65cf6750dfd96664ff`; never relax the shipping app's20 native acceptance methods.
2. Typecheck all prototype source against the actual iOS16.4-targeted SDK using the selected Xcode26.3 toolchain. This is compilation, not an iOS simulator/device execution.
3. Execute **29 exact XCTest methods** in Release on macOS:10 geometry,13 freshness/ownership and6 Apple Vision/rendering cases. Require zero failures/skips, including actual face detection on the generated portrait, blank/None fallbacks, controlled native pixels, EXIF-normalized input/GPS scrubbing and deterministic busy/cancel behavior.
4. Verify three distinct actual JPEGs,960×1200, from the Apple test producer; inspect hashes and independent JPEG headers. Apple tests also decode the outputs with ImageIO and verify changed pixels/source preservation. Node validator fixtures are not native rendering evidence.

The workflow uploads only bounded logs, a source/case manifest, SwiftPM manifest, XCTest XML, result JSON and the three named **synthetic** JPEGs. No signing, simulator boot, Expo/Pods build, device grant, owner photo or production service is involved. Test evidence cannot replace a real iPad trial. Read the actual terminal run before reporting any native pass.

For an optional separate trusted Mac source checkout, without changing the active booth build:

```sh
swift test --configuration release --parallel --num-workers 2 --enable-xctest --disable-swift-testing \
  --package-path prototypes/FaceEffects --scratch-path /tmp/wedding-face-prototype-build
```

Tests read the bundled synthetic fixture. They write no image files unless `FACE_EFFECTS_EVIDENCE_DIR` is explicitly set; then only three fixed names are accepted without overwriting existing files. Never point that setting at an app container or owner Photos directory. Keep real-device diagnostics private.

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
