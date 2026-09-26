import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../src/core.js';

test('one renderer requester survives A-B-A handoff and drains prior frames', async () => {
  assert.equal(typeof core.createWebGpuForegroundRouteHandoff, 'function');
  const device = { queue: { submit() {} } };
  const events = [];
  const pending = new Map();
  function producer(routeId) {
    return {
      routeId, device, queue: device.queue,
      request(input) {
        events.push(`${routeId}:${input.requestId}`);
        let resolve;
        const completion = new Promise(done => { resolve = done; });
        pending.set(input.requestId, resolve);
        return { completion, cancel() { resolve({ status: 'canceled-before-service' }); } };
      },
    };
  }
  const handoff = core.createWebGpuForegroundRouteHandoff({ device });
  const a = producer('model-a');
  const b = producer('model-b');
  await handoff.activate(a);
  const first = handoff.request({ requestId: 'first', run() {} });
  let switched = false;
  const switching = handoff.activate(b).then(() => { switched = true; });
  await Promise.resolve();
  assert.equal(switched, false);
  assert.equal(handoff.snapshot().routeId, null);
  const interim = handoff.request({ requestId: 'interim', run() {} });
  assert.equal(events.includes('model-b:interim'), false);
  pending.get('first')({ status: 'completed' });
  await first.completion;
  await switching;
  assert.equal(handoff.snapshot().routeId, 'model-b');
  const second = handoff.request({ requestId: 'second', run() {} });
  assert.deepEqual(events, ['model-a:first', 'model-b:second']);
  second.cancel();
  await second.completion;
  await interim.completion;
  await handoff.activate(a);
  const third = handoff.request({ requestId: 'third', run() {} });
  pending.get('third')({ status: 'completed' });
  await third.completion;
  assert.deepEqual(events, ['model-a:first', 'model-b:second', 'model-a:third']);
  await handoff.dispose();
  assert.throws(() => handoff.request({ requestId: 'after', run() {} }), /disposed/);
});

test('failed provider request leaves the stable requester usable', async () => {
  assert.equal(typeof core.createWebGpuForegroundRouteHandoff, 'function');
  const device = { queue: { submit() {} } };
  const handoff = core.createWebGpuForegroundRouteHandoff({ device });
  await handoff.activate({ routeId: 'failed', device, queue: device.queue, request() { throw new Error('producer failed'); } });
  assert.throws(() => handoff.request({ requestId: 'bad', run() {} }), /producer failed/);
  await handoff.deactivate();
  const frame = handoff.request({ requestId: 'idle', run() { return { status: 'submitted' }; } });
  assert.equal((await frame.completion).status, 'completed');
  await handoff.dispose();
});

test('mismatched providers are rejected without losing the current route', async () => {
  const device = { queue: { submit() {} } };
  const handoff = core.createWebGpuForegroundRouteHandoff({ device });
  const valid = { routeId: 'sam', device, queue: device.queue, request() {
    return { completion: Promise.resolve({ status: 'completed' }), cancel() {} };
  } };
  await handoff.activate(valid);
  await assert.rejects(() => handoff.activate({ ...valid, routeId: 'sf3d', queue: { submit() {} } }), /matching device and queue/);
  assert.equal(handoff.snapshot().routeId, 'sam');
  await handoff.dispose();
});

test('a rejected outgoing callback is observed and cannot strand the next route', async () => {
  const device = { queue: { submit() {} } };
  const handoff = core.createWebGpuForegroundRouteHandoff({ device });
  let rejectFrame;
  await handoff.activate({ routeId: 'sam', device, queue: device.queue, request() {
    return { completion: new Promise((resolve, reject) => { rejectFrame = reject; }), cancel() {} };
  } });
  const frame = handoff.request({ requestId: 'rejected', run() {} });
  const next = handoff.activate({ routeId: 'sf3d', device, queue: device.queue, request() {
    return { completion: Promise.resolve({ status: 'completed' }), cancel() {} };
  } });
  rejectFrame(new Error('failed renderer callback'));
  await assert.rejects(frame.completion, /failed renderer callback/);
  await next;
  assert.equal(handoff.snapshot().routeId, 'sf3d');
  assert.equal((await handoff.request({ requestId: 'next', run() {} }).completion).status, 'completed');
  await handoff.dispose();
});

test('SAM-SF3D-SAM route lifecycle keeps one borrowed device and retained results', async () => {
  const submissions = [];
  const device = {
    queue: { submit(buffers) { submissions.push(buffers); } },
    features: new Set(), limits: {}, lost: new Promise(() => {}),
  };
  const session = await core.createWebGpuInferenceSession({ sessionId: 'two-model-app', device, adapterName: 'test-adapter' });
  const handoff = core.createWebGpuForegroundRouteHandoff({ device });
  const results = [];
  const routeIds = ['sam.image-mask.webgpu-local.v0', 'sf3d.image-to-mesh.webgpu-local.v0', 'sam.image-mask.webgpu-local.v0'];
  try {
    for (const [index, routeId] of routeIds.entries()) {
      const service = core.createWebGpuForegroundService({ routeId, device });
      const active = await service.beginRun(`${routeId}:${index}`);
      const route = await session.registerRoute({ routeId, runtimeOptions: {
        foregroundOpportunities: active.foregroundOpportunities,
      } });
      await handoff.activate({ routeId, device, queue: device.queue, request: input => service.request(input) });
      const output = `${routeId}:result:${index}`;
      const job = route.enqueue({ jobId: `${routeId}:${index}`, async execute() {
        const frame = handoff.request({ requestId: `frame:${index}`, run(opportunity) {
          opportunity.submit([{ model: routeId }]);
          return { rendered: true };
        } });
        try {
          await active.foregroundOpportunities.serviceAtBoundary({
            invocationId: `${routeId}:${index}`, boundaryId: `boundary:${index}`,
            dutyId: `duty:${index}`, phase: 'model-compute', position: 'before-encode',
          });
          assert.equal((await frame.completion).status, 'completed');
        } finally { frame.cancel(); }
        return output;
      } });
      const completion = await job.completion;
      assert.equal(completion.status, 'succeeded');
      results.push(completion.output);
      await route.drain();
      await handoff.deactivate();
      await active.finish();
      session.unregisterRoute(routeId);
      await service.dispose();
      assert.equal(session.device, device);
    }
    assert.deepEqual(results, routeIds.map((routeId, index) => `${routeId}:result:${index}`));
    assert.equal(submissions.length, 3);
    const idle = handoff.request({ requestId: 'after-runs', run(opportunity) { opportunity.submit([{}]); } });
    assert.equal((await idle.completion).status, 'completed');
  } finally {
    await handoff.dispose();
    await session.drain();
    session.close();
  }
});
