# Learned Ray Stepping: Input Sufficiency and Architecture Choices

Status: source-derived architecture proposal, not a trained-model or timing result.
Owner: ray-step-sicko. Consumer: native boundary-fire rendering and handy-fire-man's integration.
Operator direction, 2026-10-10: derive necessary inputs before selecting architecture;
prioritize feature preservation. Treat incident smoke lighting as potentially smooth
outside clipping, subject to evidence, rather than opening a lighting investigation.

## Source Scope

The audited emission/extinction path is `volume-core.js` and
`volume-emissive-transport.mjs` at `35b04507bf0f743a52fcbcd4a755ec6b7f3d1fec`.
This branch was fast-forwarded to fetched main
`2620c81e6d516758cf0fb7b55948c5bc1959d305` before writing. Those intervening
changes affect source dynamics and host acquisition, not the audited optical law.

The parent accepted presentation revision is
`e3ea9c08a9ff11d3e89fc62472e00c018358aee6` on `cc/handy-agx-1010`.
Its diff changes display to AgX and adds optional stable blue-noise ray starts,
not the mode-2 material/coverage law. Main does not yet include that presentation
stack. A consumer comparison must explicitly compose that dependency or its
landed successor; main's old display is not a substitute for the accepted look.
The separate camera-cubic experiment is
`fe5d107ae599d75ab3fe7c0f81bc96688ab5a3a9` on
`cc/handy-global-cubic-1009`; it is not active on either source above.

Source anchors:

- `sampleWorldFlowReconstructionRaw`, `sampleWorldFlowReconstruction`,
  `sampleWorldFlowReconstructedSidecar`, `curlAtCell`, `divergenceAtCell`.
- `boundarySupportFromSlots`, `liveBoundarySupportAt`, and the
  `boundaryMaterialSupport` calculation inside `raymarchVolume`.
- `emissiveMaterial`, `emissionIntegral`, and the mode-2 camera accumulation.
- `encodeDraw` selects plain, point-light, or distributed smoke illumination.
  `scene-smoke-reconstruction.mjs:distributedMeanIncident` is the distributed
  path; inspecting only `incidentAt` misses the consumer's effective lighting.

## What Must Be Predicted

For a fixed frozen state and appearance law, let distance along a candidate
segment be s in [0,h]. Define:

```
sigma(s) = absorption(s) + scattering(s)
j(s) = material_emission(s) + scattering(s) * incident_RGB(s)
T(s) = exp(-integral_0^s sigma(u) du)
E = integral_0^h T(s) * j(s) ds
T_segment = T(h)
```

RGB E and scalar T are the four transfer quantities needed to compose this
segment with any unchanged prefix and suffix. They are sufficient *outputs*,
not four free observations available before integrating the segment. The
current shader approximates coefficients as constant over each sample's step.
Its `emissionIntegral` implements the constant-coefficient solution with a
small-optical-depth numerical expansion.

With unchanged prefix/suffix and linear optical composition:

```
C = C_prefix + T_prefix * (E + T_segment * R_suffix)
delta_C = T_prefix * (delta_E + delta_T * R_suffix)
delta_T_final = T_prefix * delta_T * T_suffix
```

R_suffix includes the background for this linear composition. Thus:

- Local transfer error needs the segment, not the whole ray.
- Actual pixel RGB error additionally needs prefix transmission and suffix RGB.
- Final transmission error additionally needs suffix transmission.
- Display-space error needs accumulated prefix RGB and the display transform.
  Image/perceptual losses can also depend on neighboring pixels.
- Globally optimal allocation under a shared budget needs competing error/cost
  opportunities. It is not a target determined by one local neighborhood.

Kaminos's present output alpha also adds a term proportional to displayed peak
RGB, then premultiplies display color. Its final RGBA is not exactly the physical
E/T representation above. Offline optical labels and actual composed-image
judgment must remain separate. AgX and the actual host compositing route belong
in the latter, rather than silently applying a physical alpha formula to them.

## Information Test

If two admissible states have the same proposed inputs but different target
values, the inputs do not uniquely determine the target. For a normed numerical
target, a separation greater than 2 epsilon rules out a prediction within
epsilon of both. A binary refinement decision only needs the two cases to lie
on opposite sides of its decision threshold.

Concrete distinctions:

1. Same point sample, different narrow sheet inside the proposed step: different
   local E/T. A point-only interest function cannot distinguish them.
2. Same eight center-cell values, different outer support neighbors: boundary
   gradient/laplacian and resulting coverage can differ in the live-support path.
