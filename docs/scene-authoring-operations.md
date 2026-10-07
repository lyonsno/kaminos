# Shared scene authoring operations

These operations act on the mounted Kaminos page and its current scene/history. Browser automation calls them in that page's JavaScript context. They use the same setters and edit ledger as the human controls.

For scripted comparisons and editable human handoff, use [repeatable visual work](repeatable-visual-work.md). Save, Save As and Capture accept `{result:true}` to return the exact saved filename, restore URL and document for that invocation; existing calls retain their boolean result.

`window.kaminosSceneObjectDebugState()` lists IDs, types, sources and poses. `window.selectSceneObject(id)` selects an object. `window.kaminosSetSceneObjectTransform(id, patch)` applies an accepted pose edit; position and scale are triples, rotation is an XYZ Euler triple in radians. `window.kaminosSceneEdits` exposes `begin(id, label)`, `preview(patch)`, `commit()`, `cancel()`, `undo()`, `redo()` and `state()`. Await undo/redo when membership replay can load assets. Complete or cancel an active gesture before another operation or saving.

Spot lights are ordinary scene objects: Add → Light → Spot creates a new object, and selected light properties own enabled state, color, power, cone angle and blend. Object transforms own placement. `window.kaminosSceneAuthoring.addLight()` returns its ID; `setLight(id, patch)` applies one accepted data edit. Lights participate in grouping, duplication, removal and save/reopen. Their data lives on the object, with no duplicate placement recipe in `environment`. The legacy `@rim-settings` and `@rim-light` interfaces remain adapters for an older scene's migrated rim light; new lights have their own IDs. The current spot adapter changes spread through cone angle rather than object scale.

`window.kaminosAuthoringParameters.list()` returns bound target IDs and values. `read(id)` returns a copy; `set(id, patch)` applies one accepted history edit. Discover targets rather than assuming every DOM control is adapted.

```js
const parameters = window.kaminosAuthoringParameters;
parameters.set('@rim-settings', { enabled: true, intensity: 170 });
window.kaminosSetSceneObjectTransform('@rim-light', { position: [3, 4, -2] });
parameters.set('@parameter:volume-exposure', { value: 1.2 });
parameters.set('@burner-controls', { flow: 1.6 });
await window.kaminosSceneEdits.undo();
await window.saveSceneAs();
```

`@rim-settings` accepts the existing light recipe fields or a partial patch. Invalid recipe values are rejected before acquiring a transaction. `@burner-controls` pairs the burner recipe, source radius and flow across Assets and Volume. Bound Volume range/number/checkbox/color inputs and selects use `@parameter:<control-id>` with `{value}`. Text fields and arbitrary buttons are not implicitly history adapters. Volume parameter writes capture the complete flame settings, so undo also restores coupled coefficients changed by the original control handler. The experimental Cluster route is rejected by the authored Shape control and parameter API; it remains in Workbench. Environment and fire-light targets are also discoverable through `list()`.

Selecting a flame emitter presents its Emission controls. Selecting **Fire & smoke** in the scene hierarchy presents the field's preset, Appearance, Motion, Simulation and Legacy appearance controls. The runtime retains its existing singleton analytic source and whole-settings preset backing; selecting an emitter does not imply that it owns field-wide appearance. Selecting Water simulation opens the existing local-liquid field controls. Field selection does not pretend to be a mesh transform and survives save/reopen. Workbench retains the original controls on the same working state.

Drag numeric field bodies or labels relatively, or click to type an exact value. Shift makes subsequent movement finer, and Escape cancels. Transform and data controls use the same field gesture and chronological ledger. Undo restores authored settings, not earlier fluid fields.

`window.kaminosFlameAuthoring.read()` returns a copy of the complete working settings and source recipe receipt. `apply(snapshot, label)` applies a complete validated snapshot as one history entry. `await applyBasin(presetId)` loads an existing immutable recipe and applies it through the same operation as the inspector. It rejects an overlapping load or an intervening scene edit; retry explicitly after resolving that edit. Finish or cancel an active gesture first.

```js
const before = window.kaminosFlameAuthoring.read();
await window.kaminosFlameAuthoring.applyBasin(existingPresetId);
await window.kaminosSceneEdits.undo(); // restores every coefficient and source receipt
```

Scene saves persist modified settings as an immutable preset with `publishAlias:false`; the original library alias remains unchanged and scene snapshots do not populate the basin library. Saving an explicitly named basin through Workbench retains its existing library behavior.

