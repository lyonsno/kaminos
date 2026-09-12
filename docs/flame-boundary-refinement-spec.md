# Persistent Flame Boundary Refinement

Status: operator-review draft, 2026-09-12. Specification only; no implementation,
GPU run, default change, or product landing is authorized by this document.
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

Brick interior size, interpolation halo, field formats, and channel layout are
not settled merely because an illustrative eight-cell brick or four-channel
half-float format appeared in discussion. They must be settled in the binding
table in section 8 before the corresponding implementation starts. No claim
of an exact implementation-complete specification is made while it is open.

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

The earlier four-half-channel illustration gives these estimates before halos
and metadata: twofold refinement over 5/10 percent of the domain stores about
13/26 MiB in two buffers and visits 0.4/0.8 times the cells of one coarse full
pass per fine transport pass. These are not timings or an admitted field layout.
Recompute all estimates after section 8 binds the actual channels/formats.
Five or ten percent coverage is a scenario, never a population cap.

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

These are unresolved implementation-design obligations, not optional features
and not generic requests for a long assay. Resolve through source inspection
and cheap numerical reasoning; return material tradeoffs to the operator.

| Decision | Required exact answer | Current status |
| --- | --- | --- |
| D01 Source | Product branch/commit and supported cockpit consumer; identify existing sparse/transport helpers before adding any. | Open; spec branch is not a chosen renderer implementation base. |
| D02 Material | Per-channel meaning, source field, transport/source rule, units, bounds, format, and flame/smoke consumer. Include a disposition for every source channel that influences flame. | Open; four channels was only an estimate. |
| D03 Coupling | Coarse agreement/correction rule, source injection, reaction/decay, initialization, transition, and retirement. | Open; cannot be replaced by per-frame reseeding. |
| D04 Atlas | Interior/halo dimensions, lookup/allocator, inter-brick advection, growth/failure, interpolation and derivative kernels. | Open; twofold local resolution proposed. |
| D05 Turbulence | Actual wavelet analysis/noise construction, local energy scaling, coordinate transport/renewal, and divergence contract of the combined velocity. | Open; generic curl noise is not the agreed mechanism. |
| D06 Optics/traversal | Exact source coefficient boundary, segment integration, smoke isolation, refinement transition, support-aware traversal, and requested/effective sampling controls. | Open; no hidden step-count increase. |

Do not mark the architecture implementable by leaving these entries as "use
reasonable defaults." Settling them may change the cost estimate. If the only
affordable approach omits a B requirement, stop and propose the narrower design
explicitly; do not implement it under this specification's name.

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

Next actor: Noah reviews this outcome/constitutive contract. Handy then binds
D01-D06 in this same document before implementation; no missing requirement
becomes discretionary merely because a smaller implementation is easier.
