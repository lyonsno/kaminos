# Qwen3.5 text generation

This model adapter composes packed affine4 projections, Gated DeltaNet and cached gated attention with the inference kit's token loop. `Qwen35TextModel` borrows the caller's WebGPU device and inference control. It owns loaded weight buffers; each generation request owns independent hybrid state. `expandPupText` supplies BFL's text-to-image prompt policy and streamed text decoding.

The initial source is the retained MLX affine4/group64 BFL prompt-upsampler pack. The weight manifest addresses its existing safetensor ranges, with exact shapes, dtypes and SHA256 hashes. Packed weights stay unsigned four-bit values; BF16 scales, affine biases and small parameters are losslessly expanded to FP32. Qwen normalization weights in this converted pack already include their source offset and are used directly.

```js
import { Qwen35TextModel } from './text-model.js';
import { expandPupText } from './pup-text.js';
import { QwenTokenizer } from '../flux2-klein/qwen-tokenizer.js';

// device/control come from the host's existing inference invocation.
const manifest = await (await fetch(weightsManifestUrl)).json();
const model = new Qwen35TextModel(device, manifest, { control });
await model.load(modelBaseUrl, { signal, onProgress });
const tokenizer = new QwenTokenizer(await (await fetch(tokenizerUrl)).json());

try {
  const result = await expandPupText({
    model, tokenizer, prompt, systemPrompt, signal, control,
    onText: (delta, text) => updateEditablePrompt(text),
  });
  // result.finishReason distinguishes EOS from output-length/cache exhaustion.
  consumeExpandedPrompt(result.text, result.finishReason);
} finally {
  await model.destroy(); // preserves the borrowed device and control
}
```

The host owns asset-source admission, application scheduling and presentation. The example composes the adapter, rather than establishing an integrated Generate UI. Its model URLs must serve exact byte ranges with HTTP206 and Content-Range. The loader verifies the requested range, full tensor byte count and tensor hash before decoding. Embedding and output-head buffers split at the effective device binding capacity while preserving every vocabulary row. No cross-request prefix reuse or cache eviction is implemented.

`createState({capacity,signal,control})`, `prefill(ids,state)`, `decode(id,state)` and `disposeState(state)` implement the kit's generation adapter contract. `append(ids,state)` additionally accepts subsequent input. Prefill/append split at actual device binding and dispatch limits, preserve all tokens and carry both state families across chunks; only the final chunk computes logits. State capacity is explicit and cannot exceed source positions or the current device's KV binding capacity. This implementation stores activations, recurrent matrices, convolution histories and attention KV in FP32; the separate configuration planner can also estimate FP16 KV, but FP16 KV execution is not implemented here. A failed/aborted append poisons that request state; dispose it and begin a fresh request. Requests execute serially per model instance. State disposal aborts a parked owned request, fences admitted work and releases all buffers without resuming or closing a borrowed control.

The serving path reads only the final token's full-vocabulary logits back to the portable CPU sampler. `onLayer` and `onNorm` are optional diagnostic hooks; the normal path performs no hidden-state oracle readbacks. GPU token selection and separate optimized prefill/GEMV routes can replace these operations without changing the generation interface.

Prepare the source manifest without MLX:

```sh
python3 models/qwen3_5/export-model-reference.py \
  --model-dir /path/to/retained-pack --out /path/to/package \
  --report /path/to/package/report.json --manifest-only
```

This writes metadata and hashes existing files; it does not copy or convert the model. Serve `weights.json` alongside the referenced original safetensor files, or pass separate manifest/model base URLs. The source-only report cannot satisfy native-reference admission.

Without `--manifest-only`, the exporter also runs the installed native MLX-VLM text model in FP32 over the same retained quantized weights, preserving actual prefill, cached continuation and fresh-full-prefix layer/norm/logit arrays. `run-model-witness.mjs <reference-dir> <model-dir> <independent-chrome-executable> <report.json>` exercises the production adapter, the existing generation loop and real WebGPU. It preserves complete readbacks and independently adjudicates them against the native arrays. In this shop, model hashing, native execution and browser model runs go through Greenroom; the witness uses Chrome for Testing with a private profile and mock Keychain.

This is the text backbone. BFL image/reference and bounding-box processing require the vision encoder, multimodal positions and application composition. The native numerical reference explicitly establishes FP32 computation over the retained Q4 pack; it does not establish equivalence to a BF16 activation runtime or application-level prompt quality.

An optional fifth witness argument names an invoker-owned JSON request such as `{ "prompt": "a red fox in snow" }`. That runs the source BFL `t2i` system prompt and defaults through `expandPupText`, records actual framed IDs/settings/asset hashes and full streamed output, and requires EOS rather than accepting a truncated or blank expansion. It repeats the numerical gate before application exercise.

The composed browser witness has passed twelve native comparisons, including a multi-token prefix split across calls. A complete BFL text request consumed 743 framed input tokens and generated 302 tokens through EOS with the shipped settings. These observations establish one exercised text expansion and the recorded numerical inputs; broader prompt quality and useful latency require their own measurements.

To measure the serving path, append `--serving-profile` after the request path. This mode disables layer/norm diagnostic hooks and skips numerical oracle stages. It records source-validated weight fetch/decode/upload wall time, input preparation, time to first streamed text, each prefill/decode/state-lifetime call, and aggregated per-kernel duty wall time. Full text, token IDs, settings, source/browser/device identity and terminal cleanup remain in the report; a profile requires a complete EOS result. Duty durations include admission, compilation and queue fences, so they are not GPU timestamp measurements. The fresh browser loads model files from the supplied server; this is not a cached-model or network-download benchmark.
