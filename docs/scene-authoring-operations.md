# Shared scene authoring operations

These operations act on the mounted Kaminos page and its current scene/history. Browser automation calls them in that page's JavaScript context. They use the same setters and edit ledger as the human controls.

For scripted comparisons and editable human handoff, use [repeatable visual work](repeatable-visual-work.md). Save, Save As and Capture accept `{result:true}` to return the exact saved filename, restore URL and document for that invocation; existing calls retain their boolean result.

`window.kaminosSceneObjectDebugState()` lists IDs, types, sources and poses. `window.selectSceneObject(id)` selects an object. `window.kaminosSetSceneObjectTransform(id, patch)` applies an accepted pose edit; position and scale are triples, rotation is an XYZ Euler triple in radians. `window.kaminosSceneEdits` exposes `begin(id, label)`, `preview(patch)`, `commit()`, `cancel()`, `undo()`, `redo()` and `state()`. Await undo/redo when membership replay can load assets. Complete or cancel an active gesture before another operation or saving.

The existing rim light appears under `@rim-light`. Enable/select it through Add → Rim Light or the Assets scene-list button. Moving translates its target with the light; rotating aims the beam from its existing position. Use Cone Angle for spread: object scaling is rejected. It remains one light backed by `environment.rimLight`. The editor handle is excluded from saved object records and composition captures, recreated from the recipe, and excluded from grouping and renaming.

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

Selected Flame presents Appearance, Emission and Legacy appearance. Scene properties hold the shared Motion and Simulation controls. Scope labels distinguish the selected source from the shared simulation domain. The focused inspector omits experimental material-model and detail-force controls; their loaded values remain intact and accessible in Workbench. The Basin browser searches and applies saved recipes in place, preserving the authored source pose and scene objects. Drag numeric field bodies or labels relatively; an idle field click enters ordinary text editing. Shift makes subsequent drag movement finer without a value jump, and Escape cancels. Transform numbers use the same field-body gesture. One completed drag is one history entry. Numbers retain direct typing. Undo restores authored coefficients and recipes, not earlier fluid simulation fields.

`window.kaminosFlameAuthoring.read()` returns a copy of the complete working settings and source recipe receipt. `apply(snapshot, label)` applies a complete validated snapshot as one history entry. `await applyBasin(presetId)` loads an existing immutable recipe and applies it through the same operation as the inspector. It rejects an overlapping load or an intervening scene edit; retry explicitly after resolving that edit. Finish or cancel an active gesture first.

```js
const before = window.kaminosFlameAuthoring.read();
await window.kaminosFlameAuthoring.applyBasin(existingPresetId);
await window.kaminosSceneEdits.undo(); // restores every coefficient and source receipt
```

Scene saves persist modified settings as an immutable preset with `publishAlias:false`; the original library alias remains unchanged and scene snapshots do not populate the basin library. Saving an explicitly named basin through Workbench retains its existing library behavior.

Save/Save As collect accepted Volume controls into the composition's immutable basin reference and preserve the light recipe. Reopen uses `compositionRestoreUrl()` and the registered scene/asset/basin stores described in [basin presets](basin-presets-for-inference-smokes.md). Scene JSON does not bundle external GLBs. Add Water Emitter consumes the existing typed local-liquid adapter; the menu does not establish mixed kiln/water physical support or a new solver contract.

## Burner assemblies

An authored burner assembly groups a procedural bed and the domain's flame source. Select the assembly row to move, rotate or uniformly scale both members; select a child to change its offset. The bed's selected properties own its dimensions and material. Emission belongs to the source, while motion and simulation coefficients remain shared scene settings. The existing analytic domain supports one flame source. Add Flame Source selects that source if it already exists; Add Burner Assembly selects its existing assembly. Additional beds can be added or duplicated independently.

Bed geometry remains visible without a source. Removing a source stops injection; it does not rewind the already evolved simulation field. Undo restores authored membership/settings. A flame composition must be mounted before adding its source or bed.

`window.kaminosBurnerAuthoring` exposes `read()`, `add('burner-assembly' | 'burner-bed' | 'flame-source')`, `setBed(id, recipePatch)`, `duplicate(bedId)`, `attach(bedId, assemblyIdOrNull)`, `rename(id, label)` and `remove(id)`. Each accepted call uses the shared history ledger. Removing an assembly removes its members in one reversible edit. Attaching/detaching retains world placement. Assembly placement uses the edit target `@assembly:<group-id>`; pass that target to the scene pose setter or begin/preview/commit lifecycle. Bed and assembly scaling must be positive and uniform.

The scene tree's Group loose objects action preserves existing groups and assemblies, excludes the rim helper, and records one reversible organization change. Existing group IDs are available from the saved scene document and burner service snapshot.

Scene version 6 stores each bed's recipe on its object record and the assembly frame on its group. Opening an older composition migrates its legacy burner recipe into these records in memory; Save writes the migrated document. Explicit source absence in version 6 survives reopen. Older scene compositions retain their legacy implicit source behavior. Geometry assets remain external, as with other scene saves.

## Viewport interaction

Scene hierarchy rows select on one click. Double-click a name (or use F2 on a focused row) to rename; Enter or blur accepts, Escape cancels. The rim helper remains named by its light role. The existing × removal and Add actions continue to use their scene operations. Add → Asset browser opens the full Workbench import surface; it does not introduce a new append/file-retention contract.

Viewport → Transform gizmos is a view preference across selections, independent of saved object poses. Navigation hints are another viewport preference. Move/Rotate/Scale toolbar buttons explicitly enable their gizmo. These preferences are session-local, not authored scene history. Grid and global wireframe controls are not implemented by this menu.

Numeric scrub fields display three significant figures while idle; the input retains its precise value and shows it for text editing. Relative numeric drags (including transform axis labels) and G/R/S request browser Pointer Lock, use unbounded logical movement and draw a wrapping software cursor. The browser restores its system cursor to the entry point on release. Escape or unexpected lock loss cancels the edit. When Pointer Lock is unavailable, ordinary bounded dragging remains usable. This does not change native Three.js gizmo-handle dragging or trackpad camera navigation.
