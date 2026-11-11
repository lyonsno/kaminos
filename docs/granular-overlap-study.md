# Overlapping local preparation study

This experiment compares an entire granular layer with sequential local solves
under the same prescribed compression stages. It uses the existing Cannon convex
contact model so the changed object is the subdivision method. It does not
select that solver as the final fine-earth backend, add cohesive matrix physics,
or establish a refinement speedup.

The input is `experiments/granular-overlap.study.json`. Run a caller-owned copy:

```sh
node tools/granular-overlap-study.mjs CONFIG_JSON OUTPUT_DIRECTORY EXPECTED_GIT_SHA
```

Heavy physical runs and timing comparisons use GPU Greenroom. The command writes
`manifest.json` before source/configuration admission and preserves a failed
phase and error if execution fails. Its exact source, effective route, canonical
initial state, immutable geometry hash, all case snapshots and every local
state handoff are retained. Output paths are caller parameters. A completed run
means the specified experiment executed; optical quality and method usefulness
remain observations to make.

## Compared cases

One whole-specimen reference plus a matrix:

| Regions | Boundary schedule | Active-window overlap |
| --- | --- | --- |
| 2 × 2 | Fixed / shifted | 1 / 2 nominal fine-grain diameters |
| 2 × 4 | Fixed / shifted | 1 / 2 nominal fine-grain diameters |

Four shifted passes place the interior boundaries at `[0,0]`, `[.25,0]`,
`[0,.25]`, `[-.25,-.25]` cell offsets. The outer specimen boundary stays fixed.
The 2 × 2 grid exercises a four-way junction; 2 × 4 adds junctions and shorter
patches. These are horizontal decompositions of a thin layer, not eight volumetric
subcubes. Region layout and overlap are independent input parameters.

Each grid pass selects constituents using positions captured at its start.
An active window includes whole grains by centre, never clipped geometry.
All other constituents remain as frozen collision context; no internal box walls
are introduced. The first implementation deliberately keeps all frozen neighbors,
so it tests the decomposition before introducing finite-halo truncation. Jobs run
sequentially against the latest committed state. Only active grain rows are
committed; every identity and the complete geometry/mass inventory are preserved.
Overlap means some grains are relaxed by more than one local job. Per-grain visit
counts and active-particle substeps expose that extra work; cases are not claimed
to have equal work simply because they have the same number of passes.

The parent platen lowers in prescribed stages and is held during local
relaxation. Parent preparation time stays at the shared initial state's time;
local elapsed times are numerical relaxation clocks. This does not model ageing
or claim an inertially equivalent full-resolution trajectory. The minimum platen
height respects the prescribed parent stones; requested and effective strain are
both recorded. Fine-scale velocities and poses pass between local jobs.

## Specimen and refinement

Two prescribed, partly embedded coarse stones provide common geometry. The
finer population is physically settled globally once, then that exact checkpoint
starts every comparison. Initial placement is a non-overlapping seeded grid
above the source, followed by gravity/contact preparation. The fine volume is
normalized to `fineSolidVolume`; increasing `fineCount` reduces constituent size
while preserving the amount of fine material. It does not add a deeper pile.

This is a granular filling analogue. It contains no cohesive fine matrix,
aggregate fracture or weathering. Contact/render hull identity is retained.
Metrics report mass, contact overlaps and penetration of the floor/platen;
they are evidence to inspect, not an automatic aesthetic verdict.

## Shared Workbench consumer

Open `?workspace=workbench&experiment=granular-overlap&experiment_inputs=JSON`,
where JSON contains an explicit `manifest` URL served by Kaminos. The result
matrix changes the displayed snapshot in the same camera and source registration.
Initial and whole-reference buttons provide the common baseline. Inspect integral
is an in-place toggle borrowing the actual source object. Region bounds are an
optional overlay, excluded from the optical source. Reload results admits only
hashed, complete states; partial cases cannot masquerade as results. Artifact
hash, geometry hash, inventory, extent, producer route and case identity are
checked before replacing the displayed specimen. A source/selection failure
retains the previous displayed state and shows an error.

Agent operations use the same contribution: `reload`, `select({id})`, `render`,
`regions`, `renderSettings` and `renderCapture`. Native scene transforms, camera
and lighting remain the host's. This is a controlled comparison surface, not the
finished material-authoring cabinet.
