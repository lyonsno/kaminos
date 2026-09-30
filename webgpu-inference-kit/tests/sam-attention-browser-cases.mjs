export const attentionCases = [
  { name: 'standard-partial', shader: 'SAM_ONLINE_ATTENTION_WGSL', queries: 5, keys: 129, heads: 2, dim: 32, domains: 2 },
  { name: 'masked-partial', shader: 'SAM_MASKED_ONLINE_ATTENTION_WGSL', queries: 5, keys: 67, heads: 2, dim: 64, domains: 2, mask: true },
  { name: 'decoder-mask-enabled', shader: 'SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL', queries: 5, keys: 65, heads: 2, dim: 32, domains: 2, mask: true, maskMode: 1 },
  { name: 'decoder-mask-disabled', shader: 'SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL', queries: 5, keys: 65, heads: 2, dim: 32, domains: 2, mask: true, maskMode: 0 },
  { name: 'decoder-all-masked', shader: 'SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL', queries: 3, keys: 65, heads: 1, dim: 64, domains: 1, mask: true, maskMode: 1, allMasked: true },
  { name: 'biased-small-head', shader: 'SAM_BIASED_ONLINE_ATTENTION_WGSL', queries: 3, keys: 65, heads: 3, dim: 7, domains: 2, bias: true },
  { name: 'causal-partial', shader: 'SAM_CAUSAL_MASKED_ONLINE_ATTENTION_WGSL', queries: 77, keys: 77, heads: 2, dim: 64, domains: 1, mask: true, text: true },
  { name: 'prompt-fpn-partial', shader: 'SAM_PROMPT_FPN_ONLINE_ATTENTION_WGSL', queries: 5, keys: 77, heads: 4, dim: 16, domains: 2, mask: true, prompt: true },
  { name: 'vit-multiple-windows', shader: 'SAM_VIT_ONLINE_ATTENTION_WGSL', queries: 65, keys: 65, heads: 2, dim: 64, domains: 4, windows: 2 },
  { name: 'long-spatial-keys', shader: 'SAM_ONLINE_ATTENTION_WGSL', queries: 32, keys: 5184, heads: 8, dim: 64, domains: 1 },
];

export function attentionFixture(spec) {
  const channels = spec.heads * spec.dim;
  const vector = (length, phase) => Float32Array.from({ length }, (_, i) => Math.sin(i * 0.23 + phase) * 0.7 + Math.cos(i * 0.017 - phase) * 0.3);
  const q = vector(spec.domains * spec.queries * channels, 0.37);
  const k = vector(spec.domains * spec.keys * channels, 1.21);
  const v = vector(k.length, 2.54);
  const mask = Float32Array.from({ length: spec.domains * spec.keys }, (_, i) => spec.allMasked || i % 5 === 2 ? 0 : 1);
  const bias = vector(spec.domains * spec.heads * spec.queries * spec.keys, 3.7);
  let dims = [spec.domains, spec.queries, spec.keys, channels, spec.heads, spec.dim, q.length, spec.maskMode ?? 0];
  if (spec.text) dims = [spec.domains, spec.keys, channels, channels, channels * 4, spec.heads, spec.dim, q.length];
  if (spec.prompt) dims = [spec.domains, spec.queries, spec.keys, channels, spec.heads, spec.dim, q.length, spec.domains * spec.keys * channels];
  if (spec.windows) dims = [spec.domains / spec.windows, 1, spec.keys, channels, spec.heads, spec.dim, 1, channels * 4, 1, spec.keys, 1, spec.windows, spec.keys, q.length, q.length, 0];
  return { q, k, v, extra: spec.bias ? bias : spec.mask ? mask : null, dims: new Uint32Array(dims), mask, bias };
}

export function attentionOracle(spec, { q, k, v, mask, bias }) {
  const channels = spec.heads * spec.dim;
  const out = new Float64Array(q.length);
  for (let batch = 0; batch < spec.domains; batch++) {
    for (let head = 0; head < spec.heads; head++) {
      for (let query = 0; query < spec.queries; query++) {
        const queryBase = (batch * spec.queries + query) * channels + head * spec.dim;
        const scores = new Float64Array(spec.keys);
        let maximum = -Infinity;
        for (let token = 0; token < spec.keys; token++) {
          const keyBase = (batch * spec.keys + token) * channels + head * spec.dim;
          let score = 0;
          for (let d = 0; d < spec.dim; d++) score += q[queryBase + d] * k[keyBase + d];
          score /= Math.sqrt(spec.dim);
          if (spec.bias) score += bias[((batch * spec.heads + head) * spec.queries + query) * spec.keys + token];
          if (spec.text && (token > query || mask[batch * spec.keys + token] <= 0)) score = -1e9;
          else if (spec.mask && !spec.text && (!spec.shader.includes('DECODER') || spec.maskMode === 1) && mask[batch * spec.keys + token] <= 0) {
            // The existing shader rounds the adjusted score to f32, including
            // its deliberately finite all-masked behavior.
            score = Math.fround(score - 1e9);
          }
          scores[token] = score;
          maximum = Math.max(maximum, score);
        }
        let denominator = 0;
        for (let token = 0; token < spec.keys; token++) {
          const weight = Math.exp(scores[token] - maximum);
          denominator += weight;
          const keyBase = (batch * spec.keys + token) * channels + head * spec.dim;
          for (let d = 0; d < spec.dim; d++) out[queryBase + d] += weight * v[keyBase + d];
        }
        for (let d = 0; d < spec.dim; d++) out[queryBase + d] /= denominator;
      }
    }
  }
  return out;
}

