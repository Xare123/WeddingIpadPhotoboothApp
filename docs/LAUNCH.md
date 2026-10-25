# Wedding launch gates

Target event: **November 1, 2026**. This is a release checklist, not a statement that launch has completed. Keep scope to a dependable single-photo booth, private guest download page and QR. SMS is optional while approval is unresolved.

## Immediate owner decisions

- Prepare the confirmed MacBook with Xcode. Confirm Apple signing/distribution route and its expiry, iPad model/iPadOS and intended booth orientation.
- R2 activation is complete: use the owner's existing `gizelleandrami-photoboothphotos` bucket. Parent read-only inspection verified `r2.dev` disabled and no bucket custom domains. The earlier 403/code10042 activation blocker is resolved.
- Deploy a separate gallery Worker on proposed `photos.gizelleandrami.com` through the coordinating task's connected Cloudflare access. Website/DNS edits for this flow are authorized, but the apex `gizelleandrami.com`, `www`, existing `gizelleandrami` Worker and wedding assets must be preserved. No deployment has been executed here.
- Review the proposed seven-day guest-link lifetime, original-retention/deletion policy, expected photo count and maximum storage/SMS budget. The TTL is configurable and appears explicitly to guests; access expiry does not delete originals. Choose an operator backup/export method.
- Confirm guest number countries and approve any SMS provider only if current personal-use eligibility, sender/domain onboarding and delivery timeline are acceptable. Default to QR if approval slips.

## Before production deployment

- Pass current automated checks and inspect the production EXAMPLE config. It intentionally contains no active account/zone/routes or live secrets. Use the existing private bucket, create no duplicate, and obtain any still-required billing/secret approval before a live write.
- Use private R2 binding, disable public bucket access, set distinct strong `DEVICE_TOKEN` and `LINK_SIGNING_KEY` through secure settings, and configure the approved HTTPS public origin. Do not commit values or print environment/credential files.
- Give the new Worker only the existing booth bucket binding and all eight required native rate-limit bindings. Review example namespace IDs against other account Workers and confirm plan support without an unapproved upgrade. The counters are approximate per location and do not enforce a hard worldwide financial cap; choose account-level budget controls separately.
- Apply and inspect explicit disabled invocation logs, traces, persistence, sampling, Logpush and tail consumers. Guest capability tokens are in paths, so query-string redaction alone is insufficient. Verify account/infrastructure integrations separately.
- Use a dedicated subdomain only. Check DNS/custom-domain state read-only before any write; after an uncertain write, inspect its outcome before retrying. Do not touch root records or shared resources.
- Exercise production health, authenticated upload, idempotent replay, a synthetic session page, byte-identical original download, wrong-token/cross-session denial, expiry and revocation. Health alone does not prove R2 works. Follow the concrete live synthetic-storage procedure in `artifacts/deploy/README.md`; use synthetic photos only until explicitly approved otherwise.

## Before the event

- Complete [the actual-iPad checklist](IOS.md) using the intended signed standalone build, not Expo Go or a cloud web preview.
- Make at least one complete real-device-to-live-backend-to-cellular-guest rehearsal with a QR. Test loss of Wi-Fi and app restart. Inspect a downloaded original for orientation, resolution and mirroring.
- Charge the iPad, reserve enough local storage, arrange a power cable and backup network, verify kiosk exit and assign a booth host. Preflight from a cold reboot on the day.
- Confirm retained originals have a second copy. Do not uninstall the app, clean its storage or purge queues to troubleshoot connectivity.
- If SMS is enabled later, test consent, sender identity, opt-out requirements, capped resends, accepted/delivered distinction and spend limits with explicitly approved recipients and budget.

## Connectivity fallback

Without Internet, capture and preserve on the iPad, show an honest pending state, and upload when connectivity returns. A remote page/QR cannot be ready until the backend acknowledges both the original and session manifest. A guest who leaves before readiness cannot receive a later photo through QR alone; the host needs an explicitly opted-in approved contact method or a deliberate post-event collection process. Do not promise automatic delayed SMS while the provider is mocked.

If native signing, private storage deployment or the real-device rehearsal remains unresolved before the event, use a proven existing booth/camera workflow and retain originals instead of treating this unverified build as the sole wedding capture system.

## After the event

Verify all uploads and a host-controlled export/backup. Select images for the wedding website with the couple's approval; never expose the entire bucket or all guest sessions as an incidental import. Revoke guest links and remove unnecessary recipient data according to the chosen retention policy. Delete local originals only after verified independent backups.
