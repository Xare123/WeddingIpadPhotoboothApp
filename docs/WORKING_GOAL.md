# Working goal

Deliver a polished, secure wedding photobooth for November 1, 2026 on the provisional M1 iPad Air: four-photo full-bleed capture/countdown/retake, durable offline originals, post-capture looks, a quick strip/grid keepsake in Classic Ivory, Sage Botanical or Coastal Sea Glass, private R2-backed viewing/download of the keepsake and originals, QR only after complete readiness, and consented SMS only after provider eligibility and owner approval. Preserve existing five-photo sessions.

This file is durable repository guidance. File changes alone do **not** create an active product goal, scheduled background worker or promise of unattended execution. When the product supplies an external goal and continuation tools, follow that actual runtime objective and report blockers honestly.

## Completion gates

- Local typechecks, queue/API/browser tests and an iOS JavaScript export pass against the final source.
- Supported hosted Linux and macOS simulator checks run against an exact review-branch commit, with readable evidence. Use standard free public-repository runners; do not create metered resources, credentials or agreements.
- Approved production secrets are securely configured by the owner/coordinator; a dedicated Worker and photos subdomain pass synthetic live storage, authorization, download, expiry/revocation, rate and logging/privacy checks. Preserve the existing wedding website and main branch.
- The owner installs a signed standalone release using the MacBook and rehearses the actual iPad camera, offline restart/recovery, phone scans/downloads, power, lighting and venue network. Simulator or browser fixtures do not establish these outcomes.
- Optional real SMS waits for an approved eligible provider/sender, consent, retention cleanup and budget. Until then the release guest flow uses QR, and tests cannot send real texts.

## Current priorities

1. Resolve the owner's real-device report that photos were unavailable in both the app and Photos. Verify local save, file-journal recovery, local-library access and independent Photos export; preserve existing originals and the installed bundle identity. Prior synthetic passes do not override this evidence.
2. Finish the four-shot native kiosk flow, post-capture looks and quick three-theme/two-layout keepsake editor. The V2 social grid uses a persisted portrait 4:5 or square canvas; the classic strip keeps 1:3. Full photo remains the default, explicit Fill starts at the top and warns about cropping, and full-resolution Whole/Fit width inspection must show actual output. Preserve V1 geometry, originals, recipe/order/crop lineage, exact server acknowledgement before QR, individual retakes and Next guest privacy.
3. The owner chose to leave Firebase unchanged after the bounded check found no usable cloud authentication. Continue standard-runner CI and the owner Mac/iPad route. Do not provision services or treat unsigned/simulator artifacts as a signed physical Test Lab package.
4. Review the two-key private-pairing contract with the coordinator and preserve backend-only Textbelt keys. Live SMS requires eligibility/live approval and consent; uncertain sends never auto-resend.
5. Preserve exact-source tests, screenshots/interaction evidence, deployment artifacts and reusable environment configuration. Distinguish implemented, local/hosted-tested, deployed and physical-device-tested status.

The owner approved the two photobooth credentials and use of the existing backend-only Textbelt key. The coordinator owns secure generation/configuration, deployment and at most three approved owner test texts; this executor sends none and never fetches or prints their values. Provider/domain approval remains pending. No additional purchases, persistent grants, real guest-photo publication or expanded test recipients are authorized.

## Historical checkpoints

Source 82703b6 passed Linux checks and unsigned Release compilation, but the owner then found a saving failure and rejected the one-shot UX. That compilation does not verify this reworked source or device usability. The owner uses free Apple ID personal-team signing; preserve the existing app container, inspect profile expiry and renew/rehearse near November 1. Debug XCTest remains unrun due to its independent Metro startup gap. This is not a completed wedding launch.

Current repair checkpoint: `d3dec720d75bc23fdabe22bb382493f45224d840` passes 167 app/core/API tests, four additional independent fault sequences, 43 runner contracts, final-source iOS export, 60 actual-JSX browser screenshots/two demos and independent QR decoding. [Linux run 40333689913](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40333689913) and [unsigned Release run 40333689855](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40333689855) pass. Canonical staged-file recovery, queue reconciliation/identity preservation and deliberate host Photos reconciliation are corrected within tested boundaries. Source and synthetic evidence publication is approved. Actual iPad saving/Photos/reboot/phone sharing still require owner rehearsal; coordinator deployment/device provisioning and SMS eligibility remain separate gates.

Four-photo feature checkpoint: the frozen full-bleed/privacy source `0dc4385217678f56e8b7ad2d38f9398fc7dcc31f` passed Linux run40343542139, unsigned physical-SDK run40343543014 and Release simulator launch/relaunch/rotation run40343542363. The later four-photo/filter/template candidate passes 266 app/core/API/plugin tests, 49 CI contracts, four independent historical recovery tests and current browser fixtures. The expanded native lane requires 15 actual XCTest methods; those current-feature native results remain pending. No current-feature deployment, signing, actual-iPad saving/Photos/edge/parity test or live SMS is implied.

## Local V2 checkpoint

Version **0.3.1 / build 4** is local and uncommitted at this checkpoint. It passes **293 integrated tests**, **50 runner contracts**, four historical recovery faults, workspace typechecks and a 1,045-module iOS export. Native prebuild/test preparation verifies five Swift sources, six generated JPEG resources (824,109 bytes) and **20 required XCTest methods**; these have not yet executed on Apple hardware for V2. Final clean output review, exact-source evidence and fresh hosted results remain required.

Remote `d1dbc8fd3254005f24ec00132dc07bc998a18308` contains only the old V1 feature plus isolated CI repairs: standard Intel runner and a bounded 600-second cold simulator boot. Linux run40372103512 passed; runtime40372103636 is still in progress and targets the old 15-method suite, not local V2. Earlier runtime failures were runner allocation and cold simulator boot, with no XCTest assertions run. Keep these diagnoses separate from app failures and do not reduce test requirements.

The coordinator reports V1 backend version `6d10127d-0cd9-47ff-bc94-23cb110a95e0` deployed with private R2/rate controls preserved, `DEVICE_TOKEN` absent, pairing disabled and SMS mocked. V2 adds required immutable `gridAspect` and needs the matching new backend bundle. No live sharing, SMS or physical-iPad acceptance is implied. Preserve owner data and finish the exact-commit handoff before the same-team/bundle Release install and real rehearsal.
