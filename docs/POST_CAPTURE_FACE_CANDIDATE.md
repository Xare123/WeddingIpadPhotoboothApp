# Post-capture accessories — isolated review candidate

Branch `codex/post-capture-face-effects` contains candidate **0.3.8/build11**. It is based on the stable MVP handoff `642a367`; the installed `9ed36b4` /0.3.7 build10 is unchanged. **No merge, deployment, signing change or installation is approved by this document.**

Current review status: native acceptance remains **27/29 passing**, with 19 JPEGs exported at `fc35797`. Neither the coordinate/lifetime probe nor the execution-policy/image-representation screen supports a production fix. Reliable two-person eye alignment remains blocked; production files are unchanged and the candidate stays isolated.

The reviewed still renderer from exact `9335c18` is copied into the existing local photo module. No camera, countdown, full-original camera patch, device orientation or sharing-provider changes are required. This feature is optional after capture, with **None** as the default. It does not provide live tracking.

## One approved file through the workflow

```mermaid
flowchart LR
  O[Untouched saved original] --> N[Colour look, then still accessory]
  N --> C[Full-size cache JPEG and effective recipe]
  C --> P[Guest preview]
  C -->|Apply: exact bytes and SHA checks| D[Separate durable document JPEG]
  D --> R[Review]
  D --> L[Photos export]
  D --> K[Keepsake sources]
  D --> U[Upload queue]
  O --> H[Retained original]
```

Choosing an edit renders from the root original. Apply copies the **same acknowledged preview file**, rather than rendering again or substituting another same-recipe image. The original and copied output SHA-256 are checked before the selection journal commits. A previously committed variant may be reused only when that exact ID/URI was previewed. Reopening it needs no native render.

The versioned recipe records `look-then-face`. Colour processing shares the existing Core Image look implementation, with no intermediate JPEG. Vision and accessories run on the resulting upright pixels; accessory colours remain intact. Nonidentity output is a fresh full-size sRGB JPEG without source GPS/EXIF. Identity returns the untouched original, including its existing metadata. Original files remain byte-identical. Each selected derivative keeps its root `sourcePhotoId`, so raw originals and primary edited downloads retain their existing separate roles.

## Safe choices and recovery

- None removes only the accessory, preserving a colour look. Identity recipes return the exact original URI.
- No face or no safe placement produces an effective None recipe, preserving any colour look. The UI explains the fallback. A partial placement reports its actual count without claiming all faces were decorated.
- Rapid changes cancel native work and wait for its acknowledgement before starting the latest choice. Stale results cannot replace the preview or enter a new guest's session.
- New derivative journals are never eligible for automatic selection. Copy, rename, hash, cancellation or journal failures retain original/host-recoverable bytes while leaving the previous selection in place. An admitted selection journal that already committed is recovered truthfully.
- Old four/five-photo and look-only sessions remain supported. A recovered legacy root can stay at `.draft.jpg` if its original rename cannot complete; treatment verification checks only that root ID's bounded JPEG paths and exact stored SHA, without renaming or promoting the original.
- Photos uses the selected durable URI and retains the existing uncertainty/deduplication rules. Unconfirmed or abandoned retake derivatives do not become upload jobs. Completed upload IDs and acknowledgement state remain unchanged during repair.
- Native cache leases prevent a new module instance from deleting another live instance's preview or in-progress temporary file. Releases remain confined to this engine's cache UUIDs.

## Review evidence and limits

The frozen local candidate passed **536 product tests, 149 CI contract tests, all workspace typechecks and an iOS Hermes export**, with no failed/skipped tests. The independent browser acceptance run passed **23 groups** and produced **30 screenshots** in both orientations; all 537 historical visual files remain unchanged. See [test record](../artifacts/test-results/post-capture-face-local.json), [UI evidence index](../artifacts/visual/face-effects-index.html) and [parity review](../artifacts/visual/face-effects-parity-review.md). Hosted results are recorded separately below.

Current local evidence includes 61 editor cases (21 unchanged legacy), 96 persistence/files/SQLite cases, six UI-message truth cases and two composed real-file routing cases. The routing cases verify cache/document/Photos-port/keepsake-source/upload-port byte identity and cancellation during a real copy. Native rendering, Photos, template raster and transport are substituted only at those test boundaries; they do not prove device behavior.

