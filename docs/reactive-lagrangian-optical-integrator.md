# A Reactive Lagrangian Optical Integrator for Subgrid Flame Super-Resolution

This is the working title of the `optical-particles` Workbench experiment. The method combines a live Eulerian combustion/flow simulation with a continuously refreshed Lagrangian optical representation. Fresh local material observations seed carriers with source, intrinsic emission, extinction and represented support. Carriers retain their history and evolve between observations; the current view is integrated from that evolved medium.

The target is fine, coherent, moving flame and smoke at useful interactive cost. The useful regime preserves fine optical structure while keeping gross emission, extinction and visibility plausible. Dense refresh toward the instantaneous coarse-grid appearance is a comparison, rather than the sole quality objective. “Subgrid” and “super-resolution” describe the optical appearance relative to the Eulerian grid. They do not assert a validated higher-resolution velocity or chemical solution.

The active architecture is **Fine plus optional Coarse (World)**. Middle is superseded and outside this work's implementation and compatibility targets, per the operator's November 10 clarification. Historical fixture code still containing Middle wiring does not make it part of the architecture or a preservation requirement. This clarification calls for no Middle removal or repair on this branch.

## Implemented state and integration

`volume-optical-particles.mjs` owns a persistent world-space pool. Each record stores its position/age, observed source and extinction, intrinsic emission and initial reaction potential, residual velocity, support/direction information, and current potential/heat/soot state. New observations rotate through that pool. They are local material observations, not completed camera-ray colors.

Finite reaction potential is initialized from observed intrinsic emissive energy, including the represented ray length. That length also weights optical accumulation, so changing numerical support currently changes reaction initialization as well as represented optical amount. Separating those roles is an experimental candidate; the current coupling may contribute to the accepted appearance. Positive intrinsic emission initializes normalized heat; generated soot starts at zero. Existing carriers consume potential, release heat, cool and produce soot. This is an explicitly approximate visual reaction state; existing records do not reacquire actual grid fuel, oxygen or temperature. When admitted, the simulation supplies the mixing time, cooling time and heat-of-combustion controls.

Intrinsic emission depends on carried heat. Inherited extinction fades, and generated soot contributes extinction. Captured scattered light is stored separately in meaning and has independent gain/lifetime controls. It currently retains birth illumination rather than querying current incident light.

The raster uses perspective-projected Gaussian footprints. Optional orientation follows the already sampled grid velocity. Depth modes use a uniform set of camera-depth slices over the retained depth range, with particle extinction deposition and a prefix queried during source accumulation. Each footprint currently deposits at its center depth; the method does not integrate a full 3D Gaussian through every intersected slice. The separate reference-march display remains a completed-image comparison, rather than a coherent grid/particle mixture.

## What reaction currently changes about motion

Every advancing carrier samples the current admitted Fine or Coarse velocity in the active configuration. The **Grid flow transport** control scales that displacement. Independently, the implementation already carries a heat-driven residual velocity:

```text
H = updated carrier heat
d = exp(-dt / relaxationTime)
vResidualNext = d * vResidual + up * rise * H * relaxationTime * (1 - d)
positionNext = position + gridDisplacement + dt * vResidualNext
```

**Additional rise** (`rise`) drives this reaction-to-motion path. **Velocity relaxation** (`drag`) sets its relaxation time. `rise` defaults to zero; birth initializes residual velocity to zero. A previously nonzero residual decays after rise is set to zero. Enabling the existing control uses arithmetic already present in the update shader and adds no field queries. Changed trajectories and projected coverage can still affect total rendering cost.

**Reaction support expansion** (`expansion`) separately grows the footprint as initial potential is consumed. It defaults to zero. It changes spatial support and optical amount, not the carrier center or the grid velocity. Flow alignment changes orientation, independently of this growth.

There is no feedback from carrier heat/soot into the Eulerian momentum or reaction solve, and no inter-carrier force/exchange model. Grid reaction continues to affect the grid velocity sampled by the carriers. With rise disabled and no remaining residual velocity, fine carrier-center motion follows that sampled field while fine reaction/optical state evolves independently.

Reaction age and residual motion use simulation-step delta times the effective reaction time scale. Grid displacement has its separate step/backtrace/flow factors. Rendered frame count is not the age unit. Inspect effective live settings before attributing a particular tune to rise or expansion; their zero defaults do not establish the values used in a later tune.

## Why the combined system can retain more detail

The state of the effect consists of the grid **and** the carrier population. The population retains earlier local observations, continuous trajectories and independently evolved reaction/optical state that cannot be reconstructed from the current grid snapshot alone. Some fine structure comes from retained observations and their transport; some is supplied by the continuation model and support choices. The system explicitly records that additional state in the carriers.

A fine material field transported by a coarser velocity field can remain a useful dynamical representation even without fine material feeding back into momentum. Stronger reactive motion is an available direction, but is not required for the existing representation to be richer than an instantaneous grid render. Its effect must be distinguished from buoyancy already supplied by the Eulerian simulation.

## Recovered next-work plan

