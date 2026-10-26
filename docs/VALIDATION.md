# Validation and progress

## Current checkpoint

The initially empty repository is intentionally being developed into a native iOS MVP under the owner's expanded authorization. The original license remains unchanged. This task uses the existing isolated checkout; do not create a Git worktree for future cloud tasks unless the user requests one.

Implemented: native capture/countdown/cancel/review/retake/confirmation; staged original files with confirmed-file recovery journal and SQLite queue; OS-authenticated Keychain connection settings; public-HTTPS QR only after upload/session readiness; mock-only consented phone sharing; private R2 session galleries/downloads, visible expiry, signing-key rotation and permanent session revocation. Production requests use fixed-width digest authentication and fail-closed native rate protection before storage. One confirmed photo per session is the intended minimal scope.

Do not infer native or production readiness from a running process, a successful dependency install, a JavaScript bundle, or a zero-test run.

## Completed current-instance validation

- The saved setup command and hosted Linux lane passed frozen `npm ci` (587 packages), workspace typechecks, the current test suite and iOS Hermes export. The latest direct `npm test` executed **59 tests / 59 passed / 0 failed / 0 skipped**. These cover 11 queue, 3 queue-consumer concurrency, 8 capture-state, 2 native-fixture release/opt-in guards, 7 readiness/QR/origin/phone/expiry, 20 Worker/R2 and 8 rate/auth gate tests. The release export resolved 1,005 Metro modules. Rate tests exercise real native workerd bindings as well as zero-storage tripwires for missing, throwing, malformed or denied policies.
- `bash scripts/dev-api.sh` / `npm run dev:api`: local health returned the expected mock/local-R2 response; `npm run smoke` passed after the frozen install. It exercised authenticated immutable upload/replay, pre-upload readiness denial, scoped guest page/download, consent, mock sharing and permanent revocation. All images/numbers were synthetic/test-only; no SMS was sent.
- `npm run dev:ipad`: startup flags corrected for Expo58, and writable cache initialization supplied by `scripts/dev-ipad.sh`. Metro served `packager-status:running` on localhost (IPv6 loopback on this host). The iOS development bundle request passed with HTTP 200 / 6,187,906 bytes at monorepo path `/apps/ipad/index.bundle?platform=ios&dev=true&minify=false`.
- Guest-gallery Chromium checks passed six groups at 390/820/1440 widths: decoded synthetic JPEGs, no horizontal overflow, original byte-identical browser download, named touch controls/keyboard focus, completed/reduced-motion animations, real unavailable/revoked states, and no external requests/browser errors. Eight screenshots were opened and inspected; a mobile text-wrap issue was repaired and recaptured.
- The isolated actual-native-JSX browser fixture passed eight development interactions, four bounded permission/lifecycle/retry checks and two release checks. These include countdown cancellation and immediate restart without stale-timer capture, retake, confirmation, QR reset, offline-to-ready simulation, permission-denied/grant and blocked/settings branches, foreground interruption, fictional mock consent and host settings. Core, permission and release screenshots were captured and reviewed; the release fixture hides simulated phone controls and confirms Next guest clears the QR. All reports match the final App source hash. This uses native-boundary stubs and is **not an iOS or camera test**.
- Three computed browser contrast checks passed after correcting the small step/footer labels and countdown overlay: 5.275:1, 4.726:1 and 5.941:1 respectively. The countdown check composites the actual rendered overlay over a hypothetical white camera frame. These establish those rendered color pairs, not a complete accessibility audit or native VoiceOver result.
- The earlier QR decoding blocker is diagnosed in `artifacts/visual/qr-review.md`; original failures remain in `qr-decode-checks.json`. The payload/matrix was valid, and ZXing JavaScript also rejected pristine valid reference PNGs that independent decoders accepted. The explicit quiet zone is now 32 units at size 224/error correction M, retaining at least 4.714 modules across recorded matrix sizes. **20/20 actual-JSX full-frame screenshots decode the exact URL in both jsQR and ZXing-C++**, including portrait/landscape, DPR 1/2 and numeric-heavy tokens. Those results establish encoded-image correctness for the recorded cases, not real iPad/phone scanning range.
- `npm run build:api` plus `node --check artifacts/deploy/worker.mjs`: prepared and syntax-checked the current deployable ES module. Its SHA and source SHA are in the manifest, along with all 13 nonsecret bindings, explicit logging/trace controls and the recommended configurable seven-day guest TTL. The artifact metadata is derived directly from the production example. No static asset binding is required; gallery HTML/CSS is included and private images live in R2.
- The separate native-CI parser/diagnostic suite executed **19 tests / 19 passed / 0 failed / 0 skipped**. It rejects missing, zero, skipped or failed XCTest execution; validates real-shaped simulator inventory; and checks bounded redaction and workflow-command escaping. CI YAML and shell blocks passed structural/syntax checks.
- Dependency licenses and audit reviewed; two Expo CLI advisories remain open. The current iOS source map contains neither affected forge/certificate code nor Zod. See `docs/DEPENDENCIES.md` and `artifacts/security/bundle-review.json`; this is not a clean audit or a native-binary security claim.