The hosted treatment pixel profile requires **29 real iOS simulator XCTest cases**: the original eight look and eleven template cases plus ten treatment cases. It also requires all **19 native JPEGs** (16 existing +3 treatment outputs), exact source/copy hashes and the unchanged generated PNG. The default pixel graph and full-app 20-case runtime gate remain separate. An unsigned nonfixture Release build checks the real module and bundled JS; compilation alone is not bridge/camera/Photos runtime proof.

Actual Root browser screenshots use explicitly labeled native-port substitutes and do not fabricate successful accessory pixels. Inspect the actual native treatment JPEGs for effect appearance. Physical iPad camera/Photos behavior, sustained latency/memory/thermal performance, real venue use and an owner-approved installation remain open. Cloud pairing and SMS remain independent; these tests send no real messages or photos to production.

Before proposing integration, review local/hosted results, inspect native output and both-orientation UI evidence, then complete the actual iPad rehearsal on a separately approved build. Preserve the stable wedding build throughout.

## Device acceptance after separate review and installation approval

The existing physical smoke runner checks capture/relaunch, not these accessories. Do not count its success as treatment acceptance or arm it automatically.

1. Preserve the installed app identity and all saved sessions. Use an approved harmless test subject; do not upload private photos or enable SMS as part of this check.
2. In a new four-photo review, choose Warm and an accessory. Wait for the actual rendered image, inspect both people/edges, then Apply. Compare the review image with the newly added Photos copy and the keepsake preview/export.
3. Reopen the edit and select None. Confirm the colour look remains and the untouched original is still available through host recovery. Cancel a different edit and confirm the selected photo stays unchanged.
4. Change choices rapidly, background during processing, and relaunch after an admitted save. Check that the selected derivative and recipe return, with no stale image, wrong guest or automatic selection of an abandoned result.
5. Check a no-face subject and a touching-head pair. None/fallback must remain usable and truthful; never force an accessory over another person's face. Check device rotation, unmirrored saved orientation and both layouts.
6. Rehearse individual and whole-session retakes, interruption and offline use without deleting prior originals. Measure actual response time and sustained memory/thermal behavior before enabling the option for wedding guests.

The first hosted Linux run (`40511920808`, source `9fa06d7`) stopped in physical-runner preparation contracts: its production guard intentionally accepted only 0.3.7/build10. The candidate retains that review and adds an exact 0.3.8/build11 and complete UI-source hash entry after source review. Unknown versions/builds or changed UI bytes remain rejected. Signing is disabled and readiness is still explicitly `NOT_ARMED`; this is unsigned source preparation, not authorization to install or run the candidate. All 149 complete preflight/treatment contracts pass locally after the repair.

## Actual Apple result and diagnostic follow-through

At source `6492010409d499399277ce9d0ecea6c911a1acc4`, hosted [Linux verification](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40512638138) and the [unsigned iPhoneOS Release build](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40512638110) passed. The [iOS pixel run](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40512638049) executed all 29 methods: **27 passed, two failed, none skipped**. All 19 native JPEGs were exported. The candidate does **not** pass native acceptance.

The public annotation identifies separated-pair Warm/glasses assertions: one decorated face instead of two, with partial instead of complete placement. The other failed method must be identified from the full result inventory; the first two assertion lines do not establish its identity. This pure Swift failure occurs before Expo/JavaScript conversion. PNG/JPEG conversion, colour processing and iOS/macOS Vision differences remain hypotheses, not established causes.

A test-only follow-up compares raw PNG, decoded root JPEG and the exact Warm pixel path on one iOS runtime. It emits bounded, SHA-guarded **fictional-fixture-only** geometry and actual unchanged placement results into `xcode-test.log` under indexed `SYNTHETIC_FACE_PLACEMENT_JSON_CHUNK i/n` lines of at most 6,000 payload bytes (concatenate payloads in order), with an attachment named `synthetic-face-placement-diagnostic`. All copied production sources and acceptance assertions remain unchanged. This diagnostic is not a fix or a claim of two-person success. The existing browser evidence fingerprints the earlier native test source; App, native production code and all browser-rendered inputs are unchanged.

