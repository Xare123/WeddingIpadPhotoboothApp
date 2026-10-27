# Release runtime investigation

Production app code remains **d44b2629ce8275ddbede6f42fd2227db44b85dcb**, version **0.3.6 / build 9**, App SHA-256 `d49e6318af58b395d1b90a97359beb4ae542acc7a6f90a7c29b25414b943cd63`. Hosted Linux and unsigned device Release passed. The coordinator also verified a signed Mac artifact with the existing identity/profile, orientation module and native camera marker. **It is not installed.** Keep the installed 0.3.5 Host fix and all owner data intact.

The diagnostic at **5ac56c13c1895f2d8f4388e26532c145ad048894**, [run 40447306302](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40447306302), job `122001538000`, failed after **22m16s**. The Swift preflight and native compilation reached the real XCTest smoke. At its first portrait check, the recorded facts were:

- `appState: 1` — XCTest's `notRunning` state.
- `appExists: false`, `applicationFrame: {}`.
- `deviceOrientation: 1`, `identityExists: false`.

These facts establish that the app was stopped when orientation was checked. They do **not** establish why it stopped, whether it crashed or failed to launch, or a production rotation defect. Landscape, relaunch and authenticated Host orientation controls were not reached. The exact current suite totals need the retained XCTest summary; the public annotation alone cannot establish all 20 case results. Linux [40447306226](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40447306226) passed in 1m16s.

The earlier d44b262 runtime, run 40440776828/job 121980331378, executed 20 cases: 19 native image-engine passes and one initial-portrait UI failure. Keep those historical counts separate from the latest run.

The first standalone preflight, 7d0c86e/run 40446729780, stopped after 52 seconds without executing native tests because it lacked XCTest's Swift test-library search path. The revised invocation discovers the simulator platform, verifies `Developer/usr/lib` and supplies it using `-I` alongside the XCTest frameworks. The 5ac56c1 run verified that repair by reaching XCTest. This did not change app code or assertions.

## Next bounded evidence run

Before changing application code, capture the fresh simulator's own launch/termination evidence. A collector runs only after an XCTest failure on a simulator created by this invocation, before deletion, with a 25-second outer deadline. It emits reduced JSON: correlated recent app crash metadata and technical fatal-error messages, never raw crash reports, environment values, unrelated process logs, owner photos or credentials. Missing evidence stays explicitly unavailable and cannot turn a failed run into a pass.

Publish compact state/window and termination annotations separately so a long source path cannot truncate the useful fields. The raw xcresult size/quiescence guard stays intact. The app, all 20 required test identities, orientation predicate, 15-second orientation wait, 40-second identity wait and finite build/cleanup budgets remain unchanged.

The new collector is locally verified with synthetic filesystem/process fixtures; actual Apple-host collection remains unverified until the next deliberate `[native-runtime-ci]` run. This is one attempt to obtain missing startup evidence, not another identical timeout retry. Inspect its terminal result before any further run.

## Local service readiness

The saved loopback Worker startup passed again in this cloud instance. `npm run smoke` verifies the legacy five-photo path and mocked sharing. After starting `bash scripts/dev-api.sh`, `node scripts/smoke-four-keepsake.mjs` passed 46 HTTP assertions for four originals plus a V2 keepsake: readiness waits for the keepsake, immutable recipe replay, five SHA-256-matching downloads and revocation across every role. The owned service was stopped and port 8787 closed.

[The sanitized report](../artifacts/test-results/runtime-diagnostic-local-api.json) records the exact script hash and limits. These 46 assertions are separate from the 461 integrated application tests. Local emulator transport does not establish live Cloudflare access, native rendering, camera, Photos, iPad upload or SMS. No production requests or real messages occurred.

## Remaining release gates

Keep the prepared iPad update held until startup investigation is reviewed. Test Host passcode and biometric access on the already-installed 0.3.5; another build is unnecessary for that check. Actual 0.3.6 rotation/capture/retake/Photos/restart/offline acceptance remains open. Pairing automatically uploads existing confirmed real-photo sessions and still needs the coordinator's explicit credential/data-scope approval. SMS eligibility and live tests remain separate.
