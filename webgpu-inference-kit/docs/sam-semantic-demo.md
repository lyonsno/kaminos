# SAM Semantic Masks

The demo accepts a sample image and text prompt, then displays the source, mask overlay, and raw mask. All retained instances are shown by default; the mask selector isolates an individual instance without rerunning inference. It executes the detector backbone, neck, prompt encoder, DETR encoder/decoder, scoring, selection, and mask tail in browser WebGPU. No MLX process participates in interactive requests.

## Prepare And Serve

Prepare a model package once using `tools/sam-detr-stack-mlx-packet.py` from an environment with the compatible MLX-VLM SAM implementation, MLX, NumPy, and Pillow. The default model is `mlx-community/sam3-bf16`. Model access and download are the caller's responsibility.

```sh
python tools/sam-detr-stack-mlx-packet.py \
  --out-dir /absolute/path/sam-model-224 \
  --image /absolute/path/sam3/assets/images/truck.jpg \
  --prompt truck --resolution 224 --image-fpn-neck-ingress \
  --score-threshold 0.1

node tools/sam-semantic-mask-workbench-server.mjs \
  --packet-root /absolute/path/sam-model-224 \
  --sample-root /absolute/path/sam3/assets/images \
  --port 18596 --receipt /absolute/path/sam-route.json
```

Run these commands from `webgpu-inference-kit`. The sample root comes from Meta's SAM reference repository and must contain `truck.jpg`, `groceries.jpg`, and `test_image.jpg`. The exporter includes reference tensors for optional verification; the serving page does not acquire those tensors. CPU-only export is possible by setting MLX's default device to `mx.cpu` before invoking the exporter.

For an experimental resolution not covered by the pinned calibration, add `--execution-only` to the exporter command and choose `--resolution` explicitly. That path preserves raw, identity-bound `referenceObservations` but publishes no attached verification or tolerance budget. A reference-parity invocation rejects such a packet before GPU acquisition. Export success alone establishes neither browser execution nor numerical accuracy at the new resolution.

Open `http://127.0.0.1:18596/`. The server prints and optionally writes its effective route, checkout commit, mounted roots, and package/sample hashes. It does not automatically start inference. Use a WebGPU-capable Chromium browser, select a sample, enter a prompt, and run. A second prompt on the same image reuses its image features; changing the image recomputes the image path. An empty selection is a valid model result, not a substituted mask.

## Shared Runtime Composition

### Kaminos Image Authoring

The source checkout also embeds SAM directly in the main Kaminos workbench. It does not run an inference iframe. From the repository root, mount an existing full image-FPN-neck model package:

```sh
KAMINOS_SAM3_PACKET_ROOT=/absolute/path/sam-model-1008 python3 serve.py 8095
```

Open `http://127.0.0.1:8095/?sam=1`. The Masks tab accepts PNG, JPEG, and WebP files through Open Image, image drop, or clipboard paste. Use Selected Image takes an image already selected in Assets or Pipeline; an image graph node also exposes Create Masks. Source bytes and exported images are stored in the existing image inbox, under the configured `KAMINOS_ASSETS_DIR` (or an explicit `KAMINOS_IMAGE_INBOX_DIR`).

Run a text prompt, then select all retained instances or one instance. Source, Overlay, and Mask views share the same zoom/pan viewport. Save Mask produces an opaque black/white PNG; Save Cutout preserves source RGB and alpha inside the selection and clears alpha outside it. Add Cutout to Scene imports the saved image as a registered image plane, with source/prompt/invocation provenance. Exports have the decoded source image dimensions. They bilinearly interpolate mask logits with `align_corners=False` before thresholding; they do not enlarge a thresholded low-resolution mask. The native logits and binary instance masks remain available unchanged from the runtime.

Use a native-1008 package for the detailed image workflow (288-by-288 native mask logits); the 224 preparation example above is a smaller diagnostic route, not the native visual baseline. To prepare native 1008, replace both `sam-model-224` paths with `sam-model-1008`, set `--resolution 1008`, and add `--execution-only`. Model preparation remains an offline step. Unload Model releases SAM's route and model leases without destroying Kaminos's shared rendering device.

This host integration and the APIs below are source-checkout additions, not a claim about the currently published npm version. The native isolated-workbench evidence below remains the accepted regression baseline; actual Kaminos input cadence and image-to-scene verification are separate consumer gates.

### Caller-Owned Image Runtime

Applications can import the model-neutral session from `./core` and the SAM runtime from `./sam`. The legacy root entrypoint keeps its compatible bindings. A host owns one runtime instance, supplies an authenticated same-origin image URL and decoded dimensions, and closes that runtime when it no longer needs the model:

