# Common scene worker handoff

`scene-worker-handoff.mjs` provides the persistent message boundary shared by
the scene/flame runtime and inference adapter. It executes ordered operations,
fences old scene/load/device work, and supplies cancellation and targeted
controls. It does not construct a renderer or migrate an existing page by
itself. Speedy's runtime and Cranial's inference operations compose inside its
worker-local factory; their ordinary GPU/frame/settlement contracts still apply.

## Construction

The page creates a module Worker and passes it to
`createSceneWorkerClient({port: worker, sessionId})`. A MessagePort also works;
its owner must forward Worker crashes to `client.disconnect(error)`.
The client does not create or terminate the worker.

```js
import {createSceneWorkerClient} from './scene-worker-handoff.mjs';
const client = createSceneWorkerClient({port: worker});
await client.initialize({sceneCanvas, volumeCanvas, telemetryCanvas, viewport}, {
  transfer: [sceneCanvas, volumeCanvas, ...(telemetryCanvas ? [telemetryCanvas] : [])],
}).completion;
```

Transfer the existing scene and volume canvases, plus telemetry if used. This
interface does not impose a single-canvas compositor or change mounting and
visibility ownership. GPU devices, queues, textures, sessions and callbacks
remain inside the worker.

The worker entry calls `installSceneWorkerHost({port: self, createRuntime})`.
`createRuntime({payload, context, lifecycle})` may await initialization and
returns this worker-local object:

- `host`: the existing injected application GPU host, including `session()`,
  `beginRun()` and `unsettledRuns()`, when inference participates.
- `commands`: an own-property map of named `(payload, context)` handlers.
  Handlers may be asynchronous. The runtime composes scene handlers and the
  inference adapter here; operation names belong to those adapters.
- `frame(payload, context)`: the synchronous ordinary scene/flame transaction.
  Use the normal shared-scene route; this is not a requirement to call the
  specialized `encodeProductFrame` path.
- `requestFrame(payload, context, draw)`: optional asynchronous admission through
  the existing foreground service. Invoke `draw()` synchronously inside the
  actual admitted window and return its plain receipt. This hook is required
  when an operation uses `context.withFrames()`.
- `control(action, payload, context)`: optional targeted model control, using
  the operation's existing supported controls. Advertising unsupported Pause
  or Resume is not implied by this generic transport.
- `retire(context)`: asynchronous retirement/cleanup of owned runtime resources.
  Preserve borrowed-resource and actual GPU settlement semantics.

`createVolumeWorkerFrameBinding` from `volume-worker-frame-binding.mjs` joins
an initialized ordinary volume (`frameScheduleOwner: 'host'`) to this facade
through the existing `createAppGpuHost` foreground service. Construct the app
host with `frameOwner: () => flameFrames`, then assign `flameFrames` with
`createVolumeWorkerFrameBinding({appHost, volume, applyFrameInputs})`. Return its
`frame` and `requestFrame` methods from the worker runtime. `applyFrameInputs`
applies camera/viewport/control snapshots synchronously at the admitted frame
boundary; its callback and GPU resources stay inside the worker. It is not an
asynchronous authored-scene loader. Model `beginRun` installs the common
requester on this binding without starting another RAF loop on the volume.
The binding awaits `appHost.activateFrames()` before admission, using the
same owner installation and scene activation as model `beginRun`. The first
ordinary worker frame therefore works before any model has run; no separate
manual `setForegroundServiceActive(true)` setup is required. Frame cancellation
waits for the actual foreground receipt before returning.
An inactive flame can return held while the common host still draws the scene.

Factory failure cleanup before returning a runtime remains the factory's
responsibility. A returned runtime remains owned by the worker until explicit
retirement; protocol errors and cancellation do not imply destruction.

## Operations, progress and controls

```js
const operation = client.request('model.execute', input, {
  signal: abortController.signal,
  onProgress: event => updateProgress(event.value),
});
operation.control('decodeNow').completion.then(showControlResult);
operation.cancel('operator Stop');
const result = await operation.completion;
```

Handles have `requestId`, `completion`, `cancel`, `control`, and a complete
`progress` snapshot. The runtime receives `context.signal`, `assertCurrent()`,
`report(value, {transfer})`, `transfer(resultTransferList)`, `epoch()`,
`advanceEpoch(component)`, `activate()`, and `withFrames(asyncRun)`.
Explicit transfer lists support CPU payloads without retaining a duplicate
worker buffer. Progress callback errors are visible in `client.read().observerErrors`;
they do not change the runtime's actual completion or certify GPU settlement.