Save/Save As collect accepted Volume controls into the composition's immutable basin reference and preserve the light recipe. Reopen uses `compositionRestoreUrl()` and the registered scene/asset/basin stores described in [basin presets](basin-presets-for-inference-smokes.md). Scene JSON does not bundle external GLBs. Add Water Emitter consumes the existing typed local-liquid adapter; the menu does not establish mixed kiln/water physical support or a new solver contract.

## Geometry, groups and presets

Add → Mesh creates Cube, Plane, Sphere, Cylinder or Annular plate geometry. A procedural mesh stores `geometry: {kind, parameters}` and separate `surface` material data. Annular material can explicitly bind its response to `flame-field`; newly added annular geometry has no implicit simulation binding. A legacy bed's shape, colors, glow and response binding are preserved during migration.

Groups have an ordinary placement frame and member IDs. Select a group to move its members together, or select a member to edit its own pose/data. Parenting preserves world placement. The current hierarchy supports one group per object; nested groups are not implemented. World TRS remains the pose contract, so a transform that would introduce shear is refused before mutation. Emitter-specific pose constraints remain enforced by their data adapter. Ungroup removes the relationship while leaving the objects in place.

Duplicate / Shift+D copies a mesh, spot light, or a group of those objects and starts modal placement. Confirmation records one insertion with its accepted pose; cancellation removes the tentative copy. Headless `duplicate(id)` records the same insertion without starting an interactive gesture. A group containing the singleton flame emitter cannot be duplicated as another independent source. Retained source bytes and metadata survive undo/redo; redo does not rerun inference.

Import GLB uploads through the existing `/api/ingest-mesh` endpoint, checks the observed digest/source receipt and appends through the existing loader. It preserves native asset units and the current scene. A scene replacement or overlapping active gesture can reject the delayed publication. GLB is the admitted file format for this entrance; the full Workbench retains its older import surfaces. Each imported GLB is one asset instance, rather than exposing every glTF node as an independently authored object.

`window.kaminosSceneAuthoring` exposes `read()`, `addMesh(kind, parameters)`, `addLight()`, `importMesh(file)`, `duplicate(id, {interactive})`, `group(ids, label)`, `attach(id, groupIdOrNull)`, `ungroup(id)`, `setGeometry(id, patch)`, `setMaterial(id, patch)` and `setLight(id, patch)`. Geometry parameter patches preserve other dimensions; material/light patches preserve other data. Group pose targets use `@group:<id>`; `@assembly:<id>` remains a compatibility alias. All accepted actions use the existing scene ledger and save route.

```js
const edit = window.kaminosSceneAuthoring;
const cube = edit.addMesh('box', {width: 1, height: 2, depth: 1});
edit.setMaterial(cube, {color: '#647cc0', roughness: 0.4});
const copy = edit.duplicate(cube);
const group = edit.group([cube, copy], 'Mesh pair');
window.kaminosSetSceneObjectTransform('@group:' + group, {position: [1, 0, 0]});
await window.kaminosSceneEdits.undo();
```

Presets is a separate operation: Burner setup applies an annular mesh plus the current field's emitter arranged in an ordinary group. It is a useful setup, not an object type. The old `kaminosBurnerAuthoring` API remains compatibility glue for earlier callers.

Scene version 7 stores procedural shape/material data, common group frames and light data on ordinary records. Version 6 bed/assembly records and older composition recipes migrate on read; Save writes the current document. Legacy environment rim light settings migrate into light records. Explicit flame-source absence from version 6 onward survives reopening. Scene files reference external GLBs as before; dynamics restart from authored settings.

## Viewport interaction

Scene hierarchy rows select on one click. Double-click a name (or use F2 on a focused row) to rename; Enter or blur accepts, Escape cancels. The existing × removal and Add actions continue to use their scene operations. Add is for creation/import; the header Assets button opens the full Workbench browser.

Viewport → Transform gizmos is a view preference across selections, independent of saved object poses. Navigation hints are another viewport preference. Move/Rotate/Scale toolbar buttons explicitly enable their gizmo. These preferences are session-local, not authored scene history. Grid and global wireframe controls are not implemented by this menu.

Numeric scrub fields display three significant figures while idle; the input retains its precise value and shows it for text editing. Relative numeric drags (including transform axis labels) and G/R/S request browser Pointer Lock, use unbounded logical movement and draw a wrapping software cursor. The browser restores its system cursor to the entry point on release. Escape or unexpected lock loss cancels the edit. When Pointer Lock is unavailable, ordinary bounded dragging remains usable. This does not change native Three.js gizmo-handle dragging or trackpad camera navigation.

