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

`createSamImageExample({ canvas, onState })` owns its explicitly acquired device and kit session. Source rendering uses that exact device/queue; SAM borrows the same session. `createCooperativeYield()` drains previously submitted work and services a source draw at SAM's existing phase boundaries. A browser animation callback also requests source draws between boundaries. No new shared runtime API, generic scheduler, cancellation signal, or model-execution timeout is added.

Image decode/authentication and inference are single-flight. Source/prompt controls cannot change during an invocation. A new invocation clears previous masks before starting. Output is admitted only when invocation, source digest/artifact/dimensions, prompt text/digest, route fields, execution authority, dimensions, and instance logits agree with the local contract. Status reports busy phases and errors; it does not imply a model is loaded before the first run.

Unload Model is disabled during active work. It releases SAM's model/route resources and clears its output while retaining the source animation, kit session, and device. Unload before changing the manifest. `dispose()` refuses further work, waits for the active operation without cancelling inference, closes SAM, stops source rendering, drains/closes the session, revokes the owned source object URL, and destroys the owned device. `pagehide` requests that cleanup, but browser termination cannot guarantee asynchronous drain completion. Device loss or foreground failure is a terminal example error; create a new example/page rather than pretending that the lost device recovered.

`snapshot()` is compact UI state. `provenance()` contains the last invocation's runtime evidence; a last request or cached image-feature receipt is not a current successful output. The example-local `services` overrides exist for deterministic tests, not as another kit integration API.

## Verification Boundary

This example uses the source checkout or the caller's installed kit. It does not establish that a particular npm release contains the example. Model execution, mask accuracy, and renderer coexistence must be verified on the effective device and model package. The foreground counters are queue submissions, not presented frames; they do not certify frame pacing.

Run the focused local contracts with `npm run test:sam-image-example` from the kit directory. Those deterministic fixtures cover source-sized exports, output provenance, single-flight operation, shared-session ownership, and cleanup. They are not a native model or browser-presentation witness.

The October 4 native source-checkout witness exercised cold wheel, cached wheel, windows, an empty nonsense prompt, and grocery bags on Apple Metal with Chrome for Testing. All ten mask/cutout PNG exports matched the source-sized selection pixels; desktop and 390-pixel layouts were inspected. The attention change at `c94502ac` was bit-exact against the earlier kernel across all selected native logits and masks in those cases. The parallel pixel-statistics change at `ef447cea` retained every selected binary mask and score but changed logits by up to 0.1374; its native MLX pixel-boundary comparison remains separate numerical work, not an accuracy claim from visual agreement.

Observed cached prompts with that statistics change took approximately 8-9 seconds in one run, versus 13-14 seconds in the preceding run. Cold model preparation and new-image execution varied substantially, and browser animation callbacks still had gaps of approximately 1.3-1.5 seconds during cached prompts. These are route-specific observations, not a general speedup or continuous-presentation guarantee. Complete raw output, provenance, callback timestamps, source revisions, and screenshots are retained by the native witness rather than embedded in UI state. Explicit provenance export may be expensive; ordinary state updates do not enumerate the model-resource inventory.

For a packaged consumer, import `createSamImageExample` from `@kaminos/webgpu-inference-kit/examples/sam-image` and pass your source canvas and state callback. Serve the HTML and its relative module files together, or replace the checkout import-map entries with your installed package's browser URLs.
