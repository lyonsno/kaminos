# Common Workbench Application Join

## Shared making bench

A plain Workbench visit opens **Shared bench**. The Workbench header button returns there from Authoring or another tool without replacing the current scene, selection, or camera. Explicit tool and experiment routes still open their requested surfaces. The bench uses the ordinary scene tree, transform controls, history, import, and document commands; it has no separate scene format. Save a particular apparatus as an ordinary scene and reopen its returned Workbench address.

The original controls move between workspaces, including their listeners and history state. Workbench releases its slots before Authoring acquires them. The bench puts the scene tree on the left; other Workbench tools keep it in the Scene inspector. Experiments remain available in the collapsible Experiments section.

`tools/shared-making-witness.mjs` exercises the served page, workspace round trips, object/selection/view continuity, ordinary Undo/Redo, and save/reopen. It requires explicit `--origin`, `--root`, `--browser`, `--playwright`, and `--out`; `--asset /path/to/arm.glb` also imports a caller-selected arm through the visible file control and saves it alongside an agent vantage. Reports identify the served checkout and effective browser and survive failures. This is an interaction/retention witness, not a performance benchmark or an articulation implementation.

## Owner experiments

Owners use their own discovered `*.experiment.mjs` definition with the ordinary Kaminos scene, camera, selection and frame loop. `serve.py` discovers `experiments/` by default; `KAMINOS_EXPERIMENTS_DIR` selects a directory inside the served checkout. The common entry and retention modules remain the same modules used by the feature host. This main join supplies scene capabilities; numerical Fluid host capabilities remain separate.

`window.kaminosWorkbenchExperiments` supplies list/refresh/open/read/invoke/state/close. `?experiment=<id>&experiment_inputs=<JSON>` opens a reproducible owner setup. A source-pose setup URL is distinct from a retained image/history investigation link. Adding files is discovered by Refresh; revising imported module code takes effect on page reload.

`create({host,inputs,record})` receives `host.controls.document`, the existing Modal number-drag installer, and `host.scene.open()`. Scene sessions provide loadAsset/attach/readView/setView/redraw/onFrame/dispose. They borrow the actual app scene and controls, preserve native placement by default, and release only their owned registrations. Frame callbacks receive `{timestampMs,deltaSeconds}` from the existing loop. Caller/domain owners supply source verification, playback, reconstruction and meaningful recording.

After restoring an actual loaded or attached root, call the explicit presentation operation:

```js
root.position.fromArray(recipe.position);
root.quaternion.fromArray(recipe.quaternion);
root.scale.fromArray(recipe.scale);
host.scene.refreshPresentation(asset);
```

`asset` is the current `{id,root,...}` registration receipt. The operation validates both registration ID and root identity, updates the root matrix, refreshes the existing transform inspector only when that same object is selected, and marks the app dirty. It returns `{id,transform,selectionMatched}`. It changes neither selection nor edit history, and the ordinary focused-input rule remains intact. Call once after restoration; normal `session.redraw()` remains the inexpensive playback operation. Diagnostic callers can use `window.kaminosWorkbenchRefreshPresentation(asset)` for the same operation.

Experiment controls occupy the shared left surface. Existing Selection/Scene, lighting and rendering controls are moved into the existing right inspector, preserving their nodes and handlers. Authoring and Workbench still use one scene and one set of controls. `window.kaminosWorkbenchSetInvestigation(node,{tool})` mounts an existing component; `window.kaminosMountInvestigationEntry(options)` mounts the shared addressable-entry presentation with a requested existing tool (default Assets). The existing common `mountInvestigation` supplies Node-side retention and lifetime; this join creates no recording service or backend.
