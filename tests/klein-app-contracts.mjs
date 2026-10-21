// kaminos-test: node
// Lifecycle tests use the real kit session, queue, foreground service and inference control.
// The small producer stands in for expensive model kernels; native output is a browser witness.
import assert from 'node:assert/strict';
import { createKleinApp } from '../models/flux2-klein/klein-app.js';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function device() {
  const lost = deferred(), listeners = new Map();
  return { features: new Set(['shader-f16']), limits: {}, lost: lost.promise, lose: lost.resolve,
    destroyed: 0, destroy() { this.destroyed++; },
    addEventListener(k, f) { listeners.set(k, f); }, removeEventListener(k) { listeners.delete(k); },
    fail(error) { listeners.get('uncapturederror')?.({ error }); },
    queue: { submissions: [], submit(commands) { this.submissions.push(commands); }, async onSubmittedWorkDone() {} } };
}
class Producer {
  static instances = [];
  constructor(dev, options) { this.device = dev; this.options = options; this.loads = 0; this.destroyed = 0; Producer.instances.push(this); }
  async load(progress) { this.loads++; progress?.('weights', 'fixture', { loadedBytes: 1, totalBytes: 1 }); await this.options.loading?.(); }
  async generate(options) {
    this.received = options;
    await this.options.beforeDuty?.(options);
    const s = options.schedule;
    if (s) await s.control.runDuty(async () => {
      const duty = await s.runtime.prepareCommandDutyAtBoundary({ phase: 'fixture', kind: 'compute' }, s.invocation);
      s.runtime.settleCommandDuty(duty, { status: 'encoded' });
      this.device.queue.submit(['model']);
    });
    if (options.prompt === 'fail') throw new TypeError('producer failure');
    return { rgba: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, custom: options.custom };
  }
  async destroy() { this.destroyed++; await this.options.destroying?.(); }
}
async function frame(app, id) {
  const receipt = await app.foreground.request({ requestId: id, run: o => o.submit([id]) }).completion;
  assert.equal(receipt.status, 'completed');
}

// Same app through idle frames, inference, failure, another generation and teardown.
{
  const dev = device(), progress = [];
  const app = await createKleinApp({ device: dev, Pipeline: Producer, onProgress: (...args) => progress.push(args) });
  const producer = app.pipeline;
  assert.equal(progress.length, 1);
  await app.load(); assert.equal(producer.loads, 1);
  await frame(app, 'before');
  const custom = { keep: 'model-specific-options' };
  const run = app.generate({ prompt: 'train', custom, width: 768, height: 512, steps: 9, textLength: 512,
    scheduling: { targetDutyMs: 30, maxInFlight: 4, dutyFlops: 123 } });
  const result = await run;
  assert.equal(result.custom, custom);
  assert.equal(producer.received.steps, 9);
  assert.equal(producer.received.width, 768);
  assert.equal(producer.received.schedule.targetDutyMs, 30);
  assert.equal(producer.received.schedule.maxInFlight, 4);
  assert.equal(producer.received.schedule.dutyFlops, 123);
  assert.equal(app.session.snapshot().routes.length, 0);
  assert.equal(app.foreground.snapshot().activeRun, null);
  await assert.rejects(async () => app.generate({ prompt: 'fail' }), { name: 'TypeError', message: 'producer failure' });
  await app.generate({ prompt: 'again' });
  await frame(app, 'after');
  const closing = app.destroy(); assert.equal(app.destroy(), closing); await closing;
  assert.equal(producer.destroyed, 1);
  assert.equal(dev.destroyed, 0);
  assert.equal(app.session.snapshot().status, 'closed');
  assert.equal(app.foreground.snapshot().disposed, true);
  await assert.rejects(async () => app.generate(), /destroyed/);
}

