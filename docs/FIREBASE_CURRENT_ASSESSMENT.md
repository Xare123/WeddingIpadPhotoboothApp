# Current Firebase iOS assessment

The owner subsequently chose to leave Firebase unchanged. These findings are retained for reference; authentication, project discovery and test execution are deferred and do not block the GitHub/iPad workflow. No further Firebase setup is pending in this task.

Assessment date: 2026-10-26. This is a bounded read-only assessment of the owner's existing billing-enabled project, identified by its owner-provided display name. No project ID has been verified. A display name is not a unique project identifier.

## Access actually checked

- The current callable-tool inventory exposes no Firebase MCP actions or developerknowledge search actions, despite the Firebase skills being installed. Installing a plugin does not itself establish authenticated project access.
- Cloud runtime observations are current, with no configured secrets, runtime variables, or outbound identities. Its version-1 identity manifest has an empty connections list. Generic SDK credential-selector variable presence is not proof of authorization; credential files and tokens were not read.
- Node 24.19.0 and npm 11.9.0 are available. Firebase CLI 15.34.1 was downloaded from the official npm registry to the ignored task-local `.cache/firebase-assessment/npm` cache, without changing application dependencies. `login:list --non-interactive` reports **No authorized accounts**. The initial CLI attempt also reported failure creating its config store under `/home/agent/.config`. The repository’s existing `scripts/cloud-env.sh` helper was then sourced to set writable XDG paths while preserving HOME, inherited authentication selectors, proxy, and CA trust. With that prerequisite corrected, the actual read-only `npx -y firebase-tools@15.34.1 projects:list --non-interactive --json` action returned `status: error`, **Failed to authenticate, have you run firebase login?** using the inherited ADC selector normally. No credential file contents were read. This is an observed project-list authentication failure, not a claim that the project API returned HTTP 403. Google Cloud CLI is absent.
- Direct HTTPS reads of the official Firebase XCTest, setup, and pricing documentation through the inherited proxy each fail with **Tunnel connection failed: 403 Forbidden**. TLS verification and proxy/CA settings were preserved. The runtime policy state is unknown, so the policy configuration alone is not evidence of enforced network readiness.

Consequently this executor cannot resolve the existing display name to a project ID, inspect project billing/quota, or retrieve a live iOS device catalog. No project metadata, catalog, quota, or remaining free allowance is inferred.

## iOS suitability and artifacts

The parent assessment refreshed the official documentation using its available research access:

- [Run XCTest with Firebase Test Lab](https://firebase.google.com/docs/test-lab/ios/run-xctest): Test Lab supports native XCTest/XCUITest artifacts for physical iOS devices. It re-signs valid uploaded app/test artifacts with Google's signing certificate and provisioning profile. A compatible device `build-for-testing` ZIP and `.xctestrun` configuration are required; simulator artifacts and JavaScript test output do not substitute for this package.
- [iOS setup](https://firebase.google.com/docs/test-lab/ios/get-started): validity of a free Apple Personal Team signed package must be established through the actual artifact requirements/validation. A paid Apple Developer membership is not asserted as an automatic requirement here. The existing unsigned physical-device build is not a valid signed Test Lab package.
- [Migration FAQ](https://firebase.google.com/docs/test-lab/migrate-faq): Test Lab is deprecated but remains available through September 30, 2027. Migration work is outside this bounded assessment.

The existing simulator XCTest and Core Image checks remain useful local/hosted validation. No signed physical-device Test Lab ZIP has been produced, and no cloud test result is claimed. No production Firebase SDK, Analytics, Crashlytics, project configuration, or app dependency was installed.

## Proposed bounded run, requiring separate approval

After project identity, signing, catalog, and quota checks, propose exactly one selected physical iOS device, one test execution, a five-minute test timeout, and zero flaky-test retries. Use only synthetic/generated fixtures. Do not select a full matrix or automatically repeat a failed run.

The parent's check of [usage, quotas, and pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing) found 30 free physical-device test minutes per project per day on Blaze, then $5 per physical-device hour with partial minutes rounded up. If the free allowance is exhausted, five billed device minutes estimate **$0.42** in test execution charges. Default Test Lab result storage is free; no custom bucket is needed for this proposal. This is an estimate for the proposed execution, not a verified hard billing cap or a statement of the project's remaining allowance. Reconfirm rates and quota before approval.

## Smallest next owner action

Provide/select the exact existing project ID and make an intended Google identity available through the supported environment connection workflow (or explicitly approve an interactive Firebase login). The concrete blocked action is Firebase CLI `projects:list`, which fails authentication; retry this read-only action after identity readiness is established before attempting catalog/quota access. Do not send tokens or credential files in chat. Read-only project/catalog/quota checks can then establish the actual device and access prerequisites. The official documentation and required Google API destinations also need supported network access; a proxy denial must not be bypassed.

No new project, service account, OAuth grant, API enablement, billing change, paid test, upload, push, or deployment was performed. Billing being enabled does not authorize an unbounded or paid test run.
