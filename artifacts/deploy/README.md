# Worker deployment handoff

Run `npm run build:api` from the repository root to reproduce `worker.mjs` and its SHA-256 manifest. This builds a local artifact only; it does not provision, deploy, publish photos or send SMS. `worker.mjs` is an ES module with a default `fetch` export. Importable module syntax is checked locally.

The coordinating task owns connected Cloudflare writes. Deploy this as a new dedicated gallery Worker with these bindings, after checking the manifest hash and tests:

- Existing private R2 bucket `gizelleandrami-photoboothphotos` bound as `PHOTOS`; do not create a duplicate or enable public bucket access.
- Variables `MODE=production`, `SMS_MODE=mock`, `PUBLIC_ORIGIN=https://photos.gizelleandrami.com`, `LINK_TTL_SECONDS=86400`.
- Securely entered, distinct `DEVICE_TOKEN` and `LINK_SIGNING_KEY`, each at least 32 bytes and 12 distinct characters. No values are generated, printed or included here.
- A separate Worker custom domain on `photos.gizelleandrami.com`, with `workers.dev`/preview URLs disabled and request analytics/logging reviewed for guest-token privacy.

Website/DNS edits needed for this flow are authorized, but preserve the apex, `www`, the existing `gizelleandrami` Worker and all wedding-site content. The production EXAMPLE config has no active account/zone/routes or secrets, so it cannot accidentally change those records by running this build.

Before claiming live readiness, verify `/health`, unauthorized upload denial, synthetic authenticated upload + replay, session readiness, a private guest page, byte-identical download, wrong-token/cross-session denial, and expiry/revocation. Check rate/request/budget controls. Use synthetic images and mock SMS only. Local Miniflare/browser success does not establish live R2 or DNS functionality.

Do not use the local HTTP smoke script unchanged against production: it intentionally targets loopback and contains known local-only development values. Enter the production device token only through a secure approved route and the iPad's OS-authenticated host settings.
