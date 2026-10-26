# Keepsake composition reference research

Research-only note for the four-photo exports. The coordinator, who inspected the supplied “Four Cuts Booth” reference image, reports that it shows a tight 2×2 collage and a classic four-frame stack. I have not seen that image myself; the supplied Library asset was not materialized locally. The recommendations below combine that reported target with the native renderer's source and the written brief. The current UI preview screenshots were viewed only to confirm the existing blank-space symptom; they are not export references or approval evidence.

## Directly verified in the project

`PhotoTemplateEngine.window` places four 1080×810 (4:3 landscape) photo windows in both layouts. The grid canvas is 2400×2100 (8:7); the strip is 1200×3600 (1:3). A portrait source in a landscape 4:3 window with default `fit` keeps the full image but leaves large side bands. That is the cause of the portrait “islands” and broad blank gaps. Filling those windows would crop and cannot be a default under the current no-silent-crop requirement. The renderer adds the names/date below the windows; available footer space is already reserved by the fixed canvas.

## Composition direction for a four-photo social export

- Keep a deliberate 2×2 arrangement. Use one export canvas in a common feed-post shape (square or portrait 4:5); confirm current platform limits against an accessible official source before calling a specific ratio an Instagram requirement. The 2×2 should read as one keepsake, not four feed tiles or a masonry collage.
- Let the four windows occupy most of the canvas. Choose a consistent window shape from the four EXIF-oriented source aspect ratios when the recipe is created, then keep it fixed across theme changes and swaps. A 4:5 window is a useful portrait-source starting point; a 4:3 window suits landscape sources. Preserve each full source by default, and expose fill/crop only as a visible per-photo choice.
- Use a quiet, even outer margin and narrow, consistent gutters. Keep the outer frame slightly larger than the internal gutters so the photos feel mounted together. Reserve a compact bottom band for identity; do not let the footer force the photo windows back to a wide landscape shape.
- Footer hierarchy: names first, date second in smaller, spaced text, then one restrained theme detail. Keep all three outside the image windows. At thumbnail size, the couple's names should remain the clear first read.
- For a mixed set, use the median oriented aspect ratio as the stable window shape, then default each photo to `fit`. This avoids one outlier controlling the whole composition while preserving every source. Show the fit bars where needed; never auto-crop faces or edges to make a uniform collage.

These are composition recommendations, not confirmed platform specifications or a visual signoff. Exact dimensions, margin/gutter sizes and footer height need a clean four-source proof and a current official platform check.

## Composition direction for a physical-style strip

- Retain a tall, narrow 1:3 strip silhouette if it is meant to resemble a common 2×6-inch photobooth print. The present 1200×3600 canvas has that ratio. This physical-format comparison is a geometry observation, not a claim that a current printer specification or reference photo was checked.
- Keep all four frames in one vertical column, in capture order, with clear separators and a visibly continuous paper edge. Use small, even side margins, compact gutters, and a bottom signature area after frame four. The names should lead; the date can sit underneath. Keep theme decoration in the paper margins/footer, never over photos.
- The present 4:3 windows make the strip look like four short landscape cards, which underuses a 1:3 silhouette for portrait captures. For portrait-source sets, use portrait windows (start around 4:5) and reserve enough vertical area for four legible frames plus signature. That will make the whole print much taller than 1:3. If 1:3 is fixed, state the tradeoff in the preview and retain `fit`; do not hide it through silent fill.
- For landscape-source sets, 4:3 windows suit the images and preserve the compact 1:3 strip. For mixed sets, select the median oriented source ratio for all four frames and fit the outliers. Keep the choice stable for the saved recipe; changing source order must not change geometry.

## Reference access and next evidence

Two public GitHub visual examples were downloaded only into ignored `.cache/luna-keepsake-reference/` and inspected locally; neither is copied into product assets or this research note.

| Source | What I inspected | Composition lessons and limits |
|---|---|---|
| [Yeti Photobooth README preview](https://github.com/Web-Nepal/yeti-photobooth) · image URL: `https://raw.githubusercontent.com/Web-Nepal/yeti-photobooth/main/public/preview.png` | README-linked 4644×2610 product screenshot. It presents the editor plus two-photo strip preview and a decorated template picker. | The strip is centered as a distinct narrow object and the preview gives it room against the UI. The heavy illustrated border and picker artwork dominate; it is not a neutral four-photo export, and I do not recommend copying its art. |
| [Photobooth App golden 2×6 output](https://github.com/blueboxdev01/photobooth-app/blob/main/tests/Photobooth.Imaging.Tests/golden/classic-2x6.png) · raw image: `https://raw.githubusercontent.com/blueboxdev01/photobooth-app/main/tests/Photobooth.Imaging.Tests/golden/classic-2x6.png` | Actual 600×1800 raster at `tests/Photobooth.Imaging.Tests/golden/classic-2x6.png`; the repo README calls this 2×6 and lists output as 600×1800 at 300 DPI. | The single column uses repeated frame widths and consistent white separators/side margins, so the 1:3 strip reads immediately. This golden has **three** image windows, not four; its large “PHOTOBOOTH / replace me” footer consumes substantial area and is test placeholder content, not a target footer hierarchy. Do not copy it. |

The specifically suggested `https://github.com/photobooth-app/photobooth` repository returned GitHub 404. These two reachable sources give bounded spacing context, but no inspected example matches the requested four-photo social grid or a four-frame strip. The official Instagram Help URL attempt was blocked by network policy with HTTP 403, so current feed ratio guidance remains unverified. A future visual review should use accessible official posting guidance plus a licensed public four-photo example, record its source URL, and inspect the actual image. Exact ratio and spacing values above remain design hypotheses grounded in renderer geometry, not sourced standards.
