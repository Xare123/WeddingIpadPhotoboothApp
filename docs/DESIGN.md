# Wedding design direction

The coordinating task inspected `gizelleandrami.com` read-only and supplied its observed visual language: warm editorial cream, espresso text, terracotta, seaglass and restrained gold; large serif headings with spaced uppercase interface labels. That is inspiration rather than a copy of the wedding site. No private portraits, brand files or third-party booth assets were imported.

| Role | Color |
| --- | --- |
| Background ivory | `#F6EFE4` |
| Paper / photo mat | `#FBF6EC` |
| Main espresso text | `#3B342B` |
| Secondary ink | `#4A4236` |
| Strong terracotta action | `#9A4F32` |
| Seaglass accent | `#3E6760` |
| Fine gold details | `#B8964F` |

Native headings use Georgia with system interface text; guest HTML uses the same offline/system font approach instead of downloading typefaces. Buttons have large touch targets, clear action labels, comfortable spacing and photo-first composition. The iPad adapts to portrait and landscape. Guest galleries use responsive photo mats and original-resolution downloads, with no competing event gallery or marketing navigation.

Countdown, preview and ready states use short opacity/scale/translate transitions. Animations do not lock actions or wait for a decorative intro; interruptions invalidate stale countdowns. System Reduce Motion disables decorative motion. The gallery honors `prefers-reduced-motion`.

Actual gallery browser captures and inspection notes are in `artifacts/visual/`. Any iPad screenshots produced by the isolated browser fixture render the real native JSX with device stubs and are labeled as browser visual review, not an iOS simulator or physical device. They do not validate the real camera, Keychain, native font metrics, safe areas or iPad animation performance. Those remain part of the Mac/iPad rehearsal.
