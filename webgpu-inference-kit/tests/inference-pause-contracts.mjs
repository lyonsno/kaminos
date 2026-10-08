import assert from 'node:assert/strict';
import test from 'node:test';
import * as kit from '../src/core.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const create = options => {
  assert.equal(typeof kit.createWebGpuInferenceControl, 'function', 'Kit must expose invocation pause control');
  return kit.createWebGpuInferenceControl(options);
};

test('pause drains admitted work; resume retains order and values; no normal fences', async () => {
  const first = deferred(), fence = deferred();
  let fences = 0;
  const control = create({ queue: { onSubmittedWorkDone() { fences++; return fence.promise; } } });
  const values = [];
  const a = control.runDuty(async () => { await first.promise; values.push(2); });
  const paused = control.pause();
  const b = control.runDuty(() => { values.push(values[0] * 3); });
  assert.equal(control.snapshot().status, 'pausing');
  assert.equal(fences, 0);
  first.resolve();
  await a;
  await tick();
  assert.equal(fences, 1);
  assert.deepEqual(values, [2]);
  assert.equal(control.snapshot().status, 'pausing');
  fence.resolve();
  assert.equal((await paused).status, 'paused');
  await tick();
  assert.deepEqual(values, [2]);
  await control.resume();
  await b;
  assert.deepEqual(values, [2, 6]);
  await control.runDuty(() => values.push(7));
  assert.equal(fences, 1);
  await control.close();
  await assert.rejects(control.runDuty(() => {}), /closed/);
});

test('parked foreground requests run and resume awaits their settlement', async () => {
  const queue = { submit() {}, async onSubmittedWorkDone() {} };
  const service = kit.createWebGpuForegroundService({ routeId: 'pause.test', device: { queue }, queue });
  const run = await service.beginRun('test');
  const control = create({ queue, withForeground: run.withForeground });
  await control.pause();
  const frame = deferred(), entered = deferred();
  const request = service.request({ requestId: 'frame', async run(ctx) {
    entered.resolve(); await frame.promise; ctx.submit([{}]);
  } });
  await entered.promise;
  const resumed = control.resume();
  let encoded = false;
  const duty = control.runDuty(() => { encoded = true; });
  await tick();
  assert.equal(encoded, false);
  assert.equal(control.snapshot().status, 'resuming');
  frame.resolve();
  await request.completion;
  await resumed;
  await duty;
  assert.equal(encoded, true);
  await control.close();
  await run.finish();
  await service.dispose();
});

test('Stop interrupts parked admission without Resume', async () => {
  const abort = new AbortController();
  const control = create({ signal: abort.signal, queue: { async onSubmittedWorkDone() {} } });
  await control.pause();
  let worked = false;
  const duty = control.runDuty(() => { worked = true; });
  const rejected = assert.rejects(duty, { name: 'AbortError' });
  abort.abort('stop');
  await rejected;
  await control.close();
  assert.equal(worked, false);
});

test('fence failure never announces paused or admits more model work', async () => {
  const failure = new Error('lost queue');
  const control = create({ queue: { async onSubmittedWorkDone() { throw failure; } } });
  await assert.rejects(control.pause(), error => error === failure);
  assert.equal(control.snapshot().status, 'failed');
  await assert.rejects(control.runDuty(() => assert.fail('admitted after failed fence')), error => error === failure);
  await assert.rejects(control.close(), error => error === failure);
});

test('Resume before drain completes cancels parking but waits for the drain', async () => {
  const fence = deferred();
  let windows = 0;
  const control = create({ queue: { onSubmittedWorkDone: () => fence.promise },
    withForeground: async (_phase, work) => { windows++; return work(); } });
  const pause = control.pause();
  await tick();
  const resume = control.resume();
  let worked = false;
  const duty = control.runDuty(() => { worked = true; });
  await tick();
  assert.equal(worked, false);
  fence.resolve();
  await Promise.all([pause, resume, duty]);
  assert.equal(windows, 0);
  assert.equal(worked, true);
  await control.close();
});

