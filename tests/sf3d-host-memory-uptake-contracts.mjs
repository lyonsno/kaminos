import assert from 'node:assert/strict';
import * as composition from '../sf3d-live-flame-inject.mjs';
const {acquireSharedGpuDevice, snapshotSf3dHostMemory} = composition;

assert.equal(typeof acquireSharedGpuDevice, 'function', 'ordinary SF3D declares acquisition instrumentation');
let allocations = 0;
const device = {
  queue: {submit() {}},
  createBuffer(descriptor) { allocations++; return {size: descriptor.size, destroy() {}}; },
  destroy() {},
};
const descriptor = {requiredFeatures: [], requiredLimits: {maxBufferSize: 905969664}};
let received;
const adapter = {async requestDevice(value) {received = value; return device;}};
assert.equal(await acquireSharedGpuDevice(adapter, descriptor), device);
assert.equal(received, descriptor, 'preserve composed host descriptor');
const buffer = device.createBuffer({size: 32, label: 'actual-host-baseline'});
const held = snapshotSf3dHostMemory(device);
assert.equal(allocations, 1);
assert.equal(held.authority, 'observation-only');
assert.equal(held.budget.deviceAcquisition, 'requested-through-budget');
assert.equal(held.budget.gpu.liveBytes, 32);
assert.equal(held.budget.gpu.maxBytes, Number.MAX_SAFE_INTEGER, 'no invented production allowance below system arithmetic capacity');
assert.equal(held.budget.total.maxBytes, Number.MAX_SAFE_INTEGER);
assert.equal(held.budget.gpu.physicalMemoryMeasured, false);
buffer.destroy();
assert.equal(snapshotSf3dHostMemory(device).budget.gpu.liveBytes, 0);
assert.equal(snapshotSf3dHostMemory({}).authority, 'unverified');
device.destroy();
console.log('Ordinary SF3D uses its bundled acquisition ledger before host allocations, without physical-fit authority');
