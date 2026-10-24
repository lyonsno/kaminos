// kaminos-test: node
// Actual Kit runner/session/control with deterministic model work, not model numerics.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
const entry = new URL('../models/moge/moge-app.js', import.meta.url);
assert.ok(existsSync(entry), 'MoGe needs a reusable application entry with shared admission and retirement');
const { createMoGeApp } = await import(entry);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const device = () => ({ features: new Set(), limits: {}, lost: new Promise(() => {}), destroyed: 0,
  destroy() { this.destroyed++; }, addEventListener() {}, removeEventListener() {},
  queue: { submit() {}, async onSubmittedWorkDone() {} } });
const instances = [];
class Inference {
  constructor(gpu, options) { this.gpu = gpu; this.options = options; this.disposed = false; instances.push(this); }
  async init() { await this.options.loading?.(); this.useRealWeights = true; }
  async dispose() { this.disposed = true; }
  async run(image, options) {
    this.received = options; await this.options.beforeRun?.();
    const s = options.scheduler?.schedule;
    if (s) await s.control.runDuty(async () => {
      const duty = await s.runtime.prepareCommandDutyAtBoundary({ phase: 'backbone', kind: 'compute' }, s.invocation);
      s.runtime.settleCommandDuty(duty, { status: 'encoded' });
    });
    if (options.fail) throw Error('model failure');
    return { depth: new Float32Array([1]), image, extra: options.extra };
  }
}
const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
{
  const dev = device(), app = await createMoGeApp({ device: dev, Inference, modelOptions: { weightsUrl: 'custom.bin' } });
  assert.equal(app.model.options.weightsUrl, 'custom.bin');
  const extra = { preserved: true }, first = await app.infer({ image, extra });
  assert.equal(first.extra, extra); assert.equal(first.image, image);
  assert.equal(app.model.received.scheduler.splitVitBlocks, true);
  assert.equal(app.model.received.scheduler.pacing, 'bounded-prefix');
  assert.ok(app.model.received.scheduler.schedule.invocation);
  await assert.rejects(app.infer({ image, fail: true }), /model failure/);
  await app.infer({ image });
  assert.equal(app.session.snapshot().routes.length, 0);
  await assert.rejects(async () => app.infer({ image, scheduler: { schedule: {} } }), /owns/);
  const model = app.model, closing = app.destroy(); assert.equal(closing, app.destroy()); await closing;
  assert.equal(model.disposed, true); assert.equal(dev.destroyed, 0);
  assert.equal(app.session.snapshot().status, 'closed');
}
{
  let fail = true, loads = 0;
  const app = await createMoGeApp({ device: device(), Inference, load: false,
    modelOptions: { loading: async () => { loads++; if (fail) throw Error('offline'); } } });
  const load = app.load(); assert.equal(app.load(), load);
  await assert.rejects(load, /offline/); assert.equal(instances.at(-1).disposed, true);
  assert.equal(app.model, null); assert.equal(app.session.snapshot().routes.length, 0);
  fail = false; await app.load(); assert.equal(loads, 2); await app.destroy();
}
{
  const dev = device(), session = await createWebGpuInferenceSession({ device: dev, sessionId: 'host', adapterName: 'test' });
  const foreground = createWebGpuForegroundService({ device: dev, routeId: 'host' });
  const app = await createMoGeApp({ session, foreground, Inference });
  const host = await session.registerRoute({ routeId: 'host' }), entered = deferred(), held = deferred();
  const job = host.enqueue({ jobId: 'held', execute: async () => {
    const frames = await foreground.beginRun('host'); entered.resolve(); await held.promise; await frames.finish();
  } });
  await entered.promise;
  const run = app.infer({ image }), rejection = assert.rejects(run, { name: 'AbortError' });
  await tick(); assert.equal(app.snapshot().phase, 'queued'); app.stop(); await rejection;
  assert.equal(foreground.snapshot().activeRun.runId, 'host');
  held.resolve(); await job.completion; await app.infer({ image }); await app.destroy();
  assert.equal(session.snapshot().status, 'active'); assert.equal(foreground.snapshot().disposed, false);
  await foreground.dispose(); session.close();
}
{
  const entered = deferred(), held = deferred();
  const app = await createMoGeApp({ device: device(), Inference,
    modelOptions: { beforeRun: async () => { entered.resolve(); await held.promise; } } });
  const pending = app.infer({ image }), rejection = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; await assert.rejects(async () => app.infer({ image }), /already running/);
  assert.equal((await app.pause()).status, 'paused'); app.stop(); held.resolve(); await rejection;
  await app.infer({ image }); await app.destroy();
}
{
  const entered = deferred(), held = deferred();
  const app = await createMoGeApp({ device: device(), Inference, load: false,
    modelOptions: { loading: async () => { entered.resolve(); await held.promise; } } });
  const run = app.infer({ image }), rejection = assert.rejects(run, { name: 'AbortError' });
  await entered.promise; app.stop(); await rejection;
  const close = app.destroy(); await tick(); assert.equal(instances.at(-1).disposed, false);
  held.resolve(); await close; assert.equal(instances.at(-1).disposed, true);
}
console.log('MoGe application: shared admission, stop/retry, load failure, controls and borrowed host survival pass');
