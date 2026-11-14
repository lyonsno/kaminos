# Scene editing on the worker route

The worker owns authored objects, document binding and chronological edit
history. The page editor renders accepted records and sends commands through
the existing scene worker. Mesh preparation can await decoding while frames
continue; publication runs synchronously through the shared foreground service.
Later authored edits stay behind that operation. In this first integration,
these asynchronous commands also wait behind active inference. Model controls
and cooperative frames keep their existing routes.

The existing asset workflow can add a retained GLB with:

```js
const result = await kaminosSceneWorker.editor.importAsset({
  source: '/api/read?root=generated-meshes&path=cast.glb',
  fileName: 'cast.glb',
  label: 'Selected cast',
  generation: {runId: 'existing-run'},
  provenance: {job: 'existing-job'},
  transform: {position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]},
});
```

`source` must satisfy the existing scene record source policy. Persist uploaded
bytes before calling this operation; a raw file or browser blob URL is not a
saved scene source. `generation` retains its supplied fields. `assetOrigin`
retains its supplied envelope, and the optional `provenance` convenience input
is stored as `assetOrigin.provenance`. Add does not rerun generation.

The underlying command is `scene.importAsset` with the same input. Its reply
contains `objectId`, `mutationApplied` and `ui`, the accepted object/selection/
history projection. Removal and duplication use `scene.remove` and
`scene.duplicate`, with `{id}` or the current active object; the page adapter
exposes matching `remove` and `duplicate` methods. These new membership commands
currently support ordinary retained GLBs. Domain-owned sources keep their own
construction/removal semantics. Existing supported source transforms still use
`scene.transform` and `scene.transformComponent`.

`scene.undo` and `scene.redo` are ordered asynchronous operations. Await their
completion: restoring a removed mesh may decode its retained source. They use
the same history as transforms and membership changes. The native editor's
Duplicate/Delete and Undo/Redo controls send these operations; pending requests
disable overlapping controls. The page keeps no second authored scene/history.

An error with `mutationApplied: true` means the authored change occurred and
subsequent drawing, cancellation or acknowledgment failed. Do not repeat the
edit automatically. History follows the known applied change once; the failure
is still returned. `scene.editorState` returns a current accepted projection,
which the page uses to reconcile a known applied failure. Unknown or partial
application is not a completed edit and retains the host's existing hold and
recovery behavior.

Save, Save As and Open continue through the existing worker document session.
They capture accepted records and source/material identity, preserve their
invocation's document binding, and reconstruct using the installed domain
services. Saved authored setup does not claim an evolved simulation checkpoint.
