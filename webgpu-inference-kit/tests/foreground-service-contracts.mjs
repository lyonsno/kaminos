import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as kit from '../src/index.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const boundary = { invocationId: 'i', boundaryId: 'b', dutyId: 'd', phase: 'gpu', position: 'before-encode' };
const frame = requestId => ({ requestId, run: ctx => { ctx.submit([requestId]); return requestId; } });
function fixture(overrides = {}) {
  const submissions = [];
  const device = { queue: { submit: buffers => submissions.push(...buffers) }, destroy() { assert.fail('borrowed device destroyed'); } };
  // Replay the first behavioral falsifier against the pre-existing public primitive.
  const factory = process.env.KIT_FOREGROUND_BASELINE === '1'
    ? kit.createWebGpuForegroundOpportunityInterlock : kit.createWebGpuForegroundService;
  return { service: factory({ routeId: 'model', runId: 'legacy', device, queue: device.queue, ...overrides }), submissions, device };
}

test('a frame completes without an inference run or fabricated consumer boundary', async () => {
  const { service, submissions } = fixture();
  const handle = service.request(frame('idle'));
  await turn();
  assert.deepEqual(submissions, ['idle'], 'idle renderer must not wait forever for a model boundary');
  const receipt = await handle.completion;
  assert.equal(receipt.runId, null);
  assert.equal(receipt.submissionCount, 1);
  assert.equal(receipt.schema, kit.WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA);
  await service.dispose();
});

