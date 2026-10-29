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
adapter, then reapplies its saved properties and completes domain publication without creating a history entry
or selecting it. The source adapter receives `{activate:false}` and must pass
that intent through loading and registration without transient activation.
Ordinary registration defaults to activation; the page selection adapter owns
editing-mode cleanup. Individual Undo composes that operation with topology and
selection recovery. Ordinary imports, Workbench registration and authored
camera/light/procedural mounts consume the same admission operation.

The composition page still connects domain adapters, render invalidation and UI
projection. `scene-lifecycle.mjs` owns whole-scene clear/replacement and temporary
preview suspension/return. Domain teardown, loading and presentation remain page
adapters. Replacement preserves latest-request admission, releases partial loads
on failure and restores topology/selection after construction. Empty documents
use the same replacement path. Compound authored edits
use `scene-membership-batch.mjs`: capture/validation, multi-removal, group and
selection duplication, rollback and post-await topology reconciliation. It
reuses individual reconstruction, including typed light/camera attachments.
The page supplies domain property application and simulation-context recovery;
live-only roots remain under their session owners. `replaceObjects` and `clearMembership`
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

## Saved scene access across checkouts

Load and Generate's kiln chooser use `scene-library-client.mjs` to browse the
same local scene store and other configured stores. Choosing another store's
scene imports an ordinary local copy and its available mesh/basin dependencies;
the original stays untouched. Generate's Browse files option retains a fresh
copy without accepting overwrite hints from the uploaded document.

`KAMINOS_SCENES_DIR` selects the writable scene store. The library also discovers
the server's normal sibling and user-data stores. To retain access to scenes
outside those locations when changing served revisions, put one directory glob
per line in `~/.config/kaminos/scene-library-globs`, for example
`~/projects/*/scenes`. Blank lines and `#` comments are ignored. This extends
normal discovery and is read for each library request.
`KAMINOS_SCENE_LIBRARY_CONFIG` selects another file; an explicitly requested
unreadable file produces a visible library error. The existing
`KAMINOS_SCENE_LIBRARY_GLOBS` environment setting continues to replace discovery
with its path-separator-delimited patterns.

Temporary preview parks exact roots, groups and selection in the working-scene
owner. `suspendMembership` removes them from active membership;
`resumeMembership` returns surviving roots. Owner closure can retire a parked root
by exact identity, pruning its saved topology, so Back cannot resurrect a closed
experiment. Parked roots continue to protect shared resources and history
retention. New admission is refused during preview. Whole-scene clear discards
the suspension and releases its roots; it cannot later resume that document.
