# Generated Part Authoring and Shape Recovery

This is a source map of the shared authoring project: known construction and
motion acquire rich generated surfaces, and those surfaces return to useful
authored control. It connects existing implementations and their artifacts;
it does not introduce a common API or claim that all stages are integrated.

Source inspection: November 6, 2026. Kaminos main at inspection was
`5b9e91334b3ec328e1e03bd7f8fb946f76e2170c`. The mechanical, registration and
Stockroom implementations listed below were on feature branches, not that
main. Their exact refs matter when choosing a working composition.

## The Shared Project

An author should be able to build a structure or apparatus at a useful level
of abstraction, give its parts generated geometric richness, and continue
editing the construction. A beam, brace or plate can become a support; supports
can become floors, walls and towers. Moving apparatus adds known bodies,
mounts and motion relationships. Generated appearance should survive useful
changes rather than freezing the result into an unrelated static asset.

The intended round trip is:

```text
authored construction, part identities, forms and interfaces
  -> source geometry / image conditioning
  -> generated image and reconstructed surface
  -> registration and corresponding part/feature observations
  -> geometric correction toward the authored form
  -> detailed generated geometry bound to editable construction
  -> placement, repetition, motion and another authoring operation
```

There are worked paths through these stages, not a single automatic compiler.
The pipeline is shared through retained geometry, identities, coordinate
frames, plans and returned geometry. A new consumer can compose those stages
without pretending that unknown-part recognition has already been solved.

## Existing Machinery

Refs in this table identify inspected source, not an instruction to merge an
entire feature branch. File paths are relative to the named repository at that
ref. Some early fitting tools are retained episode snapshots rather than a
versioned shared library; that distinction is preserved below.

| Stage | Existing implementation | Actual responsibility |
| --- | --- | --- |
| Authored moving carrier | Kaminos `cc/hostile-actuator-1017` at `90a1b8e95419c468b36ead97cc2db17070840f87`: `piston-arm-kit.mjs`, `tools/piston-arm-scene.mjs`, `docs/piston-arm-kit.md` | Compiles editable primitive geometry, known rigid groups and an actuator from an authored template. Retains known source membership; it does not infer returned ownership. |
| Registration and part proposals | Kaminos `cc/hostile-registration-viewer-1021` at `f393e3e08ed56ead33161f34b4853aa8c4fe3786`: `registration-viewer.mjs`, `registration-joints.mjs`, `registration-retention.mjs`, `tools/registration_surface.py`, `docs/registration-surface.md` | Allows revisable source/target registration and joint guesses. Independent geometric claims preserve overlap and unclaimed surface. Surface-connected claims can return textured role proposals; these are not automatically recovered mechanical parts. |
| Gross dimensional recovery | Retained hinge-fitting snapshot: `fitlib.py`, `prepare_baked.py`, `check-loader.mjs` | Fits a body-wise inverse affine against known source geometry. Uses symmetric, area-weighted correspondence. Bakes the correction rather than relying on a GLTF node to preserve shear. |
| Known exterior-profile recovery | TRELLIS `cc/hostile-exploded-hinge-1025` at `b203d2868c69cf369839a838d875ee1fa501d5ed`: `scripts/known_axial_profile_rectify.py` | `outer_sections` retains contour evidence; `fit_profile` recovers a known ordered three-section exterior profile. `warp_with_jacobian` maps recovered axial stations, centerline and radii to the authored profile. |
| Known bore recovery | Same TRELLIS ref: `scripts/known_bore_rectify.py` | Measures matching generated/authored bore sections, optionally fits observed ovality, and constructs a local center/radius/ellipse correction with a fade to unchanged distant geometry. |
| Corrected surface export | `export_deformation` in `scripts/known_axial_profile_rectify.py` | Applies the deformation to positions and inverse-transpose Jacobian transport to normals. Checks preserved index, UV and embedded-image buffers on the retained single-node/single-mesh binary GLB route. Returns placement and output identity. |
| Generated hinge consumer | Kaminos `cc/hostile-hinge-assembly-1028` at `c42746641`: `hinge-assembly-motion.mjs`, `experiments/hinge-assembly.experiment.mjs` | Exercises corrected generated skins beside their authored counterparts using the known joint axis. It is kinematic assembly playback, not a contact/force solver. |
| Editable body appearance and mounts | Kaminos `cc/hostile-surface-folding-1105` at `d7dfb2c2844bac037d4f3282effa5ee6718b832b`: `experiments/link-workshop/{bodies,model,record,mounts,attachments}.mjs`, `docs/link-workshop.md` | Hostile's construction shares Hospital's mounting work. Body-local geometry export/import retains body identity; mounts and attachments retain construction frames. Returned geometry, history and ordinary scene persistence are existing consumers for appearance replacement. |
| Surface decomposition | Same Kaminos ref: `experiments/link-workshop/surface.mjs`, `docs/surface-articulation.md` | Clips actual surfaces at authored seams, retains UVs/materials, caps planar boundaries and returns editable hinged panels. This is related surface machinery, not a replacement for dimensional correspondence. |
| Stock families | Kaminos `cc/stockroom-mouths-1105` at `4ab9930ad0b25209fa4878078d8feadf0e8baf47`: `experiments/stock-family/{model,source,rest-arc,mouths,library}.mjs` | Fits explicit source axes/rest arcs, deforms length/curvature with protected bands, aligns declared mouth frames, and retains families internally. It does not yet fit generated sections to an authored section or correct actual mating surfaces. |

