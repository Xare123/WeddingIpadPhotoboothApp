# LOCAL UNPUBLISHED — five-photo session browser evidence

**Local working-tree review only: not committed, pushed, uploaded, deployed or run in remote CI by this refresh.** The last published baseline is commit `5ef615eaf228776dcdedc0df3f0fe65ba55976f9`, whose App SHA-256 is `a2d8e4f62b855c54e489d8311ba6fb794b59f3e7a71e9dd521827332ab6d5548`. The files below show unpublished changes, not a newly published build.

**Browser fixtures, not iOS screenshots or native-device proof.** The actual [App.tsx](../../apps/ipad/App.tsx), capture/review controllers, wedding/count presenter, host original actions, photo exporter, readiness helper and SMS capability component execute through React Native Web. Camera, private files, SQLite, the native MediaLibrary SDK, authentication and sync use explicit synthetic adapters. Every screenshot and video retains the browser-fixture banner.

Current UNPUBLISHED App source SHA-256: `4a68c3dc73d449eac889b4c79defafd2bb190ed9e8932b3672bb8b1fb9dec01e`.

[Machine-readable checks](new-session-checks.json) contain matching hashes for the App, capture/review helpers, sharing/SMS sources and generated scene, verified before and after recording. [Bundle boundary evidence](new-session-bundle-boundary.json) records excluded native implementations and the disabled native XCTest fixture. All views use `America/Los_Angeles`.

## Watch the actual interaction

- [Local portrait WebM — 28.5 seconds, 820×1180](new-session-demo-portrait.webm)
- [Local landscape WebM — 28.3 seconds, 1180×820](new-session-demo-landscape.webm)

Both recordings show the unaccelerated three-second automatic five-photo sequence, pause/continue, trusted touch swipe, immediate thumbnail 3 → Retake, offline sharing, synthetic all-five readiness, and Next guests. The files are VP8 WebM at 25 fps, inspected with FFprobe; a recorded countdown frame was also visually inspected. No camera/audio feed or real guest data is used.

## Inspect the rendered screens

| State | Portrait | Landscape |
| --- | --- | --- |
| Generated attract scene | [View](new-session-attract-portrait.png) | [View](new-session-attract-landscape.png) |
| Large camera preview | [View](new-session-camera-portrait.png) | [View](new-session-camera-landscape.png) |
| Countdown, progress and saved strip | [View](new-session-camera-progress-portrait.png) | [View](new-session-camera-progress-landscape.png) |
| Paused session | [View](new-session-paused-portrait.png) | [View](new-session-paused-landscape.png) |
| Five-photo review | [View](new-session-review-portrait.png) | [View](new-session-review-landscape.png) |
| Review after touch swipe | [View](new-session-review-swiped-portrait.png) | [View](new-session-review-swiped-landscape.png) |
| Photo3 individually retaken | [View](new-session-review-retake-portrait.png) | [View](new-session-review-retake-landscape.png) |
| Offline session sharing | [View](new-session-pending-portrait.png) | [View](new-session-pending-landscape.png) |
| All five ready, one session QR | [View](new-session-ready-portrait.png) | [View](new-session-ready-landscape.png) |
| Next guests, prior selection cleared | [View](new-session-next-guests-portrait.png) | [View](new-session-next-guests-landscape.png) |
| Photos permission denied | [View](new-session-photos-denied-portrait.png) | [View](new-session-photos-denied-landscape.png) |

Additional states: [Photos result uncertain](new-session-photos-uncertain-portrait.png), [private-save error/retry](new-session-save-retry-portrait.png), [reduced-motion countdown](new-session-reduced-motion-countdown-portrait.png), [after interruption](new-session-interrupted-portrait.png), [host controls](new-session-host-controls-portrait.png), [saved-session library](new-session-host-library-portrait.png), [opened local session](new-session-host-library-session-portrait.png), and [blank private setup](new-session-host-setup-portrait.png).

New host reliability views: [duplicate-risk confirmation](new-session-host-duplicate-confirmation-portrait.png), [already-in-Photos confirmation](new-session-host-acknowledge-confirmation-portrait.png), [retained original](new-session-host-retained-original-portrait.png), [retained export resolved](new-session-host-retained-exported-portrait.png), [staged exposure with zero saved](new-session-staged-0-saved-portrait.png), [staged host action with zero saved](new-session-host-staged-0-saved-portrait.png), [four saved plus one staged](new-session-staged-4-saved-portrait.png), [host action for the fifth staged exposure](new-session-host-staged-4-saved-portrait.png), and [index repair before](new-session-host-index-repair-before-portrait.png) / [after](new-session-host-index-repair-after-portrait.png).

## Findings and verified repairs

The local run passed both complete recorded workflows, six bounded adapter checks, six new host reliability checks, eight selected contrast checks, and 22 exact full-frame QR decodes in **both jsQR 1.4.0 and ZXing-C++ through zxing-wasm 3.1.6**. It recorded zero browser errors and zero unexpected external requests. All 60 screenshots were captured from the actual JSX, with enabled button bounds at least 44 × 44 CSS pixels and no horizontal overflow. Longer host-original lists intentionally scroll vertically.

