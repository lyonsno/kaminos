import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.createWebGpuBoundedSubmissionQueue,
  'function',
  'the common runtime must export a bounded GPU submission controller',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createFixture(maxInFlightDuties = 2, overrides = {}) {
  const events = [];
  const fences = [];
  let nowMs = 0;
  const {
    now: nowOverride,
    yieldToBrowser: yieldToBrowserOverride,
    ...controllerOverrides
  } = overrides;
  const queue = {
    submit(commandBuffers) {
      events.push(`queue-submit:${commandBuffers[0]}`);
    },
    onSubmittedWorkDone() {
      const fence = deferred();
      fences.push(fence);
      events.push(`queue-fence:${fences.length}`);
      return fence.promise;
    },
  };
  const controller = kit.createWebGpuBoundedSubmissionQueue({
    queue,
    maxInFlightDuties,
    ...controllerOverrides,
    now: nowOverride || (() => {
      nowMs += 1;
      return nowMs;
    }),
    yieldToBrowser: yieldToBrowserOverride || (async ({ dutyId }) => {
      events.push(`yield:${dutyId}`);
    }),
  });
  return { controller, events, fences };
}

for (const invalid of [0, -1, 1.5, Number.NaN, '2', null, false]) {
  assert.throws(
    () => kit.createWebGpuBoundedSubmissionQueue({
      queue: { submit() {}, onSubmittedWorkDone() {} },
      maxInFlightDuties: invalid,
    }),
    /maxInFlightDuties.*positive safe integer/,
  );
}

const { controller, events, fences } = createFixture(2);

const first = await controller.submitDuty({
  dutyId: 'duty-1',
  submit() {
    controller.queue.submit(['duty-1']);
  },
  metadata: { rangeIndex: 0 },
});
assert.equal(first.status, 'admitted');
assert.equal(first.backpressureApplied, false);
assert.equal(controller.snapshot().inFlightDutyCount, 1);

let secondSettled = false;
const secondPromise = controller.submitDuty({
  dutyId: 'duty-2',
  submit() {
    controller.queue.submit(['duty-2']);
  },
  metadata: { rangeIndex: 1 },
}).then(receipt => {
  secondSettled = true;
  return receipt;
});
await flush();
assert.equal(secondSettled, false, 'depth two must apply backpressure before admitting more work');
assert.equal(controller.snapshot().inFlightDutyCount, 2);
assert.equal(controller.snapshot().completedDutyCount, 0);

fences[0].resolve();
const second = await secondPromise;
assert.equal(second.status, 'admitted');
assert.equal(second.backpressureApplied, true);
assert.equal(second.settledDutyId, 'duty-1');
assert.equal(controller.snapshot().inFlightDutyCount, 1);
assert.equal(controller.snapshot().completedDutyCount, 1);

const thirdPromise = controller.submitDuty({
  dutyId: 'duty-3',
  submit() {
    controller.queue.submit(['duty-3']);
  },
  metadata: { rangeIndex: 2 },
});
await flush();
fences[1].resolve();
await thirdPromise;

let drainSettled = false;
const drainPromise = controller.drain().then(report => {
  drainSettled = true;
  return report;
});
await flush();
assert.equal(drainSettled, false, 'terminal drain must wait for every admitted duty');
fences[2].resolve();
const report = await drainPromise;

assert.equal(report.status, 'drained');
assert.equal(report.maxInFlightDuties, 2);
assert.equal(report.maxObservedInFlightDuties, 2);
assert.equal(report.submittedDutyCount, 3);
assert.equal(report.completedDutyCount, 3);
assert.equal(report.inFlightDutyCount, 0);
assert.equal(report.retention, 'uncapped');
assert.deepEqual(report.duties.map(duty => duty.dutyId), ['duty-1', 'duty-2', 'duty-3']);
assert.ok(report.duties.every(duty => duty.timingAuthority === 'queue-work-done'));
assert.ok(report.duties.every(duty => Number.isFinite(duty.rawQueueDurationMs)));
assert.equal(report.backpressure.length, 2);
assert.ok(report.backpressure.every(row => Number.isFinite(row.controlWaitMs)));
assert.deepEqual(events.slice(0, 6), [
  'queue-submit:duty-1',
  'queue-fence:1',
  'yield:duty-1',
  'queue-submit:duty-2',
  'queue-fence:2',
  'yield:duty-2',
]);
assert.throws(
  () => controller.submitDuty({ dutyId: 'after-drain', submit() {} }),
  /drained/,
);

