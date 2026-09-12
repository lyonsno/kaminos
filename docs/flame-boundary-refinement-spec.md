# Persistent Flame Boundary Refinement

Status: constitutive contract accepted; technical candidate specified,
2026-09-12. The operator's "Alright good, let's do it" authorizes binding the
six design decisions. New-route admission and the revised cost below remain an
explicit operator decision, not an inferred authorization to narrow legacy
support. No implementation, GPU run, default change, or landing occurred.
Owner: handy-fire-man. Consumer: Noah driving the live Volume/Basin cockpit.
Session: 019f7e42-c424-7af3-8c48-a2c134712efe.
Resume: `codex resume 019f7e42-c424-7af3-8c48-a2c134712efe`.
Spec branch: `cc/handy-flame-boundary-refinement-spec-0912`.
Worktree: `/private/tmp/kaminos-handy-flame-boundary-refinement-spec-0912`.

## 1. Outcome and Evidence Boundary

Reduce simulation-cell-shaped artifacts in the authored flame, especially its
weak orange upper structure and flame-material boundaries, without replacing
the basin with a softened, dimmed, or neutralized easier target. Preserve live
basin navigation and a production target of 120 FPS. Grid 128 is already near
the practical production ceiling; 160 is marginal, not a new default. A full
256 simulation is outside scope.

The operator's September 12 images show rectangular orange patches near the
upper flame, stepped tongues on the left, and residual block structure after
ridge was disabled and appearance controls neutralized. The gray smoke is not
an operator-reported target. These observations motivate the scope; they do not
establish a complete causal diagnosis of every square.

Those images are observation references, not an image-matching objective. The
neutralized third diagnostic image is not an accepted appearance baseline.
Preserve the original authored controls and saved basins. Do not infer the
exact preset/state of these images from an older named alias.

Constitutive success requires both the actual mechanism below and an operator
judgment that its live basin is useful. An image that looks improved to an
agent cannot substitute for omitted mechanics; completed mechanics cannot
substitute for operator appearance acceptance.

## 2. Constitutive Requirements

Every ID below must receive its own source pointer and disposition. No item
may disappear behind an aggregate "implemented" or "tests pass" status.

| ID | Required behavior | Substitution that does not satisfy it |
| --- | --- | --- |
| B01 | Retain one coarse simulation at the operator-selected grid and its authored source behavior. | Raising the full grid, changing basin controls, or introducing a second full fluid solve. |
| B02 | Select three-dimensional flame-transition regions using pre-display material signals, including weak emitting structure and cases where Ridge Select is zero. | Screen-space edges, final brightness alone, thresholded ridge alone, or all smoke occupancy. |
| B03 | Store and transport persistent finer material, initially proposing twice the coarse linear resolution in selected regions. | Per-frame regeneration, velocity-only detail, static texture, screen-space sharpening, or renderer-only coordinate warping. |
| B04 | Generate smaller velocity structure using localized wavelet analysis, scale-controlled curl-based turbulence, and flow-advected coordinates with deformation handling. | Generic layered noise, sine perturbations, or unguided curl noise relabeled as wavelet turbulence. |
| B05 | Define coarse/fine material coupling, initialization, source updates, and retirement explicitly; keep broad authored dynamics coarse-owned. | Reinitializing fine material from coarse every frame, leaving stale fuel/heat, or silently evolving a second unrelated flame. |
| B06 | Give finer material local ownership of flame support, boundary geometry, and derivative/ridge reconstruction. | Adding detail inside the same coarse clipped envelope or multiplying the result by the old coarse ridge mask. |
| B07 | Use the finer flame as a local replacement/refinement of the same material, not a duplicate emitter. | Adding coarse and refined copies of the flame or blending their completed images. |
| B08 | Retain one depth-ordered emission/extinction integration with shared transmittance and correct segment-length semantics. | Separate independently attenuated flame images, display-space blending, or step-count-dependent exposure. |
| B09 | Leave the smoke material representation, smoke controls, and smoke coefficient evaluation unchanged. | Fine smoke transport, altered smoke resolution, or dropping smoke extinction where flame is refined. |
| B10 | Resolve fine detail with explicit local sampling/interval policy while preserving unrefined traversal and smoke integration. | Whole-ray mandatory fine stepping, silent extra step budgets, or dropping fine features at a traversal cap. |
| B11 | Deliver live controls, truthful effective state, resource accounting, and baseline comparison through the existing cockpit. | An offline-only producer, a capture-only route, or an apparently enabled control that falls back silently. |
| B12 | Preserve authored preset round trips and provide reproducible fine-state continuation. | Overwriting existing aliases, falsely treating a preset as a material-state snapshot, or losing fine history on ordinary camera changes. |

