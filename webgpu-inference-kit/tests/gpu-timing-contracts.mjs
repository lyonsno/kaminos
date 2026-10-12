import assert from 'node:assert/strict';

import { createWebGpuInferenceRuntime } from '../src/index.js';

// Minimal GPU simulator: buffers have byte backing, query sets hold u64 nanoseconds, and submitted
// command buffers replay their recorded commands in queue order. Each timed pass advances the clock by
// the next scripted duration so tests can assert the exact per-kernel GPU time the runtime reports.
// lateTimingMaps: timing readbacks resolve a macrotask late, which WebGPU allows (map order across buffers is unspecified).
function createSimulatedDevice({ features = ['timestamp-query'], durationsMs = [], corrupt = new Set(), lateTimingMaps = false } = {}) {
  let clockNs = 1_000_000n;
  let passIndex = 0;
  const log = { passes: [], submits: [], querySets: [] };
  const queue = {
    writeBuffer() {},
    async onSubmittedWorkDone() {},
    submit(commandBuffers) {
      for (const commandBuffer of commandBuffers) {
        log.submits.push(commandBuffer.commands.map(command => command.op));
        for (const command of commandBuffer.commands) command.run();
      }
    },
  };
  const device = {
    label: 'gpu-timing-sim',
    features: new Set(features),
    limits: { maxComputeWorkgroupsPerDimension: 65535, maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 1 << 29 },
    queue,
    createShaderModule: descriptor => ({ descriptor }),
    createComputePipeline: descriptor => ({ descriptor }),
    createQuerySet(descriptor) {
      const querySet = { descriptor, values: new BigUint64Array(descriptor.count), destroyed: false, destroy() { this.destroyed = true; } };
      log.querySets.push(querySet);
      return querySet;
    },
    createBuffer(descriptor) {
      const bytes = new Uint8Array(descriptor.size);
      return {
        descriptor, bytes, size: descriptor.size, usage: descriptor.usage,
        mapAsync() {
          return lateTimingMaps && descriptor.label === 'kaminos.gpu-timing.readback' ? new Promise(resolve => setTimeout(resolve, 5)) : Promise.resolve();
        },
        getMappedRange(offset = 0, size = descriptor.size - offset) { return bytes.slice(offset, offset + size).buffer; },
        unmap() {},
        destroy() {},
      };
    },
    createCommandEncoder() {
      const commands = [];
      return {
        beginComputePass(descriptor = {}) {
          log.passes.push(descriptor);
          return {
            setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {},
            end() {
              const writes = descriptor.timestampWrites;
              if (!writes) return;
              const index = passIndex++;
              commands.push({ op: 'pass', run() {
                const durationNs = BigInt(Math.round((durationsMs[index] ?? 1) * 1e6));
                writes.querySet.values[writes.beginningOfPassWriteIndex] = clockNs;
                clockNs += durationNs;
                writes.querySet.values[writes.endOfPassWriteIndex] = corrupt.has(index) ? 0n : clockNs;
              } });
            },
          };
        },
        resolveQuerySet(querySet, first, count, destination, destinationOffset) {
          assert.equal(destinationOffset % 256, 0, 'resolveQuerySet destinationOffset must be 256-aligned');
          commands.push({ op: 'resolve', run() {
            new BigUint64Array(destination.bytes.buffer, destinationOffset, count).set(querySet.values.subarray(first, first + count));
          } });
        },
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
          commands.push({ op: 'copy', run() {
            destination.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + size), destinationOffset);
          } });
        },
        finish() { return { commands }; },
      };
    },
  };
  return { device, queue, log };
}

async function runKernels(sim, count, runtimeOptions = {}, kernelOptions = {}) {
  const runtime = await createWebGpuInferenceRuntime({
    routeId: 'gpu-timing-contract', adapterName: 'sim', device: sim.device, queue: sim.queue,
    kernel: { name: 'gpu-timing-contract', revision: 'test', profile: 'gpu-timing-contract' },
    requiredStages: Array.from({ length: count }, (_, i) => `stage-${i}`), ...runtimeOptions,
  });
  const kernel = { name: 'k', pipeline: {}, bindGroup: {}, bindings: [] };
  for (let i = 0; i < count; i++) await runtime.runKernel(kernel, { stage: `stage-${i}`, dispatch: [1], ...kernelOptions });
  return runtime;
}

