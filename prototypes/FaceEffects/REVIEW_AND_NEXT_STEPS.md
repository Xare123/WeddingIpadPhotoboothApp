# Still-effects acceptance and next steps

**V3 review source9335c18:**43 native methods, nine exports and both aggregate count files now pass. Both separated people receive every effect; touching heads retain two crowns and intentional one-person glasses/hearts fallback. Read the [integration decision](INTEGRATION_DECISION.md). Personal visual review and all app/live/device gates remain open.

This document belongs only to `codex/face-effects-prototype`. The installed wedding app stays at tested `9ed36b4` / 0.3.7 build10. The MVP review-branch handoff `642a367` changes documentation and test preparation, not the installed application. Do not merge, install or wire this prototype into the booth yet.

## Synthetic visual handoff

The latest native producer at exact `4c127fee22b0bbb90ba9639af07d78b684d38fea` passed **31 native XCTest methods, zero failures/skips**, and produced these three distinct 960×1200 JPEGs in [run40487787704](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40487787704), artifact `isolated-face-effects-4c127fee22b0bbb90ba9639af07d78b684d38fea`. The renderer is byte-identical to the prior 29-case checkpoint `537c352`; the two added tests exercise actual asymmetric native pixels:

| Actual output | Inspect at full size and normal viewing size |
| --- | --- |
| `portrait-glasses.jpg` | Both lens centers relative to both detected eyes, face roll, temple extent, overlap between people, legibility without obscuring expressions. |
| `portrait-crown.jpg` | Scale relative to the face, placement above the brow, head roll, top-edge clipping and overlap with the neighboring head. |
| `portrait-hearts.jpg` | Offset and scale relative to the face, natural spacing, head roll, edge clipping and overlap between neighboring faces. |

Compare each output with the unchanged [generated source](Tests/FaceEffectsPrototypeTests/Fixtures/portrait.jpg). Check the people, hair and clothing remain upright and unmirrored, with no change in framing or photo dimensions. Only this fictional-adult fixture and the original vector effects may be shared publicly. The [provenance record](Tests/FaceEffectsPrototypeTests/Fixtures/provenance.json) identifies the source.

**V1 visual signoff was declined.** The coordinator independently downloaded authorized artifact12725782780, verified hashes/bytes/960×1200 dimensions and personally inspected all three JPEGs. Crowns were oversized and too low across foreheads, glasses temples crossed neighboring faces, and hearts interleaved where heads touched. This cloud executor still has no supported artifact/Library transfer tool and has not received these rendered files; the concrete findings above are the coordinator's actual pixel review. Passing hashes, dimensions and pixel-change assertions did not establish visual quality. Local paths on another executor are not transferable references. Do not label a Canvas drawing, imagined overlay, or the unmodified source as a native rendered result.

A single portrait is not an occlusion or group acceptance suite. The still renderer draws original 2D vectors over image pixels; it does not segment hair, hands or foreground people to produce depth-aware occlusion. No live camera preview, frame tracking, smoothing or recognition has been implemented.

## V2 candidate acceptance

The repaired candidate retains all31 existing test identities and adds eight, for39 required native methods. Glasses keep centers anchored to both eyes while using thinner rims and shorter arms; crowns become smaller and higher; hearts become a compact row. Rotated pixel-space envelopes reject image-edge clipping and overlap with an already accepted ornament. Face bounds remain protective even when confidence is low or eye landmarks are missing. Most unsafe effects are suppressed; glasses alone can clip temples beside a reliable neighbor if both own eye cores remain clear. Native masks exclude every padded neighbor rectangle sequentially so overlapping holes cannot accidentally restore decoration. This can leave some close faces without an effect; it must never be described as depth-aware occlusion.

The refreshed artifact contains the three new actual-Vision portrait outputs plus `close-faces.jpg`, `rolled-faces.jpg` and `edge-faces.jpg`. The latter are native CoreGraphics diagnostic fixtures with controlled anchors and marked protected regions, not realistic people, detector results or app screens. Reviewers must compare portrait quality against the unchanged source and inspect the diagnostic omissions/collisions separately. Every output remains960×1200 and is labeled with its exact native XCTest producer in `report.json`. V1's31-case result cannot pass this expanded39-case/six-image gate. The first37-case v2 attempt at `d1dcfe9` failed on genuine over-suppression and a mispositioned rolled fixture; the original rendering assertions remain in force.

The repaired **e886ec596ab3b946f578289f29e0fafd90cd074a** passes [native40495695167](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40495695167), job122160447855, in1m18s:39 exact methods, zero failures/skips, all six JPEGs and iOS SDK typecheck. [Linux40495694869](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40495694869) passes in1m21s;11 local Node proof checks pass. Download artifact `isolated-face-effects-e886ec596ab3b946f578289f29e0fafd90cd074a` for the **new** acceptance review. Its pixels have not been seen in this executor. The installed9ed36b4/0.3.7 build10 and MVP642a367 remain unchanged.

The next visual pass must confirm the tiara sits higher without touching the neighboring brow/eye; both visible lens centers stay aligned and clipped temples end naturally; compact hearts do not interleave across faces. Effects may be omitted on close/uncertain faces. Inspect the masked portrait at100% and at normal viewing size, plus the rolled/edge diagnostic outcomes. **Do not merge or install this prototype from CI success alone.** Still rendering, useful clipping and safe fallback are not live tracking, multi-face quality acceptance or M2 iPad performance evidence.

## Focused regression addition

