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

Fixture query modes: `camera`, `review`, `offline-pending`, `ready`, `mock-share`. Every page has an external, permanent banner identifying it as a browser rendering with synthetic data. The synthetic JPEG is `artifacts/visual/sample-scene-1.jpg`; it is a drawn illustration, not a guest photo. The QR uses a reserved `https://photobooth.example/g/<64 hex characters>` URL and cannot reach a real guest page.

The actual App JSX, capture-state transitions, QR readiness validation, QR encoder/SVG, and recipient validation execute. Camera/permission, local files/SQLite, config/Keychain/SecureStore, host authentication, crypto UUID generation, and sync are adapted to an in-memory fixture. The camera returns the synthetic illustration; sync never calls a server; simulated sharing never sends SMS. The SVG native sound dependency is a no-op; its asset registry uses RN-web's web registry. Nothing is persisted across reloads.

This demonstrates browser layout and JavaScript flow only. It does not verify an iOS installation, real front camera, native rendering, iPad font metrics, safe areas, device rotation, Keychain, SQLite persistence, interrupted writes, background execution, biometric authentication, physical QR scanning, real upload, or network recovery. Those require the documented native device checks.