The onboarding `install_script` and `start_skill` were saved through the configuration tool and read back with exact-content matches. The save returned `requires_publish: true`; review/save in environment settings and publish the environment to activate a reusable snapshot. Publication status has not been independently established. Saving a draft did not itself execute, publish or deploy anything.

## Check boundaries

| Layer | What the check establishes | What it does not establish |
| --- | --- | --- |
| TypeScript checks | Shared, app and worker types resolve | Native runtime behavior |
| Node unit tests | Queue replay/backoff/state and pure capture/QR contracts | Actual SQLite filesystem/power-loss behavior on iPad |
| Miniflare R2 integration | Worker auth, upload/session/guest capability behavior with local storage | Activated/live R2, public hostname or production abuse controls |
| Running local HTTP smoke | Saved local startup instructions and a representative storage/share/download request | Guest phone access or deployed backend |
| iOS JavaScript export | Metro can resolve and bundle the native iOS dependency graph | Xcode compile, Apple signing or camera access |
| macOS simulator XCTest lane | Only a passing nonzero run establishes unsigned native compile/link and synthetic-camera files/SQLite restart evidence | Actual-iPad install, camera, standalone release/offline behavior |
| Physical-device rehearsal | When executed, intended hardware and venue workflow | Guaranteed delivery across all future outages |

## Hosted execution

The repository was verified public without changing visibility. Both lanes use pinned actions, an exact checkout SHA, bounded timeouts, retained diagnostics and standard public-repository runners. The native lane is opt-in through `[native-ci]` on a push to `codex/wedding-photobooth-mvp`; no merge or default-branch workflow registration is needed.

- Linux [run 40246386348](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40246386348) passed on `23608b372a2e26b2b13feb037a931b733e1c3a45`.
- Native [run 40246386349](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40246386349) failed on that SHA. The public page exposed only exit code 1; authenticated logs were unavailable. A GitHub API read was denied and was not retried unchanged. This run is not evidence of executed or passing XCTest.
- Linux [run 40247502391](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40247502391) passed on `1c1324f` with the expanded diagnostic contract tests.
- Native [run 40247502398](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40247502398) failed after dependency setup with a JSON parsing error. Inspection found structured simulator output was consumed from a redacted/truncated combined log tail. The runner is being corrected to retain bounded raw stdout separately for parsing, keep stderr out of machine data, and label parse failures explicitly. Its rerun must pass before claiming native test execution.

The second attempt adds bounded public error-stage annotations and passing XCTest-count evidence; it does not assume a cause for the first failure. Detailed artifacts require existing authenticated GitHub access. The exact `api.github.com` network requirement was saved in the environment draft, without creating or requesting a new token. No new paid Google Cloud/Firebase runs, certificates or service accounts were created. See [Firebase assessment](FIREBASE_ASSESSMENT.md) for the bounded access/artifact checks and official-source availability limits.

The owner's OpenBubbles [GCE pilot](https://github.com/Xare123/openbubbles-app/blob/agent/gce-spot-parallel-pilot/.github/workflows/gce-runner-pilot.yml) is a reference for pinned tools, bounded lanes, retained evidence and cleanup. Its Linux Android/Flutter/Rust/Gradle infrastructure does not supply Xcode or an iOS device.

## Outstanding external prerequisites

R2 activation is complete and the owner-created bucket `gizelleandrami-photoboothphotos` was verified private by the coordinating task. The owner also confirmed MacBook installation and authorized needed website/DNS changes. Still pending: a deployed dedicated Worker/subdomain and budget controls; secure production token/signing-key entry; Apple signing access; physical iPad and booth rehearsal; optional approved SMS provider/sender/domain. None is replaced by local emulator success.
