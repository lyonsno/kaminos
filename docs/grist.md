# Grist: reuse map and first material hierarchy

Status: source-grounded design proposal, 2026-11-13. No Grist solver or runtime API is implemented by this document. It records a proposed first build and the choices that still need concrete numerical definitions. Existing code inspection establishes reuse opportunities, not a composed performance result.

## Purpose

Make a dense particulate earth source that can be worked interactively, retain the material's preparation history, and resolve finer local rearrangement before freezing it for expensive integration and learned appearance. The first useful phenomenon is cohesive fine material moving around hard grit, holding together while worked, and separating into independently moving material when sufficiently distressed.

The selected approximation posture allows coarse mechanics to drive much finer material, with damped or staggered local rearrangement and selective feedback. Fine motion must retain locally and regionally coherent material history. Full reciprocal fine-scale mechanics is not the first target. This permission does not make a purely decorative resampling of visible grains equivalent to locally evolved material.

## What already exists

| Source inspected | Existing capability | Reuse recommendation and gap |
| --- | --- | --- |
| Kaminos `mls-juice-solver.mjs`, `mls-juice-contract.mjs`, pinned `vendor/splash-mls-mpm/` at main `e16a7ac55d52a492fca11ed37831b6f28829dcc0` | Same-device resident WebGPU buffers and quadratic 27-node APIC transfers. The fluid law evaluates pressure and viscosity from density and affine velocity. | Reuse transfer/device conventions and focused shader-test infrastructure. The particle record has no persistent deformation or plastic/damage history, assumes unit particle mass in upstream transfers, and uses one grid velocity. The water emitter's lifetime and backlog-shedding policy are not Grist material/history semantics. |
| Hill material specimen at `0b021ce51c2ae8463d8b98bef1f7000c9952773b`, `experiments/hill-terrain/{soil-material,volume-model,volume-kernels,volume-gpu}.mjs` | Persistent mass, reference volume, APIC affine motion, pressure/deviatoric stress and compaction memory; temporary GPU grid; equal/opposite rigid contact impulses and torque. | Strongest local starting point for mechanics. Borrow selected kernels/state organization with exact source provenance, not a maintained fork of the terrain product. The existing pressure-dependent frictional law releases tension and cannot supply cohesive clay/crumb or fracture. Its extracted occupancy skin is not our fine particulate representation. Hill code is on its feature work, absent from the audited main tree. |
| [MLS-MPM/CPIC](https://github.com/yuanming-hu/taichi_mpm/tree/3a680ab0fdc6e95077f08a91bc9079e1ef41478e), MIT | Full 2D/3D native implementation: persistent deformation, material-specific plasticity, compatible transfers around discontinuities and rigid-body coupling. | Use as a mathematical/source reference and selectively port needed pieces. It is legacy C++/Taichi infrastructure, not a current browser package. Its sand cohesion parameter does not by itself establish a complete clay fracture model. |
| [HOT](https://github.com/penn-graphics-research/HOT/tree/d8d57be410ed343c3fb37af6020cf5e14a0d1bec), MIT | Implicit MPM time stepping, nonlinear solve and multigrid operators/preconditioning. | Candidate for stiff coarse mechanics if explicit stepping proves the wrong bargain. This numerical hierarchy does not implement a hierarchy of coarse carriers and fine visible material. A full native solver port is not required to begin the material experiment. |
| [Hybrid Grains](https://github.com/peterchencyc/libHybridGrains/tree/1e311642b9f81a6a21bb3deef000db322e7dcc5f), GPLv2 | Adaptive discrete/continuum zones; grain/grid coupling; resampling, mass/volume reassignment and stress/velocity reconstruction. | Study its transition accounting and coupling. The released repository explicitly contains the 2D implementation and says no 3D release timetable. Do not treat it as a drop-in 3D WebGPU foundation or copy it into the current MIT code without a licensing decision. |
| [Ihmsen, Wahl and Teschner's high-detail granular framework](https://cg.informatik.uni-freiburg.de/publications/2013_CG_LagrangianFrameworkForGranularMaterialInHD.pdf), 2013 | Published coarse/fine granular approach with fine local dynamics driven by a coarse solve. | Relevant precedent for the coarse/fine approximation. The abstract and available primary description were inspected; the full large PDF was not read in this audit. No author source release was verified in the searches. This is an unresolved source search, not proof none exists. |

External implementation inspection was source-only. None was built or benchmarked here. Published runtime figures are not predictions for our M4 Max/WebGPU composition.

## Concrete modifications before reuse

### Material state and units

Separate material identity and history from the temporary grid. A coarse material sample needs mass, reference volume, position, velocity, affine motion, an appropriate strain/stress representation, accumulated plastic/compaction state and material identity. Cohesion loss and attachment information must survive grid clearing. Choose the constitutive state actually required by the selected law; do not carry both a full deformation-gradient model and a separate rate-form model without a reason.

Use one explicit world/model conversion for length, time, mass, stress and collision sizes. Hill's `FP = 1048576` encodes SI mass directly into integer grid accumulation. Its mass quantum is about `9.54e-7 kg`. For illustration, a sphere of radius `0.11 mm` and density `1600 kg/m³` weighs about `8.92e-9 kg`, before its mass is divided among stencil nodes. The current encoding can quantize all those contributions to zero. Normalize quantities into an adequate numerical range or change the accumulation representation; audit overflow and resolution together. This is a concrete porting issue, not a measured runtime failure in a Grist solver.

### Constitutive behavior and separation

Hill's law clamps pressure nonnegative and bounds deviatoric stress by friction times pressure. Its resistance vanishes without compression. Reusing it unchanged would give granular continuum behavior, not cohesive fine material that stretches, smears or retains a crumb.

The first proposed material family is frictional elastoplastic matrix with tunable cohesion and irreversible weakening under deformation, plus rigid two-sphere grit. The existing MLS-MPM sand/plasticity code supplies a reference for deformation and yield projection. The exact cohesion, weakening and residual friction laws remain to be defined and tested; no calibrated clay claim is implied.

Reducing a cohesion scalar is insufficient to ensure an open crack. A single grid velocity can keep separated nearby material artificially coupled. Define how intact neighbors are recognized, what breaks their mechanical compatibility, and how independently moving regions transfer through shared cells. CPIC supplies a discontinuity/coupling precedent; it does not automatically discover the fracture topology we want. Material type alone is not a valid body/separation identifier.

### Coarse and fine representations

Begin with one coarse mechanical level and one fine material level. The coarse level carries the region's bulk momentum and constitutive history. Fine particles retain identity, position, local geometry and attachment to coarse support. Their velocity starts from that support's local affine field, then receives local contact/rearrangement corrections. Direct fine particulate rendering must express this state instead of hiding it beneath an occupancy skin.

Choose explicitly whether each fine set replaces part of the coarse represented mass or samples that same mass for detail. It must not deposit a second copy of that mass on the mechanical grid. Splitting must preserve mass, center of mass, bulk motion and inherited history. Refinement alone must not create a new material preparation or invent extra porosity.

Fine particles can be updated in overlapping, moving local regions and damped toward support. Their interactions need a local neighborhood and persistent history, rather than global pairwise work or fresh random placement. A fine particle that leaves its support needs a defined free-motion/contact route. Reattachment must not silently heal a broken history.

Selective feedback is proposed: routine fine residual motion need not update the entire coarse solve; meaningful detached mass, newly opened voids or incompatible regional motion must update coarse support/ownership. The numerical thresholds and aggregation operation remain experimental design work. This is a material/detail hierarchy, separate from HOT's multigrid solve hierarchy.

### Rigid grains and feedback

Retain the current two-sphere rigid representation for fine grit, including orientation, inertia and off-center contact response. Use its analytical query in the continuum/grid contact path rather than inheriting Hill's complete convex-rock SAT system for every tiny grain. Preserve opposite linear/angular impulse accounting where the coarse solve claims reciprocal contact. A fine-only relaxation may be one-way under the chosen approximation, but must expose that effective coupling honestly.

### Time and output

Keep operator interaction responsive while refinement advances through explicit physical/material time. The visible live state, pending fine work and frozen integrated snapshot must identify their actual completion state. A queue must not silently turn the live tool into a delayed scripted action. Reuse native tool transforms, shared playback, the Workbench and existing integrator inputs. Do not import the water emitter's particle expiry or silently discard an authored manipulation history.

The frozen source is the finest completed material state, with analytical grains/particulates and relevant optical parameters. Rendering resolution and the physical carrier resolution remain independent. No new general path tracer is required to establish this mechanical composition.

## Recommended first build

Adapt the local GPU APIC material core into a separate Grist module, retaining the existing water and Hill consumers. Borrow source explicitly rather than rebasing the whole fine-earth program onto either product branch. Start from the current main tree and port only the needed dependencies.

Connect one cohesive matrix region, embedded two-sphere grit and the ordinary movable forming tool to one fine particulate level. The decisive interaction is to press and then drag material around a hard inclusion: inspect regional deformation, local fine rearrangement and, once the separation mechanism is present, a detached portion moving independently. Show the actual particulate material and preserve state through refinement. Start with the same material state when comparing coarse and refined evolution.

This build must answer whether the hierarchy buys useful fine material motion without reintroducing the previous global pairwise expense. It need not begin with many material species, wet soil, all fracture modes or HOT's implicit multigrid. Those remain accessible branches if the first behavior or explicit-step cost identifies a concrete need.

## Source inspection record

Local base: `e16a7ac55d52a492fca11ed37831b6f28829dcc0`; design branch `cc/grist-source-audit-1113`. Hill reference above was inspected through `git show` in a worktree; its files were not materialized in that older worktree's sparse working directory. No primary-checkout source mutation occurred.

External files inspected through connected GitHub tools at the pinned commits:

- MLS-MPM: `README.md`, `LICENSE`, `src/particles.h`, `src/particles.cpp`, `src/rigid_transfer.cpp`, `src/mpm_rigid_body.cpp`. Particle state explicitly includes elastic deformation, APIC affine momentum, mass/volume and compatibility states. Sand uses an SVD/log-strain yield projection; the rigid boundary path rasterizes/gathers compatibility information.
- HOT: `README.md`, `LICENSE`, `Projects/multigrid/MultigridSimulation.h`, `MultigridSimulation.inl`, `MultigridInit.h`. The backward-Euler route invokes Newton/LBFGS and builds coarse grid operators with restriction/prolongation; it does not evolve a second visible fine population.
- Hybrid Grains: `README.md`, `license.txt`, `hybridgrains2dnew/Coupling.h`, `ResamplingTools.h`. These expose distinct grain/grid masses and momentum, transition-zone resampling and mass/volume/history reconstruction.

This is a planning/source audit, so no new runtime tests or performance assays were run. Future shader changes must execute production WGSL through the existing native shader tests; inspection of shader source here is evidence about implementation organization only.
