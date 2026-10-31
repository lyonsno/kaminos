# Ash in an authored scene

Use **Add → Simulation → Ash** in the ordinary authoring workspace. Choose the
field width, depth, height, cell width and initial layer, then add it to the
current scene. Creation preserves the existing objects, lighting and camera.
The field starts at the ground height beneath the camera target.

Select **Ash** in the scene list to pause it, enable fallout, change source
position/radius/rate, add a layer, or release a finite burst. Move and scale the
field with the ordinary scene tools. Coordinates, source quantities and gravity
are local to the field; its transform carries the retained material with it.
Changing cell width or lattice dimensions requires adding another field; existing
material is never silently cleared to apply those changes.

The runtime is the same shared-device WebGPU tiled solver as the ash experiment,
using merged exposed-face runs. Ordinary rigid scene meshes are sampled in the
field's coordinates and update their collision occupancy as they move. Skinning,
instancing and active morph targets require evaluated geometry and currently
stop this ash field with an explicit error. Correcting or removing the offending
geometry lets stepping resume; checkpointing revalidates the scene and preserves
the current material without requiring another simulation step. Other ash fields are independent;
they do not exchange material or act as obstacles for each other. The outer
bounds retain material. The bottom of the field is its support floor; match its
placement to the desired surface.

Save and Save As capture deposited density, airborne parcels, pending fallout
and tile wake state. Loading restores them after the other scene objects have
been reconstructed, and checks collision identity before continuing. Live
simulation performs no CPU readback. Save and explicit layer/checkpoint tools
perform readbacks. Remove detaches the field and stops its frame work; Undo
retains its GPU state while history references it. Clearing/replacing the scene
or releasing that history disposes the field's GPU resources.

The current representation reserves memory for the declared extent. It is not
sparse paging. The inspector reports explicit buffer allocation; it excludes
renderer pipeline/material allocations. This integration does not establish a
one-millisecond budget, couple ash to combustion, or add airborne ash sampling
to the flame raymarch.

Agent calls use the same operations as the inspector:

```js
const id = await window.kaminosSceneAuthoring.addAsh({
  width: 7.68, depth: 7.68, height: 1.6, cellSize: .04, initialDepth: .08
});
window.kaminosAsh.set(id, {paused: true});
await window.kaminosAsh.cover(id, .04);
await window.kaminosAsh.burst(id, .02);
await window.kaminosAsh.advance(id, 30);
const state = window.kaminosAsh.read(id); // no readback
const checkpointRecord = await window.kaminosAsh.snapshot(id);
```

The source identity is `kaminos:retained-ash`, object type `retained-ash`, payload
schema `kaminos.ash-object.v1`. Record validation and reconstruction live beside
the ash owner in `ash/scene-record.mjs` and `ash/scene-object.mjs`.
