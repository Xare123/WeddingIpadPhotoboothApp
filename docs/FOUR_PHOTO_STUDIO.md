# Four-photo wedding studio

Version 0.3.0 / build 3 defaults to four independent camera originals. Existing five-photo sessions remain readable, recoverable and shareable. The app identifier and signing team must stay unchanged when updating an installation containing photos.

The guest flow is capture → review/individual retake → optional photo looks → Make it yours → save keepsake → private QR when ready → Next guests. The camera remains full bleed. Template choices are deliberately small: Photo strip or Four-cut grid, each with **Classic Ivory**, **Sage Botanical** and **Coastal Sea Glass**. Every theme thumbnail is an actual rendered preview using the current four photos. Strip + Classic Ivory + Full photo is the default and needs no adjustment.

## Images and editing

The local Apple Core Image module applies Original, Warm, B&W or Film after capture, with bounded strength. There is no live frame-processor claim. Every look starts from the untouched camera original and writes a separate JPEG; it never repeatedly filters an edited JPEG. A zero-strength/Original selection restores the original identity without re-encoding it. Original, selected derivative and composite are distinct retained assets.

Templates use four unique selected photos exactly once. Tap two photos to swap them; each photo's filter and crop travel with its ID. Full photo keeps every source edge. Fill frame is an explicit crop with bounded pan/zoom and a visible warning. The same versioned recipe, order, orientation normalization, sRGB pipeline and fixed geometry generate reduced previews and full-resolution JPEGs. A successfully rendered receipt and an actual image load are required before Save. Failed image loading invalidates the receipt and offers a fresh preview retry.

The strip is 1200×3600; the grid is 2400×2100. Core Image/CoreText draws original vector ornaments only in the footer, with Gizelle & Rami and November 1, 2026. No vendor assets, user reference screenshots, stickers, printing, face geometry changes or external photo processing are included. See [the local module contract](../apps/ipad/modules/wedding-photo-effects/README.md).

## Preservation and sharing

Camera originals, look derivatives and keepsakes are copied and verified in the app's private documents directory. Versioned journals preserve recipe, order, crop, source lineage and export status independently of SQLite. Staged/superseded files are retained. Changing a selected photo invalidates a mismatched keepsake; confirmation freezes its identity. Repairs preserve completed upload acknowledgements and never overwrite originals.

A new four-photo gallery requires the selected photos, their four corresponding untouched originals and the keepsake. Shared identities are uploaded once; a filtered session can require additional assets. All required uploads and the exact ordered server recipe acknowledgement must succeed before QR appears. A session-specific bearer link opens the keepsake and individual files; there is no public listing of every guest. Guest-link expiry closes access without deleting originals. The [API contract](API.md) documents legacy compatibility and immutable role/recipe checks.

Without Internet the app retains photos and the keepsake, shows No download link yet, and retries sharing later. It does not promise delivery to a departed guest whose contact details were never collected. SMS remains optional, explicit-consent-only and hidden until approved backend capability. Live provider eligibility/configuration and capped real test messages remain coordinator-controlled.

## Photos and host recovery

An optional add-only Photos copy is separate from the private original. A confirmed keepsake can also be exported to Photos. Uncertain results are never retried automatically; authenticated host controls let the owner check Photos, acknowledge an existing copy or explicitly accept duplicate risk. A staged keepsake has its own finish-save action and is excluded from sharing/Photos until verified. Host data relocks and redacts on inactive/background; foreground does not automatically restore the private library. See [saving repair](SAVING_REPAIR.md) and [recipient retention](RECIPIENT_RETENTION.md).

## Evidence boundaries

[Template browser evidence](../artifacts/visual/templates-evidence.md) and [look evidence](../artifacts/visual/looks-evidence.md) run actual JSX/controllers with explicit synthetic native boundaries and actual Canvas-produced JPEGs. Marker-labeled variants of an owned fictional scene test identity/order/edge preservation; they are not real exposures. Native Core Image color management, iPad camera/Photos, pairing, venue Wi-Fi and real QR scanning remain separate checks. Third-party reference images could not be materialized in this executor; the original design follows the supplied text requirements without claiming a reference-image comparison.

The Release simulator lane requires the actual native engine sources and 15 XCTest methods: 8 photo-effects tests, 6 template tests and 1 launch/relaunch/rotation smoke test. Compilation, execution and physical-device acceptance are reported separately in [validation](VALIDATION.md). The reviewed full-bleed five-photo fallback is commit `0dc4385217678f56e8b7ad2d38f9398fc7dcc31f`, which passed Linux, unsigned physical-SDK compilation and its separate Release launch smoke. It does not verify these later features.
