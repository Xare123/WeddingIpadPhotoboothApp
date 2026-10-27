# Wedding launch gates

Current code checkpoint: 0.3.6/build9 orientation and Retake All pass local461 tests/98 guards/24 browser groups; fresh native runs and actual device acceptance remain separate. Exact3cc16e6 0.3.5/build8 Host repair is installed with app data/identity preserved, but has not been launched/authenticated. Earlier manual local originals and Apple Photos copies were confirmed; intentionally deleted Photos copies must remain deleted. Pairing automatically uploads existing confirmed real photos and needs coordinator-approved data scope. Production sharing/SMS are not verified. See [current validation](VALIDATION.md).

Target event: **November 1, 2026**. This is a release checklist, not a statement that launch has completed. Deliver four reliably saved photos per new session, large review/individual retakes, optional postcapture looks, a strip/grid keepsake in three themes, a private guest page and one QR. Preserve existing five-photo sessions. SMS remains optional while eligibility is unresolved.

## Immediate owner decisions

- Prepare the confirmed MacBook/Xcode and free Apple ID personal-team signing. Inspect actual expiry and renew/rehearse near the event using the same team/bundle identifier. Preserve existing app data; no uninstall or storage reset. Confirm iPadOS and booth orientation.
- R2 activation is complete: use the owner's existing `gizelleandrami-photoboothphotos` bucket. Parent read-only inspection verified `r2.dev` disabled and no bucket custom domains. The earlier 403/code10042 activation blocker is resolved.
- The coordinator reports this revised backend deployed fail-closed on isolated Worker `wedding-photobooth` (version `e11f1d52-24ce-49cf-83a5-c9b6aa035de9`, bundle SHA `5cc1e7390ecebc05d7815bf0b7819c5aca2478f6db105adac81d10cd9f3672c9`). Verify current state before any redeployment. Device-token provisioning, canonical-domain and live-storage acceptance are still separate gates. Preserve the main website and encrypted secrets; this cloud coding agent performed no deployment.
- Review the proposed seven-day guest-link lifetime, original-retention/deletion policy, expected photo count and maximum storage/SMS budget. The TTL is configurable and appears explicitly to guests; access expiry does not delete originals. Choose an operator backup/export method.
- Confirm guest number countries and approve any SMS provider only if current personal-use eligibility, sender/domain onboarding and delivery timeline are acceptable. Default to QR if approval slips.

## Before production deployment

- Pass current automated checks and inspect the production EXAMPLE config. It intentionally contains no active account/zone/routes or live secrets. Use the existing private bucket, create no duplicate, and obtain any still-required billing/secret approval before a live write.
- Use the private bucket binding, approved HTTPS origin, and securely configured distinct `DEVICE_TOKEN`/`LINK_SIGNING_KEY`. The owner approved those two credentials; the coordinator handles their values and the existing backend-only Textbelt key. Preserve secret bindings on upload, never print their values, and use the reviewed one-use pairing path for the iPad.
- Give the new Worker only the existing booth bucket binding and all eight required native rate-limit bindings. Review example namespace IDs against other account Workers and confirm plan support without an unapproved upgrade. The counters are approximate per location and do not enforce a hard worldwide financial cap; choose account-level budget controls separately.
- Apply and inspect explicit disabled invocation logs, traces, persistence, sampling, Logpush and tail consumers. Guest capability tokens are in paths, so query-string redaction alone is insufficient. Verify account/infrastructure integrations separately.
- Use a dedicated subdomain only. Check DNS/custom-domain state read-only before any write; after an uncertain write, inspect its outcome before retrying. Do not touch root records or shared resources.
- Exercise production health, authenticated upload, idempotent replay, a synthetic session page, byte-identical original download, wrong-token/cross-session denial, expiry and revocation. Health alone does not prove R2 works. Follow the concrete live synthetic-storage procedure in `artifacts/deploy/README.md`; use synthetic photos only until explicitly approved otherwise.

## Before the event

- Complete [the actual-iPad checklist](IOS.md) using the intended signed standalone build, not Expo Go or a cloud web preview.
- Verify each exposed shot is discoverable in the host's offline local library, including after a failed upload/index and force-quit/reboot. Confirm Photos copies separately with add-only permission, denied permission and uncertain-export behavior. Do not count a browser's in-memory adapter as disk or Photos proof.
- Make at least one complete real-device-to-live-backend-to-cellular-guest rehearsal with a QR. Test loss of Wi-Fi and app restart. Inspect a downloaded original for orientation, resolution and mirroring.
- Charge the iPad, reserve enough local storage, arrange a power cable and backup network, verify kiosk exit and assign a booth host. Preflight from a cold reboot on the day.
- Confirm retained originals have a second copy. Do not uninstall the app, clean its storage or purge queues to troubleshoot connectivity.
- If SMS is enabled later, test consent, sender identity, opt-out requirements, capped resends, accepted/delivered distinction and spend limits with explicitly approved recipients and budget.

## Connectivity fallback

Without Internet, capture and preserve on the iPad, show an honest pending state, and upload when connectivity returns. A remote page/QR cannot be ready until the backend acknowledges both the original and session manifest. A guest who leaves before readiness cannot receive a later photo through QR alone; the host needs an explicitly opted-in approved contact method or a deliberate post-event collection process. Do not promise automatic delayed SMS while the provider is mocked.

If native signing, private storage deployment or the real-device rehearsal remains unresolved before the event, use a proven existing booth/camera workflow and retain originals instead of treating this unverified build as the sole wedding capture system.

## After the event

Verify all uploads and a host-controlled export/backup. Select images for the wedding website with the couple's approval; never expose the entire bucket or all guest sessions as an incidental import. Revoke guest links and remove unnecessary recipient data according to the chosen retention policy. Delete local originals only after verified independent backups.
