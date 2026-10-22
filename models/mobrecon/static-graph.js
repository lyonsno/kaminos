// Static WebGPU graph builder shared by the MobRecon and hand-detector ports:
// fixed shapes, so every buffer, uniform and bind group is created once and a
// run replays the recorded dispatches in one compute pass. Activations are
// views ({ buffer, offset, shape }) with element offsets, so concatenations
// are channel slices of one buffer. Matrix products and convolutions use the
// inference kit's tiled GEMM.
import { createWebGpuTiledGemmShader, TILED_GEMM_PARAMS_WORDS } from '../../webgpu-inference-kit/src/tiled-gemm-kernel.js';

const U = globalThis.GPUBufferUsage ?? { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
export const product = shape => shape.reduce((a, b) => a * b, 1);

// tensors: model-resource lease tensors by name ({ buffer, bufferOffset, byteLength, shape }).
export function createStaticGraph({ device, tensors, label, missing = name => `missing ${label} tensor ${name}` }) {
  if (!device?.createBuffer) throw new TypeError('GPUDevice required');
  const owned = [], steps = [], named = new Map(), pipelines = new Map();
  const weight = name => {
    const tensor = tensors[name];
    if (!tensor) throw new Error(missing(name));
    return tensor;
  };
  const weightResource = t => ({ buffer: t.buffer, offset: t.bufferOffset, size: t.byteLength });
  const buffer = (bytes, usage, tag) => {
    const b = device.createBuffer({ label: `${label}:${tag}`, size: Math.max(16, bytes), usage });
    owned.push(b);
    return b;
  };
  const alloc = (shape, tag) => ({ buffer: buffer(product(shape) * 4, U.STORAGE | U.COPY_SRC | U.COPY_DST, tag), offset: 0, shape });
  const slice = (view, start, count) => {
    const inner = product(view.shape.slice(1));
    if (start + count > view.shape[0]) throw new RangeError(`slice ${start}+${count} exceeds ${view.shape[0]}`);
    return { buffer: view.buffer, offset: view.offset + start * inner, shape: [count, ...view.shape.slice(1)] };
  };
  const name = (key, view) => { named.set(key, view); return view; };
  const whole = view => ({ buffer: view.buffer });
  const dummy = buffer(16, U.STORAGE, 'unused');

  const pipeline = (key, code) => {
    if (!pipelines.has(key)) {
      pipelines.set(key, device.createComputePipeline({ label: `${label}:${key.slice(0, 120)}`, layout: 'auto',
        compute: { module: device.createShaderModule({ label: `${label}:${key.slice(0, 120)}`, code }), entryPoint: 'main' } }));
    }
    return pipelines.get(key);
  };
  const uniform = (words, tag, floats = {}) => {
    const data = new Uint32Array(Math.max(4, Math.ceil(words.length / 4) * 4));
    words.forEach((value, i) => { data[i] = value; });
    const asFloat = new Float32Array(data.buffer);
    for (const [i, value] of Object.entries(floats)) asFloat[i] = value;
    const b = buffer(data.byteLength, U.UNIFORM | U.COPY_DST, `${tag}:params`);
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const record = (key, code, resources, workgroups, tag) => {
    const p = pipeline(key, code);
    const bindGroup = device.createBindGroup({ label: `${label}:${tag}`, layout: p.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })) });
    steps.push({ pipeline: p, bindGroup, workgroups, label: tag });
  };
  const grid1 = n => { const groups = Math.ceil(n / 256); return [Math.min(groups, 65535), Math.ceil(groups / 65535), 1]; };

  // C[m, n] = act(sum_k A[m, k] B[k, n] + biasM[m]) with an optional residual
  // (before or after the activation; from its own view, or from another region
  // of the output buffer). Operands carry element offsets and strides.
  function gemm({ M, N, K, a, b, c, biasM = null, residual = null, residualAfterActivation = false, activation = null,
    conv = null, pad = 0, bNContiguous = true, tile = { tm: 2, tn: 2, bk: 16 }, tag }) {
    const inOutput = Boolean(residual) && residual.buffer === c.buffer;
    if (residual && !inOutput && residual.offset !== c.offset) throw new Error(`${tag}: residual and output offsets differ`);
    const layout = { tile, biasM: Boolean(biasM), residual: Boolean(residual), bNContiguous,
      residualAfterActivation: Boolean(residual) && residualAfterActivation, residualInOutput: inOutput, activation, conv };
    const key = `gemm:${JSON.stringify(layout)}`;
    const params = new Uint32Array(TILED_GEMM_PARAMS_WORDS);
    params.set([M, N, K, 0, a.offset, a.sm, a.sk, 0, b.offset, b.sk, b.sn, b.sb ?? 0, c.offset, c.sm, c.sn, 0,
      pad, pad, 0, inOutput ? residual.offset : 0]);
    const resources = [a.resource, b.resource];
    if (biasM) resources.push(biasM);
    if (residual && !inOutput) resources.push(whole(residual));
    resources.push(whole(c), { buffer: uniform([...params], tag, { 3: 1 }) });
    const bm = 16 * tile.tm, bn = 16 * tile.tn;
    record(key, createWebGpuTiledGemmShader(layout), resources, [Math.ceil(N / bn), Math.ceil(M / bm), 1], tag);
  }

  return {
    device, steps, named, owned, weight, weightResource, alloc, slice, name, whole, dummy, uniform, record, grid1, gemm,
    encode(pass) {
      for (const step of steps) {
        pass.setPipeline(step.pipeline);
        pass.setBindGroup(0, step.bindGroup);
        pass.dispatchWorkgroups(...step.workgroups);
      }
    },
    readback(encoder, view, tag) {
      const bytes = product(view.shape) * 4;
      const staging = device.createBuffer({ label: `${label}:read:${tag}`, size: bytes, usage: U.MAP_READ | U.COPY_DST });
      encoder.copyBufferToBuffer(view.buffer, view.offset * 4, staging, 0, bytes);
      return staging;
    },
    dispose() { for (const b of owned) b.destroy(); },
  };
}

// Reads named views (or the given extra ones) after encoding `encodeWork`.
export async function runAndRead(graph, encodeWork, reads) {
  const encoder = graph.device.createCommandEncoder();
  encodeWork(encoder);
  const staged = reads.map(([key, view]) => [key, graph.readback(encoder, view, key), view.shape]);
  graph.device.queue.submit([encoder.finish()]);
  const out = {};
  for (const [key, staging, shape] of staged) {
    await staging.mapAsync(1);
    out[key] = { shape, data: new Float32Array(staging.getMappedRange().slice(0)) };
    staging.unmap();
    staging.destroy();
  }
  return out;
}