```js
import { createSam3BrowserImageRuntime, createSam3SourceMask }
  from '@kaminos/webgpu-inference-kit/sam';

const sam = createSam3BrowserImageRuntime({
  baseUrl: location.href,
  inferenceSession: applicationSession,
  yield: serviceForeground,
});

const output = await sam.run('/sam3-packet/tensor-manifest.json', {
  invocationId: crypto.randomUUID(),
  promptText: 'windows',
  verificationMode: 'execution-only',
  sourceImage: {
    url: imageUrl,
    sha256: imageDigest,
    artifactId: imageArtifactId,
    encodedResolution: [imageWidth, imageHeight],
  },
});
const sourceMask = createSam3SourceMask(
  output, output.instances.map(instance => instance.index), imageWidth, imageHeight,
);
await sam.close();
```

`imageDigest` is `sha256:` followed by the encoded image bytes' digest. The runtime fetches and verifies those bytes and the decoded dimensions; it does not trust the caller's label alone. `output.instances` includes each retained instance's score, box, native binary mask, and native logits. The returned source mask is a `Uint8Array` of zero/one values. Use the same runtime for subsequent prompts to reuse the image features. `close()` waits for its active invocation and releases only SAM-owned resources; the application retains session/device ownership.

- Static artifacts load sequentially through `route.loadModelResourcePackageFromSources()`. Each has an independent digest and semantic manifest. SAM does not assemble a second whole-model bundle.
- The model keeps authenticated host views for tensor binding and persistent GPU weights. Sequential source acquisition does not imply that the complete model fits in the largest artifact's memory footprint.
- Serving invocations enter a registered session route's queue. Terminal completion, current execution receipts, and cached image provenance remain distinct.
- Phase outputs stay typed arrays during serving. Reference mode retains JSON-compatible readbacks. Intermediate host readbacks still exist at phase boundaries; this is not a fully GPU-resident activation graph.
- Per-layer ViT finite checkpoints and full diagnostic DOM rendering are off during ordinary serving. Reference mode and explicit `diagnosticReadback=1` retain diagnostics.
- The demo requests supported device limits through the kit device helper instead of silently accepting the WebGPU default storage-binding limit.

An embedding application may set `window.sam3InferenceSession` before importing `smokes/sam-mask-island-parity.js` in the serving realm. SAM then uses that session's exact device, owns only its registered route and model leases, and does not close the application's session or device. Only one SAM resident owner may occupy that session's SAM owner-route id.

An optional `window.sam3CooperativeYield` callback is forwarded to the shared phase runtimes. Use the kit's `createCooperativeYield()` or a compatible application callback to service foreground work at the model's existing boundaries. A callback cannot preempt an already submitted dispatch. Queue composition and safe borrowed ownership are implemented; acceptable frame latency while rendering alongside full-model inference still requires a live measurement.

The workbench installs that callback for an input-driven source viewport on SAM's exact device and queue. Wheel input zooms, dragging pans, and double-click resets the source view. Pending source draws participate through the kit's cooperative yield; idle boundaries do not manufacture rendering work. Mask overlays remain in original-image coordinates. Foreground failure is reported immediately in page status. This is cooperative boundary integration, not an adaptive frame-budget or preemptive scheduler.

## Evidence Boundary

The current merged native-1008 workbench route has been exercised cold, warm, and with an expected-empty negative control. Cold and warm retained the same four instances and were bit-exact against the accepted source-equivalent baseline across scores, boxes, foreground counts, every retained mask, the selected mask, and selected logits. The negative control retained no candidate and produced exact-zero mask and logit output. The inspected screenshots showed both requested wheels on the positive route and no stale overlay on the negative route.

The same witness exercised input-driven source-viewport submissions through SAM's exact device and queue while inference advanced. It establishes same-device cooperative submission at the existing model boundaries, not presentation cadence, frame-budget quality, broad semantic accuracy, video tracking, or a throughput guarantee. Those claims require their own live measurements and representative inputs.

The optional witness exercises the real UI and preserves route identity, output identity, screenshots, timing, and a terminal failure report:

```sh
node tools/sam-semantic-mask-workbench-witness.mjs \
  --url "$(node -p \"require('/absolute/path/sam-route.json').effectiveUrl\")" \
  --out /absolute/path/sam-positive.png \
  --report /absolute/path/sam-witness.json \
  --negative-control
```

The witness requires the exact registered URL from the server receipt, not the root redirect. It launches Chrome and performs GPU inference. Run it when the device is available. Add `--exercise-foreground` to inject source-viewport input during inference and retain shared-device submission evidence; this does not certify presentation latency. The report preserves every retained binary mask and the selected mask's logits for offline numerical comparison. `--timeout-ms` is optional and caller-owned; there is no default model-execution timeout. Reference parity uses `smokes/sam-mask-island-parity.html` and the separate parity tools, not the interactive workbench's request path.
