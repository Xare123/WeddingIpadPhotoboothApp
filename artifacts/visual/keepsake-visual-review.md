# Current four-photo keepsake visual evidence

Scope: actual current native JSX/controllers in a Chromium browser, with explicitly synthetic native SDK/storage/Photos/auth/publication ports and a Canvas renderer. These are not native-iPad screenshots or native Core Image/CoreText results.

App SHA256: 151488bb3fdbf6435a16855ba70bfbc2f7408cbef8cb30de040121ce81dc30e7

TemplateStudio SHA256: 2ce75e3831efeff05e6c841440ace23dfb34d220f09af30f0c80a418800113fc

## Actual local results

- Marker workflow: 2 orientations, all 192 edge assertions, 25 screenshots and two recordings. The no-wait thumbnail3/Retake actor remains unchanged.
- Clean fixture workflow: 4 source-set/orientation combinations, 12 full-size JPEGs, 40 screenshots. Four distinct generated portrait sources and a mixed portrait/landscape set are separate from markers.
- Image callback failures: 5 deliberate SDK-boundary error/retry/stale-callback cases, eight screenshots.
- Clean normal-motion demos: two workflows, two recordings, 18 screenshots and one optional top-Fill full-size strip.
- Current-source guest flow: two orientations, four-photo capture/countdown/progress/pause/retake, truthful local-save failure and same-exposure retry, host controls/library and background relock; 22 settled screenshots.
- Total: 13 full-size JPEGs, 113 app screenshots, 4 recordings, plus an externally labeled contact sheet. No external network calls beyond the explicitly mocked health route.

## Pixels personally inspected

The reviewer viewed all six clean portrait layout/theme exports through the full-image contact sheet, the mixed square Coastal export, current portrait/landscape template pages, full-resolution inspector views, the actual optional top-Fill strip and error states. Normal-motion recordings were inspected using 2 fps contact sheets, including opening/closing the inspector, theme/layout render transitions, offline handoff, simulated ready sharing and Next guests. Current attract/camera/progress/review/save-error/host frames were inspected in both orientations.

The social grid now fills a deliberate 4:5 page for portrait sources instead of placing portrait islands in wide landscape slots. Mixed sources use square 2×2 geometry. Gutters are compact; couple/date hierarchy is secondary to photographs. Classic Ivory uses fine editorial keylines, Sage Botanical uses original stems outside photographs, and Coastal Sea Glass uses original contours outside photographs. Default full-photo placement retains all edges. A long 1:3 strip therefore has side bands for portrait inputs; optional Fill crops only after the guest chooses it. New Fill starts at the top and can be adjusted. The previously center-cropped generated heads are intact in the top-aligned example.

A provisional helper mislabeled the selected Classic image as Coastal by reading the last sibling theme render. This was a harness bookkeeping error, not an established product stale-image failure. Final capture resolves each DOM image's exact native fixture URI to its completed render receipt and verifies actual JPEG bytes/hash plus selected recipe. Full inspector and main preview must have the same recipe, and displayed images must match their exact renderer receipts.

## Remaining checks

Actual native Core Image/CoreText outputs, real iPad camera/Photos saving, lighting/framing/mirroring, native Liquid Glass/OS accessibility, performance, lifecycle/reboot durability, installed signing profile, live private backend and real-phone QR scan need their respective native/device/production evidence. Browser-simulated acknowledgements do not establish live R2 or SMS readiness.

All photographs are generated fictional adults; provenance lives in apps/ipad/native-tests/fixtures/studio/provenance.json. Vendor references and real guest data are excluded.