## 3. Proposed Data and Update Architecture

The chosen candidate representation is a sparse atlas of fine material bricks
with a coarse-space lookup table. Bricks are world/volume-space objects, not
camera-space tiles. Two material buffers preserve old/new transport state.
Uniform twofold local refinement is the initial proposal; it is not a quality
guarantee or permission to raise the coarse grid.

The candidate binding in section 8 replaces the illustrative four-half-channel
layout: twelve FP32 material channels, sixteen fine cells per brick axis, and
one material halo cell on each side. This costs materially more. The earlier
layout must not be used to budget or implement this candidate.

The update must have explicit stages:

1. Derive flame-transition eligibility from material state before aggressive
   display thresholds. Include a transport/interpolation margin determined by
   actual displacement and stencil support, not a fixed arbitrary pad.
2. Allocate eligible bricks and initialize new fine samples from the defined
   coarse reconstruction. Preserve already resident histories and stable IDs.
3. Compute local scale/energy information and advect turbulence coordinates.
   Handle excessive deformation and coordinate renewal without resetting all
   material history or changing the coarse field.
4. Transport fine material with coarse velocity plus the synthesized finer
   velocity. Exchange valid halo data across brick boundaries. New source,
   reaction, decay, and coarse correction terms must each have a named rule.
5. Reconstruct fine support and derivatives from compatible fine fields with
   physical cell-spacing normalization. Preserve the authored optical controls;
   do not neutralize gamma/contrast/ridge controls to hide reconstruction faults.
6. Publish material, lookup, and derived support from the same simulation
   generation. Rendering must not observe half-updated atlases or stale masks.
7. Retire bricks only through the specified transition rule after their needed
   support/history leaves scope. A camera movement is not a retirement reason.

Coupling must specify how coarse source changes reach fine material without
double application, how coarse-scale agreement is maintained without erasing
fine history, and how positivity/bounded authored quantities survive transport.
Simple interpolation is an initialization rule, not a fine-history algorithm.
Feedback from fine turbulence into the coarse momentum/pressure solve is not
part of this candidate. Material correction back to the coarse field would be
a separately disclosed architecture change, not an implementation convenience.

Sparse resource exhaustion must be explicit. Do not drop eligible bricks,
quietly coarsen them, or silently prune history to maintain a favorable FPS.
Use existing allocation/error handling with requested/effective coverage and
reason; an operator-selected fallback is distinct from successful refinement.

## 4. Renderer and Smoke Contract

At each integration position, resolve the authoritative flame material from
the fine/coarse representation and derive its local optical coefficients.
The transition between representations must neither duplicate material nor
create a hard brick boundary. The transition rule must be specified, not
hidden behind an unspecified blend weight.

Evaluate existing smoke coefficients from their unchanged coarse inputs.
Combine flame and smoke at the pre-integration coefficient boundary using one
running transmittance. Refined flame may physically attenuate the resulting
smoke contribution differently; B09 preserves smoke inputs and coefficients,
not an independently composited smoke image. Optical coupling does not require
smoke refinement. Shared scalar fields must not leak fine flame edits into the
smoke evaluation accidentally.

Fine emission/extinction coefficients must have documented units. Do not
interpolate already step-scaled alpha as a step-independent material property.
Within-segment attenuation must remain consistent with the effective interval;
any intentional change to the baseline recurrence must be separately named.

The fine material must be queried below coarse-cell spacing, not baked back
onto the coarse grid before display. Traversal must account for fine support
in empty-space decisions. A coarse rejected cell cannot hide a fine emitter.
Rays that do not enter refined regions retain the existing material evaluation
and step policy, apart from the required lookup cost. Smoke remains integrated
along intervening segments; flame-only selection is not empty-space authority.

