# Optional guest gallery email (Resend)

Website-only enhancement; Social Grid remains the default and both layouts/fit downloads remain available. Nothing changes on the iPad. This release is prepared, not deployed or enabled.

## Exact configuration

Preserve all existing production variables, secrets, bindings and settings. Optional additions only:

- `EMAIL_MODE=resend` enables this feature only when every condition below is satisfied. Missing/disabled/unknown mode hides the form and rejects sending.
- `RESEND_API_KEY`: server-side encrypted Worker secret. Never place its value in source, browser configuration, chat, logs or artifacts.
- `EMAIL_FROM`: plain verified sender email address on a domain already verified in Resend (no display-name syntax).
- `EMAIL_SENDER_VERIFIED=approved`: operator attestation after independently verifying the actual domain/sender in Resend. This flag does not itself verify a domain.
- `EMAIL_DAILY_LIMIT`: integer1–100, default100. Use a lower value if this Resend account sends other mail.

Existing PHOTOS private R2 and LINK_SIGNING_KEY bindings are reused; no new binding, public bucket, DNS change, paid plan or account is required by this code. Parent verified gizelleandrami.com has sending enabled; choose an actual sender address on that verified domain. API-key availability, restricted key setup and activation remain separate owner/setup steps. No secret was retrieved here. The local-only `EMAIL_MODE=mock` is rejected in production.

## Behavior and limits

A guest enters an address, explicitly selects consent, and presses Email my photo link. Only the existing validated gallery capability can authorize the request. Origin and same-origin fetch checks, signature, expiry/revocation and existing SHARE rate limits precede sending. No device token is exposed to guests. The subject/body are fixed and the gallery URL comes from server configuration plus the validated token; arbitrary URLs, bodies or attachments are rejected.

One address and at most one provider submission per gallery session. This deliberately prevents changing recipient or resending on reload. The browser disables immediately with Sending…, and never automatically retries an unknown outcome. Accepted means Resend accepted the request, not delivered to inbox. Pending/uncertain requests keep a durable fence; guests should check spam or use direct downloads. A permanent rejection also retains the fence. This conservative policy sacrifices email retries to avoid accidental duplicate messages. Direct downloads and manual link sharing remain available.

Quota dates are taken at fresh server admission time, after reading the request, rather than request-start time. Before provider submission, a conditional R2 session record and UTC-day quota slot are created. Records contain HMAC recipient fingerprints/status only, never raw addresses, full gallery URLs or tokens. Session keys contain existing session UUIDs. The recipient exists transiently in the request/provider payload. Resend necessarily receives recipient and private link and applies its own retention/privacy policy. Parent read-only inspection found domain open/click tracking enabled; this code does not override or modify those shared settings, and no documented per-message opt-out was available in this executor. Do not claim tracking-free email. The guest form discloses that provider tracking may apply; email is not end-to-end encrypted. Anyone receiving the link can access that gallery until expiry/revocation. No newsletter or address book is created.

The booth cap is a strict shared maximum of100 admissions per UTC day, or the lower configured value; failed/uncertain submissions still consume slots. It does **not** know account-wide Resend usage by other applications, monthly allowances, provider throttling or current plan changes. The requested free-tier expectation is100/day account-wide; verify current account limits before enabling. Provider quota/rate rejections show a safe fallback, not a paid upgrade. Do not delete fence/quota records to retry a delivery. No automatic cleanup deletes guest photos. Keep email metadata private; choose any later metadata retention/lifecycle policy separately so deduplication survives link lifetime.

## Deployment and verification

Deploy only after specific approval. Use the reviewed Worker module from `artifacts/deploy`; retain all live settings/secrets and rollback. Existing three theme assets and R2 keys are unchanged. Deploying code with email settings absent leaves the feature disabled. Enable only after sender/key readiness is independently verified. No real email, live origin probe, DNS/credential mutation or provider setup was performed here.

Synthetic tests cover feature gating, validation, fixed provider payload, durable concurrent deduplication, unknown outcome, quota, expiry/origin/revocation, and browser states. Local mock provider calls are intercepted and never reach Resend. Real delivery and Safari/in-app-browser behavior remain separate acceptance steps requiring an approved recipient and send scope.
