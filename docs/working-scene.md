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

The composition page still connects domain adapters, chronological edit targets,
render invalidation and UI projection. `replaceObjects` and `clearMembership`
are low-level operations for that composition layer; callers must also restore
groups/selection and perform the applicable domain teardown. They do not dispose
resources or reconstruct evolved simulation state. The established public
authoring and Workbench APIs remain the consumer entrances.

Ownership tests use the real module. Existing isolated domain-unit tests use the
explicit `tests/helpers/scene-context.mjs` double for their page dependency;
those tests do not establish the owner's invariants. Membership/history and
Workbench-removal integration tests compose the actual owner with their existing
adapters. Browser exercise remains necessary to assess the composed editor.
