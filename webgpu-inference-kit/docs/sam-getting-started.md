# SAM 3 In Your Application

Find instances with an image and a text prompt, then use their masks at the original image resolution. Inference runs locally in a WebGPU browser. This integration has no Kaminos application, Python, MLX, reference-image or diagnostic-server dependency.

## Install And Prepare The Model

Use Node.js 20 or newer for setup, and serve your application over HTTPS or localhost in a WebGPU-enabled browser.

```sh
npm install @kaminos/webgpu-inference-kit
npx kaminos-sam-model --out public/models/sam3
```

The preparation command downloads the pinned `mlx-community/sam3-bf16` checkpoint (about 1.72 GB), converts its image-detector weights to the accepted float32 browser representation (about 3.4 GB of files), and installs the tokenizer, model manifests and licenses. It uses Node.js only, on macOS, Linux or Windows. It does not run the model. Every converted weight must match its pinned SHA-256 before a manifest is written; an interrupted run can be repeated and valid outputs are reused. Allow disk space for both the checkpoint and converted package.

For Vite and similar applications, `public/models/sam3` is served as `/models/sam3`. On another server, mount the output directory at an equivalent same-origin static URL. Keep its filenames intact. The model is not bundled into the application's JavaScript or the npm tarball.

An existing checkpoint can avoid a second download:

```sh
npx kaminos-sam-model --out public/models/sam3 --checkpoint /path/to/model.safetensors
```

Only the exact pinned checkpoint is accepted. `--cache /path/to/cache` chooses a reusable download directory; by default it is `$XDG_CACHE_HOME/kaminos/sam3` or `~/.cache/kaminos/sam3`, outside your public web assets. The generated `prepare-report.json` names the package, checkpoint digest and verified artifacts, or the phase and error of a failed preparation. The checkpoint cache is build-time data and is not part of the deployed model directory.

The JavaScript implementation is MIT licensed. **SAM model weights have Meta's SAM License, not MIT.** The prepared directory includes `SAM-LICENSE.txt`; retain it when deploying or redistributing model files and review its terms. The [checkpoint's model card](https://huggingface.co/mlx-community/sam3-bf16) identifies the conversion and its upstream model; [Meta's license](https://github.com/facebookresearch/sam3/blob/main/LICENSE) governs SAM Materials.

## Segment An Image

```js
import { createSam3Segmenter } from '@kaminos/webgpu-inference-kit/sam';

const sam = createSam3Segmenter({
  manifestUrl: '/models/sam3/tensor-manifest.json',
  onProgress({ message }) { console.log(message); },
});

// imageFile is a File from an input, drag/drop, or a Blob fetched by your app.
const result = await sam.segment(imageFile, 'windows');
console.log(result.instances); // index, score, box, logits for each instance

const combined = result.mask(); // Uint8Array, one 0/1 value per source pixel
const { width, height } = result.sourceSize;
const first = result.instances[0];
if (first) {
  const instanceMask = result.mask([first.index]);
  console.log(instanceMask, width, height);
}

// Change the prompt without reloading the model. Image features are cached.
const wheels = await sam.segment(imageFile, 'wheel');
await sam.close();
```

No canvas is required. Instances are not renumbered: use their returned `index` values when selecting masks. `mask()` unions all retained instances; `mask([])` returns an all-zero mask. A successful no-match result has an empty `instances` array. Source masks interpolate logits before thresholding, rather than enlarging a coarse binary mask. Returned boxes are `[x0, y0, x1, y1]` pixel coordinates in the model image resolution, given by `result.sourceImage.resolution`, not normalized coordinates or original-image pixels. To map a box to the source image, scale x coordinates by `result.sourceSize.width / result.sourceImage.resolution[0]` and y coordinates by the corresponding height ratio. Logits use the detector's native mask grid.

The same segmenter retains model resources and cached image features between calls. Call it serially; overlapping calls fail explicitly. `close()` waits for an active invocation and releases the segmenter's resources. Results already returned remain ordinary CPU data. For a complete upload, overlay, transparent cutout and export UI, see the [SAM image example](sam-image-example.md).

## Compose With Your Existing GPU Application

Pass the application's existing inference session and cooperative yield callback:

```js
const sam = createSam3Segmenter({
  manifestUrl: '/models/sam3/tensor-manifest.json',
  inferenceSession: applicationSession,
  yield: serviceForeground,
});
```

The segmenter borrows that session and device. Closing it releases SAM resources without closing the application's session or destroying its GPU device. The host owns rendering and foreground scheduling. With no session supplied, the underlying runtime acquires and owns its device lazily on the first invocation. See [cooperative integration](integration-reference.md) for the shared-kit flow.

## Runtime Expectations

The detector runs at native 1008-pixel model resolution, not a reduced diagnostic geometry. Its float32 weights occupy about 3.4 GB on disk, with additional CPU copies, GPU activations and browser overhead at runtime. Use a machine and adapter with enough available memory; WebGPU availability alone is not a memory guarantee. The first image includes model loading and image encoding. Another prompt on the same image reuses its encoded features. Hardware, browser, available memory and competing GPU work affect latency.

The browser API accepts a non-empty Blob or File plus a text prompt. Source bytes are hashed and the result binds the exact source, prompt and invocation. The model must be served from the application's origin. Network, unsupported-device, memory, model-integrity and inference failures reject the promise; they do not return a default mask. This entrypoint is the image-plus-text detector. The lower-level SAM 3.1 tracking modules are separate from this interface.
