# Optional SMS and November 1 deadline

SMS sends the same private guest-page URL shown by the QR. It must run on the server, with explicit guest opt-in, a bounded one-time purpose and an approved provider/sender. Do not put provider keys in the iPad bundle, log phone numbers, or use the numbers for marketing. Store only what is required to retry; remove recipients after completion or a defined short retention window. The queue stores a secure recipient reference instead of a phone number. Provider acceptance is not proof of handset delivery.

As of October 25, the wedding is seven calendar days away. An unapproved new automated SMS setup is not a dependable launch dependency. Keep the QR/gallery path independent. Mocks and reserved test numbers are the only exercised messaging path in this repository; **no real texts have been sent**.

## Options to resolve with the owner

| Option | Assessment | Action still required |
| --- | --- | --- |
| QR to uploaded private page | No per-text provider cost; guests use their camera | Deploy the private gallery, verify cellular access and scan/download on real phones |
| Textbelt managed sender | Parent research found advertised US credit packs of $5/200 and $10/700; potentially appropriate for low-volume personal use | Confirm current price, country coverage, whether this personal wedding use is accepted, shared-sender constraints, and photo-link domain whitelist approval; no purchase/support contact is assumed complete |
| Twilio | Flexible APIs, but sender registration and eligibility are significant here | Official error 30532 warns about purely personal messaging eligibility; US A2P campaign reviews may take 10–15 days and toll-free requires verification. Do not treat a new account as wedding-ready |
| Other established provider/account | An already-approved sender could reduce onboarding risk | Compare total setup/sender/carrier fees, destination countries, delivery status and link policy; test only after explicit approval |

Prices are planning inputs supplied by the coordinating research, not a quote or an account purchase. An SMS segment and a Unicode/multipart message may consume more than one credit. Country mix, expected sessions, resend allowance and total budget are still needed. Personal use does not automatically remove provider or carrier registration rules. Google Cloud, Firebase and Cloudflare storage are not SMS senders themselves.

## Integration boundary

The Worker has explicit `mock` and failure-test modes. It rejects missing consent, invalid E.164 numbers, unready sessions and reused share IDs with different recipients. It never claims a mock response was sent. A future provider adapter needs idempotency/delivery-state handling, per-session resend limits, recipient deletion, destination allowlists and a hard spend cap. Provider failures must retain the private page/QR and remain retryable without duplicate texts.

Do not add a live adapter, buy credits/numbers, accept agreements, create credentials, send test texts or enroll a sender until the owner approves the provider, terms and budget. A tiny approved live test on the intended destination network is a later launch check, not something local mocks establish.

Before enabling real recipient capture, add a bounded pending/orphan cleanup policy. A process termination between the current development-only Keychain write and SQLite queue save can leave an orphan test recipient that completion-based cleanup cannot enumerate. Ordinary save failures already delete the value, and production hides this test UI; this is a future live-SMS prerequisite rather than an enabled guest-data collection path.

## Official references

- [Twilio A2P onboarding timeline](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
- [Twilio toll-free onboarding](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding)
- [Twilio error 30532](https://www.twilio.com/docs/api/errors/30532)
- [Textbelt](https://textbelt.com/)

The provider sites are blocked by this cloud environment's current network policy. Timeline/eligibility notes above came from the coordinating task's official-source research and must be rechecked before choosing or paying a provider.
