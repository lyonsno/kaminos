# Ordinary scene construction in the common worker

`createSceneWorkerSceneResources({...runtimeContext, createDomains, services?})`
returns a retained shell before resource allocation. The common runtime supplies
its actual `THREE`, `scene`, `camera`, `renderResources`, `sharedGpu`, `payload`,
`lifecycle`, `viewport`, `readFlameControls`, `applyFlameControls`, and
`readAppHost`. Renderer and PMREM readers always use `renderResources`.

The shell owns ordinary appearance, accepted AO/GI/environment settings, display
and bloom graphs, selection feedback, actual registry/document composition,
GLTF/GLB loading, materials, beauty LODs, and ordinary frame/draw runtimes. The
common runtime retains renderer/PMREM/AO/GI lifetime and the single device.

## Fire and water contribution

`createDomains({...runtimeContext, ordinary})` is synchronous and returns its
cleanup shell before any asynchronous initialization. Initialization validates
its required methods, retains the shell, then calls `initialize(context)`.

Required methods:

- `initialize(context)`: prepare actual domain settings, including saved fire
  controls before volume allocation. Ordinary registry/material owners exist;
  ordinary appearance/lighting may not yet be initialized.
- `prepareVolume({volume, context})`: configure source/primitives/world before
  the common runtime calls `volume.setActive(initialVolumeActive)`.
- `attachVolume({volume, appHost, context})`: attach actual source, scene depth,
  transport and radiance services. Ordinary frame/display owners now exist.
- `retire(context)`: detach consumers and release owned domain resources; failed
  cleanup must retain the same resources for an explicit retry.
- `readFrameState(nowMs?)`: live ordinary admission fields `lightingHeld`,
  `exclusiveInspection`, `manualInspection`, `transportRequired`,
  `radianceReady`; display flags `fireLightFieldRoute`, `distributed`; and
  `simInputs: {flame, water, ash}` for the existing simulation coordinator. Each
  simulator supplies an explicit Boolean `active`; `radianceReady` and
  `transportRequired` are Boolean. Missing state refuses rather than silently
  planning inactive simulations.
- `readDrawSettings()`: actual `waterVisible`, `flameHDRActive`,
  `customToneMapping`, `matchFlameCamera`, `assetPreparationActive`, `capturing`
  as applicable. Ordinary GI settings remain with the ordinary owner.
- `readDrawResources()`: actual `waterFeature` (`host`, `render`), plus optional
  `sceneExposureControls`. Ordinary renderer/pipeline/output identity wins.
- `assertRecordSupported(record, loaders)`: preclear support for requested
  non-GLB records. False, asynchronous support or thrown errors refuse.

`drawOperations.beforeDraw(nowMs)` and `drawOperations.syncProxies()` are
required. Actual requested paths additionally use `readPhysicalCamera()`,
`renderFlameHDR(frame)` and `refreshWaterStatus()`, with `onWaterFrame(state)`,
`onWaterError(error, fallback)` and `afterDraw(receipt, nowMs)` as appropriate.
`createFireLightFieldReceiverPass(input, depth, normal)` is required by the actual
fire-light-field route. Ordinary code supplies the existing matched-camera
application, visibility, selection, beauty-LOD, shading and frame-plan scopes.

The root's `document` contribution supplies synchronous
`assertSupported(data, plan)` and potentially asynchronous
`prepareDocument(data, plan, meta)`, `beforeReplace(data, plan, meta)`, and
`afterReplace(data, plan, meta)`. `meta.context` is the invocation's actual
cancellation/epoch context. Unsupported requested domain or presentation
features refuse before registry replacement; a callback must not certify
unimplemented requested settings. Ordinary transforms/material library,
environment/ground, AO/GI/reflections/bloom and editor visibility/shading apply
through real local owners. The root supplies remaining presentation/domain
meaning, including requested output cameras, backdrop/DOF, fire and water.

Optional contribution fields are `initialVolumeActive`, `volumeOptions`,
`commands`, `foregroundCommands`, `loaders`, `recordReaders`,
`restoreOperations`, `roots`, `membership`, `replacement`, `documentServices`,
`applyPreferences(startup, context)`, and `applyFrameInputs(input, context)`.
Command collisions fail explicitly. Registry replacement uses actual device
queue settlement and any additional `replacement.context.retire` service.

## Ordinary readers

`ordinary` exposes actual `scene`, `camera`, `renderResources`, `sharedGpu`,
`workingScene`, and `viewport`. Live getters expose `appearance`, `lighting`,
`display`, `frames`, `authored`, `document`, `materials`, `beautyLods`,
`giProxies`, `output`, `coordinator`, `bloom`, `surfaceLighting`,
`lightingPreparation`, and the resolved `startup` input.
`decorateOutput(node)` uses the actual selection feedback output.
The lighting preparation owner exposes the existing `request(change)`,
`setExternalHold`, `state`, `whenIdle`, `withRenderer`, and retry operations;
holds forward to the attached volume's `setSceneLightingRebuildPending`.
`domains.prepareFrame()` optionally synchronizes sources before ordinary depth;
the ordinary owner updates its fire receiver once afterward.
`createFireLightReceiver` is accepted as an alias for
`createFireLightFieldReceiverPass`.

Operations: `readSettings()`, `applySettings(data, context)`, `visible(id)`,
`readBounds()`, `rebuildDisplay()`, `registerSceneObject(...args)`, and
`setArrival(patch)`. `output.activeSceneDepth` and `frames.depth()` supply the
actual ordinary depth path; `frames.consumeTransport()` is the actual scene
transport consumer. `workingScene` and `authored` preserve registered root
identity and document load generations.

`shell.readUi()` reads current asynchronous environment/loading/preparation state
and merges `domains.readUi()`. The common runtime uses this for current
frame/mutation/initialization replies; it does not rely on progress sent through
a completed initializer. Full registry/bounds projection occurs at authored
command boundaries, not on every frame. `surfaces.volume.visible` controls
canvas presentation separately from simulation `active`; transport can hide
retained volume pixels without disabling the simulation.

The common runtime calls `initialize`, `prepareVolume`, volume activation, then
`attachVolume`. Only after actual domain attachment and any initial document
application does the constructor publish initialization markers. Environment
maps retain their progressive loading status independently of recipe admission.

`services` supplies optional effective-route operations for tests or embedding:
`loadHDR`, `readAssetBytes`, `proxyOptions`, and `glbOptions`. Production defaults
use the actual loaders and one vendored Three namespace. The GLB registry loader
restores saved placement (`normalize:false`); fresh asset arrival needs the
actual geometry-arrival service, not successful unplaced publication.

## Evidence

`tests/scene-worker-scene-resources.mjs` constructs actual Three appearance,
SSGI/display graphs and GLB/registry/document owners with a recording renderer
and PMREM. It checks replacement, saved pose/material/lighting, preclear refusal,
startup markers, frame composition and retained cleanup. It does not execute GPU
shaders or establish textured browser rendering, coupled simulation performance,
or responsiveness. Those claims belong to the assembled worker entry consumer.
