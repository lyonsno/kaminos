// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebGpuForegroundService } from '../src/foreground-opportunity.js';
import { createSam3ApplicationForeground } from '../src/sam3-application-foreground.js';
import { createSam3BrowserImageRuntime } from '../src/sam3-browser-image-runtime.js';
import { SAM3_BROWSER_RESIDENT_MODEL_OWNER_ROUTE_ID as routeId } from '../src/sam3-browser-resident-model-session.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { resolve, promise };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture({ fence = async () => {}, now } = {}) {
  const events = [];
  const queue = { submit: commands => events.push(...commands),
    async onSubmittedWorkDone() { events.push('fence'); await fence(); } };
  const device = { queue, destroy() { assert.fail('application device must remain borrowed'); } };
  const service = createWebGpuForegroundService({ device, queue, routeId: 'kaminos-app', now });
  const session = { device, queue, close() { assert.fail('application session must remain borrowed'); },
    enqueue() { assert.fail('the foreground join must not introduce another model admission'); } };
  const join = createSam3ApplicationForeground({ inferenceSession: session, foregroundService: service,
    yieldToBrowser: async metadata => { events.push(metadata.reason); } });
  const frame = id => service.request({ requestId: id, run(context) { context.submit([id]); } });
  return { events, service, session, join, frame };
}

test('the runtime validates the real common service before acquiring model state', async () => {
  const { service, session } = fixture();
  const runtime = createSam3BrowserImageRuntime({ baseUrl: 'http://localhost/', inferenceSession: session, foregroundService: service });
  assert.equal(runtime.output(), null);
  assert.equal(service.snapshot().runCount, 0);
  await assert.rejects(runtime.run('/unused-model.json', { verificationMode: 'reference-parity' }), /requires execution-only mode/);
  assert.equal(service.snapshot().runCount, 0);
  await runtime.close();
  assert.equal(service.snapshot().disposed, false);
  assert.throws(() => createSam3ApplicationForeground({ inferenceSession: session,
    foregroundService: { ...service, beginRun: null } }), /beginRun/);
  assert.throws(() => createSam3ApplicationForeground({ inferenceSession: session,
    foregroundService: service, yieldToBrowser: 'wrong' }), /function/);
});

test('one admitted detector operation services app frames and keeps its exact result', async () => {
  const { events, service, join, frame } = fixture();
  const result = { invocationId: 'sam-1', masks: new Uint8Array([1, 0]) };
  assert.equal((await frame('idle-before').completion).runId, null);
  let insideFrame;
  const returned = await join.execute('sam-1', async () => {
    assert.equal(service.snapshot().activeRun.routeId, routeId);
    insideFrame = frame('app-during-sam');
    events.push('model-duty');
    await join.yield({ reason: 'after-image-attention', metadata: { layerIndex: 7 } });
    events.push('next-model-duty');
    return result;
  });
  assert.equal(returned, result);
  const receipt = await insideFrame.completion;
  assert.equal(receipt.routeId, routeId);
  assert.equal(receipt.runId, 'sam-1');
  assert.equal(receipt.boundary.phase, 'after-image-attention');
  assert.deepEqual(receipt.boundary.metadata, { layerIndex: 7 });
  assert.deepEqual(events, ['idle-before', 'model-duty', 'fence', 'app-during-sam', 'after-image-attention', 'next-model-duty', 'fence']);
  assert.equal(service.snapshot().activeRun, null);
  assert.equal(join.evidence().lastRun.status, 'succeeded');
  assert.equal((await frame('idle-after').completion).runId, null);
  assert.equal(service.snapshot().disposed, false);
});

test('warm runs have distinct foreground identity without another session queue', async () => {
  const { service, join, frame } = fixture();
  const resources = { resident: true };
  for (const id of ['cold', 'warm']) {
    await join.execute(id, async () => {
      const pending = frame(`frame-${id}`);
      await join.yield({ reason: 'boundary' });
      assert.equal((await pending.completion).runId, id);
      return resources;
    });
    assert.equal(join.evidence().lastRun.runId, id);
    join.assertSettled();
  }
  assert.equal(service.snapshot().runCount, 2);
  assert.equal(service.snapshot().disposed, false);
});