The initial 160-step operator configuration is a baseline, not permission for
a hidden 512-step treatment. Expose requested/effective sample budget, fine
segment work, and any exhaustion. A sampling improvement for new fine detail
is not a retrospective claim that the supplied artifacts were depth aliasing.

## 5. Scope and Expected Limits

Expected opportunity: finer moving contours and folds replacing coarse-cell
steps in selected flame transitions, including low-emission upper regions.
To realize this opportunity, B03, B05, and B06 must all be effective together.

Not promised: recovery of missing ground-truth eddies; removal of every square
at arbitrary magnification; correction of the bright body's tone compression;
changing the source-imposed slab/base shape; elimination of interior artifacts
outside selected regions; free additional detail at unchanged frame time.
Adding detailed texture inside unchanged rectangular support is a failure of
the target mechanism, not a smaller version of success.

Out of scope: fine smoke, color-model redesign, kiln/background composition,
full-grid up-resolution, stochastic path tracing, learned upscaling, independent
splat compositing, and unrelated occupancy/raymarch rewrites. Local traversal
changes required to integrate refined material are in scope.

## 6. Budget and Performance Evidence

Target: 120 FPS, about 8.33 ms for the complete frame, not the refinement stage.
Do not imply that a source-local timing or a cheap configuration meets this.
At Grid128 the inspected branch's main fluid/front/pressure/sidecar allocation
subtotal is about 368 MiB, excluding render targets and other resources.

Candidate storage at Grid128, including one-cell brick halos, is:

| Allocation | 5 percent allocated brick-interior coverage | 10 percent |
| --- | ---: | ---: |
| Twelve-channel FP32 material, old/new | 109.35 MiB | 218.70 MiB |
| Four-channel FP32 raw boundary descriptors | 18.23 MiB | 36.45 MiB |
| FP32 vector potential and detailed velocity work buffers | 36.45 MiB | 72.90 MiB |
| Coarse coordinate old/new and energy/renewal state | 96 MiB | 96 MiB |
| Subtotal added | 260.03 MiB | 424.05 MiB |

This is about 71/115 percent of the existing 368 MiB source allocation subtotal,
not 71/115 percent of frame time. It excludes allocator tables, noise tiles,
analysis scratch, snapshots, buffer-growth overlap, and render targets. Coarse
coordinates are two vec4 FP32 arrays; energy/renewal is one vec4 FP32 array.
The halo multiplier is 18^3 / 16^3. Coverage means allocated brick interiors,
not the potentially much smaller geometric volume of the thin interface.

Fine interior visits per pass are 0.4/0.8 of a coarse full-grid pass; including
halos gives about 0.57/1.14. There are multiple new passes: selection/allocation,
coordinate/energy analysis, potential, curl, scalar transport, and descriptors.
Thus "less than one coarse pass of destinations" is not an added-runtime
estimate. Twelve scalar transports also cost more than the four-channel example.
Five or ten percent coverage is a scenario, never a population cap.

These arithmetic estimates are reproducible with gridCellCount * 8 * coverage
* (18^3 / 16^3) * bytesPerSample, converted to MiB. They have not been timed.
The actual material dependency map therefore removes the previous implication
that the proposed sparse carrier is necessarily a small addition. A narrower
representation or lower precision is a new measured design proposal, not a
silent optimization that may omit fields or reintroduce quantization.

Use short existing timing facilities, not a new long assay. Compare refinement
off/on with the same authored basin, source state or deterministic evolution,
camera, viewport, DPR, render scale, grid, and explicit sample settings. Record
whole-frame cadence plus available coarse simulation, fine update, atlas,
derived-support, and render GPU spans. Include allocation/coverage/halo counts,
sample work, and any throttling/fallback. Do not substitute historical unmatched
benchmarks or neutralized low-detail basins for the operator's configuration.

The evidence distinguishes same-source frozen comparisons from divergent
evolving fine histories. GPU timing must not include hidden proof readbacks in
one arm only. Any GPU execution follows existing Greenroom rules at execution
time; no queue or GPU action is part of this specification task.

## 7. Verification Without Visual Proxy Optimization

