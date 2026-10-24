// kaminos-test: node
// Two different application wrappers share real kit admission and foreground state.
import assert from 'node:assert/strict';
import { createKleinApp } from '../models/flux2-klein/klein-app.js';
import { createSuperMatApp } from '../models/supermat/supermat-app.js';
import { createWebGpuInferenceSession, createWebGpuForegroundService } from '../webgpu-inference-kit/src/core.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const entered = deferred(), release = deferred(), finishing = deferred(), finish = deferred();
const calls = [];
const device = { features: new Set(['shader-f16']), lost: new Promise(() => {}),
  queue: { submit() {}, async onSubmittedWorkDone() {} } };
const session = await createWebGpuInferenceSession({ device, adapterName: 'fixture', sessionId: 'mixed-apps' });
const service = createWebGpuForegroundService({ device, routeId: 'host' });
let heldFinish = true;
const foreground = { ...service, async beginRun(...args) {
  const frames = await service.beginRun(...args);
  return { ...frames, async finish() {
    if (heldFinish) { heldFinish = false; finishing.resolve(); await finish.promise; }
    return frames.finish();
  } };
} };
class Klein {
  async load() {}
  async generate(options) { calls.push('klein'); this.options = options; entered.resolve(); await release.promise; return options.payload; }
  async destroy() {}
}
const Adapter = async () => ({ release() {}, async run(options) { calls.push('supermat'); return options.payload; } });
const klein = await createKleinApp({ session, foreground, Pipeline: Klein });
const materials = await createSuperMatApp({ session, foreground, Adapter });
const payload = { output: 'preserved by identity' };
const first = klein.generate({ payload }); await entered.promise;
const cancelled = materials.infer({ payload }); const rejected = assert.rejects(cancelled, { name: 'AbortError' });
await tick(); assert.equal(materials.snapshot().phase, 'queued');
const owner = foreground.snapshot().activeRun.runId;
materials.stop(); await rejected;
assert.deepEqual(calls, ['klein']); assert.equal(foreground.snapshot().activeRun.runId, owner);
const second = materials.infer({ payload });
release.resolve(); await finishing.promise; await tick();
assert.deepEqual(calls, ['klein'], 'a different producer must wait for foreground settlement too');
finish.resolve();
assert.equal(await first, payload); assert.equal(await second, payload);
assert.deepEqual(calls, ['klein', 'supermat']);
assert.equal(foreground.snapshot().activeRun, null);
assert.equal(session.snapshot().routes.length, 1, 'SuperMat retains only its own weight route');
assert.equal(klein.pipeline.options.schedule.maxInFlight, 2, 'Klein keeps its model scheduling default');
const direct = klein.generate({ cooperative: false, payload });
assert.equal(await direct, payload); assert.equal(klein.pipeline.options.schedule, undefined);
await materials.destroy(); await klein.destroy();
assert.deepEqual(session.snapshot().routes, []);
assert.equal(session.snapshot().status, 'active'); assert.equal(service.snapshot().disposed, false);
await service.dispose(); session.close();
console.log('Mixed Klein/SuperMat admission, cancellation, settlement, model options and host survival passed');
