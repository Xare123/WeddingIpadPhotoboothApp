# Guest keepsake browser acceptance

Run from the repository root with the installed toolchain:

```sh
source scripts/cloud-env.sh
node --import tsx tools/guest-keepsake/browser-checks.mjs
```

This starts the actual bundled Worker in Miniflare, bridges it to an ephemeral loopback HTTP port, seeds synthetic JPEGs through authenticated local upload/readiness, and runs the actual private guest HTML and embedded client in system Chromium. It does not substitute another renderer. R2 art uses exact repository artwork. Request.cf external discovery is disabled; Worker external requests and browser off-origin requests fail the run. Server, Worker and browser close after the test. No live service, credential, purchase, real photo or SMS is used.

The four distinct synthetic marker JPEGs have asymmetric edge bands. The third is stored counterclockwise with EXIF orientation6, restoring an upright portrait when decoded. The fourth stores a horizontally flipped raster with EXIF orientation2, restoring the same left-red/right-blue edge oracle; these fixtures detect both orientation and mirror double-application. Tests assert four unique centers, complete FIT edges, top-aligned FILL with deliberate lower-edge cropping, exact JPEG dimensions, immutable source/booth downloads, repeated switching, and missing-photo/art retry. Fixtures are generated locally with Canvas and installed Pillow, rather than supplied guest images.

Outputs in `artifacts/visual/guest-keepsake` include all six v3 layout/theme Fill/Fit pairs, three legacy geometry controls, mobile390×844/desktop1440×1000 screenshots, and a machine-readable checks.json with hashes. These are synthetic diagnostic markers, not a wedding design mockup. Browser screenshots are not native iOS screenshots.

Chromium passing does not establish Safari/iOS download behavior, available-memory limits, phone photo-library handling, native bridge parity, or production deployment. Test those separately on real owner devices before launch. Guest-generated variants are new browser compositions; the untouched booth JPEG remains available.

For the separate, drink-free fictional-adult Coastal square showcase:

```sh
node --import tsx tools/guest-keepsake/clean-showcase.mjs
```

This creates only `artifacts/visual/guest-keepsake-clean`, leaving all marker acceptance evidence unchanged. `showcase-checks.json` records exact input/output/source hashes. Four mobile/desktop Fill/Fit screenshots and two actual guest-client JPEG downloads are provided. The selected studio fixtures were visually inspected: fictional adult pairs, no drinks, watermark or diagnostic overlays. This is a presentation check, separate from the stronger asymmetric-marker correctness checks.
