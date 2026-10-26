# LOCAL UNPUBLISHED four-photo template browser fixtures

**Native CoreImage/CoreText processing and iOS behavior are UNVERIFIED.** This evidence runs the actual App capture, review, look, template, Photos-export and sharing presenters through React Native Web. Canvas generates actual JPEG pixels; storage, Photos and upload/publication acknowledgements are explicit in-memory adapters. No real camera poses, guest photos, files/SQLite durability, native color/EXIF pipeline, R2 publication, downloads, phone scanning, network upload or SMS is verified. Every image/video retains the browser-fixture banner.

App SHA256: `71d7007cd4c903938ee60703f4811b7e3ac47dabc1c2088b6e8b925c21b4072c`. [Checks](templates-checks.json) and [bundle provenance](templates-bundle-boundary.json) record matching App, actual template/look controllers, optional-module adapter, types, publication, capture and sharing source hashes, verified after capture. Previous `new-session-*` full-bleed and `looks-*` evidence remains unchanged. These new artifacts are local and unpublished.

## End-to-end recordings

- [Portrait, 47.64s WebM](templates-demo-portrait.webm)
- [Landscape, 46.68s WebM](templates-demo-landscape.webm)

Each video starts with a real App four-shot automatic sequence against the synthetic camera, immediately retakes thumbnail 3 without an actor delay, applies Warm to that selected photo, visits all six templates, swaps two positions, opts into fill/pan/zoom, restores fit, cancels through synthetic backgrounding, saves a fresh full-size keepsake, shows offline sharing, acknowledges all required assets, and resets for Next guests. Browser timing is not native camera/rendering performance.

## Actual rendered JPEGs in the UI

| Layout and theme | Portrait | Landscape |
| --- | --- | --- |
| Strip · Classic Ivory | [PNG](templates-strip-classic-portrait.png) | [PNG](templates-strip-classic-landscape.png) |
| Strip · Sage Botanical | [PNG](templates-strip-botanical-portrait.png) | [PNG](templates-strip-botanical-landscape.png) |
| Strip · Coastal Sea Glass | [PNG](templates-strip-coastal-portrait.png) | [PNG](templates-strip-coastal-landscape.png) |
| Grid · Classic Ivory | [PNG](templates-grid-classic-portrait.png) | [PNG](templates-grid-classic-landscape.png) |
| Grid · Sage Botanical | [PNG](templates-grid-botanical-portrait.png) | [PNG](templates-grid-botanical-landscape.png) |
| Grid · Coastal Sea Glass | [PNG](templates-grid-coastal-portrait.png) | [PNG](templates-grid-coastal-landscape.png) |
| Explicit fill/pan/zoom | [PNG](templates-crop-pan-clean-portrait.png) | [PNG](templates-crop-pan-clean-landscape.png) |
| Full-size saved keepsake, offline | [PNG](templates-saved-offline-portrait.png) | [PNG](templates-saved-offline-landscape.png) |
| Acknowledged sharing QR | [PNG](templates-ready-portrait.png) | [PNG](templates-ready-landscape.png) |
| Next guests privacy reset | [PNG](templates-next-guests-portrait.png) | [PNG](templates-next-guests-landscape.png) |

[Legacy five-photo sharing](templates-legacy-five-portrait.png) remains available through an explicit five-photo fixture.

The four distinct source JPEGs are **marker-labeled variants of the same existing owned fictional generated scene**, not four different real photographs or poses. Red/green/blue/purple edges and corner labels 1–4 make source identity, ordering and cropping inspectable. Each source has different actual JPEG bytes/SHA256. No third-party photo, vendor art or reference screenshot is used. Canvas follows the documented dimensions/palettes and footer placement; font metrics, color management and rasterization remain browser approximations, not native visual-reference approval.

## Verified browser outcomes

Both complete workflows passed, with 21 screenshots and 2 videos, zero browser errors and zero unexpected external requests. All six layout/theme combinations use actual JPEGs with CSS filter `none`, distinct byte hashes and expected palette pixels. Strip previews are 480×1440; grid previews 1440×1260; saved grid JPEG 2400×2100. All 192 sampled colored source edges survive default fit across four photos, six combinations and two orientations. All three theme cards show actual four-photo thumbnails; default Save is visible in both orientations. Explicit fill/pan/zoom changes decoded pixels, and fit restores the prior edge-preserving JPEG. Two taps swap the actual first/second marker identities.

