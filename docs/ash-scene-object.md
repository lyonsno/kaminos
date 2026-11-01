# Ash in an authored scene

Use **Add → Simulation → Ash source**. A source reuses a visible field containing its footprint (selected field preferred, otherwise nearest); otherwise Kaminos creates a local field. Compact nearby rigid geometry can tighten its default footprint. Large backdrops and distant geometry do not expand it to scene bounds. The field starts empty at ground height, with an independent source above it. Source creation preserves existing objects, lighting and camera.

Select **Ash source** to set its emission rate/radius or pause it. Move/scale it with native tools, duplicate it, or use **Select ash field**. A source outside its field stops emission and reports that state; move the source or field to reconnect. Removing a source leaves its deposits. Removing a field leaves its source visibly unconnected; Undo reconnects it.

Select **Ash field** to pause evolution, enable uniform fallout across its footprint, or add an explicit layer. **Smooth lighting (preview)** blends density-gradient normals on the existing cached faces; it does not change cells, face counts or silhouette. It adds vertex-stage sampling, not a second draw or simulation pass, and is off by default. Legacy saved fields retain their original embedded source under **Legacy field source**. F3 **Add Ash field** retains explicit lattice setup for deliberate field authoring.

Field coordinates and gravity are local; its transform carries retained material. Source position is independently authored in world space and converted to field coordinates each step. Source radius conservatively uses the larger X/Z scale ratio. Changing lattice dimensions/cell width requires another field; moving/scaling remains available without resetting material. Several sources share one airborne transport/deposition dispatch and one field step. Parcel birth sites are sampled by source volume rate. Excess source budget remains field-owned pending mass, as before; the runtime does not retain per-emitter attribution for that backlog.

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
const sourceId = await window.kaminosAsh.addSource();
const fieldId = window.kaminosAsh.readSource(sourceId).settings.fieldId;
window.kaminosAsh.setSource(sourceId, {rate: .004});
// Explicit field construction remains available:
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

Independent source records use type `ash-source`, source `kaminos:ash-source`, and `ashSource: {fieldId, enabled, rate, spread}`. They persist and participate in native transforms/history independently of retained fields.
