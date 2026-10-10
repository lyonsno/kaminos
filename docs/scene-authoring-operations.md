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

Selecting **Fire & smoke** also exposes the simulation box's world centre and uniform world scale. G moves the box; S changes its world size about its centre. Its axes remain world-aligned and its aspect is fixed at 2 × 4 × 2 in local coordinates. The bounds preview while dragging; Escape cancels without restarting the field. Acceptance restarts the field once. Existing cell counts stay fixed, so larger world bounds mean larger world cells and can change the dynamics. The emitter retains its world pose and aperture. Moving it outside an explicitly placed box pauses injection instead of moving the box. Older scenes retain automatic source-follow until the box is explicitly authored.

`window.kaminosFlameDomain.read()` returns `{translation, scale, followSource}`; `translation` is the engine frame origin, one scaled local unit below the box centre. `set(posePatch)` accepts a **world centre** `position` triple and a positive uniform `scale` triple, through the shared `@flame-domain` edit target. Rotation and nonuniform scale are refused. For example:

```js
window.kaminosFlameDomain.set({position: [0, 1, 0], scale: [1.5, 1.5, 1.5]});
await window.kaminosSceneEdits.undo();
const saved = await window.saveSceneAs({result: true, name: 'Kiln domain study'});
// Reopen saved.url: it names both the saved scene and its exact immutable basin.
```

Save/reopen retains the domain even if its source was removed. Domain undo restores its authored transform and source-follow policy; it does not restore evolved gas. Existing kiln collision, light bounds and field-to-bed/contact mappings consume the same accepted world transform. This operation does not create another independent simulation domain or change grid resolution.

Drag numeric field bodies or labels relatively, or click to type an exact value. Shift makes subsequent movement finer, and Escape cancels. Transform and data controls use the same field gesture and chronological ledger. Undo restores authored settings, not earlier fluid fields.

`window.kaminosFlameAuthoring.read()` returns a copy of the complete working settings and source recipe receipt. `apply(snapshot, label)` applies a complete validated snapshot as one history entry. `await applyBasin(presetId)` loads an existing immutable recipe and applies it through the same operation as the inspector. It rejects an overlapping load or an intervening scene edit; retry explicitly after resolving that edit. Finish or cancel an active gesture first.

```js
const before = window.kaminosFlameAuthoring.read();
await window.kaminosFlameAuthoring.applyBasin(existingPresetId);
await window.kaminosSceneEdits.undo(); // restores every coefficient and source receipt
```

Scene saves persist modified settings as an immutable preset with `publishAlias:false`; the original library alias remains unchanged. With the shared library enabled, snapshots are shared by immutable ID without creating a library label. Saving an explicitly named basin through Workbench retains its existing library behavior.

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

## Kiln cue authoring

The cinematic composition module adds Cues beside Object and Scene in the same Properties inspector. Ignition and Work contain selectable cue rows carrying emitter keys, a look change, or both. Look-only events receive time-only rows without adding emitter values. Moving or removing a combined row moves or removes both layers. A named scene-local look retains the complete basin snapshot and immutable source ID. Replacing or retuning that look preserves radius/flow animation and updates every cue referencing it. Make unique forks the evaluated look at the selected time, including a legacy appearance blend, without capturing emitter overrides. A key with its Radius key or Flow key unchecked inherits that channel's curve; if there is no channel curve yet, it follows the active look's base value. Cancelling a field gesture restores its prior keyed/unkeyed state as well as its value. Selecting another key accepts the current draft; leaving Cues cancels it. Accept tune records one shared history entry and restores the working scene baseline; Cancel restores without recording. Preview plays accepted cues. Cues Save scene accepts its draft before saving.

`window.kaminosCinematic.read()` and `write(recipe)` expose the same scene-persisted recipe. The v2 document stores `looks: [{id,name,tune}]`, `lookCues: {ignition,work}` with `{time,lookId,blend?}`, and `ignition`/`work` emitter keys with `{time,radius?,flow?}`. New look cues hold until the next look; legacy appearance blends, including keys hydrated from the working baseline, are preserved as explicit blend segments. v1 scenes migrate on read without losing hidden values or provenance. Evaluation resolves from the recipe and time, independent of prior playback/seek state. Library alias changes never implicitly replace embedded looks.

