# Dependency review

The existing, validated Expo/React Native foundation was retained rather than replacing it with an unrelated open-source booth application. Official Expo modules provide camera, files, SQLite, Keychain and device authentication; focused native SVG/QR modules provide the guest code. The app has no proprietary booth assets. Package versions and registry integrity hashes are recorded in `package-lock.json`.

Installed license metadata reviewed: Expo, React Native, react-native-svg, react-native-qrcode-svg and Miniflare are MIT; Wrangler is MIT OR Apache-2.0. The original project MIT license is unchanged. Browser-only visual tooling is isolated from the native product: react-native-web and React DOM render the actual native JSX with explicit device stubs solely for visual review.

## Current assessment — October 26, 2026

The frozen four-photo candidate retains **eight high and one moderate affected package entries**. [Exact installed versions, advisory ranges and registry-supported remedies](../artifacts/security/studio-advisory-assessment.json) were checked again. The current 1,030-source iOS map matches App and excludes the affected Node libraries; this is not a native-binary audit. Expo CLI forge has no patched published release, and fixed Zod crosses its declared major. Wrangler 4.153.0 is an available upstream-supported tooling update; direct Miniflare 4 has no patched upstream release, so scoped child overrides need separate runtime validation. No dependency was changed during the frozen native feature verification. Keep these findings visible and test the isolated tooling update rather than force an Expo downgrade.

The new photo module uses Apple's built-in Core Image/CoreText frameworks, not Skia or a vendor booth base. Its local wrapper is original MIT code; Apple frameworks are not represented as open source. No third-party filter assets or photo-processing service was added.

## Historical audit outcome — October 25, 2026

`npm audit --omit=dev --audit-level=high` reported two underlying high-severity advisories in Expo's CLI dependency path, represented as five affected dependency entries:

- `node-forge@1.4.0`: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), RSA signature-verification issue. The registry's latest node-forge was 1.4.0 at the time of this check; no patched registry release was available.
- `zod@3.25.76`: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), oversized constrained collections can exhaust memory. The advisory recommends a fixed v4, but the installed Expo CLI declares a v3 dependency.

These advisories remain unresolved. Do not use `npm audit fix --force`: its suggested downgrade to Expo 44 is incompatible with this SDK58 application. An unverified Zod-major override was removed before continuing, and the declared compatible dependency was restored. No signature, checksum or TLS verification was disabled.

The affected path is Expo CLI tooling. The current exported iOS Hermes source map was inspected: 992 sources include neither `node-forge`, `zod`, nor `@expo/code-signing-certificates`. One Expo CLI Metro `require.js` runtime bootstrap is present; it is distinct from the affected certificate/schema tooling. The bundled Worker has no package imports. This evidence narrows the known exposure to build/development tooling; it is not a native-release-binary audit. The machine-readable result is `artifacts/security/bundle-review.json`.

Keep Metro loopback-only/offline, avoid untrusted development manifests and do not enable OTA/code-signing workflows on the strength of these local tests. The standalone app still needs its native/release dependency review and Apple signing on the Mac. A successful bundle or test suite is not a clean security-audit result. Recheck upstream Expo/forge/Zod fixes before releasing or exposing development tooling.

## Second assessment on the launch-blocker pass

Registry checks still reported latest Expo CLI `58.1.15`, latest forge `1.4.0`, code-signing certificates `0.0.7`, and latest Zod `4.6.7`. Expo CLI explicitly requires `zod:^3.25.76` and `node-forge:^1.4.0`; no compatible patched package was found. A Zod4 override would cross the declared major, and the audit's Expo44 downgrade would replace the SDK. Neither was forced, and no audit finding was suppressed.

Reachability was inspected in the installed sources. Forge verification is used by Expo's development/update-manifest signing certificate helpers (`utils/codesigning.js` and `@expo/code-signing-certificates/build/main.js`). The iOS CLI also parses certificates returned by the Mac Keychain `security` tool to select signing metadata; this does not establish a flaw in Apple's native `codesign` verification. Zod is used in the CLI's DevTools-plugin and MCP-extension schema paths. Untrusted plugin/schema output can therefore affect development tooling; these paths are not used by the private Worker or the inspected native JavaScript graph. Keep third-party development plugins and remote dev-server access disabled unless deliberately reviewed. The app has no enabled OTA-update signing workflow.

The selected workflow remains usable with these documented tooling risks. They are not remediated, and the signed native binary is still unknown until Mac build/review. The final source-map inspection is rerun after the app changes, including a check that browser-only React DOM/react-native-web tooling is absent from the native graph.

The native XCTest harness adds an inert synthetic JPEG to the release asset graph. The synthetic capture behavior requires both development mode and an explicit test flag; executable guard tests reject every fixture entrypoint in Release even if that flag is set. The asset's presence does not enable a simulated release camera.
