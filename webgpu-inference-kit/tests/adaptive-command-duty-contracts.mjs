import assert from 'node:assert/strict';

import {
  WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
  WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA,
  createWebGpuAdaptiveCommandDutyPlanner,
} from '../src/index.js';

function planner(overrides = {}) {
  return createWebGpuAdaptiveCommandDutyPlanner({
    plannerId: 'sharp:gaussian:head-conv1',
    unit: 'output-item',
    totalItems: 100,
    initialChunkItems: 20,
    targetDurationMs: 10,
    bounds: {
      minChunkItems: 5,
      maxChunkItems: 100,
    },
    metadata: {
      routeId: 'sharp.image-to-splat.webgpu-local.v0',
      phase: 'head-gn-conv1',
    },
    ...overrides,
  });
}

const adaptive = planner();
assert.equal(adaptive.schema, WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA);
assert.equal(adaptive.snapshot().requestedAdjustmentGain, 1);
assert.equal(adaptive.snapshot().effectiveAdjustmentGain, 1);
const first = adaptive.nextRange();
assert.equal(first.schema, WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA);
assert.equal(first.rangeId, 'sharp:gaussian:head-conv1:0');
assert.equal(first.rangeIndex, 0);
assert.equal(first.rangeTotal, null, 'an adaptive plan must not pretend to know its final range count');
assert.equal(first.rangeCountAuthority, 'actual-after-completion');
assert.equal(first.itemStart, 0);
assert.equal(first.itemEnd, 20);
assert.equal(first.itemCount, 20);
assert.equal(first.totalItems, 100);
assert.equal(first.completedItemsBefore, 0);
assert.equal(first.completedItemsAfter, 20);
assert.equal(first.progressAfter, 0.2);
assert.equal(first.plannedChunkItems, 20);
assert.deepEqual(first.bounds, { minChunkItems: 5, maxChunkItems: 100 });
assert.throws(() => adaptive.nextRange(), /pending range/, 'a second range cannot be planned before the first is observed');

assert.throws(
  () => adaptive.observeRange({
    rangeId: 'stale-range',
    observedDurationMs: 20,
    timingAuthority: 'queue-work-done',
  }),
  /does not match pending range/,
  'stale timing must not advance coverage',
);
assert.equal(adaptive.snapshot().completedItems, 0);

const firstObservation = adaptive.observeRange({
  rangeId: first.rangeId,
  observedDurationMs: 20,
  timingAuthority: 'queue-work-done',
});
assert.equal(firstObservation.status, 'range-observed');
assert.equal(firstObservation.nextChunkItems, 10, 'a 2x over-budget duty must halve the next exact range');
assert.equal(firstObservation.requestedAdjustmentGain, 1);
assert.equal(firstObservation.effectiveAdjustmentGain, 1);
assert.equal(firstObservation.fullGainCorrectionRatio, 0.5);
assert.equal(firstObservation.effectiveCorrectionRatio, 0.5);
assert.equal(firstObservation.rawNextChunkItems, 10);
assert.equal(firstObservation.effectiveRawNextChunkItems, 10);
assert.equal(firstObservation.adjustment, 'decrease');
assert.equal(firstObservation.rangeCountAuthority, 'open-until-completion');
assert.equal(firstObservation.actualRangeCount, null);

const second = adaptive.nextRange();
assert.deepEqual(
  [second.itemStart, second.itemEnd, second.itemCount],
  [20, 30, 10],
  'the reduced range must continue exactly after the observed range',
);
const secondObservation = adaptive.observeRange({
  rangeId: second.rangeId,
  observedDurationMs: 5,
  timingAuthority: 'queue-work-done',
});
assert.equal(secondObservation.nextChunkItems, 20, 'an under-budget duty must grow toward the caller target');
assert.equal(secondObservation.fullGainCorrectionRatio, 2);
assert.equal(secondObservation.effectiveCorrectionRatio, 2);
assert.equal(secondObservation.effectiveRawNextChunkItems, 20);
assert.equal(secondObservation.adjustment, 'increase');

const ranges = [first, second];
while (adaptive.snapshot().status === 'active') {
  const range = adaptive.nextRange();
  ranges.push(range);
  adaptive.observeRange({
    rangeId: range.rangeId,
    observedDurationMs: 10,
    timingAuthority: 'queue-work-done',
  });
}
const finalSnapshot = adaptive.snapshot();
assert.equal(finalSnapshot.status, 'complete');
assert.equal(finalSnapshot.completedItems, 100);
assert.equal(finalSnapshot.actualRangeCount, ranges.length);
assert.equal(finalSnapshot.rangeCountAuthority, 'actual');
assert.equal(adaptive.nextRange(), null, 'a complete planner must not manufacture more work');
for (let index = 0; index < ranges.length; index += 1) {
  assert.equal(ranges[index].rangeIndex, index);
  assert.equal(ranges[index].itemStart, index === 0 ? 0 : ranges[index - 1].itemEnd);
  assert.ok(ranges[index].itemCount > 0);
}
assert.equal(ranges.at(-1).itemEnd, 100);

