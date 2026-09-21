import { createWebGpuLinearShader } from '../src/core.js';

export async function runLinearKernelCases(baseline, onCase) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('native WebGPU adapter unavailable');
  const info = adapter.info;
  if (adapter.isFallbackAdapter || /swiftshader|software/i.test(`${info.vendor} ${info.description}`)) {
    throw new Error('software/fallback adapter rejected');
  }
  const device = await adapter.requestDevice();
  const backend = { vendor: info.vendor, architecture: info.architecture, device: info.device,
    description: info.description, isFallbackAdapter: adapter.isFallbackAdapter };
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const cases = [];
  try {
    for (const variant of ['sequential4', 'split4', 'split4-range']) {
      for (const transposed of variant === 'sequential4' ? [0] : [0, 1]) {
        for (const channels of variant === 'sequential4' ? [8, 1024] : [7, 8]) {
          const rows = 5, columns = channels === 1024 ? 17 : 257;
          const input = Float32Array.from({ length: rows * channels }, (_, i) => (i % 19 - 9) / 16);
          const bias = Float32Array.from({ length: columns }, (_, i) => (i % 7 - 3) / 8);
          const weightCount = channels * columns;
          // Normal binary16 values exactly representable in f32, including negative values.
          const halfBits = Uint16Array.from({ length: weightCount }, (_, i) =>
            ((i % 3 === 0 ? 1 : 0) << 15) | (10 << 10) | (i * 37 % 1024));
          const weights = Float32Array.from(halfBits, bits =>
            (bits & 0x8000 ? -1 : 1) * (1 + (bits & 1023) / 1024) * 2 ** -5);
          const packed = new Uint32Array(Math.ceil(weightCount / 2));
          for (let i = 0; i < weightCount; i += 2) packed[i / 2] = halfBits[i] | ((halfBits[i + 1] ?? 0) << 16);
          const range = variant === 'split4-range';
          const start = range ? 2 : 0, count = range ? 2 : rows;
          const groupSize = variant === 'sequential4' ? 64 : 256;
          const groups = Math.ceil(count * columns / groupSize);
          const groupsX = Math.min(2, groups), groupsY = Math.ceil(groups / groupsX);
          const uniform = new Uint32Array(variant === 'sequential4'
            ? [channels, columns, rows * columns, 0]
            : range ? [rows, channels, columns, start, count, groupsX, transposed, 0]
              : [rows, channels, columns, groupsX, transposed]);
          const sentinel = -12345;
          const expected = new Float32Array(rows * columns).fill(sentinel);
          for (let row = start; row < start + count; row += 1) {
            for (let col = 0; col < columns; col += 1) {
              const sums = [0, 0, 0, 0];
              let sequential = bias[col];
              for (let k = 0; k < channels; k += 1) {
                const weight = weights[transposed ? k * columns + col : col * channels + k];
                const product = Math.fround(input[row * channels + k] * weight);
                sequential = Math.fround(sequential + product);
                const lane = k < channels - channels % 4 ? k % 4 : 0;
                sums[lane] = Math.fround(sums[lane] + product);
              }
              expected[row * columns + col] = variant === 'sequential4' ? sequential
                : Math.fround(Math.fround(Math.fround(sums[0] + sums[1]) + Math.fround(sums[2] + sums[3])) + bias[col]);
            }
          }
          const original = variant === 'sequential4' ? baseline.sam.identity
            : range ? baseline.split4Range : baseline.split4;
          const arms = [];
          for (const arm of ['original', 'f32', 'f16-packed-u32']) {
            const code = arm === 'original' ? original : createWebGpuLinearShader({ variant, weightStorage: arm });
            const allocations = [];
            const allocate = (data, usage) => {
              const buffer = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
              allocations.push(buffer);
              new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
              buffer.unmap();
              return buffer;
            };
            device.pushErrorScope('validation');
            let actual;
            try {
              const inputBuffer = allocate(input, GPUBufferUsage.STORAGE);
              const weightBuffer = allocate(arm === 'f16-packed-u32' ? packed : weights, GPUBufferUsage.STORAGE);
              const biasBuffer = allocate(bias, GPUBufferUsage.STORAGE);
              const outputBuffer = allocate(new Float32Array(rows * columns).fill(sentinel), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
              const dims = allocate(uniform, GPUBufferUsage.UNIFORM);
              const staging = device.createBuffer({ size: expected.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
              allocations.push(staging);
              const module = device.createShaderModule({ code });
              const diagnostics = await module.getCompilationInfo();
              const failed = diagnostics.messages.filter(message => message.type === 'error');
              if (failed.length) throw new Error(failed.map(message => message.message).join('\n'));
              const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
              const resources = variant === 'sequential4' ? [inputBuffer, weightBuffer, biasBuffer, outputBuffer, dims]
                : [dims, inputBuffer, weightBuffer, biasBuffer, outputBuffer];
              const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
                entries: resources.map((buffer, binding) => ({ binding, resource: { buffer } })) });
              const encoder = device.createCommandEncoder();
              const pass = encoder.beginComputePass();
              pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
              pass.dispatchWorkgroups(groupsX, groupsY); pass.end();
              encoder.copyBufferToBuffer(outputBuffer, 0, staging, 0, expected.byteLength);
              device.queue.submit([encoder.finish()]);
              await staging.mapAsync(GPUMapMode.READ);
              actual = Array.from(new Float32Array(staging.getMappedRange()));
              staging.unmap();
            } finally {
              for (const buffer of allocations) buffer.destroy();
              const validation = await device.popErrorScope();
              if (validation) throw new Error(validation.message);
            }
            arms.push({ arm, output: actual, weightBytes: arm === 'f16-packed-u32' ? packed.byteLength : weights.byteLength });
          }
          const result = { variant, transposed, rows, columns, channels, start, count,
            input: Array.from(input), halfBits: Array.from(halfBits), bias: Array.from(bias),
            expected: Array.from(expected), arms };
          cases.push(result);
          await onCase({ backend, result });
        }
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return { backend, cases };
  } finally { device.destroy(); }
}