## Selection sets, pivots and editor symbols

Shift-click extends or toggles viewport/hierarchy selection; the last added item is active. A selects all scene objects and group frames; Alt-A clears. B enters projected-bounds box selection: left drag adds, middle drag subtracts, Escape/right click cancels. Box selection is through projected object bounds, not fragment-visibility picking. A selected group suppresses selected children as transform roots, so a child never receives the delta twice.

The toolbar exposes World/Local axes and Median/Active/Individual origins. Modal G/R/S, native gizmo and transform-number fields use the existing scene ledger. Operation switching restarts every chosen root from the gesture-start snapshot. A selection transform is one undo entry; a provider rejection cannot leave a sibling changed. Finite world-TRS/provider restrictions remain: unrepresentable shear is rejected, water aperture uses positive uniform scale, and flame sources cannot be independently duplicated.

Selection transform fields edit the shared frame; geometry/material/emission/light fields below edit the active item. The inspector states the active item and which pose values are mixed. Selection feedback uses orange/yellow world bounding boxes, not a new postprocessing silhouette pass. Viewport → Emitter symbols & helpers hides source/light symbols and field guides without removing scene objects, disabling emission or hiding authored mesh geometry. View preferences remain session-local.

`window.kaminosSelection.read()` returns `ids`, `activeId`, expanded `memberIds` and transform preferences. Groups use `@group:<groupId>` keys. `set(ids, activeId)`, `all()`, `clear()`, `settings({orientation, pivot})`, `transform(patch)`, `duplicate({interactive})`, `remove()`, `group(label)`, and `ungroup()` use the same objects and ledger as the UI. Await membership undo/redo. `transform(patch)` edits the frame returned by the current selection; its scale starts at one, so a frame scale is a selection multiplier. Bulk insertion/removal retains actual GLB/procedural/light instances for reversal; simulation source restoration recreates its editor handle through the existing source adapter and preserves settings. Undo does not rewind fluid particles.

Scene version7 adds `selectionIds` beside the existing active object/group fields. Save/reopen preserves the chosen set and active item; older documents keep their single-item behavior. Temporary asset inspection restores the original selection. Glyph visibility can be observed as `objectVisible` in `kaminosSceneObjectDebugState()`; actual light binding visibility remains in `kaminosSceneLightState()`.

## Assets and image-to-mesh generation

In Authoring, **Assets** and **Generate** open an in-context drawer. Browse the existing mounted locations, enter folders, filter the current folder, and choose a GLB or source image. **Open file…** accepts GLB, PNG, JPEG or WebP. A mesh is copied into the existing content-addressed store and appended through the ordinary scene membership operation; the current composition remains intact. Undo removes that instance and redo restores it without re-reading its original external folder. Source images use the existing image inbox and preserve their display name and content identity.

The first generation route is Stable Fast 3D image-to-textured-mesh, using the existing shared-device producer and ordinary flame foreground host. Choose a source image, then explicitly **Generate mesh**. Weights load on the first run. An unsupported host/device or a scene already owned by another composition module is shown as unavailable. Generation does not insert automatically: the retained result gets an **Add** action. Its source image, digest, route, run ID, producer identity/receipt and GLB digest travel with the scene instance through undo/redo and save/reopen. A failed storage step retains the computed bytes and offers **Retry saving result**, rather than rerunning inference. This route needs the deployed SF3D weights/tet assets; generation failure is reported in its actual phase. Browsing existing Trellis outputs does not establish a callable Trellis generation route.

`window.kaminosAssets` exposes `read()`, `refresh()`, `browse(root, path)`, `select(entry)`, `upload(file)`, `add(entry)`, `generate()`, `recover()`, `generation()`, `open(mode)` and `close()`. The UI uses this same controller. For example:

```js
const assets = window.kaminosAssets;
await assets.browse('image-inbox', 'a-source-folder');
assets.select(assets.read().entries.find(entry => entry.kind === 'image'));
const output = await assets.generate();
const objectId = await assets.add({...output, kind: 'mesh'});
window.kaminosSetSceneObjectTransform(objectId, {position: [1, 0, 0]});
```

Ordinary static meshes now have selected/active silhouette feedback. **Viewport → Object bounds** enables bounding boxes separately. Source/light editor symbols retain the existing helper control. Skinned, instanced and Splat outlines are not provided by this static mask; clean scene capture suspends selection contours and bounds. The mask has its own scene/materials and does not alter authored materials, geometry, lighting inputs or saved records.
