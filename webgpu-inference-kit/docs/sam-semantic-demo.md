# SAM Semantic Masks

The demo accepts a sample image and text prompt, then displays the source, mask overlay, and raw mask. It executes the detector backbone, neck, prompt encoder, DETR encoder/decoder, scoring, selection, and mask tail in browser WebGPU. No MLX process participates in interactive requests.

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

Open `http://127.0.0.1:18596/`. The server prints and optionally writes its effective route, checkout commit, mounted roots, and package/sample hashes. It does not automatically start inference. Use a WebGPU-capable Chromium browser, select a sample, enter a prompt, and run. A second prompt on the same image reuses its image features; changing the image recomputes the image path. An empty selection is a valid model result, not a substituted mask.

## Shared Runtime Composition

- Static artifacts load sequentially through `route.loadModelResourcePackageFromSources()`. Each has an independent digest and semantic manifest. SAM does not assemble a second whole-model bundle.
- The model keeps authenticated host views for tensor binding and persistent GPU weights. Sequential source acquisition does not imply that the complete model fits in the largest artifact's memory footprint.
- Serving invocations enter a registered session route's queue. Terminal completion, current execution receipts, and cached image provenance remain distinct.
- Phase outputs stay typed arrays during serving. Reference mode retains JSON-compatible readbacks. Intermediate host readbacks still exist at phase boundaries; this is not a fully GPU-resident activation graph.
- Per-layer ViT finite checkpoints and full diagnostic DOM rendering are off during ordinary serving. Reference mode and explicit `diagnosticReadback=1` retain diagnostics.
- The demo requests supported device limits through the kit device helper instead of silently accepting the WebGPU default storage-binding limit.

An embedding application may set `window.sam3InferenceSession` before importing `smokes/sam-mask-island-parity.js` in the serving realm. SAM then uses that session's exact device, owns only its registered route and model leases, and does not close the application's session or device. Only one SAM resident owner may occupy that session's SAM owner-route id.

An optional `window.sam3CooperativeYield` callback is forwarded to the shared phase runtimes. Use the kit's `createCooperativeYield()` or a compatible application callback to service foreground work at the model's existing boundaries. A callback cannot preempt an already submitted dispatch. Queue composition and safe borrowed ownership are implemented; acceptable frame latency while rendering alongside full-model inference still requires a live measurement.

## Evidence Boundary

The current workbench package uses 224-pixel model input, not native-resolution quality. Historical positive and negative prompt controls establish useful prior evidence, not numerical or latency certification of each new checkout. No throughput or streaming-speed guarantee is made here.

The optional witness exercises the real UI and preserves route identity, output identity, screenshots, timing, and a terminal failure report:

```sh
node tools/sam-semantic-mask-workbench-witness.mjs \
  --url "$(node -p \"require('/absolute/path/sam-route.json').effectiveUrl\")" \
  --out /absolute/path/sam-positive.png \
  --report /absolute/path/sam-witness.json \
  --negative-control
```

The witness requires the exact registered URL from the server receipt, not the root redirect. It launches Chrome and performs GPU inference. Run it when the device is available. `--timeout-ms` is optional and caller-owned; there is no default model-execution timeout. Reference parity uses `smokes/sam-mask-island-parity.html` and the separate parity tools, not the interactive workbench's request path.
