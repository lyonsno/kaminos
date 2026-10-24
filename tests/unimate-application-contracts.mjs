// kaminos-test: node
// Real generator, app host, kit queue/control/foreground, and command-duty scheduler;
// only model loading and numerics are substituted. Native consumer evidence checks output.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as kit from '../webgpu-inference-kit/src/core.js';
import { WebGpuCommandDutyScheduler } from '../webgpu-inference-kit/src/command-duty-scheduler.js';
import { createAppGpuHost } from '../app-gpu-host.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const events = [];
const state = { encodeHold: null, solveHold: null, failSolve: false, failFinish: false };
const device = { lost: new Promise(() => {}), queue: { submit() { events.push('submit'); }, async onSubmittedWorkDone() {} },
  createCommandEncoder() { return { finish: () => ({}) }; } };
const app = createAppGpuHost({ sharedGpu: { device }, kit,
  host: { runForegroundFrame: fn => fn(), setForegroundServiceActive() {} },
  frameOwner: () => ({ setForegroundOpportunityRequester() { events.push('install'); } }),
});
const session = await app.session();
const beginRun = async (...args) => {
  events.push('begin');
  const frames = await app.beginRun(...args);
  return Object.freeze(Object.create(frames, { finish: { value: async () => {
    events.push('finishing');
    if (state.finishHold) await state.finishHold.promise;
    if (state.failFinish) throw new Error('fixture settlement failed');
    await frames.finish(); events.push('finished');
  } } }));
};
class Denoiser {
  static async create() { return new Denoiser(); }
  configure() {}
  writeConditioning() {}
  encodePrepare() { if (state.failPrepare) throw new Error('fixture preparation failed'); }
  destroy() { events.push('den.destroy'); }
}
class T5 {
  static async create() { return new T5(); }
  async encode() {
    events.push('encode');
    if (state.encodeHold) await state.encodeHold.promise;
    return { pooled: new Float32Array(768) };
  }
  destroy() { events.push('t5.destroy'); }
}
const output = { positions: new Float32Array(12), localRotations: new Float32Array(16), rootTranslation: new Float32Array(6) };
globalThis.__unimateApplicationTest = { Denoiser, T5, Scheduler: WebGpuCommandDutyScheduler,
  createDrift(_device, _den, scheduler, options) {
    const drift = async () => {
      scheduler.encoder(); await scheduler.flush('fixture.drift');
      drift.evaluations++; options.onEvaluation?.({ t: 1, evaluations: drift.evaluations });
      return new Float32Array(48);
    };
    drift.evaluations = 0; drift.dispose = () => events.push('drift.dispose');
    return drift;
  },
  async solve(options) {
    events.push('solve');
    state.lastSolver = options;
    if (state.solveHold) await state.solveHold.promise;
    if (state.failSolve) throw new Error('fixture numerical failure');
    await options.drift();
    options.onStep?.({ accepted: true, t0: 0, dt: 1 }, 0);
    const final = new Float32Array(48);
    await options.onSample?.({ state: final, t: 1, index: 1 });
    return { solution: [final], steps: [{ accepted: true }] };
  }, output,
};
const hooks = registerHooks({ load(url, context, next) {
  const f = 'globalThis.__unimateApplicationTest';
  if (url.endsWith('/unimate-cooperative.js')) return { format: 'module', shortCircuit: true,
    source: `export const CooperativeUniMateDenoiser=${f}.Denoiser, UniMateDutyScheduler=${f}.Scheduler, createCooperativeCfgDrift=${f}.createDrift;` };
  if (url.endsWith('/unimate-t5.js')) return { format: 'module', shortCircuit: true, source: `export const T5Encoder=${f}.T5;` };
  if (url.endsWith('/unimate-dopri5.js')) return { format: 'module', shortCircuit: true, source: `export const dopri5Solve=${f}.solve;` };
  if (url.endsWith('/unimate-decode.js')) return { format: 'module', shortCircuit: true,
    source: `export const groundedOffsets=()=>[], decodeUniMateMotion=()=>${f}.output;` };
  return next(url, context);
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => String(url).endsWith('.bin') ? new Response(new Uint8Array(4))
  : new Response(JSON.stringify({ file: 'weights.bin', parameterCount: 1 }));
const skeletonData = { b: { skeleton: { name: 'fixture', joints: 2, parents: [-1, 0], jointNames: ['root', 'foot'], fps: 30, frames: 2 },
  prompts: [{ text: 'Walk.', caption: 'caption', referenceNoise: 'noise' }], outputTimes: [0, 1], motionLength: 2 },
  a: Object.fromEntries(['restPositions', 'tpos', 'tposParents', 'depths', 'jointNamesEmb', 'spectral', 'graphDist', 'jointRelations', 'std', 'mean', 'noise', 'caption']
    .map(key => [key, new Float32Array(key === 'caption' ? 768 : 48)])) };
let gate, blocker, generator, first, pending;
try {
  const { createUniMateGenerator } = await import('../models/unimate/unimate-generator.js');
  generator = await createUniMateGenerator({ device, session, beginRun, skeletonData, weightsBase: '/weights/', t5Base: '/t5/' });
  const ownerEntered = deferred(); gate = deferred();
  blocker = await session.registerRoute({ routeId: 'other-model' });
  first = blocker.enqueue({ jobId: 'other-model-run', execute: async () => { ownerEntered.resolve(); await gate.promise; } });
  await ownerEntered.promise;
  events.length = 0;
  pending = generator.generate({ text: 'Walk.', seed: 1 });
  pending.catch(() => {});
  await tick();
  assert.deepEqual(events, [], 'a queued UniMate run must not acquire the foreground or encode text before admission');
  assert.equal(generator.running, true, 'running includes queued/preparing work');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  generator.stop(); await rejected;
  assert.deepEqual(events, [], 'queued cancellation never takes the active renderer');
  gate.resolve(); await first.completion; await blocker.drain();
  session.unregisterRoute(blocker.routeId); blocker = null;

  const result = await generator.generate({ text: 'Walk.', seed: 2, targetDutyMs: 7, maxInFlight: 2 });
  assert.equal(result.motion, output, 'the model output is returned without substitution');
  assert.equal(result.prompt, 'Walk.'); assert.equal(result.seed, 2);
  assert(events.indexOf('begin') < events.indexOf('encode'), 'caption work runs under host ownership');
  assert(events.indexOf('drift.dispose') < events.indexOf('finished'));
  assert.deepEqual(app.unsettledRuns(), []);
  assert.deepEqual(session.snapshot().routes, []);
  assert.equal(generator.running, false);

  // Caption preparation is busy too; Stop must prevent the solver starting afterwards.
  events.length = 0; state.encodeHold = deferred();
  pending = generator.generate({ text: 'Walk.', seed: 3 });
  const stoppedEncoding = assert.rejects(pending, { name: 'AbortError' });
  await tick(); assert(events.includes('encode'));
  await assert.rejects(generator.generate({ text: 'Walk.', seed: 4 }), /already running/);
  await assert.rejects(generator.useSkeletonData(skeletonData), /generation is running/);
  generator.stop(); state.encodeHold.resolve(); await stoppedEncoding; state.encodeHold = null;
  assert(!events.includes('solve'), 'cancel during caption encoding never starts the solver');

  // A pause leaves the foreground usable, and the next duty waits for resume.
  events.length = 0; state.solveHold = deferred();
  pending = generator.generate({ text: 'Walk.', seed: 5 });
  await tick(); assert(events.includes('solve'));
  assert.equal(await generator.togglePause(), 'paused');
  let drew = false;
  const frame = app.foreground.request({ requestId: 'during-pause', run() { drew = true; } });
  await frame.completion; assert(drew);
  state.solveHold.resolve(); await tick();
  assert.equal(generator.running, true);
  assert.equal(await generator.togglePause(), 'running');
  await pending; state.solveHold = null;

  state.failSolve = true;
  await assert.rejects(generator.generate({ text: 'Walk.', seed: 6 }), /fixture numerical failure/);
  state.failSolve = false;
  assert.equal(generator.running, false); assert.deepEqual(app.unsettledRuns(), []);
  assert.equal((await generator.generate({ text: 'Walk.', seed: 7 })).motion, output, 'retry after model failure');
  state.failPrepare = true;
  await assert.rejects(generator.generate({ text: 'Walk.', seed: 7 }), /fixture preparation failed/);
  state.failPrepare = false;
  assert.equal((await generator.generate({ text: 'Walk.', seed: 7 })).motion, output, 'retry after unsubmitted preparation failure');

  // Two default instances have different runtime identities and serialize through finishing.
  const second = await createUniMateGenerator({ device, session, beginRun, skeletonData, weightsBase: '/weights/', t5Base: '/t5/' });
  assert.notEqual(generator.routeId, second.routeId);
  events.length = 0; state.finishHold = deferred();
  pending = generator.generate({ text: 'Walk.', seed: 8 });
  await tick(); assert(events.includes('finishing'));
  const secondRun = second.generate({ text: 'Walk.', seed: 9 });
  await tick(); assert.equal(events.filter(e => e === 'begin').length, 1);
  state.finishHold.resolve(); await Promise.all([pending, secondRun]); state.finishHold = null;
  assert.equal(events.filter(e => e === 'begin').length, 2);
  assert.deepEqual(session.snapshot().routes, []); assert.deepEqual(app.unsettledRuns(), []);

  // Destroy drains an in-flight encoder before releasing owned model resources.
  events.length = 0; state.encodeHold = deferred();
  pending = generator.generate({ text: 'Walk.', seed: 10 });
  const destroyedRun = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  const destroyed = generator.destroy();
  assert(!events.includes('den.destroy')); assert(!events.includes('t5.destroy'));
  state.encodeHold.resolve(); await destroyed; await destroyedRun; state.encodeHold = null;
  assert(events.indexOf('finished') < events.indexOf('den.destroy'));
  assert.equal(events.filter(e => e === 'den.destroy').length, 1);
  await generator.destroy();
  await assert.rejects(generator.generate({ text: 'Walk.', seed: 11 }), /destroyed/);
  assert.equal(session.snapshot().status, 'active'); assert.equal(app.foreground.snapshot().disposed, false);
  await second.destroy();
  console.log('UniMate admission, controls, reuse, settlement and borrowed-host survival: pass');
} finally {
  gate?.resolve();
  state.encodeHold?.resolve(); state.solveHold?.resolve(); state.finishHold?.resolve();
  generator?.stop();
  await Promise.allSettled([pending, first?.completion]);
  if (blocker) { await blocker.drain(); session.unregisterRoute(blocker.routeId); }
  hooks.deregister(); globalThis.fetch = originalFetch;
  delete globalThis.__unimateApplicationTest;
  session.close(); await app.foreground.dispose();
}