`window.kaminosCinematic.cueEditor` exposes `begin('ignition' | 'work', index)`, `state()`, `set(controlId,value)`, `useBasin(presetId)`, `selectLook(id)`, `makeUnique()`, `renameLook(name)`, `inheritLook()`, `inheritEmitter('radius' | 'flow',inherit)`, `accept()` and `cancel()`. Radius/flow edits affect the selected emitter key; other tune edits affect its shared look. Basin adoption retains that look's name and replaces its saved tune explicitly, without editing emitter keys. Current labels and earlier immutable library versions use the existing preset API. A pending basin cannot overwrite a cancelled or subsequently changed draft. Undo changes accepted cues, not evolved fluid.

Playback interpolates the supported numeric Appearance/Emission/Motion fields and preserves other saved coefficients with key-boundary changes. Resolution and solver configuration stay scene-level; incompatible simulation changes refuse before altering a draft. Cue runtime application does not create per-frame history entries. Temporary native range bounds and steps restore with the baseline after audition or playback; legacy cues retain their flow range through 4 without changing ordinary authoring admission. Source absence prevents playback. Cues preview uses a visibly identified retained SF3D chair; Fire SF3D retains the actual producer/presentation path.

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

Assets/Generate occupies a page region below the authoring viewport. Closing it
restores the viewport area; it does not cancel generation or mutate the scene.
The thin generation bar reflects the producer's current-stage percentage. Phases
without a denominator remain indeterminate; stage resets are not overall run
estimates. Stop aborts source fetches, prevents inference after a stopped weight
load, and throws AbortError at SF3D's existing cooperative progress boundaries.
The producer's finish path settles admitted work before another run is admitted.
Loading weights currently settles before stopping; the shared scene device is
never destroyed. A completed mesh wins a Stop race and is saved or retained for
storage retry. Persistence has no Stop button because it preserves completed
bytes. A device/foreground drain failure stays a failure, not a clean stop.

The authoring browser reads `/api/authoring-assets?collection=…` for saved meshes,
source images, Trellis/Pixal outputs and completed generator results. Greenroom
collections project generator receipts and recorded output directories, using
output-file metadata when present. Queue administration and unrelated command
screenshots are excluded. Missing historical outputs are counted separately;
malformed records and escaping paths produce diagnostics. Entries preserve their
canonical read/job-output URL. Import retains GLB bytes in the scene store and
saves `assetOrigin` with the original URL, producer/job information and actual
mesh digest. This is provenance, not a new producer-validation claim.

Mesh cards use an independent, lazy WebGL2 preview context over the existing
Three bundle. A failed preview is explicit; it never substitutes another asset.
Source images retain their ingestion names. Drag the asset area's upper separator
vertically to change its height; Up/Down arrows also resize it. Its extent survives
closing/reopening the pane during the current page, while scene poses, camera
pose and authored undo history remain unchanged.

The authoring asset pane leaves the Workbench layout while preserving its open
state and current generation. Active generation remains visible and stoppable in
the workspace header; its status button returns to the Authoring generation pane.
Workspace switching changes presentation without starting, stopping or restarting
inference. Catalog loading shows a small spinner beside the loading text and sets
`aria-busy`; reduced-motion preferences retain the indicator without animation.

### Fire ownership and collision inspection

Version 9 fire scenes store one `simulation-domain` object (`flame-field`): its transform and `simulation.settings` own the box and evolution; `volumeMaterial.settings` owns optical interpretation. The existing flame source owns `emission.settings` and references that domain through `emission.domainId`. Scene `fireRendering` owns renderer/presentation settings. A source-free domain retains a source template for re-add. The pinned basin remains a mount/bootstrap dependency; v9 scene records replace its coefficients on restore. Older documents retain their existing migration behavior. This does not add multiple sources, independent domains, or evolved-fluid checkpoints.

`kaminosSceneAuthoring.read().objects` exposes these records. `setFireSettings(objectId, 'emission' | 'simulation' | 'volumeMaterial', {controlId: value})` validates ownership and uses the shared reversible flame edit. Domain placement remains available through `kaminosFlameDomain`; collision uses `kaminosSceneCollision.set(boolean)`. The runtime still adapts this single authored domain to its existing control backing and allocation.

