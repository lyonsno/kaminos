# Authored finite water: neighbors and optional walls

Finite PBF water indexes particles in world-space cells. The shared **Invisible
container** checkbox enables physical collision and boundary-density support.
Its dimensions govern those walls only. With walls disabled, placed water and
moving particles do not need to fit an authored search box. Historical
`worldBounds` values still round-trip old scenes but no longer constrain finite
water placement or neighbor lookup.

The solver hashes signed integer cell coordinates into the existing 20,480
linked bucket heads. Cell width covers the largest neighborhood used by its
assembled uniform-water kernels. Each particle stores its build-time cell and
next link in a 16-byte record. Every neighbor consumer checks that exact cell
before applying its existing distance/kernel test. Hash collisions increase
scanning work; they neither truncate neighborhoods nor duplicate contributions.
Bucket storage stays 80 KiB. Per-particle links grow from 4 to 16 bytes (12
additional bytes per particle). No CPU extent readback, moving-box maintenance,
or reallocation is needed when particles leave the former search bounds.

This route applies to assembled finite PBF with its existing optional box
support. Legacy continuous-emitter/playground and IPBF grids retain their prior
implementations. Existing optical and fire-contact field extents remain their
own contracts; world-space liquid neighbors do not extend those fields. This
change does not add scene-mesh collisions. Normal f32 position precision and
signed-integer cell-coordinate representation still apply. It makes no
performance improvement claim.

`tools/fluid-world-neighbor-witness.mjs` runs the actual solver at matching fixed
timesteps for a contained drop and two freely falling translated drops. It
retains full initial/first/final particle words and effective shader/config.
A GPU probe compiled from that shader uses cell helpers, linked-list builder and
exact-cell admission to force all stencil cells into one bucket and compare every
pair against a distance oracle. Callers supply origin, source root, output path,
independent browser module and executable. Reports survive failure. Focused Node
tests cover authoring placement, optional wall rejection and all production
neighbor consumers. Longer chaotic trajectories are reported separately from
short-step translation and aggregate free-fall checks.
