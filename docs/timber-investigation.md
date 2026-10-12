# Timber Investigation Domain Join

`bindTimberInvestigation()` connects an existing two-timber controller to the
shared investigation operation channel. It supplies passive context; it does
not create a recorder, persistent document, browser, guide or simulator.

```js
import {bindTimberInvestigation} from './timber-investigation.mjs';

const timber = bindTimberInvestigation({
  controller: window.__kaminosTimberIgnitionSmoke,
  volume: window.__kaminosVolumePrototype,
  basin: () => window.__kaminosDefaultVolumeSmokeBasin.presetId,
  readObjects: () => window.kaminosSceneObjectDebugState(),
  readCamera: () => window.kaminosNavigationState(),
  readScene: () => window.kaminosSceneAuthoring.read(),
  readEdits: () => window.kaminosSceneEdits.state(),
  operations: investigationOperations,
});
const observation = timber.read();
```

The shared owner supplies `investigationOperations` with `active` and
`emit(operation)`. Only an active recorder receives domain events. The caller
owns recording start/finish and capture retention, and calls `timber.dispose()`
when detaching. Disposal removes the subscription, not evolved timber or fire.

`read()` preserves controller state, actual volume metadata, basin, objects,
full caller-provided camera, authored scene and edit context. It performs no
diagnostic hold, redraw or GPU material readback. `attempt.available` is false
when restoration is incomplete, the mounted scene is replaced, or the expected
native local48 route/setup is absent; raw context and reasons remain inspectable.
The read is one passive sample, not proof that a subsequently captured frame
represents exactly that simulation step. Shared capture must bracket changes.

Controller `status()` carries `attemptId`, `generation` and `operationIssues`.
Its `resources` name the actual fluid allocation and material assembly. The
passive join lowers availability when those identities are absent or replaced,
even if authored object IDs are unchanged. Continuation rejects replaced
resources; explicit Reset can establish a fresh cold attempt instead.
Successful fresh scene/resource restoration assigns a new physical attempt;
Run and Pause preserve it, Repeat and Reset replace it, and failed restoration
cannot advertise the old resources as the current attempt. Delivered operations
name actual burner transitions, completed advances, timber placement, pause,
live continuation and failure. `subscribeOperations(callback)` returns an
unsubscribe function. Observer failures are retained without aborting physics.
These hooks cover controller operations, not every scene edit or camera action;
the shared source owners provide their own ingress.

Persistent investigation identity and physical-attempt identity are distinct.
Returning to the same available page can preserve evolved material and gas.
After page loss, replaying the saved scene creates fresh resources; there is no
GPU checkpoint restoration. The shared entry/bootstrap and storage are separate
owner integrations, not implemented by this adapter. Simulator and raymarch
captures or operator sessions use the required Greenroom admission.