export function compareAttention(actual, expected) {
  if (!ArrayBuffer.isView(actual) || !ArrayBuffer.isView(expected) || actual.length !== expected.length || actual.length === 0) {
    throw new Error('attention comparison requires complete nonempty equal-length arrays');
  }
  let maxAbs = 0, squared = 0, differing = 0;
  for (let i = 0; i < actual.length; i++) {
    if (!Number.isFinite(actual[i]) || !Number.isFinite(expected[i])) throw new Error(`nonfinite attention value at ${i}`);
    const delta = Math.abs(actual[i] - expected[i]);
    maxAbs = Math.max(maxAbs, delta);
    squared += delta * delta;
    if (actual[i] !== expected[i]) differing++;
  }
  return { count: actual.length, maxAbs, rms: Math.sqrt(squared / actual.length), differing };
}

export async function runAttentionCases(baseline, candidate, record) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter || adapter.info.isFallbackAdapter) throw new Error('native nonfallback WebGPU adapter required');
  const device = await adapter.requestDevice();
  const backend = { ...Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key => [key, adapter.info[key]])), isFallbackAdapter: adapter.info.isFallbackAdapter };
  try {
    for (const spec of attentionCases) {
      const fixture = attentionFixture(spec);
      const buffers = [];
      const upload = (values, usage) => {
        const buffer = device.createBuffer({ size: values.byteLength, usage, mappedAtCreation: true });
        new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
        buffer.unmap(); buffers.push(buffer); return buffer;
      };
      try {
        const inputs = [fixture.q, fixture.k, fixture.v].map(values => upload(values, GPUBufferUsage.STORAGE));
        if (fixture.extra) inputs.push(upload(fixture.extra, GPUBufferUsage.STORAGE));
        const uniform = upload(fixture.dims, GPUBufferUsage.UNIFORM);
        const execute = async code => {
          const output = device.createBuffer({ size: fixture.q.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
          const readback = device.createBuffer({ size: fixture.q.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          buffers.push(output, readback);
          const unwritten = new Float32Array(fixture.q.length).fill(NaN);
          device.pushErrorScope('validation');
          const module = device.createShaderModule({ code });
          const info = await module.getCompilationInfo();
          const errors = info.messages.filter(row => row.type === 'error');
          if (errors.length) { await device.popErrorScope(); throw new Error(errors.map(row => row.message).join('\n')); }
          const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
          const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [...inputs, output, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) });
          const timingsMs = [];
          // One warm-up and three separately completed samples; no batching
          // across SAM-sized dispatches that would hide a foreground stall.
          for (let sample = 0; sample < 4; sample++) {
            // No preceding dispatch or implementation may supply missing writes.
            device.queue.writeBuffer(output, 0, unwritten);
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(spec.queries, spec.heads, spec.domains); pass.end();
            const start = performance.now();
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            if (sample > 0) timingsMs.push(performance.now() - start);
          }
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(output, 0, readback, 0, output.size);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const values = new Float32Array(readback.getMappedRange().slice(0)); readback.unmap();
          const validation = await device.popErrorScope();
          if (validation) throw new Error(validation.message);
          return { values, timingsMs };
        };
        const before = await execute(baseline[spec.shader]);
        const after = await execute(candidate[spec.shader]);
        const oracle = attentionOracle(spec, fixture);
        const result = { spec, baseline: { values: Array.from(before.values), timingsMs: before.timingsMs }, candidate: { values: Array.from(after.values), timingsMs: after.timingsMs }, oracle: Array.from(oracle), baselineComparison: compareAttention(after.values, before.values), oracleComparison: compareAttention(after.values, oracle) };
        await record({ backend, result });
      } finally { for (const buffer of buffers) buffer.destroy(); }
    }
    return backend;
  } finally { device.destroy(); }
}
