# Working goal

Deliver a polished, secure wedding photobooth for November 1, 2026 on the provisional M1 iPad Air: dependable capture/countdown/retake, durable offline originals and recovery, private R2-backed session viewing/download, readable QR sharing after genuine readiness, and consented SMS only after provider eligibility and owner approval.

This file is durable repository guidance. File changes alone do **not** create an active product goal, scheduled background worker or promise of unattended execution. When the product supplies an external goal and continuation tools, follow that actual runtime objective and report blockers honestly.

## Completion gates

- Local typechecks, queue/API/browser tests and an iOS JavaScript export pass against the final source.
- Supported hosted Linux and macOS simulator checks run against an exact review-branch commit, with readable evidence. Use standard free public-repository runners; do not create metered resources, credentials or agreements.
- Approved production secrets are securely configured by the owner/coordinator; a dedicated Worker and photos subdomain pass synthetic live storage, authorization, download, expiry/revocation, rate and logging/privacy checks. Preserve the existing wedding website and main branch.
- The owner installs a signed standalone release using the MacBook and rehearses the actual iPad camera, offline restart/recovery, phone scans/downloads, power, lighting and venue network. Simulator or browser fixtures do not establish these outcomes.
- Optional real SMS waits for an approved eligible provider/sender, consent, retention cleanup and budget. Until then the release guest flow uses QR, and tests cannot send real texts.

## Current priorities

1. Resolve the owner's real-device report that photos were unavailable in both the app and Photos. Verify local save, file-journal recovery, local-library access and independent Photos export; preserve existing originals and the installed bundle identity. Prior synthetic passes do not override this evidence.
2. Deliver the five-shot native kiosk flow: large camera/review, adjustable host countdown, durable thumbnail progress, swipe review, individual retakes, one complete-session sharing screen and Next guest privacy.
3. Keep Firebase bounded. Without an existing authorized identity/project and compatible signed test package, continue standard-runner CI and the owner Mac/iPad route rather than provisioning new services.
4. Review the two-key private-pairing contract with the coordinator and preserve backend-only Textbelt keys. Live SMS requires eligibility/live approval and consent; uncertain sends never auto-resend.
5. Preserve exact-source tests, screenshots/interaction evidence, deployment artifacts and reusable environment configuration. Distinguish implemented, local/hosted-tested, deployed and physical-device-tested status.

The owner approved the two photobooth credentials and use of the existing backend-only Textbelt key. The coordinator owns secure generation/configuration, deployment and at most three approved owner test texts; this executor sends none and never fetches or prints their values. Provider/domain approval remains pending. No additional purchases, persistent grants, real guest-photo publication or expanded test recipients are authorized.

Historical checkpoint: source 82703b6 passed Linux checks and unsigned Release compilation, but the owner then found a saving failure and rejected the one-shot UX. That compilation does not verify this reworked source or device usability. The owner uses free Apple ID personal-team signing; preserve the existing app container, inspect profile expiry and renew/rehearse near November 1. Debug XCTest remains unrun due to its independent Metro startup gap. This is not a completed wedding launch.

Current repair checkpoint: `c0d6f4dd4ae51e7bb5827e3bf9fb6a06bf8ba900` passes 130 app/core/API tests, 43 runner contracts, final-source iOS export, 50 actual-JSX browser screenshots/two demos and independent QR decoding. Both hosted Linux and unsigned Release runs above pass. SDK58 native mutation awaits and incomplete-staging retry are corrected. Actual iPad saving/Photos/reboot/phone sharing still require owner rehearsal; coordinator device-token provisioning remains pending.
