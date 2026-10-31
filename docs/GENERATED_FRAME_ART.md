# Generated frame artwork integration

The October 28 artwork delivery was a synthetic design preview, explicitly not an app update. Installed build16/source86a4b91 therefore still contained the older procedural designs. This change integrates the exact delivered Classic Ivory, Sage Botanical and Coastal Sea Glass PNGs into the shared native keepsake renderer.

## What changes

New sessions create `wedding-template-v3` recipes. Both strip (1200×3600) and exact-square four-cut (2400×2400) use the generated paper/background art, separate sharp photo windows, a fine outline, and the couple/date footer. Source corner artwork is scaled uniformly using nine-slice composition; a whole square is not stretched to a strip. Classic keeps the artwork’s own single border. Fit sidebands retain the original paper/watercolor rather than a flat rectangular mat. Photo order and explicit Full photo/Fill crop behavior are retained. Original camera files are never modified.

The native renderer produces both reduced preview and full export from one recipe. Saved composites then flow to review, explicit Photos export and the existing private upload queue. There is no CSS-only artwork substitution. Old v1/v2 recipes reopen with their original design/geometry, and existing saved JPEGs remain unchanged. To obtain the new design, create a new keepsake; old exports are not silently regenerated.

The three resource copies contain the exact supplied PNG bytes under `.frameart` filenames, avoiding Xcode PNG recompression. CocoaPods bundles them in `WeddingFrameArt.bundle`; the engine verifies byte hashes and dimensions. Missing/altered art fails visibly. No fallback can falsely acknowledge a v3 design.

## Native visual correction

Mac inspection of the first V3 native output confirmed cramped square-footer spacing. The revised square keeps four 1000 × 1000 windows with 32-pixel gutters and a dedicated footer below the last photo (bottom2192; name baseline2280; date baseline2330, clear of the bottom rule2360). Strip dimensions/windows and explicit crop choices stay unchanged. Legacy V1/V2 layout is unaffected. A flat fill across V3 windows was removed to preserve watercolor continuity in Full photo sidebands, and Classic no longer receives a redundant second outline. These changes require fresh native output review; a previous passing candidate is not proof for the revision.

## Evidence and gates

`artifacts/visual/frame-art-v3/` contains six clean synthetic Canvas comparison exports, matching preview exports, a contact sheet and source/output hashes. These are useful composition evidence, **not Apple-native output**. Native XCTest retains all nineteen existing case identities and sixteen legacy output requirements, and adds twelve v3 full/preview JPEGs (28 total) with exact artwork, original preservation and photo-content assertions.

Before installation: require successful native compilation, nineteen executed/passing native cases, all28 actual Apple JPEGs, and personal pixel review of all six v3 combinations. The updated backend must accept v3 before new keepsakes can publish: the existing backend rejects unknown recipe versions. The prepared Worker bundle changes recipe validation only; deployment and preservation of production bindings/settings are coordinator-owned. No backend configuration, credentials or live SMS are changed here.

This does not resolve or modify the intermittent iPad windowing regression. The local scene-orientation experiment remains disabled and excluded from this change.

## Owner device check after a passed-gate update

Preserve the existing app identity/data. Create a non-sensitive four-photo session, compare all three themes in strip and square, inspect Full photo and intentional Fill, save/relaunch, then check actual Photos/downloaded JPEG matches the selected design. Confirm older keepsakes remain readable and pairing/QR/SMS visibility preferences survive. Never publish owner photos as test artifacts.