The diagnostic-only revision `316ce2daf31e2149168c954ba1cb3bd1e0e881df` completed [Linux verification](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40516218265) successfully. Its [iOS run](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40516218241), job `122230704240`, again executed 29 methods: **27 passed, two failed, zero skipped; 19 JPEGs exported**. All 19 baseline methods passed. The failed methods are:

- `NativePhotoTreatmentEngineTests.testActualSeparatedPortraitDecoratesBothPeopleAfterLookWithoutReencodingIntermediate`
- `NativePhotoTreatmentEngineTests.testLookNoneMatchesExistingEnginePixelsAndRecipeOrderKeepsVectorColors`

The native production files, app and bridge are byte-identical to the successful unsigned Release revision. The Release lane was intentionally skipped for the diagnostic-only change. No production fix, merge, deployment or installation was performed.

### Exact blocker and next evidence

The executor could read public run status/annotations and initially read authenticated GitHub metadata. Official artifact downloads were denied with **Forbidden** at `productionresultssa4.blob.core.windows.net`; the official job-log read was denied at `results-receiver.actions.githubusercontent.com`. After an automatic executor recovery, the final `api.github.com` metadata read was also denied. Downloads did not complete; no alternate proxy, host, credential extraction or network grant was used.

An authorized coordinator must inspect the full assertion messages for the second method, the synthetic JSON chunks in `xcode-test.log` (or the JSON attachment), and the three actual treatment JPEGs. The retained artifact names are `native-pixels-evidence-316ce2daf31e2149168c954ba1cb3bd1e0e881df` and `native-pixels-jpegs-316ce2daf31e2149168c954ba1cb3bd1e0e881df`. Use an already authorized supported connector or an approved managed-access remedy. Do not repeat the unchanged run, relax protection/assertions, or infer a geometry/encoding fix from the two known method names alone.

The isolated candidate remains held. The installed wedding app remains 0.3.7/build10. Environment draft revision 30 still pins stable source `642a3676a4993ec9880f44e45ee2b6b48aaf7a8d`; it was not repinned to this experimental branch. Snapshot publication/fresh restoration is not established by these checks.

## Same-observation follow-up

The coordinator relayed synthetic measurements from its artifact copy acquired legitimately before the executor denial; no new transfer was performed. All three independent variants had confidence 1, all common admission flags true, no obstruction rectangles and two placements per style, while the production Warm/glasses receipt had one. Face boxes were stable but measured eye distances/roll changed sharply. The coordinator also observed small displaced glasses/crown and absent hearts in actual native output. These observations establish a real discrepancy; they do not establish its cause.

The observed CLI failure form was a Go URL transport error (`Get "https://…": Forbidden`), not an authenticated GitHub resource-permission response. The startup proxy policy is restricted and its 144 exact host rules contain none of the three denied hosts, with no wildcard rule. This is consistent with a proxy destination-policy rejection; runtime policy enforcement is reported as unknown, so the precise enforcement decision and the separate connector's authorization are not proven. No further artifact/log reads or network-grant changes are part of this follow-up.

The next test-only run publishes a **minimal generated-fixture numeric summary through normal existing CI output**, as authorized by the coordinator. It adds no HTTP request or new CI permission. A strict parser admits only the pinned fixture SHA, four fixed variant names, bounded numbers/booleans/null and known failure enums. Other fields/payloads are rejected without echo. All 155 local contract checks pass; the app, production Swift and acceptance assertions remain unchanged.

For each of PNG, decoded JPEG, Warm and B&W, this compares the manual eye projection with Apple's `pointsInImage(imageSize:)` on the same observations. The handler stays explicitly alive while whole-eye values are copied; the request/landmarks/regions stay alive after handler release. Whole-array and per-point rereads are compared with those snapshots. There are no extra repeat inference requests or enlarged timeouts. The ordering case retains the reference worker's full `Result` and reports it before any JPEG unwrap.

Public summary fields are deliberately small:

