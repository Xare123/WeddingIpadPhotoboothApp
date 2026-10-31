# Guest keepsake browser acceptance

Run from the repository root with the installed toolchain:

```sh
source scripts/cloud-env.sh
node --import tsx tools/guest-keepsake/browser-checks.mjs
```

This starts the actual bundled Worker in Miniflare, bridges it to an ephemeral loopback HTTP port, seeds synthetic JPEGs through authenticated local upload/readiness, and runs the actual private guest HTML and embedded client in system Chromium. It does not substitute another renderer. R2 art uses exact repository artwork. Request.cf external discovery is disabled; Worker external requests and browser off-origin requests fail the run. Server, Worker and browser close after the test. No live service, credential, purchase, real photo or SMS is used.

The four distinct synthetic marker JPEGs have asymmetric edge bands. The third is stored counterclockwise with EXIF orientation6, restoring an upright portrait when decoded. The fourth stores a horizontally flipped raster with EXIF orientation2, restoring the same left-red/right-blue edge oracle; these fixtures detect both orientation and mirror double-application. Tests assert four unique centers, complete FIT edges, top-aligned FILL with deliberate lower-edge cropping, exact JPEG dimensions, immutable source/booth downloads, repeated switching, and missing-photo/art retry. Fixtures are generated locally with Canvas and installed Pillow, rather than supplied guest images.

The current entry point delegates to `layout-browser-checks.mjs`. Current outputs in `artifacts/visual/guest-keepsake-layout` cover nine source-gallery descriptors, 36 actual JPEG downloads (Grid/Strip × Fill/Fit for each), all three v3 themes, and v1/v2 compatibility. Every gallery defaults to Social Grid at 2400×2400; strips are 1200×3600. Saved booth output remains unchanged. Tests verify 40 sequential and 40 rapid layout changes across both fit modes, reuse of all four cached Blob URLs without refetching, four source/photo-art retry cases across mobile390×844 and desktop1440×1000, and strict source hashes. Twelve screenshots cover all six v3 layout/theme combinations at both viewports. Historical 18-download evidence remains untouched under `artifacts/visual/guest-keepsake`. These diagnostic markers are not a wedding design mockup; screenshots are browser, not native iOS proof.

Chromium passing does not establish Safari/iOS download behavior, available-memory limits, phone photo-library handling, native bridge parity, or production deployment. Test those separately on real owner devices before launch. Guest-generated variants are new browser compositions; the untouched booth JPEG remains available.

For the separate, drink-free fictional-adult Coastal square showcase:

```sh
node --import tsx tools/guest-keepsake/clean-showcase.mjs
```

This creates only `artifacts/visual/guest-keepsake-clean`, leaving all marker acceptance evidence unchanged. `showcase-checks.json` records exact input/output/source hashes. Four mobile/desktop Fill/Fit screenshots and two actual guest-client JPEG downloads are provided. The selected studio fixtures were visually inspected: fictional adult pairs, no drinks, watermark or diagnostic overlays. This is a presentation check, separate from the stronger asymmetric-marker correctness checks.
