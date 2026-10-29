# Guest website: Fill Frames and Full Photo

This is a website/Worker update only. Installed iPad build19, its source, signing, configuration, queue and photos are unchanged. No Mac or iPad work is required.

## Sources and preserved downloads

Current four-photo manifests retain ordered selected-photo IDs, corresponding camera-original IDs, and the saved keepsake's version/layout/theme/aspect. The app's selected-photo uploads contain full, uncropped images, including any selected look; camera originals are separate files. The website renders from the selected images in their saved order, so it does not silently replace a look with a raw original. The existing booth JPEG and every existing photo/original download remain byte-for-byte downloads through their existing links.

The manifest does not retain the booth's per-photo crop pan/zoom. New website variants therefore use a fresh top-aligned Fill crop or a whole-image Full Photo fit; they do not claim to recover the exact saved crop or lettering. Browser fonts/encoding may differ from native CoreText. The original booth JPEG remains available unchanged.

No live source objects were inspected. Readiness required all referenced uploads when publishing; each browser request still checks actual availability. A missing source, invalid JPEG or missing artwork stops alternate rendering with a truthful message. There is no reconstruction from an already-cropped composite and no automatic raw-photo substitution. Old one/five-photo galleries without a four-photo template keep their original downloads without an editor.

## Rendering and privacy

The browser prepares both full-resolution JPEGs locally and keeps both download actions visible regardless of the selected preview. Repeated switching reuses the two generated blobs without network requests or stored-object writes. Decoding is sequential, byte/dimension bounded, and time limited; source JPEG dimensions are checked before decode. Every EXIF orientation is left to the browser image decoder once, without a second manual flip. Canvas dimensions are independent of screen size/DPR.

| Recipe | Strip | Grid |
|---|---|---|
| V1 | 1200×3600 | 2400×2100 |
| V2 | 1200×3600 | Portrait2400×3000 or Square2400×2400 |
| V3 | 1200×3600 | 2400×2400 |

Layout and theme stay those of the saved keepsake; this feature only changes photo fit. Full Photo keeps every edge, with side space when necessary. Fill Frames aligns at the top and crops edges. Original image files are never modified.

The static client script and approved V3 theme art use token-scoped, expiry/revocation-checked GET routes. They reuse existing PHOTO rate-limit bindings before storage access. Script URLs, art paths and four photo URLs are same-origin, same-capability and fixed/validated; there is no public listing, guest write endpoint, external photo processing, analytics, credential collection or SMS action. CSP permits only the same-origin script/network and local blob images; inline executable scripts remain disallowed. JSON/errors retain their existing stricter policy.

Generated JPEGs live in the current browser tab and are downloaded by the guest. No alternate images are uploaded to R2. A revisit needs the sources again. Link expiry/revocation prevents new server requests, but cannot erase images a guest already obtained, as with ordinary downloads.

## Deployment preparation only

A backend update **is required** for HTML, the private client route and private artwork routes. Three exact generated PNGs must also exist at the fixed keys in `artifacts/deploy/guest-artwork-v3/manifest.json`, in the existing private R2 bucket. They are generated backgrounds, not guest photos. No new bucket, public bucket URL, DNS, secret, binding or paid rendering service is needed.

The release archive includes Worker code plus the three artwork objects and their hashes. Before any later approved deployment, verify current production code/configuration and retain rollback. Upload artwork first; skip an existing identical hash, and do not blindly overwrite a conflicting versioned object. Then update code while preserving every live variable, secret, binding, rate namespace and SMS/pairing setting. Example manifest values are not instructions to replace production settings. Verify through permitted management paths; the live-origin request hold remains.

No deployment, R2 upload, origin probe, real-photo access, credential creation or SMS send was performed during this work.

## Validation boundaries

API/emulator checks cover private capability/expiry/revocation, exact artwork hashes, no GET mutations, unchanged old downloads and missing-source behavior. Browser checks exercise the actual local Worker and client, not the iPad renderer stub: mobile and desktop, both downloads, all layout/version dimensions, marked photo edge cropping/EXIF, repeated switching and retry. Chromium mobile emulation does not establish Safari or every in-app browser. JavaScript/Canvas support is needed for new variants; existing booth/original download links remain without it. iOS may offer a Share/Save flow rather than a desktop-style file download; actual-phone behavior and production readiness require later authorized checks.
