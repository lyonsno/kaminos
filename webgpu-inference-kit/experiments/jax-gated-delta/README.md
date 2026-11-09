# Differentiable Gated DeltaNet experiment

A small, private experiment for browser adapter training. It expresses the Gated DeltaNet recurrence with jax-js array operations, checks forward values and all input gradients, and lets the existing WebGPU Inference Kit consume a jax-owned GPU buffer on the same device. This directory is outside the Kit's published `files` list and adds no production dependency.

The recurrence uses prepared `q`, `k`, `v`, logarithmic decay and update strength `beta`. State has layout `[batch, heads, keyDim, valueDim]`; sequence inputs have layout `[batch, time, heads, dim]`. For each timestep:

```text
decayed = exp(logDecay) * state
prediction = transpose(decayed) * k
state = decayed + outer(k, beta * (v - prediction))
output = transpose(state) * q
```

Query/key normalization, query scaling, grouped-head expansion, causal convolution and gate preparation belong to the caller. The state layout and prepared recurrence follow the existing Qwen browser kernel, `models/qwen3_5/kernels.js:deltaRecurrentShader`, on Eventual's separate `cc/qwen35-webgpu-delta-1105` branch at `0452ac3f6f691bc6c63fc8670b1ea9e849865586`. That model implementation has not been copied into this experiment or merged into its base. The experiment's logarithmic decay is exponentiated here; the existing kernel receives decay already exponentiated.

`gatedDeltaSequence()` consumes every input array on success and returns owned output/state arrays. Input shapes are validated before consumption. The time loop is statically unrolled by `jit`. It is a correctness and interoperability baseline; it is not a fused scan, an efficient long-context backward pass, or a Qwen trainer.

Run from this directory, using Node.js and an independent Chrome for Testing or Chromium executable:

```sh
npm ci --ignore-scripts
npm test
node browser-runner.mjs \
  --chrome '/absolute/path/to/Google Chrome for Testing' \
  --expected-vendor apple \
  --out '/caller/chosen/path/browser-report.json'
```

The browser runner serves only local source, requires the requested GPU vendor, records the effective browser/device and source hashes, and rechecks all raw numbers in Node. It retains a failure report if launch or module loading fails. Its disposable browser uses a private profile and mock Keychain; browser and server close on success or failure. The profile path remains in the report for diagnosis. No browser timeout or model/context cap is imposed.

Checks cover nonzero initial state, unequal key/value dimensions, multiple batches/heads, sequence output and final state, gradients for `q`, `k`, `v`, `logDecay`, `beta` and initial state against FP64 central differences, and split-call continuation. Numerical tolerances are `2e-5 + 2e-3 * abs(expected)` for FP32 values. The largest input has 48 FP32 elements; this is a tiny conformance check with no weights or performance comparison. Qualifying larger workloads and benchmarks use the shop's Greenroom queue.

The actual Kit consumer retains the jax array owner, exports a read-only GPU buffer, executes an affine WGSL kernel through `createWebGpuInferenceRuntime()`, drains the work, disposes Kit resources and verifies that the original array and later jax computation still work. This tests borrowing **jax's** device. It does not establish that jax can adopt a device already owned by an application, import arbitrary Kit buffers, or honor the Kit's foreground scheduling during a jax training step. Architectural adoption remains a separate decision.

The recurrence is a reference for differentiating a bounded or fused implementation without expanding the compilation graph and saved activations with every timestep. The frozen-projection/LoRA baseline below checks the preceding learning seam. AdamW, efficient quantized execution, representative memory/throughput and model/task evaluation remain future slices.

## Frozen Q4 projection and LoRA

`q4-lora.mjs` adds a prepared affine4/group64 projection with a differentiated LoRA branch:

```text
weight[row,col] = code[row,col] * scale[row,col/64] + bias[row,col/64]
output = input @ transpose(weight) + (alpha/rank) * (input @ transpose(A)) @ transpose(B)
```

The packed base is a separate, frozen argument tree: unsigned 32-bit words store eight 4-bit codes, least significant code first. Only `input`, `A` and `B` are differentiated. Both trees are consumed on success; shape/dtype checks precede consumption. The implementation accepts positive token/row/rank dimensions and columns divisible by64; group64 and FP32 arithmetic are explicit format choices.

This is a correctness baseline that expresses dequantization followed by matrix multiplication. The one-token forward replay already fuses unpacking into its reduction. Multi-token reuse materializes the decoded FP32 matrix, and autodiff also saves that matrix as a backward residual even for one token. The training path therefore does not retain the packed-weight memory advantage throughout the operation. A packed projection with derivative rules that retain packed weights, or an equivalent custom-derivative path, is needed before claiming efficient model-scale QLoRA; forward fusion alone does not solve backward residency.

The synthetic check covers two tokens, five rows,128columns, rank3 and non-unit LoRA scaling. Its scalar input and adapter gradients are checked against finite differences. One compiled SGD update changes both adapter factors and lowers the same loss while preserving the input. A second case replays one complete4096-column row from retained native Qwen projection evidence. Adapter weights are not published with this experiment.

Prepare the external native replay from an existing kernel-reference directory and the existing Qwen shader source revision:

```sh
node prepare-q4-fixture.mjs \
  --source '/absolute/path/to/native-kernel-reference' \
  --qwen-root '/absolute/path/to/qwen-source-worktree' \
  --qwen-commit 0452ac3f6f691bc6c63fc8670b1ea9e849865586 \
  --out '/caller/chosen/path/native-fixture.json'
node browser-runner.mjs \
  --experiment q4-lora \
  --fixture '/caller/chosen/path/native-fixture.json' \
  --chrome '/absolute/path/to/Google Chrome for Testing' \
  --expected-vendor apple \
  --out '/caller/chosen/path/q4-browser-report.json'
```

Preparation validates the original array layouts and complete-file digests before selecting the first token and first complete row. The result retains the native source identity, original array metadata, selected values and exact generated Qwen affine shader. The browser report records the fixture digest and revalidates all returned numbers on the host. Missing fixtures and truncated source arrays produce explicit failure reports.

The updated adapter factors and the frozen base used by the training step stay on the GPU while the Kit borrows their buffers. Loss re-evaluation and the consumer reuse that same retained base. Its consumer executes the existing Qwen affine shader, the Kit's two `split4` linear projections and a small scaled-add kernel. Kit disposal preserves the borrowed adapter/base buffers. This is projection-level composition; model adapter packaging, a whole-model training loop, AdamW, foreground cooperation and representative efficiency remain open. Raw allocation events and generated WGSL are retained as diagnostics; allocation events are not a peak-residency measurement because jax can reuse pooled storage.
