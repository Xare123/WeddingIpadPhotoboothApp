# Wedding iPad Photobooth

A native iOS photobooth for a personal wedding on November 1, 2026: a front-camera photo at a physical backdrop, a private guest page, downloads, and a QR code once the upload finishes. Digital photos only. The provisional device is an M1 iPad Air (5th generation); confirm its model, iPadOS version, and stand fit before rehearsal.

This is an implemented MVP under local validation, **not yet deployed, signed, or verified on the wedding iPad**. The existing wedding website is unchanged. Production storage, device installation, camera behavior, and venue connectivity remain launch gates in [the launch checklist](docs/LAUNCH.md).

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
| `apps/ipad` | Expo SDK 58 / React Native iOS app, camera, local preservation, queue, QR |
| `packages/core` | Persistable upload/share queue, dependency ordering, retries |
| `services/api` | Cloudflare Worker, private R2 objects, session guest galleries and mock SMS |
| `.github/workflows` | Automated Linux checks and review-branch opt-in unsigned macOS XCTest lane |
| `docs` | Architecture, native installation, SMS decision, launch gates, validation evidence |

## Use on a Mac / iPad

Follow [native setup](docs/IOS.md). This is an iOS app, not a web replacement. Expo Go can help with early development when its SDK matches, but a standalone signed installation and a real-device offline test are required for the wedding. Do not rely on a development server or an expiring installation.

## Guest privacy and storage

Each confirmed session has a hard-to-guess, expiring guest-page capability. There is no public event gallery or raw bucket access. Guests can view and download only the photos in their session. Links can be forwarded, so treat them as bearer access. SMS is optional, requires consent and an approved provider, and currently returns an explicit mock result. The iPad does not collect names or email addresses.

Originals remain in the app's documents directory after upload. Local durability covers app restarts, not app deletion, a lost iPad, or device failure. Back up the device and verify cloud originals before clearing anything. Cloud originals are separate from guest-link expiry and can later be selected for the wedding website with the couple's approval; no automatic public website import is enabled.

Cloudflare is preferred because the wedding website already uses it. The owner has activated R2 and created `gizelleandrami-photoboothphotos`; the coordinating task verified that it is private, with `r2.dev` disabled and no custom domains. The production example binds that existing bucket. A separate Worker on the proposed `photos.gizelleandrami.com` preserves the apex and `www`. This cloud task has not deployed that Worker or created a hostname, provider account or credentials.

## More detail

- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [iOS installation and device testing](docs/IOS.md)
- [SMS options and deadline](docs/SMS.md)
- [Launch checklist and fallback](docs/LAUNCH.md)
- [Validation and progress](docs/VALIDATION.md)

Snappic, LumaBooth, Simple Booth, and Breeze Booth were supplied as inspiration. This repository uses original UI and code, without their assets or any claim of feature parity. Their official sites were blocked by this cloud environment's network policy and were not reviewed here.
