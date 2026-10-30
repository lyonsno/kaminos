# Model applications

Klein, SuperMat, UniMate and U2Net use a shared runner for session admission, foreground ownership, cancellation and retirement. Each model keeps its application interface, complete output and lower-level producer available for hosts that need direct control.

The [hand application guide](https://github.com/lyonsno/kaminos/blob/main/models/mobrecon/GETTING_STARTED.md) applies the same shared runner to WiLoR detection and MobRecon reconstruction. Its `createHandMeshApp()` entry point takes browser frames and returns hand presence, vertices and landmarks; the standalone hand demo consumes it. That port currently uses checkout/bundler imports and locally prepared models, with model terms handled by its one-command setup. Its guide explains fresh input after admission and whole-operation waiting when sharing a session.

## Install

Choose the model package for your application:

```sh
# Image generation (the kit is also installed as a dependency):
npm install @kaminos/flux2-klein@^0.1.2
# Material estimation (bundled runtime and CPU worker):
npm install @kaminos/supermat@^0.1.1
# Motion generation with your own shared rendering host:
npm install @kaminos/unimate-webgpu@^0.2.1 @kaminos/webgpu-inference-kit@^0.1.60
# Background removal (bundled runtime):
npm install @kaminos/u2net@^0.1.0
```

These versions include the application interfaces described here. Klein and UniMate require kit 0.1.60 or later in the 0.1 series. Use a bundler such as Vite or esbuild and serve over HTTPS or localhost. Model weights download separately; each guide describes memory requirements, model terms and custom weight locations. SuperMat's [worker build recipe](https://github.com/lyonsno/kaminos/blob/main/models/supermat/GETTING_STARTED.md#install) covers bundling its CPU worker.

## Install the source packages

Build the kit and model packages from the same Kaminos checkout. This recipe exercises the application APIs in this source revision; it does not require a matching npm release. Choose a new artifact directory outside the checkout. From Kaminos:

```sh
mkdir -p /path/to/artifacts
npm pack ./webgpu-inference-kit --pack-destination /path/to/artifacts
node models/flux2-klein/pack-klein.mjs --out /path/to/artifacts/klein
node scripts/pack-supermat-module.mjs --out /path/to/artifacts/supermat
node models/unimate/pack-npm.mjs --out /path/to/artifacts/unimate
npm pack /path/to/artifacts/unimate --pack-destination /path/to/artifacts
```

In your browser application, install the kit tarball and the model tarball you need using the paths printed by those commands:

```sh
npm install /path/to/artifacts/kaminos-webgpu-inference-kit-VERSION.tgz /path/to/artifacts/klein/kaminos-flux2-klein-VERSION.tgz
# Or install the bundled SuperMat package:
npm install /path/to/artifacts/supermat/kaminos-supermat-VERSION.tgz
# Or install UniMate with the kit tarball from the same checkout:
npm install /path/to/artifacts/kaminos-webgpu-inference-kit-VERSION.tgz /path/to/artifacts/kaminos-unimate-webgpu-VERSION.tgz
```

Klein and UniMate import the kit's public `core` entry point; SuperMat includes its runtime in its bundle. Use a bundler such as Vite or esbuild. SuperMat's CPU worker must accompany the application bundle; its [build recipe](https://github.com/lyonsno/kaminos/blob/main/models/supermat/GETTING_STARTED.md#install) explains Vite and esbuild handling. Serve over HTTPS or localhost in a WebGPU-capable browser. The first load downloads each model's hosted weights; the model guides describe custom weight locations and memory requirements.

## Choose the model operation

| Application | Input and output | Model-specific controls |
| --- | --- | --- |
| `createKleinApp()` → `generate(...)` | Text prompt → `{ width, height, rgba, ... }` | `pipelineOptions` at creation; generation size, steps, seed, previews and other pipeline options per call; direct `app.pipeline` |
| `createSuperMatApp()` → `infer(...)` | RGBA `{ width, height, data }` → material `maps`, floating-point `planes`, identity and timing | `adapterOptions` at creation; image, size and adapter run options per call; direct `app.adapter` |

Both retain loaded state for sequential calls. An overlapping call on the same app rejects. Each app has `load(onProgress)`, `pause()`, `resume()`, `stop(reason)`, `snapshot()` and `destroy()`. A run accepts `signal` for cancellation and `scheduling` for scheduler policy. Creation also accepts default `scheduling`; per-run values override those defaults. The app supplies runtime, invocation, control, signal and foreground bindings itself.

Pause applies to an admitted cooperative inference. It waits behind an active CPU foreground window, then parks model duties while frames remain serviceable. It returns `null` during loading or while queued. Loading remains model-owned: Klein downloads/compiles before admitted GPU warmup; SuperMat retains its weight resource route and uses a CPU worker. Stopping SuperMat inference while it waits for a shared load cancels that inference request, while the load continues. `destroy()` stops active work and waits for its resources to retire.

`cooperative: false` explicitly uses the model's direct execution path, retaining outer session admission and cleanup. It has no GPU pause or mid-model cancellation contract. For a host that already owns an admitted invocation, use the direct pipeline/adapter rather than enqueueing an application run inside that same session job.

## Animate a skeleton with UniMate

UniMate retains its existing host-injected consumer interface:

```js
import { createUniMateConsumer } from '@kaminos/unimate-webgpu';
const motion = createUniMateConsumer({ device, session,
  beginRun: (id, options) => foreground.beginRun(id, options),
});
try {
  const animation = await motion.run({
    asset: { skeleton: 'go2' }, prompt: 'An object trots forward.', seed: 7,
  });
  // animation.glb is the complete animated asset; animation.motion holds joint motion.
} finally {
  await motion.destroy();
}
```

The host supplies its device, kit session and foreground service, and submits frames through that service. The first `run()` loads UniMate; subsequent calls reuse it. `read()` exposes stage and solver progress, `togglePause()` pauses/resumes an admitted cooperative run, and `stop()` cancels pending work. `destroy()` settles work and frees model resources while leaving the borrowed host alive. The generator's text encoding and solver both run inside admission; queued cancellation does not take foreground ownership. Each generator receives a distinct runtime route by default.

Inputs may be a stock skeleton, prepared conditioning, or a rigged GLB. Solver tolerances, guidance and partial-motion callbacks remain available through the [UniMate API](https://github.com/lyonsno/kaminos/blob/main/models/unimate/package/README.md). Its lower-level denoiser, text encoder, solver and decoding functions are still exported. UniMate's interface differs from the `load/pause/resume` wrappers above; the shared runner supplies their common lifetime.

## Keep your renderer drawing

Obtain the application before loading, configure your renderer with its device, and submit each frame through its foreground service. Here `encodeFrame(device)` is your renderer's function returning a finished `GPUCommandBuffer`:

```js
const app = await createKleinApp({ load: false });
let drawing = true;
function frame() {
  if (!drawing) return;
  app.foreground.request({
    requestId: crypto.randomUUID(),
    run(opportunity) {
      opportunity.submit([encodeFrame(app.device)]);
    },
  }).completion.then(receipt => {
    if (receipt.status === 'completed' && drawing) requestAnimationFrame(frame);
  });
}
requestAnimationFrame(frame);
await app.load();
const image = await app.generate({ prompt: 'a blue tank engine', seed: 7 });
// Keep rendering and reuse app.generate(...) for the application's lifetime.
// On teardown:
drawing = false;
await app.destroy();
```

The [Klein outside example](https://github.com/lyonsno/kaminos/blob/main/models/flux2-klein/examples/external-app/app.js) and [SuperMat outside example](https://github.com/lyonsno/kaminos/blob/main/models/supermat/examples/external-app/app.js) include concrete GPU rendering and controls. The foreground service uses the model's cooperative boundaries during inference and also services idle frames. Its receipts describe submissions and request completion; they are not display-presentation timestamps.

To borrow your renderer's device, pass `{ device, load: false }`. Klein requires `shader-f16` on that device. To share a coordinated host, pass `{ session, foreground, load: false }` using the same device and queue. The host must finish its current foreground run before releasing its admission. An app destroys only the device/session/foreground objects it created; borrowed resources survive. `snapshot()` exposes that ownership, load state, active phase, control state and fatal error.

## Shared runner for port authors

`createWebGpuApplicationRunner` from `@kaminos/webgpu-inference-kit/core` is the run lifetime used by Klein, SuperMat and the UniMate generator. The model wrapper creates its resources and provides:

- `session`, `foreground`, `routeId`: the shared host and this app's route identity.
- `label`, `phase`, `runtimeLabel`: error text, active phase, and runtime identity.
- `prepare(signal)`: model-specific loading before inference admission; it must not enqueue another inference inside that admission.
- `execute(options, schedule)`: model work with the supplied cooperative invocation, or `schedule === null` for direct execution. Its complete return value passes through unchanged.
- `scheduling`: default policy options.
- `assertOpen()`, `getError()`, `onFatal(error)`: the owning application's open-state and fatal-error handling.
- Optional `settle()`: additional model-specific settlement after control closes, still inside admission. SuperMat retains its explicit queue-settlement step here.

The runner returns `run`, `pause`, `resume`, `stop`, `snapshot` and a `pending` promise getter for destruction to await. It acquires foreground ownership only after its queued job is admitted, serializes CPU foreground windows with pause, closes control, unregisters the transient model route, and finishes foreground work before releasing admission. Cancellation while queued never takes another job's foreground ownership. Cleanup errors reach `onFatal` and reject the run.

Device selection, loading/warmup, resident resources, model options, input/output processing and final app destruction stay in the model wrappers. Those choices remain model-specific. See [Klein's wrapper](https://github.com/lyonsno/kaminos/blob/main/models/flux2-klein/klein-app.js), [SuperMat's wrapper](https://github.com/lyonsno/kaminos/blob/main/models/supermat/supermat-app.js) and [UniMate's generator](https://github.com/lyonsno/kaminos/blob/main/models/unimate/unimate-generator.js) for the complete integrations.

## U2Net background removal

`createU2NetApp` turns opaque RGB/RGBA pixels into the existing rembg-style cutout, with the shared application's queued admission, pause/resume, stop/retry and resource lifetime. It accepts the host's session and foreground service, exposes its loaded low-level runner, and preserves the producer's segment size and output provenance. See [the U2Net application](https://github.com/lyonsno/kaminos/blob/main/models/u2net/README.md) for installation and the image input contract.

```sh
npm install @kaminos/u2net@^0.1.0
```

U2Net keeps its existing 320×320 network and rembg preparation semantics. The application offers foreground service at its real GPU segments and CPU preparation windows; it does not change the mask model or guarantee a particular display cadence.