3. Same segment error, different suffix: with T_prefix=0.8, delta_E=0 and
   delta_T=0.05, suffix radiance 0 versus 20 gives delta_C=0 versus 0.8.
   No local material input distinguishes those final-pixel priorities.

These are dependency/counterexample arguments, not claims from model fitting.
Finite coefficient probes do not automatically provide a guarantee for the
actual nonlinear reconstructed field. A guarantee needs its determining
footprint plus a bound on between-probe variation, or equivalent certified
interval information. A model can exploit the data distribution without
having that guarantee; it must then be described as a predictor.

## Actual Spatial Footprint

One raw linear reconstruction reads four vec4 slots plus scalar front topology:
17 stored scalars at eight nodes, or 136 scalar values before controls/context.
Not all components influence every fixed setting; this is a conservative
source representation, not a minimal feature count.

With linear interpolation and flow smoothing disabled, live boundary coverage
also evaluates support at p plus/minus one grid pitch on each axis. For an
interior interpolation cell, the union is 32 grid nodes, not eight. The
possible six-neighbor curl/divergence reads for any p in that cell are contained
in this union. Supplying all 17 values at these nodes would cost 544 scalar
inputs. Cached-sidecar coverage instead reads its own eight vec4 nodes, but
center material and curl/divergence dependencies remain.

Smoothing adds data-dependent tangent-offset samples. Its radius can reach
0.24 normalized world units; grid pitch is 2/GRID, so this is up to 0.12*GRID
cells of reach. Computing that tangent itself reads a structure gradient and
curl. A fixed immediate halo is therefore not sufficient for all settings.
Collect the union over the entire candidate interval and its reconstruction
reach, not just over its midpoint. Crossing interpolation or curl-cell
boundaries changes the determining stencil.

The bounded cubic experiment reads 64 nodes per raw sample and clamps to the
eight center-node extrema. Its clamp does not make the other 56 nodes irrelevant
to the interpolated value. Offset support and smoothing enlarge this further.
It is a distinct input contract, not an interchangeable interpolation flag.

Incident lighting is a separate field. Distributed lighting is normally
trilinear, but geometry masks can return zero or select a nearest-cell sample.
Any interval summary must include the relevant mask/boundary state. Camera
scene depth separately clips the valid integration interval. No point feature
should grant permission to integrate through the wall or across an unexamined
lighting discontinuity.

## Smooth Lighting Can Be Represented More Coarsely

Keep the operator's smooth-light hypothesis separate from density smoothness:
`j_scatter = scattering * incident_RGB`. A slowly changing incident field can
still illuminate a sharply changing density field.

If incident RGB is replaced by a constant approximation with maximum error
epsilon_L throughout the segment, holding scattering/extinction unchanged,
and 0 <= scattering <= sigma, then in the RGB infinity norm:

```
error_E_scatter <= epsilon_L * integral_0^h T(s)*scattering(s) ds
                <= epsilon_L * (1 - T_segment)
error_C_scatter <= T_prefix * epsilon_L * (1 - T_segment)
```

This follows from dT/ds = -sigma*T. It bounds the isolated lighting
approximation; it does not bound errors in density, extinction, or coverage.
The assumptions include nonnegative optical coefficients and albedo in [0,1].
Do not infer epsilon_L from two matching endpoints without a variation bound.
Masks invalidate a smooth-region assumption across their switch boundaries.
No exact whole-ray lighting history is required for local transfer prediction.

## A Bound That Explains the Useful Inputs

For constant approximate coefficients sigma_hat >= 0 and j_hat, suppose the
whole segment satisfies |sigma-sigma_hat| <= epsilon_sigma and
||j-j_hat||_infinity <= epsilon_j. Then:

```
|delta_T| <= h * epsilon_sigma
||delta_E|| <= h * epsilon_j + ||j_hat|| * epsilon_sigma * h*h/2
||delta_C|| <= T_prefix * (h*epsilon_j
                  + ||j_hat||*epsilon_sigma*h*h/2
                  + h*epsilon_sigma*||R_suffix||)
```

These are conservative bounds, not measured error estimates. They follow by
using the Lipschitz bound of exp(-x) for nonnegative optical depth and integrating
the attenuation discrepancy. They identify the relevant quantities: distance,
optical variation, source magnitude, incoming transmission, and the light
behind. A certified R_suffix upper bound can replace exact suffix RGB for a
conservative controller. A preview-derived suffix is a prediction, not a bound.

## Architecture Choices