if (process.env.KIT_FOREGROUND_BASELINE !== '1') {
  test('beginRun waits existing foreground callbacks and queues new frames at model boundaries', async () => {
    const { service, submissions } = fixture();
    const gate = deferred();
    const started = deferred();
    const idle = service.request({ requestId: 'idle', async run(ctx) { started.resolve(); await gate.promise; ctx.submit(['idle']); } });
    await started.promise;
    let began = false;
    const beginning = service.beginRun('first').then(run => { began = true; return run; });
    const active = service.request(frame('active'));
    await turn();
    assert.equal(began, false);
    assert.deepEqual(submissions, []);
    gate.resolve();
    const run = await beginning;
    await idle.completion;
    assert.deepEqual(submissions, ['idle']);
    await run.foregroundOpportunities.serviceAtBoundary(boundary);
    assert.equal((await active.completion).runId, 'first');
    assert.deepEqual(submissions, ['idle', 'active']);
    assert.equal((await run.finish()).status, 'succeeded');
    const next = await service.beginRun('second');
    assert.throws(() => run.foregroundOpportunities.request(frame('stale')), /finished/);
    await next.finish();
    await service.dispose();
  });

  test('explicit CPU window serves arrivals and drains callbacks before returning to GPU', async () => {
    const { service, submissions } = fixture();
    const run = await service.beginRun('cpu');
    const work = deferred();
    const callback = deferred();
    const callbackStarted = deferred();
    let returned = false;
    const scope = run.withForeground('uv-worker', () => work.promise).then(value => { returned = true; return value; });
    const handle = service.request({ requestId: 'frame', async run(ctx) { callbackStarted.resolve(); await callback.promise; ctx.submit(['frame']); } });
    await callbackStarted.promise;
    assert.throws(() => run.foregroundOpportunities.serviceAtBoundary(boundary), /CPU|foreground window/);
    assert.throws(() => run.finish(), /CPU|foreground window/);
    work.resolve(42);
    await turn();
    assert.equal(returned, false, 'model continuation must wait for active foreground callbacks');
    callback.resolve();
    assert.equal(await scope, 42);
    assert.equal((await handle.completion).boundary.phase, 'uv-worker');
    assert.deepEqual(submissions, ['frame']);
    const queued = service.request(frame('next'));
    await turn();
    assert.deepEqual(submissions, ['frame'], 'closed CPU window must not autonomously service model-phase requests');
    await run.foregroundOpportunities.serviceAtBoundary(boundary);
    await queued.completion;
    await run.finish();
  });

  test('worker failure closes its window and allows finish then another run', async () => {
    const { service } = fixture();
    const run = await service.beginRun('failed-worker');
    await assert.rejects(run.withForeground('worker', async () => { throw new Error('worker failed'); }), /worker failed/);
    assert.equal((await run.finish()).status, 'succeeded');
    const next = await service.beginRun('recovery');
    await next.finish();
  });

  test('finish drains queued and in-flight work; late requests settle outside the retired run', async () => {
    const { service, submissions } = fixture();
    const run = await service.beginRun('finishing');
    const gate = deferred();
    const started = deferred();
    const first = service.request({ requestId: 'first', async run(ctx) { started.resolve(); await gate.promise; ctx.submit(['first']); } });
    const servicing = run.foregroundOpportunities.serviceAtBoundary(boundary);
    await started.promise;
    const pending = service.request(frame('pending'));
    const finishing = run.finish();
    assert.equal(run.finish(), finishing, 'finish is idempotent');
    assert.throws(() => service.beginRun('overlap'), /active run/);
    assert.throws(() => run.foregroundOpportunities.serviceAtBoundary(boundary), /finished|finishing/);
    const late = service.request(frame('late'));
    await turn();
    assert.deepEqual(submissions, []);
    gate.resolve();
    await servicing;
    assert.equal((await finishing).status, 'succeeded');
    assert.equal((await first.completion).runId, 'finishing');
    assert.equal((await pending.completion).runId, 'finishing');
    assert.equal((await late.completion).runId, null);
    assert.deepEqual(submissions, ['first', 'pending', 'late']);
  });

  test('a rejected finish quarantines the model run without blocking later renderer requests', async () => {
    let clockReads = 0;
    const unhandledRejections = [];
    const collectUnhandled = reason => unhandledRejections.push(reason);
    process.on('unhandledRejection', collectUnhandled);
    const { service, submissions } = fixture({ now() {
      clockReads += 1;
      if (clockReads === 6) throw new Error('finish receipt clock failed');
      return clockReads;
    } });
    try {
      const run = await service.beginRun('quarantined');
      const modelRequest = service.request(frame('last-model-boundary'));

      await assert.rejects(run.finish(), /finish receipt clock failed/);
      assert.deepEqual(submissions, ['last-model-boundary']);
      const modelOutcome = await Promise.race([
        modelRequest.completion.then(receipt => ({ state: 'settled', receipt })),
        turn().then(() => ({ state: 'pending' })),
      ]);
      assert.equal(modelOutcome.state, 'settled', 'every captured request must receive a terminal receipt');
      assert.equal(modelOutcome.receipt.status, 'failed-after-submission');
      assert.equal(modelOutcome.receipt.submissionCount, 1);
      assert.equal(modelOutcome.receipt.settledAtMs, null, 'failed clock must not invent a settlement time');
      assert.equal(modelOutcome.receipt.elapsedMs, null, 'elapsed time is unknown when settlement time is unavailable');
      assert.equal(modelOutcome.receipt.failure.phase, 'foreground-receipt-timing');
      assert.match(modelOutcome.receipt.failure.error.message, /finish receipt clock failed/);

      const renderer = service.request(frame('renderer-after-rejection'));
      await turn();
      assert.deepEqual(submissions, ['last-model-boundary', 'renderer-after-rejection']);
      assert.equal((await renderer.completion).runId, null);
      assert.equal(service.snapshot().activeRun.runId, 'quarantined');
      assert.equal(service.snapshot().activeRun.finishing, true);
      assert.throws(() => service.beginRun('must-not-reuse'), /active run/);
      assert.throws(() => service.dispose(), /active run/);
      assert.deepEqual(unhandledRejections, [], 'finish rejection must not poison the outside-run service queue');
    } finally {
      process.off('unhandledRejection', collectUnhandled);
    }
  });

  test('an idle receipt timing failure settles its request and releases later renderer requests', async () => {
    let clockReads = 0;
    const unhandledRejections = [];
    const collectUnhandled = reason => unhandledRejections.push(reason);
    process.on('unhandledRejection', collectUnhandled);
    const { service, submissions } = fixture({ now() {
      clockReads += 1;
      if (clockReads === 6) throw new Error('idle receipt clock failed');
      return clockReads;
    } });
    try {
      const failed = service.request(frame('idle-clock-failure'));
      const failedReceipt = await failed.completion;
      assert.equal(failedReceipt.status, 'failed-after-submission');
      assert.equal(failedReceipt.settledAtMs, null);
      assert.equal(failedReceipt.failure.phase, 'foreground-receipt-timing');

      const later = service.request(frame('idle-after-clock-failure'));
      const laterOutcome = await Promise.race([
        later.completion.then(receipt => ({ state: 'settled', receipt })),
        turn().then(() => ({ state: 'pending' })),
      ]);
      assert.equal(laterOutcome.state, 'settled', 'one failed idle receipt must not poison later renderer work');
      assert.equal(laterOutcome.receipt.status, 'completed');
      assert.deepEqual(submissions, ['idle-clock-failure', 'idle-after-clock-failure']);
      assert.deepEqual(unhandledRejections, []);
      await service.dispose();
    } finally {
      process.off('unhandledRejection', collectUnhandled);
    }
  });

  test('an idle service timing failure is recorded without poisoning later renderer requests', async () => {
    let clockReads = 0;
    const unhandledRejections = [];
    const collectUnhandled = reason => unhandledRejections.push(reason);
    process.on('unhandledRejection', collectUnhandled);
    const { service, submissions } = fixture({ now() {
      clockReads += 1;
      if (clockReads === 7) throw new Error('idle service clock failed');
      return clockReads;
    } });
    try {
      const first = service.request(frame('idle-service-clock-failure'));
      const firstReceipt = await first.completion;
      assert.equal(firstReceipt.status, 'completed');
      assert.equal(firstReceipt.submissionCount, 1);
      await turn();
      const failedService = service.snapshot().lastOutsideRunService;
      assert.equal(failedService.status, 'failed');
      assert.equal(failedService.settledAtMs, null);
      assert.equal(failedService.failure.phase, 'foreground-service-receipt-timing');
      assert.match(failedService.failure.error.message, /idle service clock failed/);

      const later = service.request(frame('idle-after-service-clock-failure'));
      const laterOutcome = await Promise.race([
        later.completion.then(receipt => ({ state: 'settled', receipt })),
        turn().then(() => ({ state: 'pending' })),
      ]);
      assert.equal(laterOutcome.state, 'settled', 'service timing failure must not poison idle rendering');
      assert.equal(laterOutcome.receipt.status, 'completed');
      assert.deepEqual(submissions, ['idle-service-clock-failure', 'idle-after-service-clock-failure']);
      assert.deepEqual(unhandledRejections, []);
      await service.dispose();
    } finally {
      process.off('unhandledRejection', collectUnhandled);
    }
  });

  test('a rejected active-run service timing receipt preserves the run quarantine', async () => {
    let clockReads = 0;
    const { service, submissions } = fixture({ now() {
      clockReads += 1;
      if (clockReads === 7) throw new Error('active service clock failed');
      return clockReads;
    } });
    const run = await service.beginRun('service-clock-quarantined');
    const request = service.request(frame('active-service-clock-failure'));
    await assert.rejects(run.finish(), /active service clock failed/);
    const receipt = await request.completion;
    assert.equal(receipt.status, 'completed');
    assert.deepEqual(submissions, ['active-service-clock-failure']);
    const failedService = run.foregroundOpportunities.snapshot().services.at(-1);
    assert.equal(failedService.status, 'failed');
    assert.equal(failedService.settledAtMs, null);
    assert.equal(failedService.failure.phase, 'foreground-service-receipt-timing');
    assert.match(failedService.failure.error.message, /active service clock failed/);
    assert.equal(service.snapshot().activeRun.runId, 'service-clock-quarantined');
    assert.equal(service.snapshot().activeRun.finishing, true);
    assert.throws(() => service.beginRun('cannot-reuse'), /active run/);
    assert.throws(() => service.dispose(), /active run/);
  });

  test('idle cancellation, errors, duplicate reservation and expired submit use the interlock contract', async () => {
    const { service, submissions } = fixture();
    const canceled = service.request(frame('canceled'));
    assert.equal(canceled.cancel().status, 'canceled-before-service');
    assert.equal((await canceled.completion).submissionCount, 0);
    let retained;
    const handle = service.request({ requestId: 'same', run(ctx) {
      retained = ctx;
      assert.throws(() => service.request(frame('same')), /duplicate/);
      ctx.submit(['same']);
    } });
    const receipt = await handle.completion;
    assert.equal(handle.cancel(), receipt);
    assert.throws(() => retained.submit(['expired']), /lease is not active/);
    const failed = await service.request({ requestId: 'bad', run(ctx) { ctx.submit(['bad']); throw new Error('draw failed'); } }).completion;
    assert.equal(failed.status, 'failed-after-submission');
    assert.equal(failed.submissionCount, 1);
    assert.deepEqual(submissions, ['same', 'bad']);
    assert.equal((await service.request(frame('same')).completion).status, 'completed', 'settled idle IDs do not accumulate');
    assert.equal(service.snapshot().outsideRunReceiptCount, 4);
  });

  test('dispose drains idle callbacks, refuses new work, and never destroys the device', async () => {
    const { service } = fixture();
    const gate = deferred();
    const handle = service.request({ requestId: 'last', run: () => gate.promise });
    const disposal = service.dispose();
    assert.equal(service.dispose(), disposal);
    assert.throws(() => service.request(frame('after')), /disposed/);
    assert.throws(() => service.beginRun('after'), /disposed/);
    gate.resolve();
    await disposal;
    await handle.completion;
    assert.equal(service.snapshot().outsideRunInFlightCount, 0);
  });

  test('dispose during a run is rejected without disabling the service', async () => {
    const { service } = fixture();
    const run = await service.beginRun('active');
    assert.throws(() => service.dispose(), /active run/);
    const frameHandle = service.request(frame('still-active'));
    await run.finish();
    assert.equal((await frameHandle.completion).status, 'completed');
    await service.dispose();
  });

  test('the real runtime adapter waits for foreground work before encoding', async () => {
    const { service, device, submissions } = fixture();
    device.features = new Set();
    device.limits = {};
    const run = await service.beginRun('runtime');
    const runtime = await kit.createWebGpuInferenceRuntime({
      routeId: 'model', runtimeLabel: 'persistent-service-contract', device,
      adapterName: 'CPU contract fixture', kernel: { profile: 'contract' },
      foregroundOpportunities: run.foregroundOpportunities,
    });
    const started = deferred();
    const gate = deferred();
    const handle = runtime.requestForegroundOpportunity({ requestId: 'frame', async run(ctx) {
      started.resolve(); await gate.promise; ctx.submit(['frame']);
    } });
    let prepared = false;
    const preparing = runtime.prepareCommandDutyAtBoundary({ phase: 'gpu' }, { invocationId: 'i' })
      .then(descriptor => { prepared = true; return descriptor; });
    await started.promise;
    assert.equal(prepared, false);
    gate.resolve();
    const descriptor = await preparing;
    assert.equal(descriptor.metadata.foregroundOpportunityService.status, 'serviced');
    assert.equal((await handle.completion).submissionCount, 1);
    assert.deepEqual(submissions, ['frame']);
    assert.equal(runtime.finishForegroundOpportunities().status, 'succeeded');
    await run.finish();
  });
}
