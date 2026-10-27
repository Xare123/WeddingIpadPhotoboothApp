# Wedding iPad Photobooth

The **version 0.3.4 / build 7** candidate defaults to **four photos** with **5 seconds to prepare for the first photo and 3 seconds for each following photo**. A small timing chip opens independent snapping controls before capture. Guest changes last for that session; Next guests restores saved host defaults. See [the timing workflow](docs/TIMING.md).

The full-bleed camera, individual retakes, post-capture looks and three-theme strip/grid keepsakes remain. The grid uses a portrait 4:5 or square canvas selected once from the photos; the strip keeps a classic 1:3 shape. Full photo is the default, with explicit crop controls and full-resolution inspection. Existing V1 recipes and five-photo sessions are preserved. See [the four-photo workflow](docs/FOUR_PHOTO_STUDIO.md) and [framing contract](docs/FULL_BLEED_CAMERA.md).

The repaired native suite **passes all 19 cases with all 16 JPEG outputs** on [exact-source Apple simulator run 40418443673](https://github.com/Xare123/WeddingIpadPhotoboothApp/actions/runs/40418443673). The authorized Mac executor also verified the signed 0.3.4/build 7 and compiled camera patch with the existing app identity. This candidate is cleared for controlled iPad installation and rehearsal while the separate full-app and physical saving/Photos acceptance remain open. [Validation](docs/VALIDATION.md) records exact outcomes and limits.

A native iOS photobooth for a personal wedding on November 1, 2026: four front-camera photos at a physical backdrop, an optional look, a curated keepsake, a private guest page with original downloads, and one QR when the complete session is ready. Digital photos only. The connected device was identified as an **iPad Air 11-inch M2**; check its installed iPadOS and actual stand fit during rehearsal.

The owner reported a saving failure in the earlier build. This revision fixes SDK 58 native file-awaiting, replaces local recovery and the single-shot interface, and is **not yet verified on the wedding iPad**. Earlier synthetic checks and unsigned compilation did not establish device usability. The coordinator reports the earlier V1 four-photo backend deployed with pairing disabled and SMS mocked. V2's persisted grid aspect changes the API contract and requires the matching new backend bundle; private device provisioning and live sharing have not been verified. Production storage, installation, camera/Photos behavior and venue sharing remain gates in [the launch checklist](docs/LAUNCH.md).

## Run on the cloud host

The selected host is Debian Linux with Node 24.19.0. It runs TypeScript tests, the Cloudflare Worker/R2 emulator, and the iOS JavaScript bundle. It cannot run Xcode, the iOS simulator, Apple signing, or the iPad camera.

```sh
cd /workspace/WeddingIpadPhotoboothApp
bash scripts/setup-cloud.sh
```

In one terminal start the local API, then run its smoke test in another:

```sh
bash scripts/dev-api.sh
```

```sh
npm run smoke
```

The API binds to loopback port 8787, uses local disk-backed R2, and never sends texts. Its URLs are local test artifacts, not guest-accessible links. No Cloudflare account, SMS credential, or paid service is needed for these checks. `npm run dev:ipad` starts the native Metro development server for internal readiness checks; it does not install an iPad app or expose a cloud preview.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/ipad` | Native four-photo capture/review/retakes, local looks/keepsakes, durable library/recovery, optional Photos copies, queue and QR |
| `packages/core` | Persistable upload/share queue, dependency ordering, retries |
| `services/api` | Cloudflare Worker, private R2 galleries, one-use pairing and approval-gated Textbelt adapter |
| `.github/workflows` | Linux checks, unsigned physical-SDK Release build, standalone Release simulator tests and optional Debug UI mode |
| `docs` | Architecture, native installation, SMS decision, launch gates, validation evidence |

## Use on a Mac / iPad

Follow [native setup](docs/IOS.md). This is an iOS app, not a web replacement. Its local Core Image module requires a rebuilt native app; Expo Go cannot run the current filter/template workflow. A standalone signed installation and a real-device offline test are required for the wedding. Inspect the free personal-team profile's expiry and refresh it near the event.

## Guest privacy and storage

Each confirmed session has a hard-to-guess, expiring guest-page capability. There is no public event gallery or raw bucket access. A new session offers its keepsake, four selected photos and their untouched originals; existing five-photo galleries remain supported. Other retained takes stay private to the host. Links can be forwarded, so treat them as bearer access. SMS is optional, requires consent and an approved provider, and remains mocked/disabled until live approval. The iPad collects no names or email addresses and hides phone collection unless the backend explicitly advertises approved live SMS.

Each exposed photo is copied and verified in the app's documents directory before its saved thumbnail appears or capture advances. File journals retain local sessions and retakes even if the SQLite upload index fails. Host controls include an offline local library and separate permission-aware Photos export. Originals remain after upload and Next guest. Local preservation does not cover app deletion, a lost iPad or device failure; verify a second copy before cleanup. Cloud retention is separate from link expiry; no automatic public website import is enabled.

Cloudflare is preferred because the wedding website already uses it. The owner-created `gizelleandrami-photoboothphotos` bucket remains private. The coordinator owns deployment to the isolated `wedding-photobooth` Worker and `photos.gizelleandrami.com`, preserving the existing website. The app prefills that origin and uses [private one-time setup](docs/PRIVATE_PROVISIONING.md) to store its booth credential in Keychain. No production secrets are in the app or this public repository. This executor performs no deployment or live SMS sends.

## More detail

- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [iOS installation and device testing](docs/IOS.md)
- [Timer controls and rehearsal](docs/TIMING.md)
- [SMS options and deadline](docs/SMS.md)
- [Launch checklist and fallback](docs/LAUNCH.md)
- [Validation and progress](docs/VALIDATION.md)

Snappic, LumaBooth, Simple Booth, and Breeze Booth were supplied as inspiration. This repository uses original UI and code, without their assets or any claim of feature parity. Vendor product-page access was blocked in this executor. Later composition research inspected two public GitHub visual examples, documented with their limits in [the reference note](artifacts/visual/luna-keepsake-references.md); the owner's Library screenshots were not materialized here.
