# Build A Workbench Experiment

A Workbench experiment connects a feature's meaningful operations to a shared
working scene. People manipulate it through controls; agents invoke the same
operations and read their results. The feature keeps its own simulation,
animation, material or inference logic. Kaminos provides the surrounding place
to work: scene objects, camera, selection, lighting, inspector and frame loop.

## Choose A Starting Point

| Work | Start here |
| --- | --- |
| Tune, run or compare a visual/dynamic feature | Extend an existing experiment or contribute a discovered definition below |
| Inspect one image, mesh or splat | Open it through the ordinary asset viewer |
| Compose or edit an authored scene | [Scene operations](scene-authoring-operations.md) and [repeatable visual work](repeatable-visual-work.md) |
| Develop a computational kernel or backend | Focused tests and the existing visual consumer for the behavior being changed |

When the development surface is uncertain, describe the intended interaction to
the operator, recommend a route and ask which fits. Implementation questions go
to the relevant code and owner. Inspect the available host before planning an
extension; report a missing capability as the concrete operation your feature
needs. Domain modules can remain independently useful while the experiment
supplies their visible working context.

## Design For Interaction

Spatial manipulation of scene objects and their components belongs to the native editor. Domain features should make their objects participate in that editor. A separate experiment interface must not become the owner of selection and transforms merely because the feature introduced the object.

Start with what the person wants to do to an object or scene. Reuse selection,
placement, the relevant inspector, camera navigation and shared playback where
they fit. Present domain-specific controls in the context of their target, using
the same meaningful operations available to agents. Keep authored scene objects
on the ordinary editing and save path; an experiment's disposable setup has its
own explicit lifetime.

Prefer a selected emitter with editable rate and direction over separate
buttons for several hardcoded emissions. Prefer choosing a target and framing
it through camera controls over a row of named camera-pose buttons. A useful
preset can seed an editable setup; its initial values need not bound the
operator's exploration. Use familiar sliders, numeric fields, toggles and
selection tools for their corresponding values, with clear commands for actions.
Group controls by the work they support and expose details in context.

A controlled fixture is appropriate when fixed geometry, timing or inputs are
part of the question being tested. Make that role legible and preserve a
repeatable baseline. Most one-off machinery that reaches a human benefits from
a small amount of interaction design on the first pass: let them select the
relevant target, vary the meaningful settings, inspect the result and repeat
without asking for a code change. Retain edits through the applicable scene,
domain-state or recording service, and state the continuation actually supported.
Choose flexibility that serves the next useful interaction; a generic framework
is a separate investment.

## Run The Small Example

From the checkout, use an available port:

```sh
python3 serve.py 8095
```

Open `http://127.0.0.1:8095/?experiment=material-study&workspace=workbench`
in a WebGPU-capable browser. The experiment mounts a reference and candidate
sphere in the existing scene. Use **Frame comparison**, adjust **Candidate
roughness**, then orbit and change lighting through the ordinary inspector.
The reference stays at roughness 0.15. Source:
[`experiments/material-study.experiment.mjs`](../experiments/material-study.experiment.mjs).

The page exposes the same contribution to an attached agent browser:

```js
await page.waitForFunction(() => window.kaminosWorkbenchExperiments?.state().id === 'material-study');
const result = await page.evaluate(async () => {
  const experiments = window.kaminosWorkbenchExperiments;
  await experiments.invoke('frame');
  return experiments.invoke('setRoughness', 0.85);
});
```

`page` is the caller's existing Playwright page. This is a browser-side API;
terminal transport into an already-open operator tab composes separately.
The example adds no private renderer, camera or timer. Its operations emit into
the common recording channel when recording is mounted. Opening an experiment
alone supplies an interactive setup; capture/file retention is installed through
the existing investigation tools below.

## Contribute Your Feature

1. Copy the small definition to `experiments/<your-feature>.experiment.mjs` and
   choose a unique `id` and `title`. Add the adjacent `<your-feature>.experiment.json`
   containing `{"id":"your-feature","title":"Your feature"}` with the same values.
   The server reads that metadata without importing implementations; choosing an
   experiment imports its module and checks both values before calling its factory.
   Keep domain implementation in its own modules.
2. In `create({host, inputs, record})`, validate setup and await
   `host.scene.open()`. Attach owned Three objects with `session.attach(root,
   {owned: true, metadata})`, or load a GLB with `session.loadAsset({url})`.
   Register source identity and a useful label in metadata. Existing registered
   roots can be borrowed explicitly with `owned: false`.
3. Return `read`, `operations`, optional `mount`, and `dispose`. `read` describes
   actual state. Operations perform meaningful domain actions and record their
   effective values. `mount({root, document, invoke})` connects controls to those
   same operations. Dispose the session and any feature-owned subscriptions.
