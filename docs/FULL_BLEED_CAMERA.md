# Full-bleed capture and native materials

The camera now occupies the complete app viewport in portrait and landscape, including the space behind safe areas. There is no permanent camera header, footer, inset card or rounded camera stage. Only the floating controls receive safe-area offsets. The filmstrip appears after a shot is durably saved; countdowns retain the existing five-independent-originals/individual-retake model.

One control island uses `expo-glass-effect@58.0.5`, the version bundled with Expo SDK 58. Native glass requires iOS/iPadOS 26+, both `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()`, and accessible settings that permit it. Unsupported or unknown availability uses a dense opaque surface. The actual iPadOS version is unknown. `react-native-safe-area-context@5.10.1` supplies native control insets.

Reduce Transparency, increased contrast and Reduce Motion are queried and subscribed to. On iOS, increased contrast uses `isDarkerSystemColorsEnabled`/`darkerSystemColorsChanged`; the high-text-contrast API is Android-only. Failed reads start conservatively opaque. A stale initial query cannot override a newer preference event. Native glass and its ancestors are never faded or scaled; the camera branch keeps parent opacity at one. Reduced-motion countdowns remain at scale/opacity one, and native glass interactivity is disabled. Opaque fallback labels and principal actions have checked contrast and touch targets; native VoiceOver and system-material appearance still require device checks.

## Preview and saved originals

Aspect fill makes the preview cover the viewport; it does not widen the lens or stretch the camera image. The stock Expo Camera 58.0.12 iOS implementation also crops and re-encodes saved photos to preview shape. `skipProcessing` does not bypass that iOS implementation. Merely expanding the view would therefore change saved composition.

This project uses the explicit, version/hash-guarded [native preservation plugin](../plugins/full-photo.md). A supported native build opts into a JPEG camera-file path that keeps the camera-delivered bytes and EXIF orientation, without a viewport crop or another JPEG encoding. It is a project-specific compatibility patch, not a claimed upstream Expo feature. The default Expo behavior remains for calls that do not opt in. Every returned exposure still passes the independent durable-file/journal verification before saved counts, thumbnails or next capture. Review uses contain, and the UI discloses that the screen preview crops edges. Originals are never screenshots of the camera UI.

An unpatched binary or Expo Go cannot establish this capability. The app does not claim preservation from those environments. If a supporting binary unexpectedly returns no preservation acknowledgment, the app retains the captured file, warns about framing and reports the missing acknowledgment to the host. No RAW or hardware maximum-resolution claim is made. Front-preview parity and captured EXIF orientation use separate native connections; text/edge-group tests on the actual iPad are mandatory.

## Verification boundaries

Current browser evidence exercises the actual native JSX using explicit synthetic camera/storage/auth/material adapters. Eight geometry/accessibility cases check all four camera edges against the app viewport, portrait and landscape safe insets, and live preference changes. Native glass is never simulated as a passed iOS rendering test. The recordings retain the exact immediate thumbnail-selection/retake regression and use generated fictional adults only.

Native Swift compilation, genuine Release simulator runtime smoke, signing and physical iPad acceptance are reported separately in [validation](VALIDATION.md). The simulator smoke can establish embedded-JavaScript launch, relaunch and orientation; it cannot establish capture, Photos, native authentication, camera JPEG preservation or venue sharing. On the real iPad, photograph text and people/markers at every edge in both orientations, compare uncropped review and downloaded originals, verify the JPEG dimensions/EXIF and parity, and repeat offline saving/relaunch/Photos checks. Preserve the same app identifier/team and all existing originals.

## Design references

- [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) and [WWDC25 Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/): reserve materials for controls/navigation and use them sparingly.
- [Expo GlassEffect](https://docs.expo.dev/versions/latest/sdk/glass-effect/) and [Camera](https://docs.expo.dev/versions/latest/sdk/camera/); matching official SDK58 source was inspected through the Expo GitHub repository and registry packages.
- [React Native AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo) and the installed RN0.88 native source confirm the platform-specific preference APIs.
- [HALO participant tools](https://help.simplebooth.com/en/articles/2287700-participant-editing-tools) and [receiving pictures](https://help.simplebooth.com/en/articles/3116364-receiving-pictures-from-halo) inform a focused capture/review/retake/QR flow, without copied assets or feature-parity claims.

Direct requests to the documentation sites were denied by this executor's network policy. The coordinator supplied official-page findings; the executor additionally inspected official Expo/RN source. No network restriction was bypassed or runtime trust verification disabled.
