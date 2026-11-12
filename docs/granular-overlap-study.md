# Overlapping local preparation study

The first matrix tests whether local settling can create a coherent arrangement
of fine grains around prescribed coarse stones. It compares a whole-layer solve
with 2x2 and 2x4 horizontal regions, fixed/shifted boundaries, and overlaps of
0.5/1 nominal fine-grain diameters: nine cases. It uses the existing Cannon
convex contact model, not a selected final fine-earth constitutive model.

## Solve and commit

Every case starts from the same unprepared, non-overlapping near-contact columns.
Grain orientations and shapes are seeded. Exact rotated vertical bounds place
successive grains above preceding grains, the floor and any parent whose footprint
could intersect them; physical settling creates the resulting arrangement. Each
parent's actual rotated top is placed `anchorExposureDiameters` above the floor,
measured in nominal fine diameters. A circumradius is not a vertical height.

Each pass assigns every fine grain to one half-open central core, using positions
at the beginning of the pass. The extended overlap is a moving halo: all grains in
that window are dynamic during its solve, while all remaining grains stay as
frozen collision context. Only core rows are committed. Every canonical grain is
advanced exactly once per pass; discarded halo predictions allow neighboring
motion to affect the core without repeatedly advancing overlap grains. Core
membership moves with the boundary schedule. Sequential jobs read the latest
committed state; no internal walls or clipped grains are introduced.

`commitPolicy: "all-active"` retains the earlier repeated-relaxation contender.
It commits every active halo row and therefore advances overlap/junction grains
more often. It is a separate numerical scheme, not equal-work or equivalent
physical time. Both committed visits and dynamic evaluation visits are recorded.
The default is the provisional core variant, not a final solver selection.

Four shifted passes use `[0,0]`, `[.25,0]`, `[0,.25]`, `[-.25,-.25]` cell offsets.
Outer specimen boundaries remain fixed. A 2x2 grid has one four-way junction;
2x4 adds three junctions and shorter cells. These are horizontal partitions of a
thin layer. All frozen neighbors remain in the first implementation: finite-halo
collision truncation and its potential savings are still untested.

## Specimen and physical limits

The initial experiment uses 256 fine grains, fixed fine solid volume 2.65e-7 m3,
a 24 mm square, nominal fine diameter about 1.51 mm, and two prescribed parent
stones. The unshifted short eight-region cell spans about four fine diameters;
the narrowest shifted edge cell spans about three. The largest overlap occupies
about one quarter to one third of those widths. This is a small decomposition
experiment, not the final fine-earth scale. Refining constituent count preserves
fine volume rather than adding a deeper pile.

Default `stages: 0` tests settling only. The preceding compression pilot requested
a gap that could not contain 82 of its 256 rigid grains. Compression/distressing
is consequently deferred; this first matrix does not test transfer under load.
Optional positive stages retain the reference-derived common platen schedule.
A candidate gap below any grain's inscribed-sphere diameter is rejected as
geometrically impossible, rather than forcing interpenetration. Passing that
necessary check alone does not guarantee that the bed can fit. Median-height
compression of a shallow, varying-size layer is not a general pressure model.

A small deterministic floor-contact diagnosis motivated `dt: 1/480`: the previous
1/240 step left about 25.6 micrometers of single-grain floor penetration; halving
it reduced that particular error to about 0.154 micrometers. This does not validate
many-grain packing. Reported contacts, floor/lid penetration, residual motion and
actual images remain evidence to inspect. No cohesive matrix, breakup, weathering,
periodic tile, many-orders refinement or inertial-trajectory equivalence is supplied.
Parent preparation time stays held while local numerical relaxation clocks advance.

## Inputs, execution and retained state

```sh
node tools/granular-overlap-study.mjs CONFIG_JSON OUTPUT_DIRECTORY EXPECTED_GIT_SHA
```

`experiments/granular-overlap.reference.json` chooses the whole case only
(`grids: []`). `experiments/granular-overlap.study.json` chooses the full matrix.
Heavy physical runs and timing comparisons use GPU Greenroom. A reference must
be inspected before the full matrix is interpreted as a comparison of useful
packing. Output paths belong to the caller.

The manifest (`kaminos.granular-overlap-study.v2`) records actual source/dirty
state, route, configuration, hashes and failed phase. It is written before
source/configuration admission. Every prepared/final snapshot is retained.
Trajectories are lossless committed-grain deltas: start from the complete initial
state, replace the listed IDs and apply each lid height. Dynamic halo predictions
are reproducible from the recorded input/window and canonical previous state;
they are not committed material state. No output sampling or retention cap is
introduced. Version 2 identifies the explicit commit policy and near-contact
protocol; earlier experimental manifests require their original viewer revision.
A completed run establishes execution, not visual quality or a speedup.

## Shared Workbench consumer

Open `?workspace=workbench&experiment=granular-overlap&experiment_inputs=JSON`
with an explicit served `manifest` URL. The matrix changes snapshots in the same
camera and source registration. Inspect integral is an in-place SurfaceTeacher
toggle; controls remain visible. Region bounds are an optional overlay excluded
from the optical source, and follow applicable case changes.

Admission checks hashes, producer route, complete configuration, case descriptor,
geometry/inventory/extent, prescribed parent rows and parent clock against the
hashed initial state. Invalid input preserves the displayed specimen. Partial
cases remain unavailable. Agent operations use the same contribution: `reload`,
`select({id})`, `render`, `regions`, `renderSettings` and `renderCapture`. Camera,
selection, transforms and lighting remain native. This is a controlled comparison
surface, not the finished material-authoring cabinet.

## Fine-grain locality experiment

`tools/granular-fine-study.mjs CONFIG OUT EXPECTED_SHA` supports an explicit
`pilot` (three named representative regions, no completed specimen claim) and
`settle` (all regions and all requested settling passes) mode. The 300x recipe is
`experiments/granular-fine-300x.json`: 76,800 fine grains at fixed total volume,
about 0.226 mm nominal diameter, a 12x12 region grid, and dt 1/1440 s.
Every final visible grain uses its own solved rigid-hull pose.

Each job constructs dynamic core/halo bodies and frozen neighbours whose bounding
spheres intersect its retained three-dimensional bounds. Large parent stones are
indexed separately. Each substep must keep every active enclosing sphere within
those bounds; escape discards the prediction and retries from the same input
with doubled padding. Core commits and sequential exchange retain the previous
provisional semantics. Fresh/restored body poses invalidate their initial AABBs.

Initialization, solve, trajectory writes and final spatial diagnostics have
separate timings. Pilot projections use initial sampled costs and do not measure
evolving contact density. Pilot-only cases have no completed snapshot. Full runs
retain initial hulls, all committed deltas, full-pass checkpoints and final state.
Source triangles are derived from these same saved hulls rather than duplicated.
