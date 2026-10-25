# iPad JSX browser visual review — DEV ONLY

These screenshots were captured from the actual `apps/ipad/App.tsx` through React Native Web in Chromium on Linux. This is **browser fixture evidence, not iOS screenshots or native device verification**. Each screenshot contains a banner stating “Visual review fixture — browser rendering, not iOS; no real guest URL or SMS”.

The original native JSX is imported directly. Camera/permission, filesystem/SQLite, config/Keychain, host authentication, and sync use synthetic in-memory adapters. The actual capture state reducer, readiness validation, QR encoder/SVG rendering, and recipient input validation execute. No guest photos, credentials, real guest pages, uploads, or SMS are used. The image is the synthetic sample scene illustration. The QR encodes only the reserved `https://photobooth.example/g/` origin and a 64-character synthetic hex token, with a fixture future expiry.

The native XCTest fixture hook is always disabled in this browser harness through an explicit alias: its flag is false and its helpers throw if called. Build-input checks exclude the real native fixture module, Expo FileSystem, and the native static JPEG; the native fixture panel is asserted absent. Boundary evidence: [development bundle](ipad-browser-boundary-dev.json), [release UI bundle](ipad-browser-boundary-release.json). These browser runners do not execute the separate hosted macOS/iOS XCTest workflow. RN-web's platform is `web`, so native iOS accessibility announcements are not covered here.

| State | Portrait 820 × 1180 | Landscape 1180 × 820 |
| --- | --- | --- |
| Camera | [Portrait](ipad-camera-portrait.png) | [Landscape](ipad-camera-landscape.png) |
| Review / retake | [Portrait](ipad-review-portrait.png) | [Landscape](ipad-review-landscape.png) |
| Offline pending | [Portrait](ipad-offline-pending-portrait.png) | [Landscape](ipad-offline-pending-landscape.png) |
| Ready QR | [Portrait](ipad-ready-portrait.png) | [Landscape](ipad-ready-landscape.png) |
| Simulated phone share complete | [Portrait](ipad-mock-share-portrait.png) | [Landscape](ipad-mock-share-landscape.png) |

Additional fixtures: [Countdown](ipad-countdown-portrait.png), [phone test form](ipad-phone-form-portrait.png), [host settings](ipad-host-settings-portrait.png).

Final guest-facing screenshots use the `America/Los_Angeles` timezone. Additional bounded fixtures: [permission denied](ipad-permission-denied-portrait.png), [permission blocked](ipad-permission-blocked-portrait.png), and [camera after interruption](ipad-interrupted-camera-portrait.png). The four bounded adapter checks verify denied-to-synthetic-grant preview readiness, blocked-to-mocked-Settings marker, synthetic AppState interruption with zero camera-adapter calls after the countdown, and offline-to-synthetic-online ready acknowledgment. These results are recorded separately from the original eight development interactions in `ipad-fixture-checks.json`; they do not establish native permission, OS settings, lifecycle, persistence, or network behavior.

The [release guest UI fixture](ipad-ready-release-portrait.png) renders the actual App with `__DEV__=false`: the ready QR and Next guest remain visible, and the developer phone-sharing simulation controls, inputs, and status are absent. [Release fixture checks](ipad-release-fixture-checks.json) also verify that Next guest clears the prior QR. This is a release-UI browser fixture with synthetic adapters, **not an iOS release build**. The development screenshots above deliberately retain `__DEV__=true` so the simulated-sharing checks remain reviewable.

The core portrait and landscape layouts were visually inspected. They show consistent warm colors, readable serif headings, a clear primary action, restrained spacing, and an unclipped QR. Main actions fit in the core states at these dimensions; the expanded phone form scrolls. No horizontal overflow, offscreen horizontal button/QR bounds, or browser console/page errors were recorded. Full image containment in review/ready intentionally leaves dark sidebars when the synthetic illustration has a different aspect ratio. The fixture camera fills its viewport with a crop.

Browser-fixture interactions passed: canceling a countdown returns to camera and does not capture after the original timer elapses; cancel followed by immediate restart preserves the new countdown after the old timer finishes; synthetic countdown capture reaches review; retake returns to camera; confirming the photo reveals the ready QR through synthetic sync; Next guest removes the prior QR and selection; offline retry keeps the saved photo without revealing a QR; fictional phone input and consent lead to an explicit simulated/no-SMS result; host settings opens and returns. The countdown-cancel control was added by the app author after the initial review and the screenshots were refreshed. The final run recorded zero external network requests (the browser harness blocks any request outside its own loopback origin).

Machine-readable state measurements and interaction results are in [ipad-fixture-checks.json](ipad-fixture-checks.json). Reproduce with `node tools/native-visual/serve.mjs` and `node tools/native-visual/capture.mjs` from the repository root. The local server is a development review tool and must not be deployed.

Current standards and independent full-frame QR decoding evidence is in [qr-review.md](qr-review.md), including numeric-heavy token coverage and preserved decoder failures. Fixture and QR reports include the App source SHA-256 to check that they refer to the same source revision.

This evidence does not establish iOS build/install success, native layout parity, front-camera function, physical QR scanning, Keychain/SQLite persistence, biometric authentication, app interruption/background behavior, real upload/network recovery, or device accessibility. Native device verification remains required.