Operator instruction for this slice: do not use automated visual tests to
evaluate local progress or final quality unless a specific use meaningfully
reduces inference cost or substantially reduces implementation time. Before
such a use, state the concrete saving and the narrow question it can answer.
Routine screenshots, image similarity, image scores, nonblankness, and an
agent's preferred-looking frame do not establish appearance progress.
No visual testing loop is included by default.

Use small deterministic fail-first tests for mechanisms with direct answers:

- Persistence: a tagged fine feature advects over multiple steps and survives
  camera changes; a zero-time update does not regenerate it.
- Selection: emitting transitions remain eligible with Ridge Select zero;
  smoke-only fixtures do not allocate flame refinement.
- Transport: cross-brick translation and halo exchange agree with a tiny
  dense numerical reference; source updates occur once; fields stay finite and
  obey their specified bounds. Coarse source buffers remain unchanged.
- Boundary ownership: two within-coarse-cell positions can produce distinct
  fine support/derivatives; coarse gating cannot erase the admitted feature.
- Turbulence: scale/energy localization, deformation handling, and the actual
  final velocity's divergence behavior are tested, not merely the presence of
  a curl function or the word wavelet. Spatially weighting curl noise alone
  must not be assumed to retain exact incompressibility.
- Optics: analytic homogeneous slabs and overlapping emitters/absorbers expose
  double counting, wrong ordering, step scaling, and separate transmittance.
  Verify unchanged smoke coefficients for fixed coarse inputs.
- Runtime: off-mode baseline behavior, preset round trip, effective route,
  generation matching, state restore/replay, and explicit resource failures.

CPU references establish local contracts, not Apple/WebGPU execution. Reuse
small GPU conformance checks for the actual kernel/format behavior when needed;
do not turn numerical fixtures into claims about the authored appearance.
No new diagnostic framework is required merely to organize these checks.

The final appearance decision belongs to Noah navigating the live authored
basin, including strong controls, camera changes, and useful alternative
settings. Do not require a preselected screenshot to approve a basin. Preserve
the existing record/mark/save/replay path for operator observations.

## 8. Binding Decisions Before Implementation

The candidate below binds the algorithms and source interfaces. Its explicit
scope decision is whether initial refinement consumes the new complete
emissive route only, preserving legacy rendering with refinement off, or must
also refine legacy appearance without changing its optical interpretation.
The latter needs additional coefficient decomposition work. Do not pretend
that a source branch containing both routes proves their interchangeability.

| Decision | Required exact answer | Current status |
| --- | --- | --- |
| D01 Source | Product source and ordinary consumer. | Pinned candidate: f5783b89, ordinary Boundary Fire emissive mode 2; operator scope decision outstanding. |
| D02 Material | Exact channels, meanings, formats, bounds, and ownership. | Bound in 8.2; twelve FP32 channels, not four half channels. |
| D03 Coupling | Transport/source rules and lifecycle. | Bound in 8.3; authored scalar operators at fine positions, no coarse-cell mean pinning. |
| D04 Atlas | Storage, lookup, boundaries, and failure. | Bound in 8.4; 16 interior + 1 halo, stable volume-space brick IDs. |
| D05 Turbulence | Wavelet analysis, potential/curl, and persistence. | Bound candidate adaptation in 8.5; numerical conformance remains implementation work. |
| D06 Optics/traversal | Material evaluation, smoke, light field, and traversal. | Bound for mode 2 in 8.6; legacy compatibility is not claimed. |

Do not mark the architecture implementable by leaving these entries as "use
reasonable defaults." Settling them may change the cost estimate. If the only
affordable approach omits a B requirement, stop and propose the narrower design
explicitly; do not implement it under this specification's name.

### 8.1 Source and Reuse

Read-only source snapshot: `cc/sexy-fireman-color-model-0908` at
`f5783b89e8e61363762a6816a7a3492d62a87738`, clean when inspected. This is source
identity, not operator acceptance of that color implementation. Future work
uses a separate Handy branch from the chosen snapshot; do not mutate Sexy's
checkout or automatically follow later commits. Source-forward changes require
rechecking the named material/optics interfaces, not repeating the entire spec.