These are prospective slices, not claims that they are implemented. The current all-particle, manually tunable sliced renderer is the working baseline.

1. **Remove stalled out-of-domain carriers and diagnose long-lived glow.** Retirement should apply after a carrier leaves every valid active flow domain, preserving legitimate Fine/Coarse transfers. Follow identified carriers through potential, heat, soot, intrinsic emission, captured scattering, age and motion to distinguish slow evolution from replacement or stale light. Ordinary acquisition can continue while identities are traced. Inactive records can stop rasterizing, but the current capacity-wide dispatch/draw and rotating allocator do not immediately turn every retired record into compute savings or prioritize its hole for new births.
2. **Expose the coupled renewal clocks and ratios together.** Distinguish fresh evaluations, valid observations, accepted/placed births, allocated capacity, active population and overwrite horizon. Group acquisition/placement, birth/turnover, age/state clocks and support/overlap controls. Current slots and fresh-budget displays are not actual active/birth counters. Keep simulation-reference units explicit.
3. **Track coverage from real observations.** Improve the analytic source corridor using admitted fresh observations, with exploration outside it for bends and new tongues. Source history currently estimates inlet travel; it is not recorded turbulent history. Use separate pre-attenuation emissive and extinctive coverage, qualified by depth where necessary. A visually filled image or the retained particles alone cannot certify missing material as absent.
4. **Expose foreground visibility as a live control.** Proposed “Fill missing extinction” strength compares an independently built current Fine/Coarse extinction prefix with the particle prefix over matching camera-depth intervals. Start from `tauEffective = tauParticle + strength * max(0, tauGrid - tauParticle - slack)`. Strength 0 preserves the present renderer; strength 1 with zero slack raises cumulative optical depth to the greater of the two. Apply the resulting prefix consistently to source attenuation, within-slice transfer and final background transmission, rather than adding the complete grid opacity over already represented particle opacity. Preserve carrier state, birth policy, support and particle depth partition when the strength changes. Proposed views show the optical-depth deficit or the particle light the assist suppresses. This lets the operator explore the hypothesis directly without a separate assay. Independent current extinction can expose missing visibility while a carrier reaction error still coexists; a favorable image alone does not establish that reaction is correct. The added pass queries extinction, with no emission/scattering-light evaluation, and has unmeasured cost. It adds absorption rather than newly evaluated scattered illumination. Coarse scale/slack remain controls for preserving useful fine history.
5. **Make multiple local evaluations and larger support testable.** One fresh material evaluation per ray is hardwired in the prototype, not a measured optimum. Separate evaluation budget, depth samples per ray, neighboring-ray extent, represented ray depth, transverse support and retained capacity. Reuse existing observations where possible. Extra depth samples alone cannot measure a wider transverse footprint. Fit means/spread/residual before choosing covariance changes, positive splits or a different kernel.
6. **Use source-frame structural stability appropriately.** A stable tongue can contain rapidly moving and reacting material. Stability can justify reusing support geometry/basis while optical coefficients or material observations change quickly. Preserve discovery near emitters and burning objects. Do not infer a longer parcel lifetime solely from a slowly changing source-relative shape. Larger support must earn savings after its added overlap is charged; depth extent spanning bins requires a corresponding deposition model beyond the current center slice.
7. **Relight material when that improves the result.** Independent captured-light fading is already implemented. Current-field relighting would retain the required scattering coefficients and sample the prepared same-generation incident field. That is distinct from solving new light transport for every particle. Its record layout, queries and optical semantics remain to be evaluated. A moving light over upper smoke is a useful diagnostic because near-flame illumination can hide stale-light behavior.
8. **Keep representation mixtures available.** A broad smoke march could contribute support and optical terms to the same depth integration while particles supply fine structure, additional material or continuation. Explicit overlap weights/residual roles avoid accidental double counting. This is not an exclusive flame/smoke handoff and is not selected as a replacement for the working all-particle regime. Manual slice count and XY scale remain the first visibility controls; adaptive depth, moment visibility, learned/shared support context and local carrier exchange remain later contenders.

For stronger reaction-driven motion, begin by distinguishing the existing heat-driven rise and consumed-potential support growth from base grid transport. A residual buoyancy/expansion model could then be compared with that baseline. Reapplying the grid's bulk buoyancy blindly could distort a good flame. Neighbor exchange, new velocity solves and grid feedback are separate, more expensive architectural choices.

## Source map

- [Carrier state, reaction, motion and rendering](../volume-optical-particles.mjs)
- [Acquisition and source-region proposal](../volume-particle-acquisition.mjs)
- [Depth representation](../volume-particle-depth.mjs)
- [Workbench controls and operations](../experiments/optical-particles.experiment.mjs)
- `volume-core.js`: shared reaction configuration, effective time scale and native scene integration.

Source revision for the behavior described here: `a497b09c2759126956162241d4364fd0a965dbfe`. This naming/documentation update changes no simulation behavior. The integrator’s acquisition/transport/preparation coupling is a distinct question from the underlying grid-physics comparison and the grid-configuration performance ladder. Their results can later inform this method’s configuration choices.
