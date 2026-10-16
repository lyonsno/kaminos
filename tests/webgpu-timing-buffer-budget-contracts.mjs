// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebGpuInferenceRuntime, createWebGpuModelBufferBudget } from '../webgpu-inference-kit/src/core.js';

function fixture({ delayedMaps = false } = {}) {
  const f = { buffers: [], queries: [], fences: [], maps: [], submitError: null };
  const queue = {
    onSubmittedWorkDone: () => new Promise(resolve => f.fences.push(resolve)),
    submit(commands) {
      if (f.submitError) throw f.submitError;
      for (const command of commands) for (const [source, sourceOffset, target, targetOffset, size] of command.copies) {
        new Uint8Array(target.bytes, targetOffset, size).set(new Uint8Array(source.bytes, sourceOffset, size));
      }
    },
  };
  const device = { queue, features: new Set(['timestamp-query']), limits: {},
    createQuerySet() {
      const query = { destroyed: false, destroy() { this.destroyed = true; } };
      f.queries.push(query); return query;
    },
    createBuffer(d) {
      const bytes = new ArrayBuffer(d.size);
      if (d.label === 'kaminos.gpu-timing.resolve') {
        const ns = new BigUint64Array(bytes);
        for (let i = 0; i + 1 < ns.length; i += 32) { ns[i] = 1_000_000n; ns[i + 1] = 3_000_000n; }
      }
      const buffer = { ...d, bytes, destroyed: false,
        destroy() { this.destroyed = true; },
        mapAsync() { return delayedMaps ? new Promise(resolve => f.maps.push(resolve)) : Promise.resolve(); },
        getMappedRange: () => bytes,
        unmap() {},
      };
      f.buffers.push(buffer); return buffer;
    },
    createCommandEncoder() {
      const copies = [];
      return { copyBufferToBuffer: (...args) => copies.push(args), finish: () => ({ copies }) };
    },
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

test('readTensor retires its unsubmitted staging after timing refusal so the same allowance can retry', async () => {
  const f = fixture(), budget = f.budget(1280), runtime = await f.runtime(budget);
  const output = runtime.createTensor({ name: 'out', dtype: 'u32', shape: [64], usage: 132 });
  const expected = Uint32Array.from({ length: 64 }, (_, i) => i + 7);
  new Uint32Array(output.buffer.bytes).set(expected);
  const held = runtime.createManagedBuffer({ label: 'caller-held', size: 256, usage: 128 });
  const token = submitted(runtime);
  assert.equal(budget.snapshot().chargedBytes, 1024);

  await assert.rejects(runtime.readTensor(output), error => error.name === 'WebGpuBufferBudgetError'
    && error.memoryBudget.label === 'kaminos.gpu-timing.readback');
  const failedStaging = f.buffers.filter(buffer => buffer.label === 'out.readback');
  assert.equal(failedStaging.length, 1);
  assert.equal(failedStaging[0].destroyed, true, 'failed public readback must not strand its private staging');
  assert.equal(budget.snapshot().chargedBytes, 1280, 'charge remains until completion');
  assert.equal(budget.snapshot().pendingRetirementBytes, 256);
  assert.equal(token.status, 'pending', 'submitted timings stay available for retry');
  await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 1024);
  held.destroy(); await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 768);

  const result = await runtime.readTensor(output);
  await runtime.settleGpuTiming();
  assert.deepEqual(new Uint32Array(result), expected);
  assert.equal(token.status, 'resolved');
  assert.equal(budget.snapshot().peakChargedBytes, 1280);
  assert.equal(f.buffers.filter(buffer => buffer.label === 'out.readback' && !buffer.destroyed).length, 1);
  await f.retire(budget);
  runtime.dispose(); await f.retire(budget);
  assert.equal(budget.snapshot().chargedBytes, 0);
});