Consumer: existing Volume cockpit, Boundary Fire, new emissive mode 2
(`u.physical_fire.x > 1.5`). Legacy mode 0 and earlier color-only mode 1 remain
unchanged when refinement is off. Refinement-on for those modes is not silently
redirected to mode 2: report an unsupported combination until the operator
chooses to expand the compatibility work. That limitation requires approval.

Reuse targets: `sampleFluidSlot`, `sampleFrontField`, the scalar advection and
source operators in `volume-core.js`, `FlowReconstructionSample`, existing
generation/export/preset facilities, `emissiveMaterial`, `emissionIntegral`,
and the seed/sweep/resolve plumbing in `volume-emissive-transport.mjs`.

`volume-persistent-sparse-cohort.mjs` is a checksum-bound exported optical/splat
selection loader with fixed historical states and explicit retargeting limits.
It is not a sparse material transport atlas and must not be repurposed as one.
`flow-kernel-descriptor-socket.mjs` describes reconstruction moments/gradients;
it can inform diagnostics but does not store fine material history. Do not
allocate its 100-float per-cell diagnostic descriptors in the live fine atlas.

### 8.2 Material Channel Binding

All twelve stored components use the source's dimensionless simulation units
and FP32. Their bounds are source clamps, not newly introduced saturation.
Store three vec4 values per fine sample:

| Fine offset | Meaning | Source | Range |
| --- | --- | --- | --- |
| 0 | heat | slot 1.y | 0..2.4 |
| 1 | fuel | slot 1.z | 0..1.8 |
| 2 | material detail | slot 1.w | 0..1.8 |
| 3 | separate front topology | front field | 0..2.0 |
| 4 | flame | slot 2.x | 0..2.4 |
| 5 | ember | slot 2.y | 0..2.0 |
| 6 | visible fire carrier | slot 2.z | 0..1.8 |
| 7 | combustion front | slot 2.w | 0..1.8 |
| 8 | microdetail, named microSmoke in shader | slot 3.x | 0..1.8 |
| 9 | interface shred | slot 3.y | 0..1.8 |
| 10 | fire lick | slot 3.z | 0..1.8 |
| 11 | ember fleck | slot 3.w | 0..1.4 |

These include fire-owned copies of shared detail channels. Their names do not
authorize refining smoke: every smoke evaluation reads the original coarse
copies. Raw smoke density (slot 1.x) stays coarse for both consumers. Coarse
velocity (slot 0.xyz) remains the motion authority; detailed velocity is an
auxiliary field used for fine transport, not written into the coarse solver.
Density carrier (slot 0.w) is derived at the end of `cs`, not independently
transported. Recompute its flame-side value from fine scalar inputs and coarse
smoke using the same max/weighted-sum expression, rather than storing another
transported quantity. Smoke uses the unchanged coarse density carrier.

The twelve fields are a sufficient direct-source mapping, not a demonstrated
minimal basis. In particular, storing only heat/fuel/front/density would drop
authored support dependencies. Compression needs a named equivalence/error
contract before replacing this map. Do not assume FP16 harmless in a task
whose target is quantization amplified by nonlinear rendering.

### 8.3 Transport, Sources, and Coarse Agreement

Initial new material is reconstructed from the coarse fields. Resident material
thereafter reads the previous fine generation, including neighboring bricks.
Use the existing distinct thermal, fire-layer, microdetail, and topology
backtraces, with the fine curl velocity added to their coarse velocity input.
Preserve the existing heat-dependent lift and per-group advection multipliers;
convert displacement through world/coarse/fine coordinates explicitly.

Extract the scalar portion of the pinned `cs` as shared evaluation code with
explicit field samplers and world position. Reevaluate its authored sources,
reaction, floors, decay, diffusion, ceilings, and bounds on fine inputs at the
fine position. Do not copy a coarse cell's final delta uniformly to its children
and call it a source model. Smoke-dependent inputs are coarse reads. Any smoke
output computed by the shared reaction expression is discarded by the fine
consumer and never written back to smoke; retain its intermediate values when
the source algebra uses them to produce a flame-owned quantity. Emitter/source
geometry and parameters are unchanged; spatial evaluation becomes finer.