The tested `4c127fe` candidate retains every original native method and adds two deterministic cases: asymmetric upright pixels with known rolled eye anchors, and all eight EXIF orientations normalized explicitly by a caller before rendering. The latter tests the **caller contract**, not a shipping orientation adapter: the worker intentionally accepts already-upright, unmirrored pixels. Actual corner/edge colors and rendered content are checked, not only width and height. The native gate executed all 31 exact methods with zero failures/skips on macOS Release, and source also passed iOS SDK typechecking. These tests add no new public image filenames and do not alter the renderer. Neither macOS XCTest nor SDK typechecking proves iOS runtime behavior or live tracking.

## Bounded implementation order

1. **Finish still acceptance first.** Review all three native JPEGs and record exact source, output hashes and concrete observations. Correct only reproduced anchoring/rendering issues. Add deterministic regression fixtures for any correction. Cover a deliberate two-face group, roll, a partly hidden face and no usable face before presenting a reliable group feature; preserve the existing None fallback.
2. **If still effects pass, propose a post-capture integration separately.** Keep `expo-camera` and untouched originals. Re-detect on each actual saved still; persist only a versioned accessory recipe and a distinct, atomically completed derivative through the existing durable pipeline. Derive review/keepsake/export pixels from that completed derivative so the visible effect matches the saved result. Test interrupted rendering, stale selection, relaunch, filter/template order and retry without republishing an abandoned attempt. Label the choice as applying after capture.
3. **Treat live preview as a separate feasibility gate.** First prove a supported native camera-view/video attachment on the actual iPad without changing photo capture, original geometry, scanner or orientation behavior. Reuse the same vector geometry, apply crop/mirroring once and recheck generation at every UI/save admission. Do not depend silently on Expo private view fields or represent a repeated still render as live tracking. If there is no safe attachment, keep the enhancement post-capture.
4. **Measure on the real iPad before integration approval.** Use harmless, explicitly authorized subjects for groups, occlusion, crossings, both orientations, poor light, background/foreground and sustained use. Record measured latency, dropped frames, memory and thermal behavior. The prototype's proposed 150ms freshness and 10Hz admission defaults are not performance evidence. Overload or lost faces must clear overlays and leave ordinary capture available.

No prototype stage authorizes pairing, guest-photo upload, SMS, a device prompt or a change to the installed app. The existing private pairing handoff and physical retake checks remain separate owner-attended work.

## V3 two-scene evidence

The coordinator inspected the revised e886ec5 portrait JPEGs: right-face art was cleaner, while the left person lost every effect. That is a useful safe-fallback demonstration, not successful multi-person decoration. Current collision rectangles protect more area than just visible facial features. The new approach keeps that protection and tries a fixed set of six higher/compact crown or heart poses; it never moves glasses away from the eyes or shrinks the protected face regions. Suppression remains valid when all poses are unsafe.

The new [separated generated source](Tests/FaceEffectsPrototypeTests/Fixtures/separated-portrait.png) is an untouched1122×1402 PNG. Native acceptance must detect/landmark/decorate exactly two people for every style and verify changed native/decoded-JPEG pixels around each person. The existing960×1200 touching-head source stays unchanged and reports actual counts so a detector miss cannot be mislabeled as collision suppression.

| Evidence | Intended review |
| --- | --- |
| `separated-glasses.jpg`, `separated-crown.jpg`, `separated-hearts.jpg` | Both people receive each effect; unchanged1122×1402 framing, natural anchoring, round pearls and a smooth elegant diadem. |
| `portrait-glasses.jpg`, `portrait-crown.jpg`, `portrait-hearts.jpg` | Touching heads: inspect any restored safe above-head placements and any intentional omissions without demanding unsafe overlaps. |
| `close-faces.jpg`, `rolled-faces.jpg`, `edge-faces.jpg` | Controlled-anchor diagnostics, not detector/realistic portrait proof; protected regions and uncertain/edge cases remain safe. |
| `separated-coverage.json`, `touching-coverage.json` | Actual aggregate detected/landmarked/decorated counts per style; omission reasons are `detector-miss`, `landmarks-unusable` or `placement-protection`. These contain no face coordinates or identities. |

The small tiara now uses symmetric smooth arches and a fine circlet with physically round pearls. A nonsquare-canvas pixel test checks physical circles instead of trusting normalized widths. The exact new native exports still need a personal visual pass. Still tests do not close live-preview, actual camera orientation/mirroring, app preview/export parity, broad group quality or iPad performance gates.

Download **`isolated-face-effects-9335c1881901dde11da91cbcc1b5304033e25bdd`** from [native40501990970](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40501990970), job122181696272. Terminal success in1m43s verifies all43 exact methods with zero failures/skips, nine JPEGs, both count reports and iOS SDK typecheck. [Linux40501990986](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40501990986) passes in1m14s;13 local proof checks pass. The source and all11 code-input hashes are recorded in [VALIDATION.json](VALIDATION.json).

| Scene | Glasses | Tiara | Hearts |
| --- | --- | --- | --- |
| Separated pair | 2of2 | 2of2 | 2of2 |
| Touching heads | 1of2 | 2of2 | 1of2 |

Every row reports2detected/2landmarked. Thus touching omissions are placement protection, not detector or landmark failure. The counts come from the actual native producer and strict finish gate; this executor has not downloaded the raw artifact or viewed its new JPEGs. Review each natural placement/omission in the pixels before approval. The installed0.3.7 app and stable MVP642a367 remain unchanged.
