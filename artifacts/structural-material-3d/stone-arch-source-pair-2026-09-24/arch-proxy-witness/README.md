# Projected Arch Structural Witness

## Current Checkpoint: Matched History Reaches The TRELLIS Consumer

The 2026-09-26 assay isolates the source-intended continuous interior instead
of letting the radial-joint counterfactual veto or confound the result. It
uses the same intact TRELLIS GLB (SHA-256
`c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5`), a
three-layer surface-envelope proxy, and a through-thickness contact patch at
`(0.35, 0.20)`. Sequential loads `0.25, 0.50, 0.75, 1.00, 1.25, 1.50`
produce 40 located bond breaks across two connectivity epochs while the graph
remains one component. The same later load `0.50` is then solved once from the
intact graph and once through that broken connectivity.

| Later response | Intact history | After prior cracking |
| --- | ---: | ---: |
| Contact travel at force `0.50` | `0.005370` | `0.008413` |
| Peak nodal displacement | `0.007194` | `0.010615` |
| Broken bonds | `0` | `40` |
| Connected components | `1` | `1` |

The later contact and force are identical; crown travel increases by
`0.003043` (`56.7%`) after the located crack history. A zero-force solve of
the damaged graph returns exact zero displacement while retaining all 40
broken bonds. This is evidence that connectivity history changes the loaded
response of this expressive proxy. It is **not** a residual visible scar:
each solve uses fixed reference geometry. No calibrated stone behavior,
permanent shape change, detached motion, GPU execution, or audio is claimed.

The paired geometry consumer now carries that experiment onto two copies of
the same GLB. The left remains intact; the right receives the six-load crack
history. Both receive force `0.50` at `(0.35, 0.20)` through all inferred depth
layers, with 1200 solver iterations and the same display gain. This route uses
a dedicated profile with the assay's shared bounds
`[-0.5, 0.5] x [-0.39, 0.39]`: reusing the older mesh-bounds profile moved the
nominal contact patch to different grid cells, so it was not an honest matched
comparison. Both loaded copies resolve to cell `(40, 27)` and map the state
onto the same 197871 source vertices. Peak displayed motion is `0.05224`
intact versus `0.07630` with prior cracking. Unloading returns both surfaces
to exact zero displacement while the damaged graph retains 40 broken bonds.
The pixel difference is restrained; this proves state reaches the mesh
consumer, not yet that an operator finds the injury legible without reading
its counters.

The first geometry review found that the history button wrote the damaged
solver state before the paired mesh transaction accepted it, and that later
slider loads could quietly evolve both comparison histories. Both are corrected:
the 40-bond candidate is committed only after paired acceptance, and each
accepted force application now leaves a visible load path with cumulative
broken-bond counts, including named zero-force unload actions. Reset and replay
restore the fixed `0.50` comparison; a `0.50 → unload → 0.50` sequence remains
visible as three accepted transitions.
The pre-fix [presentation-failure reproduction](arch-history-consumer-smoke-2026-09-26-accepted-receipt-fail.json)
shows why the receipt contract matters: state was accepted, but the old failure
receipt omitted the transition's route and load identity.
The follow-up [review-fix smoke report](arch-history-consumer-smoke-2026-09-26-review-fix-final.json)
records 46 checks across the fixed comparison, additional `1.50` and repeated
`0.50` loads, reset/replay, unload, camera stability, and mobile layout. The
[zero-force history report](arch-history-consumer-smoke-2026-09-26-zero-force-final.json)
adds 48 checks, including unload followed by another `0.50` load. The final
[presentation-failure report](arch-history-consumer-smoke-2026-09-26-presentation-receipt-final.json)
passes 49 checks, including an injected post-acceptance presentation failure
that verifies route, load, contact, source, and accepted-path identity survive
in the failure receipt. Report-specific captures preserve the original
five-frame report unchanged.

The browser route is `http://127.0.0.1:8424/structural-material-arch-geometry.html`.
The [browser smoke report](arch-history-consumer-smoke-2026-09-26.json) records
the effective route, exact source hash, state snapshots, camera-pose stability,
five PNG captures, and 41 checks. The loaded frame is
[`matched-load.png`](matched-load.png); compare with
[`history-unloaded.png`](history-unloaded.png) and
[`unloaded-history-retained.png`](unloaded-history-retained.png). The desktop
captures were inspected at 1440 x 1100 and the responsive view at 390 x 844.
Only an operator can decide whether the visible shape delta itself reads as
changed response.

The machine-readable event ledger, per-step loads, response summaries, source
identity, effective CPU route, and implementation hashes are in the
[matched-history report](matched-history-continuous-2026-09-26.json). Replay:

```sh
node structural-material-arch-history-assay.mjs \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/matched-history-continuous-2026-09-26.json

node --test --test-concurrency=1 tests/structural-material-arch-*.mjs

node structural-material-arch-history-smoke.mjs \
  http://127.0.0.1:8424/structural-material-arch-geometry.html \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/arch-history-consumer-smoke-2026-09-26-presentation-receipt-final.json \
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' 180000
```

