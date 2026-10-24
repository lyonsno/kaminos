// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const path = new URL('../src/sam31-video-tracker.js', import.meta.url);
assert.ok(existsSync(path), 'live tracking needs an owned or borrowed resident session');
const { createSam31VideoTrackerForTest } = await import(path);
function fixture() {
  const events = [], listeners = new Map();
  let status = 'active', failSetup = false, failFrame = false, loseFrame = false;
  const device = { queue: { async onSubmittedWorkDone() { events.push('queue-drained'); } },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const session = { sessionId: 'shared', adapter: { info: { description: 'mock' } }, device,
    snapshot: () => ({ status }), deviceLost: new Promise(() => {}),
    async registerRoute({ routeId }) { events.push('registered'); return { routeId, async drain() { events.push('route-drained'); } }; },
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
        async execute({ frameIndex }) {
          if (failFrame) throw new Error('phase failed');
          if (loseFrame) status = 'device-lost';
          const data = n => new Float32Array(n).fill(frameIndex);
          return { frameIndex, sourceImageSha256: 'test-source', maskWidth: 2, maskHeight: 2, maskLogits: data(64), objectScores: data(16),
            memory: { memory: data(8), memoryPosition: data(8), image: data(8), imagePosition: data(8), pointers: data(32) } };
        }, close() { events.push('driver-closed'); } };
    },
  };
  return { events, listeners, session, packageRuntime, deps,
    failSetup() { failSetup = true; }, failFrame(value) { failFrame = value; }, loseFrame() { loseFrame = true; } };
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
console.log('SAM3.1 video tracker session ownership and failure contracts passed (mock device)');
