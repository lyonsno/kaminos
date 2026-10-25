# @kaminos/flux2-klein

FLUX.2 [klein] 4B text-to-image in the browser on WebGPU. The Qwen3-4B text encoder, the 4-step transformer and the VAE decoder run as compute shaders on a device your application provides, using the [Kaminos WebGPU inference kit](https://github.com/lyonsno/kaminos/tree/main/webgpu-inference-kit).

## Install

```sh
npm install @kaminos/flux2-klein@^0.1.2
```

The application interface uses inference kit 0.1.60 or later in the 0.1 series, installed as a dependency.

## Use

```js
import { createKleinApp } from '@kaminos/flux2-klein';

const klein = await createKleinApp(); // creates a device and loads hosted Mint weights
const image = await klein.generate({ prompt: 'a blue tank engine on a branch line', seed: 7 });
// image.rgba is a Uint8ClampedArray of width * height * 4 bytes
await klein.destroy(); // releases the model and its owned device
```

Generation uses cooperative command duties. Pass `{ device }` or `{ session, foreground }` to borrow an existing host's resources; destruction leaves them open. A shared session uses the host's foreground service so its current model supplies safe rendering boundaries while Klein waits for admission. Each model must finish its foreground run before releasing session admission. A borrowed device must have `shader-f16` enabled. `pipelineOptions` forwards model constructor settings, including weights, level, residency and kernels. `generate()` preserves the pipeline's model options, callbacks and output.

For a live renderer, create with `load: false`, attach the renderer through `app.foreground.request({ requestId, run(opportunity) { /* encode your frame, then opportunity.submit([commands]) */ } })`, then call `app.load(onProgress)`. This persistent service accepts frames before, during and after generation. Loading downloads and compiles before reserving model admission; its GPU warmup queues behind the host and retains foreground ownership until submitted work settles. An existing `foreground` service may be borrowed if it uses the same device and queue; it can have only one active model run. The installed external application example exercises this composition.

`pause()` waits for admitted duties to settle and permits foreground frames while parked; `resume()` continues. `stop(reason)` or a generation's `signal` stops at cooperative model boundaries. Loading has no pause/stop contract; `pause()` returns `null` while queued or outside a controlled generation. A pause during a lean-residency weight reload waits for that foreground window before parking. `destroy()` closes admission, stops generation and waits for loading and submitted work before release. Concurrent `generate()` calls reject; sequential calls reuse weights and the prompt cache. A failed explicit `load()` releases its partial pipeline and permits a fresh retry. GPU loss and cleanup failures reject and prevent reuse.

The app exposes `device`, `session`, `foreground`, `pipeline`, and `snapshot()` (ownership, load state, phase, control and fatal error). `scheduling` at creation or per generation forwards the command scheduler's policy options, such as `targetDutyMs` and `maxInFlight`; runtime, invocation, signal, control and foreground bindings belong to the app. `cooperative: false` explicitly selects unscheduled generation, without GPU pause or interruption. Default device creation requests the adapter's buffer/workgroup limits and `shader-f16`; `deviceDescriptor` can supply the host's requested descriptor.

## Direct pipeline control

`KleinPipeline` remains available for hosts that already own their invocation and scheduling. Use it directly instead of nesting an app generation inside an admitted job on the same session.

```js
import { KleinPipeline } from '@kaminos/flux2-klein';

const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
const device = await adapter.requestDevice({
  requiredFeatures: ['shader-f16'],
  requiredLimits: {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  },
});

const klein = new KleinPipeline(device);               // hosted weights, Mint level
await klein.load((part, file, { loadedBytes, totalBytes }) => console.log(part, loadedBytes / totalBytes));
const image = await klein.generate({ prompt: 'a blue tank engine on a branch line', seed: 7, width: 512, height: 512 });
// image.rgba is a Uint8ClampedArray of width * height * 4 bytes
await klein.destroy();                                  // frees Klein's buffers; the device stays yours
```

## Without a bundler

Browsers resolve the package names through an import map. For a page served next to its `node_modules`:

```html
<script type="importmap">
{ "imports": {
  "@kaminos/flux2-klein": "./node_modules/@kaminos/flux2-klein/index.js",
  "@kaminos/webgpu-inference-kit/core": "./node_modules/@kaminos/webgpu-inference-kit/src/core.js"
} }
</script>
<script type="module" src="./app.js"></script>
```

A bundler such as Vite or esbuild resolves them from `node_modules` without a map.

## Progress, previews and failures

`load(onProgress)` reports `(part, file, { loadedBytes, totalBytes })` while weights download or come out of the cache. `generate()` takes `onPhase(phase)` (`text`, `denoise`, `decode`, and `weights` when low-memory mode swaps models), `onStep(step, steps)` and `onPreview({ width, height, rgba, step, steps })`, a rough image at an eighth of the output size after each step. `steps` is 4 by default; 3, 2 and 1 are faster and progressively rougher. A load from a base without the weights rejects with the missing file's URL; a size that is not a multiple of 16, or one too large for the device's buffer limits, rejects without disturbing the loaded pipeline.

## Weights

By default the pipeline loads the hosted weights (`KLEIN_HOSTED_WEIGHTS`, about 3.2 GB, kept in the browser's Cache API after the first visit). Pass `weightsBase` to load from a mirror or a local server laid out the same way, and `level` to choose the transformer: `mint` (int4), `weathered` (3-bit) or `off-the-rails` (2-bit). `kleinWeightUrls({ base, level })` returns the three weight roots; explicit `textEncoderUrl`, `transformerUrl` and `vaeUrl` options override them.

## Releasing

`destroy()` waits for submitted work, then releases every buffer the pipeline owns: both models' weights and working memory, the decoder, the live-preview resources and the prompt cache. It does not destroy the device. A destroyed pipeline refuses further calls; create a new one to load again.

## License

The code is MIT (see `LICENSE`); `THIRD_PARTY_NOTICES.txt` credits the projects whose behaviour it reimplements. The weights it downloads are FLUX.2 [klein] 4B by Black Forest Labs and its Qwen3-4B text encoder by the Qwen team, both released under the Apache License 2.0, as are the converted weights.
