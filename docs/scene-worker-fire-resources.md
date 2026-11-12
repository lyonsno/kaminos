# Fire contribution to the shared scene worker

`createSceneWorkerFireResources(context, {definitions, fetch?, settingsLoader?, loadWaterHost?, mountRadiance?})`
constructs the retained domain shell consumed by `createSceneWorkerSceneResources`.
The ordinary constructor supplies its live resource readers. Production defaults
use the canonical saved-settings validator, actual volume/source helpers, actual
radiance mount, scene fire receiver, and HDR compositor. The optional service
arguments support isolated composition checks; they do not select a substitute
production renderer or GPU device.

`definitions` is the current page control inventory emitted by
`tools/scene-worker-control-definitions.py --page <index.html>`. The worker build
embeds this metadata, so saved-value preparation uses no runtime DOM. Canonical
schema controls must be present in saved data after the existing additive
projection. Only nonpersistent mapper inputs use the current page definitions.
Smoke presentation and retired scene/aperture requests retain their existing
meaning. Range bounds match the page's continuous saved-value path, including
unbounded authored source centres and radii. This metadata does not by itself
establish browser numeric serialization conformance.

For a saved document the contribution keeps `initialVolumeActive=false`.
`initialize` prepares the saved controls before construction; `prepareVolume`
installs primitives, world frame, domain transform and initial source inputs
before GPU activation. The actual document hooks stop old work, apply the
prepared settings, then use restored registered source roots before activating
and mounting lighting. A pinned basin remains a validated migration dependency;
modern fire records retain coefficient authority. Repeated preparation reuses
its validated immutable receipt. No scene-applied marker is produced by the
settings helper.

`readFrameState`, `readDrawSettings`, `readDrawResources`, `drawOperations`,
`prepareFrame`, `readUi`, and `createFireLightReceiver` connect the actual ordinary
frame/display graph to fire. Async lighting notifications update current plain
status; serviced frames read it instead of retaining an initializer's message
context. Native transport suppresses the separate volume surface through its
explicit `visible` projection. Root domain ownership retains receiver cleanup
before its allocations, and retires radiance/HDR/receivers before ordinary
resources and the separately owned device. A failed cleanup remains retryable.

This constructor mounts authored flame sources and their saved fire field, plus authored MLS water. Finite volumes initially restore as editable particle previews; `water.release` constructs the actual shared-device MLS host from current sources. Continuous sources restore into that host. `water.pause` and `water.reset` use synchronous foreground mutation admission; asynchronous release remains serialized with the worker's ordinary command lifecycle. Reset retires the current runtime and returns to the authored starting state without rewriting its setup.

The live host receives the ordinary scene's linear lighting output, final display policy, colliders, current camera and selection decoration. Fire transport remains available when the water host advertises transport support. Source pose/visibility changes synchronize before drawing; unchanged source packets are not republished each frame. A failed water frame retires water and renders the ordinary fallback while publishing its failure. Cancelled release candidates cannot become current. `water.read` and UI distinguish preview, pause, mounted simulation and failure. The existing Water simulation property slot exposes Play/Pause, Restart and Reset in the worker route; source settings, insertion/removal and full material controls remain migration work.

Water documents without authored sources, fire geometry collision, backdrop/DOF and output-camera presentation still require their actual joins. Requests for these paths refuse before scene replacement. This is an implementation boundary while assembly continues, not a complete worker migration or a permanent restriction of the editor.

Focused checks: `tests/scene-worker-fire-settings.mjs`,
`tests/scene-worker-fire-resources.mjs`, `tests/scene-worker-runtime.mjs`,
`tests/volume-worker-frame-binding.mjs`, and
`tests/scene-fire-light-receiver.mjs`. They exercise actual schema/mapping,
Three source roots and serialization, lifecycle/admission, and retained
allocation using recording GPU services. They do not establish live fire pixels,
whole-scene coverage, recovery or responsiveness.

Document preparation maps the candidate composition route before the live plan changes, preserving explicit URL precedence. Hybrid angular route settings supply defaults only where the saved rendering recipe omits them; requested caster geometry is selected before caster preparation. Leaving a fire document clears retired lighting status and refreshes ordinary studio/output state. These are authored-state transitions; they do not establish a new live GPU light-grid resizing capability.

The common constructor supplies `readSharedGpu()` for presentation reconstruction. Fire radiance, HDR, receiving and water service callbacks read that live owner; current standalone callers may still provide only the original `sharedGpu`. A cleared live owner never falls back to the stale initial device. This reference join does not itself register or exercise full device recovery.

Document replacement updates the retained volume’s scene-composition transparency while it is inactive, before the new scene can activate it. This covers ordinary → fire → ordinary → fire without leaving an opaque overlay from the initial document. The focused check uses the complete production volume and real offscreen surface without admitting GPU work.

`prepareVolume` clears per-volume configuration caches when supplied a replacement prototype. `reattachVolume` then mounts presentation from the current live authored plan and sources, without replaying the startup admission. The recovery owner prepares and activates that replacement before reattachment and retains final lifecycle activation. This hook is a construction join, not an exercised full recovery command.

Finite preview preparation resolves canonical shared water sampling from the complete candidate source set before constructing any source root. A saved particle target recalculates its cached spacing before allocation. This keeps multisource preview counts and world spacing consistent with the owner’s initial state, while ordinary registration, selection, visibility and disposal remain authoritative.