test('cooperative GPU and CPU duties share one admission control', async () => {
  let submissions = 0, cpu = 0;
  const queue = { submit() { submissions++; }, async onSubmittedWorkDone() {} };
  const control = create({ queue });
  const manifest = kit.defineWebGpuCooperativeBoundaryManifest({
    routeId: 'pause.test', manifestId: 'pause.test.boundaries', phases: [{ phaseId: 'work', boundaries: [
      { boundaryId: 'gpu', kind: 'gpu-command', commandDutyKind: 'compute', unit: 'item', totalItems: 1, progressWeight: 1,
        chunking: { mode: 'fixed', chunkItems: 1 } },
      { boundaryId: 'cpu', kind: 'cpu-work', hostPhase: 'presentation', unit: 'item', totalItems: 1, progressWeight: 1,
        chunking: { mode: 'fixed', chunkItems: 1 } },
    ] }],
  });
  const runtime = { routeId: 'pause.test', queue,
    async runInvocation({ invocationId }, fn) { return fn({ invocationId, async yieldToBrowser() {} }); },
    async prepareCommandDutyAtBoundary(value) { return value; },
  };
  await control.pause();
  const execution = kit.createWebGpuCooperativeExecution({ runtime, manifest, invocationId: 'whole', inferenceControl: control });
  const result = execution.run(async cooperative => {
    const gpu = cooperative.startBoundary('gpu');
    await gpu.runGpuDuty(gpu.nextRange(), { encode: () => ({}) });
    await control.pause();
    const cpuBoundary = cooperative.startBoundary('cpu');
    await cpuBoundary.runCpuDuty(cpuBoundary.nextRange(), { work() { cpu++; } });
  });
  await tick();
  assert.equal(submissions, 0);
  await control.resume();
  await tick();
  assert.equal(control.snapshot().status, 'paused');
  assert.equal(submissions, 1);
  assert.equal(cpu, 0);
  await control.resume();
  await result;
  assert.equal(cpu, 1);
  assert.equal(execution.finish().status, 'succeeded');
  await control.close();
});

test('phase programs park before both kernels and readbacks', async () => {
  const queue = { async onSubmittedWorkDone() {} };
  const control = create({ queue });
  const calls = [];
  const runtime = {
    // Request pause without awaiting it from inside the admitted duty.
    async runKernel() { calls.push('kernel'); void control.pause(); return {}; },
    async runStage(_name, fn) { calls.push('readback'); return fn({ async readTensor() { return [42]; } }); },
  };
  const program = { schema: kit.WEBGPU_PHASE_PROGRAM_SCHEMA, name: 'two-phases', phases: [
    { kind: 'kernel', name: 'compute', kernel: {} },
    { kind: 'readback', name: 'output', readbacks: [{ name: 'value', tensor: {}, options: {} }] },
  ] };
  const result = kit.runWebGpuPhaseProgram(program, { runtime, inferenceControl: control });
  await tick();
  assert.deepEqual(calls, ['kernel']);
  assert.equal(control.snapshot().status, 'paused');
  await control.resume();
  assert.deepEqual((await result).outputs, { value: [42] });
  await control.close();
});

test('pause fences submitted work even when a bounded duty returned before completion', async () => {
  const gpu = deferred();
  let fences = 0;
  const control = create({ queue: { onSubmittedWorkDone() { fences++; return gpu.promise; } } });
  await control.runDuty(() => 'submitted, not completed');
  const paused = control.pause();
  await tick();
  assert.equal(control.snapshot().status, 'pausing');
  assert.equal(fences, 1);
  gpu.resolve();
  await paused;
  assert.equal(control.snapshot().status, 'paused');
  await control.close();
});

test('close wakes parked callers and drains foreground cleanup', async () => {
  const cleanup = deferred();
  const control = create({ queue: { async onSubmittedWorkDone() {} },
    async withForeground(_phase, work) { await work(); await cleanup.promise; } });
  await control.pause();
  const blocked = assert.rejects(control.runDuty(() => assert.fail('closed admission')), /closed/);
  let closed = false;
  const closing = control.close().then(() => { closed = true; });
  await blocked;
  await tick();
  assert.equal(closed, false);
  cleanup.resolve();
  await closing;
  assert.equal(control.snapshot().status, 'closed');
});