const failedFixture = createFixture(1);
const failedPromise = failedFixture.controller.submitDuty({
  dutyId: 'failed-duty',
  submit() {
    failedFixture.controller.queue.submit(['failed-duty']);
  },
});
await flush();
failedFixture.fences[0].reject(new Error('device lost during prefix completion'));
await assert.rejects(
  failedPromise,
  error => {
    assert.equal(error.message, 'device lost during prefix completion');
    assert.equal(error.boundedGpuSubmissionReport.status, 'failed');
    assert.equal(error.boundedGpuSubmissionReport.failure.phase, 'queue-completion');
    assert.equal(error.boundedGpuSubmissionReport.failure.dutyId, 'failed-duty');
    assert.equal(error.boundedGpuSubmissionReport.inFlightDutyCount, 0);
    return true;
  },
);

assert.throws(
  () => kit.createWebGpuBoundedSubmissionQueue({
    queue: { submit() {}, onSubmittedWorkDone() {} },
    maxInFlightDuties: 1,
    retention: 'capped',
  }),
  /retention.*uncapped/,
);

const metadataFixture = createFixture(2);
assert.throws(
  () => metadataFixture.controller.submitDuty({
    dutyId: 'invalid-metadata',
    submit() {
      metadataFixture.controller.queue.submit(['invalid-metadata']);
    },
    metadata: { unsupported: 1n },
  }),
  /metadata.*JSON-serializable/,
);
assert.equal(
  metadataFixture.events.some(event => event.startsWith('queue-submit:')),
  false,
  'invalid metadata must fail before GPU submission',
);

const cancellation = new AbortController();
cancellation.abort('operator-cancelled');
const cancelledFixture = createFixture(2, { signal: cancellation.signal });
await assert.rejects(
  cancelledFixture.controller.submitDuty({
    dutyId: 'cancelled-before-submit',
    submit() {
      cancelledFixture.controller.queue.submit(['cancelled-before-submit']);
    },
  }),
  error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.boundedGpuSubmissionReport.status, 'cancelled');
    assert.equal(error.boundedGpuSubmissionReport.failure.phase, 'cancellation');
    return true;
  },
);
assert.equal(
  cancelledFixture.events.some(event => event.startsWith('queue-submit:')),
  false,
  'cancellation must not admit new GPU work',
);

const inFlightCancellation = new AbortController();
const inFlightCancelledFixture = createFixture(2, {
  signal: inFlightCancellation.signal,
});
await inFlightCancelledFixture.controller.submitDuty({
  dutyId: 'submitted-before-cancel',
  submit() {
    inFlightCancelledFixture.controller.queue.submit(['submitted-before-cancel']);
  },
});
inFlightCancellation.abort('operator-cancelled-after-submit');
let cancellationSettled = false;
const cancellationDrain = assert.rejects(
  inFlightCancelledFixture.controller.drain(),
  error => {
    cancellationSettled = true;
    assert.equal(error.name, 'AbortError');
    assert.equal(error.boundedGpuSubmissionReport.status, 'cancelled');
    assert.equal(error.boundedGpuSubmissionReport.inFlightDutyCount, 0);
    assert.equal(error.boundedGpuSubmissionReport.completedDutyCount, 1);
    return true;
  },
);
await flush();
assert.equal(cancellationSettled, false, 'cancellation must drain admitted GPU work');
inFlightCancelledFixture.fences[0].resolve();
await cancellationDrain;