Wedding identity is now “Gizelle & Rami · November 1, 2026”, saved thumbnails visibly retain numbers 1–5, and review teaches “Swipe photos · tap a thumbnail”. The zero-saved failure footer explicitly says “Photo 1 still needs saving · No photos saved on this iPad yet”. Offline sharing explicitly says “No download link yet”. Assertions use rendered text and the actual saved count. The pending-sharing PNGs wait until every ancestor fade is opaque; review-swiped PNGs wait for the exact second-page offset. Both require four stable rendered frames. These static waits occur before the fast thumbnail-selection action and do not alter its no-wait regression.

The camera occupies 95.6% of portrait width and 96.9% of landscape width, with approximately 74% of viewport height in each orientation. Review is 784 × 803 in portrait and 820 × 716 in landscape. The landscape stage was enlarged from 54.0% to **87.3% of viewport height**, with controls in a narrow side rail. `contain` preserves the whole generated portrait image, so landscape review has expected sidebars. Attract, camera/countdown, review, share, save-error and host views were visually inspected; the layout, typography and action hierarchy remain clear in the final set.

A real fast-selection race was found and fixed in the App. Historical reports preserve [the original failure](new-session-fast-retake-before-fix.json) and [the first source fix](new-session-fast-retake-after-fix.json). The current unpublished run repeats that exact action block: thumbnail 3 is tapped and Retake is requested immediately, **without an actor offset wait or settling sleep**. The label/camera action remain “Retake photo 3”, only slot 3 changes, and the other four selected IDs and previous in-memory exposure remain intact in both orientations. The current results and exact source hashes are in `new-session-checks.json`; the historical reports deliberately retain their older hashes. This verifies the browser-native-JSX event flow, not physical iPad touch timing.

Progress chips were also moved above the countdown shade. Computed styles give contrast 8.100:1 for the attract eyebrow over a hypothetical white image, 6.220:1 for countdown text over its actual shade plus a white frame, 11.896:1 for photo progress above the shade, and 8.960:1 for the QR caption. All exceed 4.5:1. Reduced-motion digits remain at scale/opacity 1; a synthetic background event prevents exposure after the countdown and returns to a paused camera. These bounded checks are not a full native accessibility audit.

The actual JavaScript flow awaits each synthetic private-save promise before advancing, exposes only the saved slots in the strip, retains five selected originals on Photos denial, and reports unconfirmed Photos results without a no-op retry. A simulated private-save failure retries the same exposure without another camera-adapter call. Five upload acknowledgments alone do not reveal a QR; the synthetic all-five session-ready acknowledgment is also required. Next guests removes the prior session, shot routes and QR from the guest screen while keeping the in-memory host history.

The actual host and Photos-export controllers now run against synthetic SDK/storage ports. Canceling uncertain export or acknowledgment changes no status and makes no copy. Explicit duplicate-risk confirmation exports only one selected original; “Already in Photos” records one checked status without invoking the copy API. A retained take can be exported individually while remaining absent from guest selections and jobs. Staged exposures contribute neither saved count nor Photos candidates: the tested counts remain 0 or 4 until “Finish local save” completes, then become 1 or 5. A zero queue with pending index repair remains visibly incomplete; a simulated local repair recreates five pending selected jobs while offline. These checks validate actual UI/controller contracts. Native filesystem/SQLite repair and the production queue drain are simulated here, not proven by this browser run.

## QR and privacy scope

Twenty static QR cases cover portrait/landscape at DPR 1/2 with the original reserved token, a production-shaped hostname with a fabricated 64-character hex token, numeric-heavy 64-character tokens, and short reserved `a.example`. Two additional decoded frames come from the complete recorded sessions after retaking photo 3. All are **full-frame PNG decodes**, without crop, resizing, sharpening, thresholding or expected-payload hints. The rendered 224-unit QR at error correction M has a 32-unit explicit quiet zone; observed matrices 33/37/41 retain 4.714/5.286/5.857 quiet modules. Exact payloads, SVG bounds and decoder results are in the JSON.

The generated [attract scene](../../apps/ipad/assets/attract-scene.png) is used unchanged for the promotional screen and all synthetic shots. Each shot has a unique browser route/ID but the same generated pixels; retake verification concerns selected slots and IDs, not a new pose or physical camera image. No private photos appear in attract. Actual providers, provisioning and phone collection stay disabled. The only non-loopback fetch is intercepted before network: reserved-origin `/health` is fulfilled locally with `{status:'ok',sms:'mock',smsAvailable:false}`. Production-shaped QR strings are encoded data only and are never requested.

Reproduce with the tracked [new-session harness](../../tools/native-visual/new-session/README.md). Earlier `ipad-*` and `qr-*` artifacts describe the prior one-shot UI and remain historical evidence. The earlier failed QR decoding report was not rewritten.

Actual installed-iPad camera/mirroring, native filesystem and SQLite durability/recovery, Photos permission/export, native VoiceOver/status bar, real backgrounding, hosted macOS/iOS tests, physical phone scanning conditions and live upload/download remain separate validation gates. None is claimed by this browser fixture.