The exact immediate thumbnail 3→Retake actor selects slot 3 in both orientations and preserves the other three captures. Applying Warm preserves its raw original and uses the committed filtered JPEG in the template. Template preview/final canonical recipe and all four source hashes match. Saving leaves raw originals and selected-photo IDs/URIs unchanged. The separate canonical `/photobooth/ID.jpg` composite is displayed from copied full-size JPEG bytes; the actual Photos controller updates its separate status through the mock SDK.

No jobs exist before confirmation. The filtered selection produces exactly six deduplicated jobs: four selected IDs, the additional raw original behind the filtered ID, and the composite. QR stays hidden offline and after uploads lacking final acknowledgement; only an explicit synthetic all-assets acknowledgement reveals it. Backgrounding cancels pending template requests, returns to review without changing selected sources, and leaves host controls closed. Next guests clears the active session and all guest composite/blob images. Explicit count 5 still confirms five jobs. Missing template capability reports the native-build requirement and fabricates no composite.

These findings establish browser UI/controller contracts only. Physical iPad capture, native module registration, native JPEG/color/EXIF processing, memory/cancellation stress, durable local recovery, real Photos behavior, backend publication compatibility, phone QR scanning and downloaded bytes require their separate actual-native/service evidence.


## Image error recovery and final static refresh

[SDK Image regression](templates-image-checks.json) passed four cases through the actual App/TemplateStudio Image callbacks: Original preview, processed Warm preview, main template preview and nonselected Coastal thumbnail. The explicit fixture boundary withholds onLoad and delivers an asynchronous synthetic SDK onError. It is **not** a failed browser resource/decode request or native iOS Image failure. Actual Root callbacks and controller error/retry paths execute. Apply/Save disables on failure; immutable original selections and the empty pre-confirmation queue remain unchanged. Warm and template retries generate fresh file URIs for the same recipe; Original retry remounts its same source URI. Replayed stale prior processed/template errors do not invalidate recovered previews. All four cases completed with zero browser errors and zero unexpected external requests.

| Callback case | Error | Recovered |
| --- | --- | --- |
| Original Image | [PNG](templates-image-look-original-error.png) | Same URI remounted and onLoad acknowledged in JSON |
| Processed Warm Image | [PNG](templates-image-look-warm-error.png) | [PNG](templates-image-look-warm-recovered.png) |
| Main template Image | [PNG](templates-image-template-main-error.png) | Fresh same-theme URI and onLoad acknowledged in JSON |
| Coastal thumbnail Image | [PNG](templates-image-template-theme-error.png) | [PNG](templates-image-template-theme-recovered.png) |

[Static refresh receipts](templates-static-checks.json) record two additional full-frame crop-control stills after the identical swap/fill/pan/zoom actions, with the complete adjustment row aligned and four stable scroll frames. The clean portrait shows Done adjusting, all crop/pan/zoom controls and Save without a clipped prior label. These are extra static review fixtures starting from four-photo review; the full-capture recordings and natural clamped-scroll screenshots remain in the main run unchanged. No image crop or immediate-retake actor change was used. The natural-offset screenshots are [portrait](templates-crop-pan-portrait.png) and [landscape](templates-crop-pan-landscape.png).

The refreshed sharing layout passes explicit initial-viewport bounds for both QR and Next guests in portrait and landscape, without a scroll actor. Automatic sharing retry may reveal the QR after the mock all-assets acknowledgement; the tests wait for this actual App refresh instead of racing a Retry button that has already disappeared.

Final evidence totals: main 21 PNGs/two WebMs, six Image error/recovery PNGs and two clean static PNGs (29 PNGs total). All three reports passed on the exact App SHA above; the main and Image runs verify all 21 App/helper/controller/Studio source hashes. Passed prior `ccb637ff` evidence is archived under ignored `.cache/new-session-visual/ccb637ff-evidence`; it is not relabeled as final source. Native processing remains unverified until separate Apple-hosted/native-device execution.
