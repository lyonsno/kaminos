# Shared scene authoring operations

These operations act on the mounted Kaminos page and its current scene/history. Browser automation calls them in that page's JavaScript context. They use the same setters and edit ledger as the human controls.

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

`@rim-settings` accepts the existing light recipe fields or a partial patch. Invalid recipe values are rejected before acquiring a transaction. `@burner-controls` pairs the burner recipe, source radius and flow across Assets and Volume. Bound Volume range/number/checkbox/color inputs use `@parameter:<control-id>` with `{value}`. Selects, text fields and arbitrary buttons are not implicitly history adapters. Environment and fire-light targets are also discoverable through `list()`.

Selected Flame exposes Flow, Radius, Speed and Exposure aliases to the original Volume controls. Drag numeric field labels relatively; Shift makes the drag finer and Escape cancels it. One completed drag is one history entry. Numbers retain direct typing. Undo restores authored coefficients and recipes, not earlier fluid simulation fields.

Save/Save As collect accepted Volume controls into the composition's immutable basin reference and preserve the light recipe. Reopen uses `compositionRestoreUrl()` and the registered scene/asset/basin stores described in [basin presets](basin-presets-for-inference-smokes.md). Scene JSON does not bundle external GLBs. Add Water Emitter consumes the existing typed local-liquid adapter; the menu does not establish mixed kiln/water physical support or a new solver contract.
