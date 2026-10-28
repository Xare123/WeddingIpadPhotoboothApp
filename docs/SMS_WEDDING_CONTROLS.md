# Wedding-day text sharing controls

Host Settings → Show text-message option → Save booth settings hides/reveals SMS only. Existing authentication, pairing, credentials, jobs, photos and QR access are preserved. Legacy settings default to showing the option; service eligibility still gates availability.

Send immediately shows Sending… and retains its synchronous duplicate guard until queueing and refresh settle. Existing outcomes distinguish provider acceptance from delivery, rejection, and uncertainty. No automatic uncertain resend was added.

The modal uses an in-app number pad with the system soft keyboard suppressed, so a floating iPad keypad cannot overlap its heading. Existing modal orientation support and US normalization remain intact.

Validation: 489 repository tests passed, including 20 focused preference/presentation checks; workspace typechecks and native JavaScript export passed. Browser render attempt did not expose the SMS entry in the existing synthetic fixture, so visual/native-device validation is outstanding. No real SMS, backend settings or credentials were changed. Native installation was not attempted.

Next device check: save the visibility toggle, relaunch and verify QR/setup remain intact; restore it, enter a number with the pad in both orientations, verify unchecked consent disables Send, then inspect Sending/results using an approved mock path only. Production SMS eligibility remains coordinator-owned.

## Edge review and timing-window correction

The initial 8b23401 hosted run40772551038 failed the exact App source pin in the physical-runner preparation checks. Reviewed SMS/modal changes preserve the capture selectors; the strict source pin was updated after that review, not removed. Preparation stays unsigned/unarmed and supplies no native execution proof.

Hiding SMS now clears only ephemeral sheet/input/consent state; it never releases the synchronous send guard or removes an in-flight job. Re-enabling does not reopen the old sheet. Pad insertion/deletion respects the controlled cursor/selection; paste remains unrestricted and reaches the existing US normalizer. Synthetic format/editing, visibility and guard tests cover these contracts; actual iOS paste menus/VoiceOver still require device checks.

The timing sheet now declares overFullScreen and all supported portrait/landscape orientations. Retake confirmation and Host modals also declare supported orientations. No Host orientation preference or app full-screen setting is changed. Actual native JSX browser checks passed open/change/apply/cancel/reopen in820x1180 and1180x820. This is not proof of physical rotation or iPadOS window resizing; the reported narrow-window symptom needs attended native validation. Private reference imagery was not downloaded or published.