Fine spatial derivatives and diffusion use the source operator's world-length
units, not unchanged integer-cell offsets interpreted at twice the density.
Document the spacing conversion at each shared stencil. No fine momentum or
pressure update is extracted; detailed velocity is a read-only scalar-transport
input. Coarse execution continues unchanged once per existing simulation tick. Fine
source/decay operators also execute once per that tick. Any transport-only
subdivision must not repeat source injection or per-tick decay. Zero elapsed
simulation ticks mean no material update. Numerical coarse off/on checks must
verify no coarse-state mutation from this extraction.

Coarse agreement means the same authored sources, coarse motion, and domain,
not exact equality of every parent cell's scalar average after fine transport.
There is no per-cell mean projection: forcing a nonnegative fine field to
have zero mean wherever a coarse cell is zero would pin its boundary to that
coarse support and defeat B06. Fine-to-coarse pressure/momentum feedback is
absent. Fine reaction may change material distribution and appearance; this
is a declared consequence of refinement, not recovered ground-truth chemistry.

Selection and lifecycle operate on both coarse flame activity and resident fine
activity. Bind the raw candidate activity to the maximum of the emissive model's
energy (0.65*heat + flame + 0.35*ember + 0.40*visibleFireCarrier + 0.55*fireLick),
its raw front signal (frontTopology + 0.5*combustionFront + 0.08*fireLick), and
fuel*heat. No smoke-density or microdetail-only term can activate it. Select
cells whose six-neighbor-plus-center activity range is nonconstant and whose
maximum exceeds saved `refinementActivityCut`, initially zero. Ridge Select,
display exposure, gamma, and color are not inputs. Material near a transition
with a constant activity but varying support is included when that activity
is positive and the same neighborhood's pre-ridge support range is nonconstant.
Take the union with resident fine cells meeting these same criteria and with
existing transition/transport dependencies. A zero Ridge Select must not empty
the selection. Eligibility is not a final-light culling guarantee.

The zero initial cut deliberately exposes true coverage rather than baking a
convenient brightness cutoff into the first cost result. A nonzero operator
choice changes quality and allocation and must be recorded. Very diffuse
positive flame activity may therefore make this candidate insufficiently
sparse; that result must be reported rather than silently selecting top-N cells.

Expand selected support by actual maximum group backtrace displacement plus
the interpolation/derivative stencil radius. Bricks adjacent to the selected
core provide a transition region: fine residual relative to coarse is weighted
by smoothstep of volume-space distance through one full brick width, zero at
the exterior and one at the selected core. The same material transition feeds
support and optics. Account for its allocated coverage. Retire only when the
brick is outside selected support, transition, and transport dependencies, and
its residual is zero at the outer boundary. Camera changes never affect this.

### 8.4 Atlas and Reconstruction

Initial layout: 16 fine interior cells on each axis, covering eight coarse
cells per axis, with one halo cell on each face (18 cubed stored samples).
Ratio is two. IDs derive from integer volume-space brick coordinates; GPU
slots are reusable storage locations, not material identity. Use a direct
coarse-brick table plus stable free-list slots and indirect dispatch. Reuse
existing GPU compaction plumbing only where its ownership and shape fit.

Every trilinear backtrace lookup addresses global fine coordinates, resolves
the owning brick of each needed sample, and falls back to the specified coarse
reconstruction only outside resident fine coverage. It does not clamp at an
atlas slot's edge. Fill halos from neighboring interiors of the same generation;
world-domain boundaries use the same source boundary condition as coarse.
Transport may cross multiple bricks; a one-cell halo does not limit travel.

Material reconstruction is trilinear, retaining baseline interpolation order.
Compute raw support and raw central-difference gradient magnitude/Laplacian at
fine nodes. Store support, gradient magnitude, signed Laplacian, and neighbor
maximum in a separate vec4 FP32 atlas. Interpolate these raw descriptors before
applying ridge cut/select and other nonlinear support shaping in the consumer.
Do not store an already thresholded fine ridge as the sole interface signal.
Normalize derivatives to the baseline coarse-cell length: fine gradient gets
the spacing ratio and Laplacian its square, preserving the units of existing
controls. This does not claim a C2 reconstruction or removal of all fine-grid
artifacts; a higher-order reconstruction is a separately costed option.

