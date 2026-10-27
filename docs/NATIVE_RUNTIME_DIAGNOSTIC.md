# Release startup repair

## Candidate and cause

Version **0.3.7 / build 10** replaces the orientation adapter's namespace import of React Native with a lazy, property-specific `require('react-native').Dimensions`. The normal Expo/App entry is restored byte-for-byte; it no longer initializes core modules for diagnostic logging. App JSX, native Swift, dependencies, photo storage, authentication and the Worker are unchanged. Exact `9ed36b4eac6ce558b82b22db4e08037308b87a2c` now passes both native gates below. A matching signed Mac build and physical acceptance remain; the held signed0.3.6 artifact is not this candidate.

The old adapter used `(await import('react-native')).Dimensions`. The actual exported iOS bundle routes that import through Expo's async loader and `require.importAll`. React Native's CommonJS entry has lazy export getters, and Expo's loader evaluates every getter while constructing the namespace. That includes the unused, deprecated `PushNotificationIOS` export, which constructs `NativeEventEmitter` with its optional native push manager. A missing push manager can therefore cause the exact non-null invariant seen in the crash, although the app never requests notifications.

An independent VM reproduction evaluates the installed Expo loader, React Native entry, PushNotificationIOS and NativeEventEmitter sources without editing them. Named Dimensions access avoids the push getter; namespace access with a missing native push binding throws the exact invariant; providing that binding removes it. Only native/platform boundaries and unrelated UI dependencies are substituted. These are JavaScript mechanism controls, not Hermes, TurboModule-registration or iPad execution. The sanitized source hashes and controls are in [the reproduction report](../artifacts/test-results/rn-namespace-mechanism.json).

The regression in `apps/ipad/test/orientation-import-boundary.test.ts` transforms the **actual adapter** using the installed Release/iOS Metro worker and executes its default loaders through the actual Expo loader. It checks Dimensions observations and listener cleanup without touching the optional export, plus two negative controls that exercise the unsafe namespace path. No production dependency, native invariant, orientation assertion or timeout is weakened.

## Terminal evidence before the fix

The probed-entry diagnostic **d553a00e2cd67a0a00753183a3af8fbb878828dc**, [run 40459566660](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40459566660), job `122040702149`, **failed after 36m23s**. It reached the real XCTest smoke and recorded:

- `EXC_CRASH / SIGABRT / SIGNAL code 6`.
- KeyboardObserver, AppState, WebSocketModule and the Animated family all **available**.
- App `notRunning`, no application frame/windows, identity or Start action at the first portrait check.

The fixed availability record did not prevent the failure. It did not probe the optional push manager, so it cannot rule out the namespace mechanism. Public annotations establish the crash and failed UI method; complete case totals require the retained XCTest summary. Linux [40459566732](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40459566732) passed in 1m24s. The diagnostic build is not an installation candidate.

The coordinator independently verified the preceding **84db1c8** [run 40451321760](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40451321760), job `122014466279`: **20 executed, 19 engine passes, one UI failure, zero skips**, with SIGABRT and the NativeEventEmitter non-null invariant. This was an application startup crash, not evidence that the orientation predicate was wrong. The initial d44b262 run also had 19 engine passes and one initial UI failure. Historical runner, compilation and Swift-overlay failures are separate from these executed assertions.

Expo's missing-module error customization is installed only in Expo Go. An unchanged invariant in this standalone Release does not establish that failure preceded the Expo import. Metro can also report a first-time module evaluation error directly to native `ErrorUtils` before an adapter catch can help; the old catch did not guarantee native safety.

## Verification boundary

Local checks pass: **474/474 application tests**, all workspace typechecks, **138/138 tooling checks**, a **1,060-module/two-asset iOS Hermes export**, and three installed-source mechanism controls. The three actual-Metro adapter cases are included in the 474 total. The first export lacked the saved cloud wrapper and failed on its cache path; sourcing `scripts/cloud-env.sh` and rerunning the export passed. [The local report](../artifacts/test-results/native-namespace-repair-local.json) preserves those boundaries.

The exact repair passes the unchanged **20-method** [Release runtime](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998097): **20 executed, zero failures/skips**, comprising19 production image-engine cases plus app launch, portrait/landscape and relaunch, in25m38s. [Unsigned device Release](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998043) passes in21m08s; [Linux](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40463998107) passes in1m11s. [The hosted record](../artifacts/test-results/native-namespace-hosted.json) binds these results to9ed36b4. The optional collector had no correlated diagnostic on the passing run; its legacy failure-only fallback notice is corrected to neutral wording in the handoff change. A passing runtime is separate from an unsigned physical-SDK Release build and a matching signed Mac artifact. A prior build or registry probe cannot supply that provenance. Keep existing finite budgets, all test identities and original assertions.

The current app JSX hash remains `d49e6318af58b395d1b90a97359beb4ae542acc7a6f90a7c29b25414b943cd63`. The earlier 24 browser groups and 38 synthetic screenshots cover that UI with substituted device boundaries; they do not verify this entry/loader on iOS. The separate historical B4E native result remains 19/19 cases plus 16 genuine JPEGs, not current full-app or device acceptance.

## Preserved owner and service state

The real iPad still has exact **3cc16e6 / 0.3.5 / build 8** installed with its identity and data preserved. The owner confirms Host Settings opens. Controlled biometric/passcode/cancellation/relocking, current orientation, Retake All, interruption/reboot and standalone device acceptance remain separate checks. Earlier app-container inspection verified four originals/journals, one keepsake and SQLite integrity. The owner confirmed the Photos copies and then intentionally deleted some; do not restore or re-export them.

The owner approved the dedicated credential and private transfer of existing confirmed queued real-photo sessions. The connector still denies the origin, so use only the reviewed [owner-operated handoff](OWNER_MANUAL_PRIVATE_SETUP.md); never route an agent request through another host, proxy or executor. No agent credential generation, issuance, live upload or SMS occurred here. Pairing starts that confirmed queue automatically. Provider eligibility, a genuinely ready guest page, explicit consent and the coordinator's three-message limit remain live SMS prerequisites.

Local Worker startup, legacy mock sharing and 46 four-photo/keepsake HTTP assertions already passed; [the exact-source report](../artifacts/test-results/runtime-diagnostic-local-api.json) records their scope. This repair changes no API contract. Local emulation does not prove production R2, pairing, private downloads, QR phone scanning or SMS.
