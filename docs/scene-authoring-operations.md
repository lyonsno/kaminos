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

Selected Flame groups the original Volume controls into Appearance, Emission, Motion, Simulation and Legacy appearance. Scope labels distinguish the selected source from the shared simulation domain. The focused inspector omits experimental material-model and detail-force controls; their loaded values remain intact and accessible in Workbench. The Basin browser searches and applies saved recipes in place, preserving the authored source pose and scene objects. Drag numeric field bodies or labels relatively; an idle field click enters ordinary text editing. Shift makes subsequent drag movement finer without a value jump, and Escape cancels. Transform numbers use the same field-body gesture. One completed drag is one history entry. Numbers retain direct typing. Undo restores authored coefficients and recipes, not earlier fluid simulation fields.

`window.kaminosFlameAuthoring.read()` returns a copy of the complete working settings and source recipe receipt. `apply(snapshot, label)` applies a complete validated snapshot as one history entry. `await applyBasin(presetId)` loads an existing immutable recipe and applies it through the same operation as the inspector. It rejects an overlapping load or an intervening scene edit; retry explicitly after resolving that edit. Finish or cancel an active gesture first.

```js
const before = window.kaminosFlameAuthoring.read();
await window.kaminosFlameAuthoring.applyBasin(existingPresetId);
await window.kaminosSceneEdits.undo(); // restores every coefficient and source receipt
```

Scene saves persist modified settings as an immutable preset with `publishAlias:false`; the original library alias remains unchanged and scene snapshots do not populate the basin library. Saving an explicitly named basin through Workbench retains its existing library behavior.

Save/Save As collect accepted Volume controls into the composition's immutable basin reference and preserve the light recipe. Reopen uses `compositionRestoreUrl()` and the registered scene/asset/basin stores described in [basin presets](basin-presets-for-inference-smokes.md). Scene JSON does not bundle external GLBs. Add Water Emitter consumes the existing typed local-liquid adapter; the menu does not establish mixed kiln/water physical support or a new solver contract.