const zeroDuration = planner({ totalItems: 200, bounds: { minChunkItems: 5, maxChunkItems: 80 } });
const zeroRange = zeroDuration.nextRange();
const zeroObservation = zeroDuration.observeRange({
  rangeId: zeroRange.rangeId,
  observedDurationMs: 0,
  timingAuthority: 'queue-work-done',
});
assert.equal(zeroObservation.nextChunkItems, 80);
assert.equal(zeroObservation.boundApplication, 'maxChunkItems');

const gpuTimestamp = planner();
const gpuTimestampRange = gpuTimestamp.nextRange();
const gpuTimestampObservation = gpuTimestamp.observeRange({
  rangeId: gpuTimestampRange.rangeId,
  observedDurationMs: 20,
  timingAuthority: 'gpu-timestamp-query',
});
assert.equal(gpuTimestampObservation.status, 'range-observed');
assert.equal(gpuTimestampObservation.timingAuthority, 'gpu-timestamp-query');
assert.equal(gpuTimestampObservation.observedDurationMs, 20);
assert.equal(gpuTimestampObservation.nextChunkItems, 10);
assert.equal(gpuTimestamp.snapshot().completedItems, 20);
assert.equal(gpuTimestamp.snapshot().ranges[0].timingAuthority, 'gpu-timestamp-query');
assert.equal(gpuTimestamp.snapshot().observations[0].timingAuthority, 'gpu-timestamp-query');

const zeroGpuTimestamp = planner();
const zeroGpuTimestampRange = zeroGpuTimestamp.nextRange();
assert.throws(
  () => zeroGpuTimestamp.observeRange({
    rangeId: zeroGpuTimestampRange.rangeId,
    observedDurationMs: 0,
    timingAuthority: 'gpu-timestamp-query',
  }),
  /gpu-timestamp-query.*greater than zero|observedDurationMs.*greater than zero/,
  'GPU timestamp observations must preserve a strictly positive ordered range',
);
const zeroGpuTimestampSnapshot = zeroGpuTimestamp.snapshot();
assert.equal(zeroGpuTimestampSnapshot.completedItems, 0);
assert.equal(zeroGpuTimestampSnapshot.pendingRangeId, zeroGpuTimestampRange.rangeId);
assert.equal(zeroGpuTimestampSnapshot.ranges[0].status, 'pending-observation');
assert.deepEqual(zeroGpuTimestampSnapshot.observations, []);

const minimumBound = planner({ totalItems: 200 });
const minimumRange = minimumBound.nextRange();
const minimumObservation = minimumBound.observeRange({
  rangeId: minimumRange.rangeId,
  observedDurationMs: 10_000,
  timingAuthority: 'queue-work-done',
});
assert.equal(minimumObservation.nextChunkItems, 5);
assert.equal(minimumObservation.boundApplication, 'minChunkItems');

const wrongAuthority = planner();
const wrongAuthorityRange = wrongAuthority.nextRange();
assert.throws(
  () => wrongAuthority.observeRange({
    rangeId: wrongAuthorityRange.rangeId,
    observedDurationMs: 10,
    timingAuthority: 'wall-clock-around-yield',
  }),
  /timingAuthority must be queue-work-done/,
);
assert.equal(wrongAuthority.snapshot().completedItems, 0);

const failed = planner();
const failedRange = failed.nextRange();
const failure = failed.failRange({
  rangeId: failedRange.rangeId,
  phase: 'queue-drain',
  error: new Error('device lost'),
});
assert.equal(failure.status, 'failed');
assert.equal(failure.failure.phase, 'queue-drain');
assert.equal(failure.failure.error.name, 'Error');
assert.equal(failure.failure.error.message, 'device lost');
assert.equal(failed.snapshot().status, 'failed');
assert.equal(failed.snapshot().completedItems, 0);
assert.throws(() => failed.nextRange(), /failed planner/);

const metadataIsolation = planner();
const isolatedRange = metadataIsolation.nextRange();
assert.ok(Object.isFrozen(isolatedRange));
assert.ok(Object.isFrozen(isolatedRange.metadata));
const isolatedSnapshot = metadataIsolation.snapshot();
isolatedSnapshot.metadata.phase = 'mutated';
assert.equal(metadataIsolation.snapshot().metadata.phase, 'head-gn-conv1');

