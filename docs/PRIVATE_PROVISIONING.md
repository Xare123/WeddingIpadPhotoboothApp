# Private setup for the wedding iPad

The intended API origin is prefilled as `https://photos.gizelleandrami.com`. Capture and the local photo library do not require an account, token, network or completed pairing. Guest screens never ask for API settings. Private setup is host-only. The locally implemented 0.3.5/build 8 [host-access repair](HOST_ACCESS_REPAIR.md) addresses inaccessible system PIN/passcode fallback and guarded entry with secondary OS authentication; its controlled lifecycle and sharing tests pass, and the fresh unsigned native Release passed; actual iPad authentication and live pairing/upload remain separate gates. The installed app remains B4E 0.3.4/build 7.

The app does not contain a Cloudflare account token, Textbelt key, gallery-signing key or universal device credential. The coordinator configures the separately approved `DEVICE_TOKEN` and `LINK_SIGNING_KEY` securely on the dedicated `wedding-photobooth` Worker. Its existing `TEXTBELT_API_KEY` stays backend-only. Bundle uploads must preserve existing `secret_text` bindings; the generated upload metadata includes `keep_bindings: ["secret_text"]`. Verify the actual live bindings after an update without reading their values.

## Data-scope approval before pairing

**Pairing automatically starts upload of EXISTING CONFIRMED queued sessions, including real photos already on this iPad.** It is not just a connectivity or login test. A successful pairing can transmit those confirmed originals/derivatives/keepsakes to private R2 and later create working guest links. Pending counts and retry counts do not prove any such transfer has occurred.

The latest authorized app-container check found four originals with matching journals, one keepsake, SQLite integrity and five pending uploads at attempt count 15, with no URL or error. Pairing state is unknown; no Keychain value was read. The owner confirmed all test photos were in Apple Photos and then intentionally deleted some. Do not restore/re-export those copies or inspect unrelated Photos content.

Before creating or consuming a live setup code, the coordinator must obtain explicit approval covering the **existing confirmed queued real-photo sessions**, plus any new test scene/recipients. App-update and runner approval at 00:18 UTC on October 27 does not itself authorize that photo transfer. If only a smaller scope is approved and the automatic queue cannot enforce it, do not pair or delete/reset the queue to make it fit; preserve the data and resolve scope first. The parent/coordinator owns live configuration and execution; this cloud task performs none.

Last coordinator-verified production state had `DEVICE_TOKEN` absent, pairing disabled and SMS mocked. Missing configuration must show Setup required while preserving local jobs; it must not imply that attempt counters are evidence of uploads. Do not retrieve secrets, enable services or work around a 403 to diagnose this state.

## Two-key pairing contract

Pairing adds no third persistent key or separate administrator grant. It transfers the same revocable booth authority that already authorizes uploads. Any holder of that booth credential can issue another setup code; this is not per-device access management. Device-token rotation disconnects all paired copies and invalidates unclaimed setup codes. Signing-key rotation also invalidates unclaimed codes and existing gallery links.

1. After the real-photo data-scope approval above and secure approved credential configuration, the coordinator explicitly enables `PAIRING_ENABLED=approved`. With the approved booth bearer in a secure request header, POST `/v1/pairing/codes` with `{"id":"<fresh UUID>"}`. Do not place the bearer in a URL, chat, repository, screenshot or shell history.
2. A successful private response contains `status: issued`, a 64-hex `code`, `expiresAt` and `origin`. The code expires after five minutes by default. It is derived under a pairing-specific HMAC namespace, distinct from gallery links; its private R2 record binds the current device and signing-key versions. Issuance retries cannot rearm a consumed code. Use a fresh UUID for a deliberate new issuance.
3. Give the code privately to the owner, optionally as a QR containing only the raw 64-hex code. Keep it out of URLs and normal camera-app link handling. The code itself is temporary authority; do not publish it in this public repository or test artifacts.
4. After local host authentication, the app POSTs `{"code":"<code>"}` to `/v1/pairing/consume` over the fixed HTTPS origin. Atomic conditional consumption occurs before the server returns `status: paired`, `origin` and `deviceToken`. Concurrent claims have at most one winner.
5. The iPad verifies the origin and reply, stores the booth credential in device-only Keychain, and reads it back before acknowledging setup. It does not retain the setup code. API settings are then automatic in normal use, and synchronization of existing confirmed queued sessions starts automatically. Verify only the approved scope; do not claim readiness until required uploads and the exact server acknowledgement succeed.

There is no automatic second claim after a timeout or lost response. If the code was consumed but its reply or Keychain write was lost, issue a fresh private code. Local originals remain available regardless of pairing failure. No credentials were generated by implementing this contract; the coordinator owns production configuration and execution.

## Before reporting production success

Inspect the deployed exact source, private R2 binding, all rate-limit bindings, secret names, disabled invocation/trace logging and canonical domain. Test issuance authentication, concurrent consume, second consume denial, expiration and both key rotations using synthetic credentials in a local emulator first. Then, after the explicit existing-photo upload approval above, the coordinator performs the approved private live pairing on the actual iPad. Never include its live responses in public test artifacts.

The owner uses free Apple ID personal-team signing. Install/renew with the same team and bundle identifier to preserve the existing app container, inspect the actual profile expiry, and refresh/rehearse close enough to November 1 that the signed app remains launchable. Do not uninstall or clear an installed app containing originals.
