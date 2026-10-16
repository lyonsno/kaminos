// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { KleinDutyScheduler } from '../models/flux2-klein/klein-duties.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const events = [];
  const fences = [];
  let next = 0;
  const device = {
    createCommandEncoder() {
      const id = ++next;
      return { finish: () => ({ id }) };
    },
    queue: {
      submit(commands) { events.push(['submit', commands[0].id]); },
      onSubmittedWorkDone() { return fences.shift()?.promise ?? Promise.resolve(); },
    },
  };
  const descriptors = [];
  const runtime = {
    async prepareCommandDutyAtBoundary(input, invocation) {
      events.push(['foreground', input.phase, invocation.invocationId]);
      descriptors.push(input);
      return { ...input, dutyId: `duty-${descriptors.length}` };
    },
    settleCommandDuty(descriptor, result) { events.push(['settle', descriptor.dutyId, result.status]); },
  };
  const invocation = { invocationId: 'test-run' };
  return { device, runtime, invocation, descriptors, events, fences };
}

function tracked() {
  return { destroyed: 0, destroy() { this.destroyed += 1; } };
}

test('a shared scheduler records the actual consumer model in its command duties', async () => {
  const f = fixture();
  const scheduler = new KleinDutyScheduler(f.device, { model: 'unimate', label: 'motion' });
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, targetDutyMs: 0, dutyFlops: 10 });
  scheduler.encoder();
  scheduler.addFlops(10);
  await scheduler.flush('motion-forward');
  assert.equal(f.descriptors[0].metadata.model, 'unimate');
  assert.equal(f.descriptors[0].metadata.estimatedFlops, 10);
});

test('plain execution keeps work together until the producer forces a boundary', async () => {
  const f = fixture();
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.encoder();
  scheduler.addFlops(100);
  await scheduler.boundary('operator');
  assert.deepEqual(f.events, []);
  await scheduler.boundary('model-boundary', { force: true });
  assert.deepEqual(f.events, [['submit', 1]]);
  await scheduler.flush();
  assert.equal(scheduler.stats.duties, 0);
});

test('the control and foreground boundary admit work before it is submitted', async () => {
  const f = fixture();
  const gate = deferred();
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, control: {
    async runDuty(work) { f.events.push(['control']); await gate.promise; await work(); },
  } });
  scheduler.encoder();
  const flushing = scheduler.flush('forward');
  assert.deepEqual(f.events, [['control']]);
  gate.resolve();
  await flushing;
  assert.deepEqual(f.events.map(x => x[0]), ['control', 'foreground', 'settle', 'submit']);
});

test('submitted transient buffers retire only after their queue fence', async () => {
  const f = fixture();
  const fence = deferred();
  f.fences.push(fence);
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation });
  const buffer = scheduler.track(tracked());
  scheduler.encoder();
  await scheduler.submitDuty('forward');
  assert.equal(buffer.destroyed, 0);
  fence.resolve();
  await scheduler.flush();
  assert.equal(buffer.destroyed, 1);
});

test('a rejected control gate releases work that was never submitted', async () => {
  const f = fixture();
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, control: {
    async runDuty() { throw new Error('stopped at control gate'); },
  } });
  const buffer = scheduler.track(tracked());
  scheduler.encoder();
  await assert.rejects(scheduler.flush(), /stopped at control gate/);
  await scheduler.discard();
  assert.equal(f.events.filter(x => x[0] === 'submit').length, 0);
  assert.equal(buffer.destroyed, 1);
});

test('changing schedules cannot detach a still-running duty from its original consumer', async () => {
  const f = fixture();
  const fence = deferred();
  f.fences.push(fence);
  const scheduler = new KleinDutyScheduler(f.device);
  const rows = [];
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, onDuty: row => rows.push(row) });
  scheduler.encoder();
  await scheduler.submitDuty('first-model');
  assert.throws(() => scheduler.setSchedule(null), /flush|in.flight|pending/);
  fence.resolve();
  await scheduler.flush();
  assert.equal(rows.length, 1);
  scheduler.setSchedule(null);
  assert.equal(scheduler.cooperative, false);
});

