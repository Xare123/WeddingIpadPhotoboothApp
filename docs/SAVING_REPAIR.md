# Saving repair and first iPad check

The owner reported that the earlier build saved nothing visible in the app or Photos. That evidence overruled the earlier synthetic pass.

The installed Expo SDK 58 exposes file `copy`, `move` and `write` as asynchronous native methods. The original code and first adapters did not await them, so verification could race an unfinished file and native errors could escape. The production adapter now awaits those operations. Its tests deliberately delay/reject the native bridge methods and enforce SDK 58's default refusal to overwrite existing destinations. Only owned incomplete staging files can be overwritten during a same-photo retry; originals and retakes remain immutable.

The earlier app also had no Photos export and no visible library of prior sessions. The reworked app verifies each local original before advancing, keeps a recoverable file journal independent of SQLite, exposes a host-authenticated offline library, and offers separate add-only Photos copies. It retains existing originals, retakes, legacy drafts/staging files and stable IDs. Queue/index failures do not erase a saved original.

Photos permission denial or export failure never invalidates the local original. A native Photos call interrupted around acknowledgment can have an **uncertain** outcome; automatic retries skip it. Check the actual Photos app before any deliberate duplicate-aware retry. Exactly-once Photos export is not claimed across process death.

The later independently reviewed refinement normalizes staged bytes to a canonical JPEG before counting them as saved, queueing or Photos export. A failed normalization remains visible for host **Finish local save** recovery. Bounded reconciliation before each queue drain reconstructs missing or malformed SQLite jobs from confirmed journals without relaunch, preserves valid completed acknowledgments/backoff and prevents a photo ID from referencing another original. Host saved sessions expose retained takes and deliberate per-photo Photos acknowledgment/retry; unselected retakes remain outside guest publication. These four independent fault sequences pass with real Linux files/SQLite and substituted native ports; they still require iPad rehearsal. The current source and hosted build are pinned in [the owner handoff](OWNER_IPAD_HANDOFF.md).

Install version **0.2.0, build 2** with the same bundle identifier and signing team as the existing app. Do not uninstall or clear storage. The owner uses free Apple ID personal-team signing; check profile expiry and refresh near November 1.

Before configuring cloud sharing, disable Wi-Fi, capture five test-card photos, inspect every photo in review and the host's Saved sessions, retake one, force-quit/reopen and reboot. Verify all five selected originals plus the retained retake. Grant add-only Photos access and inspect the Photos app separately. If any step fails, retain app data and report the host's diagnostic stage; do not treat cloud pairing as the fix for local saving.

After private pairing, restore Internet and verify one five-photo guest page, phone QR scanning, five original downloads, and Next guest privacy. These are physical-device acceptance steps. Linux adapter tests, browser fixtures and unsigned compilation do not prove they passed.
