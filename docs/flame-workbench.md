# Flame Workbench

Choose **Flame** in the shared Workbench experiment chooser, or add
`experiment=flame&workspace=workbench` to an existing scene URL. The contribution
borrows that scene's live flame. Opening, closing and reopening the contribution
does not create a replacement field, clear history, change settings or reset
simulation time. Choose a preset explicitly to add the first authored flame or
replace the active flame's settings.

Emitter and Simulation box select the existing objects and their contextual
inspector. Pause uses the ordinary fire Freeze control; the camera remains live.
Frame uses the existing camera operation. The full Volume controls remain in
the shared inspector rather than being duplicated in the experiment.

The selected simulation domain groups its active controls into **Look**, **Shape**,
**Motion** and **Quality**. Search finds settings across those views. Front/ridge
and support shaping remain editable alongside material color, smoke, wind,
combustion, solver and raymarch controls. The emitter's supply controls remain
with the selected emitter. This grouping does not change scene/source/material
storage ownership. Retired research routes remain in the original Volume tool;
the ordinary inspector does not require switching back there for these controls.

Numeric fields retain the shared drag, click-to-type, fine adjustment and undo
behavior. Typed decimal values use the same precision-preserving range adapter
as saved presets. Binary backing-wall values appear as a checkbox while keeping
their existing numerical save representation. AgX hides the custom-curve knee;
effective physics appearance hides unused carrier controls and reports whether
the requested physics material is actually active. Hiding a control does not
rewrite its saved value.

Agents use the same operations:

```js
const experiments = window.kaminosWorkbenchExperiments;
await experiments.open('flame');
await experiments.invoke('select', 'domain');
await experiments.invoke('setControls', {'volume-wind-strength': 0.2});
await experiments.invoke('setPaused', true);
const actual = await experiments.read();
```

`setControls` accepts existing control IDs and passes a whole-settings edit
through `kaminosFlameAuthoring`. Unknown IDs, invalid values and inactive runtime
edits fail. `applyBasin(presetId)` and `listBasins()` use the existing basin
library. These are authored operations, not renderer-only overrides.

## Retain An Investigation

Use the existing attached Playwright page and a caller-owned output directory:

```js
import {mountFlameInvestigation} from '../flame-investigation-mount.mjs';

const handle = await mountFlameInvestigation({
  page, out, source,
  guide: {question: 'How does this inlet behave against the wall?'},
});
await handle.finished;
```

`source` identifies the actual checkout/route used by the caller. Use the
existing source verification for a local server, not a claimed revision alone.
Keep Node attached until Capture/Finish has written through the shared writer.
The common `investigation.json`, observation directories and `recording.v8`
layout are unchanged. Agents read captures with `readObservationSession()`.

The adapter subscribes to ordinary source controls, authoring history and camera
changes. It retains actual settings, serialized authored objects (including
geometry and obstacle settings), the scene-collision gate, camera, effective
runtime controls and grid admission, route/backend and simulation clock. Agent operations use the same
source path, so an intervention is not recorded again at the wrapper. No
animation-tick polling, second renderer or second recorder is introduced.
Source events have phase `observed`: authored values can include a pending grid
preview, while `effectiveRuntimeControls` identifies the renderer's actual state.
Confirmation emits a `flame.runtime` observation even if authored values are
unchanged; the observation includes actual grid shape/admission and clock.
Cancelling a pending edit records the restored authored values, not a runtime
application. Clock advances alone do not create operation rows.
Capture observes the displayed frame passively; its before/after context can
describe a moving interval. Finish stops recording without stopping the flame.

An authored scene or preset reopens settings. It does not restore evolved GPU
fields. The recording explicitly carries live-runtime starting conditions and
does not claim a field checkpoint or exact replay from a fresh process.
