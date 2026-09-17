# Volume Assay Viewport Cockpit

Question: Can the selective-head live assay controls live only inside the Volume flame viewport, remain clear of both control panels, disappear on other tabs, and honestly display the requested renderer composition?

Result: Yes. The candidate activates Volume before asynchronous renderer/environment startup, places a compact assay panel wholly inside `#viewport`, hides it on every non-Volume tab, and restores it when Volume returns. It also subtracts the responsive authored-mix overlay from the available flame viewport and hides with the explicit reason `insufficient-volume-viewport-space` when no honest placement remains. A first narrow witness exposed a menu-only mismatch where the route requested `smoke-raymarch-under-splats-v0` but the new selector displayed `Splat only`; the final live images show `Smoke hybrid` after that defect was fixed.

Route:
- repo: Kaminos
- source tree: Kaminos feature worktree
- publication: reviewed feature-branch artifact; no main-branch authority
- source base head: `4918a09a4ae24f19550ac256da3632fbd7fc4c2f`
- requested route: `http://127.0.0.1:18781/volume-settings-preset.html?preset=vsp-902ef7efc65170f032f01f9dfff7b8c776b64a01e6c80caf2c4ec97004b461e7&view=smoke-hybrid`
- effective wrapper: `exact-basin-selective-head-live-v0`
- settings authority: `shared-volume-settings-preset-v2`
- renderer composition: `smoke-raymarch-under-splats-v0`
- backend/device: WebGPU / Apple
- desktop browser viewport: `1440x900`; captured flame view `1440x813`
- responsive contract viewport: `700x900`
- timestamp: `2026-07-17T18:15:51Z`

Images:
- `desktop_candidate_fix.png`: inspected live flame at desktop width; compact panel is inside the flame viewport and the renderer menu says `Smoke hybrid`.
- `narrow_observed_menu_mismatch.png`: retained fail-first visual evidence; containment worked, but the renderer menu incorrectly displayed `Splat only`.
- `narrow_candidate_fix.png`: inspected narrow live flame after selector initialization was fixed; the menu now says `Smoke hybrid` and the panel remains between the left and right control surfaces.
- `live-volume.png`: final inspected exact-basin frame with both control surfaces visible and the compact assay panel contained in the flame viewport.
- `live-cockpit.png`: final inspected expanded authored-mix state; neither left nor right controls are covered.
- `live-cockpit-collapsed.png`: final inspected collapsed authored-mix state; the assay panel reflows inside the enlarged flame viewport.
- `live-witness.json`: effective route, preset authority, placement geometry, every non-Volume tab result, responsive exclusion, and motion deltas.

Dynamic witness: at desktop scale, the placement receipt reported toolbar `656x98.14` inside flame viewport `672x757`. Assets, Forge, Motion, Worlds, Host, Juice, Greenroom, Pipeline, Search, and Generate each produced their own effective tab identity with `toolbarHidden: true`, `visible: false`, and reason `non-volume-tab`. At `700x900`, the authored-mix overlay left only 20 pixels of flame viewport width; the cockpit failed closed with `visible: false`, `fallbackApplied: false`, and reason `insufficient-volume-viewport-space`. Returning to Volume at desktop scale restored visible, contained placement. The live simulation advanced 125 frames and 125 simulation steps during the witness.

Does not prove: physical coherence of the smoke/splat composition, visual parity between raymarch and splat paths, or general mobile usability of the native viewer. This evidence is only for Volume-only admission, control-state honesty, viewport containment, responsive non-overlap, and operator accessibility.
