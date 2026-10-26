# Guest gallery: actual browser evidence

Captured 2026-10-26T05:46:07.534Z. Chromium 154.0.8037.57. Browser timezone: America/Los_Angeles; gallery expiry explicitly uses UTC.

Worker source: `services/api/src/index.ts`, SHA-256 `3578656e2ce56933da398a0179c664c77fa788e5c99e267b5d5e0b10ce94cbe1`; unchanged during capture.

Actual local Worker guest gallery rendered in desktop Chromium at responsive viewport sizes. Native iPad / iOS Safari / physical camera / native animations were not executed.

Five original synthetic illustrations created with browser canvas; labeled SAMPLE SCENE in every image. No private photos, phone numbers, or messaging used.

Run with a local Worker on the script’s default test port: `node scripts/visual-evidence.cjs`. Uses the installed Chromium executable and Playwright; does not install dependencies or browsers. The API origin can be overridden with `VISUAL_API_ORIGIN`, restricted to loopback for internal testing.

## Actual screenshots

- [390 × 844: full gallery](gallery-phone.png) · [viewport crop](gallery-phone-viewport.png)
- [820 × 1180: full gallery](gallery-tablet.png) · [viewport crop](gallery-tablet-viewport.png)
- [1440 × 1000: full gallery](gallery-desktop.png) · [viewport crop](gallery-desktop-viewport.png)
- [Revoked gallery: phone](gallery-revoked-phone.png)
- [Missing link: phone](gallery-missing-phone.png)

## Automated checks

- PASS: Health confirmed local R2, mock SMS and smsAvailable:false. Uploaded five original labeled synthetic 1200 × 1500 JPEGs to the local R2 emulator and finalized a real gallery. No messaging request was made.
- PASS: 390 × 844: five images decoded at original dimensions; no horizontal overflow; named download controls ≥44 px; full-resolution labels; keyboard focus visible; entrance animations complete; reduced motion removes animation/transitions; exact UTC expiry with semantic time element remains consistent in America/Los_Angeles browser timezone; photo-retention copy visible; zero page errors or external requests.
- PASS: 820 × 1180: five images decoded at original dimensions; no horizontal overflow; named download controls ≥44 px; full-resolution labels; keyboard focus visible; entrance animations complete; reduced motion removes animation/transitions; exact UTC expiry with semantic time element remains consistent in America/Los_Angeles browser timezone; photo-retention copy visible; zero page errors or external requests.
- PASS: 1440 × 1000: five images decoded at original dimensions; no horizontal overflow; named download controls ≥44 px; full-resolution labels; keyboard focus visible; entrance animations complete; reduced motion removes animation/transitions; exact UTC expiry with semantic time element remains consistent in America/Los_Angeles browser timezone; photo-retention copy visible; zero page errors or external requests.
- PASS: All five served downloads were byte-identical to their uploaded JPEGs. Actual browser download of the first JPEG also matched and used wedding-photo-1.jpg.
- PASS: Revoked gallery returned a real HTTP 410 page, hid all photos/download controls, and blocked its photo download. Missing link returned a real HTTP 404 page.

Capability URLs and session identifiers omitted from artifacts and stdout. Gallery revoked after captures. Emulator photo bytes remain local.

Visual inspection notes are recorded separately in [visual-review.md](visual-review.md). Responsive Chromium captures do not establish native iPad or Safari behavior. Rate-limit 429 rendering is covered by the existing unit suite; this browser run stays below request quotas and does not claim a captured 429 state.
