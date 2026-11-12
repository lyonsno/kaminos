# Analytical rigid grain pairs

Each grain is one Cannon rigid body with two overlapping sphere shapes. Contact
and optical source use the same two lobes; there is no visual-only bridge,
triangulated grain or baked surface texture. The shared WebGPU surface teacher
intersects spheres analytically in the existing BVH, with native lights,
visibility and path bounces. Only the tray is triangulated.

`node tools/granular-pair-study.mjs CONFIG OUT EXPECTED_SHA` consumes an explicit
JSON configuration (`count`, `seed`, `steps`, `checkpointEvery`, optional `width`,
`dt`, `friction`, `separation`). It requires the exact clean source revision,
writes a failure manifest even before the first snapshot, and retains initial
and every requested checkpoint without changing particle count. The CPU solve
is a qualifying Greenroom workload. Particle-scaled lengths and numerical
relaxation time are explicit; no physical-time similarity is claimed. Mass uses
union volume, centre placement uses lobe-volume weighting, and inertia is
Cannon's compound bounding-box approximation. This exploratory mass model is
not the exact inertia of a uniform-density sphere union.

The complete radius-aware cell broadphase visits all neighboring cells and
physical tray planes. Its cell width is twice the maximum grain bound. This
changes cost, not collision shape. The physics kernel has no grain-count cap.

Workbench: `?workspace=workbench&experiment=granular-pairs&experiment_inputs=`
with encoded JSON `{ "manifest": "/scratch/.../manifest.json" }`. The viewer
checks source route, schema and snapshot SHA before showing analytical grains.
It opens directly in the integral with shared camera and lights. Default half
linear display resolution is an explicit preview setting, not a reduction in
particle count. Input `stage: "initial"` shows the retained starting inventory;
default `stage: "settled"` shows the last retained solve checkpoint, whose
producer status and completed steps remain visible. This is a packing source,
not yet cohesive, weathered earth or a learned NeuMIP material.
