# Projected Arch Structural Witness

## Current Checkpoint: Distributed Crown Contact

The 2026-09-25 follow-up held the intact TRELLIS source fixed (SHA-256
`c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5`) and
compared its controlled shoulder notch under a point contact with a fixed
0.032-source-unit crown patch. The patch covers nine occupied XY cells and
loads 27 depth nodes; the same requested force is divided evenly among them.
Radius zero preserves the prior one-cell, three-node point load.

At normalized force `2.0`, the depth-envelope point-load cases both lose the
three-node crown component after two damage solves (333 intact / 343 notched
broken bonds). With the distributed patch, all 27 loaded nodes remain in one
pinned-supported component through three damage/re-solve epochs. The fourth
damage epoch produces broad fragmentation and disconnects the patch from its
supports in both cases. The notched case records 12 fracture events in the
predeclared shoulder comparison zone versus zero for intact, despite 1,233
total breaks versus 1,246 intact. This is a local crack-distribution signal,
not a different ultimate load-path result; neither normalized force is
calibrated to stone.

The assay records every newly failed bond, its rest-space midpoint, strain and
event energy, plus component sizes, pinned-node counts, loaded-node counts and
support status after each epoch. These records show that distributed contact
makes this arch proxy carry load through several connectivity updates before a
broad terminal separation. They do not show the authored GLB consuming that
state: the mesh remains visual input, and the three depth layers still fill an
inferred surface envelope rather than a source-truth solid interior.

**Disposition:** keep this as a useful CPU diagnostic; do not port this exact
graph to the resident GPU sidecar yet. The next object-level question is what
structural interior the arch asset represents. An open surface envelope does
not tell us whether it is continuous stone, separate voussoirs with joints, or
mesh reconstruction noise. The next CPU comparison should state those geometry
and connectivity hypotheses explicitly before GPU parity or visible mesh
deformation is treated as structural evidence.

Reports: [point-load baseline](point-load-enhanced_2026-09-25.json) and
[0.032-radius crown patch](contact-patch-r032_2026-09-25.json).

Replay from this Kaminos worktree:

```sh
node structural-material-arch-depth-assay.mjs \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/point-load-enhanced_2026-09-25.json 0

node structural-material-arch-depth-assay.mjs \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/contact-patch-r032_2026-09-25.json 0.032

node --test \
  tests/structural-material-arch-profile-contracts.mjs \
  tests/structural-material-arch-depth-profile-contracts.mjs \
  tests/structural-material-arch-depth-state-contracts.mjs \
  tests/structural-material-arch-static-support-contracts.mjs \
  tests/structural-material-arch-controlled-notch-contracts.mjs \
  tests/structural-material-arch-depth-assay-cli-contracts.mjs \
  tests/structural-material-arch-contact-patch-contracts.mjs \
  tests/structural-material-arch-contact-patch-assay-contracts.mjs \
  tests/structural-material-arch-depth-assay-contracts.mjs
```

## Earlier Decision: Independent Profile Pair

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

The browser bench evaluates every selected force as a **fresh intact-reference
trial** for both profiles. Changing the slider and choosing Fresh solve is not
a sequential loading history; Reset only clears the displayed trial.

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
  effective route, profile HTTP 200s, 40 checks, and empty page exception/console
  error lists are recorded in `browser-smoke.json`.

Replay from this Kaminos worktree:

```sh
python3 serve.py 8423
node structural-material-arch-witness.mjs artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/paired-witness-report.json
node structural-material-arch-browser-smoke.mjs http://127.0.0.1:8423/structural-material-arch.html artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/browser-smoke.json '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The browser smoke defaults to a 180000 ms Chrome startup deadline and records
the effective value and observed startup duration. Supply an optional fourth
argument in milliseconds to change only that startup deadline.

The successful desktop frames were visually inspected at 1440 x 1100; paired
arches, markers, supports, metrics, crack colors, and Bind state are legible
without overlap. At 390 x 844 device emulation, the slider, controls, readouts,
and complete intact arch are visible; the notched arch begins below the fold and
requires scrolling. The negative-route
exercise is preserved as `browser-smoke-wrong-route.json`: a request to
`http://127.0.0.1:8423/not-the-arch.html` exits 1 at `preflight`, records why,
and never falls back to another route. Chrome's process stderr still contains platform
`CVDisplayLinkCreateWithCGDisplay` errors and an allocator warning, despite
exit 0; page exception and console-error events were empty.

## Earlier Witness Claim Ceiling

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

This result is evidence that a compact graph can consume geometry-derived
shape and produce a force-dependent fracture route. The distributed-contact
witness advances the load-path question but does not settle the asset's
interior or member semantics. Before GPU migration, build a bounded CPU
comparison with explicit alternatives for a continuous stone-like volume and
a discrete voussoir/joint structure, both constrained by the same visible
surface and fixed crown patch. Record which surface features are source-derived
and which internal connections are authored assumptions. If those alternatives
disagree materially, ask the operator which object/material interpretation the
asset is meant to carry; do not select one silently from the image. Only
migrate a representation whose geometry and connectivity authority is explicit
and whose post-break load response remains legible.