**Next consumer slice:** ask the operator whether the restrained mesh delta is
visible and causally legible while orbiting freely. If it is not, keep solver
evidence separate from the visual claim and identify the smallest projection
adjustment that improves perception without changing matched force or material
state. Do not add an unloaded scar: no residual-set model exists. Next decide
whether the intended stone grammar needs persistent deformation, physical
surface separation, or both before selecting a GPU migration target.

## Earlier Checkpoint: Contact And Interior Sensitivity

The 2026-09-25 CPU sensitivity assay holds the intact TRELLIS source fixed
(SHA-256 `c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5`)
and compares a controlled shoulder notch under a nine-cell crown patch at
normalized force `2.0`. It crosses two contact assumptions (force shared over
all three inferred depth layers, or applied only to the camera-facing layer)
with two interior assumptions (continuous lattice, or nine authored radial
voussoir sectors joined by weaker bonds). Intact and notched runs use matched
settings within every pair. The patch distributes the same total force across
27 nodes or 9 nodes, respectively. Connectivity summaries and the terminal
support check use that same force-loaded layer set, so detached unloaded rear
layers cannot invalidate a supported camera-facing contact or mask an
unsupported one.

The local notch-crack contrast **changes sign under the radial-joint
assumption in both contact modes**:

| Contact depth | Continuous: intact / notched local cracks | Radial joints: intact / notched local cracks | Notch contrast |
| --- | ---: | ---: | --- |
| Through thickness | 0 / 12 | 73 / 40 | `+12` becomes `-33` |
| Camera-facing surface | 0 / 8 | 68 / 19 | `+8` becomes `-49` |

All eight cases end in loaded-path separation at this force. The proxy is
therefore sensitive to both contact and interior assumptions, but this
endpoint does not discriminate between them. The radial-joint construction is
an explicit geometric counterfactual, not a claim that the asset depicts
voussoirs. The notched and intact cases are controlled ablations of one
projected source profile, not separately reconstructed meshes. These are raw
local crack-event counts: the notch and radial joints change the number of
live bonds available to fail, so the deltas are not a normalized damage rate
or a material ranking.

The assay retains every failed bond's rest-space midpoint, strain and event
energy, plus component sizes, pinned and loaded counts, support status, and
solver route per epoch. The mesh still consumes neither stress nor
connectivity: the three depth layers fill an inferred envelope, not a
source-truth solid interior.

**Disposition:** retain this as a CPU architecture/sensitivity diagnostic;
do not infer source-true construction or migrate this exact graph to the GPU
sidecar yet. The result establishes that visible occupancy plus an authored
interior prior can produce distinct causal crack ledgers, while also showing
that the ledger depends materially on that unobserved prior. Before selecting
a material model for a user-facing asset, identify whether contact acts on a
surface or through volume and whether the represented arch is continuous or
jointed. The radial joints are an explicit counterfactual, not a claim about
the represented arch.

Full per-epoch failures, positions, strain, event energy, connectivity,
support status and route/code provenance are retained in
[contact/interior sensitivity report](contact-interior-sensitivity-2026-09-25.json).
The earlier load-distribution evidence remains in the [point-load baseline](point-load-enhanced_2026-09-25.json)
and [0.032-radius crown patch report](contact-patch-r032_2026-09-25.json).
The assay ran on Node `v25.9.0`, local CPU route
`shear-regularized-linear-spring-pcg-v0`, with no fallback; the eight-case run
reported `1829.161 ms` elapsed. This is one assay-run duration, not an isolated
solver benchmark or performance claim. The report binds the route to source
revision `07fb832c651764f35fd66c1bea05b2a18da0a9be` and records SHA-256 hashes
for the implementation files.

Replay from this Kaminos worktree:

```sh
node structural-material-arch-contact-interior-assay.mjs \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb \
  artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/contact-interior-sensitivity-2026-09-25.json

node --test tests/structural-material-arch-*.mjs

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

## Assumption-Sensitivity Finding

The broader CPU comparison demonstrates an assumption-sensitive local
response, not the asset's true material behavior: the authored radial-joint
interior reverses the controlled-notch crack-count contrast under both tested
contact-depth rules, while every case reaches the same broad terminal category.
Neither the open TRELLIS surface nor this proxy selects the true interior or
load contact. The continuous-only matched-history result above isolates one
interior hypothesis and shows that its own broken connectivity changes later
loaded response; it still does not establish source-true stone behavior or an
unloaded visible wound. Do not convert these CPU results into GPU-parity or
mesh-destruction claims.

Next, inspect the actual arch mesh and source-image evidence for construction
clues and surface/contact geometry, while keeping inferred internal joints
separate from source-derived facts. Then choose one cheap discriminator that
can establish the intended representation (or explicitly keep both priors as
separate material recipes). After that, implement the smallest visual consumer
that maps the existing structural state onto mesh displacement or segment
separation, preserving the same contact anchor, load ledger and connectivity
changes. Review its visible frame before deciding whether GPU migration is the
next bottleneck; do not begin with GPU parity alone.
