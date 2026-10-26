# Worker deployment handoff

Run `npm run build:api` from the repository root to reproduce `worker.mjs` and its SHA-256 manifest. This builds a local artifact only; it does not provision, deploy, publish photos or send SMS. `worker.mjs` is an ES module with a default `fetch` export. Importable module syntax is checked locally.

The coordinating task owns connected Cloudflare writes. Deploy this as a new dedicated gallery Worker with these bindings, after checking the manifest hash and tests:

The coordinator's isolated Worker is named **`wedding-photobooth`**. An earlier bundle is deployed fail-closed; this revised bundle adds five-photo publication, private pairing and the Textbelt adapter. Keep its existing encrypted secrets by applying the generated `keep_bindings: ["secret_text"]` metadata and verifying secret names afterward. No value belongs in a public handoff artifact.

- Existing private R2 bucket `gizelleandrami-photoboothphotos` bound as `PHOTOS`; do not create a duplicate or enable public bucket access.
- Variables `MODE=production`, `SMS_MODE=mock`, `PUBLIC_ORIGIN=https://photos.gizelleandrami.com`, `LINK_TTL_SECONDS=604800` (recommended seven days, configurable from 60 seconds through 30 days). Expiry closes guest access and does not delete originals.
- All eight native `ratelimit` bindings in the manifest. The example namespace IDs `1001`–`1008` must be reviewed and changed if they overlap other account Workers. Missing/invalid/erroring production bindings return 503 before R2 access; quota denials return 429. Limits are approximate per Cloudflare POP and cannot impose a hard worldwide spending/storage cap. Confirm the existing account plan supports these bindings; do not upgrade a plan or provision paid infrastructure without approval.
- Securely entered, distinct `DEVICE_TOKEN` and `LINK_SIGNING_KEY`, each at least 32 bytes and 12 distinct characters. No values are generated, printed or included here.
- Existing backend-only `TEXTBELT_API_KEY`, optional for QR-only operation. Preserve it without retrieving its value. Live/test approval flags remain disabled in the example; paid credits and a submitted domain form do not establish eligibility. This executor sends zero real or remote test messages; the coordinator owns the owner's approved test-send limit.
- A separate Worker custom domain on `photos.gizelleandrami.com`, with `workers.dev`/preview URLs disabled. Apply the manifest's explicit disabled observability/log/trace/persistence settings, `logpush:false`, and empty tail consumers. Query-string redaction alone does not protect a gallery token in the URL path. Verify account-level logging and integrations separately. If a connector cannot apply necessary controls, stop and report that limitation instead of dropping them.

`manifest.json` derives variables, R2 and rate-limit bindings, and privacy metadata directly from the production example so they cannot silently drift. `deploymentMetadata` is the ES-module upload metadata; secret values are intentionally absent and must be entered through the approved secure Cloudflare route. No static-assets binding is required: the gallery HTML/CSS is embedded, and original images are read privately from R2. Domain attachment is a separate operation and is not included as an active route here.

Website/DNS edits needed for this flow are authorized, but preserve the apex, `www`, the existing `gizelleandrami` Worker and all wedding-site content. The production EXAMPLE config has no active account/zone/routes or secrets, so it cannot accidentally change those records by running this build.

Before claiming live readiness, verify the following with synthetic images and mock SMS only. A healthy `/health` response checks configuration, not R2 read/write authorization:

1. Inspect the live Worker bindings, canonical domain, logging/trace settings, private bucket settings and budgets; confirm both distinct secrets were supplied securely after approval.
2. Request health, then confirm an unauthenticated upload returns 401 and readiness before uploading returns 409.
3. With the secure booth bearer, PUT five committed synthetic JPEGs to `/v1/sessions/<new session UUID>/photos/<new photo UUID>`. Repeat each PUT and expect 201 then 200 with stable IDs; no real guest photo is permitted in this rehearsal.
4. POST `{"photoIds":["<UUID 1>","<UUID 2>","<UUID 3>","<UUID 4>","<UUID 5>"]}` to `/v1/sessions/<session UUID>/ready`. A new subset must be rejected. Confirm one ready URL on the exact approved HTTPS origin, all five original photos, and the configured future expiry. Reordering/changing the confirmed selection must return 409; exact replay must retain the link and expiry.
5. Open that session URL and fetch its full-resolution download. Compare downloaded bytes/hash to the synthetic original. Confirm a wrong token and a photo outside that manifest are denied, and no listing/raw-bucket route is exposed.
6. If testing sharing, first require health reports `sms:mock`, use a reserved fictional number, verify missing consent is rejected and the consented response says mocked. Do not exercise a real sender.
7. DELETE `/v1/sessions/<session UUID>/gallery` and verify both page and download return 410. The synthetic private originals remain for explicit owner cleanup; revocation/expiry is not deletion.

Local Miniflare/browser success does not establish live R2, rate-limit enforcement at the edge, DNS, logging privacy or actual-iPad readiness. Scan the live ready URL from a second phone on cellular data after deployment; browser decoding alone is insufficient.

Private iPad setup uses only the two approved booth credentials. See [the precise two-key pairing contract](../../docs/PRIVATE_PROVISIONING.md): explicitly enable pairing, issue a short-lived code using existing booth authorization, privately scan its raw code through host controls, and consume atomically before Keychain acknowledgment. Do not mint the five-minute code while the owner is asleep or before installation is ready. Live pairing and storage checks remain coordinator/owner actions.

Do not use the local HTTP smoke script unchanged against production: it intentionally targets loopback and contains known local-only development values. Enter the production device token only through a secure approved route and the iPad's OS-authenticated host settings.