## How Correction Is Composed

The existing fitting work separates three questions that a good aggregate
alignment score cannot answer together:

1. Where is the generated body, and what gross proportions differ from its
   authored counterpart? The affine stage addresses that placement and broad
   dimensional component.
2. Which observed surface belongs to each intended feature? Section diagnostics
   retain connected contours, candidates, rejection reasons and explicit source
   priors. An intact bore contour cannot stand in for an unresolved exterior.
3. How does that observed feature map to the authored feature while useful
   generated detail survives? The profile/bore stages construct the deformation;
   export carries both geometry and normals through it.

The pin plan supplies an input GLB identity and placement plus authored axial
knots, radii, transition widths and centerline. The bore plan supplies generated
and authored GLB identities/placements, matching named sections, a fade radius,
and the exact section-diagnostic path and digest. The implementations measure
the generated geometry; those plans are not merely labels attached to a warp.

From the selected TRELLIS checkout and its Python environment, both correction
commands use caller-owned plans and report destinations:

```sh
python -m scripts.known_axial_profile_rectify --plan PLAN.json --report REPORT.json
python -m scripts.known_bore_rectify --plan PLAN.json --report REPORT.json
```

Each part's output location is chosen in its plan. Retained example plans name
historical outputs; they are examples of the actual data flow, not disposable
paths for a new run. The export checks preserved buffers and refuses a changed
result at an occupied destination. Failure reports retain their phase and
error. Generation, fitting and export remain distinct operations.

The numerical evidence is feature-specific. For example, the retained supplied
pin's head section moved from radius 0.264226 to 0.354724 against an authored
0.349789, while its shaft received a different correction. The bore continuation
also corrects observed ovality. These are actual dimensional repairs, not
whole-object scale or successful frame alignment presented as surface recovery.

The focused existing TRELLIS checks are:

```sh
python -m unittest tests.test_known_axial_profile_rectify tests.test_known_bore_rectify
```

They cover independent feature correction, recovered profiles, Jacobians,
retained distant detail, ovality, unresolved features and exterior/inner-contour
confusion. They exercise the local machinery, not every external stage of the
round trip or a new Stockroom integration.

## Stockroom's Missing Composition

`loadStockSource` currently loads a verified surface, calls `fitStockSource`
for declared axis/rest-arc normalization, and passes the result to the stock
family deformation. `stockMouthFrame` describes a frame transported by that
deformation; `alignStockMouth` changes placement. Neither operation establishes
which actual rim vertices correspond to a common authored mating section.

The useful integration point is between source recovery and family deformation:
observe the relevant source sections and end surfaces in the recovered frame,
establish their correspondence to a chosen nominal family, and correct them
before transporting the detailed surface through authored family changes.
This is the identified continuation, not an implemented adapter or new schema.

An open channel needs an appropriate open-section feature model. The existing
bore recognizer's enclosing-contour rule and the pin fitter's three ordered
diameters describe their actual parts; treating a channel as either would
change the problem. Their separation of observation, correspondence, correction
and export is directly useful, as are the retained contour/Jacobian tools.
Section shape, wall thickness, rim identity and end plane are the channel's
consequential features. Supports and generated mesostructure must remain
accounted for rather than being silently absorbed into a fitted circle.

This correction serves construction beyond plumbing. Shared authored dimensions
and interfaces should let richly generated stock become reusable bays and
structures. An adapter or collar may be a desired part, but is not proof that
an intended matching section was recovered. Likewise, a successful fluid
handoff does not by itself establish the Stockroom construction experience.

## Reuse and Documentation Routing

The versioned profile and bore correction commands above are directly
inspectable and have focused tests. The gross-fit and section-diagnostic
snapshots are not yet a portable shared-library installation. In particular,
the bore command's plan names a section-diagnostic path and verifies its digest
before loading it. That dependency belongs in the consumed plan; a same-named
file is not sufficient source identity. A source-snapshotted stage and an
installed reusable component remain different integration states.

Creature semantic return is an adjacent authoring project, not an assertion
that the mechanical fitters recover arbitrary anatomy. The common opportunity
is generated geometry returning to durable, useful authored control.

Kaminos documentation owns this implementation map; component documentation and
source own their concrete interfaces. The map gives collaborators a shared
entry point without duplicating every experiment or describing branch-only
capabilities as already available on main. Repetition and lighter views remain
behind original asset identity and the existing LOD architecture, rather than
an operator-managed second stock inventory.