let malformedFenceSubmits = 0;
const malformedFenceController = kit.createWebGpuBoundedSubmissionQueue({
  queue: {
    submit() {
      malformedFenceSubmits += 1;
    },
    onSubmittedWorkDone() {
      return undefined;
    },
  },
  maxInFlightDuties: 1,
});
await assert.rejects(
  malformedFenceController.submitDuty({
    dutyId: 'malformed-fence',
    submit() {
      malformedFenceController.queue.submit([]);
    },
  }),
  error => {
    assert.match(error.message, /onSubmittedWorkDone.*Promise/);
    assert.equal(error.boundedGpuSubmissionReport.status, 'failed');
    assert.equal(error.boundedGpuSubmissionReport.failure.phase, 'queue-fence-creation');
    return true;
  },
);
assert.equal(malformedFenceSubmits, 1);

const yieldFailure = createFixture(2, {
  async yieldToBrowser() {
    throw new Error('foreground callback failed');
  },
});
let yieldFailureSettled = false;
const yieldFailurePromise = assert.rejects(
  yieldFailure.controller.submitDuty({
    dutyId: 'yield-failure',
    submit() {
      yieldFailure.controller.queue.submit(['yield-failure']);
    },
  }),
  error => {
    yieldFailureSettled = true;
    assert.equal(error.message, 'foreground callback failed');
    assert.equal(error.boundedGpuSubmissionReport.failure.phase, 'browser-yield');
    assert.equal(error.boundedGpuSubmissionReport.inFlightDutyCount, 0);
    return true;
  },
);
await flush();
assert.equal(yieldFailureSettled, false, 'yield failure must drain admitted GPU work');
yieldFailure.fences[0].resolve();
await yieldFailurePromise;

const cancellationDuringBackpressure = new AbortController();
const backpressureCancellationFixture = createFixture(1, {
  signal: cancellationDuringBackpressure.signal,
});
let backpressureCancellationSettled = false;
const backpressureCancellationPromise = assert.rejects(
  backpressureCancellationFixture.controller.submitDuty({
    dutyId: 'cancelled-during-backpressure',
    submit() {
      backpressureCancellationFixture.controller.queue.submit([
        'cancelled-during-backpressure',
      ]);
    },
  }),
  error => {
    backpressureCancellationSettled = true;
    assert.equal(error.name, 'AbortError');
    assert.equal(error.boundedGpuSubmissionReport.status, 'cancelled');
    assert.equal(error.boundedGpuSubmissionReport.inFlightDutyCount, 0);
    assert.equal(error.boundedGpuSubmissionReport.completedDutyCount, 1);
    return true;
  },
);
await flush();
cancellationDuringBackpressure.abort('cancelled while waiting for queue completion');
await flush();
assert.equal(
  backpressureCancellationSettled,
  false,
  'cancellation during backpressure must still await the admitted prefix',
);
backpressureCancellationFixture.fences[0].resolve();
await backpressureCancellationPromise;

const concurrentFixture = createFixture(2);
const concurrentSubmissions = ['concurrent-1', 'concurrent-2', 'concurrent-3'].map(
  dutyId => concurrentFixture.controller.submitDuty({
    dutyId,
    submit() {
      concurrentFixture.controller.queue.submit([dutyId]);
    },
  }),
);
await flush();
assert.equal(
  concurrentFixture.controller.snapshot().maxObservedInFlightDuties,
  2,
  'concurrent callers must not exceed the caller-selected in-flight depth',
);
concurrentFixture.fences[0].resolve();
await flush();
concurrentFixture.fences[1].resolve();
await flush();
concurrentFixture.fences[2].resolve();
await Promise.all(concurrentSubmissions);
const concurrentReport = await concurrentFixture.controller.drain();
assert.deepEqual(
  concurrentReport.duties.map(duty => duty.dutyId),
  ['concurrent-1', 'concurrent-2', 'concurrent-3'],
  'concurrent callers must preserve admission and settlement order',
);
assert.equal(concurrentReport.completedDutyCount, 3);

console.log('bounded GPU submission contracts passed');
