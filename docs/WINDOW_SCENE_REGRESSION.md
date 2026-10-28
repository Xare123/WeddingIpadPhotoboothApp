# Shared window/overlay regression candidate

Reported baseline: installed build15, source70af642. The coordinator's private pixel review shows the entire landscape app window offset, wallpaper on the right, and no active modal or keyboard. This cloud task could not materialize the Library JPEG and did not inspect or publish it. The physical-window cause is **not yet proven**.

## Source findings and candidate

The booth previously used separate native modal controllers for Host, timer, SMS, retake confirmation, Look and keepsake inspection. Host requested pageSheet; other screens requested native full/over-full-screen presentations. Adding supported orientation props alone did not repair the owner-reported offset. Orientation admission also omitted several active overlays, permitting a request while their presentation was active.

All app overlays now render in a single host inside the existing React/window root. They no longer present UIKit modal controllers or request window/scene geometry. Stable layer keys retain surviving input/editor state; only the top layer accepts touches/accessibility, and closing returns to the preserved underlying screen. Native slide/fade presentation attributes no longer trigger native transitions; this stability candidate opens/closes overlays immediately. System authentication and permission alerts remain OS-managed.

The orientation controller checks synchronous overlay activity, including after a pending support check, as well as its reactive blocker context. Requests defer until the overlay closes. A deterministic race regression verifies zero native requests while blocked and one after close without poisoning retry state. Explicit Host orientation preference remains preserved and is applied at a safe transition. Normal existing orientation-policy requests still exist at startup/foreground; this change does not establish that they caused the offset.

No credentials, PIN/authentication policy, pairing, queue, originals, Photos or backend/SMS configuration are changed. No new native dependency, scene flag or forced window resizing is introduced. The existing UIRequiresFullScreen compatibility setting is unchanged; it is not proof of full-screen behaviour under current iPadOS windowing.

## Evidence and limits

Local verification passed497 repository tests,138 CI guard checks, typechecks and iOS JavaScript export. Actual synthetic browser checks also passed retake Cancel, Look open/close, keepsake inspection/return, and the cycles below in both orientations. `node tools/native-visual/check-window-overlays.mjs` (with the existing local visual server running) checks nested input surviving lower-layer removal, close/reopen, and actual timer edit/apply/cancel/reopen plus Host open/Done at820x1180 and1180x820 with unchanged root bounds. These checks are not UIKit scene or physical rotation proof. The standalone new source contracts verify every app overlay imports the shared host and that native geometry APIs are absent from it.

Independent source review corrected unstable index keys and Back dispatch ordering, then approved the synchronous orientation-admission fix. VoiceOver focus/restoration and native keyboard behaviour remain device gates.

The Mac reviewer supplied Apple's TN3192 deprecation finding: https://developer.apple.com/documentation/technotes/tn3192-migrating-your-app-from-the-deprecated-uirequiresfullscreen-key . This executor has no allowed Apple documentation host/browser tool, so it did not independently retrieve the note and did not add guessed Info.plist keys.

## Required Mac diagnosis/acceptance — coordinator-owned

1. Preserve installed identity, signing overrides, app container, pairing and all originals. Record **numeric** UIWindow frame/bounds, windowScene coordinate-space bounds, screen bounds/interface orientation and presented-controller names on build15 before/after the reported trigger, if it can be reproduced safely. No private image/accessibility dump in public evidence.
2. Establish whether the window is already offset before interacting. Source overlays cannot unilaterally reposition an iPadOS-managed window. Any owner-assisted maximize/recovery must use the normal supported UI within existing authorization; do not reset app data or alter global/device settings silently.
3. On the candidate, repeat timer open/change/apply/cancel/reopen, Host authentication/open/Done, SMS open/close without sending, retake confirmation Cancel, Look and nested keepsake inspection. Check bounds before/after each, background/foreground and portrait/landscape under saved Auto and manual Host choices. Never discard an existing session to continue.
4. Check system keyboard dismissal in private setup, overlay nesting, taps/scrolling and VoiceOver focus/escape/restore where owner-attended testing is available. Do not enable OS accessibility/global settings silently.
5. Verify existing QR, preserved photos/jobs and restart recovery. No SMS request, backend settings change or photo upload is part of this diagnostic phase.

Only observed native bounds/cycles can establish recovery and prevent recurrence. Passing browser tests or removing native presentation paths does not close that gate.
