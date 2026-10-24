# Working scene ownership

`working-scene.mjs` owns the running page's authored membership, group topology,
selection, arrival lifetime and retained membership roots. The page constructs
one instance and supplies the existing authoring and Workbench adapters with
its operations. Independent instances do not share state.

Read `objects`, `groups` and `selection` to project the editor. The arrays and
group data are immutable; registered object IDs and root references cannot be
assigned through a read. Domain properties and the Three objects remain owned
by their existing adapters. Use `put`, `forget`, `reorder`, `move`, `setGroups`
and `select` for topology changes. `setGroups` checks all membership before
publishing and synchronizes each record's serialized group reference.

`arrival()` captures the current scene lifetime. A caller captures it before
asynchronous preparation and checks it before publishing a result. Scene
replacement and preview transitions call `invalidateArrivals()`. Finishing
disk storage does not itself admit the artifact into a replacement scene.
The document loader retains its existing latest-request contract through
`loads`; ordinary edits do not cancel other arrivals into the same scene.

Undo retains the exact detached root with `retain(record, disposer)`. When the
existing chronological edit ledger drops its last reference,
`releaseUnreferenced` uses that root's disposer unless the same root is still
live. Workbench removal uses its existing scoped disposer so borrowed geometry,
materials and textures remain with their owner.

`scene-membership-operations.mjs` owns admission, individual removal/insertion history,
retained-root restoration, group/selection recovery and owner-session removal.
The page supplies source loading, root behavior and typed domain adapters,
then attaches the existing chronological edit ledger. UI removal, generated
insertion history and Workbench owner closure use the same service instance.
Domain adapters declare whether their roots survive in history and supply
mount/removal/disposal behavior; adding a retained domain does not require
changing a type whitelist inside the membership algorithm.

Constructed records enter through `admit(record, {index, activate, group})`.
Admission checks identity through the working-scene owner before navigation,
grouping or selection effects. Domain constructors still own their roots and
mounting. `scene-object-record.mjs` builds generic registration metadata using
the existing domain validators; it does not mount or register the root.
`reconstruct(record, context)` restores a retained root or uses the source
adapter, then reapplies its saved properties without creating a history entry
or selecting it. The source adapter receives `{activate:false}` and must pass
that intent through loading and registration without transient activation.
Ordinary registration defaults to activation; the page selection adapter owns
editing-mode cleanup. Individual Undo composes that operation with topology and
selection recovery. Ordinary imports, Workbench registration and authored
camera/light/procedural mounts consume the same admission operation.

The composition page still connects domain adapters, render invalidation and UI
projection. Compound selection reconstruction and whole-scene
replacement remain page orchestration; this service does not extract those
remaining application operations. `replaceObjects` and `clearMembership`
are low-level operations for that composition layer; callers must also restore
groups/selection and perform the applicable domain teardown. They do not dispose
resources or reconstruct evolved simulation state. The established public
authoring and Workbench APIs remain the consumer entrances.

Ownership tests use the real module. Existing isolated domain-unit tests use the
explicit `tests/helpers/scene-context.mjs` double for their page dependency;
those tests do not establish the owner's invariants. Membership/history and
Workbench-removal integration tests import the actual operation service and
owner with their explicit adapters. Browser exercise remains necessary to assess the composed editor.

Compound membership history separates reconstructible records from live-only
references through `scene-membership-history.mjs`. It uses the same reloadability
criterion as individual object membership history. Undo/Redo restores the
reconstructible records; current live-only roots and their group relationships
remain under their owner. Their evolving transforms/materials are not copied into
compound history. References to a closed root are pruned, and a newly opened
experiment survives replay. Topology is resolved after asynchronous source loads.

A selection containing a live-only member cannot be removed as an undoable
membership edit: it is refused before changing any root. Close its owner instead.
Reloadable Workbench assets retain the existing individual-object Undo and scoped
resource-disposal behavior. This distinction does not add a checkpoint or replay
facility for evolved experiment state.
