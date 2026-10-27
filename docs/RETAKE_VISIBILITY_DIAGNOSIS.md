# Retake presentation source candidate

This is a source fix candidate for the stable branch. It is not a device acceptance pass or permission to replace the installed app.

## Source behavior

- Individual **Retake photo** has no confirmation modal. It reserves the selected slot, clears camera readiness and selects the camera screen. **Retake all** separately opens its confirmation modal.
- `take-photo` is the correct camera action identifier. An idle camera screen renders it even before the camera becomes ready; readiness disables the control rather than removing it.

## Source candidate

The old root alternated between a native-driven animated opacity value and a numeric camera opacity. Its screen-change effect still reset and animated the old value on camera entry. Native animated props have their own connection, restoration and deferred-detachment lifecycle; changing the owner of root visibility during navigation is unnecessary here.

The candidate removes that decorative root fade and uses an opaque normal `View` throughout navigation. The countdown, shutter flash and thumbnail animations remain. Capture timing, camera options, originals, session selection, retake persistence, permissions, authentication and sharing are unchanged.

This eliminates the unnecessary root-opacity transition. **Synthetic checks do not establish native visibility or a physical-device fix.** Physical Retake acceptance is required before calling a native issue fixed or releasing an updated app. Device/session diagnostics are intentionally kept outside this public source document.

## Reproduce the source-handler checks

Use the repository's existing Node/tsx/TypeScript dependencies:

```sh
mkdir -p .cache/retake-visibility
node --import tsx scripts/check-retake-presentation.mjs . .cache/retake-visibility/handlers.json
```

The script extracts and executes the actual `App.tsx` handlers against synthetic, in-memory dependencies. It verifies individual Retake selects the camera and intended slot without a modal or original mutation, protects a confirmed selection, and verifies Retake All opens confirmation without changing the selected originals. It refuses to overwrite the report.

These checks pass against both the parent source and this candidate. They verify handler contracts; they do not exercise native rendering, accessibility, touches or a camera. Do not interpret them as a reproduction of a native failure.

## Local verification

- All workspace typechecks passed.
- 420 app/core/plugin checks and 54 API checks passed in separate runs. The API checks used only the local emulator and synthetic data; a restricted-process emulator startup was stopped before rerunning that group with the required local process access.
- The three actual-handler checks passed for both source revisions using synthetic, memory-only dependencies.
- A single-worker, offline iOS JavaScript/Hermes export passed.
- The source fingerprint was refreshed only after reviewing the unchanged selector inventory and handler behavior. The physical preparation checks passed. The broader tooling group passed 137/138 on macOS: the unchanged owner-setup marker fixture assumes `/tmp` is a directory, while macOS exposes it through a symlink. Its production path guard and failing assertion were not weakened.

No native app build, installation or physical Retake acceptance was performed for this candidate. Keep the candidate unreleased until the required native gates pass. Publishing this source candidate does not authorize an app replacement.

## Next device check

After native compile/runtime gates pass, an authorized, attended, no-shutter navigation probe should record only allowlisted stage/control presence and control frames before and after the tap. Verify the selected slot and Retake label before tapping. Classify an empty app tree, obscured controls, a disabled camera action and a different screen separately; do not label every absent control as a camera-readiness failure. Keep diagnostic results private. Do not claim the source candidate fixes native rendering until it passes that check.

Do not reset data, re-pair, change security settings or bypass Host authentication to investigate this. Keep private photos, raw device result bundles, identifiers and credentials out of public evidence. Optional face effects are outside this candidate.
