# Matched arch force in a structural volume

The operator asked to see the later 2D cross-section experiment in 3D, not the older authored-history GLB comparison. This route consumes the same intact and outer-notch TRELLIS-derived profiles, the same three-layer spring graph, and the same fresh force solve and Bind operation as `structural-material-arch.html`. It renders each structural node as a depth cell, with color from incident bond strain and front/back crack lines from broken bonds. The cells are a structural-volume visualization, not the TRELLIS GLB mesh or a general stone fracture surface.

Route: `http://127.0.0.1:8423/structural-material-arch-volume.html?force=2&load=1`

Source branch at implementation start: `cc/burning-demon-asset-adapter-luna-0923`, `973a5c996a3c16b216bbfecaf38953e9ec919f60`. The screenshot capture preceded only a visual-material reuse fix; there was no solver or geometry change after capture. `desktop-load-2.png` and `mobile-load-2.png` were visually inspected: both arches and controls are visible, the right arch has a broken shoulder, and depth is apparent on orbit. This is not evidence of a realistic fractured mesh.

At load 2.00, browser witness `window.__archVolumeWitness()` reported:

| Case | Nodes | Broken bonds | Components | Travel | Source SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Intact | 2148 | 87 | 1 | 0.034813037313672864 | `c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5` |
| Outer notch | 2052 | 198 | 2 | 0.041236108548060986 | `8072e0226b19283ec26919ddf6da02ea71036423479ad7336272eaf427ccf594` |

These counts and travel values match the 2D route at the same load. Clicking Bind returned both cases to zero broken bonds and one component, with connectivity epoch 2 and unchanged travel. Orbit drag changed camera position; Bind did not change it. Bind repairs graph adjacency but does not re-solve or erase the current displacement. The renderer is WebGL; the structural solve is CPU-side. No GPU-resident structural simulation or GLB deformation is claimed.

Focused commands: `node tests/structural-material-arch-volume-view-contracts.mjs`, `node tests/structural-material-arch-contracts.mjs`, and `node tests/structural-material-arch-profile-contracts.mjs` all passed. Browser evidence came from isolated Chrome for Testing headless with WebGL enabled and CDP, not installed GUI Chrome. A prior `--disable-gpu` run failed to create a WebGL context and was stopped; the successful run used an independent CFT process and was stopped after capture. Pixel inspection of the final frames found nonblank structural content (desktop stage ROI 2416/15664 bright samples; mobile 606/2944). The exact CDP one-off invocation was not retained as a reusable command; the page witness and committed screenshots are the replay surfaces.

Next: have the operator orbit and compare this directly to the 2D cross-section. If the structural response reads correctly, map the same node displacement and bond liveness onto the actual TRELLIS surface, then test whether missing interior/contact authority changes the visual conclusion. Do not mistake this cell volume for that consumer closure.
