# Social grid default and preview-matching captures

The owner selected **Social grid first**, with photos **cropped to fill squares**. A fresh session now opens the keepsake editor with Social grid selected, top-aligned Fill frames (x0/y-1/zoom1), and Photo strip second. Full photo remains available. Existing saved recipes reopen unchanged; inherited retake layout/theme choices remain intact. Untouched camera originals are retained independently of the selected composite crop.

New front-camera captures now use the existing Expo Camera `mirror` prop. The native photo connection already restricts mirroring to the front camera; its orientation selection and full-photo JPEG byte-preservation path are unchanged. Rear QR scanning is unchanged. There is no added JavaScript image flip, negative-scale review transform, EXIF rewrite or recompression. Photos export passes the committed file URI to the native library; template/filter rendering consumes its orientation once. Existing saved images and exports are never retroactively flipped.

This matches left/right appearance, not necessarily framing: the full original may retain edges outside the aspect-fill live preview.

## Validation and limits

Local tests check fresh grid/fill defaults, selector order, older recipe preservation, capture/view flag wiring and the pinned native front-only mirroring path. Native XCTest adds independent asymmetric pixel checks for all eight EXIF orientations and mirrored template inputs, retaining the existing nineteen test identities and twenty-eight named JPEG outputs. Native execution and results must be recorded for the exact published commit; source checks alone are not proof.

The browser evidence is actual first-open editor JSX with synthetic adapters in both orientations. It cannot prove AVFoundation camera behavior or actual Apple Photos display. No new photography, SMS, backend settings, credentials or window behavior is part of this change.

After installing the tested build, an owner-attended asymmetric card check remains: compare front preview, review, Apple Photos and a downloaded original/keepsake in portrait and both landscape directions. Confirm the same left/right arrangement (text is intentionally mirrored with the front preview), no extra flip after applying a look/template, and unchanged older images. Do not automatically capture or inspect private library contents without approval.
