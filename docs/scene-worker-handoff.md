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
`createRuntime({payload, context, lifecycle})` returns a worker-local runtime.
For fallible GPU construction, return a cleanup-capable shell first and put
allocation/awaited setup in its optional `initialize(context)` method. The facade
retains the shell before calling that method. Legacy factories may still await
construction before return, with the pre-return cleanup responsibility below.
The runtime supports:

- `initialize(context)`: optional asynchronous setup after shell retention. It
  requires a callable `retire` method before setup begins. Return normally on
  success and throw on failure; its return value is not a separate readiness
  certificate. Capture the original initialization payload in the factory closure.
- `host`: the existing injected application GPU host, including `session()`,
  `beginRun()` and `unsettledRuns()`, when inference participates.
- `commands`: an own-property map of named `(payload, context)` handlers.
  Handlers may be asynchronous. The runtime composes scene handlers and the
  inference adapter here; operation names belong to those adapters.
- `foregroundCommands`: an optional own-property map of synchronous authored edit
  handlers, described below. Registration is explicit; ordinary async commands
  retain their serialized semantics.
- `requestMutation(operation, payload, context, apply)`: the foreground admission
  hook for those handlers. `createSceneWorkerMutationBinding({appHost})` supplies
  it through the same app requester/device/queue.
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
responsibility. Use the shell form whenever allocation followed by an awaited
failure could also leave cleanup incomplete. Record each allocated handle in the
shell's closure before awaiting its initialization; clear a handle only after its
cleanup succeeds, so retirement can retry the failed steps. A `createSceneRenderer`
caller can retain its early renderer through `onConstructed` if construction's
own cleanup fails. Do not put those fallible allocations before shell return.

A returned shell remains owned until explicit successful retirement. The facade
awaits `initialize(context)` and checks cancellation/epochs before publishing
`{initialized: true}`. A failed or canceled setup returns an error with
`gpuRouteHeld: true` while retaining the shell. It rejects ordinary commands,
frames, edits, controls and cooperative frame scopes until setup has succeeded.
Another initialize request cannot overwrite a retained shell. `read()` exposes
`runtimeRetained` separately from `initialized`, along with phase/error; retaining
cleanup ownership does not certify initialization or presentation.

`retire(context)` also works on a partial shell. Failed retirement keeps it owned
and held for another retirement attempt; successful retirement clears it and
advances device identity before a new factory may run. The `host`, `commands`
and `foregroundCommands` properties may be getters over nullable worker-local
resources: the facade retains the object itself and reads current properties,
without snapshotting them. Keep initialize/retire callable from shell return.
Protocol errors and cancellation alone do not imply destruction.

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
queue. This permits continued rendering/navigation. Explicitly registered foreground
edits use the mutation boundary below; other authored operations keep waiting. Already admitted
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
or register the common factory's actual scene-edit handlers.

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

The lighting graph also owns `syncReflections()` and `resizeDepth()`. Call the
former after updating `sceneGI.reflections` settings and the latter after renderer
size or pixel-ratio changes (it returns whether the AO target changed). Initial
standalone reflection context and pre-build ordering are installed by the
constructor. Page and worker owners do not duplicate those hooks. Requested
fire-light and emissive-camera providers must return a non-null `outputNode`;
incomplete providers fail before downstream bloom or selection composition.


## Synchronous authored edits during model work

The common worker factory registers the operations whose actual application is
synchronous in `foregroundCommands`, and spreads the return of
`createSceneWorkerMutationBinding({appHost})` into its runtime:

```js
import {createSceneWorkerMutationBinding} from './scene-worker-mutation-binding.mjs';
return {
  ...createSceneWorkerMutationBinding({appHost}),
  commands: {loadScene, executeModel},
  foregroundCommands: {
    setObjectPosition(payload, context, service) {
      context.assertCurrent();
      const object = findAuthoredObject(payload.id);
      object.position.fromArray(payload.position);
      return {id: payload.id, position: object.position.toArray()};
    },
  },
  frame, requestFrame, control, retire,
};
```

