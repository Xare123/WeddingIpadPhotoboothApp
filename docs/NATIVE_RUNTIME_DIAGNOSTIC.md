# Release runtime evidence follow-up

Application code stays at **d44b2629ce8275ddbede6f42fd2227db44b85dcb**, version0.3.6/build9, App SHA-256 `d49e6318af58b395d1b90a97359beb4ae542acc7a6f90a7c29b25414b943cd63`. Its hosted Linux and unsigned device Release passed. The coordinator prepared and verified a signed Mac artifact with the existing identity/profile; it is not installed. The installed0.3.5 Host fix remains preserved and unlaunched.

ARM run40440776828/job121980331378 executed all20 required tests:19 native image-engine methods passed; the Release smoke failed its first portrait check after15seconds. It checked `XCUIApplication.frame.height > width` before establishing actual rendered identity/window readiness. Landscape, relaunch and Host orientation controls were not exercised. The result is a test assertion failure, not a build/host timeout. Existing retained evidence does not distinguish startup, actual window geometry and XCTest's application-frame reporting. No production cause is established.

The raw xcresult was withheld by the existing guard. It is not relaxed or bypassed. This source-only follow-up adds fixed-key state/geometry to the **failure assertion message**, so the bounded xcode-test log carries the facts even when raw attachments cannot be retained. It also adds named text/simulator-screen attachments for supported private result review.

Recorded fields are requested/device orientation, app state/existence, application frame, at most four window frames, identity/start existence, Start hittability and system-alert count. Nonfinite coordinates become JSON null. No labels, accessibility tree, phone, URL, credential, environment or private path is recorded. The pre-request log reads state only; it does not introduce an accessibility-readiness wait before the original predicate.

All20 identities, the application-frame predicate,15-second orientation wait,40-second identity wait,portrait/landscape/relaunch sequence and finite runner budgets remain unchanged. Production App/renderer/SDK/Worker code and the prepared signed artifact are unchanged. **99 source-preparation contracts pass.** The Swift diagnostic still requires Mac/Xcode compilation before another hosted opt-in.

The coordinator may typecheck the updated smoke source and run its single case on a fresh disposable Mac simulator with private evidence; label that as one case, not20. A later deliberate hosted `[native-runtime-ci]` push can rerun all20 once. Do not trigger duplicate full builds just to expose status or install the held iPad candidate before review.

Interpret the diagnostic before choosing a fix: if the app is ready and its window is correctly oriented, review the application-frame predicate; if startup is incomplete, investigate startup/readiness; if the actual window remains wrong, inspect native orientation. Preserve the intended gates rather than changing a timeout or accepting a false orientation pass.
