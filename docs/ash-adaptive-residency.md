# Automatic fine ash around scene colliders

New native ash fields use a coarse covering grid (twice the requested cell width) and a reusable pool of 8³ fine-cell bricks. The field, source objects, transforms, scene saving and interaction stay in the ordinary scene editor. Existing uniform and explicitly refined saved fields keep their original routes. In **Adaptive detail**, choosing Automatic and resetting converts an older field; reset clears its deposited and falling material, as with a cell-width change.

**Fine capacity (% of field)** controls reserved storage, initially 12.5%. It is an exposed experimental memory allowance, not a promise that every requested location receives fine cells. **Show fine bricks** draws the resident addresses directly from GPU metadata. **Inspect fine residency** takes an explicit diagnostic snapshot and reports capacity, retained history and unmet requests. No automatic residency planning or live evolution maps a GPU buffer to the CPU. Saving and requested diagnostics do read state.

## Demand and maintenance

The existing collider producer caches object-local occupancy and updates only affected field tiles when geometry or poses change. Automatic fields build that cache at the requested fine pitch where the producer's existing capacity permits. During affected coarse-tile stamping, eight fine occupancy samples per coarse cell compare the four vertical fine columns. Disagreement requests fine detail; a uniform horizontal support plane does not. This is a local occupancy-representation signal, not a measured mesh-distance bound or recovery of detail already removed by a collider LOD.

The request map lives on the GPU. Direct feature demand takes priority over one brick of surrounding headroom. Empty headroom can yield just enough slots for missing direct demand; occupied history cannot be displaced by this priority. The allocator reuses empty slots, installs both directions of the owner map, and transfers coarse volume into the new fine columns conservatively. It never reserves a full finest-resolution backing field. Falling deposition, contact, conservative exchange, collision and drawing use the same runtime ownership map. Collision clears/stamps a compact GPU list of dirty fine bricks using the existing cached shapes.

Occupied fine bricks remain at their deposited world-field locations after a collider moves. Empty bricks with no remaining demand can be reused. When the pool fills, new unmet locations remain coarse; retained mass is never dropped to make space. A long evolving landscape can therefore exhaust the initial allowance. Raising it currently requires the normal reset; automatic pool growth, lossy demotion and streamed history are not implemented. This is the explicit first residency policy rather than a claim that bounded storage admits unlimited fine history.

Planning runs after collider changes, and retries blocked demand when fine-cell evacuation may have freed storage. A full unchanged pool does not repeatedly scan all requests. Geometry/pose collection remains the existing CPU scene metadata path; demand, slot assignment, ownership changes and material transfer are GPU resident. The changed-tile metric costs up to eight cached shape queries per coarse cell, once per affected pose/geometry update; it is not free. The GPU still visits compact metadata and submits passes while idle. No total-cost or 1 ms claim follows from this architecture.

## Persistence and verification

`kaminos.adaptive-ash.v1` stores the authoritative owner/inverse maps with deposited density, pending tile work, the volume ledger and falling parcels. Restore rejects inconsistent maps, duplicated owners, unowned mass, invalid volume, and incompatible scene geometry/poses before uploading density. Demand and collision are derived again from the restored scene; the retained fine map is preserved. All rejectable checkpoint fields, including sliding, are validated before topology or material uploads. Geometry and topology changes do not reinitialize the field.

Small deterministic checks:

```sh
npm test -- --only tests/ash-adaptive-residency.mjs,tests/ash-adaptive-gpu.mjs,tests/ash-refined-surface-gpu.mjs,tests/ash-refinement.mjs,tests/ash-scene-object.mjs,tests/ash-scene-recovery.mjs
```

The GPU test uses the versioned Shader Herder dependency and records hardware versus compiler-only authority. It exercises the production allocation and exchange kernels, conservation through prolongation, history pinning, capacity pressure, reuse, settled maintenance and mixed-owner CPU/GPU numerical agreement. `tools/ash-adaptive-native-witness.mjs` exercises actual native moving geometry, GPU-produced fine residency, retained contact history, source deposition, rendering and full scene reopen. It records source hashes, effective source root, browser route, primary failure phase and browser cleanup. Reports and raw checkpoints are caller-owned output paths. A wrong-source route fails before opening a browser.

Coarse and fine faces retain their physical cell fill heights. Smooth lighting changes normals rather than bending vertices across stacked material layers; the geometry deliberately remains faceted.

The existing collision texture bound and legacy LOD precision compromises remain. Fine regions currently follow collider detail and its headroom, rather than independently detecting every evolving ash-surface feature. Dense moving kiln coverage, visual character and whole-consumer cost still need evidence at their actual scene scale. Performance comparisons belong in an uncontended Greenroom window; functional captures do not price the effect.
