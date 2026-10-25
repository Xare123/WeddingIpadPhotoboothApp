# Validation and progress

## Current checkpoint

The initially empty repository is intentionally being developed into a native iOS MVP under the owner's expanded authorization. The original license remains unchanged. This task uses the existing isolated checkout; do not create a Git worktree for future cloud tasks unless the user requests one.

Implemented: native capture/countdown/cancel/review/retake/confirmation; staged original files with confirmed-file recovery journal and SQLite queue; OS-authenticated Keychain connection settings; public-HTTPS QR only after upload/session readiness; mock-only consented phone sharing; private R2 session galleries/downloads, expiry, signing-key rotation and permanent session revocation. One confirmed photo per session is the intended minimal scope.

Do not infer native or production readiness from a running process, a successful dependency install, a JavaScript bundle, or a zero-test run.

## Completed current-instance validation

- `bash scripts/setup-cloud.sh`: passed a fresh frozen `npm ci` (587 packages), all workspace typechecks, **42 tests passed / 0 failed / 0 skipped**, and the current iOS Hermes export (1,002 Metro modules). The suite includes 11 queue, 8 capture-state, 5 readiness/QR/origin/phone and 18 Worker/R2 tests.
- `bash scripts/dev-api.sh` / `npm run dev:api`: local health returned the expected mock/local-R2 response; `npm run smoke` passed after the frozen install. It exercised authenticated immutable upload/replay, pre-upload readiness denial, scoped guest page/download, consent, mock sharing and permanent revocation. All images/numbers were synthetic/test-only; no SMS was sent.
- `npm run dev:ipad`: startup flags corrected for Expo58, and writable cache initialization supplied by `scripts/dev-ipad.sh`. Metro served `packager-status:running` on localhost (IPv6 loopback on this host). The iOS development bundle request passed with HTTP 200 / 6,187,906 bytes at monorepo path `/apps/ipad/index.bundle?platform=ios&dev=true&minify=false`.
- Guest-gallery Chromium checks passed six groups at 390/820/1440 widths: decoded synthetic JPEGs, no horizontal overflow, original byte-identical browser download, named touch controls/keyboard focus, completed/reduced-motion animations, real unavailable/revoked states, and no external requests/browser errors. Eight screenshots were opened and inspected; a mobile text-wrap issue was repaired and recaptured.
- The isolated actual-native-JSX browser fixture passed eight interactions, including countdown cancellation and immediate restart without stale-timer capture, retake, confirmation, QR reset, offline state, fictional mock consent and host settings. Fourteen labeled screenshots were captured and reviewed, including a release-mode fixture that hides simulated phone controls and confirms Next guest clears the QR. This uses native-boundary stubs and is **not an iOS or camera test**.
- **Open launch blocker:** a separate independent ZXing check could not decode the landscape-ready or release-portrait browser-fixture QR screenshots. Full-frame detection reported `ChecksumException`; an isolated QR-region attempt reported `NotFoundException`. `artifacts/visual/qr-decode-checks.json` preserves both results. Readiness/value tests do not prove image readability. Investigate the fixture SVG rendering, QR dimensions/quiet zone and decoder setup, then scan on a real phone; this has not yet been confirmed as a native-app defect.
- `npm run build:api` plus `node --check artifacts/deploy/worker.mjs`: prepared and syntax-checked the current deployable ES module. Its SHA and source SHA are in the manifest. No static asset binding is required; gallery HTML/CSS is included and private images live in R2.
- CI YAML parsed and all shell blocks passed syntax checks. Hosted GitHub Actions, macOS/Xcode, signing, Firebase and physical-device runs remain unexecuted.
- Dependency licenses and audit reviewed; two Expo CLI advisories remain open. The current iOS source map contains neither affected forge/certificate code nor Zod. See `docs/DEPENDENCIES.md` and `artifacts/security/bundle-review.json`; this is not a clean audit or a native-binary security claim.

The onboarding `install_script` and `start_skill` were saved through the configuration tool and read back with exact-content matches. The save returned `requires_publish: true`; the user must review/save in environment settings and publish the environment to activate a reusable snapshot. Saving a draft did not itself execute, publish or deploy anything.

## Check boundaries

| Layer | What the check establishes | What it does not establish |
| --- | --- | --- |
| TypeScript checks | Shared, app and worker types resolve | Native runtime behavior |
| Node unit tests | Queue replay/backoff/state and pure capture/QR contracts | Actual SQLite filesystem/power-loss behavior on iPad |
| Miniflare R2 integration | Worker auth, upload/session/guest capability behavior with local storage | Activated/live R2, public hostname or production abuse controls |
| Running local HTTP smoke | Saved local startup instructions and a representative storage/share/download request | Guest phone access or deployed backend |
| iOS JavaScript export | Metro can resolve and bundle the native iOS dependency graph | Xcode compile, Apple signing or camera access |
| Manual macOS workflow | When executed, unsigned simulator compile/link evidence | Actual-iPad install, camera, release/offline behavior |
| Physical-device rehearsal | When executed, intended hardware and venue workflow | Guaranteed delivery across all future outages |

GitHub Actions files are prepared but have not been pushed or executed by this cloud task. The optional macOS lane requires explicit manual dispatch and a trusted commit SHA. No paid Google Cloud/Firebase runs, certificates or service accounts are created. A signed XCTest/XCUITest package and approved project/billing/device-matrix configuration are prerequisites for Firebase Test Lab iOS, rather than JavaScript tests alone. See [iOS Test Lab](https://firebase.google.com/docs/test-lab/ios/run-xctest) and [migration guidance](https://firebase.google.com/docs/test-lab/migrate-faq); official pages were inaccessible through this cloud host, so current availability/limits must be checked before scheduling.

The owner's OpenBubbles [GCE pilot](https://github.com/Xare123/openbubbles-app/blob/agent/gce-spot-parallel-pilot/.github/workflows/gce-runner-pilot.yml) is a reference for pinned tools, bounded lanes, retained evidence and cleanup. Its Linux Android/Flutter/Rust/Gradle infrastructure does not supply Xcode or an iOS device.

## Outstanding external prerequisites

R2 activation is complete and the owner-created bucket `gizelleandrami-photoboothphotos` was verified private by the coordinating task. The owner also confirmed MacBook installation and authorized needed website/DNS changes. Still pending: a deployed dedicated Worker/subdomain and budget controls; secure production token/signing-key entry; Apple signing access; physical iPad and booth rehearsal; optional approved SMS provider/sender/domain. None is replaced by local emulator success.
