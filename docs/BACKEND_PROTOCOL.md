# Private booth backend protocol

This implementation targets the isolated `wedding-photobooth` Worker and the existing private `gizelleandrami-photoboothphotos` R2 bucket. Its proposed canonical HTTPS origin is `https://photos.gizelleandrami.com`. It does not modify the existing `gizelleandrami` Worker, website, DNS, or its secrets. The example configuration does not deploy anything.

## Five-photo sessions

Authenticated JPEG uploads remain immutable and idempotent at `PUT /v1/sessions/:sessionId/photos/:photoId`. A new `POST /v1/sessions/:sessionId/ready` accepts `{ "photoIds": [five ordered UUIDs] }` only after all five originals exist durably. A subset cannot publish a new gallery. Repeating the same ordered manifest returns its original link and expiry; changes return 409. Existing legacy manifests can still replay their identical ordered lists and retain normal access, expiry, and revocation behavior.

## Private, one-use pairing

Pairing uses exactly the two existing booth credentials: `DEVICE_TOKEN` and `LINK_SIGNING_KEY`. There is no additional bootstrap secret. Both are server-side secrets; neither belongs in the app bundle or public configuration. Pairing remains off unless the separately reviewed server setting `PAIRING_ENABLED=approved` is present.

1. An owner client that already holds the booth token calls `POST /v1/pairing/codes`, with `Authorization: Bearer <DEVICE_TOKEN>` and `{ "id": "<fresh UUID>" }`. Issuance uses the same fixed-length digest and constant-time bearer comparison as booth API requests.
2. The private no-store response is `{ "status": "issued", "code": "<64 lowercase hex characters>", "expiresAt": <epoch milliseconds>, "origin": "https://photos.gizelleandrami.com" }`. Deliver the code privately. Never put it in a URL, logs, screenshots, artifacts, or an app bundle. The default lifetime is 300 seconds; `PAIRING_TTL_SECONDS` permits 60–600 seconds.
3. After local OS authentication, the app calls `POST /v1/pairing/consume` with `{ "code": "<code>" }` in the HTTPS request body. The request body is capped at 1 KiB. The code itself authorizes this claim; an unauthenticated caller cannot issue codes.
4. The server conditionally changes the R2 record from issued to consumed **before** returning `{ "status": "paired", "deviceToken": "<booth token>", "origin": "https://photos.gizelleandrami.com" }`. The app must validate the canonical origin and store the token in its OS Keychain, never its bundle.

The code is a purpose-separated HMAC of the issuance UUID under `LINK_SIGNING_KEY`. R2 stores its hash, expiry, state, issuance UUID, and digests identifying the current two credentials. It stores neither the raw code nor the booth token. Rotating either credential invalidates pending codes. Do not restore retired credentials. An issuance replay within a signing-key epoch cannot extend expiry or rearm a consumed code. Signing-key rotation changes the derived code for an issuance UUID; use a fresh UUID for every new issuance rather than assuming UUIDs are globally immutable across key epochs.

Exactly one concurrent consume can win the R2 conditional write. Expired, consumed, raced, or uncertain claims never return a token. If the success response is lost, retry returns 409; the owner must issue a fresh code. A failed or ambiguous storage operation must never reset a consumed record. Expiry does not delete records or originals.

This is a shared booth credential, not a per-device administrator identity. Every holder of `DEVICE_TOKEN` can issue another code granting the same booth authority. There is no individual-device revocation or server-attested Face ID claim. OS authentication is enforced locally by the app; the server cannot attest it. Rotating `DEVICE_TOKEN` revokes all previously paired booth credentials.

## Textbelt boundary

`SMS_MODE=mock` remains the example default. No test here calls Textbelt over the network. `createTextbeltProvider` accepts an injected fetch implementation; native integration tests intercept all outbound requests inside Miniflare.

