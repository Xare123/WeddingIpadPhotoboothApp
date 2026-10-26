# Four-photo gallery: actual local browser evidence

Captured 2026-10-26T16:54:42.219Z; Chromium 154.0.8037.57.

[Side-by-side screenshot index](gallery-four-index.html) · [Machine-readable checks and download SHA256](gallery-four-checks.json).

Worker source: `377618a384ffecc2452518d85d7fbff4b6a00c0a4eaeb27721735426fa245dfa`, unchanged during capture. Owned loopback Worker8790, local R2 only, mock SMS with smsAvailable:false, 60second test TTL. No provider, pairing, secret, push, deployment, external upload or remoteCI action. Baseline gallery proof files were preserved.

The fixtures are four distinct labeled variants of a fictional scene exported from the existing local template browser. Position1 uses Warm75%; positions2–4 reuse the corresponding raw JPEG IDs. Each session publishes six distinct stored objects for four selected positions, four raw-original positions and its composite. Strip/classic composite1200×3600; grid/botanical2400×2100; raw/selected1122×1402. These are browser/Canvas JPEGs, not native CoreImage evidence or actual camera/guest photographs.

## Verified checks

- PASS: Actual owned loopback Worker health returned local-r2, mock SMS and smsAvailable:false. No shares, pairing, provider or remote request was made.
- PASS: Actual HTTP: each layout uploaded six distinct JPEGs for four selected positions, four camera originals and one composite. Missing raw original or composite prevented publication and the predicted guest page remained404. Complete acknowledgement echoed exact ordered recipe; identical replay preserved URL/expiry; changed theme returned409. Ready URLs stayed on loopback.
- PASS: strip 390×844: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: strip 820×1180: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: strip 1440×1000: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 390×844: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 820×1180: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 1440×1000: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: Twelve actual Chromium download clicks (composite, Warm-selected first photo, and all four raw originals for both layouts) matched uploaded JPEG SHA256. Actual HTTP downloads of all six distinct assets per session also retained exact bytes, length and private headers. Cross-session IDs/raw storage paths/listing paths were unavailable. No messaging endpoint was called.
- PASS: Actual session revocation returned HTTP410 in Chromium and every selected/original/composite download and readiness replay returned410.
- PASS: A real60second local TTL elapsed without editing R2 state. Chromium then received the designed expired HTTP410 page; all role downloads and readiness replay also returned410. Expiry closes access, not original-byte deletion.
- PASS: Missing capability navigation returned the designed real HTTP404 browser state with no image/download controls or horizontal overflow.

## Screenshots

- [strip · 390 × 844 · Actual browser full page](gallery-four-strip-phone.png)
- [strip · 390 × 844 · Actual browser viewport](gallery-four-strip-phone-viewport.png)
- [strip · 820 × 1180 · Actual browser full page](gallery-four-strip-tablet.png)
- [strip · 820 × 1180 · Actual browser viewport](gallery-four-strip-tablet-viewport.png)
- [strip · 1440 × 1000 · Actual browser full page](gallery-four-strip-desktop.png)
- [strip · 1440 × 1000 · Actual browser viewport](gallery-four-strip-desktop-viewport.png)
- [grid · 390 × 844 · Actual browser full page](gallery-four-grid-phone.png)
- [grid · 390 × 844 · Actual browser viewport](gallery-four-grid-phone-viewport.png)
- [grid · 820 × 1180 · Actual browser full page](gallery-four-grid-tablet.png)
- [grid · 820 × 1180 · Actual browser viewport](gallery-four-grid-tablet-viewport.png)
- [grid · 1440 × 1000 · Actual browser full page](gallery-four-grid-desktop.png)
- [grid · 1440 × 1000 · Actual browser viewport](gallery-four-grid-desktop-viewport.png)
- [revoked · 390 × 844 · Actual HTTP 410 state](gallery-four-revoked-phone.png)
- [expired · 390 × 844 · Actual HTTP 410 state](gallery-four-expired-phone.png)
- [missing · 390 × 844 · Actual HTTP 404 state](gallery-four-missing-phone.png)

All capability URLs, session IDs and photo IDs stayed in process memory; no phone data or messaging request. Both synthetic galleries revoked after proof; local emulator bytes retained. Repo proof files contain only fake fixture names, hashes and screenshots.

Actual local Worker HTTP and responsive desktop Chromium proof. This is not native iOS/Safari/camera/CoreImage/Photos/QR-scan/SMS-delivery or deployed-Worker proof.

Visual inspection notes are recorded in gallery-four-visual-review.md.

## Local developer diagnostic privacy finding

Despite the repository's disabled observability configuration, local Miniflare retained synthetic capability paths in its internal diagnostic SQLite logs/spans. Only aggregate counts were reported. After both galleries were revoked, the owned Worker8790 was stopped and only its generated observability database/sidecars were removed. The 12 JPEGs, two manifests and four revocation markers remain local; no pairing/share/SMS records exist. This is a local tooling observation, not proof of production logging behavior. Details and visual inspection notes: [gallery-four-visual-review.md](gallery-four-visual-review.md).

[SHA256 file manifest](gallery-four-sha256.txt) covers the final screenshots and reports. The report-text/PNG-metadata scan and visual inspection found no capability, UUID, phone or credential data. Complete PNG bytes also passed capability/UUID/bearer/known-credential pattern checks.
