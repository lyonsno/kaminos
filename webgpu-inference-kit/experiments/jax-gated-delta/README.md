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

The next engineering question is how to differentiate a bounded or fused recurrence without expanding the compilation graph and saved activations with every timestep. The present implementation is a reference for that work. AdamW/LoRA composition, quantized frozen weights, representative memory/throughput and model/task evaluation remain future slices.
