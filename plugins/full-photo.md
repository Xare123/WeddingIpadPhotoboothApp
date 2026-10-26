# Opt-in camera-file preservation

`with-full-photo.cjs` changes only the iOS implementation of `expo-camera@58.0.12`. Expo's default processing behavior stays intact unless a call opts in. This is a bounded compatibility patch, not an upstream Expo API.

Add `"../../plugins/with-full-photo.cjs"` to `expo.plugins` in `apps/ipad/app.json`. The iOS dangerous mod runs during prebuild. After clean dependency installation and before a native build, an explicit equivalent is `node plugins/with-full-photo.cjs` from repository root. It patches installed native dependency sources, never the fixture. Reinstall dependencies to restore official source. Rebuild the native application after any change; an OTA update cannot add this capability.

## JavaScript contract

Read `requireNativeModule('ExpoCamera').preserveFullPhotoAvailable === true` from `expo`. Only request `{ preserveFullPhoto: true }` when supported, using a local TypeScript intersection since upstream types do not contain this custom field. The result adds `originalPreserved: true` **only** after the camera-delivered JPEG bytes have been successfully saved unchanged. Undefined capability, false capability, or absent result marker means preservation has not been established. Expo Go and simulator fixture outputs must not receive a preservation claim. Always save a returned exposure even when the marker is absent, with honest fallback status; do not discard a photo to enforce the claim.

The opt-in selects `AVVideoCodecType.jpeg` before exposure. It preserves `AVCapturePhoto.fileDataRepresentation()` directly in cache with `.jpg`, without UIImage decoding, center crop, orientation flattening, or JPEG re-encoding. `uri`, `width`, `height`, `format: 'jpg'` are provided, plus optional base64 and EXIF metadata. Width/height describe the encoded image's pixel axes. The JPEG's original EXIF orientation remains in its bytes. EXIF response includes Orientation and PixelXDimension/PixelYDimension; `additionalExif`, compression `quality`, and requested `imageType` do not modify the original in this path. `pictureRef` and unavailable JPEG codec fail before capture. Existing onPictureSaved/fastMode behavior is retained. Default capture settings still use `.balanced` prioritization; no RAW or hardware maximum resolution claim is made.

Stock mirror/orientation behavior is retained: capture uses the selected capture orientation and mirror prop. Preview has independent native rotation/mirroring defaults. Aspect-fill preview can hide edges that the saved original retains. Do not label it exact framing; show uncropped review with contain and disclose that the saved photo may include more around edges.

## Integrity contract and provenance

The plugin validates package version, SHA256 of every original native file, unique replacement anchors, and literal expected SHA256 of every transformed output before its first write. Repeated application accepts only the exact reviewed transformed output. Version changes, unknown drift, and partially tampered outputs fail closed. It preserves native source copyright/license text.

`test/fixtures/expo-camera-58.0.12` contains verbatim official native source and its MIT LICENSE, copyright Expo/650 Industries, copied from the installed package and verified byte-identical to `https://registry.npmjs.org/expo-camera/-/expo-camera-58.0.12.tgz`. Its package.json is a minimal test manifest, not a dependency. Upstream source: https://github.com/expo/expo/tree/sdk-58/packages/expo-camera . The three pinned full-file hashes live in the plugin. Source fixture is only for deterministic compatibility/negative tests; production patching reads the actual resolved installed package.

Run `node --test plugins/test/full-photo.test.cjs`. Tests exercise the official source hashes, actual installed dependency, deterministic/idempotent patching, unmodified stock processing tail, direct byte-write branch, JPEG selection, optional base64/callback behavior, and version/anchor/source tampering without partial writes. These tests establish source transformation contracts, not Swift compilation or physical camera behavior.

## Release gates

Compile a native iPad build with Xcode26/iOS26 SDK. Test actual iPads and every supported orientation/window size with edge/text targets. Verify actual JPEG type, dimensions, EXIF orientation and front parity, no loss of captured edges, and identical original file hash across copy/upload/export. Test default captures and opted-in captures separately, and confirm an unsupported native binary returns no preservation claim. Simulator images and browser screenshots cannot establish capture preservation. Device quality/output resolution and preview-to-photo parity remain explicit device gates.
