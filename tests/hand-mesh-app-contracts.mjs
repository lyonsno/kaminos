// kaminos-test: node
// Real shared runner/session/control; deterministic model dependencies, not GPU numerics.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
const entry = new URL('../models/mobrecon/hand-mesh-app.js', import.meta.url);
assert.ok(existsSync(entry), 'hand model needs an application entry point for outside callers');
const { createHandMeshApp } = await import(entry);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const device = () => ({ features: new Set(), limits: {}, lost: new Promise(() => {}), destroyed: 0,
  destroy() { this.destroyed++; }, addEventListener() {}, removeEventListener() {},
  queue: { submit() {}, async onSubmittedWorkDone() {} } });
const producers = [];
async function Route(options) {
  const resident = await options.session.registerRoute({ routeId: `${options.routeId}:weights` });
  const producer = { options, faces: new Uint32Array([0,1,2]), identity: { backend: 'webgpu-local', fixture: true },
    released: false, before: null, last: null,
    async infer(input) {
      this.last = input;
      await this.before?.();
      if (input.fail) throw Error('model failed');
      return { hasHand: false, identity: this.identity, acquisition: input.acquisition, inputSource: input.source };
    },
    release() { this.released = true; options.session.unregisterRoute(resident.routeId); },
    async readCropBytes() { return new Uint8Array(4); },
  };
  producers.push(producer); return producer;
}
const input = { source: { frame: 1 }, width: 640, height: 480 };
{
  const dev = device(), app = await createHandMeshApp({ device: dev, Route });
  const model = app.route;
  assert.equal(app.faces, model.faces); assert.equal(app.identity, model.identity);
  assert.deepEqual(app.snapshot().ownership, { device: 'borrowed', session: 'owned', foreground: 'owned' });
  const result = await app.infer(input);
  assert.equal(result.hasHand, false);
  assert.equal(model.last.handedness, 'right');
  assert.equal(model.last.acquisition.onMiss, 'skip');
  assert.equal(model.last.acquisition.threshold, .8);
  assert.equal(typeof model.last.schedule.control.runDuty, 'function');
  assert.equal(app.snapshot().phase, 'idle');
  assert.equal(app.snapshot().admission, 'whole-operation-fifo');
  await app.infer({ ...input, handedness: 'left', acquisition: { mode: 'manual', manualBox: [0,0,128,128] } });
  assert.equal(model.last.handedness, 'left'); assert.equal(model.last.acquisition.mode, 'manual');
  await assert.rejects(app.infer({ ...input, fail: true }), /model failed/);
  await app.infer(input);
  const closing = app.destroy(); assert.equal(app.destroy(), closing); await closing;
  assert.equal(model.released, true); assert.equal(dev.destroyed, 0); assert.equal(app.session.snapshot().status, 'closed');
  await assert.rejects(async () => app.infer(input), /destroyed/);
}
{
  const dev = device(), session = await createWebGpuInferenceSession({ device: dev, sessionId: 'host', adapterName: 'fixture' });
  const foreground = createWebGpuForegroundService({ device: dev, routeId: 'host' });
  const a = await createHandMeshApp({ session, foreground, Route }), b = await createHandMeshApp({ session, foreground, Route });
  assert.notEqual(a.routeId, b.routeId);
  const host = await session.registerRoute({ routeId: 'host' }), entered = deferred(), held = deferred();
  const job = host.enqueue({ jobId: 'held', execute: async () => { const run = await foreground.beginRun('host'); entered.resolve(); await held.promise; await run.finish(); } });
  await entered.promise;
  let latest = 1, captures = 0;
  const getFrame = () => { captures++; return { source: { frame: latest }, width: 640, height: 480, frameId: latest }; };
  const cancelled = a.infer({ getFrame }), rejection = assert.rejects(cancelled, { name: 'AbortError' });
  await tick(); assert.equal(a.snapshot().phase, 'queued'); assert.equal(captures, 0);
  a.stop(); await rejection; assert.equal(foreground.snapshot().activeRun.runId, 'host');
  const next = a.infer({ getFrame }); await tick(); latest = 8;
  assert.equal(captures, 0, 'no capture while waiting for unrelated model admission');
  held.resolve(); await job.completion;
  const result = await next;
  assert.equal(captures, 1); assert.equal(result.input.frameId, 8); assert.equal(result.inputSource.frame, 8);
  await Promise.all([a.infer(input), b.infer(input)]);
  await a.destroy(); await b.destroy();
  assert.equal(session.snapshot().status, 'active'); assert.equal(foreground.snapshot().disposed, false);
  assert.equal((await host.enqueue({ jobId: 'after', execute: () => 42 }).completion).output, 42);
  await foreground.dispose(); session.close();
}
{
  const app = await createHandMeshApp({ device: device(), Route });
  const gate = deferred(), entered = deferred(), model = app.route;
  model.before = async () => { entered.resolve(); await gate.promise; };
  const running = app.infer(input), rejection = assert.rejects(running, { name: 'AbortError' }); await entered.promise;
  await assert.rejects(async () => app.infer(input), /already running/);
  const closing = app.destroy(); await tick(); assert.equal(model.released, false, 'destroy must await active inference');
  gate.resolve(); await rejection; await closing; assert.equal(model.released, true);
}
{
  let fail = true, attempts = 0;
  const app = await createHandMeshApp({ device: device(), load: false, Route: async options => {
    attempts++; if (fail) throw Error('missing models'); return Route(options);
  } });
  const first = app.load(); assert.equal(app.load(), first);
  await assert.rejects(first, /missing models/); assert.equal(app.session.snapshot().routes.length, 0);
  fail = false; await app.load(); assert.equal(attempts, 2); await app.destroy();
}
{
  const dev = device(), gate = deferred(), entered = deferred();
  const app = await createHandMeshApp({ device: dev, load: false, Route: async options => { entered.resolve(); await gate.promise; return Route(options); } });
  const running = app.infer(input), rejection = assert.rejects(running, { name: 'AbortError' }); await entered.promise;
  app.stop(); await rejection; const closing = app.destroy(); gate.resolve(); await closing;
  assert.equal(app.session.snapshot().status, 'closed'); assert.equal(dev.destroyed, 0);
}
console.log('Hand application ownership, repeated use, latest input after admission, queued cancellation and teardown passed');