const safeIntegerCapacity = planner({
  totalItems: Number.MAX_SAFE_INTEGER,
  initialChunkItems: Number.MAX_SAFE_INTEGER,
  bounds: { minChunkItems: 1, maxChunkItems: Number.MAX_SAFE_INTEGER },
});
const safeIntegerRange = safeIntegerCapacity.nextRange();
assert.equal(safeIntegerRange.itemEnd, Number.MAX_SAFE_INTEGER, 'planner must not cap below JavaScript exact-integer capacity');
safeIntegerCapacity.observeRange({
  rangeId: safeIntegerRange.rangeId,
  observedDurationMs: 10,
  timingAuthority: 'queue-work-done',
});
assert.equal(safeIntegerCapacity.snapshot().status, 'complete');

const uncappedHistory = planner({
  totalItems: 257,
  initialChunkItems: 1,
  targetDurationMs: 1,
  bounds: { minChunkItems: 1, maxChunkItems: 1 },
});
while (uncappedHistory.snapshot().status === 'active') {
  const range = uncappedHistory.nextRange();
  uncappedHistory.observeRange({
    rangeId: range.rangeId,
    observedDurationMs: 1,
    timingAuthority: 'queue-work-done',
  });
}
assert.equal(uncappedHistory.snapshot().rangeCount, 257);
assert.equal(uncappedHistory.snapshot().ranges.length, 257);
assert.equal(uncappedHistory.snapshot().observations.length, 257);
assert.equal(uncappedHistory.snapshot().retention, 'uncapped');

const damped = planner({
  totalItems: 1_000,
  initialChunkItems: 20,
  adjustmentGain: 0.375,
});
assert.equal(damped.snapshot().requestedAdjustmentGain, 0.375);
assert.equal(damped.snapshot().effectiveAdjustmentGain, 0.375);
const dampedFirst = damped.nextRange();
const dampedSlow = damped.observeRange({
  rangeId: dampedFirst.rangeId,
  observedDurationMs: 20,
  timingAuthority: 'queue-work-done',
});
assert.equal(dampedSlow.fullGainCorrectionRatio, 0.5);
assert.ok(Math.abs(dampedSlow.effectiveCorrectionRatio - (0.5 ** 0.375)) < 1e-12);
assert.equal(dampedSlow.rawNextChunkItems, 10);
assert.ok(
  Math.abs(dampedSlow.effectiveRawNextChunkItems - (20 * (0.5 ** 0.375))) < 1e-12,
);
assert.equal(dampedSlow.nextChunkItems, 15);
assert.ok(
  Math.abs(Math.log(dampedSlow.effectiveCorrectionRatio))
    < Math.abs(Math.log(dampedSlow.fullGainCorrectionRatio)),
);

const dampedSecond = damped.nextRange();
const dampedFast = damped.observeRange({
  rangeId: dampedSecond.rangeId,
  observedDurationMs: 5,
  timingAuthority: 'queue-work-done',
});
assert.equal(dampedFast.fullGainCorrectionRatio, 2);
assert.ok(Math.abs(dampedFast.effectiveCorrectionRatio - (2 ** 0.375)) < 1e-12);
assert.equal(dampedFast.rawNextChunkItems, 30);
assert.ok(
  Math.abs(dampedFast.effectiveRawNextChunkItems - (15 * (2 ** 0.375))) < 1e-12,
);
assert.equal(dampedFast.nextChunkItems, 19);
assert.ok(
  Math.abs(Math.log(dampedFast.effectiveCorrectionRatio))
    < Math.abs(Math.log(dampedFast.fullGainCorrectionRatio)),
);

const alternating = planner({
  totalItems: 10_000,
  initialChunkItems: 64,
  targetDurationMs: 12,
  bounds: { minChunkItems: 1, maxChunkItems: 1_024 },
  adjustmentGain: 0.375,
});
const alternatingDurations = [4.75, 18.06, 4.75, 18.06, 4.75, 18.06, 4.75, 18.06];
const alternatingReceipts = [];
for (const observedDurationMs of alternatingDurations) {
  const range = alternating.nextRange();
  alternatingReceipts.push(alternating.observeRange({
    rangeId: range.rangeId,
    observedDurationMs,
    timingAuthority: 'queue-work-done',
  }));
}
assert.ok(alternatingReceipts.every(receipt => (
  Math.abs(Math.log(receipt.effectiveCorrectionRatio))
  < Math.abs(Math.log(receipt.fullGainCorrectionRatio))
)));
assert.ok(alternatingReceipts.every(receipt => receipt.requestedAdjustmentGain === 0.375));
assert.ok(alternatingReceipts.every(receipt => receipt.effectiveAdjustmentGain === 0.375));

