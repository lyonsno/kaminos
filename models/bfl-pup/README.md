# BFL prompt helper: browser conversion

This directory builds ONNX components for the exact
`black-forest-labs/flux-3-image-klein-pup` Qwen3.5-9B fine-tune. The Q4 browser package has produced coherent, EOS-terminated text-only and
image-conditioned expansions through WebGPU.
The existing local MLX trial lives on `cc/thomas-pup-sidecar-1025`.

Use a separate Python 3.12 environment with `requirements-export.txt`. This is
offline conversion tooling; it does not add Python dependencies to the browser
application or the normal Kaminos test environment. Run conversion through GPU
Greenroom, using explicit source, output and report paths.

The pinned original is revision `3f3edb52b2c55de0d49feab28598b68f7f8e4830`.
Its `model.safetensors` is 18,819,722,392 bytes, LFS SHA-256
`f5062a1fba3e63afe5c88349a311903fec06c959b362f1247127e63d5c860ed4`.
The converter verifies the actual source digest and preserves its full tensor
header and small model/config/tokenizer files. It does not delete the source.

The language decoder uses the ONNX Runtime GenAI model builder, pinned to
`microsoft/onnxruntime-genai@6b7ff3ca3efa15da219050fdb4ecf8bed67875af`:
INT4 weights, WebGPU target, `exclude_embeds=true`, `block_size=64`,
`is_symmetric=false`, `state_window=0`, `exclude_mtp=true`, and
`filename=decoder_model_merged_q4f16.onnx`. Browser packaging must retain its
FP16 I/O and each cache binding's actual type and shape. An exported decoder
alone is not an image-aware prompt helper.

`export_components.py` supplies the other components. Required arguments are
`--source-dir`, `--source-revision`, `--source-weight-sha256`, `--out`,
`--report` and `--component vision|embeddings`. Choose a fresh component output
directory so previous artifacts remain available. Reports record the failure
phase, source identity, actual versions and component checks.

Token embeddings use ONNX Runtime's affine Q4 `GatherBlockQuantized`, groups
of64, with FP16 output. Vision parameters use FP16 storage with FP32 arithmetic
and FP16 feature output. This precision route is provisional: the first full
FP16 export failed the recorded source-comparison tolerance, so the next
experiment retains FP32 arithmetic rather than weakening that tolerance.
The vision graph encodes one
image per call; a browser adapter must evaluate all supplied references and
concatenate their features in attachment order. It supplies block-ordered
position IDs and bilinear position-embedding indices/weights derived from each
image's processor grid. This separates dynamic image preparation from model
math. Directly tracing the canonical vision forward captured the first image's
Python attention split size and failed on a different grid.

The wrapper retains the canonical Qwen3.5 vision parameters, norms, rotary
embedding and MLP/merger, and uses one-image scaled dot-product attention.
The converter compares two real-model grids to the canonical Transformers
vision forward and checks the resulting ONNX on CPU. These checks do not
establish browser execution or whole-helper generation quality.

Run the small dynamic-grid source-conformance check with the export interpreter:
`python tests/bfl-pup-vision-export.py` from the repo root. It verifies square,
landscape and portrait grids against canonical Transformers and rejects a
multi-image tensor passed to a single-image call. This optional export-stack
check is marked manual for the ordinary test runner; agents execute it directly
in the pinned conversion environment.