Grow pools to actual requested populations within device limits. No fixed
fraction, top-N selection, or silently dropped tail. Allocation failure records
requested/available bytes and coverage, and stops the refinement transition
without publishing partial state. It does not silently continue under an
"enabled" flag. Snapshot material, generation, brick mapping, coordinate state,
and seed for exact continuation; settings alone only reconstruct a new run.

### 8.5 Wavelet and Velocity Binding

Use the last resolved velocity-detail band from the published wavelet analysis
and extrapolate one new octave for twofold spatial refinement. A constant
translation must yield zero local turbulence energy. Use a deterministic
seeded wavelet-noise potential; band generation and normalization must have a
numerical fixture, not a visually selected noise texture. The original source
distribution is GPL and pedagogical; it is not an admitted dependency or a
performance claim. Implement from the published mathematical construction or
separately resolve dependency licensing before importing source/assets.

Coarse old/new coordinate fields carry the noise through the flow. Measure
their deformation with a Jacobian. The original factor-two stretch/compression
renewal criterion is the starting rule; renew coordinates, never the material
atlas. Preserve renewal state/seed in snapshots. Renewal behavior is a numerical
and temporal risk to assess, not a claim of perfect temporal smoothness.

Candidate adaptation: local amplitude and coordinate deformation act on a
vector potential before curl, rather than multiplying an already computed curl
by a discontinuous mask. Pull the potential into world coordinates consistently
with the coordinate Jacobian. Cache the resulting world potential at fine nodes,
then central-difference its curl into a velocity work buffer. A globally
consistent stencil makes the discrete divergence of this added node velocity
cancel in interiors; test halo/domain behavior and off-node interpolation too.
The coarse velocity's existing divergence is not claimed to disappear.

Energy localization and sparse transitions modulate the signal and may broaden
its spectral support. This adaptation therefore does not inherit the paper's
strict frequency-noninterference claim. Require controlled dominant fine scale
and the numerical divergence contract above. If off-node reconstruction causes
materially unacceptable compressibility, this is an unresolved implementation
finding, not permission to omit the test or claim exact incompressibility.

### 8.6 Optical Consumer, Illumination, and Traversal

The admitted candidate coefficient boundary is `EmissiveMaterial` in
`volume-emissive-transport.mjs`: emission RGB, absorption, scattering. They are
relative radiometric coefficients per volume-local world distance, not alpha.
Factor its input into fine flame reconstruction and untouched coarse smoke
reconstruction. Smoke amount/extinction/albedo use only the latter. Hot soot,
reaction emission, temperature, and flame support consume the fine flame state;
smoke-dependent modulation in those expressions uses coarse smoke. Preserve
the exact authored source law rather than designing another color model here.

Use the existing analytic segment integral and one transmittance. Integrate
total absorption/scattering with the sum of flame emission and incident-light
scattering. Keep camera white balance, exposure, shoulder, and output encoding
unchanged. Off-mode exercises the exact selected source path.

The incident-light seed is also a consumer of changed flame emission/extinction.
It cannot keep sampling only the old coarse flame while the camera sees fine
material. Accumulate fine cell-volume contributions into the existing lighting
lattice in refined regions, coarse contributions elsewhere, without overlap;
then run the existing six-direction sweep and resolve. Retain coarse smoke
coefficients and lighting-lattice resolution. This changes smoke illumination,
not smoke material resolution. Include the reseeding/reduction cost and bind
light/material generation. A camera-only implementation omits this element.

Traverse brick boundaries in the ordinary ray. Outside refined support retain
the existing step policy. Inside use the smaller of its ordinary interval and
half a fine-cell width along the ray, clipped at the next ownership boundary.
Reconstruct and integrate smoke throughout. Record effective sample count and
local fine work. The loop is distance-progress bounded, not truncated at the
old sample count. A saved `refinementSamplesPerFineCell` value (initially two)
makes the extra integration density explicit; existing `raySteps` retains its
ordinary meaning. Any device watchdog/resource failure remains a failure, not
a successful lower-quality fallback.

