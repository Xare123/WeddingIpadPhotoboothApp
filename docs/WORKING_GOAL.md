# Working goal

Deliver a polished, secure wedding photobooth for November 1, 2026 on the provisional M1 iPad Air: dependable capture/countdown/retake, durable offline originals and recovery, private R2-backed session viewing/download, readable QR sharing after genuine readiness, and consented SMS only after provider eligibility and owner approval.

This file is durable repository guidance. No native persistent-goal API is exposed to the cloud task, so this document does **not** create an active product goal, scheduled background worker or promise of unattended execution.

## Completion gates

- Local typechecks, queue/API/browser tests and an iOS JavaScript export pass against the final source.
- Supported hosted Linux and macOS simulator checks run against an exact review-branch commit, with readable evidence. Use standard free public-repository runners; do not create metered resources, credentials or agreements.
- Approved production secrets are securely configured by the owner/coordinator; a dedicated Worker and photos subdomain pass synthetic live storage, authorization, download, expiry/revocation, rate and logging/privacy checks. Preserve the existing wedding website and main branch.
- The owner installs a signed standalone release using the MacBook and rehearses the actual iPad camera, offline restart/recovery, phone scans/downloads, power, lighting and venue network. Simulator or browser fixtures do not establish these outcomes.
- Optional real SMS waits for an approved eligible provider/sender, consent, retention cleanup and budget. Until then the release guest flow uses QR, and tests cannot send real texts.

## Current priorities

1. Close native testing gaps using the existing public GitHub repository and explicit standard-runner CI, without merging main.
2. Keep Firebase assessment bounded. It needs a configured Google identity/project and a compatible native XCTest artifact; neither generic environment-variable presence nor JavaScript tests prove readiness. If those prerequisites are unavailable, prioritize the Mac-to-iPad handoff and real-device checklist.
3. Verify recovery under interruption and serialize every queue operation, including manual retry/backoff reset. Keep test fixtures explicitly development-only and offline.
4. Preserve exact-source test reports, the private-storage deployment artifact, and reusable environment configuration. Distinguish implemented, locally tested, hosted-tested, deployed and physical-device-tested status in every handoff.

Production key approval is pending. Do not create keys, buy services, alter persistent access, enable real messaging or publish real guest photos as a way to remove that gate.
