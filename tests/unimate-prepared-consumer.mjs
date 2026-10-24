// kaminos-test: node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Isolate model execution, exercising the actual consumer and GLB exporter.
// This checks routing of prepared inputs, not GPU or motion quality.
const calls = [];
let generateHold = null;
globalThis.__preparedConsumerTest = {
  create(options) {
    calls.push({ kind: 'create', options });
    let data = options.skeletonData;
    const gen = {
      get bundle() { return data?.b; },
      get skeleton() { const s = data.b.skeleton; return { ...s, rest: [[0, 1, 0], [0, 0, 0]] }; },
      async useSkeletonData(next) { calls.push({ kind: 'data', data: next }); data = next; },
      async useSkeleton(url) { throw Error(`unexpected stock skeleton: ${url}`); },
      hasTextEncoder: () => true,
      async generate(options) {
        calls.push({ kind: 'generate', data, options });
        options.onEvaluation?.({ evaluations: 6, t: .5, ms: 7 });
        options.onStep?.({ t0: 0, dt: .5, accepted: false, errorRatio: 2 }, 0);
        options.onEvaluation?.({ evaluations: 12, t: .1, ms: 9 });
        options.onStep?.({ t0: 0, dt: .1, accepted: true, errorRatio: .5 }, 1);
        await options.onPartial?.({ t: .5, index: 1, evaluations: 8, motion: { positions: new Float32Array(12) } });
        if (generateHold) await generateHold;
        return { motion: { frames: 2, joints: 2, positions: new Float32Array(12),
          localRotations: new Float32Array([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]), rootTranslation: new Float32Array(6) },
          evaluations: 2, steps: [], wallMs: 1, dutyCount: 1, textEncoder: 'browser T5' };
      },
      stop() { calls.push({ kind: 'stop' }); },
      async destroy() { calls.push({ kind: 'destroy' }); },
      async togglePause() { return 'paused'; },
    };
    return gen;
  },
};
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/unimate-generator.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createUniMateGenerator = async options => globalThis.__preparedConsumerTest.create(options);' };
  return next(url, context);
} });
try {
  const { createUniMateConsumer } = await import('../models/unimate/unimate-consumer.js');
  const prepared = name => ({ b: { schema: 'kaminos.unimate.demo-bundle.v0',
    skeleton: { name, jointNames: ['root', 'foot'], parents: [-1, 0], joints: 2, frames: 2, fps: 30 },
    outputTimes: [0, 1], prompts: [] }, a: { restPositions: new Float32Array([0,1,0,0,0,0]) } });
  const resolvedSession={registerRoute(){}};
  const consumer = createUniMateConsumer({ device: {}, session: () => Promise.resolve(resolvedSession), beginRun() {} });
  const first = prepared('edited cat');
  first.restFrame = { yaw: 0, scale: 2, offset: [1, 3, 0], rotation: [[1,0,0],[0,1,0],[0,0,1]] };
  const progress = [];
  const result = await consumer.run({ asset: { skeletonData: first }, prompt: 'A cat walks.', onProgress: s => progress.push(s.progress) });
  assert.deepEqual(result.report.solverEvaluations.map(e => e.ms), [7, 9]);
  const rejectedStep = progress.find(p => p?.rejectedSteps === 1 && p.attemptedSteps === 1);
  assert.equal(rejectedStep.acceptedT, 0, 'rejected trial time is not solved progress');
  const acceptedStep = progress.find(p => p?.acceptedSteps === 1);
  assert.equal(acceptedStep.acceptedT, .1); assert.equal(acceptedStep.attemptedSteps, 2);
  assert.equal(calls[0].options.session,resolvedSession,'asynchronous app session is resolved before model creation');
  assert.equal(calls[0].options.skeletonData, first, 'cold start uses edited conditioning directly');
  assert.equal(calls[0].options.bundleBase, null, 'cold start has no hidden stock skeleton dependency');
  assert.equal(result.skeleton.name, 'edited cat');
  assert.deepEqual(result.restFrame, first.restFrame, 'result retains the authored-to-canonical frame for playback');
  assert.equal(new DataView(result.glb.buffer, result.glb.byteOffset, result.glb.byteLength).getUint32(0, true), 0x46546c67);
  const second = prepared('edited dog');
  await consumer.run({ asset: { skeletonData: second }, prompt: 'A dog walks.', rtol: 1e-5, atol: 1e-8, cfgScale: 4,
    onPartial: sample => calls.push({ kind: 'partial', sample }) });
  const configured = calls.filter(c => c.kind === 'generate').at(-1).options;
  assert.equal(configured.rtol, 1e-5); assert.equal(configured.atol, 1e-8); assert.equal(configured.cfgScale, 4);
  assert.equal(calls.find(c => c.kind === 'partial').sample.textEncoder, 'browser T5');
  assert.equal(calls.filter(c => c.kind === 'create').length, 1, 'weights stay resident across input changes');
  assert.equal(calls.filter(c => c.kind === 'generate').at(-1).data, second, 'warm run uses latest edited conditioning');
  for (const asset of [{ skeletonData: null }, { skeletonData: first, skeleton: 'dog' }, { skeletonData: first, bytes: new ArrayBuffer(1) }]) {
    const before = calls.length;
    await assert.rejects(consumer.run({ asset, prompt: 'Walk.' }), /skeletonData|input/i);
    assert.equal(calls.length, before, 'invalid or conflicting input refuses before model work');
  }
  assert.equal(await consumer.togglePause(), 'paused');
  let release;
  generateHold = new Promise(resolve => { release = resolve; });
  const inFlight = consumer.run({ asset: { skeletonData: second }, prompt: 'A dog runs.' });
  const rejected = assert.rejects(inFlight, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  const closing = consumer.destroy();
  assert.equal(calls.filter(c => c.kind === 'destroy').length, 0, 'wait for the operation before destroying the generator');
  release(); await closing; await rejected;
  await consumer.destroy();
  assert.equal(calls.filter(c => c.kind === 'destroy').length, 1);
  assert.equal(consumer.read().phase, 'destroyed');
  assert.equal(consumer.read().last.prompt, 'A dog walks.', 'a stopped generation cannot overwrite the prior output');
  await assert.rejects(consumer.run({ asset: { skeletonData: first }, prompt: 'Walk.' }), /destroyed/);
  console.log('prepared consumer routing: pass');
} finally {
  hooks.deregister();
  delete globalThis.__preparedConsumerTest;
}
