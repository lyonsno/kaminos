import assert from 'node:assert/strict';

import {
  WEBGPU_INFERENCE_JOB_CANCELLATION_SCHEMA,
  WEBGPU_INFERENCE_JOB_COMPLETION_SCHEMA,
  WEBGPU_INFERENCE_QUEUE_SCHEMA,
  WEBGPU_SCHEDULER_DECISION_QUEUE_RECEIPT_SCHEMA,
  createWebGpuInferenceQueue,
} from '../src/index.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const routeId = 'sharp.image-to-splat.webgpu-local.v0';
const executionLog = [];
let schedulerRevision = 0;
let activeInvocationCount = 0;
const runtime = {
  routeId,
  async runInvocation({ invocationId }, execute) {
    assert.equal(activeInvocationCount, 0, 'the queue must never overlap route invocations');
    activeInvocationCount += 1;
    executionLog.push(`start:${invocationId}:r${schedulerRevision}`);
    const invocation = Object.freeze({
      routeId,
      invocationId,
      schedulerRevision,
      scheduler: Object.freeze({ yieldMs: schedulerRevision * 2 }),
      getControl() { return 8 / (2 ** schedulerRevision); },
      async yieldToBrowser() {},
    });
    try {
      return await execute(invocation);
    } finally {
      executionLog.push(`end:${invocationId}:r${schedulerRevision}`);
      activeInvocationCount -= 1;
    }
  },
  applySchedulerDecision(decision) {
    assert.equal(activeInvocationCount, 0, 'scheduler decisions must apply between jobs');
    if (decision.fail === true) throw new Error(`decision ${decision.revision} rejected`);
    if (decision.revision !== schedulerRevision + 1) throw new Error('decision revision mismatch');
    executionLog.push(`decision:r${decision.revision}`);
    const previousRevision = schedulerRevision;
    schedulerRevision = decision.revision;
    return {
      status: 'applied',
      routeId,
      previousRevision,
      effectiveRevision: schedulerRevision,
    };
  },
  schedulerSnapshot() {
    return { routeId, revision: schedulerRevision };
  },
};

let nowMs = 0;
const queue = createWebGpuInferenceQueue({
  runtime,
  now: () => {
    nowMs += 1;
    return nowMs;
  },
});

assert.equal(typeof queue.subscribe, 'function', 'queue mutations must be observable by publication adapters');
const mutationEvents = [];
const unsubscribe = queue.subscribe(event => mutationEvents.push(event));

const initial = queue.snapshot();
assert.equal(initial.schema, WEBGPU_INFERENCE_QUEUE_SCHEMA);
assert.equal(initial.routeId, routeId);
assert.equal(initial.status, 'idle');
assert.equal(initial.retention, 'uncapped-until-explicit-forget');
assert.equal(initial.activeJobId, null);
assert.equal(initial.pendingJobCount, 0);
assert.equal(initial.pendingDecisionCount, 0);
assert.deepEqual(initial.jobs, []);

assert.throws(
  () => createWebGpuInferenceQueue({ runtime, maxJobs: 4 }),
  /does not impose.*job cap|uncapped/i,
);
assert.throws(
  () => createWebGpuInferenceQueue({ runtime: { ...runtime, routeId: 'other.route.webgpu-local.v0' }, routeId }),
  /route.*mismatch/i,
);

const releaseFirst = deferred();
const firstStarted = deferred();
const first = queue.enqueue({
  jobId: 'job-first',
  metadata: { source: 'operator-drop' },
  async execute(context) {
    firstStarted.resolve();
    for (let index = 0; index < 128; index += 1) {
      context.reportProgress({ stage: 'spn-fusion', completed: index + 1, total: 128 });
    }
    await releaseFirst.promise;
    return { asset: 'first.ply', revision: context.schedulerRevision };
  },
});
const second = queue.enqueue({
  jobId: 'job-second',
  async execute() {
    executionLog.push('should-not-run:job-second');
    return { asset: 'second.ply' };
  },
});
const third = queue.enqueue({
  jobId: 'job-third',
  async execute(context) {
    return {
      asset: 'third.ply',
      revision: context.schedulerRevision,
      chunk: context.getControl('spnFusionOutputItems'),
    };
  },
});