Source implementations:
[BFL's helper](https://github.com/black-forest-labs/flux-3-image-klein/blob/main/src/flux3/pup.py),
[BFL's fine-tune](https://huggingface.co/black-forest-labs/flux-3-image-klein-pup),
[Transformers Qwen3.5](https://github.com/huggingface/transformers/tree/main/src/transformers/models/qwen3_5),
and [ONNX Runtime GenAI builder](https://github.com/microsoft/onnxruntime-genai/tree/6b7ff3ca3efa15da219050fdb4ecf8bed67875af/src/python/py/models).

## Browser adapter and local trial

`browser-backend.mjs` exposes `createBrowserPromptHelper({modelUrl})`, whose
`expand({prompt, images, signal, onText})` returns editable text, termination,
model/session identity and observed timing. Images stay in attachment order.
Only a fully initialized and validated WebGPU model is retained; rejected
candidates are disposed and every retry validates a fresh candidate.

`worker-client.mjs` wraps the same operation in a per-request module worker.
The prompt studio at `/prompt-expander-browser.html?model=/mounted-pup-package`
uses that worker, streams text into an editable field, and terminates loading
or generation on Cancel. Worker termination also discards the model between
requests. The same-origin package must be mounted by the serving host; no
Python model server participates. This local trial does not yet establish
portable public weight distribution or Generate integration.

The package has original BFL tokenizer/config/template/system prompts. For
Transformers.js4.2 the original processor class is additionally exposed in
`preprocessor_config.json`, matching that version's actual AutoProcessor
lookup. This prevents silently constructing an image-only processor without
its tokenizer. The adapter checks that contract before model weight loading.

`onnx_browser_compat.py --package <prepared> --out <fresh> --report <report>`
lowers the newer GenAI `LinearAttentionGate`, `GatedRMSNorm` and
`MRotaryEmbedding` fusions to standard ONNX arithmetic and the source's exact
rotary caches. It removes only `state_window=0`; nonzero windows reject rather
than change behavior. Learned Q4 tensors remain unchanged. The pinned browser
runtime is `onnxruntime-web@1.26.0-dev.20260416-b7804b056c`, bundled by
Transformers.js4.2. Its source already supports the 9B model's inverse grouped
attention; the adapter preserves those heads and scale.

Reference sizing matches BFL's Python geometry, including tie-to-even
rounding, aspect-ratio validation and count-dependent budgets. Browser Canvas
composites onto white, resizes and JPEG-encodes at quality .92. Canvas/Pillow
pixels are not claimed byte-identical. Per-image learned-position and rotary
inputs match canonical Transformers5.20.2 fixtures for square, landscape and
portrait patch grids.

The small optional `tests/bfl-pup-onnx-compat.py` checks canonical gate, norm,
multiaxis rotary and untouched head tails, plus unwindowed compatibility and
native grouped recurrence. `tests/bfl-pup-package.py` checks complete external
tensor bytes and binding/shape rewrites. Node input tests use recorded canonical
fixtures; backend/worker lifecycle stubs establish rejection, cancellation and
ownership only. None substitutes for the actual whole-helper browser witness.
Text-only execution and an image-aware request through the actual worker/page
have passed, including editable output and exact clipboard text. The original
18.8 GB BF16 weight was retired after those outputs and source consumers were
checked; source metadata and the separate MLX Q4 package remain retained.
Generate integration is available through the application mount below. Shared-device renderer composition remains separate provider work.

The adapter explicitly loads BFL's `chat_template.jinja`: the pinned Qwen3VL
processor does not load that file by default. Preparation precedes model
residency. An actual browser processor comparison matches all retained native
BFL framing fixtures (732,731,2328 tokens), including the complete IDs.

`text-rope-compat.mjs` corrects the pinned runtime's text-only continuation
delta. Its actual browser method returned delta6 and next-position9 after a
three-token prompt; canonical Transformers5.20.2 returns delta0 and position3.
The browser replay after the shim matches those canonical positions. This is
an input/cache position correction for this pinned runtime, not evidence of
whole-model output quality. The model's image-aware position path is retained.

The page uses the existing `serve.py` `/api/gpu-lease` endpoint to wait for
Greenroom before loading weights, renew its lease while working, and release
after disposal. Cancel ends the owned worker, including model loading.
Elapsed total covers GPU wait, processor/model setup and disposal; the backend
expansion and token-generation timings remain separate in Run details.
A server without Greenroom reports that explicitly; a broken endpoint fails
before inference. Failed release stays visible and is retried before a later
request or on page close.

For a local offer, mount the accepted package under the ignored
`models/bfl-pup-onnx/` directory, then use the normal Kaminos server and open
`/prompt-expander-browser.html`. The package contains about 5.8 GB of external
weights. Model tensors execute in the visitor's browser; the server serves
files and coordinates GPU admission on the shared shop machine. The provider
operation remains replaceable by the inference-kit implementation.


## Generate application mount

Set `KAMINOS_PUP_WEIGHTS_ROOT` to the completed browser conversion package when
starting `serve.py`. Runtime configuration reports its metadata availability
under `pup`, and `/pup-weights/` serves the same package without copying it into
each checkout. Generate resolves this explicit mount before requesting GPU
admission. Missing or incomplete packages produce an unavailable message;
there is no implicit server inference backend.

The Expand prompt action retains the selected original image, streams editable
text and offers Undo. Completed text is put into the existing prompt field;
partial results need explicit adoption. Saved image provenance records the
original request, expanded text, final edited prompt and provider identity.
The ONNX provider owns its worker and GPU runtime. Generate can retain that worker between successful requests; the inference-kit provider can replace the same operation independently.


The pinned Transformers.js4.2 local-file metadata path calls `getFile()` and
returns headers without consuming or cancelling the body. Supplying the
model's optional `progress_callback` triggers that preflight for every ONNX
file before session loading. Unread large responses can occupy the same-origin
HTTP connection pool alongside the editor's live streams, preventing further
model requests and lease renewal. The adapter omits this optional callback;
processor/model phases, elapsed time and streamed text remain available.
This changes progress reporting, not model tensors, output limits or sampling.
Pinned source: [metadata reads](https://github.com/huggingface/transformers.js/blob/54652ba3366ccd1e3b64e689a96504309e6fb53b/packages/transformers/src/utils/model_registry/get_file_metadata.js)
and [model preflight](https://github.com/huggingface/transformers.js/blob/54652ba3366ccd1e3b64e689a96504309e6fb53b/packages/transformers/src/models/modeling_utils.js).


## Retaining weights during image iteration

Generate offers **Keep prompt helper loaded** and **Unload**. With retention enabled, a successful expansion leaves the initialized processor and model in its worker. Every request still claims, renews and releases its own Greenroom execution lease; idle resident weights do not reserve GPU execution. A second request starts with fresh request state and reports `modelReused: true`. Cancel, a worker error, Unload, disabling the preference, or closing the tab retires the context. The prompt studio keeps its per-request default.

The choice persists in browser-local storage. `KAMINOS_PUP_KEEP_LOADED=true` supplies the serving machine's initial default without overriding a previously saved browser choice. Models are loaded by the first expansion, never preloaded merely by opening the page. Retention consumes memory while the tab is open.

While the browser worker remains resident, `browser-backend.mjs` also caches prepared reference images and per-image post-merger `vision_encoder` feature snapshots (`(64, 4096)` FP16, keyed by SHA-256 over `(grid, dtype, dims, pixel_values)` in a 16-entry LRU, reported under `visionCache: {hits, misses, entries}`) and clears both caches on `dispose()`. In addition to default BFL prompt expansion (`mode: 'expand'`), `expand({prompt, images, mode: 'vlm', systemPrompt})` exposes general vision-language chat/critique over the same resident WebGPU session and cached image features.


## Switchable weight-difference adapter over Qwen3.5-9B

BFL trained `black-forest-labs/flux-3-image-klein-pup` (`3f3edb52b2c55de0d49feab28598b68f7f8e4830`) as a full fine-tune of `Qwen/Qwen3.5-9B` (`c202236235762e1c871ad0ccb60c8ee5ba337b9a`) with all 333 `model.visual.*` tensors frozen (`rel_L2 = 0.0`). Rather than hosting two 9B checkpoints, we factor the weight difference $\Delta W = W_{\mathrm{BFL}} - W_{\mathrm{Qwen}}$ into a switchable sidecar over a single resident `Qwen3.5-9B` (`model_load_count == 1`, `8.99 GB` peak RSS in 4-bit MLX, `<1 ms` mode switch):

- `extract_delta_adapter.py` streams tensor pairs from the BF16 source checkpoints (or local checkpoint directories), skips `mtp.*` and verifies `model.visual.*` identity, retains all 225 small language tensors (`dim < 1024`: RMSNorms, `conv1d.weight`, `in_proj_a.weight`, `in_proj_b.weight`, `A_log`, `dt_bias`) exactly in `shards/exact_small.safetensors`, and extracts rank-sliceable truncated SVD factors (`lora_B`, `lora_A`, `singular_values` ordered by descending singular value) for the 200 layer 2D projections plus `embed_tokens` and `lm_head`. Any rank `r <= max_rank` is a prefix slice `lora_B[:, :r] @ lora_A[:r, :]`.
- `switchable_adapter.py` (`SwitchableDeltaController`, PyTorch) and `mlx_switchable_adapter.py` (`MLXSwitchableDeltaController`, MLX unquantized + 4-bit `QuantizedLinear`/`QuantizedEmbedding`) attach the extracted adapter to a single resident model, swap the exact small parameters, apply the rank-`r` sidecar delta without reloading or dequantizing the base 2D weights, and enforce KV + Gated DeltaNet recurrent state reset on every mode or rank switch unless `preserve_cache=True` is explicitly requested.
- **Exact cross-mode `vision_tower` feature cache (`MLXSwitchableDeltaController.prepare_multimodal_inputs`):** Because all 333 `model.visual.*` tensors have $\Delta W = 0$ (`vision_tower_invariant == True`), `prepare_multimodal_inputs` caches the post-merger BF16 visual features keyed by image SHA-256 and passes `cached_image_features` directly to `mlx_vlm.stream_generate`. In `Qwen3.5-9B`, a `1024×1024` image (`64×64 = 4,096` raw $16\times 16$ patches) is spatially merged $2\times 2$ by `Qwen3_5VisionPatchMerger` into `64` tokens (`(64, 4096)` BF16 = `512 KB`). Reusing `cached_image_features` across `off` and `on_r*` turns is bit-for-bit identical (`exact_output_match == true`) and saves `11.0 ms` CPU processor prep plus `31.4 ms` (`1× 1024×1024`) or `58.7 ms` (`2× 1024×1024`) warm Vision Tower forward per turn.
- **Prefill-to-decode rank downshift (`DEFAULT_BFL_RANK_DOWNSHIFT_SCHEDULE` / `MLXSwitchableDeltaController.split_generation_context`):** Prefill is compute-bound (matrix-matrix over the prompt) where rank `r=256` costs almost nothing (`238 tok/s` vs `255 tok/s` at `r=64`), whereas autoregressive decode is memory-bandwidth-bound (matrix-vector per token) where rank `r=64` is `+18.7%` faster than `r=256` (`58.6 tok/s` vs `49.4 tok/s`). `split_generation_context` intercepts `model.language_model` at `before_last_prompt_token` (or `after_token_1`), evaluates the lazy prefill KV + GatedDeltaNet recurrent states (`mx.eval`), and downshifts the adapter in `<0.5 ms` with `preserve_cache=True`.
- **Empirical resident MLX evaluation summary (`Qwen3.5-9B-MLX-4bit` + `adapter-r256`, `temperature=0.0`):**

| Mode | Prefill $\rightarrow$ Decode | `t2i` Decode (`tok/s`) | `t2i` Word Jaccard vs BFL BF16 Ref | `i2i` Word Jaccard vs BFL BF16 Ref | Notes |
| --- | --- | --- | --- | --- | --- |
| `off` | `off` $\rightarrow$ `off` | `83.9` | `0.2791` | `0.2140` | Exact resident Qwen3.5-9B (`1.0000` Jaccard on general VLM control) |
| `on_r64` | `r64` $\rightarrow$ `r64` | `58.6` | `0.4250` | `0.4292` | Fast uniform rank-64 BFL mode |
| `on_r128` | `r128` $\rightarrow$ `r128` | `54.7` | `0.4688` | `0.4017` | Balanced uniform rank-128 BFL mode |
| `on_r256` | `r256` $\rightarrow$ `r256` | `49.4` | `0.4523` | `0.3694` | Full rank-256 BFL mode |
| `on_r256_prefill_to_r64_decode` | `r256` $\rightarrow$ `r64` (`before_last_prompt_token`) | `~58.6` | **`0.4754`** | — | Highest BFL reference overlap (`0.43 ms` swap, `preserve_cache=True`) |
| `off_prefill_to_r128_decode` | `off` $\rightarrow$ `r128` (`before_last_prompt_token`) | `~54.7` | `0.4065` | `0.3194` | Cross-persona KV/GatedDeltaNet reuse (`0.4252` / `0.4773` vs pure `on_r128`) |
| `r128_prefill_to_off_decode` | `r128` $\rightarrow$ `off` (`after_token_1`) | `~83.9` | `0.3098` | — | Token 1 commits to prose caption prefix; `off` decode continues caption |

- `evaluate_switchable_mlx.py` evaluates a single resident MLX model across `DEFAULT_MODES` (`off`, `on_r64`, `on_r128`, `on_r256`, `on_r256_prefill_to_r64_decode`) with fail-first false-closure guards.
- Manual unit checks: `tests/bfl-pup-delta-extract.py`, `tests/bfl-pup-switchable-adapter.py`, `tests/bfl-pup-mlx-switchable-adapter.py`, and `tests/bfl-pup-mlx-eval-harness.py`.