test('handback waits queued foreground callbacks before a model can follow SAM', async () => {
  const { service, join } = fixture();
  const gate = deferred(), started = deferred();
  let frame, returned = false;
  const running = join.execute('finishing', async () => {
    frame = service.request({ requestId: 'slow-frame', async run(context) {
      started.resolve(); await gate.promise; context.submit(['slow-frame']);
    } });
    return 42;
  }).then(value => { returned = true; return value; });
  await started.promise;
  await turn();
  assert.equal(returned, false);
  assert.throws(() => service.beginRun('another-model'), /active run/);
  await assert.rejects(join.execute('overlap', async () => {}), /unsettled/);
  gate.resolve();
  assert.equal(await running, 42);
  assert.equal((await frame.completion).status, 'completed');
  const next = await service.beginRun('another-model', { routeId: 'other-model' });
  await next.finish();
});

test('detector failure settles foreground without destroying the app and permits retry', async () => {
  const { service, join, frame } = fixture();
  const failure = new Error('detector failed');
  await assert.rejects(join.execute('failed', async () => { frame('failure-frame'); throw failure; }), error => error === failure);
  join.assertSettled();
  assert.equal(service.snapshot().activeRun, null);
  assert.equal((await frame('after-failure').completion).runId, null);
  assert.equal(await join.execute('retry', async () => 17), 17);
});

test('reported frame failure is not silently treated as a successful app composition', async () => {
  const { join, service } = fixture();
  await assert.rejects(join.execute('bad-frame', async () => {
    service.request({ requestId: 'bad', run() { throw new Error('renderer failed'); } });
    await join.yield({ reason: 'boundary' });
  }), /foreground callback failed/);
  assert.ok(join.evidence().lastRun.receipts[0].failure);
  join.assertSettled();
  assert.equal(service.snapshot().activeRun, null);
});

test('a callback failure in the final foreground drain rejects the mask result', async () => {
  const { join, service } = fixture();
  await assert.rejects(join.execute('bad-final-frame', async () => {
    service.request({ requestId: 'bad-final', run() { throw new Error('renderer failed'); } });
    return { masks: [1] };
  }), /foreground callback failed/);
  assert.ok(join.evidence().lastRun.receipts[0].failure);
  join.assertSettled();
});

test('queue settlement failure retains model ownership instead of certifying unload', async () => {
  const failure = new Error('queue completion unknown');
  const { join, service } = fixture({ fence: async () => { throw failure; } });
  await assert.rejects(join.execute('unsettled', async () => 5), error => error.errors.includes(failure));
  assert.equal(join.evidence().status, 'settlement-failed');
  assert.throws(join.assertSettled, /retain the model resources/);
  await assert.rejects(join.execute('retry', async () => 6), /unsettled/);
  assert.equal(service.snapshot().disposed, false);
});

test('admission refusal does not latch a run SAM never acquired', async () => {
  const { join, service } = fixture();
  const existing = await service.beginRun('other-model');
  await assert.rejects(join.execute('sam', async () => assert.fail('refused detector must not execute')), /active run/);
  join.assertSettled();
  await existing.finish();
  assert.equal(await join.execute('sam-retry', async () => 9), 9);
  await assert.rejects(join.yield({ reason: 'outside' }), /admitted detector/);
});

test('non-Error detector rejection remains a failure after successful handback', async () => {
  const { join } = fixture();
  for (const failure of [null, undefined, 0, 'failed']) {
    let rejected = false;
    try { await join.execute(`failure-${String(failure)}`, async () => { throw failure; }); }
    catch (error) { rejected = true; assert.equal(error, failure); }
    assert.equal(rejected, true);
    join.assertSettled();
  }
});
