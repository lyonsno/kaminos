# Ash in an authored scene

Use **Add → Simulation → Ash source**. A source reuses a visible field containing its footprint (selected field preferred, otherwise nearest); otherwise Kaminos creates a local field. Compact nearby rigid geometry can tighten its default footprint. Large backdrops and distant geometry do not expand it to scene bounds. The field starts empty at ground height, with an independent source above it. Source creation preserves existing objects, lighting and camera.

Select **Ash source** to set its emission rate/radius or pause it. Move/scale it with native tools, duplicate it, or use **Select ash field**. A source outside its field stops emission and reports that state; move the source or field to reconnect. Removing a source leaves its deposits. Removing a field leaves its source visibly unconnected; Undo reconnects it.

Select **Ash field** to pause evolution, enable uniform fallout across its footprint, or add an explicit layer. **Smooth lighting (preview)** blends density-gradient normals on the existing cached faces; it does not change cells, face counts or silhouette. It adds vertex-stage sampling, not a second draw or simulation pass, and is off by default. Legacy saved fields retain their original embedded source under **Legacy field source**. F3 **Add Ash field** retains explicit lattice setup for deliberate field authoring.

Field coordinates and gravity are local; its transform carries retained material. Source position is independently authored in world space and converted to field coordinates each step. Source radius conservatively uses the larger X/Z scale ratio. Select the field to edit Width, Depth, Height and Cell width, then use **Reset at cell width**. Reset clears deposited and falling material while preserving field placement and connected source objects. Moving/scaling remains available without resetting material. Several sources share one airborne transport/deposition dispatch and one field step. Parcel birth sites are sampled by source volume rate. Excess source budget remains field-owned pending mass, as before; the runtime does not retain per-emitter attribution for that backlog.

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


## Spatial sliding resistance

The field inspector exposes **Slide variation** (0–1), **Variation scale** (field-local distance), and **Slide release** (0–1). Release lowers the target resistance after a pair yields, allowing a finite slump instead of repeatedly stopping just under the starting threshold. Zero release preserves the old stopping rule. Zero preserves the uniform lateral threshold. Increasing variation creates smoothly varying patches of stronger and weaker resistance; it changes conservative material transfers, not rendered displacement. The pattern is stable in field-local X/Z, independent of camera, time, height and tile boundaries. It is spatial heterogeneity, not compaction memory or grain momentum.

The first plain-variation fixture retained a long active settling tail; release is independently adjustable so that tradeoff remains inspectable. Recommended comparison values are variation1, scale0.24, release0.5, against all-zero variation/release. These are provisional appearance settings, not calibrated ash properties.

Only already-admitted exchange work evaluates the variation. The six existing exchange passes and wake propagation remain; a settings edit wakes the field once so existing material can respond. Settling can take more or fewer steps and change exposed-face counts. No total-cost or speedup claim follows. With variation enabled, a one-millionth-cell fill-difference deadband stops floating-point creep at the repose threshold; material remains retained unchanged when a transfer is skipped. Sleeping fields retain their cached surface. Configuration and evolved density survive ordinary scene saving; old records/checkpoints retain uniform resistance by default. The Workbench tiled experiment uses the same `sliding({variation,scale,release})` operation and controls.


## Coarse and fine regions

The field inspector's **Coarse and fine regions** section enables two physical resolutions. **Cell width** is the fine width; the surrounding volume uses twice that width. Add and select fine regions, edit their field-local minimum and maximum bounds, then use **Reset at cell width**. The reset snaps bounds to coarse cell boundaries and rejects overlapping or empty regions. Amber boxes show the applied fine regions when the field is selected. A shallow fine region can cover a broad deposited surface, with additional non-overlapping regions above it around complex geometry.

These are fixed regions in the field's frame. Moving rigid scene objects can cross their boundaries; the regions do not follow objects or automatically grow. Occupied fine material stays fine until an explicit reset. Reset clears it rather than resampling it. Several ash fields remain independent and are not a substitute for connected refinement.

Both resolutions store conserved volume in units of one fine cell. Covered coarse cells are masked; a coarse cell outside refinement holds up to eight fine-cell volumes. Exchange across a coarse face accounts for its four fine neighbors and limits every transfer by shared source and destination capacity. This uses an offer/limit/gather step rather than the uniform solver's checkerboard pairs, so transient settling can differ. Falling parcels, moving-mesh collision and surface drawing use the same ownership map. Surface corners share the fine grid at a boundary, with cached face subdivisions joining the two resolutions. Smooth lighting remains optional.

The implementation reserves a coarse background and explicit fine patches, including overlap slots masked out of the coarse storage. It has no dynamic paging, automatic refinement placement or occupied-patch demotion. Fine coverage and subdivision of exposed coarse faces both affect allocation. The inspector's allocation includes solver, parcel, collision and surface buffers; it does not establish GPU time or a speedup. Live stepping has no CPU readback. Refined checkpoints use `kaminos.refined-ash.v1`; uniform checkpoints retain `kaminos.tiled-ash.v1`.

```js
await window.kaminosAsh.regrid(fieldId, {
  cellSize: .016,
  refinement: {ratio: 2, regions: [
    {min: [-3.52, 0, -1.92], max: [3.52, .128, 1.92]},
    {min: [-.64, .128, -.64], max: [.64, .768, .64]}
  ]}
});
```

This example assumes a 7.04 × 3.84 field at least .768 high. Region coordinates must align relative to the field's minimum corner. Regridding is deliberate and cannot be undone; save the evolved scene first if its material needs to be kept.
