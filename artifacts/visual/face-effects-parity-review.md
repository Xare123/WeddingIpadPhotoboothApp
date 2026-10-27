# Post-capture treatment parity and recovery review

Scope: independent read-only source review plus 23 actual-Root UI groups through explicit browser SDK ports. This is not native face-engine or physical-iPad verification.

| Boundary | Inspected behavior | Limit |
| --- | --- | --- |
| Preview and Apply | The treatment controller acknowledges one full-resolution cache URI and output hash. Apply copies that URI; it does not render again or substitute a second same-recipe cache. Existing committed variants reopen through their durable URI. | Browser proof uses original/colour-only JPEGs. |
| Durable selection | New treatment input names the untouched root original and source/output hashes. The repository verifies copied bytes and admission, journals a non-auto-selecting claim, then commits selection separately. | Real files/SQLite tests run in a separate lane; these UI ports are in memory. |
| Photos | The existing exporter receives the selected canonical file URI. It does not regenerate effects; uncertainty markers still precede non-idempotent Photos writes. | Browser MediaLibrary calls are mocked. |
| Publication and downloads | Selected derivative IDs feed primary uploads and the keepsake; sourcePhotoId preserves untouched root IDs for original downloads. The server serves private stored bytes by acknowledged gallery role, without a face renderer. | No live R2 upload, download or SMS request was performed here. |
| Recovery | Treatment claims reserve their IDs and carry selectionEligible=false. Recovery can preserve staged bytes without silently selecting them. Source/output hashes reject mismatched bytes. Existing valid completed queue rows retain their acknowledged state. | Native process death and iPad reboot remain untested. |

The independent audit identified a legacy .draft.jpg root-path compatibility defect. The persistence owner reproduced it with real files/SQLite and changed same-root-ID JPEG/draft lookup to require the exact recorded source hash, preserving the root path and bytes. Confirm the final production persistence suite separately; this review does not claim it executed those tests.

UI fault coverage includes explicit None, no-face/unsafe-placement fallback, safe processing errors, serial rapid selection/cancellation, exact cache-copy parity, copy failure, JPEG presentation acknowledgement, stale SDK callbacks, revoked background admission, keyboard activation, reduced/normal motion and Next guests reset. No successful accessory pixels or face counts were invented. Native Swift files are fingerprinted for candidate identity only, and were not executed by this browser run.

App SHA256: f5a946ed75a3b3c7961947469ea0085bebd4bcbce9757a1ce92aef81c08c0285
