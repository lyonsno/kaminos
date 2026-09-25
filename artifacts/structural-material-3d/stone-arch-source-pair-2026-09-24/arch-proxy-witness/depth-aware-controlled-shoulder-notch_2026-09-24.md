# Same-Source Depth-Aware Arch Assay

## Question

This is an extension test, not a replay of the already working interaction shell. It asks whether the continuous arch's load path and fracture response remain geometry-conditioned after replacing uniform extrusion with depth measured from the selected TRELLIS mesh, and after re-solving the same static load following each connectivity change.

The tested object relationship is: one authored arch GLB -> projected occupancy plus per-cell surface depth -> a bounded three-layer structural reconstruction -> matched crown force -> progressive bond failure and a new static solve on the surviving graph. The authored GLB remains a visual source, not a rendered deformation consumer in this experiment.

## Result

The source is the intact arch GLB, SHA-256 `c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5`. Intact and notched cases are derived from that exact file. The notch removes the same six 48x36 profile cells at the upper-left shoulder: `1301, 1302, 1303, 1350, 1351, 1399`. The cut is connected to the exterior and the initial graph remains connected.

Triangle barycentric sampling yields depth for all 716 occupied projection cells. The mesh has 155,628 boundary edges and is not watertight. Measured per-cell depth-span quantiles are 0.205, 0.271, 0.308, and 0.311 source units at p10/p50/p90/p95. Cell 1374 has a zero-width sample; the graph explicitly expands only that interval to the union of its measured Z point and the separate median lower/upper surfaces of valid 8-neighbors. Its inferred interval stays inside global source Z bounds, and its index is recorded. Three graph layers fill the measured envelope. This is a depth-informed structural proxy, not source-truth interior geometry.

The same contact `(21, 31)`, crown request `(-0.05, 0.29)`, normalized force ladder, pins, graph law, and fracture threshold are used for intact/notched and uniform/depth-envelope comparisons. Outcomes from the depth-envelope cases:

| Crown force | Intact | Controlled shoulder notch | Reading |
| ---: | --- | --- | --- |
| 0.25 | Stable, 0 breaks | Stable, 0 breaks | Both remain below damage onset. |
| 0.50 | Stable, 0 breaks | Stable, 0 breaks | Both remain below damage onset. |
| 0.75 | 24 broken bonds over 2 solves, then `load-path-separated` | 24 broken bonds over 2 solves, then `load-path-separated` | This cut does not shift onset or the terminal support-path result at this force. The solver stops before another unsupported static solve. |
| 2.00 | 333 broken bonds; 0 cracks in the shoulder comparison zone | 343 broken bonds; 5 cracks in the shoulder comparison zone over 2 solves | The notch changes the high-load damage distribution and localizes additional threshold events near the cut. Both cases ultimately lose their static support path. |

The uniform-extrusion control also produces 9 shoulder-zone crack events for the notched case versus 0 intact at force 2.0, with 258 versus 255 total broken bonds. Thus the clearest stable discriminator in this ladder is high-load crack localization, present in both depth representations; the depth-envelope graph changes the count contrast from 3 to 10 broken bonds. It does not change the `0.75` outcome. These normalized graph outcomes are evidence of geometry-conditioned behavior in this expressive model; they are not calibrated stone predictions.

Successful solve residuals are below `1e-6`; pinned-node displacement remains exactly zero. Each damage epoch removes only over-threshold live bonds. Later epochs resolve the same force using the updated live graph and fixed reference geometry. This is linear quasistatic re-equilibration, not inertial motion, residual-set deformation, plasticity, or a sequential physical loading history. A loaded component without a path to a pin is a terminal state, not solver failure and not a fabricated equilibrium.

## Route And Replay

Requested/effective route: local Node.js CPU / shear-regularized linear spring PCG, Node `v25.9.0`, no GPU route or fallback. Per-solve timings and residuals, route/source identity, implementation hashes, all 16 load runs, local strain/crack summaries, and terminal component states are in [`depth-aware-controlled-shoulder-notch_2026-09-24.json`](depth-aware-controlled-shoulder-notch_2026-09-24.json).

Replay from the Kaminos worktree:

```sh
node structural-material-arch-depth-assay.mjs \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/depth-aware-controlled-shoulder-notch_2026-09-24.json

node --test \
  tests/structural-material-arch-profile-contracts.mjs \
  tests/structural-material-arch-depth-profile-contracts.mjs \
  tests/structural-material-arch-depth-state-contracts.mjs \
  tests/structural-material-arch-static-support-contracts.mjs \
  tests/structural-material-arch-controlled-notch-contracts.mjs \
  tests/structural-material-arch-depth-assay-cli-contracts.mjs \
  tests/structural-material-arch-depth-assay-contracts.mjs
```

The successful targeted test run passed 7/7 in 5.48 seconds. The end-to-end assay contract replays the 16 cases in about 5.46 seconds under `node --test`; this is a local CPU wall-clock observation, not a performance claim.

## Rejected First Cut And Limits

The first exploratory mask landed at the left springing near the support rather than the upper shoulder. It removed only a few boundary cells, and its first adjudicator counted any tiny travel delta as a positive response. Its raw report is preserved as [`depth-aware-springing-notch-exploratory_2026-09-24.json`](depth-aware-springing-notch-exploratory_2026-09-24.json), but it is not used for the result above. A subsequent span-only fallback was rejected when a source-bounds contract showed that its inferred Z interval escaped the GLB bounds; the final fallback independently interpolates lower and upper Z surfaces from neighbors and retains the measured point. The later mask is pinned by an exact cell-list test and the response predicate ignores sub-2% travel changes unless fracture count, local crack count, or terminal state also changes.

The GLB is open. The measured Z envelope cannot tell whether space between projected surfaces is solid stone, a cavity, or mesh reconstruction noise. Uniform and envelope graphs have uncalibrated per-bond stiffness and normalized force; observed differences therefore select a promising representation, not a constitutive law. The high-force terminal separation is the point at which this massless static solver correctly has no pinned equilibrium. Detached motion, rendered mesh separation, GPU-resident execution, material-derived sound playback, and authored Bind semantics are not tested here.

## Next Slice

The evidence supports taking this exact CPU graph as an oracle into the existing resident WebGPU architecture, while keeping the envelope reconstruction explicit and checking CPU/GPU node, strain, event, and connectivity parity. The next consumer gate should then render accepted structural state against the authored arch so the visible object, not just the graph summary, shows the same causal shoulder damage. Do not add detached motion, sound, or engineering-exact claims to that migration slice.