- `mock` returns `mocked`; `mock-fail` returns retryable `mock_failed`. Neither invokes a provider.
- `textbelt-test` requires `TEXTBELT_TEST_ENABLED=approved` and the server-only `TEXTBELT_API_KEY`. The adapter appends `_test` to the key and reports `test_accepted` when the provider accepts the test. This mode never enables guest phone collection through health capabilities. Do not run even a remote no-charge test without separate approval.
- Live `textbelt` requires the key plus **both** `TEXTBELT_LIVE_APPROVED=true` and `TEXTBELT_ELIGIBILITY_APPROVED=true`. These are owner-reviewed assertions, not evidence inferred from paid credits. A key or credit balance does not establish sender, destination, or personal-event eligibility. All live/test approval flags are disabled in the example.

The Textbelt key belongs only on the isolated photobooth Worker. Do not retrieve, copy, or change secrets on the main website Worker. The adapter posts URL-encoded `phone`, `message`, and `key` only to `https://textbelt.com/text`, with manual redirects, a 10-second abort timeout, and a bounded response parser. It never follows redirects with credentials. It never persists or echoes provider error bodies, numbers, keys, quota responses, or message text.

`GET /health` adds `smsAvailable: boolean` to its existing `status`, `storage`, and `sms` fields. It is true only for fully configured and approved live Textbelt mode; mock, test, and partial configurations return false. This is a configuration capability, not a delivery or provider-eligibility probe. The app should hide guest phone collection when false.

`POST /v1/shares` still requires the booth bearer and `{ "id": "<UUID>", "sessionId": "<UUID>", "phone": "+<E.164>", "consent": true }`. Sharing requires an unexpired, unrevoked ready gallery containing exactly five photos, including in mock mode. Legacy shorter galleries remain readable and can replay their identical ready manifest, but cannot create a new SMS share. The private response retains `url` and `expiresAt` and adds truthful outcomes:

| Status | HTTP | Automatic retry | Meaning |
| --- | --- | --- | --- |
| `mocked` | 200 | No | No text was sent. |
| `mock_failed` | 503 | Yes, same ID | Local simulated failure; no provider call. |
| `test_accepted` | 200 | No | Provider test accepted; no text sent. |
| `accepted` | 200 | No | Provider accepted the request; delivery is **unconfirmed**. |
| `rejected` | 200 | No | Explicit provider rejection; operator action required. |
| `uncertain` | 202 | Never resend automatically | Transport/HTTP/parser failure, an in-flight claim, or an ambiguous persisted result. |

Textbelt does not provide an idempotency guarantee. A durable session-level R2 delivery fence permits one Textbelt recipient per session and conditionally claims `sending` before any provider call. Concurrent callers, repeated IDs, new IDs, process crashes, network timeouts, and failed result writes cannot cause an automatic second send. Each attempt has a unique identifier to prevent an old conditional write from matching a later attempt's ETag. The phone is represented at rest only by a keyed HMAC fingerprint.

An explicit provider `success:false` is the only real-send state eligible for operator retry. The operator must reuse the original share ID and number, reassert consent, and add `"retryRejected": true`; the ordinary request remains terminal. Uncertain or already accepted attempts cannot be retried even with this flag. A new ID, number, provider-mode change, or signing-key rotation cannot bypass the session fence. Use the existing gallery QR/link as the recovery path; never delete a fence to force an uncertain resend.

The existing native global-route, trusted-client-IP, and hashed-gallery-token rate gates remain before R2 access. Pairing uses the stricter share route band. Missing or erroring required production bindings fail closed. Native limits are approximate per POP, not a globally coordinated financial spending cap. Namespace IDs in the example require review for account-wide collisions; they are not grants or proof of available quota.

## Logging and retention

Responses retain private/no-store, no-referrer, noindex, CSP, and no-sniff protections. Worker invocation logs, traces, issues, persistence, and sampling are explicitly disabled in the production example. Do not enable independent account request logging or debugging that records bearer URL paths or request bodies. Gallery links are forwardable bearer credentials; anyone with one can view and download its scoped photos until expiry or revocation. Link expiry closes guest access and does not delete original photos or SMS/pairing fences.