assert.equal(Object.isFrozen(first), true);
assert.throws(() => { first.jobId = 'mutated'; }, /read only|readonly|not extensible|Cannot assign/i);
await firstStarted.promise;

const activeCancellation = first.cancel('operator-changed-mind');
assert.equal(activeCancellation.schema, WEBGPU_INFERENCE_JOB_CANCELLATION_SCHEMA);
assert.equal(activeCancellation.status, 'not-cancelled-active');
assert.equal(activeCancellation.cancellationAuthority, 'pending-jobs-only-no-active-work-preemption');

const pendingCancellation = second.cancel('superseded-input');
assert.equal(pendingCancellation.status, 'cancelled-before-start');
assert.equal(pendingCancellation.reason, 'superseded-input');
const secondCompletion = await second.completion;
assert.equal(secondCompletion.schema, WEBGPU_INFERENCE_JOB_COMPLETION_SCHEMA);
assert.equal(secondCompletion.status, 'cancelled-before-start');
assert.equal(secondCompletion.outputPresent, false);

const pendingDecision = { revision: 1 };
const decisionReceiptPromise = queue.scheduleSchedulerDecision(pendingDecision);
pendingDecision.revision = 99;
const activeSnapshot = queue.snapshot();
assert.equal(activeSnapshot.status, 'running');
assert.equal(activeSnapshot.activeJobId, 'job-first');
assert.equal(activeSnapshot.pendingJobCount, 1);
assert.equal(activeSnapshot.pendingDecisionCount, 1);
assert.equal(activeSnapshot.jobs.length, 3);
assert.equal(activeSnapshot.jobs.find(job => job.jobId === 'job-first').progress.length, 128);

releaseFirst.resolve();
const firstCompletion = await first.completion;
const decisionReceipt = await decisionReceiptPromise;
const thirdCompletion = await third.completion;
await queue.drain();

assert.equal(firstCompletion.status, 'succeeded');
assert.equal(firstCompletion.outputPresent, true);
assert.deepEqual(firstCompletion.output, { asset: 'first.ply', revision: 0 });
assert.equal(firstCompletion.schedulerRevision, 0);
assert.equal(firstCompletion.progress.length, 128);
assert.equal(decisionReceipt.schema, WEBGPU_SCHEDULER_DECISION_QUEUE_RECEIPT_SCHEMA);
assert.equal(decisionReceipt.status, 'applied');
assert.equal(decisionReceipt.application.previousRevision, 0);
assert.equal(decisionReceipt.application.effectiveRevision, 1);
assert.equal(thirdCompletion.status, 'succeeded');
assert.deepEqual(thirdCompletion.output, { asset: 'third.ply', revision: 1, chunk: 4 });
assert.deepEqual(executionLog.slice(0, 5), [
  'start:job-first:r0',
  'end:job-first:r0',
  'decision:r1',
  'start:job-third:r1',
  'end:job-third:r1',
]);

const failed = queue.enqueue({
  jobId: 'job-failed',
  async execute(context) {
    context.reportProgress({ stage: 'decode', completed: 1, total: 2 });
    throw new TypeError('decoder exploded');
  },
});
const afterFailure = queue.enqueue({
  jobId: 'job-after-failure',
  async execute() { return 'queue-continued'; },
});
const failedCompletion = await failed.completion;
const afterFailureCompletion = await afterFailure.completion;
assert.equal(failedCompletion.status, 'failed');
assert.equal(failedCompletion.outputPresent, false);
assert.deepEqual(failedCompletion.failure, { name: 'TypeError', message: 'decoder exploded' });
assert.equal(failedCompletion.progress.length, 1);
assert.equal(afterFailureCompletion.status, 'succeeded');
assert.equal(afterFailureCompletion.output, 'queue-continued');

