// kaminos-test: node
// Real kit ownership/admission/control; small producer replaces expensive numerical kernels.
import assert from 'node:assert/strict';
import * as api from '../models/supermat/index.js';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
assert.equal(typeof api.createSuperMatApp, 'function', 'the model package must expose the cooperative application entry point');
const { createSuperMatApp } = api;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function device() { return { features: new Set(), limits: {}, lost: new Promise(() => {}), destroyed: 0,
  destroy() { this.destroyed++; }, addEventListener() {}, removeEventListener() {},
  queue: { submit() {}, async onSubmittedWorkDone() {} } }; }
const created = [];
async function Adapter(options) {
  await options.loading?.(options.signal);
  options.onProgress?.({ phase: 'weights' });
  const producer = { options, released: 0, identity: { modelId: 'fixture' }, weightLoadMs: 1,
    release() { this.released++; }, async run(request) {
      this.received = request;
      await options.beforeDuty?.(request);
      const s = request.schedule;
      if (s) await s.control.runDuty(async () => {
        const d = await s.runtime.prepareCommandDutyAtBoundary({ phase: 'fixture', kind: 'compute' }, s.invocation);
        s.runtime.settleCommandDuty(d, { status: 'encoded' });
      });
      if (request.fail) throw new TypeError('producer failure');
      return { maps: { albedo: request.image }, custom: request.custom };
    } };
  created.push(producer); return producer;
}
async function frame(foreground, id) { assert.equal((await foreground.request({ requestId: id,
  run: opportunity => opportunity.submit([id]) }).completion).status, 'completed'); }
const image = { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) };
{
  const dev = device(), progress = [];
  const app = await createSuperMatApp({ device: dev, Adapter, adapterOptions: { attention: 'streaming' }, onProgress: p => progress.push(p) });
  const model = app.adapter;
  await app.load(); assert.equal(progress.length, 1);
  await frame(app.foreground, 'before');
  const custom = { preserve: true };
  assert.equal((await app.infer({ image, size: 768, custom, scheduling: { targetDutyMs: 30, dutyFlops: 123 } })).custom, custom);
  assert.equal(model.received.image, image); assert.equal(model.received.size, 768);
  assert.equal(model.received.schedule.targetDutyMs, 30); assert.equal(model.received.schedule.dutyFlops, 123);
  await assert.rejects(app.infer({ image, fail: true }), /producer failure/);
  await app.infer({ image }); await frame(app.foreground, 'after');
  assert.equal(app.foreground.snapshot().activeRun, null);
  assert.equal(app.snapshot().phase, 'idle');
  assert.equal(app.session.snapshot().routes.length, 1, 'only the resident weight route remains');
  const closing = app.destroy(); assert.equal(app.destroy(), closing); await closing;
  assert.equal(model.released, 1); assert.equal(dev.destroyed, 0);
  assert.equal(app.session.snapshot().status, 'closed'); assert.equal(app.foreground.snapshot().disposed, true);
  await assert.rejects(async () => app.infer({ image }), /destroyed/);
}
{
  let fail = true, loads = 0;
  const app = await createSuperMatApp({ device: device(), Adapter, load: false,
    adapterOptions: { loading: async () => { loads++; if (fail) throw Error('missing weights'); } } });
  const first = app.load(), second = app.load(); assert.equal(first, second);
  await assert.rejects(first, /missing weights/);
  assert.equal(app.session.snapshot().routes.length, 0); assert.equal(app.adapter, null);
  fail = false; await app.load(); assert.equal(loads, 2); await app.destroy();
}
{
  const dev = device(), session = await createWebGpuInferenceSession({ device: dev, sessionId: 'shared', adapterName: 'fixture' });
  const foreground = createWebGpuForegroundService({ device: dev, routeId: 'host' });
  const route = await session.registerRoute({ routeId: 'host' });
  const held = deferred(), entered = deferred();
  const host = route.enqueue({ jobId: 'host-load', execute: async () => {
    const run = await foreground.beginRun('host-load'); entered.resolve(); await held.promise; await run.finish();
  } });
  await entered.promise;
  const count = created.length;
  const app = await createSuperMatApp({ session, foreground, Adapter, load: false });
  const loading = app.load(); await tick();
  assert.equal(created.length, count, 'adapter loading must wait for host admission');
  held.resolve(); await host.completion; await loading;
  const b = await createSuperMatApp({ session, foreground, Adapter });
  assert.notEqual(app.routeId, b.routeId);
  await Promise.all([app.infer({ image }), b.infer({ image })]);
  const hold2 = deferred(), entered2 = deferred();
  const host2 = route.enqueue({ jobId: 'host-cancel', execute: async () => {
    const run = await foreground.beginRun('host-cancel'); entered2.resolve(); await hold2.promise; await run.finish();
  } });
  await entered2.promise;
  const pending = app.infer({ image }); app.stop();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(foreground.snapshot().activeRun, 'pending cancellation must preserve host foreground');
  hold2.resolve(); await host2.completion;
  await app.destroy(); await b.destroy();
  assert.equal(session.snapshot().status, 'active'); assert.equal(foreground.snapshot().disposed, false);
  assert.equal((await route.enqueue({ jobId: 'still-host', execute: () => 42 }).completion).output, 42);
  await frame(foreground, 'still-host'); await foreground.dispose(); session.close();
  await assert.rejects(() => createSuperMatApp({ session, Adapter }), /host foreground/);
  await assert.rejects(() => createSuperMatApp({ session, foreground, device: device(), Adapter }), /must match/);
}
{
  const entered = deferred(), release = deferred();
  const app = await createSuperMatApp({ device: device(), Adapter, adapterOptions: { beforeDuty: options =>
    options.schedule.withForeground('worker', async () => { entered.resolve(); await release.promise; }) } });
  const run = app.infer({ image }), outcome = run.then(value => ({ value }), error => ({ error }));
  await entered.promise;
  const pausing = app.pause(); await tick(); release.resolve();
  assert.equal((await pausing).status, 'paused'); await frame(app.foreground, 'paused');
  await app.resume(); assert.equal((await outcome).error, undefined);
  await app.destroy();
}
{
  const entered = deferred(), release = deferred();
  const app = await createSuperMatApp({ device: device(), Adapter, adapterOptions: { beforeDuty: async () => { entered.resolve(); await release.promise; } } });
  const run = app.infer({ image }); await entered.promise;
  await assert.rejects(async () => app.infer({ image }), /already running/);
  await app.pause(); app.stop(); release.resolve(); await assert.rejects(run, { name: 'AbortError' });
  await app.infer({ image }); await app.destroy();
}
console.log('SuperMat application ownership, admission, controls, retry and options passed');
