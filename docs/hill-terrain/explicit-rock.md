# Explicit rock construction trial

The `hill-geology` Workbench can display a plane-defined rock outcrop alongside the existing height/material terrain. This is an authored initial configuration, not fracture simulation, naturalistic generation, or coupled terrain evolution. The current block arrangement remains visibly artificial and its junction with the existing terrain is incomplete.

`rock-geometry.mjs` intersects finite halfspaces into closed convex solids. Face intersections become actual mesh edges. `rock-scene.mjs` gives those faces to the ordinary scene renderer. The source is fixed in terrain-local coordinates and independent of the camera-following heightfield detail lattice. No rock LOD or runtime remeshing is implemented.

The terrain and rock form separate components of a provisional union. Interior rock faces are retained in the render meshes; rendering does not Boolean-remesh them. The heightfield can still intersect visible recesses. A conforming rock/soil boundary and extraction of the exposed combined surface remain construction work.

## Controls and reconstruction

The existing experiment exposes `setRockGeometry({enabled,origin,scale,gap,wear})` and `setPlainMaterial(boolean)`. The Outcrop construction selector switches between recovered terrain and the added explicit mesh. Plain material removes terrain pigment so geometric shape can be inspected. Fracture opening and Broken edge width rebuild the finite source. `recipe()` preserves the source parameters and switches; these also work through `experiment_inputs`.

The default experiment has the explicit mesh disabled. With it enabled, live settling, GPU erosion and advance refuse execution: those solvers currently consume only the grid, so running them would imply a coupling that does not exist. Recovered terrain retains those operations. Formation regeneration remains available and does not evolve the rock.

## Geometry and support source

Each plane is `[nx,ny,nz,d]` with `dot(n,p) <= d` inside the solid. Plane normals are normalized. `packRockPlanes` produces a Float32 vec4 plane array and a Uint32 vec4 block directory `[planeOffset,planeCount,0,0]`. Counts come from the source; there is no contributor truncation.

`kaminosHillGeology.gpu()` returns the existing heightfield resources and an explicit coverage description. When the rock is enabled it also returns `explicitRock` with device-resident plane/block buffers, block count, source generation and `coordinateSpace: 'hill-local'`. The existing `localToWorld` matrix applies to both components. Buffers are owned by the experiment, replaced after source edits and destroyed on disposal; consumers must refresh references after a generation change. No contact consumer is integrated yet.

The exported production `ROCK_RAY_WGSL` handles arbitrary ray directions, including underside contact. It reports the closest boundary of the union of convex rock solids, skipping overlapping internal faces when a ray starts inside. Direction must be finite and nonzero; distance is measured in terrain-local units along its normalized direction. This function queries rock only: a future consumer must compose it with terrain contact and handle transforms, finite-radius bodies/particles, moving geometry and ingress separately. The JS ray query is an offline/reference operation, not a serving-path CPU oracle.

## Architectural questions still open

- Convex face construction resolves vertical surfaces directly, but its current authored arrangement is block-like. Geometry presence does not establish naturalism.
- Soil coverage and the exposed combined surface need a coherent junction rather than a hidden collision surface or a rectangular cutout.
- Static plane queries do not establish fluid/body consumption or evolving rock. Mapping deformation, weathering, material transfer and persistent history onto these solids remains undecided.
- The finite trial adds no full-world voxel grid. Dense arbitrary meshes, spatial acceleration, geometric LOD and preparation/runtime budgets remain unmeasured.

Focused geometry and scene-source checks: `npm test -- --only tests/hill-rock-geometry.mjs,tests/hill-rock-scene.mjs`. Browser checks execute the actual production query WGSL and compare its results with source intervals and rendered triangles.
