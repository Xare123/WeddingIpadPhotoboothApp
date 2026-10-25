# QR decoding investigation and final browser evidence

The final actual App JSX passes **20 of 20 full-frame screenshot cases in two independent decoders**, jsQR 1.4.0 and ZXing-C++ through zxing-wasm 3.1.6. Every decoded string exactly matches the expected session URL, including its complete 64-character hex token. These are browser fixtures with synthetic device adapters, not iOS screenshots or physical-phone scans. Guest-facing expiry evidence uses `America/Los_Angeles`.

| Synthetic payload | Portrait 820 × 1180 | Landscape 1180 × 820 |
| --- | --- | --- |
| Reserved hostname, DPR 1 | [Screenshot](qr-ready-reserved-portrait-1x.png) | [Screenshot](qr-ready-reserved-landscape-1x.png) |
| Realistic hostname, DPR 1 | [Screenshot](qr-ready-realistic-portrait-1x.png) | [Screenshot](qr-ready-realistic-landscape-1x.png) |
| Reserved hostname, DPR 2 | [Screenshot](qr-ready-reserved-portrait-2x.png) | [Screenshot](qr-ready-reserved-landscape-2x.png) |
| Realistic hostname, DPR 2 | [Screenshot](qr-ready-realistic-portrait-2x.png) | [Screenshot](qr-ready-realistic-landscape-2x.png) |
| Reserved hostname, numeric-heavy token, DPR 1 | [Screenshot](qr-ready-reserved-numeric-portrait-1x.png) | [Screenshot](qr-ready-reserved-numeric-landscape-1x.png) |
| Realistic hostname, numeric-heavy token, DPR 1 | [Screenshot](qr-ready-realistic-numeric-portrait-1x.png) | [Screenshot](qr-ready-realistic-numeric-landscape-1x.png) |
| Short reserved hostname, numeric-heavy token, DPR 1 | [Screenshot](qr-ready-short-numeric-portrait-1x.png) | [Screenshot](qr-ready-short-numeric-landscape-1x.png) |

The reserved payload is `https://photobooth.example/g/` followed by the original `a7` repeated 32 times, totaling 93 characters. The realistic payload is `https://photos.gizelleandrami.com/g/d948b21e9fbc4a03952beed701f680cf09e8d382f5c421a9f7da6034cbb16e52`, totaling 100 characters. The numeric-heavy cases use a 64-character token consisting of `1` on those two hosts and short reserved `https://a.example/g/` (84 characters). All tokens satisfy the canonical 64-lowercase-hex shape. All five payloads are tested in both orientations at DPR 1 and 2; the JSON links every screenshot, including the additional numeric DPR-2 cases. The realistic-host URL is fabricated encoded data: no request was made to that hostname. The browser blocks all requests outside its loopback fixture origin, and the final run recorded zero external requests and zero browser errors. Lengths are computed from the exact payload strings in the machine-readable report.

## Findings and smallest source fix

There were two distinct findings. First, the originally reported decoding failure was **not evidence of an incorrect encoder payload**. The original full-frame screenshot and SVG-region screenshot decode to the exact reserved URL in both jsQR and ZXing-C++. Sampling all 41 × 41 module centers in the original portrait screenshot against the existing qrcode 1.5.4 encoder found zero differences. The maintained encoder was retained.

ZXing JavaScript 0.23.0's normal detector returned `ChecksumException` for the original full frame and `NotFoundException` for its SVG region. It also returns `NotFoundException` for pristine, independently generated reference PNGs with exact 4 or 5 pixels per module and a 4-module border, although those same PNGs decode in jsQR and ZXing-C++, and ZXing JS itself decodes them using its separate `PURE_BARCODE` option. This control demonstrates a detector false negative. It does not establish a native iPad rendering defect. Antialiasing and sampling geometry affect that detector's results; an underlying native rasterization fault was not proven.

Second, the original explicit SVG quiet zone was too small: `quietZone=12` with a 224-unit, 41-module matrix is only 2.196 modules. Surrounding card whitespace is not a reliable substitute for an explicit QR border. Numeric-heavy valid tokens expose an additional sizing issue: automatic segmentation compresses these URLs to 33 or 37 modules, so a 24-unit border would be only 3.535714 or 3.964286 modules. The app owner therefore changed the existing QR component to a consistent **`size=224`, `quietZone=32`, and explicit error correction `M`** in both orientations. The final cases cover matrix sizes 33, 37, and 41, with explicit borders of **4.714286, 5.285714, and 5.857143 modules** respectively, exceeding the four-module requirement. The SVG uses a `-32 -32 288 288` viewBox within its 224 × 224 layout box. No payload shortening, fake success result, screenshot sharpening, decoder-driven image editing, or custom QR encoder was used.

The final screenshots import the actual App component and render its actual QR JSX. They were captured without DOM, SVG, or screenshot modifications. All 20 full frames pass both independent decoders. ZXing JS passes 18 final cases but retains checksum failures on the nonnumeric realistic-host portrait and landscape DPR-2 cases; those failures are recorded rather than hidden. The independent full-frame results do not use crops, enlargement, thresholding, `PURE_BARCODE`, or expected-payload hints.

The realistic-host portrait and numeric-short-host landscape were visually inspected after the final 32-unit change. The QR, date/time/timezone expiry, and Next guest action fit in the initial viewport. Bounds assertions confirm the QR and Next guest are fully visible in all 20 cases, with no horizontal overflow. Remeasure module count and border coverage if the payload contract, QR component, or its parameters change.

## Evidence and reproduction

[qr-rendered-checks.json](qr-rendered-checks.json) records exact expected and decoded URLs, encoder/decoder versions, App source SHA-256, SVG geometry, quiet-zone calculation, screenshot dimensions/DPR, Next guest bounds, browser errors, original failures, and reference controls. The parent's original [qr-decode-checks.json](qr-decode-checks.json) remains unchanged. Original browser captures: [full frame](qr-before-portrait.png), [SVG region](qr-before-svg.png). Reference controls: [4 pixels per module](qr-reference-4px-module.png), [5 pixels per module](qr-reference-5px-module.png). Reference PNGs are decoder controls, not native UI screenshots.

From the repository root, use the local development-only harness:

```sh
node tools/native-visual/serve.mjs --release-fixture
node tools/native-visual/check-qr.mjs
```

`check-qr.mjs` uses optional, isolated dependencies from `.cache/qr-tools`, with versions listed in the JSON and installation instructions in the harness README. ZXing-C++ loads its WASM directly from the installed local file; no decoder CDN is contacted. Stop only the fixture server you started when finished. No production deployment or SMS is part of this check.

## Physical device checks still required

These checks remain **unrun** and must use an actual installed iPad build before booth launch:

- Take a synthetic test capture on the iPad, confirm it, and wait for the authenticated server to acknowledge the exact guest URL as ready. Verify the QR stays absent while pending or offline.
- Scan the iPad display with normal iPhone and Android camera apps in both orientations, using representative booth lighting, screen brightness, glare, viewing angles, and practical guest distances. Record the devices and tested conditions; the screenshot decodes do not establish scanning range.
- Verify that the scanned string exactly matches the server-issued session URL, opens the intended synthetic photo page on the phone, and offers the original download. Use an authorized configured deployment for this network check.
- Verify the visible expiry date/time/timezone, expired and revoked public-link behavior, and continued private host access to the original under the product's retention policy.
- Tap Next guest and confirm the prior photo/QR no longer appears. Confirm no phone simulation controls appear in the installed release build. No real SMS or guest personal data is needed for these checks.