Cancellation is sideband: it aborts the active or queued command's signal,
but its completion stays pending until the handler really returns or throws.
It cannot preempt a synchronous JavaScript loop; preparation code still needs
cooperative boundaries. Controls target that pending request only, run in
control-request order, and cannot mutate epochs through their restricted
context. Runtime adapters use their existing control methods and GPU admission.

Ordered operations normally execute serially. A long operation can use
`return context.withFrames(() => operation.run(...))` to admit frame requests
through `requestFrame` while it waits. Draw/depth/source callbacks remain
synchronous in the worker. During that scope frames may pass queued authored
mutations and observe the current applied scene/epoch, while authored operations
keep their FIFO order. Pending edits remain unapplied until acknowledged. Camera
and viewport input snapshots can travel in the frame payload and are applied by
the runtime at its frame boundary; they should not wait in the authored command
queue. This permits continued rendering/navigation, while safe authored editing
during inference still needs a runtime mutation boundary. Already admitted
frames and in-flight controls drain before the next
ordered mutation or retirement, including on failure. Existing worker-local
frame drivers also remain local; the page need not send an RPC per render pass.

## Epoch and retirement semantics

Epochs contain monotonically increasing `scene`, `load` and `device` integers.
Requests default to the client's latest observed epoch; await initialization
and scene replacement before issuing operations against their new identity.
Stale work fails before execution and again before publishing a result.

The runtime uses `context.advanceEpoch('load' | 'scene' | 'device')` for its own
ordered transition. It updates that command's ticket, invalidates other work
and rotates `lifecycle.signal`. External loss/recovery can call
`lifecycle.invalidate(component)` or the installed host's `invalidate`.
In either case frame admission is blocked until the runtime calls
`context.activate()` after reconstruction. Ordinary camera/parameter edits do
not have to replace scene identity; domain adapters define their authored meaning.

The persistent lifecycle object has a current `signal` getter and `epoch()`.
Capture its signal for one generation; read it again after replacement.
Command cancellation and lifecycle invalidation are distinct, although either
can invalidate the command's result.

`client.request('retire')` waits its ordered turn and the runtime's cleanup.
It refuses retirement while `host.unsettledRuns()` is nonempty; rejected finish
settlement stays held. Failed retirement also reports `gpuRouteHeld: true`.
Successful retirement advances device identity. Only then should the owner
disconnect and terminate its worker. `disconnect()` alone rejects pending work
as settlement unknown and removes client listeners; it is not GPU release.

Every successful transport result says `authority: 'worker-handler-returned'`.
Frame drawn, GPU submitted/settled and presented authority comes from the
underlying runtime's plain output, not that transport label. Save/capture and
lease release must consume the appropriate actual runtime receipts.

## Ordinary renderer and frame construction

The page and worker share `scene-render-bootstrap.mjs` and
`scene-frame-runtime.mjs`; the page adopts these same functions in `initScene`.
The modules have no DOM reads. Mounting, status text and input measurement stay
with the caller. They extract existing construction/depth/cadence semantics;
they do not yet move all of the page's domain draw callbacks into a Worker.

```js
const viewport = () => ({width: 640, height: 480, pixelRatio: 1});
const {scene, camera} = createSceneRenderObjects({THREE, viewport});
const {renderer, pmremGenerator} = await createSceneRenderer({
  THREE, scene, camera, sharedGpu, canvas: sceneCanvas, viewport, exposure: 1,
});
const frames = createSceneFrameRuntime({
  readInputs, draw, frameCount, prepare, readDepth,
  readSharedDevice: () => sharedGpu.device, readCamera: () => camera,
  coordinator, readSimInputs,
});
```

Viewport values must be positive finite applied measurements. Renderer size
writes default to `updateStyle: false` for OffscreenCanvas; the page opts into
CSS writes and uses `onConstructed(renderer)` to mount its canvas before async
initialization. Worker construction requires the exact injected shared device
and queue. The page retains its existing explicit independent-device fallback
through `allowIndependentDevice: true`. The returned renderer and PMREM remain
caller-owned; failure cleans up a constructed renderer, and supplied devices
remain borrowed under Three's existing disposal contract.

