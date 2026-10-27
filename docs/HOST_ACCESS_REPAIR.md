# Host access and sharing diagnostics repair

The repair target is **0.3.5 / build 8**, published at **`3cc16e6e6780e97fdb3fad7568ac99fab6f43e76`**. [Hosted Linux40433500707](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40433500707) passed in1m8s; [unsigned native Release40433500769](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40433500769), job121956572667, passed in21m8s with compilation, embedded JavaScript and iPad metadata verified. No XCTest, signing, install or device authentication is established by that Release run. The frozen App source SHA-256 is `9425fa216f680b9f6add46d16eca4d3a0cca4bfb52aaac6eb010b814b269068e`. The coordinator has now verified **0.3.5/build8 at `3cc16e6` installed in place**, preserving identity and app data, without launching or authenticating it. The prior native image baseline is `b4e01d3aeb47c3f164f912b829b4807cc3551f8d` (0.3.4/build7). Its 19-method native image pass, 16 exported JPEGs and signed/unsigned Release evidence remain valid for that source; they do not test this repair. See [validation](VALIDATION.md).

## Latest actual iPad evidence

The authorized Mac check verified **four original files with matching journals, one keepsake and SQLite integrity** in the app container. It observed **five pending uploads, attempt count 15, no guest URL and no reported error**. These counters do not establish a network request, upload, remote storage or delivery. Pairing state remains unknown; no Keychain value was read.

The owner personally confirmed **all test photos reached Apple Photos**, then intentionally deleted some. That is positive physical saving evidence for that session, not a completed interruption/reboot/long-run acceptance test. Do not restore or re-export the deliberately deleted copies, reset their export records, or inspect unrelated Photos content. Preserve all app originals, journals, recipes, queue identities and existing signing identity.

Host access to the system PIN/passcode fallback was inaccessible across screens in the owner session. That is the reproduced P0 issue. A Touch ID failure or its underlying cause has not been established.

## Implemented repair and acceptance contract

- A guarded Host entry must be reachable across the guest screens without interrupting capture or an exposed file save. Cancellation and failed authentication must leave guest state and originals intact.
- Secondary iPadOS authentication must protect sensitive host operations, with reachable system passcode fallback and truthful safe failure messages. No app screen should collect or log the iPad passcode. Controlled lifecycle tests cover the guarded entry and secondary actions. The actual system passcode and biometric routes still need device verification.
- Diagnostics must separate **Setup required**, **Saved locally / queued**, an observed **Sharing failure**, and a genuinely **Ready** guest page. Counts or a retry tap cannot stand in for server acknowledgement.
- Missing configuration must preserve confirmed files and jobs. It must not claim an upload, invent a request failure, clear or reset jobs, or rewrite acknowledgement/attempt history to make the queue look healthy.
- Diagnostic output may expose safe version/count/state/error categories, never credentials, pairing codes, raw bearer URLs, phone numbers, photo content or raw native/server error payloads. No Keychain-value inspection is part of this repair.

Last verified production state had `DEVICE_TOKEN` absent, pairing disabled and SMS mocked. It has not been rechecked by writing these docs. [Private provisioning](PRIVATE_PROVISIONING.md) explains why pairing is also a real-photo upload action requiring explicit data-scope approval and coordinator execution. Do not enable pairing, generate credentials, bypass a 403, or send SMS as a diagnostic shortcut.

## Next bounded checks

Local validation passed 380 integrated tests, 97 CI/source-preparation contracts and the four independent filesystem/SQLite recovery regressions. An independent reviewer also reran 14 synthetic lifecycle fault probes, including revocation during later reads/pairing and preserving Photos uncertainty. These are overlapping checks, not additional distinct product test counts. The clean frozen setup also passed (590 packages; 1,053-module iOS export/two assets), and the final actual-Root browser fixture passed 30 groups/48 screenshots with independent QR decoding in both orientations. The browser and native boundaries, evidence and hosted Release status are recorded in [validation](VALIDATION.md).

On the iPad, test guarded entry and cancellation from each screen, system-auth success/failure/cancel/passcode handling, redaction on background/foreground, and missing-configuration behavior without changing existing job identities or acknowledged state. Then rebuild and validate the exact repair source before a same-identity update. The installed 0.3.5 Host fix now awaits that actual-device check. A later orientation/Retake All candidate is separate. For the next rehearsal, use a new harmless marked scene within the already approved device-test scope; do not replay the deliberately deleted Photos exports.

The owner approved the app update and dedicated runner at **00:18 UTC on October 27**. Runner execution is already authorized, but signing remains blocked by the account/profile prerequisites; it is **NOT_ARMED** and uninstalled. Record that blocker rather than requesting the same permission again or creating a new account/profile. No physical runner pass is established.

After P0, the requested backlog is **Auto (default) / Portrait / Landscape** host orientation control, improved portrait strip fit, nondestructive **Retake all**, and native Vision face effects. These are not implemented or validated by this repair checkpoint. Existing originals and template choices must remain intact.

## Exact Mac acceptance target

Use commit `3cc16e6e6780e97fdb3fad7568ac99fab6f43e76` for the next warm same-identity build. Preserve private bundle/team/profile settings, the existing container, all originals and warm DerivedData. Verify 0.3.5/build8, signature, embedded JS and compiled camera marker before a coordinated update. Test Host entry on welcome/camera/review/sharing using passcode fallback and biometrics separately; test cancel, rapid repeat and a real background/foreground. Then test a harmless settings save through its second OS prompt. If blocked, start private Mac Console Info streaming filtered to `[host-access-state]` before one attempt and read the visible `booth-status-message`; never record PIN entry or share raw/private diagnostics publicly.

The next orientation and Retake All features are separate local work, not part of this tested revision. Pairing/upload scope and SMS gates remain separate.