const stableDamped = planner({
  totalItems: 60,
  initialChunkItems: 20,
  adjustmentGain: 0.375,
});
const stableRange = stableDamped.nextRange();
const stableObservation = stableDamped.observeRange({
  rangeId: stableRange.rangeId,
  observedDurationMs: 10,
  timingAuthority: 'queue-work-done',
});
assert.equal(stableObservation.fullGainCorrectionRatio, 1);
assert.equal(stableObservation.effectiveCorrectionRatio, 1);
assert.equal(stableObservation.nextChunkItems, 20);

const dampedZero = planner({
  totalItems: 200,
  adjustmentGain: 0.375,
  bounds: { minChunkItems: 5, maxChunkItems: 80 },
});
const dampedZeroRange = dampedZero.nextRange();
const dampedZeroObservation = dampedZero.observeRange({
  rangeId: dampedZeroRange.rangeId,
  observedDurationMs: 0,
  timingAuthority: 'queue-work-done',
});
assert.equal(dampedZeroObservation.fullGainCorrectionRatio, null);
assert.equal(dampedZeroObservation.effectiveCorrectionRatio, null);
assert.equal(dampedZeroObservation.rawNextChunkItems, null);
assert.equal(dampedZeroObservation.effectiveRawNextChunkItems, null);
assert.equal(dampedZeroObservation.nextChunkItems, 80);
assert.equal(dampedZeroObservation.boundApplication, 'maxChunkItems');

const finalPartial = planner({
  totalItems: 45,
  initialChunkItems: 20,
  adjustmentGain: 0.375,
});
const partialRanges = [];
const partialReceipts = [];
while (finalPartial.snapshot().status === 'active') {
  const range = finalPartial.nextRange();
  partialRanges.push(range);
  partialReceipts.push(finalPartial.observeRange({
    rangeId: range.rangeId,
    observedDurationMs: 10,
    timingAuthority: 'queue-work-done',
  }));
}
assert.deepEqual(partialRanges.map(range => range.itemCount), [20, 20, 5]);
assert.equal(partialRanges.at(-1).itemEnd, 45);
assert.equal(partialReceipts.at(-1).status, 'planner-complete');
assert.equal(partialReceipts.at(-1).nextChunkItems, null);
assert.equal(partialReceipts.at(-1).requestedAdjustmentGain, 0.375);
assert.equal(partialReceipts.at(-1).effectiveAdjustmentGain, 0.375);

const defaultGain = planner({ plannerId: 'gain-compatibility' });
const explicitFullGain = planner({
  plannerId: 'gain-compatibility',
  adjustmentGain: 1,
});
const explicitUndefinedGain = planner({
  plannerId: 'gain-compatibility',
  adjustmentGain: undefined,
});
assert.deepEqual(defaultGain.snapshot(), explicitUndefinedGain.snapshot());
for (const observedDurationMs of [20, 5, 10, 0]) {
  const defaultRange = defaultGain.nextRange();
  const explicitRange = explicitFullGain.nextRange();
  assert.deepEqual(defaultRange, explicitRange);
  assert.deepEqual(
    defaultGain.observeRange({
      rangeId: defaultRange.rangeId,
      observedDurationMs,
      timingAuthority: 'queue-work-done',
    }),
    explicitFullGain.observeRange({
      rangeId: explicitRange.rangeId,
      observedDurationMs,
      timingAuthority: 'queue-work-done',
    }),
  );
}
assert.deepEqual(defaultGain.snapshot(), explicitFullGain.snapshot());

for (const invalid of [
  { plannerId: '' },
  { unit: '' },
  { totalItems: 0 },
  { totalItems: Number.MAX_SAFE_INTEGER + 1 },
  { initialChunkItems: 0 },
  { targetDurationMs: 0 },
  { bounds: null },
  { bounds: { minChunkItems: 0, maxChunkItems: 100 } },
  { bounds: { minChunkItems: 20, maxChunkItems: 10 } },
  { bounds: { minChunkItems: 5, maxChunkItems: 10 }, initialChunkItems: 20 },
  { retention: 'last-100' },
  { adjustmentGain: 0 },
  { adjustmentGain: -0.25 },
  { adjustmentGain: 1.01 },
  { adjustmentGain: Number.NaN },
  { adjustmentGain: null },
  { adjustmentGain: '0.375' },
  { adjustmentGain: true },
  { adjustmentGain: false },
]) {
  assert.throws(() => planner(invalid));
}

console.log('adaptive command duty contracts passed');