The example names are factory-owned handlers, not preinstalled operations.
Loading, parsing, texture decoding and other asynchronous preparation remain
ordinary commands or prepare independently before a synchronous application
step. Do not register scene/load/device replacement here. Handler names must
not also occur in `commands`. Each handler receives the exact admitted Kit
service as its third argument for existing worker-local GPU operations.

During `context.withFrames()`, eligible edits share the serialized foreground
transaction tail with frames. They can interleave with the long model command,
in authored request order, but cannot overtake an earlier ordinary authored
command, replacement or retirement. Frames may still pass that barrier and see
the currently applied scene. Outside a cooperative scope these edits wait their
ordinary queue turn and still use the same foreground admission. The model
scope and subsequent replacement/retirement drain admitted edits as well as
frames and controls.

Edit contexts expose requestId, signal, assertCurrent, report, transfer and epoch.
They exclude advanceEpoch, activate, lifecycle invalidation and withFrames.
Pending cancellation or stale scene/load/device identity prevents application.
Ordinary edits leave those replacement epochs unchanged. The model adapter must
capture and own its input snapshot before opening the cooperative scope; later
scene edits do not rewrite the admitted model inputs or provenance. This is
confirmed for the current Klein image-input path; scene-conditioned models
need their own resource/snapshot ownership analysis before opting in.

The binding activates the existing app foreground owner, validates the exact
service device/queue, applies once synchronously, and waits for the actual Kit
receipt. Its output is `{mutationApplied: true, value, foregroundReceipt}`.
The page keeps the edit pending until this result. GPU completion and display
presentation retain the receipt's original authority. The app's normal
foreground composition may draw the resulting scene in that same transaction.

When present, binding failure metadata distinguishes `mutationApplied: false`
(callback never entered),
`null` (handler threw after entry, application unknown), and `true` (application
returned but a later render/receipt step failed). An absent field certifies no application status. This is no rollback guarantee;
the page must reconcile actual state after unknown or applied failures, not
blindly retry an edit as if it never ran. Declared async handlers are rejected
before invocation. A handler returning an unexpected thenable invalidates device
identity, signals outstanding work and holds the route: an escaped async write
cannot be certified safe by a failed synchronous receipt. This hold is not
cleared by an ordinary activate command or a retirement success.

`tests/scene-worker-foreground-edits.mjs` exercises the vendored Kit foreground
service and Three Object3D mutation through native MessagePorts and an actual
Node Worker. Recording queue/frame services establish boundary ordering and
thread placement; they do not execute model kernels or establish full native
coupled-scene editing/presentation. The common factory owns registration and
consumer exercise of actual domain edits.

## Fire irradiance receiving resources

`createSceneFireLightReceiver` in `scene-fire-light-receiver.mjs` is the page's
actual receiver graph, parameterized by its local Three namespace, shared GPU,
renderer, scene, camera, GI proxies, parsed route values and existing shadow
factories. `readLightField()` reads the current local volume producer on every
update, including after producer replacement. No GPU object crosses a message
port. The receiver retains device/field identity checks, world reconstruction,
rectangular atlas sampling, near/far illumination, shadows, probes and controls.
Its owner calls `update()`, `renderShadows()` and `dispose()` at the same points
in scene composition. Disposal releases the receiver's two black placeholders
and shadow owners while borrowed producer textures remain producer-owned.

`mountSceneRadianceResources` in `scene-radiance-resource-mount.mjs` selects the
existing point, distributed, or hybrid module from the applied route and mounts
it with worker-local scene/device resources. The normalized default flame route
uses hybrid distributed smoke and surface lighting; the lattice receiver alone
does not supply that default illumination. Source records, controls and guide
are live local readers; hybrid receives the existing surface-lighting owner,
shadow settings and lighting-preparation rebuild service. The page uses this
same mount while retaining its UI, caster preparation and edit-history adapters.
Worker assembly must supply those domain preparations and lifecycle too.

