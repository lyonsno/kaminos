# SAM Image And Text Example

`examples/sam-image.html` is a source-checkout example for an uploaded image and a text prompt, not flame segmentation. It uses the public `@kaminos/webgpu-inference-kit/core` and `@kaminos/webgpu-inference-kit/sam` entrypoints. The HTML import map resolves those entrypoints to this checkout; it does not silently fetch a different npm build or use a smoke iframe.

## Serve

Prepare an existing **full image-FPN-neck SAM3 serving package** using the offline recipe in [sam-semantic-demo.md](sam-semantic-demo.md). Model access and preparation remain the caller's responsibility. A downstream-only diagnostic packet is not an image-and-text model. This example does not download a model from a third-party host or substitute a demo mask.

From the Kaminos repository root, mount that package using the existing server:

```sh
KAMINOS_SAM3_PACKET_ROOT=/absolute/path/sam-model-1008 python3 serve.py 18696
```

Open `http://127.0.0.1:18696/webgpu-inference-kit/examples/sam-image.html`. Choose another free port when necessary. The default manifest is `/sam3-packet/tensor-manifest.json`; the Model Manifest field or `?manifest=/your-mount/tensor-manifest.json` selects another same-origin serving package. The alternative kit workbench server in `sam-semantic-demo.md` serves `/examples/sam-image.html?manifest=/workbench-packet/tensor-manifest.json` from its kit-root mount.

Upload an image, enter a text prompt, and run SAM. The source viewport gently moves the actual uploaded image. The static result viewport offers Overlay, Mask, and Cutout views. All retained instances are selected initially; the Instances selector isolates one without running inference again. Save Mask PNG exports opaque black/white pixels. Save Cutout PNG retains source RGB and existing source alpha inside the selection and sets alpha to zero outside it. An empty model selection produces a black mask and fully transparent cutout, with no previous overlay retained.

Exports use decoded source dimensions. The public `createSam3SourceMask()` interpolates each instance's native logits with `align_corners=False`, thresholds at zero, then unions the selected instances. The example never enlarges a thresholded low-resolution binary mask. Save Provenance JSON preserves encoded source SHA-256, source dimensions/artifact identity, requested prompt and invocation, returned prompt SHA-256, native output dimensions, selected instance scores/boxes/indices, requested/effective route, backend, runtime evidence, and foreground counters. PNGs and JSON are separate downloads; the PNG alone does not contain the provenance record. Match their invocation IDs and keep the original uploaded bytes for replay.

## Ownership And Lifetime

`createSamImageExample({ canvas, onState })` owns its explicitly acquired device and kit session. Source rendering uses that exact device/queue; SAM borrows the same session. `createCooperativeYield()` drains previously submitted work and gives the browser an event-loop turn at SAM's phase boundaries. Browser animation callbacks own source draws; a model yield does not submit an additional frame or update the UI between those callbacks. This avoids making thousands of model phases generate thousands of redundant renders. No new shared runtime API, generic scheduler, cancellation signal, or model-execution timeout is added.

Image decode/authentication and inference are single-flight. Source/prompt controls cannot change during an invocation. A new invocation clears previous masks before starting. Output is admitted only when invocation, source digest/artifact/dimensions, prompt text/digest, route fields, execution authority, dimensions, and instance logits agree with the local contract. Status reports busy phases and errors; it does not imply a model is loaded before the first run.

Unload Model is disabled during active work. It releases SAM's model/route resources and clears its output while retaining the source animation, kit session, and device. Unload before changing the manifest. `dispose()` refuses further work, waits for the active operation without cancelling inference, closes SAM, stops source rendering, drains/closes the session, revokes the owned source object URL, and destroys the owned device. `pagehide` requests that cleanup, but browser termination cannot guarantee asynchronous drain completion. Device loss or foreground failure is a terminal example error; create a new example/page rather than pretending that the lost device recovered.

