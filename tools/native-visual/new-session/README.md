# DEV ONLY: five-shot session JSX visual review

This harness imports the actual `apps/ipad/App.tsx` and its real session capture runner, swipe/review UI, readiness helper, and SMS capability component through React Native Web. It is local review tooling, not a web product, deployment target, iOS build, or physical-device test.

From the repository root, after the existing project dependencies are installed:

```sh
node tools/native-visual/new-session/serve.mjs
```

In another shell:

```sh
node tools/native-visual/new-session/capture.mjs
```

The server binds only to `127.0.0.1:8791`; stop only the server you started. It bundles once at startup, so restart it after relevant source changes. The default compiles the App's `__DEV__` to false while keeping the external browser-fixture banner visible. `--development-ui` is available for local developer UI inspection; the native XCTest fixture remains disabled in either mode.

The runner uses the environment-provided Playwright, `/usr/bin/chromium`, and `/usr/bin/ffmpeg`. It puts bundles, raw recorder files, and the task-local Playwright tools cache under ignored `.cache/new-session-visual/`; its FFmpeg executable is a symlink to the installed system tool, with no download. App native modules are explicitly replaced by in-memory adapters. The esbuild bundle supplies Metro's `global` alias as `globalThis`, required by RN-web Animated cancellation.

Independent QR checks use the already prepared optional `.cache/qr-tools` packages: `jsqr@1.4.0`, `zxing-wasm@3.1.6`, and `pngjs@7.0.0`, plus the project's maintained `qrcode@1.5.4` encoder for geometry metadata. No package manifest or lockfile is added in this harness directory. ZXing-C++ loads its WASM from the installed local file, without a decoder CDN. Missing browser tools or optional decoder packages are actual prerequisites; the script fails rather than producing placeholder evidence.

## Fixtures and boundaries

Fixture states are `attract`, `camera`, `partial`, `review`, `photos-denied`, `photos-uncertain`, `pending`, `ready`, and `partial-ready`. Examples use query parameters such as `?state=attract&network=offline` and `?state=ready&payload=realistic`. Canonical, numeric-heavy, and short reserved-host QR payloads are available through `payload=reserved|realistic|reserved-numeric|realistic-numeric|short-numeric`.

The original generated `apps/ipad/assets/attract-scene.png` is used unchanged for the actual attract JSX and the synthetic camera. Each synthetic captured file has a unique browser route/shot ID but displays that same generated scene. Retake checks verify selected IDs and preservation of the other four slots, not a different physical pose or camera image. There are no guest/private photos in these fixtures. Attract always uses the fixed promotional asset, and the reset check verifies prior synthetic shot routes are absent from the guest screen.

Camera permission, exposure, private files, SQLite, recovery, preferences, host authentication, and sync are explicit in-memory adapters. The real photo-library/photo-export and host-originals controllers execute against a mocked MediaLibrary SDK. Synthetic originals use native-shaped `file:///synthetic/*.jpg` URIs; only the browser Image adapter maps those to the generated scene routes. This lets the actual exporter validate file URIs and select individual/retained photos without performing OS writes. The native XCTest fixture flag is always false and its helpers throw; bundle input checks reject the actual native fixture, storage, sync, config, Expo FileSystem, SQLite, MediaLibrary SDK, and native test JPEG. Actual session state transitions and capture timing execute, while save/repair promises only simulate native persistence boundaries.

`window.__NEW_SESSION_FIXTURE__` exposes synthetic lifecycle, offline/online, ready acknowledgment, one-save failure, and counters. GET `https://photobooth.example/health` is intercepted before network and fulfilled locally with `{status:'ok',sms:'mock',smsAvailable:false}`. Every other non-loopback request is aborted and recorded as a failure. Realistic production-shaped QR URLs are encoded data only; their fabricated tokens are never requested. No real provisioning, phone collection, provider submission, SMS, or paid service is enabled.

## Evidence

The runner writes only LOCAL UNPUBLISHED `artifacts/visual/new-session-*` screenshots, two WebM demonstrations, bundle provenance, and a machine-readable report. The report records published baseline `5ef615eaf228776dcdedc0df3f0fe65ba55976f9` separately from current working-tree hashes. No commit, upload, deployment, remote CI, pairing or SMS is performed. All views use `America/Los_Angeles`. It verifies source hashes before and after recording; stale bundles or edits during the run fail validation. It checks portrait and landscape touch target dimensions, viewport overflow, selected computed contrasts, real trusted browser swipe, one-slot retake, private-save retry, Photos denial/unconfirmed UI, explicit per-photo host confirmation/cancel, retained-original exclusion from guest jobs, staged-original accounting/repair, index-repair messaging, reduced-motion state, synthetic interruption, all-five ready gating, exact full-frame QR payload decoding, and Next guests privacy.

The videos show the actual unaccelerated three-second capture sequence, pause/continue, review swipe and individual retake, pending sharing, synthetic all-five readiness, and reset. Only static pending-sharing and review-swiped screenshots wait for completed fade/scroll plus stable rendered frames. The retake actor still taps thumbnail 3 and immediately requests Retake, without an offset wait or settling sleep; that action block remains unchanged. Before/after regression reports preserve the earlier wrong-slot race and its source fix. Host controls, local-session detail and blank private setup are captured separately. The videos record browser animation behavior, not native animation performance or camera quality.

Earlier `ipad-*` and `qr-*` evidence outside this `new-session-*` set describes the prior one-shot UI. Preserve it as historical evidence; do not present it as verification of this redesign. Physical iPad/phone scanning, true native persistence and recovery, Photos permission/export behavior, native accessibility/VoiceOver, backgrounding, real upload, and hosted-native test results require their separate actual-device or macOS workflow evidence.

## Full-bleed camera acceptance

After the App edit is complete and the fixture server is restarted, run `node tools/native-visual/new-session/fullbleed-checks.mjs`. It checks the camera stage and camera surface against all four edges of the app viewport excluding the fixture banner, zero camera radius, and controls against supplied safe-area insets in portrait and landscape. These are browser geometry checks, not iOS safe-area measurements.

`insets=top,right,bottom,left` supplies deterministic synthetic safe areas. `reducedTransparency=true`, `highContrast=true`, and `reducedMotion=true` supply synthetic AccessibilityInfo values. `window.__NEW_SESSION_FIXTURE__.setAccessibilityPreference(event, boolean)` emits their corresponding `reduceTransparencyChanged`, `highTextContrastChanged`, or `reduceMotionChanged` event to actual application subscribers. `glass=available` changes only the synthetic availability query; any GlassView is explicitly labeled as a browser stand-in. Default browser runs must render the opaque fallback. The bundle rejects actual expo-glass-effect and safe-area-context native package inputs.
