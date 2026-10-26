# Timing the booth

Version **0.3.2 / build 5** gives a group a little longer to get ready, then keeps the remaining photos moving. New host defaults are **5 seconds for the first photo** and **3 seconds for following photos**. Each control snaps to 2, 3, 5, 8 or 10 seconds.

Before starting, tap the small **5s first · 3s next** chip on the camera screen. The bottom sheet has independent First photo and Next photos sliders, labelled stops and accessible minus/plus controls. Changes remain a draft until **Use this timing**. Cancel or tapping outside discards the draft; Use booth defaults restores the saved pair. The controls support both orientations and reduced motion. They disappear while capture is running; no prompt interrupts each shot.

Guest choices change only the current in-memory session. They never write host preferences. **Next guests** restores the host's saved defaults. Restarting the app also restores host defaults while the photos and pending sharing jobs remain durable. Hosts can persist both values in **Host → Controls → Booth timing defaults → Save booth settings**. A valid older `countdownSeconds` preference migrates to First photo, preserving that host's earlier choice; Next photos starts at 3 seconds. An updated installation may therefore show a retained first-photo value rather than the new-install default of 5.

## The capture sequence

The first photo of every newly started sequence uses preparation time. Automatic following photos use the next-photo countdown, beginning only after the previous original is durably saved and the camera is ready. Saving and waiting for camera readiness have their own UI states. There is no separate three-second gap added before a three-second countdown.

With immediate simulated saving and readiness, the default four exposures occur at 5, 8, 11 and 14 seconds after Start. These are virtual-clock scheduling checks, **not a promise that a real session takes 14 seconds**. Real capture, saving or camera recovery can take additional time.

Pause/continue, return from background and an individual retake all use preparation time again. A retake still replaces only its selected slot after durable completion. The timing pair and retake target are copied at sequence start; later UI changes cannot alter an active sequence. Canceled timers and stale camera-ready callbacks cannot capture or unlock a newer sequence.

An exposed photo continues preserving if the app leaves the foreground. Camera remount waits until that preservation finishes, then capture waits for a fresh ready callback. This handles the installed SDK 58 behavior in which foreground resumption does not emit a new ready event. A fresh valid callback clears only the known camera-unavailable warning; unrelated save warnings remain. Actual iPad lifecycle behavior still requires rehearsal.

## Rehearse on the wedding iPad

- Start with host defaults 5/3. Check the chip, both sliders, labelled stops and minus/plus controls. Try portrait, landscape, larger text and VoiceOver adjustments/value announcements.
- Set a guest draft to 2/2, cancel it and confirm the chip remains unchanged. Apply it, capture four photos, then choose Next guests and confirm 5/3 returns. Verify there are no timing edits or extra prompts mid-countdown.
- Save host defaults such as 8/5, use a different guest pair, then check Next guests restores 8/5. Relaunch and verify host defaults persist but the guest override does not. Restore the intended wedding defaults afterward.
- Pause during a countdown, continue, background/return and retake one selected photo. Each new run must use the preparation timer again; automatic following photos must use the next timer.
- If saving or readiness takes longer, check the visible state and confirm the next countdown does not start early. Do not clear storage or fill the device deliberately to test this. Use [the saving rehearsal](SAVING_REPAIR.md) for safe preservation and separate Photos checks.

[Actual-JSX browser evidence](../artifacts/visual/timer-index.html) records 13 functional groups and two normal-motion workflows, with 46 screenshots, two review contact sheets and two recordings. These use explicit synthetic camera/files/Photos/settings boundaries. [Independent acceptance](../artifacts/test-results/timer-independent-acceptance.json) covers focused timer and CI checks. Neither proves native gestures, VoiceOver, real-camera timing, Photos export or offline power-loss behavior. The final source commit and hosted results belong in [validation](VALIDATION.md) before installation.