`snapshot()` is compact UI state. `provenance()` contains the last invocation's runtime evidence; a last request or cached image-feature receipt is not a current successful output. The example-local `services` overrides exist for deterministic tests, not as another kit integration API.

## Verification Boundary

This example uses the source checkout or the caller's installed kit. It does not establish that a particular npm release contains the example. Model execution, mask accuracy, and renderer coexistence must be verified on the effective device and model package. The foreground counters are queue submissions, not presented frames; they do not certify frame pacing.

Run the focused local contracts with `npm run test:sam-image-example` from the kit directory. Those deterministic fixtures cover source-sized exports, output provenance, single-flight operation, shared-session ownership, and cleanup. They are not a native model or browser-presentation witness.

The October 4 native source-checkout witnesses exercised cold wheel, cached wheel, windows, an empty nonsense prompt, and grocery bags on Apple Metal with Chrome for Testing. All ten mask/cutout PNG exports matched the source-sized selection pixels; desktop and 390-pixel layouts were inspected. The selected corpus is evidence for those image/prompt pairs, not a general segmentation benchmark.

Numerical verification distinguishes arithmetic changes from scheduling changes:

- The parallel pixel-statistics kernel at `ef447cea` retained the earlier selected binary masks and scores but changed logits. A separate native replay against authenticated MLX pixel-boundary tensors compared all 21,233,664 output values: RMSE improved from approximately `4.40e-4` to `7.66e-7`, with maximum absolute error `6.06e-5` for the new kernel. This is a pixel-decoder boundary comparison, not an end-to-end MLX accuracy claim.
- The static attention specialization at `2130c41e` retained selected masks and indices, with maximum selected-logit difference approximately `0.00108` against its preceding source baseline. It is not bit-exact to that baseline.
- Complete-output scheduling ranges for DETR attention/pixel convolution (`22393727`), the ViT backbone (`4e3da3f7`), and image-neck convolution (`581a72b2`) were each bit-exact to their preceding accepted source implementation across all 1,327,104 selected logits, scores, boxes, indices, and binary masks in the five-case witness. Empty controls stayed empty. This establishes preservation of these recorded outputs, not unseen intermediate tensors.

After program-local pipeline reuse and browser-frame-owned rendering (`ba5a4210`), the same native witness measured:

| Invocation | Whole invocation | Model execution |
| --- | ---: | ---: |
| Cold image + wheel prompt | 30.10 s | 17.01 s |
| Cached image + wheel prompt | 2.31 s | 2.11 s |
| Cached image + windows prompt | 2.33 s | 2.12 s |
| Cached image + empty-control prompt | 2.29 s | 2.13 s |
| New image + grocery-bags prompt | 17.24 s | 17.06 s |

Cold model preparation accounted for 12.87 seconds. These are observed times on this device and package, not portable performance guarantees. Earlier iterations of this example took 13-14 seconds for cached prompts. The reuse and rendering changes each preserved the complete recorded instance outputs exactly against the preceding source implementation, including all 1,327,104 instance logits and 414,720 top-selected logits.

Cooperation is still under measurement. The browser-frame-owned run recorded maximum animation-callback gaps of 33-67 ms for cached prompts, 50 ms for the new image, and 233 ms during the cold invocation. Earlier range-scheduled runs varied substantially, including 133-167 ms gaps on the cached-image path. Callback timestamps are not presented-frame evidence, and smaller GPU phases do not by themselves establish smooth rendering. Complete raw output, provenance, callback timestamps, source revisions, and screenshots are retained by the native witness rather than embedded in UI state. Explicit provenance export may be expensive; ordinary state updates do not enumerate the model-resource inventory.

For a packaged consumer, import `createSamImageExample` from `@kaminos/webgpu-inference-kit/examples/sam-image` and pass your source canvas and state callback. Serve the HTML and its relative module files together, or replace the checkout import-map entries with your installed package's browser URLs.
