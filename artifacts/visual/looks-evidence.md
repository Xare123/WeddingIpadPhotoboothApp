# LOCAL UNPUBLISHED postcapture look browser fixtures

Actual App/editor-controller JSX with synthetic Canvas recipe rendering and in-memory persistence. **CoreImage processing, native JPEG/EXIF/color management, native durability, Photos, R2, downloads and iOS behavior are unverified.** The images contain only the existing generated fixture scene. Every screenshot/video keeps the browser-fixture banner. No push, deployment, real guest photo or outbound service request was made.

App SHA256: `640a9ac8c0d04f73ab34956615bf8a4a5be453a52a6301b80634f900818c5ffc`. [Checks](looks-checks.json) and [bundle boundary](looks-bundle-boundary.json) record matching App, actual controller, optional-module adapter and local-type source hashes, verified after recording. The prior `new-session-*` full-bleed evidence is preserved.

| View | Portrait | Landscape |
| --- | --- | --- |
| Original reference | [PNG](looks-original-portrait.png) | [PNG](looks-original-landscape.png) |
| Warm 100% | [PNG](looks-warm-portrait.png) | [PNG](looks-warm-landscape.png) |
| B&W 100% | [PNG](looks-bw-portrait.png) | [PNG](looks-bw-landscape.png) |
| Film 100% | [PNG](looks-film-portrait.png) | [PNG](looks-film-landscape.png) |
| Film 25% | [PNG](looks-film-strength25-portrait.png) | [PNG](looks-film-strength25-landscape.png) |
| Saved Warm review | [PNG](looks-saved-warm-portrait.png) | [PNG](looks-saved-warm-landscape.png) |
| Recorded interaction | [20.80s WebM](looks-demo-portrait.webm) | [20.20s WebM](looks-demo-landscape.webm) |

Both orientations passed: all three presets produce distinct actual JPEG bytes/pixels with CSS filter `none`; B&W 100% decoded chroma is zero versus original mean38.845; Film25 differs from Film100; strength0 restores source pixels; preview and saved durable-copy JPEG SHA256 match. Applying a look preserves the original ID/URI in retained originals and leaves the other four slots unchanged. Original restores its original ID. Retake selects a fresh original without look metadata. Cancel leaves all five selections unchanged. Forced late render completion cannot replace the latest preview. Background closes the editor. Cancellations and cache releases are observed. No upload jobs exist before confirmation. The unavailable module hides Looks.

The synthetic engine renders fresh JPEG0.95 pixels from the immutable generated source every time; strict native-shaped effect file URIs map to those blob bytes only in the browser adapter. Derivatives get separately copied JPEG blobs and canonical synthetic file URIs. These are browser approximations of the documented recipes, not native output comparisons. Portrait/landscape Original, Warm, B&W, Film and strength25 images were visually inspected: the full photo remains contained, controls are visible, and saved review shows the processed JPEG. The run produced12 screenshots and2 videos, with zero browser errors and zero unexpected external requests.