// Shared host state and unrelated routes survive, including two model instances using one session.
{
  const dev = device();
  const session = await createWebGpuInferenceSession({ device: dev, sessionId: 'host', adapterName: 'fixture' });
  const hostRoute = await session.registerRoute({ routeId: 'host' });
  const foreground = createWebGpuForegroundService({ device: dev, routeId: 'host-scene' });
  const a = await createKleinApp({ session, foreground, Pipeline: Producer });
  const b = await createKleinApp({ session, foreground, Pipeline: Producer });
  assert.notEqual(a.routeId, b.routeId);
  await Promise.all([a.generate({}), b.generate({})]);
  await a.destroy(); await b.destroy();
  assert.equal(session.snapshot().status, 'active');
  assert.equal(foreground.snapshot().disposed, false);
  assert.equal((await hostRoute.enqueue({ jobId: 'after', execute: () => 42 }).completion).output, 42);
  await frame({ foreground }, 'host-after');
  await foreground.dispose(); await session.drain(); session.close();
  assert.equal(dev.destroyed, 0);
  await assert.rejects(() => createKleinApp({ device: device(), session, foreground, Pipeline: Producer }), /must match/);
  await assert.rejects(() => createKleinApp({ session, Pipeline: Producer }), /host foreground service/);
}

// One load flight, atomic failure cleanup, then a fresh producer on retry.
{
  const gate = deferred(); let fail = true;
  const app = await createKleinApp({ device: device(), Pipeline: Producer, load: false,
    pipelineOptions: { loading: async () => { await gate.promise; if (fail) throw new Error('missing weights'); } } });
  const original = app.pipeline, first = app.load(), second = app.load();
  assert.equal(first, second);
  gate.resolve(); await assert.rejects(first, /missing weights/);
  assert.equal(original.destroyed, 1); assert.equal(app.pipeline, null);
  fail = false; await app.load(); assert.notEqual(app.pipeline, original);
  await app.destroy();
}

// Pause actually prevents the next duty, frames remain serviceable, stop releases a paused run.
{
  const entered = deferred(), release = deferred();
  const app = await createKleinApp({ device: device(), Pipeline: Producer,
    pipelineOptions: { beforeDuty: async () => { entered.resolve(); await release.promise; } } });
  const run = app.generate({}); await entered.promise;
  await assert.rejects(async () => app.generate({}), /already running/);
  assert.equal((await app.pause()).status, 'paused');
  await frame(app, 'paused');
  release.resolve();
  app.stop(); await assert.rejects(run, { name: 'AbortError' });
  assert.equal(app.foreground.snapshot().activeRun, null);
  await app.generate({});
  await app.destroy();
}

// Pausing a lean-residency weight reload waits for its CPU window, then parks GPU admission.
{
  const entered = deferred(), release = deferred();
  const app = await createKleinApp({ device: device(), Pipeline: Producer,
    pipelineOptions: { beforeDuty: options => options.schedule.withForeground('weights', async () => {
      entered.resolve(); await release.promise;
    }) } });
  const run = app.generate({});
  // Install rejection handlers before the intentionally failing pre-fix pause.
  const outcome = run.then(value => ({ value }), error => ({ error }));
  await entered.promise;
  const pausing = app.pause().then(value => ({ value }), error => ({ error }));
  await new Promise(r => setImmediate(r)); release.resolve();
  const paused = await pausing;
  assert.equal(paused.error, undefined, 'pause during weight reload must not overlap foreground windows');
  assert.equal(paused.value.status, 'paused');
  await frame(app, 'paused-after-weights');
  await app.resume();
  assert.equal((await outcome).error, undefined);
  await app.destroy();
}

