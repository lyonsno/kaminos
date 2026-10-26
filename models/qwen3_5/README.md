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

Prefill projections use the tiled FP32 path. The constructor option `singleTokenKernel: 'quad'` selects the experimental four-row FP32 projection for single-token calls, including the final output head; the default is `'oracle'`. The selection can change through `model.singleTokenKernel` between completed requests. It rejects unknown values and changes during active execution/loading, and each append snapshots its selection. This leaves request-state layout and the shared control unchanged. The four-row kernel has passed native kernel comparisons; full-model and application comparison determine its adoption.

`batchDecode: true` is a separate experimental constructor option; it defaults to false and can change through `model.batchDecode` between completed requests. It encodes a cached single-token append's decoder layer into one command buffer and one admitted, fenced duty. Prefill, including a one-token tail of a device-sized chunk, retains its individual duties. The shader operations, FP32 buffers and request state are unchanged. The tradeoff is coarser decode pause/abort boundaries: admitted layer work retires before control returns, while the default retains individual-kernel boundaries. Uniforms remain alive through their queue fence, validation scopes are popped synchronously before another await, and diagnostic layer readback occurs after the layer duty.

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

The numerical witness also accepts `--quad-affine` after its four required paths to select that model option. It records the effective selection and actual dispatch counts. For a single serving profile, pass the request path plus `--serving-profile --quad-affine`.

For a comparison with one browser and one weight load, pass the request path plus `--compare-affine`. It runs complete expansions in the order `oracle`, `quad`, `oracle`, each with fresh request state and normal source sampling/EOS policy. Shared loading/input preparation are recorded separately from the three generation profiles. Admission requires the requested dispatch route in each run, state retirement between runs, sequential clocks, and identical complete text/token outputs. The two baseline-to-candidate decode ratios and baseline drift remain observations to interpret together. `--compare-affine` and a forced `--quad-affine` selection conflict and are rejected; unsupported trailing arguments are also preserved and rejected in the failure report. This experimental comparison does not change the model default.

`native-replay.py` measures the same model work through the native FP32 loader used by the numerical exporter. Supply a completed serving report and its pinned SHA256, the retained model directory, and explicit output/report paths:

```sh
python3 models/qwen3_5/native-replay.py \
  --browser-report /path/to/browser-report.json \
  --expected-browser-sha256 <report-sha256> \
  --model-dir /path/to/retained-pack \
  --out /path/to/native-replay --report /path/to/native-replay/report.json
```

The replay consumes every recorded prompt and generated token, including the final prediction of EOS. Its synchronized call timing includes full-logit CPU readback, matching the browser adapter's return boundary. It records effective runtime/parameter dtypes, source hashes and complete raw FP32 logits with per-call offsets and hashes; sampling and raw-file serialization occur outside those timed calls. This measures model-compute headroom along a fixed trajectory; its greedy-token agreement is reported separately from replay completion. Source tensor and tokenizer/system-prompt hashes must match the browser run. Native inference and model hashing require Greenroom in this shop.

Append `--batch-decode` to the numerical witness to exercise this option. A single serving profile accepts a request plus `--serving-profile --batch-decode`; `--compare-batching` instead runs complete unbatched/batched/unbatched expansions with the oracle projection kernel held fixed. Comparison axes and forced execution selectors cannot be combined. Reports retain actual layer-batch submissions and duty counts/times, including maximum layer duty duration. In batched layers, per-dispatch durations measure CPU encoding, while layer-duty wall times include admission and the final fence; these overlap and must not be added together. This option remains provisional pending native numerical, control/lifetime and useful latency evidence.

Batched serving profiles use `kaminos.qwen35-serving-profile.v2`: leaf dispatch clocks include command encoding while layer clocks include admission and the queue fence. These overlap and must not be added. Unbatched fenced-dispatch profiles retain v1. A reader must explicitly admit v2 with batching evidence before interpreting its timing.