await assert.rejects(
  queue.scheduleSchedulerDecision({ revision: 2, fail: true }),
  /decision 2 rejected/,
);
const failedDecisionRecord = queue.snapshot().decisions.at(-1);
assert.equal(failedDecisionRecord.status, 'failed');
assert.equal(failedDecisionRecord.revision, 2);
assert.deepEqual(failedDecisionRecord.failure, {
  name: 'Error',
  message: 'decision 2 rejected',
});
const afterDecisionFailure = queue.enqueue({
  jobId: 'job-after-decision-failure',
  async execute(context) { return context.schedulerRevision; },
});
assert.equal((await afterDecisionFailure.completion).output, 1);

const held = deferred();
const pendingForget = queue.enqueue({
  jobId: 'job-pending-forget',
  async execute() {
    await held.promise;
    return 'held-result';
  },
});
await Promise.resolve();
assert.throws(() => queue.forgetJob('job-pending-forget'), /active or pending job/i);
held.resolve();
await pendingForget.completion;
assert.equal(queue.forgetJob('job-pending-forget'), true);
assert.equal(queue.snapshot().jobs.some(job => job.jobId === 'job-pending-forget'), false);
assert.deepEqual(queue.snapshot().forgetReceipts.at(-1), {
  schema: 'kaminos.webgpu-inference-job-forget-receipt.v0',
  routeId,
  jobId: 'job-pending-forget',
  forgottenAtMs: 154,
  priorStatus: 'succeeded',
  deletionAuthority: 'explicit-queue-forget-only',
});
assert.equal(queue.forgetJob('missing-job'), false);

assert.throws(
  () => queue.enqueue({ jobId: 'job-first', async execute() {} }),
  /duplicate job/i,
);
assert.equal(queue.forgetJob('job-first'), true);
const reused = queue.enqueue({ jobId: 'job-first', async execute() { return 'reused'; } });
assert.equal((await reused.completion).output, 'reused');

const bulkHandles = [];
for (let index = 0; index < 96; index += 1) {
  bulkHandles.push(queue.enqueue({
    jobId: `bulk-${index}`,
    async execute() { return index; },
  }));
}
await queue.drain();
assert.deepEqual(
  (await Promise.all(bulkHandles.map(handle => handle.completion))).map(row => row.output),
  Array.from({ length: 96 }, (_, index) => index),
);
const finalSnapshot = queue.snapshot();
assert.equal(finalSnapshot.status, 'idle');
assert.equal(finalSnapshot.pendingJobCount, 0);
assert.equal(finalSnapshot.pendingDecisionCount, 0);
assert.equal(finalSnapshot.jobs.filter(job => job.jobId.startsWith('bulk-')).length, 96);
assert.equal(executionLog.includes('should-not-run:job-second'), false);

const published = queue.enqueue({
  jobId: 'job-published-output',
  async execute() {
    return { privateGpuHandle: 'must-not-enter-the-ledger', assetPath: 'outputs/orb.ply' };
  },
  async describeOutput(output) {
    return Promise.resolve({
      outputIdentity: 'orb-splat-v1',
      artifacts: [{ kind: 'splat', path: output.assetPath }],
    });
  },
});
await published.completion;
await queue.drain();
const publishedSnapshot = queue.snapshot().jobs.find(job => job.jobId === published.jobId);
assert.deepEqual(publishedSnapshot.publication, {
  outputIdentity: 'orb-splat-v1',
  artifacts: [{ kind: 'splat', path: 'outputs/orb.ply' }],
});
assert.equal('output' in publishedSnapshot, false, 'opaque runtime output must not leak into the durable snapshot');
assert.ok(mutationEvents.some(event => event.kind === 'job-progress' && event.jobId === 'job-first'));
assert.ok(mutationEvents.some(event => event.kind === 'job-completed' && event.jobId === published.jobId));
assert.equal(mutationEvents.every(event => Object.isFrozen(event)), true);
unsubscribe();

console.log('inference queue contracts passed');