// Each stage reports its own kernel's GPU time once settled; pending timings stay visibly pending first.
{
  const sim = createSimulatedDevice({ durationsMs: [1.5, 2.25, 0.5] });
  const runtime = await runKernels(sim, 3);
  assert.deepEqual(runtime.profile.stages.map(stage => stage.gpuStatus), ['pending', 'pending', 'pending']);
  assert.equal(runtime.profile.gpuTiming.pendingKernels, 3);
  assert.equal(runtime.profile.gpuTiming.authority, 'gpu-timestamp-query');
  assert.equal(runtime.profile.gpuTiming.status, 'active');
  const indices = sim.log.passes.flatMap(pass => [pass.timestampWrites.beginningOfPassWriteIndex, pass.timestampWrites.endOfPassWriteIndex]);
  assert.equal(new Set(indices).size, 6, 'each pass writes its own query pair');

  await runtime.settleGpuTiming();
  assert.deepEqual(runtime.profile.stages.map(stage => stage.gpuMs), [1.5, 2.25, 0.5]);
  assert.deepEqual(runtime.profile.stages.map(stage => stage.gpuStatus), ['resolved', 'resolved', 'resolved']);
  assert.equal(runtime.profile.gpuTiming.resolvedKernels, 3);
  assert.equal(runtime.profile.gpuTiming.pendingKernels, 0);
  assert.equal(runtime.profile.gpuTiming.totalGpuMs, 4.25);
  assert.equal(runtime.finishProfile().profile.gpuTiming.totalGpuMs, 4.25, 'finished profile carries the GPU timing summary');
  assert.equal(runtime.finishProfile().profile.timingSource, 'host-stage-timer', 'wall-clock stays the profile timing source');
  runtime.dispose();
  assert.equal(sim.log.querySets[0].destroyed, true, 'dispose releases the query set');
}

// More kernels than ring slots: slots are reused only after their results were copied out.
{
  const durations = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
  const sim = createSimulatedDevice({ durationsMs: durations });
  const runtime = await runKernels(sim, durations.length, { gpuTiming: { capacity: 2 } });
  await runtime.settleGpuTiming();
  assert.deepEqual(runtime.profile.stages.map(stage => stage.gpuMs), durations);
  assert.equal(sim.log.querySets[0].descriptor.count, 4);
}

// A pass whose end timestamp never landed must not masquerade as a fast kernel.
{
  const sim = createSimulatedDevice({ durationsMs: [1, 2], corrupt: new Set([1]) });
  const runtime = await runKernels(sim, 2);
  await runtime.settleGpuTiming();
  assert.deepEqual(runtime.profile.stages.map(stage => stage.gpuStatus), ['resolved', 'invalid']);
  assert.equal(runtime.profile.stages[1].gpuMs, null);
  assert.equal(runtime.profile.gpuTiming.invalidKernels, 1);
  assert.equal(runtime.profile.gpuTiming.totalGpuMs, 1);
}

// Without the device feature the runtime reports unavailable timing and encodes no timestamp writes.
{
  const sim = createSimulatedDevice({ features: [] });
  const runtime = await runKernels(sim, 2);
  await runtime.settleGpuTiming();
  assert.equal(runtime.profile.gpuTiming.status, 'unavailable');
  assert.equal(sim.log.passes.some(pass => pass.timestampWrites), false);
  assert.equal(runtime.profile.stages.some(stage => 'gpuMs' in stage), false);
}

// Callers can switch timing off even when the device supports it.
{
  const sim = createSimulatedDevice();
  const runtime = await runKernels(sim, 1, { gpuTiming: false });
  assert.equal(runtime.profile.gpuTiming.status, 'disabled');
  assert.equal(sim.log.passes.some(pass => pass.timestampWrites), false);
  assert.equal(sim.log.querySets.length, 0);
}

// An unsubmitted command buffer may never run, so it carries no timing slot.
{
  const sim = createSimulatedDevice();
  const runtime = await runKernels(sim, 1, {}, { submit: false });
  assert.equal(sim.log.passes.some(pass => pass.timestampWrites), false);
  assert.equal(runtime.profile.gpuTiming.pendingKernels, 0);
}

// Tensor readback flushes outstanding timings ahead of its own copy, so they resolve alongside it.
{
  const sim = createSimulatedDevice({ durationsMs: [3] });
  const runtime = await runKernels(sim, 1);
  const tensor = runtime.createTensor({ name: 't', shape: [4], dtype: 'f32' });
  await runtime.readTensor(tensor);
  const kinds = sim.log.submits.map(ops => ops.join('+'));
  assert.deepEqual(kinds, ['pass+resolve', 'copy', 'copy'], 'timing copy is submitted before the readback copy');
  await runtime.settleGpuTiming();
  assert.equal(runtime.profile.stages[0].gpuMs, 3);
}

console.log('gpu timing contracts passed');

// A phase program that reads back settles kernel timings before returning, so receipts built from
// runtime.profile right after the run carry resolved GPU times rather than pending placeholders.
{
  const sim = createSimulatedDevice({ durationsMs: [2.5], lateTimingMaps: true });
  const runtime = await createWebGpuInferenceRuntime({
    routeId: 'gpu-timing-contract', adapterName: 'sim', device: sim.device, queue: sim.queue,
    kernel: { name: 'gpu-timing-contract', revision: 'test', profile: 'gpu-timing-contract' },
  });
  const tensor = runtime.createTensor({ name: 'out', shape: [4], dtype: 'f32' });
  const program = runtime.defineProgram({
    name: 'timed-program',
    tensors: { out: tensor },
    phases: [
      { name: 'compute', kernel: { name: 'k', pipeline: {}, bindGroup: {}, bindings: [] }, dispatch: [1] },
      { name: 'read', readbacks: [{ name: 'out', tensor: 'out' }] },
    ],
  });
  await runtime.runProgram(program);
  const compute = runtime.profile.stages.find(stage => stage.name === 'compute');
  assert.equal(compute.gpuStatus, 'resolved');
  assert.equal(compute.gpuMs, 2.5);
}

console.log('gpu timing program contracts passed');
