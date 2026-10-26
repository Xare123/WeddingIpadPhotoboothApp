# Five-photo session — actual JSX browser evidence

**Browser fixtures, not iOS screenshots or native-device proof.** The actual [App.tsx](../../apps/ipad/App.tsx), capture runner, review selection controller, readiness helper and SMS capability component execute through React Native Web. Camera, private files, SQLite, Photos, authentication and sync use explicit synthetic adapters. Every screenshot and video retains the browser-fixture banner.

Final App source SHA-256: `a2d8e4f62b855c54e489d8311ba6fb794b59f3e7a71e9dd521827332ab6d5548`.

[Machine-readable checks](new-session-checks.json) contain matching hashes for the App, capture/review helpers, sharing/SMS sources and generated scene, verified before and after recording. [Bundle boundary evidence](new-session-bundle-boundary.json) records excluded native implementations and the disabled native XCTest fixture. All views use `America/Los_Angeles`.

## Watch the actual interaction

- [Portrait WebM — 27.8 seconds, 820×1180](new-session-demo-portrait.webm)
- [Landscape WebM — 26.9 seconds, 1180×820](new-session-demo-landscape.webm)

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

## Findings and verified repairs

The final run passed both complete recorded workflows, six bounded adapter checks, eight selected contrast checks, and 22 exact full-frame QR decodes in **both jsQR 1.4.0 and ZXing-C++ through zxing-wasm 3.1.6**. It recorded zero browser errors and zero unexpected external requests. All 50 screenshots were captured from the actual JSX, with enabled button bounds at least 44 × 44 CSS pixels and no horizontal overflow. Host screens allow vertical scrolling; these captured host views fit their portrait viewport.

The camera occupies 95.6% of portrait width and 96.9% of landscape width, with approximately 74% of viewport height in each orientation. Review is 784 × 803 in portrait and 820 × 716 in landscape. The landscape stage was enlarged from 54.0% to **87.3% of viewport height**, with controls in a narrow side rail. `contain` preserves the whole generated portrait image, so landscape review has expected sidebars. Attract, camera/countdown, review, share, save-error and host views were visually inspected; the layout, typography and action hierarchy remain clear in the final set.

A real fast-selection race was found and fixed in the App. [Before the fix](new-session-fast-retake-before-fix.json), tapping thumbnail 3 and immediately Retake changed slot 1 because intermediate programmatic scroll callbacks overwrote the explicit choice. [After the source fix](new-session-fast-retake-after-fix.json), the pointerdown label and camera action remain “Retake photo 3”, and only slot 3 changes in both orientations. Both final videos repeat this **without an actor settling wait or sleep**; the other four selected IDs and the previous in-memory exposure remain intact. This verifies the browser-native-JSX event flow, not physical iPad touch timing.

Progress chips were also moved above the countdown shade. Computed styles give contrast 8.100:1 for the attract eyebrow over a hypothetical white image, 6.220:1 for countdown text over its actual shade plus a white frame, 11.896:1 for photo progress above the shade, and 8.960:1 for the QR caption. All exceed 4.5:1. Reduced-motion digits remain at scale/opacity 1; a synthetic background event prevents exposure after the countdown and returns to a paused camera. These bounded checks are not a full native accessibility audit.

The actual JavaScript flow awaits each synthetic private-save promise before advancing, exposes only the saved slots in the strip, retains five selected originals on Photos denial, and reports unconfirmed Photos results without a no-op retry. A simulated private-save failure retries the same exposure without another camera-adapter call. Five upload acknowledgments alone do not reveal a QR; the synthetic all-five session-ready acknowledgment is also required. Next guests removes the prior session, shot routes and QR from the guest screen while keeping the in-memory host history.

## QR and privacy scope

Twenty static QR cases cover portrait/landscape at DPR 1/2 with the original reserved token, a production-shaped hostname with a fabricated 64-character hex token, numeric-heavy 64-character tokens, and short reserved `a.example`. Two additional decoded frames come from the complete recorded sessions after retaking photo 3. All are **full-frame PNG decodes**, without crop, resizing, sharpening, thresholding or expected-payload hints. The rendered 224-unit QR at error correction M has a 32-unit explicit quiet zone; observed matrices 33/37/41 retain 4.714/5.286/5.857 quiet modules. Exact payloads, SVG bounds and decoder results are in the JSON.

The generated [attract scene](../../apps/ipad/assets/attract-scene.png) is used unchanged for the promotional screen and all synthetic shots. Each shot has a unique browser route/ID but the same generated pixels; retake verification concerns selected slots and IDs, not a new pose or physical camera image. No private photos appear in attract. Actual providers, provisioning and phone collection stay disabled. The only non-loopback fetch is intercepted before network: reserved-origin `/health` is fulfilled locally with `{status:'ok',sms:'mock',smsAvailable:false}`. Production-shaped QR strings are encoded data only and are never requested.

Reproduce with the tracked [new-session harness](../../tools/native-visual/new-session/README.md). Earlier `ipad-*` and `qr-*` artifacts describe the prior one-shot UI and remain historical evidence. The earlier failed QR decoding report was not rewritten.

Actual installed-iPad camera/mirroring, native filesystem and SQLite durability/recovery, Photos permission/export, native VoiceOver/status bar, real backgrounding, hosted macOS/iOS tests, physical phone scanning conditions and live upload/download remain separate validation gates. None is claimed by this browser fixture.
