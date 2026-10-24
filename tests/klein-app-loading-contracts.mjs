// kaminos-test: node
// Keep Klein's actual precompile and duty scheduler; replace weights and numerical encoding.
import assert from 'node:assert/strict';
import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';
import { createKleinApp } from '../models/flux2-klein/klein-app.js';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));

class WarmupProducer extends KleinPipeline {
  constructor(device, options) {
    super(device); this.options = options;
    for (const name of ['textEncoder', 'transformer', 'vae']) this[name] = { weightsResident: true, destroy() {} };
  }
  async load(_progress, options) {
    this.options.preparing.resolve();
    await this.precompile(options);
  }
  async generateScheduled() {
    if (this.collecting) return; // the real first pass only collects shader sources
    this.sched.encoder();
    await this.sched.flush('fixture');
    this.options.afterDispatch?.();
    return { width: 1, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]) };
  }
}

for (const mode of ['eager', 'explicit', 'implicit']) {
  const release = deferred(), entered = deferred(), preparing = deferred(), observations = [];
  const device = { features: new Set(['shader-f16']), lost: new Promise(() => {}),
    createCommandEncoder: () => ({ finish: () => 'model-command' }),
    queue: { submit: commands => observations.push({ commands, owner: foreground.snapshot().activeRun?.routeId }),
      async onSubmittedWorkDone() {} } };
  const session = await createWebGpuInferenceSession({ device, sessionId: `load-${mode}`, adapterName: 'fixture' });
  const foreground = createWebGpuForegroundService({ device, routeId: 'scene' });
  const host = await session.registerRoute({ routeId: 'host' });
  const holding = host.enqueue({ jobId: 'host', execute: async () => {
    const run = await foreground.beginRun('host-run', { routeId: 'host' });
    entered.resolve(); await release.promise; await run.finish();
  } });
  await entered.promise;
  let app;
  const options = { session, foreground, Pipeline: WarmupProducer, pipelineOptions: { preparing } };
  const loading = mode === 'eager'
    ? createKleinApp(options).then(value => { app = value; })
    : (app = await createKleinApp({ ...options, load: false }),
      mode === 'explicit' ? app.load() : app.generate({ cooperative: false }));
  const outcome = loading.then(value => ({ value }), error => ({ error }));
  await preparing.promise; await tick();
  const premature = observations.slice();
  const hostOwner = foreground.snapshot().activeRun?.routeId;
  release.resolve(); await holding.completion;
  const result = await outcome;
  if (!result.error) await app.generate({ cooperative: false });
  const ownedRoutes = session.snapshot().routes.filter(route => route.routeId !== 'host');
  const remainingForeground = foreground.snapshot().activeRun;
  await app?.destroy(); await host.drain(); session.close(); await foreground.dispose();
  assert.deepEqual(premature, [], `${mode} load warmup must wait for shared admission`);
  assert.equal(hostOwner, 'host');
  assert.equal(result.error, undefined);
  assert.ok(observations.length >= 2, 'warmup and subsequent generation must submit');
  assert.ok(observations.every(row => row.owner === app.routeId), 'warmup dispatch must own the foreground run');
  assert.deepEqual(ownedRoutes, []);
  assert.equal(remainingForeground, null);
}

// A failed real warmup releases admission, retires its producer, and permits a clean retry.
{
  const preparing = deferred(), observations = [];
  let fail = true;
  const device = { features: new Set(['shader-f16']), lost: new Promise(() => {}),
    createCommandEncoder: () => ({ finish: () => 'warmup' }),
    queue: { submit: commands => observations.push(commands), async onSubmittedWorkDone() {} } };
  const app = await createKleinApp({ device, Pipeline: WarmupProducer, load: false,
    pipelineOptions: { preparing, afterDispatch() { if (fail) throw new Error('warmup failed'); } } });
  const original = app.pipeline;
  await assert.rejects(app.load(), /warmup failed/);
  assert.equal(original.destroyed, true);
  assert.equal(app.pipeline, null);
  assert.deepEqual(app.session.snapshot().routes, []);
  assert.equal(app.foreground.snapshot().activeRun, null);
  fail = false; await app.load(); await app.generate({ cooperative: false });
  assert.equal(observations.length, 3);
  await app.destroy();
}

// Destroying a queued load cancels its admission without waiting for or releasing the host.
{
  const preparing = deferred(), release = deferred(), entered = deferred(), observations = [];
  const device = { features: new Set(['shader-f16']), lost: new Promise(() => {}),
    createCommandEncoder: () => ({ finish: () => 'warmup' }),
    queue: { submit: commands => observations.push(commands), async onSubmittedWorkDone() {} } };
  const session = await createWebGpuInferenceSession({ device, sessionId: 'destroy-loading', adapterName: 'fixture' });
  const foreground = createWebGpuForegroundService({ device, routeId: 'scene' });
  const host = await session.registerRoute({ routeId: 'host' });
  const holding = host.enqueue({ jobId: 'host', execute: async () => {
    const run = await foreground.beginRun('host-run', { routeId: 'host' });
    entered.resolve(); await release.promise; await run.finish();
  } });
  await entered.promise;
  const app = await createKleinApp({ session, foreground, Pipeline: WarmupProducer, load: false,
    pipelineOptions: { preparing } });
  const loading = app.load(), rejected = assert.rejects(loading, /destroyed/);
  await preparing.promise; await tick();
  let closed = false;
  const closing = app.destroy().then(() => { closed = true; });
  await tick();
  const closedWhileHostHeld = closed, foregroundOwner = foreground.snapshot().activeRun?.routeId;
  release.resolve(); await holding.completion; await closing; await rejected;
  assert.equal(closedWhileHostHeld, true);
  assert.equal(foregroundOwner, 'host');
  assert.deepEqual(observations, []);
  assert.deepEqual(session.snapshot().routes.map(r => r.routeId), ['host']);
  await host.drain(); session.close(); await foreground.dispose();
}

// Foreground settlement from warmup remains inside its admission, just like generation.
{
  const preparing = deferred(), finishing = deferred(), finish = deferred();
  const device = { features: new Set(['shader-f16']), lost: new Promise(() => {}),
    createCommandEncoder: () => ({ finish: () => 'warmup' }),
    queue: { submit() {}, async onSubmittedWorkDone() {} } };
  const session = await createWebGpuInferenceSession({ device, sessionId: 'load-finish', adapterName: 'fixture' });
  const service = createWebGpuForegroundService({ device, routeId: 'scene' });
  const foreground = { ...service, async beginRun(...args) {
    const run = await service.beginRun(...args);
    return { ...run, async finish() { finishing.resolve(); await finish.promise; return run.finish(); } };
  } };
  const app = await createKleinApp({ session, foreground, Pipeline: WarmupProducer, load: false,
    pipelineOptions: { preparing } });
  const loading = app.load(); await finishing.promise;
  const nextRoute = await session.registerRoute({ routeId: 'next-model' });
  let nextStarted = false;
  const next = nextRoute.enqueue({ jobId: 'next', execute() { nextStarted = true; } });
  await tick(); const startedBeforeFinish = nextStarted;
  finish.resolve(); await loading; await next.completion;
  assert.equal(startedBeforeFinish, false);
  assert.equal(service.snapshot().activeRun, null);
  await app.destroy(); await nextRoute.drain(); session.close(); await service.dispose();
}
console.log('Klein loading admission contracts passed');