- `b`, `e`, `appleE`: face box, manual eyes and Apple-converted eyes in **normalized top-left image coordinates**.
- `appleDeltaMax`: manual face-box projection versus Apple conversion; `directDeltaMax`: unprojected normalized points versus Apple conversion, normalized by image size.
- `normalizedRepeatDelta`: maximum same-region coordinate change across before/after handler release and getter patterns; null means a required comparison was unavailable. `handlerReleased` reports actual weak-reference disappearance.
- `landmarkConfidence` is separate from detection confidence `c`. `admissionBits` uses six bits for confidence ≥0.5, minimum face width, eyes inside box, minimum eye distance, distance within face width and supported roll.
- `g`, `c`, `h` counts mean glasses, crown and hearts placements. `canonicalFull` uses Apple-converted anchors with the same unchanged safety geometry; no resulting image is substituted for the production render.
- The ordering summary distinguishes `success`, `failure` and `absent`; `referenceJpegPresent` and `goldPixelCount` are observed independently.

The selected iOS SDK compiled and executed this probe at `0fdaac7`; normal summaries do not change the required 29 passing cases or 19 JPEGs.

## Measured outcome and bounded backend control

[Run 40526129427](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40526129427), job `122266097603`, again executed 29 methods with 27 passing, the same two failing, none skipped and all 19 JPEGs exported. Its [public numeric notices](../artifacts/test-results/native-0fda-public-diagnostics.json) establish:

- Manual projection matched Apple's conversion exactly for usable eyes (`appleDeltaMax=0`); the unprojected points did not. Changing face-box scaling is not justified.
- No same-region value changes were observed across getter patterns and handler release (`normalizedRepeatDelta=0`, actual handler release true).
- Detection confidence was 1, but landmark confidence was lower and varied. In B&W the production and independent reference both completed successfully with two detections, zero usable landmarks, no accessory JPEG and zero ornament-gold pixels. Legacy colour-only JPEG bytes still matched.

The remaining discrepancy is in landmark inference/input processing, not demonstrated coordinate math, result-buffer lifetime or JPEG re-encoding. The copied prototype forces the deprecated CPU-only execution setting. The next test-only screen replaces the earlier four variant requests with **four requests on the same Warm pixels**: forced CPU versus untouched platform default, each with the CI-created image and with a separately owned RGBA bitmap. No requests or timeouts are added. The app renderer and all 29/19 acceptance requirements remain unchanged.

The fixed cell names are `warm-cpu-ci`, `warm-default-ci`, `warm-cpu-copy`, `warm-default-copy`. `cpuOnly` is the observed restriction property; default does not prove GPU/ANE use. `materialized` means an explicit owned bitmap copy only: production's four-argument `createCGImage` does not promise deferred evaluation. The first request precedes any diagnostic CGContext read; hashing after that request may warm the second. The copy is made only after both CI-created-image attempts. Exact canonical RGBA equality and matching post-request hashes are asserted, with measurements retained if an identity assertion fails.

Each normal notice includes the first 12 hash characters, bit depth, pixel depth, row stride, bitmap flags and an sRGB boolean. A per-cell inference error retains the other cells, reports a fixed domain label and exact Int32 code (null if outside that bound), and leaves unmeasured results null. The representation control changes provider/metadata as well as ownership, so it cannot alone prove a specific lifetime defect. There is no production fix or device-readiness claim. Local contract checks for this revision pass **156/156**.

The unchanged source PNG was independently viewed for a future alignment regression: image-left eyes tilt about +8–10° and image-right about −8–10° in top-left coordinates. A count of two placements is insufficient; any measured fix must also be checked against independently annotated eye-centroid windows and actual rendered output.

## Terminal control result and remaining gate

[Native run 40530206605](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40530206605), job `122280613750`, at `fc3579777840412576dd10a253aff3c3ab5bc18c` completed with **27/29 passing, the same two failures, zero skipped and 19 JPEGs exported**. [Linux verification](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40530206361) passed separately.

All four cells had canonical pixel hash prefix `72a92e976d8a`. The exact bitmap equality assertions passed. CI-created images had row stride 4544 / bitmap flags 1; owned copies had stride 4488 / flags 16385. The unchanged geometry reported:

