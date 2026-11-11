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

## Evidence

`tests/scene-worker-handoff.mjs` exercises native MessagePort cloning/transfers,
ordering, epochs, cancellation, controls, frame admission and retirement. Its
real Node Worker fixture executes the production `scene-frame-composition.mjs`
with a recording draw provider. This establishes the executable boundary and
thread placement, not WebGPU rendering, model execution, browser compatibility
or completion of the coupled-scene migration.