test('Stop before a boundary submits no model work and discard releases its transients', async () => {
  const f = fixture();
  const controller = new AbortController();
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, signal: controller.signal });
  const buffer = scheduler.track(tracked());
  scheduler.encoder();
  controller.abort('operator Stop');
  await assert.rejects(scheduler.flush(), error => error.name === 'AbortError');
  await scheduler.discard();
  assert.deepEqual(f.events, []);
  assert.equal(buffer.destroyed, 1);
});

test('adaptive FLOP budgets retain the established drop, growth and queue-depth behavior', () => {
  const f = fixture();
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, targetDutyMs: 10,
    dutyFlops: 100, dutyFlopsBounds: [10, 1000], growthLimit: 1.5 });
  assert.equal(scheduler.budget(), 100);
  scheduler.observe(100, 20);
  assert.equal(scheduler.budget(), 50);
  scheduler.observe(100, 5);
  assert.equal(scheduler.budget(), 75);
  scheduler.observe(100, 40, 1);
  assert.equal(scheduler.budget(), 50);
});

test('the configured in-flight depth applies before admitting the next command duty', async () => {
  const f = fixture();
  const first = deferred();
  f.fences.push(first);
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, maxInFlight: 1 });
  scheduler.encoder();
  await scheduler.submitDuty('first');
  scheduler.encoder();
  const next = scheduler.submitDuty('second');
  assert.equal(f.descriptors.length, 1);
  assert.throws(() => scheduler.setSchedule(null), /pending/);
  first.resolve();
  await next;
  await scheduler.flush();
  assert.deepEqual(f.descriptors.map(x => x.phase), ['first', 'second']);
  assert.deepEqual(f.events.filter(x => x[0] === 'submit'), [['submit', 1], ['submit', 2]]);
});

test('a control failure after submission retains buffers until the submitted work settles', async () => {
  const f = fixture();
  const fence = deferred();
  f.fences.push(fence);
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation, control: {
    async runDuty(work) { await work(); throw new Error('control completion failed'); },
  } });
  const buffer = scheduler.track(tracked());
  scheduler.encoder();
  await assert.rejects(scheduler.flush(), /control completion failed/);
  assert.equal(buffer.destroyed, 0);
  fence.resolve();
  await scheduler.discard();
  assert.equal(buffer.destroyed, 1);
  assert.equal(scheduler.stats.submits, 1);
});

test('queue failure remains observable and releases submitted transients', async () => {
  const f = fixture();
  const fence = deferred();
  f.fences.push(fence);
  const scheduler = new KleinDutyScheduler(f.device);
  scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation });
  const buffer = scheduler.track(tracked());
  scheduler.encoder();
  await scheduler.submitDuty('forward');
  fence.reject(new Error('device lost'));
  await assert.rejects(scheduler.flush(), /device lost/);
  assert.equal(buffer.destroyed, 1);
  await assert.rejects(scheduler.discard(), /device lost/);
  assert.equal(scheduler.cooperative, false);
});

test('the Kit entrypoints and both existing model names expose the shared implementation', async () => {
  const { WebGpuCommandDutyScheduler } = await import('../webgpu-inference-kit/src/core.js');
  const publicKit = await import('../webgpu-inference-kit/src/index.js');
  assert.equal(publicKit.WebGpuCommandDutyScheduler, WebGpuCommandDutyScheduler);
  // These modules use WebGPU usage constants at import time. No GPU is requested.
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, STORAGE: 128 };
  const { UniMateDutyScheduler } = await import('../models/unimate/unimate-cooperative.js');
  for (const [Scheduler, model] of [[KleinDutyScheduler, 'flux2-klein'], [UniMateDutyScheduler, 'unimate']]) {
    const f = fixture();
    const scheduler = new Scheduler(f.device);
    assert.ok(scheduler instanceof WebGpuCommandDutyScheduler);
    scheduler.setSchedule({ runtime: f.runtime, invocation: f.invocation });
    scheduler.encoder();
    await scheduler.flush('forward');
    assert.equal(f.descriptors[0].metadata.model, model);
  }
});
