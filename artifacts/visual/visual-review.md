# Visual inspection of actual browser captures

The reviewer opened every PNG with the image viewing tool after both browser runs: phone, tablet and desktop full pages and viewport crops, plus the revoked and missing gallery pages. The final run captures the backend owner's typography correction. These are actual Chromium renderings of the local Worker, with original synthetic sample illustrations uploaded through the real API.

- Desktop: restrained ivory background, generous serif heading, three aligned photo mats, terracotta download controls, and a clear privacy footer. No clipped imagery, overlapping content, or horizontal overflow was visible.
- Tablet: the grid becomes two columns with the third card on a second row. Photo proportions, caption alignment, button spacing, and margins remain consistent.
- Phone: single-column cards preserve the full image and full-width download target. The first image continues beyond the initial viewport; the original-photo control is directly below that image in the full-page capture. The narrow viewport does not crop the image or control horizontally.
- Unavailable states: the real HTTP 410 revoked page and HTTP 404 missing page use the same typography and paper palette, with readable next-step guidance and no photo/download controls.
- Iteration completed: the first phone capture orphaned the final word “up.” in the introductory sentence. The backend owner shortened that sentence to “The laughter, the joy, the happy tears.” and added pretty text wrapping. The final phone capture was reopened and inspected: both introductory sentences now occupy one balanced line each at 390 px, with no orphan. The final desktop and tablet captures preserve the same hierarchy and spacing.

The sample illustrations are visibly labeled “SAMPLE SCENE · SYNTHETIC ILLUSTRATION.” They are test fixtures, not guest photographs. The composition of the real guest photography, native iPad UI, native animations, Safari, camera permission screens, and physical-device behavior cannot be judged from these browser captures.

Automated semantics, visible keyboard focus, minimum target size, completed entrance animations, and reduced-motion behavior are checked by the harness. This is targeted coverage rather than a complete assistive-technology audit.
