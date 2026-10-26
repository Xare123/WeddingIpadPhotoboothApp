# Four-photo gallery: actual local browser evidence

Captured 2026-10-26T17:56:23.485Z; Chromium 154.0.8037.57.

[Side-by-side screenshot index](gallery-v2-index.html) · [Machine-readable checks and download SHA256](gallery-v2-checks.json).

Worker source: `82a548e2f5e640ce6f57f360b7636959e8c6877c3ec3b6c58570a80fb103bd63`, unchanged during capture. Owned loopback Worker8790, local R2 only, mock SMS with smsAvailable:false, 60second test TTL. No provider, pairing, secret, push, deployment, external upload or remoteCI action. Baseline gallery proof files were preserved.

The fixtures are four independently generated fictional adult wedding portraits. Original selections reuse all four corresponding raw JPEG IDs, so each session publishes five distinct objects for four selected positions, four raw-original positions and its composite. Required V2 gridAspect is portrait on both layouts. Strip/classic composite1200×3600; grid/botanical2400×3000; raw/selected960×1200. Composite JPEGs came from the actual local App inspector browser/Canvas renderer; this does not establish native CoreImage rendering or actual camera/guest photography.

## Verified checks

- PASS: Actual owned loopback Worker health returned local-r2, mock SMS and smsAvailable:false. No shares, pairing, provider or remote request was made.
- PASS: Actual HTTP: each layout uploaded five distinct JPEGs for four selected positions, four camera originals and one composite. Missing raw original or composite prevented publication and the predicted guest page remained404. Complete acknowledgement echoed exact ordered recipe; identical replay preserved URL/expiry; changed theme/aspect returned409; missing aspect returned400. Ready URLs stayed on loopback.
- PASS: strip 390×844: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: strip 820×1180: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: strip 1440×1000: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 390×844: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 820×1180: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: grid 1440×1000: actual HTTP200; composite and all selected images decoded at exact JPEG dimensions; four raw originals accessible; nine named >=44px download controls; no horizontal overflow; visible keyboard focus; reduced motion; exact UTC expiry; private retention copy; zero page errors/external requests/referrer headers.
- PASS: Twelve actual Chromium download clicks (composite, Original-selected first photo, and all four raw originals for both layouts) matched uploaded JPEG SHA256. Actual HTTP downloads of all five distinct assets per session also retained exact bytes, length and private headers. Cross-session IDs/raw storage paths/listing paths were unavailable. No messaging endpoint was called.
- PASS: Actual session revocation returned HTTP410 in Chromium and every selected/original/composite download and readiness replay returned410.
- PASS: A real60second local TTL elapsed without editing R2 state. Chromium then received the designed expired HTTP410 page; all role downloads and readiness replay also returned410. Expiry closes access, not original-byte deletion.
- PASS: Missing capability navigation returned the designed real HTTP404 browser state with no image/download controls or horizontal overflow.

## Screenshots

- [strip · 390 × 844 · Actual browser full page](gallery-v2-strip-phone.png)
- [strip · 390 × 844 · Actual browser viewport](gallery-v2-strip-phone-viewport.png)
- [strip · 820 × 1180 · Actual browser full page](gallery-v2-strip-tablet.png)
- [strip · 820 × 1180 · Actual browser viewport](gallery-v2-strip-tablet-viewport.png)
- [strip · 1440 × 1000 · Actual browser full page](gallery-v2-strip-desktop.png)
- [strip · 1440 × 1000 · Actual browser viewport](gallery-v2-strip-desktop-viewport.png)
- [grid · 390 × 844 · Actual browser full page](gallery-v2-grid-phone.png)
- [grid · 390 × 844 · Actual browser viewport](gallery-v2-grid-phone-viewport.png)
- [grid · 820 × 1180 · Actual browser full page](gallery-v2-grid-tablet.png)
- [grid · 820 × 1180 · Actual browser viewport](gallery-v2-grid-tablet-viewport.png)
- [grid · 1440 × 1000 · Actual browser full page](gallery-v2-grid-desktop.png)
- [grid · 1440 × 1000 · Actual browser viewport](gallery-v2-grid-desktop-viewport.png)
- [revoked · 390 × 844 · Actual HTTP 410 state](gallery-v2-revoked-phone.png)
- [expired · 390 × 844 · Actual HTTP 410 state](gallery-v2-expired-phone.png)
- [missing · 390 × 844 · Actual HTTP 404 state](gallery-v2-missing-phone.png)

Capability URLs, session IDs and photo IDs are omitted from repository proof and stdout. The owned local Miniflare diagnostics temporarily retained synthetic capability paths; those diagnostics were removed after shutdown. Both synthetic sessions were revoked after proof; local R2 JPEGs/manifests/revocation markers remain. No phone, pairing or messaging request was used.

Actual local Worker HTTP and responsive desktop Chromium proof. This is not native iOS/Safari/camera/CoreImage/Photos/QR-scan/SMS-delivery or deployed-Worker proof.

Visual inspection notes are recorded in gallery-v2-visual-review.md.

## Local diagnostic cleanup

Despite disabled Worker observability settings, this local Wrangler/Miniflare runtime retained synthetic capability paths in diagnostic logs/spans. The owned diagnostics were removed after stopping the owned Worker. This is not a production-retention test or claim. The run contained only synthetic fixtures. Removed 2 local diagnostic files after shutdown; preserved 10 JPEG objects, 2 gallery manifests, 4 revocation markers; no R2 objects were removed. See [visual review](gallery-v2-visual-review.md).
