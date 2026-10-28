# Wedding-day text sharing controls

Host Settings → Show text-message option → Save booth settings hides/reveals SMS only. Existing authentication, pairing, credentials, jobs, photos and QR access are preserved. Legacy settings default to showing the option; service eligibility still gates availability.

Send immediately shows Sending… and retains its synchronous duplicate guard until queueing and refresh settle. Existing outcomes distinguish provider acceptance from delivery, rejection, and uncertainty. No automatic uncertain resend was added.

The modal uses an in-app number pad with the system soft keyboard suppressed, so a floating iPad keypad cannot overlap its heading. Existing modal orientation support and US normalization remain intact.

Validation: 489 repository tests passed, including 20 focused preference/presentation checks; workspace typechecks and native JavaScript export passed. Browser render attempt did not expose the SMS entry in the existing synthetic fixture, so visual/native-device validation is outstanding. No real SMS, backend settings or credentials were changed. Native installation was not attempted.

Next device check: save the visibility toggle, relaunch and verify QR/setup remain intact; restore it, enter a number with the pad in both orientations, verify unchecked consent disables Send, then inspect Sending/results using an approved mock path only. Production SMS eligibility remains coordinator-owned.
