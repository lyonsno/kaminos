# @kaminos/flux2-klein

FLUX.2 [klein] 4B text-to-image in the browser on WebGPU. The Qwen3-4B text encoder, the 4-step transformer and the VAE decoder run as compute shaders on a device your application provides, using the [Kaminos WebGPU inference kit](https://github.com/lyonsno/kaminos/tree/main/webgpu-inference-kit).

## Use

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

The code is MIT (see `LICENSE`). The weights it downloads are FLUX.2 [klein] 4B by Black Forest Labs and its Qwen3-4B text encoder by the Qwen team, both released under the Apache License 2.0, as are the converted weights.