That policy is the explicit candidate behind the earlier illustrative 160 to
512 full-distance comparison. It is not a promise that this many samples are
always needed or that the cost fits 120 FPS. Optimize only against actual
timings and operator-selected quality; do not secretly coarsen the fine field
to make the treatment pass. Refinement off, refinement on with zero turbulence,
and refinement on with nonzero turbulence are distinct live modes with retained
history where appropriate; zero turbulence is not the same as refinement off.

Legacy compatibility is unresolved by this binding. At this source,
`standardRadianceContribution` and `standardExtinctionStep` outside emissive
mode still mix capped step alpha and Pyro/flame/smoke terms. The existing
ridge/non-ridge decomposition is not a flame/smoke decomposition. Supporting
that path requires a separate exact source factorization, not turning smoke
controls off and subtracting images. No such compatibility is claimed.

## 9. Completion and Omission Accounting

Implementation return must list B01-B12 separately as implemented, missing,
blocked, or operator-revised, with code and adequate evidence pointers. Resolve
D01-D06 before claiming the design is fully bound. A scaffolding milestone may
be reported as scaffolding only, never as completed wavelet refinement.

Review the source against this matrix, not only its diff or tests. Independent
implementation review cannot waive a constitutive item or accept the visual
result for the operator. Scope changes require an explicit operator disposition
and an updated spec. The live cockpit consumer must exercise the full chain;
a producer-local field or passing synthetic test does not close integration.

Final claims remain separate: mechanism implemented; runtime executed;
performance measured on named configuration; operator appearance disposition;
production suitability. Report each truthfully, including omissions.

## Sources and Specification Work Receipt

- Direct operator conversation in the session above, especially September 12
  images and the instruction against visual proxy evaluation. This is the
  authority for scope, live navigation, 120 FPS, and smoke exclusion.
- Source inspected read-only:
  `/private/tmp/kaminos-sexy-fireman-color-model-0908/volume-core.js`;
  `FULL_FIELD_CHANNELS`, buffer size functions, `updateSimCostLedger`, and the
  ridge/non-ridge shared-transmittance path. This is implementation context,
  not authority to mutate Sexy's color-model branch or to call it the live base.
- Kim et al., Wavelet Turbulence for Fluid Simulation:
  https://www.cs.cornell.edu/~tedkim/WTURB/wavelet_turbulence.pdf .
  The published method is precedent; this sparse flame-specific coupling is a
  proposed adaptation, not a claim to reproduce all published behavior.
- Spec created on fetched Kaminos `origin/main` at
  `89df4b7c5244c9616fae2bc33021a6723e1b2aa8`, isolated worktree above.
  Existing docs/filename/branch searches found no matching wavelet/sparse-brick
  refinement spec in the searched surfaces. Neighboring boundary/sparse work
  exists and must be checked at D01, not assumed absent.
- Directive inbox check for handy-fire-man returned no actionable entries.
  Initial primary-checkout Git discovery was rejected by the hook; no write
  occurred there. Subsequent product work used the shared worktree tool.
- This change is documentation only. No visual test, GPU job, renderer change,
  source-field mutation, peer assignment, or public publication was performed.
- Technical binding source was inspected clean at `f5783b89` on 2026-09-12.
  Scalar dependency/bound reads include `cs` outputs and its separate advection
  helpers; optical reads include the full emissive module and legacy recurrence.
  Existing sparse cohort and flow descriptor modules were read before reuse
  decisions. Arithmetic was executed with Node for the section 6 byte counts;
  it is not a runtime benchmark. No conformance/visual claim was made.
- Documentation checks: `git diff --check` passed. A Node row inventory verified
  one row for every B01-B12 and D01-D06. Its first selector incorrectly required
  the D cell to contain only its ID (the cells also contain names); correcting
  the selector passed without changing the requirement table. This is document
  inventory, not a product test or independent architecture review.

Next actor: Noah chooses whether initial refinement targets the new emissive
route only (recommended) or also requires legacy optical compatibility, with
the revised twelve-channel cost visible. The implementation must not start
under a silently narrowed B11 consumer contract. Mechanical/numerical component
work becomes the next actor action after that decision; it does not turn any
unproved performance or appearance claim into acceptance.
