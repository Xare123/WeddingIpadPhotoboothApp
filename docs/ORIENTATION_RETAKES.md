# Display orientation and whole-shoot retakes

Version **0.3.6 / build 9** adds persisted **Auto / Portrait / Landscape** Host settings and a non-destructive **Retake all 4** flow. The frozen App SHA-256 is `d49e6318af58b395d1b90a97359beb4ae542acc7a6f90a7c29b25414b943cd63`. That feature source passed local and device compilation checks but failed startup; the targeted0.3.7/build10 repair now needs its own native results. See [startup evidence](NATIVE_RUNTIME_DIAGNOSTIC.md). The coordinator verified that the earlier Host repair, exact `3cc16e6e6780e97fdb3fad7568ac99fab6f43e76` (0.3.5/build 8), is installed in place with the existing identity and data preserved. The owner now confirms Host Settings opens; controlled authentication/relocking acceptance remains separate.

## Display controls

Host → Controls starts with Display orientation. Tapping a choice changes only the draft. Save booth settings performs fresh OS authentication and a guarded Keychain write before the orientation controller receives the committed preference. Missing/invalid/legacy values default to Auto; explicit saved choices survive restart. No independent preference-writing port exists in the controller.

Auto uses Expo's DEFAULT/unlock policy, Portrait uses upright portrait, and Landscape allows both landscape directions. Native commands are serialized and admitted only while active and outside capture, preservation, editor or authentication work. A delayed module load also checks current synchronous refs. Stalled support/command calls have a five-second admission deadline: capture controls recover with a truthful error, while the noncancellable native operation remains owned until it settles. No overlapping request or late support admission is allowed. A timed-out result cannot become observed success.

A resolved native Promise is not rotation proof. The controller reads the actual interface orientation, current lock and **window** dimensions, and subscribes to native plus window events. Two seconds without a matching observation becomes unconfirmed. iPad multitasking/windowing and rotation settings may prevent the requested geometry, especially on iPadOS27; the UI reports that and stays responsive. Orientation affects the interface, never saved originals, mirroring, crops or template aspect.

The exact official MIT Expo module is `expo-screen-orientation@58.0.3`, recorded with registry integrity in the lock. Native prebuild must run from `apps/ipad`. It verifies 0.3.6/build9, DEFAULT's all-but-upside-down mask, full-screen configuration, and portrait/both landscape orientations; autolinking resolves 19 modules including this SDK. The camera-only source-build opt-out stays unchanged. These are generation/resolution checks, not compilation or device proof. A rebuilt native binary is required.

## Retake all

From a completed unconfirmed review, Retake all 4 opens a confirmation with the guest's current thumbnails. The previous set remains saved. Confirmation creates a fresh child session and returns to the full-bleed camera; the guest can check their pose/timing before starting. An individual retake still works independently. Legacy five-photo sessions show Retake all 5 and retain five-photo semantics.

The child's first durable session record includes its parent ID, open state, timing snapshot and optional layout/theme/grid-aspect defaults **before** the active pointer changes. Old files, selections, Photos records and completed upload acknowledgements remain unchanged. New photo IDs and fit crops are created; parent derivatives/composites are never reused as new captures. New shots begin in Original, as the confirmation explains.

Keep the previous set instead journals child abandonment before restoring the verified parent pointer. A crash between those writes recovers the parent. Inactive, abandoned or stale child/parent callbacks cannot reactivate a retake family through the legacy active setter. Guest capture/filter/selection/composite/confirmation mutations reject abandoned work; archival Photos result accounting can finish truthfully. Preserved canceled files remain available to Host without becoming guest publication.

App cancellation must not abandon an exposed photo. The return action is disabled and announced as disabled during the native capture Promise, durable save, unresolved original or export; the handler also checks synchronous ownership and the runner's cancellation result. Countdown cancellation can stop before exposure. The repository uses the same serialization tail for preservation and cancellation. Previously saved sets stay intact through partial failure, background/relaunch and explicit return. A new completed four-photo attempt still needs its own keepsake and ordinary explicit confirmation before upload jobs are created.

The camera's zero-save copy says **this set**; it never implies that previously retained photos disappeared. Portrait strip Full photo remains uncropped; contextual guidance offers explicit Fill frames and asks guests to check each face. No crop is applied silently, and original downloads remain untouched.

## Exact local validation

The final clean setup passed **591 locked packages, all workspace typechecks, 461 integrated tests and a 1,060-module iOS Hermes export with two assets**. **98 CI/source-preparation guards** pass. These totals include, rather than add to, the focused orientation and persistence tests.

Independent review reproduced and verified the repaired stale-pointer paths using real temporary files/SQLite. Three independent scenarios and 127 focused regressions passed. The production Retake All suite covers journal boundaries, blocked exposed saves, stale callbacks, unchanged parent bytes/ACKs, new-four confirmation and legacy five. Orientation's 58 focused tests cover native observation versus requests, deadlines, coalescing, lifecycle/disposal and missing modules.

[Actual-Root browser evidence](../artifacts/visual/orientation-retake-index.html) passes **24 groups**, 12 per orientation, with **38 screenshots** and two independent full-frame QR decoders per orientation. It checks drafts versus fresh-auth saves, native/window disagreement, stalled support/commands, late module initialization, Retake All timing/return/recovery, separate native capture/save gates and private abandoned originals. All 42 product, 11 fixture and four tool hashes match; 45 evidence entries and all 491 historical visual files were checked unchanged. Root inspected both contact sheets. The device, OS authentication, Keychain, camera, Photos, Canvas export and network ports are explicitly synthetic.

The existing eight high audit entries remain; the new orientation package has no reported entry. No forced upgrade or audit suppression was used. Native image engines, their prior B4E19/19+16 JPEG evidence and the prepared V2 Worker bundle are unchanged. Exact-source unsigned Release and the coordinator's signed Mac candidate compiled the orientation module. Actual iPad orientation/capture acceptance remains open.

## Hosted and owner acceptance

The published d44b262 candidate passed hosted Linux and unsigned device Release; the coordinator also prepared a signed same-identity Mac artifact. The full runtime failed its first UI check. Follow-up5ac56c1 recorded the app **notRunning** at that check, so [startup investigation](NATIVE_RUNTIME_DIAGNOSTIC.md) now takes priority over a rotation-code change. The prepared update remains held. The standard ARM runtime keeps Xcode26.3, all20 identities and finite budgets; the device Release lane remains Intel. No larger runner, new cache, credential or paid test resource is provisioned. Report actual execution, not enumeration or compilation.

On the owner iPad, preserve the installed identity/data and first verify the 0.3.5 Host passcode/biometric route. For the matching rebuilt 0.3.6 candidate, save each orientation and relaunch, test actual Auto rotation and fixed preferences in full-screen/windowed modes, then four-shot timing, Retake All/individual retake, pause/save/return, restart/reboot, original byte preservation, Photos and full-resolution keepsake parity. Do not recreate intentionally deleted Photos copies. Pairing automatically uploads existing confirmed real-photo sessions and remains coordinator-controlled with explicit data-scope approval; SMS eligibility and live sends remain separate.

Live face-tracking effects are a separate enhancement under feasibility review. Existing Warm/B&W/Film are actual offline post-capture derivatives, not a live filtered camera.
