# DEV ONLY: native JSX browser visual review

This is a local review harness for `apps/ipad/App.tsx`, imported directly and rendered using `react-native-web`. It is **not a web edition of the product** and must not be deployed. The production iPad entry point and Expo configuration never import this directory.

Run from the repository root, after `npm ci`:

```sh
node tools/native-visual/serve.mjs
```

The harness binds only to `127.0.0.1:8791`. In a separate shell, with the environment-provided Playwright and `/usr/bin/chromium` installed:

```sh
node tools/native-visual/capture.mjs
```

Stop the server you started when finished. The screenshot script closes its own Chromium instance. The server bundles the current App once at startup; restart it after source changes.

To inspect the actual guest JSX with release-only gating, stop the default server, run `node tools/native-visual/serve.mjs --release-fixture`, then `node tools/native-visual/capture-release.mjs`. This compiles the actual global `__DEV__` to `false`, while retaining the development-only synthetic browser harness and its permanent banner. It is not an iOS release build. The default server still uses `__DEV__=true` and preserves the eight development-fixture interaction checks.

Fixture query modes: `camera`, `review`, `offline-pending`, `ready`, `mock-share`. Every page has an external, permanent banner identifying it as a browser rendering with synthetic data. The synthetic JPEG is `artifacts/visual/sample-scene-1.jpg`; it is a drawn illustration, not a guest photo. The QR uses a reserved `https://photobooth.example/g/<64 hex characters>` URL and cannot reach a real guest page.

The actual App JSX, capture-state transitions, QR readiness validation, QR encoder/SVG, and recipient validation execute. Camera/permission, local files/SQLite, config/Keychain/SecureStore, host authentication, crypto UUID generation, and sync are adapted to an in-memory fixture. The camera returns the synthetic illustration; sync never calls a server; simulated sharing never sends SMS. The SVG native sound dependency is a no-op; its asset registry uses RN-web's web registry. Nothing is persisted across reloads.

All screenshot runners use `America/Los_Angeles` for guest-facing expiry evidence. `capture.mjs` preserves the eight main development interaction checks and records four separate bounded adapter checks: denied permission (`?state=camera&permission=denied`) grants through a synthetic request; blocked permission (`permission=blocked`) calls only a mocked `Linking.openSettings` counter; a synthetic AppState background event cancels countdown with zero camera-adapter calls; synthetic offline-to-online retry reveals a QR only after the in-memory ready acknowledgment. `window.__NATIVE_VISUAL_FIXTURE__` exposes those explicit test controls. They do not establish real OS permission, settings, lifecycle, durable storage, or network behavior.

The native XCTest hook `./src/native-fixture` is always aliased to `native-fixture-disabled.ts`: `nativeFixtureEnabled=false` and every helper throws if accidentally called. The browser bundle explicitly forces its native fixture environment flag to `0`. A build-input guard rejects the actual native fixture module, Expo FileSystem, and its static native JPEG. Separate `ipad-browser-boundary-dev.json` and `ipad-browser-boundary-release.json` reports retain the App SHA and successful exclusions. Browser runners also assert that the native fixture panel is absent. These boundaries keep the browser in-memory fixture separate from the hosted macOS/iOS tests. RN-web's `Platform.OS` remains `web`, so the native iOS accessibility announcement branch is not exercised here.

This demonstrates browser layout and JavaScript flow only. It does not verify an iOS installation, real front camera, native rendering, iPad font metrics, safe areas, device rotation, Keychain, SQLite persistence, interrupted writes, background execution, biometric authentication, physical QR scanning, real upload, or network recovery. Those require the documented native device checks.

## Independent QR screenshot decoding

`check-qr.mjs` captures the actual release guest JSX at portrait/landscape sizes and DPR 1/2, for the original reserved hostname and a realistic production-shaped hostname with a fabricated 64-hex token. It also checks numeric-heavy 64-hex tokens on those hosts and short reserved `a.example`, because numeric segmentation changes QR matrix size and quiet-zone coverage. It never requests those hostnames. It checks exact payloads using jsQR and ZXing-C++, and records ZXing JavaScript detector results separately, including known-valid reference controls and the `PURE_BARCODE` option. It verifies an explicit border of at least four modules and initial Next guest visibility.

Install optional decoder tools in their isolated, ignored cache (the app does not depend on these packages):

```sh
npm install --prefix .cache/qr-tools --cache /workspace/WeddingIpadPhotoboothApp/.cache/npm --ignore-scripts --save-exact @zxing/library@0.23.0 pngjs@7.0.0 jsqr@1.4.0 zxing-wasm@3.1.6 --no-audit --no-fund
node tools/native-visual/serve.mjs --release-fixture
```

In another shell:

```sh
node tools/native-visual/check-qr.mjs
```

See `artifacts/visual/qr-review.md` for the diagnosis, preserved failures, decoder versions, final screenshots, and physical-device checklist. The realistic-host fixture mode is `?state=ready&qrPayload=realistic`; it remains synthetic and local. The script intentionally requires the preserved `qr-before-*` baseline screenshots so a fresh run cannot silently erase the original decoding failures.
