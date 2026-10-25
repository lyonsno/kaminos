// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createWebGpuForegroundService } from '../src/foreground-opportunity.js';
const path = new URL('../src/sam31-video-tracker.js', import.meta.url);
assert.ok(existsSync(path), 'live tracking needs an owned or borrowed resident session');
const { createSam31VideoTrackerForTest } = await import(path);
function fixture() {
  const events = [], listeners = new Map();
  let status = 'active', failSetup = false, failFrame = false, loseFrame = false, executeHook = null;
  const device = { queue: { submit() {}, async onSubmittedWorkDone() { events.push('queue-drained'); } },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const session = { sessionId: 'shared', adapter: { info: { description: 'mock' } }, device, queue: device.queue,
    snapshot: () => ({ status }), deviceLost: new Promise(() => {}),
    async registerRoute({ routeId, runtimeOptions }) {
      events.push('registered');
      return { routeId,
        runtime: { device, queue: device.queue, routeId,
          runInvocation: ({ invocationId }, work) => work({ invocationId, routeId }),
          async prepareCommandDutyAtBoundary(input, invocation) {
            await runtimeOptions.foregroundOpportunities.serviceAtBoundary({ ...input, ...invocation,
              boundaryId: `${invocation.invocationId}:${events.length}`, dutyId: `${invocation.invocationId}:${events.length}`, position: 'before-encode' });
            return input;
          }, settleCommandDuty() {},
        },
        enqueue({ execute }) {
          events.push('admitted');
          const completion = Promise.resolve().then(execute).then(output => ({ status: 'succeeded', output }),
            error => ({ status: 'failed', failure: { name: error.name, message: error.message } }));
          return { completion, cancel() {} };
        }, async drain() { events.push('route-drained'); } };
    },
    unregisterRoute() { events.push('detached'); return { status: 'detached' }; },
    close() { events.push('session-closed'); return { status: 'closed' }; } };
  const packageRuntime = { packageId: 'test-package', modelPackage: { components: { stream: { schema: 'kaminos.sam31-stream-model.v1' } } } };
  const deps = {
    loadRuntime: async () => packageRuntime,
    createInferenceSession: async () => { events.push('device-created'); return session; },
    createResources: async () => ({ loadFloat32: () => new Float32Array([1]), loadUint8: () => new Uint8Array(4),
      bind() { events.push('bound'); }, residentTensorResolver: () => null,
      release() { events.push('released'); return { status: 'released' }; } }),
    async createDriver({ packageRuntime: runtime }) {
      if (failSetup) throw new Error('bad model tensor');
      await runtime.loadFloat32({});
      return { imageWidth: 2, imageHeight: 2,
        config: { frameTokenCount: 4, channels: 2, multiplexCount: 16, numMaskmem: 7, maxObjectPointerFrames: 16, maxConditioningFrames: 4 },
        async execute(input) {
          const { frameIndex } = input;
          await executeHook?.(input);
          if (failFrame) throw new Error('phase failed');
          if (loseFrame) status = 'device-lost';
          const data = n => new Float32Array(n).fill(frameIndex);
          return { frameIndex, sourceImageSha256: 'test-source', maskWidth: 2, maskHeight: 2, maskLogits: data(64), objectScores: data(16),
            memory: { memory: data(8), memoryPosition: data(8), image: data(8), imagePosition: data(8), pointers: data(32) } };
        }, close() { events.push('driver-closed'); } };
    },
  };
  return { events, listeners, session, packageRuntime, deps,
    failSetup() { failSetup = true; }, failFrame(value) { failFrame = value; }, loseFrame() { loseFrame = true; },
    onExecute(hook) { executeHook = hook; } };
}
const options = { modelPackageRoot: 'https://example.test/model.json', cache: {} };
const input = timestamp => ({ rgba: new Uint8Array(16), timestamp });
{
  const f = fixture();
  f.session.adapter.info = { vendor: 'google', architecture: 'swiftshader', description: '' };
  const tracker = await createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session }, f.deps);
  assert.equal(tracker.adapterInfo.isFallbackAdapter, true, 'the video API must retain effective software-backend identity');
  await tracker.close();
}
for (const borrowed of [false, true]) {
  const f = fixture();
  const tracker = await createSam31VideoTrackerForTest({ ...options, ...(borrowed ? { inferenceSession: f.session } : {}) }, f.deps);
  assert.equal(tracker.packageId, 'test-package');
  assert.equal(tracker.snapshot().completedFrames, 0);
  await tracker.initialize({ ...input(0), mask: new Uint8Array([1, 0, 0, 0]) });
  await tracker.track(input(1));
  f.failFrame(true);
  await assert.rejects(tracker.track(input(2)), /phase failed/);
  assert.equal(tracker.snapshot().completedFrames, 2);
  f.failFrame(false);
  await tracker.track(input(2));
  await tracker.close(); await tracker.close();
  assert.equal(f.events.filter(e => e === 'released').length, 1);
  assert.equal(f.events.includes('session-closed'), !borrowed, 'borrowed session remains owned by its caller');
  assert.ok(f.events.indexOf('released') < f.events.indexOf('detached'));
  assert.equal(f.listeners.size, 0);
  await assert.rejects(tracker.track(input(3)), /closed/);
}
{
  const f = fixture(); f.failSetup();
  await assert.rejects(createSam31VideoTrackerForTest(options, f.deps), /bad model tensor/);
  assert.ok(f.events.includes('released') && f.events.includes('detached') && f.events.includes('session-closed'));
  assert.equal(f.listeners.size, 0);
}
{
  const f = fixture(); delete f.packageRuntime.modelPackage.components.stream;
  await assert.rejects(createSam31VideoTrackerForTest(options, f.deps), /stream model/);
  assert.deepEqual(f.events, [], 'fixture-only model rejection precedes device allocation');
}
{
  const f = fixture(), tracker = await createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session }, f.deps);
  f.loseFrame();
  await assert.rejects(tracker.initialize({ ...input(0), mask: new Uint8Array([1, 0, 0, 0]) }), /device-lost/);
  assert.equal(tracker.snapshot().completedFrames, 0, 'lost-device output cannot commit memory');
  await tracker.close();
}
{
  const f = fixture();
  const foregroundService = createWebGpuForegroundService({ device: f.session.device, routeId: 'host' });
  await assert.rejects(createSam31VideoTrackerForTest({ ...options, foregroundService }, f.deps), /borrowed/);
  assert.deepEqual(f.events, [], 'invalid foreground ownership is rejected before model/device work');
  await assert.rejects(createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session,
    foregroundService: { ...foregroundService, device: {} } }, f.deps), /device.*queue/);
  assert.deepEqual(f.events, []);
  await foregroundService.dispose();
}
{
  const f = fixture(), foregroundService = createWebGpuForegroundService({ device: f.session.device, routeId: 'host' });
  const tracker = await createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session, foregroundService }, f.deps);
  assert.equal(f.events.filter(e => e === 'admitted').length, 1, 'static uploads are one admitted operation');
  let frameReceipt;
  f.onExecute(async ({ schedule }) => {
    assert.equal(schedule.runtime.device, f.session.device);
    assert.equal(foregroundService.snapshot().activeRun.runId, schedule.invocation.invocationId);
    frameReceipt = foregroundService.request({ requestId: 'host-frame', run() {} }).completion;
    await schedule.runtime.prepareCommandDutyAtBoundary({ phase: 'mask', kind: 'compute' }, schedule.invocation);
  });
  await tracker.initialize({ ...input(0), mask: new Uint8Array([1, 0, 0, 0]) });
  assert.equal((await frameReceipt).status, 'completed');
  assert.equal(tracker.snapshot().completedFrames, 1);
  assert.equal(tracker.snapshot().scheduling.lastRun.status, 'succeeded');
  assert.equal(foregroundService.snapshot().activeRun, null);
  let entered;
  const starting = new Promise(resolve => { entered = resolve; });
  let advance;
  const gate = new Promise(resolve => { advance = resolve; });
  let encoded = false;
  f.onExecute(async ({ schedule }) => {
    entered(); await gate;
    await schedule.control.runDuty(async () => { encoded = true; });
  });
  const stopped = tracker.track(input(1));
  await starting;
  await tracker.pause();
  tracker.stop('operator stop'); advance();
  await assert.rejects(stopped, { name: 'AbortError' });
  assert.equal(encoded, false);
  assert.equal(tracker.snapshot().completedFrames, 1, 'stopped frames do not advance memory');
  f.onExecute(null);
  await tracker.track(input(1));
  assert.equal(tracker.snapshot().completedFrames, 2, 'a stopped frame can be retried');
  await tracker.close();
  assert.equal(foregroundService.snapshot().disposed, false);
  assert.equal(f.events.includes('session-closed'), false);
  await foregroundService.dispose();
}
for (const mode of ['stop', 'failure']) {
  const f = fixture(), foregroundService = createWebGpuForegroundService({ device: f.session.device, routeId: 'host' });
  const tracker = await createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session, foregroundService }, f.deps);
  f.onExecute(() => {
    foregroundService.request({ requestId: 'final-frame', run() {
      if (mode === 'stop') tracker.stop('stopped during foreground handback');
      else throw new Error('renderer failed');
    } });
  });
  await assert.rejects(tracker.initialize({ ...input(0), mask: new Uint8Array([1, 0, 0, 0]) }),
    mode === 'stop' ? { name: 'AbortError' } : error => error.errors?.some(cause => /foreground/.test(cause.message)));
  assert.equal(tracker.snapshot().completedFrames, 0, 'no memory commit before successful foreground handback');
  await tracker.close();
  assert.equal(foregroundService.snapshot().activeRun, null);
  await foregroundService.dispose();
}
{
  const f = fixture(), foregroundService = createWebGpuForegroundService({ device: f.session.device, routeId: 'host' });
  const tracker = await createSam31VideoTrackerForTest({ ...options, inferenceSession: f.session, foregroundService }, f.deps);
  let entered;
  const starting = new Promise(resolve => { entered = resolve; });
  let advance;
  const gate = new Promise(resolve => { advance = resolve; });
  f.onExecute(async ({ schedule }) => { entered(); await gate; await schedule.control.runDuty(async () => {}); });
  const running = tracker.initialize({ ...input(0), mask: new Uint8Array([1, 0, 0, 0]) });
  const rejected = assert.rejects(running, { name: 'AbortError' });
  await starting;
  await assert.rejects(tracker.track(input(1)), /busy/);
  const closed = tracker.close();
  advance(); await rejected; await closed;
  assert.equal(tracker.snapshot().status, 'closed');
  assert.equal(foregroundService.snapshot().activeRun, null);
  assert.equal(f.events.filter(e => e === 'released').length, 1);
  assert.equal(f.events.includes('session-closed'), false);
  await foregroundService.dispose();
}
console.log('SAM3.1 video tracker session ownership, foreground admission and cancellation contracts passed (mock device)');