// Pending cancellation doesn't wait for unrelated host work or invoke the model.
{
  const dev = device(), held = deferred(), entered = deferred();
  const session = await createWebGpuInferenceSession({ device: dev, sessionId: 'busy-host', adapterName: 'fixture' });
  const foreground = createWebGpuForegroundService({ device: dev, routeId: 'host-frames' });
  const hostFrames = await foreground.beginRun('host-hold', { routeId: 'busy' });
  const route = await session.registerRoute({ routeId: 'busy' });
  const job = route.enqueue({ jobId: 'hold', execute: async () => {
    entered.resolve(); await held.promise; await hostFrames.finish();
  } });
  await entered.promise;
  const app = await createKleinApp({ session, foreground, Pipeline: Producer });
  const run = app.generate({});
  const cancelled = assert.rejects(run, { name: 'AbortError' });
  await new Promise(r => setImmediate(r));
  assert.equal(app.snapshot().phase, 'queued', 'Klein must queue without taking the current host foreground run');
  let drew = false;
  const frame = app.foreground.request({ requestId: 'waiting-frame', run: o => { drew = true; o.submit(['frame']); } });
  assert.equal(await app.pause(), null, 'queued work has no GPU pause control before admission');
  assert.equal(drew, false);
  app.stop(); await cancelled;
  assert.equal(drew, false, 'pending cancellation must not drain the current host foreground requests');
  assert.equal(foreground.snapshot().activeRun.runId, 'host-hold');
  assert.equal(app.pipeline.received, undefined);
  const next = app.generate({});
  held.resolve(); await job.completion; await next;
  assert.equal((await frame.completion).status, 'completed');
  assert.equal(foreground.snapshot().activeRun, null);
  await app.destroy(); await route.drain(); session.close(); await foreground.dispose();
}

// Owned device setup, load failure, and teardown during load all release their resources.
{
  const dev = device(), finishing = deferred(), finish = deferred();
  const session = await createWebGpuInferenceSession({ device: dev, sessionId: 'finish-order', adapterName: 'fixture' });
  const service = createWebGpuForegroundService({ device: dev, routeId: 'scene' });
  const foreground = { ...service, async beginRun(...args) {
    const run = await service.beginRun(...args);
    return { ...run, async finish() { finishing.resolve(); await finish.promise; return run.finish(); } };
  } };
  const app = await createKleinApp({ session, foreground, Pipeline: Producer });
  const generation = app.generate({}); await finishing.promise;
  const nextRoute = await session.registerRoute({ routeId: 'next-model' });
  let nextStarted = false;
  const next = nextRoute.enqueue({ jobId: 'next', execute() { nextStarted = true; } });
  await new Promise(r => setImmediate(r));
  assert.equal(nextStarted, false, 'foreground settlement must retain session admission');
  finish.resolve(); await generation; await next.completion;
  await app.destroy(); await nextRoute.drain(); session.close(); await service.dispose();
}

// Owned device setup, load failure, and teardown during load all release their resources.
{
  const dev = device(); let descriptor;
  const gpu = { requestAdapter: async () => ({ features: new Set(['shader-f16']), limits: {
    maxBufferSize: 1024, maxStorageBufferBindingSize: 512, maxStorageBuffersPerShaderStage: 8, maxComputeWorkgroupStorageSize: 16384 },
    requestDevice: async d => { descriptor = d; return dev; } }) };
  await assert.rejects(() => createKleinApp({ gpu, Pipeline: Producer, pipelineOptions: { loading() { throw new Error('load failed'); } } }), /load failed/);
  assert.deepEqual(descriptor.requiredFeatures, ['shader-f16']);
  assert.equal(descriptor.requiredLimits.maxBufferSize, 1024);
  assert.equal(dev.destroyed, 1);
  const gate = deferred();
  const app = await createKleinApp({ device: device(), Pipeline: Producer, load: false, pipelineOptions: { loading: () => gate.promise } });
  const load = app.load(); const failed = assert.rejects(load, /destroyed/);
  const close = app.destroy(); gate.resolve(); await failed; await close;
}

// GPU failure, pre-aborted signals and cleanup errors cannot masquerade as successful output.
{
  const dev = device(), app = await createKleinApp({ device: dev, Pipeline: Producer });
  await assert.rejects(async () => app.generate({ signal: AbortSignal.abort('before') }), { name: 'AbortError' });
  assert.equal(app.pipeline.received, undefined);
  dev.fail(new Error('GPU rejected commands'));
  await assert.rejects(async () => app.generate({}), /GPU rejected/); await app.destroy();
  const bad = await createKleinApp({ device: device(), Pipeline: Producer,
    pipelineOptions: { destroying() { throw new Error('release failed'); } } });
  await assert.rejects(bad.destroy(), e => e instanceof AggregateError && e.errors[0].message === 'release failed');
}
console.log('Klein application lifecycle contracts passed');
