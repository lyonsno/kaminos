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

## Compatibility audit before implementation

Operator request, 2026-11-13: identify decisions in HOT and Hybrid Grains that differ from MLS-MPM or from the proposed composition before changing them. No solver code had been written when this request arrived. These are actual implementation differences, not categorical mathematical impossibility claims.

### HOT's released MLS path is explicit-only

At the pinned HOT revision, `Lib/MPM/MpmSimulationBase.cpp:102–104` requires `mls_mpm` to use quadratic/cubic APIC and `symplectic == true`. `Projects/multigrid/MultigridSimulation.h:188` implements a backward-Euler nonlinear solve with coarse system matrices and transfer operators. HOT is not a switch beneath our explicit MLS force kernels. Combining them would require consistent force/stress derivatives, boundary treatment and coarse operators. Retaining APIC alone does not establish that consistency. Choosing the local explicit core provisionally forgoes HOT's demonstrated stiff implicit stepping and convergence benefit.

Primary code: [HOT initialization](https://github.com/penn-graphics-research/HOT/blob/d8d57be410ed343c3fb37af6020cf5e14a0d1bec/Lib/MPM/MpmSimulationBase.cpp#L94), [implicit step](https://github.com/penn-graphics-research/HOT/blob/d8d57be410ed343c3fb37af6020cf5e14a0d1bec/Projects/multigrid/MultigridSimulation.h#L188).

### Hybrid Grains' transfers and reconciliation differ

The released 2D implementation uses a PIC/FLIP velocity blend in `mpmgrains2d/MaterialPoints.cpp:204–245`; `PhysicsGrid.cpp:274` rasterizes mass times point velocity without the APIC affine term. APIC/MLS need not be mathematically incompatible with hybrid coupling, but replacing transfers changes numerics and requires affine/rotational response and momentum accounting to be checked.

`hybridgrains2dnew/Coupling.cpp:533–580` exchanges equal/opposite impulses between continuum and discrete grid momenta and checks matching velocities. The driver separately weights material mass in the overlap, resamples regions and reconstructs state. Coarse full-mass mechanics plus one-way fine local detail is an alternative approximation. Retain no-double-mass accounting and explicit history transfer; dropping reciprocal reconciliation does not retain their coupled mechanical validation.

Its continuum law is pressure-dependent Drucker–Prager-style granular plasticity (`ConstitutiveModel.cpp`), with zero shear yield when uncompressed/expanded. Cohesive clay, bond weakening and fracture are intentional new material behavior. Resampling and history reconstruction also require adaptation for persistent fine identity/damage. The paper discusses different DEM/MPM stability limits; separately, the released 2D driver rejects unequal discrete/continuum timesteps at `HybridGrains2DSim.cpp:237`. Staggered local clocks are another extension, not something established by adopting the release.

Primary code: [PIC/FLIP update](https://github.com/peterchencyc/libHybridGrains/blob/1e311642b9f81a6a21bb3deef000db322e7dcc5f/mpmgrains2d/MaterialPoints.cpp#L204), [reconciliation](https://github.com/peterchencyc/libHybridGrains/blob/1e311642b9f81a6a21bb3deef000db322e7dcc5f/hybridgrains2dnew/Coupling.cpp#L533), [material law](https://github.com/peterchencyc/libHybridGrains/blob/1e311642b9f81a6a21bb3deef000db322e7dcc5f/mpmgrains2d/ConstitutiveModel.cpp), [driver](https://github.com/peterchencyc/libHybridGrains/blob/1e311642b9f81a6a21bb3deef000db322e7dcc5f/hybridgrains2dnew/HybridGrains2DSim.cpp).

### Additional browser implementations

[EA PB-MPM](https://github.com/electronicarts/pbmpm/tree/61749b6c2d2631ed243f86882752ba43196f2de7) is a substantial additional contender: WebGPU WGSL, optimized main and readable `siggraph2024` branches, BSD-3-Clause. The released particle/grid state is **2D** (vec2/mat2), not a drop-in 3D solver. Its current `g2p2g.wgsl` includes sand plasticity and local displacement correction. The [two-page paper](https://media.contentapi.ea.com/content/dam/ea/seed/presentations/seed-siggraph2024-pbmpm-paper.pdf), read in full, uses MLS-MPM quadratic transfers with iterative compliant constraints. Iteration-dependent softness is an explicit tradeoff. The paper describes deleting badly conditioned elastic particles. The disable path inspected in the current shader is an authored drain, not evidence that this older stabilization strategy remains in current main; current conditioning handling is not yet established. A port must use the effective implementation rather than silently inheriting the paper-era deletion policy. PB-MPM is now a formulation contender alongside explicit MLS and a larger HOT-style implicit solver, not an adopted replacement.

[WebGPUMPM](https://github.com/chetan-parthiban/WebGPUMPM/tree/37802a61fafb7faa1ab20db18b71450b3847f5ab) is an older 3D fluid/jello/snow reference. Checked source uses GLSL-to-SPIR-V and obsolete WebGPU APIs (`computeStage`, shader `transform`); the browser label does not establish present compatibility. Its README discloses accelerated final GIFs. [Breakpoint](https://github.com/danieljgerhardt/Breakpoint) reports a 3D DirectX PB-MPM implementation; its README/project description was located, not its full kernels audited.

External inspection was source-only; no numerical correctness or current M4/browser performance is established. HOT's PDF and the full Hybrid Grains paper could not be fetched by the web tool in this follow-up; the source-code claims above come from pinned implementations, with paper search excerpts used only for the separately identified timestep discussion.

## Recommended first build

Operator amendment, November13: omit HOT from the initial build and see the system without it. Revisit it last only if a demonstrated stiffness/convergence problem warrants that optimizer. This removes the initial need for the global nonlinear objective, consistent implicit derivatives, stiffness-matrix construction, Galerkin hierarchy and nonlinear optimization machinery. It does not remove the proposed hierarchy of material representations.

PB-MPM is the leading proposed live core. Adapt its iterative particle/grid material solve into a separate Grist module, retaining existing water and Hill consumers. No runtime formulation has been implemented yet. Borrow source explicitly rather than rebasing the whole fine-earth program onto either product branch. Start from the current main tree and port only the needed dependencies.

### Actual EA material examples and the constitutive fit question

Operator follow-up, November13: determine whether elastic shape preservation requires fundamental changes for our target, using concrete examples rather than broad material categories. At pinned EA61749b6, `scenes/manifest.json` lists Dam Break, SEED Logo, Rubber, Plastic Press, Box Fracture and a folding scene titled Other Brands Are Available. Configuration inspection identifies liquid plus elastic bodies in Dam Break, elastic material in Rubber and Box Fracture, and material3 (`MaterialVisco`) in Plastic Press and folding. These are source/configuration findings, not an exercised visual judgment of the demos.

Crucially, `shaders/g2p2g.wgsl:230–294` already separates material plasticity from the iterative solve. The Visco path modifies retained deformation by clamping singular stretches to a yield band and restoring its prior determinant; it therefore supports permanent deformation while preserving volume during that plastic update. The Sand path uses pressure-dependent plastic projection, including releasing expansion. Elastic/Visco share a restoring solve, but plastic evolution changes what deformation remains recoverable. The pure elastic option's return toward its original state must not be described as a universal requirement of PB-MPM. Constitutive extension is an existing implementation seam; it does not by itself establish convincing soil.

Outstanding material questions before investing in fine hierarchy: whether the Visco response gives a useful matrix after unloading; whether desired compaction is mostly void closure or requires evolving continuum porosity; whether separation follows an authored damage/cohesion history rather than ordinary loss of grid support; and whether these material/contact changes retain useful behavior at the live iteration budget. The scene name Box Fracture alone establishes none of those fracture properties. Recommended next material observation is press/unload, shear and neck/pull of the matrix itself before interpreting a composite dirt result. This is a proposed sequencing change for discussion, not an executed assay or replacement of the final hierarchy goal.

The proposed composition separates a continuum timestepper from representation management. PB-MPM supplies candidate material motion; analytical rigid grains supply independent translation/rotation and local contact. A coupling stage must reconcile the two before motion is committed. Hybrid Grains supplies precedent for reciprocal reconciliation, mass ownership and switching representation; it does not demonstrate this exact PB-MPM combination. Individual solver stability is not a stability guarantee for the composed system. Our persistent fine-detail hierarchy and cohesive weakening remain additional design work. Start with fixed representation regions and establish a useful coupled manipulation before adding dynamic enrichment/homogenization.

Keep two interfaces distinct: clay contacting a mineral grain joins different physical constituents and needs nonpenetration, friction, possible slip/separation and reciprocal torque. A coarse and fine description of the same clay joins two representations of the same material and needs consistent mass/history ownership. Hybrid Grains' overlap velocity agreement addresses the latter kind of reconciliation; imposing it indiscriminately on clay/grit would create an unintended sticking constraint.

### Live control between representations

Operator amendment, November13: preserve tunable places to shift control between bulk PB-MPM and local/discrete work, especially where the live core should constrain the finer solve. Proposed controls govern different mechanisms rather than a single global dominance blend:

- **Following:** how strongly attached fine material follows its coarse support's affine motion while retaining local rearrangement. This is a representation relationship, not an adhesion rule for separate mineral grains.
- **Feedback:** how much aggregated fine residual motion or stress changes coarse support. One-way fine detail is an explicit approximation; detached mass still requires an actual ownership change. Keep reciprocal mineral/matrix contact accounting distinct from this optional detail feedback.
- **Contact compliance:** how firmly distinct constituents resolve relative penetration and slip within the coupled candidate-motion iteration. Apply the same contact correction consistently to both participants, including torque; do not tune two unrelated reaction gains.
- **Solve effort:** bulk iterations, fine local updates and their schedule. These are numerical choices; their effect on apparent material behavior must remain legible rather than masquerading as a new physical material parameter.

The PB-MPM paper describes displacement constraints reconciled by grid transfers, with motion committed after iteration, and identifies iteration/timestep-dependent softness. Its shape-preserving elastic constraint is not a clay plasticity law. Our proposed loop is bulk candidate motion, local/contact correction, coupled reconciliation, then commit, with additional iterations as needed. Adding those corrections does not inherit the original stability claim automatically.

Live default proposal: strong regional following for attached fines, local freedom for rearrangement, modest aggregated detail feedback, and reciprocal contact for actual rigid grains. Persistent disagreement is evidence to change support/ownership or add local resolution, not to pull escaped material back forever. Increasing finish effort should retain the same intended material and history while making the effective numerical change explicit. These are proposed mechanism controls, not an implemented API, a frame-rate promise or a requirement to expose every numerical parameter in the initial human interface.

Connect one cohesive matrix region, embedded two-sphere grit and the ordinary movable forming tool to one fine particulate level. The decisive interaction is to press and then drag material around a hard inclusion: inspect regional deformation, local fine rearrangement and, once the separation mechanism is present, a detached portion moving independently. Show the actual particulate material and preserve state through refinement. Start with the same material state when comparing coarse and refined evolution.

This build must answer whether the hierarchy buys useful fine material motion without reintroducing the previous global pairwise expense. It need not begin with many material species, wet soil, all fracture modes or HOT's implicit multigrid. Those remain accessible branches if the first behavior or explicit-step cost identifies a concrete need.

## Source inspection record

Local base: `e16a7ac55d52a492fca11ed37831b6f28829dcc0`; design branch `cc/grist-source-audit-1113`. Hill reference above was inspected through `git show` in a worktree; its files were not materialized in that older worktree's sparse working directory. No primary-checkout source mutation occurred.

External files inspected through connected GitHub tools at the pinned commits:

- MLS-MPM: `README.md`, `LICENSE`, `src/particles.h`, `src/particles.cpp`, `src/rigid_transfer.cpp`, `src/mpm_rigid_body.cpp`. Particle state explicitly includes elastic deformation, APIC affine momentum, mass/volume and compatibility states. Sand uses an SVD/log-strain yield projection; the rigid boundary path rasterizes/gathers compatibility information.
- HOT: `README.md`, `LICENSE`, `Projects/multigrid/MultigridSimulation.h`, `MultigridSimulation.inl`, `MultigridInit.h`. The backward-Euler route invokes Newton/LBFGS and builds coarse grid operators with restriction/prolongation; it does not evolve a second visible fine population.
- Hybrid Grains: `README.md`, `license.txt`, `hybridgrains2dnew/Coupling.h`, `ResamplingTools.h`. These expose distinct grain/grid masses and momentum, transition-zone resampling and mass/volume/history reconstruction.

This is a planning/source audit, so no new runtime tests or performance assays were run. Future shader changes must execute production WGSL through the existing native shader tests; inspection of shader source here is evidence about implementation organization only.