1. **Full determining stencil.** Gather raw fields, required halo/offsets,
   incident field and masks, plus segment geometry and fixed material controls.
   A small MLP or stencil encoder predicts E/T error. This is information-rich,
   but redundant gathering and smoothing reach make it an unattractive first
   production design. Data sufficiency alone does not prove model accuracy.
2. **Ordered optical probes.** Sample sigma, emitted RGB and scattered RGB at
   ordered positions across the proposed segment. Include sample offsets,
   segment length/grid pitch, and clipping/boundary indicators. A small MLP
   predicts separate RGB emission and scalar transmission disagreement versus
   a refined reference. It sees distribution within the step, not only its
   current point. These probes are empirical input, not certified complete
   information. Charge their actual material-evaluation cost.
3. **Cached spatial descriptors with a small ray controller.** Prepare optical
   variation/support descriptors or learned spatial features once per frozen
   volume/material update, and query them over candidate intervals. This can
   avoid repeating expensive raw neighborhoods on every ray. A mean alone can
   erase a sheet; preserve directional/support information or actual bounds.
   Learned compression is predictive, not information-preserving by default.
   Updating descriptors and reading them must be charged. Evaluating the
   optical law at nodes then interpolating is generally not equivalent to the
   current law applied after interpolation; do not silently change appearance.

Recommendation: first test option 2 against a numerical coarse/refined error
estimator using the same gathered samples, without making an end-to-end global
allocator the first target. This is a feature-preservation comparison, not a
promise of speed. Keep emitted and scattered contributions separate so the
smooth-light hypothesis is cheap to inspect. A practical starting proposal is
five ordered probes (endpoints, quarters, midpoint), seven optical values per
probe, and a small two-hidden-layer MLP; exact width and probing scheme remain
choices for operator inspection, not an established sufficient architecture.

Use the controller, rather than the local predictor, for T_prefix, display
sensitivity, remaining interval, tolerance and budget. Start with separate
nonnegative RGB E-error and scalar T-error outputs, avoiding cancellations in
one scalar label. Exact suffixes may weight offline labels; live suffix context
must be either an explicit conservative bound or an identified approximation.
Option 3 is the production-oriented alternative if repeated probes cost too
much; select its compression from evidence rather than adding a full 3D network
or whole-ray sequence model by default. Image-space arm B remains independent.

## Reference and Comparison Requirements

- Freeze state, effective lighting generation/route, material uniforms,
  reconstruction mode, clipping, display, and ray phase.
- Decouple reference integration subdivision from `dtBase` in the boundary
  appearance law. `boundarySidecarStepFootprintWidth` depends on `dtBase`;
  raising the ordinary steps slider alone is a confounded reference.
- Compare converging subdivisions with the same coefficient law. A historical
  highest-step capture or a changed sample phase is not automatically truth.
- Local fitting establishes prediction quality; held-out composed images and
  camera movement establish feature preservation. Rendering time must include
  descriptors/probes/preview/model work before any efficiency claim.
- No research child or GPU training run is launched by this document. Expose
  the concrete revised assay card before launch; the present return is the
  derivation and architectural choices requested by the operator.

## Accountability

Executed source reads and comparisons on the owned worktree, including
`git diff 35b04507 e3ea9c08 -- volume-core.js volume-emissive-transport.mjs`,
`git diff HEAD origin/main -- volume-core.js scene-smoke-reconstruction.mjs volume-emissive-transport.mjs`
before the fast-forward, `git show fe5d107a -- volume-core.js`, and
`git show fe5d107a:volume-cubic-reconstruction.mjs`.
`git fetch origin main` and `git merge --ff-only origin/main` succeeded;
no peer branch/runtime was mutated. An inline Node stencil enumeration found
32 nodes for center plus six shifted trilinear samples and 32 after including
all possible cell-centered curl neighbors. The same arithmetic check yielded
0 and 0.8000000000000002 for the dark/bright suffix counterexample above.
This enumeration is a sanity check of the stated footprint, not an external
renderer-conformance or image witness. No new harness, runtime test, model,
GPU timing, or image evidence was produced.

The optical-composition background is described in
[GPU Gems, Volume Rendering Techniques](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-39-volume-rendering-techniques).
An analytic comparator has precedent in
[Accurate Volume Rendering Based on Adaptive Numerical Integration](https://lhf.impa.br/ftp/papers/sib2015.pdf).
The bounds and Kaminos dependency analysis above are this lane's derivation,
not claims that those papers prove this renderer's error or learned sufficiency.