Collision and simulation resolution share the same grid. The inspector exposes the runtime's existing choices; changing one restarts the fluid. `kaminosSceneCollision.showVoxels(boolean)` is a viewport diagnostic, excluded from captures and authored scene records. `readMask()` returns the actual installed CPU mask uploaded to the solver, with its revision, dimensions, domain transform and effective collision receipt. Cyan boundary cells include the enabled source backing wall; unavailable geometry is reported rather than substituted with a second voxelization.

Viewport display is saved as `editorDisplay`: separate object outline, simulation boundary and emitter symbol widths/opacities/visibility, plus the overlay master and existing gizmo/bounds/helper/hint controls. `kaminosViewportSettings.read/set` uses the same display state; these choices do not alter physics or authored membership. Shift+Alt+Z toggles overlays and Ctrl+tilde (also Cmd+tilde on Mac) toggles gizmos while the pointer is over the viewport. Text fields/dialogs retain their shortcuts. Visible emitters pick through covering geometry, matching their overlay drawing; hidden emitters remain selectable from the scene tree.

Load identifies scenes by their saved filename, with the internal scene/look label underneath. The default cross-server library includes lane/consumer/scenes stores. Importing a fire scene retains its verified immutable pinned basin from the sibling basin store as well as existing mesh dependencies; it never changes source-store files or aliases. Missing/invalid basin dependencies fail the import visibly.

Fire & smoke's Quality section groups simulation grid, ray count, adaptive rays and screen resolution. Screen resolution is displayed as 10–100 percent of raymarch width/height; its saved `volume-render-scale` remains a fractional `.1..1` scene-rendering setting. The full-range source slider and authoring field share one value, with percent conversion only at the inspector boundary. Relative scrubbing, typing, Escape and chronological undo use the existing flame edit session. The collision section reports the matching voxel grid. Current fire collisions voxelize and upload at solver grid dimensions and use integer cell-coordinate texture loads; there is no independent voxel-resolution input in this route.


## Fire obstacles and volume height

A selected ordinary mesh has **Physics → Fire & smoke obstacle**. This writes
`collision: {domainId: "flame-field", enabled: true}` on that same authored
object; geometry, materials, source provenance and placement remain separate.
The field's **Scene collisions** switch enables the chosen obstacles together.
New primitives and imports start without collision participation. Older kiln
scenes retain their existing kiln collision when reopened. Version 10 saves the
explicit membership; versions before 9 reconstruct their domain from the saved
flame composition before validating that membership.

```js
const id = window.kaminosSceneAuthoring.addMesh('box', {
  width: 0.6, height: 0.08, depth: 0.6,
});
window.kaminosSetSceneObjectTransform(id, {position: [0, 0.3, 0]});
window.kaminosSceneAuthoring.setCollision(id, true);
await window.kaminosSceneEdits.undo(); // restores collision membership
```

Human and scripted membership changes share scene history and persistence.
The engine fills each selected object's solid independently and unions the
masks. A pose/geometry edit rebuilds that object's field; unchanged objects are
reused. Ordinary primitive material edits preserve their collision geometry.
The live `debugState().sceneCollision` receipt names members and refusal reasons;
`readSceneCollisionMask()` exposes the installed occupancy, rather than a mesh
bounding box. The existing supported solver/transport requirements still apply.

**Fire & smoke → Quality → Height / width** projects the existing height control.
Editing previews the resolved box; Enter, blur or completing a numeric drag
applies it. Escape restores the prior setting. The same authored-parameter setter
confirms scripted edits. Height adds/removes cubic-cell rows at fixed pitch;
world scale changes the pitch. Independent Z depth is not yet supplied by the
current solver; its mechanism is in the Flame Doctor's next grid slice.


If the device refuses a requested grid shape, source admission continues to use
the retained, active grid. The original request and refusal reason remain in
the runtime receipt. Saving that unapplied request is blocked: Undo or choose
supported dimensions first, so the accepted scene file is not replaced by a
configuration the live field did not admit. Other mesh scenes remain saveable.
