// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebGpuInferenceRuntime, createWebGpuModelBufferBudget } from '../webgpu-inference-kit/src/core.js';

function fixture({ delayedMaps = false } = {}) {
  const f = { buffers: [], queries: [], fences: [], maps: [], submitError: null };
  const queue = {
    onSubmittedWorkDone: () => new Promise(resolve => f.fences.push(resolve)),
    submit() { if (f.submitError) throw f.submitError; },
  };
  const device = { queue, features: new Set(['timestamp-query']), limits: {},
    createQuerySet() {
      const query = { destroyed: false, destroy() { this.destroyed = true; } };
      f.queries.push(query); return query;
    },
    createBuffer(d) {
      const buffer = { ...d, destroyed: false,
        destroy() { this.destroyed = true; },
        mapAsync() { return delayedMaps ? new Promise(resolve => f.maps.push(resolve)) : Promise.resolve(); },
        getMappedRange() {
          const bytes = new ArrayBuffer(d.size), ns = new BigUint64Array(bytes);
          for (let i = 0; i + 1 < ns.length; i += 32) { ns[i] = 1_000_000n; ns[i + 1] = 3_000_000n; }
          return bytes;
        },
        unmap() {},
      };
      f.buffers.push(buffer); return buffer;
    },
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  };
  f.device = device;
  f.budget = maxBytes => createWebGpuModelBufferBudget({ device, maxBytes });
  f.runtime = bufferBudget => createWebGpuInferenceRuntime({ device, queue,
    routeId: 'timing-budget-test', adapterName: 'controlled timing fixture',
    gpuTiming: { capacity: 2 }, bufferBudget });
  f.retire = async budget => {
    const settling = budget.settleRetirements(); await Promise.resolve();
    assert.equal(f.fences.length, 1, 'one destruction batch awaits actual completion');
    f.fences.shift()(); await settling;
  };
  return f;
}
function submitted(runtime) {
  const token = runtime.gpuTimer.begin();
  runtime.gpuTimer.markSubmitted(token);
  return token;
}

test('runtime refuses timer resolve allocation before the device and cleans the query set', async () => {
  const f = fixture(), budget = f.budget(256);
  await assert.rejects(f.runtime(budget), e => e.name === 'WebGpuBufferBudgetError'
    && e.memoryBudget.label === 'kaminos.gpu-timing.resolve');
  assert.equal(f.buffers.length, 0);
  assert.equal(f.queries[0].destroyed, true);
  assert.equal(budget.snapshot().chargedBytes, 0);
});

test('refused readback keeps submitted timings retryable after caller retirement', async () => {
  const f = fixture(), budget = f.budget(768), runtime = await f.runtime(budget);
  assert.equal(budget.snapshot().chargedBytes, 512);
  const held = runtime.createManagedBuffer({ label: 'resident', size: 256, usage: 128 });
  const token = submitted(runtime);
  assert.throws(() => runtime.gpuTimer.flush(), e => e.name === 'WebGpuBufferBudgetError'
    && e.memoryBudget.label === 'kaminos.gpu-timing.readback');
  assert.equal(f.buffers.length, 2);
  assert.equal(runtime.profile.gpuTiming.pendingKernels, 1);
  held.destroy(); await f.retire(budget);
  await runtime.settleGpuTiming();
  assert.equal(token.status, 'resolved');
  assert.equal(token.ms, 2);
  assert.equal(budget.snapshot().chargedBytes, 768);
  await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 512);
  runtime.dispose(); await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 0);
});

test('copy submission failure retires its buffer without losing the submitted timing batch', async () => {
  const f = fixture(), budget = f.budget(768), runtime = await f.runtime(budget);
  const token = submitted(runtime), failure = new Error('copy submission failed');
  f.submitError = failure;
  assert.throws(() => runtime.gpuTimer.flush(), e => e === failure);
  assert.equal(f.buffers[1].destroyed, true);
  assert.equal(budget.snapshot().chargedBytes, 768);
  assert.equal(runtime.profile.gpuTiming.pendingKernels, 1);
  await f.retire(budget); f.submitError = null;
  await runtime.settleGpuTiming();
  assert.equal(token.status, 'resolved');
  await f.retire(budget); runtime.dispose(); await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 0);
});

test('timer readback keeps its charge through mapping and runtime disposal', async () => {
  const f = fixture({ delayedMaps: true }), budget = f.budget(768), runtime = await f.runtime(budget);
  const token = submitted(runtime); runtime.gpuTimer.flush();
  assert.equal(budget.snapshot().chargedBytes, 768);
  runtime.dispose();
  assert.equal(f.buffers[1].destroyed, false);
  await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 256);
  f.maps.shift()(); await runtime.settleGpuTiming();
  assert.equal(token.status, 'resolved');
  assert.equal(f.buffers[1].destroyed, true);
  assert.equal(budget.snapshot().chargedBytes, 256);
  await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 0);
});
