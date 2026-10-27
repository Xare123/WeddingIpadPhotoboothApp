# Production photo-treatment verification

The `photo-treatments` profile builds a standalone, unhosted Release iOS simulator XCTest bundle from the actual production Swift engines. It does not use Expo, CocoaPods, Metro, an app host, test-only replacement renderers, or guest data.

## Required evidence

| Profile | Required XCTest methods | Required native JPEGs |
| --- | --- | --- |
| `core-pixels` | Original 8 effects + 11 template methods = 19 | Original 16 template exports |
| `photo-treatments` | All original 19 + 10 `NativePhotoTreatmentEngineTests` methods = 29 | All original 16 + 3 treatment exports = 19 |

The extended project contains nine Swift sources and seven fixture resources. The new test identities are fixed in `scripts/native-treatment-profile.mjs`; a missing, renamed, skipped or failing method cannot reduce the required inventory. The result gate checks the actual xcresult method identities and per-class counts, rather than counting discovered source declarations as execution.

The three additional JPEGs are `treatment-separated-glasses.jpg`, `treatment-separated-crown.jpg`, and `treatment-separated-hearts.jpg`, each 1122 × 1402, produced only by the actual separated-portrait treatment test. Every required image must retain a valid JPEG header, expected dimensions, an approved producing test, a bounded safe export path, and its recorded SHA-256. The source fixture is generated fictional imagery; its exact PNG SHA-256 and the three reviewed face-engine source copies are pinned. Source copies, resources, project graph and scheme are verified again before compilation.

The PNG is copied as an opaque resource with PNG compression disabled. Its production XCTest verifies the actual bundled bytes; the first Apple run must establish that the Xcode resource-copy path preserves them. Local project parsing does not establish that behavior.

## Opt-in hosted runs

On `codex/post-capture-face-effects`, the existing pixel workflow selects standard ARM `macos-15`, Xcode 26.3 and the treatment profile only when the pushed commit message includes `[native-pixels-ci]`. The same branch opts into the existing unsigned physical-SDK Release build with `[native-ci]`. A commit without either marker does not start these native jobs. The MVP branch keeps the original profile and its existing device-build runner selection.

On a supported Mac, the equivalent pixel command is:

```sh
node scripts/ci-native-pixels.mjs photo-treatments
```

The pixel lane retains its existing finite preparation, simulator boot, compilation, artifact and cleanup budgets. It owns a disposable simulator and subprocess groups, verifies their cleanup, and retains bounded logs and the source manifest on failure. Named native JPEGs are exported separately from the capped raw xcresult so a large raw bundle cannot hide successful image attachments. No credentials, signing identity, paid runner, persistent agent or live network service is required.

## Coverage limits

The ten additional tests exercise the pure production treatment pipeline, including original-byte identity, real Vision/decoration rendering, look ordering, EXIF normalization, metadata removal, cache containment and cleanup, overlapping-engine ownership, busy/cancellation admission, and preview/apply file parity.

These tests do not execute the Expo bridge, app screen interactions, durable app manifests, the iPad camera, Photos export, cloud uploads, pairing or SMS. The unsigned physical-SDK Release lane separately checks that the real Expo app, native bridge and bundled JavaScript compile; compilation is not a runtime pass. The original full-app 20-case runtime gate remains separate and unchanged. None of these hosted checks replaces installation and rehearsal on the wedding iPad or establishes live face tracking or device performance.

Local Node contract tests validate the harness and fail-closed evidence rules. Their header-only JPEG fixtures are parser tests, not native rendered-image evidence. Actual simulator counts and rendered JPEGs must come from the exact published candidate's successful Apple run.
