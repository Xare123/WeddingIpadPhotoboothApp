# Still-effects acceptance and next steps

This document belongs only to `codex/face-effects-prototype`. The installed wedding app stays at tested `9ed36b4` / 0.3.7 build10. The MVP review-branch handoff `642a367` changes documentation and test preparation, not the installed application. Do not merge, install or wire this prototype into the booth yet.

## Synthetic visual handoff

The latest native producer at exact `4c127fee22b0bbb90ba9639af07d78b684d38fea` passed **31 native XCTest methods, zero failures/skips**, and produced these three distinct 960×1200 JPEGs in [run40487787704](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40487787704), artifact `isolated-face-effects-4c127fee22b0bbb90ba9639af07d78b684d38fea`. The renderer is byte-identical to the prior 29-case checkpoint `537c352`; the two added tests exercise actual asymmetric native pixels:

| Actual output | Inspect at full size and normal viewing size |
| --- | --- |
| `portrait-glasses.jpg` | Both lens centers relative to both detected eyes, face roll, temple extent, overlap between people, legibility without obscuring expressions. |
| `portrait-crown.jpg` | Scale relative to the face, placement above the brow, head roll, top-edge clipping and overlap with the neighboring head. |
| `portrait-hearts.jpg` | Offset and scale relative to the face, natural spacing, head roll, edge clipping and overlap between neighboring faces. |

Compare each output with the unchanged [generated source](Tests/FaceEffectsPrototypeTests/Fixtures/portrait.jpg). Check the people, hair and clothing remain upright and unmirrored, with no change in framing or photo dimensions. Only this fictional-adult fixture and the original vector effects may be shared publicly. The [provenance record](Tests/FaceEffectsPrototypeTests/Fixtures/provenance.json) identifies the source.

**Visual signoff is pending.** The cloud executor currently has no supported artifact/Library transfer tool and has not received these JPEGs; passing hashes, dimensions and pixel-change assertions do not establish their appearance. A coordinator with artifact access can inspect them or transfer the three JPEGs and `report.json` through a supported attachment/public synthetic-evidence route. Local paths on another executor are not transferable references. Do not label a Canvas drawing, imagined overlay, or the unmodified source as a native rendered result.

A single portrait is not an occlusion or group acceptance suite. The still renderer draws original 2D vectors over image pixels; it does not segment hair, hands or foreground people to produce depth-aware occlusion. No live camera preview, frame tracking, smoothing or recognition has been implemented.

## Focused regression addition

The tested `4c127fe` candidate retains every original native method and adds two deterministic cases: asymmetric upright pixels with known rolled eye anchors, and all eight EXIF orientations normalized explicitly by a caller before rendering. The latter tests the **caller contract**, not a shipping orientation adapter: the worker intentionally accepts already-upright, unmirrored pixels. Actual corner/edge colors and rendered content are checked, not only width and height. The native gate executed all 31 exact methods with zero failures/skips on macOS Release, and source also passed iOS SDK typechecking. These tests add no new public image filenames and do not alter the renderer. Neither macOS XCTest nor SDK typechecking proves iOS runtime behavior or live tracking.

## Bounded implementation order

1. **Finish still acceptance first.** Review all three native JPEGs and record exact source, output hashes and concrete observations. Correct only reproduced anchoring/rendering issues. Add deterministic regression fixtures for any correction. Cover a deliberate two-face group, roll, a partly hidden face and no usable face before presenting a reliable group feature; preserve the existing None fallback.
2. **If still effects pass, propose a post-capture integration separately.** Keep `expo-camera` and untouched originals. Re-detect on each actual saved still; persist only a versioned accessory recipe and a distinct, atomically completed derivative through the existing durable pipeline. Derive review/keepsake/export pixels from that completed derivative so the visible effect matches the saved result. Test interrupted rendering, stale selection, relaunch, filter/template order and retry without republishing an abandoned attempt. Label the choice as applying after capture.
3. **Treat live preview as a separate feasibility gate.** First prove a supported native camera-view/video attachment on the actual iPad without changing photo capture, original geometry, scanner or orientation behavior. Reuse the same vector geometry, apply crop/mirroring once and recheck generation at every UI/save admission. Do not depend silently on Expo private view fields or represent a repeated still render as live tracking. If there is no safe attachment, keep the enhancement post-capture.
4. **Measure on the real iPad before integration approval.** Use harmless, explicitly authorized subjects for groups, occlusion, crossings, both orientations, poor light, background/foreground and sustained use. Record measured latency, dropped frames, memory and thermal behavior. The prototype's proposed 150ms freshness and 10Hz admission defaults are not performance evidence. Overload or lost faces must clear overlays and leave ordinary capture available.

No prototype stage authorizes pairing, guest-photo upload, SMS, a device prompt or a change to the installed app. The existing private pairing handoff and physical retake checks remain separate owner-attended work.