4. Refresh experiment discovery after adding files or editing metadata. Missing or
   malformed metadata and duplicate IDs appear as unavailable entries with source
   diagnostics; unrelated experiments remain usable. Fix the adjacent metadata and
   refresh to recover. The existing `/api/workbench-experiments` response retains
   `modules` for source inventory and adds `experiments` for the data-only catalogue.
   Each catalogue row has `moduleUrl` plus `id`/`title`, or a source-specific `error`.
   The entry's `list()` exposes those errors and `state().moduleUrl` identifies the
   running implementation even after a catalogue refresh. Reload after changing
   imported code. Open with `?experiment=<id>&experiment_inputs=<URL-encoded JSON>`.
   Reuse existing control grammar and ordinary scene/editor operations.
5. Exercise an actual control and the corresponding agent invocation. Inspect
   the resulting scene, then close/reopen to check your contribution's lifetime
   and supported reconstruction. Hand the operator the exercised setup and a
   short useful manipulation/question.

The example retains starting roughness through `experiment_inputs`; its slider
edits remain live state. To share an edited example setup, read its actual
roughness and pass that as inputs on reopening. General authored scene save,
domain reconstruction, and evolved simulation checkpoints each retain the state
their implementations support. Choose and state the continuation your feature
actually provides.

## Shared Tools And Extensions

- [Scene sessions](workbench-scene-session.md) scope registered objects and
  frame subscriptions within the existing application. App consumers await
  `host.scene.open()`. A frame's `deltaSeconds` is host presentation time;
  domain owners supply simulation clocks, hold and exact advance.
- [Investigation recording](investigation-recording.md) retains meaningful
  interventions, views and observation context. Record effective domain changes
  at the operation that performs them.
- [Owner investigation mount](owner-investigation-mount.md) supplies the Node
  capture/file writer and Capture/Finish lifetime. Reuse its installer and
  caller-owned output directory for a recorded handoff. Source-specific
  hold/present/reconstruction remains in the feature adapter.
- [Repeatable visual work](repeatable-visual-work.md) supplies ordinary authored
  scene edits, saved results and retained comparisons.
- [Notes](notes.md) carry the conversation about the work: a person leaves a
  note on a scene object for an agent by name, with the view, selection and
  served commit attached, and the answer comes back in the page's thread.
  Resolve the note's context and continue the investigation from that return;
  the notes guide owns registration, delivery and recovery.

Current main supplies the common scene/entry services described here. Specialized
Fluid hosts, numerical transport and sequence destinations have their own
consumer interfaces and integration revisions. Verify that the checkout you
serve contains the capability you choose. Extend the shared host through its
owner when a new feature needs an additional service; preserve the existing
working scene and ordinary editing behavior.

## Application API

Owners use their own discovered `*.experiment.mjs` definition with the ordinary Kaminos scene, camera, selection and frame loop. `serve.py` discovers `experiments/` by default; `KAMINOS_EXPERIMENTS_DIR` selects a directory inside the served checkout. The common entry and retention modules remain the same modules used by the feature host. This main join supplies scene capabilities; numerical Fluid host capabilities remain separate.

`window.kaminosWorkbenchExperiments` supplies list/refresh/open/read/invoke/state/close. Refresh requests only catalogue metadata and proceeds independently of a pending activation or feature operation. It preserves the running experiment and its state. If refreshes overlap, the latest request owns the published catalogue; a discovery error keeps the last catalogue usable and is shown beside the chooser. `?experiment=<id>&experiment_inputs=<JSON>` opens a reproducible owner setup. A source-pose setup URL is distinct from a retained image/history investigation link. Adding files is discovered by Refresh; revising imported module code takes effect on page reload.

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

## Environment parameter ownership

The accepted HDR environment recipe lives in `scene-environment-state.mjs`.
Per-map exposure, intensity, rotation and background grading are retained there;
map-background visibility is shared across map choices. Controls project and edit
that state through `scene-environment-controls.mjs`. Unsubmitted numeric drafts
are not inputs to scene saving, preference capture, history or newly loaded materials.
The existing `environment` scene-document fields and browser-local settings format
remain supported. Older document defaults keep their existing interpretation.

Agent edits use the same history targets as the controls:

```js
window.kaminosAuthoringParameters.set('@parameter:env-intensity-slider', {value: 0.73});
window.kaminosAuthoringParameters.set('@parameter:show-env-bg', {value: false});
```

Rotation, blur, background brightness and contrast use their existing control IDs
under `@parameter:`. These targets read accepted values, validate semantic ranges
and project to rendering and controls. Undo/Redo uses the same state operations.
Exposure keeps its existing `@parameter:exposure-slider` contract: while matched
it edits flame-camera EV; otherwise it edits the independent environment multiplier.
The independent multiplier survives matching and environment recall. UI bounds
expand to display valid stored recipes without rounding their accepted values.
