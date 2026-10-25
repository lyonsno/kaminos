// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { withSamPhaseCleanup } from '../src/sam-phase-cleanup.js';
import { createWebGpuInferenceControl } from '../src/inference-control.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const events = [], abort = new AbortController();
  const queue = { async onSubmittedWorkDone() { events.push('fence'); } };
  const device = { queue };
  const runtime = { device, queue, routeId: 'sam-phase',
    async runKernel(kernel) { events.push(`kernel:${kernel}`); return kernel; },
    async readTensor(tensor) { events.push(`read:${tensor}`); return tensor; },
    dispose() { events.push('disposed'); return { disposed: true }; } };
  const schedule = { signal: abort.signal,
    control: createWebGpuInferenceControl({ queue, signal: abort.signal }),
    runtime: { device, queue, routeId: 'sam-frame',
      async prepareCommandDutyAtBoundary(input, invocation) {
        assert.equal(invocation.invocationId, 'frame:1');
        events.push(`admit:${input.kind}`); return input;
      },
      settleCommandDuty(duty, result) { events.push(`settle:${duty.kind}:${result.status}`); },
    }, invocation: { invocationId: 'frame:1', routeId: 'sam-frame' } };
  return { runtime, schedule, events, abort };
}

test('SAM gates its actual kernel and readback calls, preserving values and restoring methods', async () => {
  const { runtime, schedule, events } = fixture();
  const kernel = runtime.runKernel, read = runtime.readTensor;
  const result = await withSamPhaseCleanup(runtime, async () => ({
    kernel: await runtime.runKernel('attention'), pixels: await runtime.readTensor('mask'),
  }), schedule);
  assert.deepEqual(events, ['admit:compute', 'kernel:attention', 'settle:compute:encoded',
    'admit:readback', 'read:mask', 'settle:readback:encoded', 'disposed']);
  assert.equal(result.kernel, 'attention'); assert.equal(result.pixels, 'mask');
  assert.equal(result.resourceDisposal.disposed, true);
  assert.equal(runtime.runKernel, kernel); assert.equal(runtime.readTensor, read);
  await schedule.control.close();
});

test('pause waits the admitted duty, then blocks the next kernel and readback until resume', async () => {
  const { runtime, schedule, events } = fixture();
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  runtime.runKernel = async name => { events.push(`kernel:${name}`); entered(); await pending; return name; };
  let continueFrame;
  const afterPause = new Promise(resolve => { continueFrame = resolve; });
  const run = withSamPhaseCleanup(runtime, async () => {
    await runtime.runKernel('first');
    await afterPause;
    await runtime.runKernel('second');
    await runtime.readTensor('mask');
    return {};
  }, schedule);
  await started;
  let acknowledged = false;
  const paused = schedule.control.pause().then(() => { acknowledged = true; });
  await turn(); assert.equal(acknowledged, false);
  finish(); await paused;
  continueFrame(); await turn();
  assert.equal(events.includes('kernel:second'), false);
  assert.equal(events.includes('read:mask'), false);
  await schedule.control.resume(); await run;
  assert.equal(events.includes('kernel:second'), true);
  assert.equal(events.includes('read:mask'), true);
  await schedule.control.close();
});

test('Stop while paused prevents another encode, preserves AbortError and disposes the phase', async () => {
  const { runtime, schedule, events, abort } = fixture();
  await schedule.control.pause();
  const run = withSamPhaseCleanup(runtime, async () => {
    await runtime.runKernel('must-not-run'); return {};
  }, schedule);
  abort.abort('operator stopped');
  await assert.rejects(run, error => error.name === 'AbortError');
  assert.equal(events.some(value => value.startsWith('kernel:')), false);
  assert.equal(events.filter(value => value === 'disposed').length, 1);
  await schedule.control.close();
});

test('foreign devices, queues and invocation identity fail before the phase prepares work', async () => {
  for (const change of [f => { f.schedule.runtime.device = {}; },
    f => { f.schedule.runtime.queue = {}; }, f => { f.schedule.invocation.routeId = 'wrong'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(withSamPhaseCleanup(f.runtime, async () => {
      f.events.push('prepared'); return {};
    }, f.schedule), /schedule/);
    assert.deepEqual(f.events, ['disposed']);
    await f.schedule.control.close();
  }
});

test('foreground admission failure cannot encode and still releases phase resources', async () => {
  const { runtime, schedule, events } = fixture();
  const failure = new Error('foreground failed');
  schedule.runtime.prepareCommandDutyAtBoundary = async () => { throw failure; };
  await assert.rejects(withSamPhaseCleanup(runtime, async () => {
    await runtime.runKernel('must-not-run'); return {};
  }, schedule), error => error === failure);
  assert.deepEqual(events, ['disposed']);
  await schedule.control.close();
});

test('an admitted kernel failure is settled and retains its original error', async () => {
  const { runtime, schedule, events } = fixture();
  const failure = new Error('kernel failed');
  runtime.runKernel = async () => { throw failure; };
  await assert.rejects(withSamPhaseCleanup(runtime, async () => {
    await runtime.runKernel('bad'); return {};
  }, schedule), error => error === failure);
  assert.deepEqual(events, ['admit:compute', 'settle:compute:failed', 'disposed']);
  await schedule.control.close();
});