The frame runtime exposes `composition`, `planFrame(nowMs)`,
`depth({enabled, held})`, `consumeTransport(frame)`, `render`, `renderOrdinary`,
`runForegroundFrame` and `setForegroundServiceActive`. `prepare` runs before a
depth draw, and `readDepth` runs only after that draw succeeds. The depth result
contains the actual worker-local `{device, camera, texture}`; it is not a wire
payload. `consumeTransport` retains the synchronous transport scope around
`frame.renderHost()`. `readSimInputs(nowMs)` supplies existing flame, water and
ash inputs to the existing coordinator; per-scene-frame/close-timestamp plan
reuse is preserved. No numerical duty or simulation-clock policy changes here.

## Evidence

`tests/scene-worker-handoff.mjs` exercises native MessagePort cloning/transfers,
ordering, epochs, cancellation, controls, frame admission and retirement. Its
real Node Worker fixture executes the production `scene-frame-composition.mjs`
with a recording draw provider. This establishes the executable boundary and
thread placement, not WebGPU rendering, model execution, browser compatibility
or completion of the coupled-scene migration.


## Ordinary draw body

`createSceneDrawRuntime` in `scene-draw-runtime.mjs` returns the ordinary
synchronous draw function. The page adopts this same function through a small
adapter; the module has no DOM or window reads. Its constructor takes `THREE`,
`readSettings()`, `readResources()`, worker-local `operations`, optional
`onCameraStatus`/`onWaterFrame` status callbacks, `onWaterError(error, fallback)`,
`afterDraw(shadingReceipt, startedAt)`, and optional `now()`.

Settings supply held/custom-tone-mapping flags, GI mode/view, flame camera
matching, asset-preparation/capture/water-visibility/HDR flags, and beauty-frame
options. Resources supply the same renderer, render pipeline, water feature,
lighting/beauty/exposure services, camera output nodes and transport/depth/color
inputs. These are local resource bindings, not transferable message payloads.

Operations provide `beforeDraw`, `readPhysicalCamera`, `applyCamera`,
`syncProxies`, `planFrame`, `withBeautyFrame`, optional `refreshWaterStatus`,
and `renderFlameHDR`. They preserve the actual ordinary source/shadow/camera,
beauty/water/HDR and completion ordering. The beauty wrapper must execute
synchronously; a Promise cannot certify frame completion. A capture-time water
failure propagates. For ordinary viewing `onWaterError` owns the existing
water retirement/status response and invokes the provided scene-render fallback.
The default error handler throws. `afterDraw` owns frame count, proxy snapshots,
capture and status publication inside the same local transaction.

Worker assembly supplies these existing domain operations and keeps its GPU
objects local. The extraction makes the actual draw callable without the page;
it does not itself populate the full scene, relocate every domain service,
or implement safe authored mutation during inference.

## Ordinary lighting resources

`createSceneLightingGraph` in `scene-lighting-graph.mjs` constructs the existing
ordinary prepass, normal/depth AO inputs, denoised AO context and GI resource
graph using the supplied scene, camera, renderer and `THREE.TSL` namespace. The
page uses this same constructor. Inputs include accepted AO settings and
intensity, plain GI options, and the existing AO/depth/denoise/GI factories.
The returned render pipeline, passes, depth target/material, AO values and GI
owner stay local to the scene owner. No DOM element or route parser is needed
inside the constructor. Callers retain resource lifetime and shared-device
ownership; constructing the graph does not draw or certify native GPU execution.

Worker assembly must resolve bare Three imports in its domain modules to the
same vendored Three build. The page import map supplies that identity on the
page; importing a wrapper under Node can instead resolve the installed package.
This constructor uses the supplied `THREE.TSL` directly. Bloom/output graph
selection, authored loading and actual frame admission remain their respective
scene-owner operations.

`prepareSceneEmissionSource` and `createSceneDisplayGraph` in
`scene-display-graph.mjs` construct the physical-emission attachment and the
ordinary fire-receiving, bloom, camera and selection output nodes. The page
uses these same functions and retains its existing `giOutputGraphs` cache and
device-lifetime cleanup. The display constructor returns the five graph fields
that the scene owner installs on its render pipeline or retains in that cache.
It receives the existing scene/depth/normal/emission nodes and domain factories;
no second renderer, cache or presentation loop is created. A requested
fire-receiving path must provide its actual pass rather than silently produce
an unlit scene graph.
