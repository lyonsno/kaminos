import { readFile } from 'node:fs/promises';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

// CPU command-encoding witness only. This spy does not execute WGSL or claim
// numerical/GPU parity. The real factory, step, and readback paths run unchanged.
export async function solverSpy(options = {}) {
  const dispatches = [], copies = [], maps = [], writes = [], computePasses = [];
  const gpuFlags = new Proxy({}, { get: () => 1 });
  const previous = new Map(['GPUBufferUsage', 'GPUShaderStage', 'GPUTextureUsage',
    'GPUMapMode', 'navigator', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const set = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
  for (const key of ['GPUBufferUsage', 'GPUShaderStage', 'GPUTextureUsage', 'GPUMapMode']) set(key, gpuFlags);
  set('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  set('fetch', async url => {
    const data = await readFile(new URL(`../${url}`, import.meta.url));
    return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  const restore = () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  const device = {
    features: { has: feature => feature === 'timestamp-query' },
    limits: { maxStorageBuffersPerShaderStage: 10, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 },
    lost: new Promise(() => {}),
    createBuffer: ({ label, size }) => ({
      label, size, mapState: 'unmapped', destroy() {},
      async mapAsync() { maps.push(label); throw new Error('intentional readback rejection'); },
    }),
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createComputePipelineAsync: async descriptor => descriptor,
    createRenderPipelineAsync: async descriptor => ({ ...descriptor, getBindGroupLayout: () => ({}) }),
    createSampler: () => ({}),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createCommandEncoder: () => ({
      beginComputePass: descriptor => {
        let pipeline;
        const computePass = { label: descriptor.label, timestampWrites: descriptor.timestampWrites, dispatches: [] };
        computePasses.push(computePass);
        return {
          setPipeline(value) { pipeline = value; },
          setBindGroup() {},
          dispatchWorkgroups(...groups) {
            const dispatch = { entry: pipeline.compute.entryPoint, groups };
            dispatches.push(dispatch);
            computePass.dispatches.push(dispatch);
          },
          end() {},
        };
      },
      copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { copies.push({ source: source.label, target: target.label, size }); },
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data) {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        writes.push({ buffer: buffer.label, offset, bytes: [...bytes] });
      },
      writeTexture() {}, submit() {},
    },
  };
  try {
    const solver = await createWebGPUFingerFluidSolver({
      canvas: { getContext: () => ({ configure() {} }) },
      webgpuDevice: device, particleCount: 1024, ...options,
    });
    if (!solver.available) throw new Error(`solver unavailable: ${JSON.stringify(solver)}`);
    writes.length = 0;
    return { solver, dispatches, copies, maps, writes, computePasses, close() { solver.destroy(); restore(); } };
  } catch (error) { restore(); throw error; }
}
