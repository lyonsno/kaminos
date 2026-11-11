# Fire contribution to the shared scene worker

`createSceneWorkerFireResources(context, {definitions, fetch?, settingsLoader?, mountRadiance?})`
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

This constructor currently mounts authored flame sources and their saved fire
field. Its real `createAuthoredWaterFeature` is dormant; water document
restoration, geometry collision, backdrop/DOF and output-camera presentation
still require their actual joins. Requests for those paths refuse before scene
replacement. This is an implementation boundary while assembly continues, not
a complete worker migration or a permanent restriction of the editor.

Focused checks: `tests/scene-worker-fire-settings.mjs`,
`tests/scene-worker-fire-resources.mjs`, `tests/scene-worker-runtime.mjs`,
`tests/volume-worker-frame-binding.mjs`, and
`tests/scene-fire-light-receiver.mjs`. They exercise actual schema/mapping,
Three source roots and serialization, lifecycle/admission, and retained
allocation using recording GPU services. They do not establish live fire pixels,
whole-scene coverage, recovery or responsiveness.
