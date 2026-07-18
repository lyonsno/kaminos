import assert from 'node:assert/strict';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  createLayeredStructuralHotWebGpuSidecar,
} from '../structural-material-3d-webgpu-hot-sidecar.js';

const previousUsage = globalThis.GPUBufferUsage;
const previousMapMode = globalThis.GPUMapMode;
globalThis.GPUBufferUsage = {
  STORAGE: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
  UNIFORM: 8,
  MAP_READ: 16,
};
globalThis.GPUMapMode = { READ: 1 };

const buffers = [];
let deviceDestroyCount = 0;
const queue = {
  writeBuffer() {},
  async onSubmittedWorkDone() {},
};
const device = {
  queue,
  createBuffer(descriptor) {
    const buffer = {
      descriptor,
      destroyCount: 0,
      destroy() {
        this.destroyCount += 1;
      },
    };
    buffers.push(buffer);
    return buffer;
  },
  createShaderModule() {
    return {};
  },
  async createComputePipelineAsync() {
    return { getBindGroupLayout() { return {}; } };
  },
  createBindGroup(descriptor) {
    return { descriptor };
  },
  destroy() {
    deviceDestroyCount += 1;
  },
};

try {
  const state = createLayeredStructuralMaterial({ columns: 5, rows: 4, layers: 2, notch: true });
  const sidecar = await createLayeredStructuralHotWebGpuSidecar({
    state,
    device,
    adapterIdentity: { vendor: 'borrowed-test-device' },
  });

  assert.equal(sidecar.initializationLifecycle.adapterRequestCount, 0);
  assert.equal(sidecar.initializationLifecycle.deviceRequestCount, 0);
  assert.equal(sidecar.initializationLifecycle.deviceOwnership, 'borrowed');

  const descriptor = sidecar.residentDescriptor();
  assert.equal(descriptor.schema, 'kaminos.structural-material.webgpu-resident-buffers.v0');
  assert.equal(descriptor.routeIdentity, STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE);
  assert.equal(descriptor.deviceOwnership, 'borrowed');
  assert.equal(descriptor.device, device);
  assert.equal(descriptor.queue, queue);
  assert.equal(descriptor.nodeCount, state.nodes.length);
  assert.equal(descriptor.bondCount, state.bonds.length);
  assert.equal(descriptor.nodeStrideBytes, 32);
  assert.equal(descriptor.bondStrideBytes, 80);
  assert.ok(descriptor.nodeBuffer);
  assert.ok(descriptor.bondBuffer);
  assert.ok(descriptor.componentLabelBuffer);
  assert.equal(descriptor.generation, 1);
  assert.equal(descriptor.disposed, false);

  const encodedPasses = [];
  const encoder = {
    beginComputePass({ label }) {
      const pass = {
        label,
        dispatches: 0,
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() { this.dispatches += 1; },
        end() { encodedPasses.push(this); },
      };
      return pass;
    },
  };
  const residentExecution = sidecar.encodeResidentInteraction(encoder, {
    point: { x: 0.86, y: 0.5, z: 0.5 },
    vector: { x: 1, y: 0, z: 0.25 },
    magnitude: 0.72,
    radius: 0.24,
  });
  assert.equal(residentExecution.readbackCount, 0);
  assert.equal(residentExecution.eventEpoch, 1);
  assert.equal(encodedPasses.length, 1 + state.nodes.length);
  assert.equal(sidecar.snapshot().lifecycle.compactReadbackCount, 0);

  const disposal = await sidecar.dispose();
  assert.equal(disposal.status, 'passed');
  assert.equal(disposal.lifecycle.deviceOwnership, 'borrowed');
  assert.equal(disposal.lifecycle.deviceDestroyCount, 0);
  assert.equal(deviceDestroyCount, 0, 'disposing structural resources cannot destroy a borrowed Pyro device');
  assert.ok(buffers.every(buffer => buffer.destroyCount === 1), 'the sidecar still destroys every buffer it owns');
  assert.throws(() => sidecar.residentDescriptor(), /disposed/i, 'disposed resident buffers cannot remain composable');
} finally {
  if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousUsage;
  if (previousMapMode === undefined) delete globalThis.GPUMapMode;
  else globalThis.GPUMapMode = previousMapMode;
}

console.log('structural material borrowed-device contracts: ok');
