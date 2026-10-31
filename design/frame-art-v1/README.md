# Generated wedding frame artwork — v1

These three original, text-free images were generated for this wedding project and delivered as synthetic design previews on October 28, 2026. That delivery did not modify the app. The subsequent v3 template implementation integrates their actual bytes, rather than the synthetic concept boards.

| Theme | Library source | Git blob |
|---|---|---|
| Classic Ivory | `libfile_75112871a7388191b3c3cbbec6c24824` | `c88191dfcfa8ce37f839626994230e07ae31b84e` |
| Sage Botanical | `libfile_ecfdebc27af88191903cd1c37d84cd9a` | `96988b1ffbf736d9455bf156723a1b3cbcc91e13` |
| Coastal Sea Glass | `libfile_2306563eada08191af694af193e46c8f` | `d7e54fe3646be16f94ca0102f00f869b4289d191` |

Handoff commit: `7d34f52cd073e745160833ca993e94e45f69964b`, parent `86a4b9109d8ed6d348eb1504b566cbba55154d86`. Each file is an opaque 1254 × 1254 RGB PNG, with no photographs, names or photo cutouts. They were opened and visually inspected in the integration executor. No vendor artwork or private guest photo is included. Generated artwork is governed by the applicable generation-service terms; no public-domain designation is claimed.

Production copies live in `apps/ipad/modules/wedding-photo-effects/ios/FrameArt` with a `.frameart` extension (unaltered PNG bytes, avoiding Xcode PNG recompression) and are bundled by CocoaPods into `WeddingFrameArt.bundle`. The native engine validates exact SHA-256 bytes and dimensions before rendering. Missing or altered artwork produces a visible render failure, never a silent legacy-frame fallback.

V3 uses nine-slice composition: source corner squares are 250 × 250 pixels; destination corners are 250 × 250 for strips and 350 × 350 for grids. Corners scale uniformly; the quiet center and edge bands adapt to the canvas. Photos, crisp outline and text are composed separately. No complete square image is stretched into a strip. V1/v2 geometry and designs remain unchanged.