## Retained common runtime composition

`scene-worker-runtime.mjs` exports `createSceneWorkerRuntimeFactory` for the
worker entry's `createRuntime` option. Pass the worker's vendored `THREE`, its
local `createSceneResources` constructor, and optional `imageOptions` (the
existing Klein adapter's weights, persistence, and model configuration). An
explicit `imageOptions: null` leaves image operations unregistered. This is the
initial composition boundary; the complete page/domain loader migration and
native coupled scene remain separate consumer work.

The factory returns a retained shell before any asynchronous GPU allocation.
Its `initialize(context)` acquires the one device with the composed scene/model
requirements, uses `createSceneRenderer` on the transferred scene canvas,
constructs the ordinary host-scheduled volume on the transferred volume canvas,
and binds frames/edits/model operations through the same `createAppGpuHost`.
No GPU handles or local callbacks are sent across the port. Initialization
payload supplies `viewport`, `sceneCanvas`, `volumeCanvas`, `flameControls`, and
optional `exposure`. The scene constructor receives those local resources and
returns its cleanup-capable shell before fallible domain allocation:

- `initialize(context)` constructs actual scene/domain resources after retention.
- `frames` is the actual ordinary scene frame runtime, including foreground
  activation and synchronous `runForegroundFrame`.
- `volumeOptions` supplies actual depth/collision/transport settings; the factory
  fixes Three/camera/shared device/surface/ordinary ownership and host scheduling.
- `applyFrameInputs(input, context)` applies accepted camera/viewport inputs
  synchronously at the serviced frame boundary.
- `attachVolume({volume, appHost, context})` joins actual scene source/transport
  and lighting, including post-mount caster preparation and epoch checks.
- `commands`, `foregroundCommands`, and `retire(context)` retain the existing
  domain operations and cleanup. Reserved or conflicting operation names fail
  initialization; there is no substitute basic-scene fallback.

The constructor is worker-local, not part of the message format. Its resource
shell retains partially allocated graph/domain handles until cleanup succeeds.
The factory likewise retires model resources before the app host, waits queue
settlement, then retires scene resources, volume, PMREM, renderer, and its owned
device. Failed steps remain reachable for explicit retry. `appHost.retire()`
closes only a session that was already created, keeps a failed close for retry,
and refuses unsettled or starting model admission. After host retirement begins,
new session/frame/run requests are refused. Device-loss reconstruction must use
the agreed fresh ordinary recovery command; this initial factory does not yet
implement replacement resource wiring or preserve causal simulation history.

Frame snapshots carry `now` and the sending page's `timeOrigin` (both finite)
so the worker converts the frame timestamp to its own performance clock before
calling the ordinary volume. Worker-local callers may omit `timeOrigin` when
`now` already uses that clock. A frame may include the current positive
`viewport` and plain `camera` snapshot. The factory updates its owned viewport
store. Its `scene-worker-view.mjs` consumer applies the exact camera projection,
inverse and world pose, and resizes the retained renderer only when extent or
pixel ratio changes, before invoking the domain input callback. The initial
camera snapshot follows the same path before domain initialization.
Frame output includes `ui.surfaces.volume.{active,transparent}` for page mounting
and CSS projection. Those booleans describe requested surface state, not proof
of browser presentation.

Use the admitted synchronous `flame.controls` command for changed flame control
fields. It invokes the actual volume `setControls` before updating the worker's
accepted-controls store, returning `acceptedControls` (not a claim about effective
GPU substitutions). Invalid controls retain the previous accepted snapshot.
Settings are not reapplied on every RAF; a frame carrying `flameControls` is
rejected with the named command to use. `createSceneResources` also receives
`readFlameControls()` for current source/lighting guides. Neither applied store
mutates the initialization invocation payload.

The factory now retains `createSceneRenderResources` before awaiting
`initializeRenderer(context)`. It passes that exact `renderResources` shell,
alongside its current renderer/PMREM, to the domain constructor. The domain shell
supplies actual `lightingOptions` and calls
`renderResources.initializeLighting(context)` during its initialization after
seating domain state. The factory refuses initialization without that lighting
graph. This preserves the page's staged renderer → domain setup → lighting
construction order. Domain `retire` releases domain/display/radiance resources;
the separate retained render owner releases AO/GI targets, PMREM and renderer
once. Device acquisition/destruction remains with the common factory. This
replaces its interim direct renderer/PMREM allocation and disposal.

## Existing page adapter (integration candidate)

The existing index page selects this adapter only with `scene_worker=1`.
Its default route is unchanged. The selected entry is
`/scene-worker.entry.bundle.mjs`; the entry and actual resource graph remain
owned by the common-runtime assembly. Selecting this URL before the bundle
exists fails startup visibly, without invoking legacy page renderer, volume,
SAM or authoring GPU initialization. Worker success also skips the old page's
GPU/domain/Generate continuation. This is an integration cut; the complete
editor and Workbench have not migrated.

`mountSceneWorkerPage` in `scene-worker-page-bootstrap.mjs` mounts the existing
scene/volume canvas IDs before transferring them, keeps a CPU perspective
camera and existing navigation gestures, and delegates operations to
`createSceneWorkerPage`. Boot payload contains `viewport`, full initial
`flameControls`, exact plain `camera`, `admission: {data, plan}`, `preferences`,
and `location: {href, search, hash}`. No page Scene or GPU host is created.
The worker must actually apply saved input: initialization progress projects
`ui.initialization.sceneApplied: true` when a saved document was supplied, and
`preferencesApplied: true` when preferences were supplied. Generic
`{initialized: true}` cannot establish either. Missing confirmation holds page
frame requests and retains the worker for explicit retirement.

Frames carry `{now, timeOrigin, viewport, camera}`. Camera includes perspective
pose, target, projection parameters and the exact 16-element projection matrix.
At most one frame request is outstanding; page input continues updating while
it waits and the next request samples the current view. Authored commands use
`page.request(name, payload)` without coalescing. Flame changes use actual
`flame.controls` deltas, never whole-settings RAF replay. No new device
activation authority lives on the page: invalidation holds frame requests;
resuming them follows the worker owner's successful recovery command.

Plain UI arrives under `output.ui` (also accepting existing Kit
`output.result.ui`) or progress `{ui}`. Actual supplied
`ui.surfaces.{scene,volume,telemetry}.{active,transparent}` booleans drive page
mounting/CSS; omitted fields remain unreported. Root-owned `ui.bounds` and
`ui.selectionBounds` with finite `min`/`max` arrays support framing. This adapter
navigates around the current camera pivot. Mesh-surface picking, authored-camera
overlays, scene registry editing, saved-scene application, Asset Add and
Workbench command projection still need their real worker consumer integration.
There are no fabricated page Three roots.

The page exposes its adapter at `window.kaminosSceneWorker`. Its `image`
controller uses actual `image.generate`, `image.read`, `image.retrySave`,
operation cancellation for Stop, and targeted `decodeNow`. Models and
persistence stay in the worker. Metadata-only previews remain separate from
pixels. A later status-read failure cannot erase a confirmed saved image entry.
Mounting the controller into existing Generate presentation remains consumer
work; the old GPU-owning setup function is not invoked.

Retirement cancels pending operations, awaits actual settlement, then requests
runtime cleanup. The page terminates its worker only after successful cleanup;
a failure preserves the same worker and mounted controls for retry. Disconnect
removes transport ownership without certifying resource settlement. Node
MessagePort and DOM-recording tests establish adapter behavior; actual
OffscreenCanvas presentation and coupled GPU responsiveness require the
assembled native route.