| Cell | CPU restriction | Usable anchors | Placements glasses/crown/hearts | Both eyes aligned with independent source reference |
| --- | --- | --- | --- | --- |
| `warm-cpu-ci` | true | 2 | 2 / 2 / 2 | No |
| `warm-default-ci` | false | 2 | 2 / 2 / 2 | No |
| `warm-cpu-copy` | true | 2 | 2 / 2 / 2 | No |
| `warm-default-copy` | false | 1 | 1 / 1 / 1 | No |

See the [public numeric notices](../artifacts/test-results/native-fc35797-public-diagnostics.json) and [offline alignment analysis](../artifacts/test-results/synthetic-eye-alignment-fc35797.json). The latter compares Apple's reported eye centroids with manually authored, independently reviewed source windows and signed-roll/spacing ranges, frozen before reading this control result. It is not rendered-JPEG inspection or a general production threshold. No new fixture image or guest data was acquired.

The sequence of landmark-confidence pairs recurs by request position across the two runs despite changed image variants/settings. The fixed execution order remains a confound; this does not prove a simulator defect or a request-state cause. The screen supplies no reliable configuration to select. It specifically does **not** justify switching to default execution, copying buffers in production, changing face-box scaling, or relaxing safety/acceptance assertions.

**Exact remaining blocker:** trustworthy eye poses and correctly aligned two-person accessories are not demonstrated on the tested iOS runtime. Coordinate conversion agrees with Apple's API; snapshots do not mutate; legacy colour-only bytes match. Landmark inference/input-processing behavior remains unresolved. The production renderer is unchanged and the candidate is not ready to install or merge.

The next useful external gate is the same synthetic fixture/control on the actual M2 iPad, using a separately reviewed fixture-only test runner that does not launch or modify the booth app, capture, use Photos or contact cloud/SMS services. Reuse existing signing identity/profile only within owner authorization; do not create new provisioning or access grants silently. Source preparation and unsigned SDK compilation are now complete as documented below; no physical probe has been signed, installed or executed here. Do not substitute a macOS Vision pass or another unchanged hosted run for that evidence.

Independent native review recommends a minimal device discriminator: prepare one Warm 40% image, run the current revision-3 / CPU-only / upright request **twice on that same image**, then B&W once with fresh requests. Retain counts, landmark confidence, eye coordinates/roll and unchanged-geometry poses, plus actual Warm glasses/crown/hearts and B&W crown JPEGs. The repeated Warm input tests invocation variability without confounding it with a changed execution policy.

A fixture-only XCTest class can run inside the existing separately authorized UI-test runner identity; the existing capture-smoke class must not be selected. The prepared source uses only pure production Swift, the SHA-pinned bundled resource and managed synthetic attachments. It uses no `XCUIApplication`, launch/taps, camera, Photos, network, temporary-file writes or wedding-app Documents access. The installed 0.3.7 app cannot expose the new API without an update and is not part of this probe. Keep the device result bundle private; only provenance-checked synthetic attachments/numbers may be considered for publication. Reuse of existing signing assets, runner installation and actual device execution remain outstanding owner/coordinator-controlled work.

## Prepared physical probe — no device execution

At producer `e4b4a57f53c3238dc5abd06e33e4ee10f654e44c`, the separately reviewed source/generator and **173/173 local contracts** pass. [Unsigned generic iOS build 40540393640](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40540393640) passed with the actual built test configuration `NOT_ARMED`, the sole selected fixture test, exact bundled PNG and verified cleanup. [Linux CI](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40540393296) also passed. An earlier packaging hash failure was corrected without changing the fixture or relaxing acceptance.

This is **zero XCTest executions**, no physical Vision result and no change to the held **27/29** feature result. The Mac is not authorized for this task context; no device connection, signing/provisioning, installation, stable-app action or keep-awake was attempted. See the [synthetic probe handoff](SYNTHETIC_IPAD_PROBE_HANDOFF.md), [exact preparation report](../artifacts/test-results/synthetic-ipad-probe-preparation.json) and [core owner-attended release checklist](OWNER_ATTENDED_RELEASE_CHECKLIST.md). Pairing/upload/QR/SMS and retake rehearsal take priority over this optional probe.
