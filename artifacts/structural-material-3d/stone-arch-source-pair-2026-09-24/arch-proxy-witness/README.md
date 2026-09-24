# Projected Arch Structural Witness

## Decision

The TRELLIS assets are sufficient to ask the next question without pretending
their open meshes are solver-ready volumes: does the missing outer shoulder
change where a bounded structural proxy carries and releases a matched crown
load? This witness says yes at the level of an expressive projected-shape
grammar. The notch profile flexes more, starts cracking at a lower normalized
force, concentrates later cracks around that shoulder, and becomes two graph
components at high force while the intact proxy remains connected.

This is a structural proxy experiment, not imported-mesh destruction. Each GLB
is projected onto a shared 48 x 36 XY occupancy grid and extruded across three
depth layers. The same 3D graph builder, rest-length springs, loading point,
supports, solver, and fracture threshold serve both profiles. The SVG bench
draws that graph and its projected cells; it does not render or deform the GLB.

## Load And Damage

The equal-force contact resolves to grid cell `(21, 31)` in both profiles, at
requested `(x=-0.05, y=0.29)`. Forty-eight nodes per proxy are fixed along the
two lowest occupied foot rows. Each case starts from its own intact graph and
uses force in normalized proxy units, not newtons. The operator-selected force
does not include any hidden geometry-dependent scale factor.

| Force | Intact travel / breaks / components | Outer-notch travel / breaks / components | Reading |
| ---: | --- | --- | --- |
| 0.25 | 0.00435 / 0 / 1 | 0.00515 / 0 / 1 | Both flex without damage. |
| 0.50 | 0.00870 / 0 / 1 | 0.01031 / 3 / 1 | The notch proxy reaches the shared strain threshold first. |
| 0.75 | 0.01305 / 9 / 1 | 0.01546 / 21 / 1 | Six notched-profile crack events fall in the predefined upper-left shoulder window; none do in the intact profile. |
| 2.00 | 0.03481 / 87 / 1 | 0.04124 / 198 / 2 (`1389 + 663`) | Only the notched proxy loses graph connectivity. |

At every force, Bind reactivates exactly the failed graph edges, returns each
proxy to one component with no dead bonds, and preserves the solved nodal
displacements. The threshold is `0.04`. Crack and Bind event energy is
`(strain - threshold) * restLength * stiffness` for a crack and
`strain * restLength * stiffness` for Bind. This is a material-derived event
scalar in proxy units, not joules and not audible playback.

## Solver And Provenance

- Requested/effective route: local Node.js CPU / shear-regularized linear-spring
  preconditioned conjugate gradient (PCG); there is no GPU route or fallback.
- Current solver identity: `shear-regularized-linear-spring-pcg-v0`, with
  shear regularization `0.18`, bond stiffness divided by rest length, and a
  600-iteration budget. Observed convergence used 239 iterations for intact
  and 251 for notched; relative residuals were `8.8e-8` and `9.6e-8`.
- The most recent single CPU run recorded per-case solve times from `32.9` to
  `63.6 ms` for these roughly 2k-node graphs. The exact individual samples are
  in the report; they are not an isolated benchmark or a scaling/latency claim.
- Profile identity: the source GLB hashes, profile hashes, cell counts, exact
  contact, supports, and all per-force receipts are in
  [`paired-witness-report.json`](paired-witness-report.json).
- The browser harness source is [`structural-material-arch-browser-smoke.mjs`](../../../../structural-material-arch-browser-smoke.mjs).
  It drives the actual slider, Solve, and Bind controls; starts a clean
  headless Chrome profile with cache disabled; verifies the exact profile
  responses, route label, output metrics and mobile layout; and records DOM
  snapshots and PNG hashes in [`browser-smoke.json`](browser-smoke.json).
- Browser captures: `onset-desktop-chrome.png` is the actual-control `0.75`
  frame; `separation-desktop-chrome.png` is force `2`; `bind-desktop-chrome.png`
  is force `2` followed by a button-triggered Bind; `mobile-emulated-chrome.png`
  is a 390 x 844 device-emulated capture at force `0.50`. The browser version,
  effective route, profile HTTP 200s, 39 checks, and empty page exception/console
  error lists are recorded in `browser-smoke.json`.

Replay from this Kaminos worktree:

```sh
python3 serve.py 8423
node structural-material-arch-witness.mjs artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/paired-witness-report.json
node structural-material-arch-browser-smoke.mjs http://127.0.0.1:8423/structural-material-arch.html artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/browser-smoke.json '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The successful desktop frames were visually inspected at 1440 x 1100; paired
arches, markers, supports, metrics, crack colors, and Bind state are legible
without overlap. Device emulation keeps the complete first arch, slider,
readouts, and stacked notched arch within the viewport. The negative-route
exercise is preserved as `browser-smoke-wrong-route.json`: a request to
`http://127.0.0.1:8423/not-the-arch.html` exits 1 at `preflight`, records why,
and never falls back to another route. Chrome's process stderr still contains platform
`CVDisplayLinkCreateWithCGDisplay` errors and an allocator warning, despite
exit 0; page exception and console-error events were empty.

## Claim Ceiling

The notch survives the profile projection as a geometry difference and the
proxy responds to it under matched rules. But the two meshes were independently
reconstructed from separate TRELLIS runs and are not an exact mechanical
ablation: besides the intended notch, their raster occupancies differ (716 vs
684 cells) and their surface reconstructions are noisy. The result supports
geometry-conditioned behavior of this expressive proxy, not a calibrated
causal estimate for real stone.

Other limits matter for the next decision:

- The extracted occupancy is the XY projection of GLB triangles, not a solid
  interior, watertight tetrahedralization, or voxelized thickness estimate.
- The solver is a linearized spring network with an authored shear term; its
  strengths, stiffnesses, scale, and units are not calibrated to stone.
- All fracture events are thresholded from the intact linear solve. The graph
  updates connectivity, but it is not re-equilibrated after each break and the
  page does not physically separate/deform imported mesh pieces.
- This is a CPU architecture witness, not a performance or GPU-residency claim.
- Material-derived event energy exists in the ledger, but there is no acoustic
  playback in this slice.

## Next Cut

Keep this result as evidence that a compact graph can consume geometry-derived
shape and produce a force-dependent fracture route. The next discriminating
slice is not another solver family: compare the current silhouette extrusion
against a mesh-derived, through-depth voxel/beam proxy that preserves local
thickness and the real notch faces, then re-run the same contact/load ladder.
Require post-break re-equilibration before interpreting a detached chunk as a
mechanical consequence. If that proxy preserves the notch-localized split,
move the accepted representation to the existing resident GPU sidecar while
keeping the CPU version as a reference oracle. If the split disappears, fix
the representation before GPU migration.
