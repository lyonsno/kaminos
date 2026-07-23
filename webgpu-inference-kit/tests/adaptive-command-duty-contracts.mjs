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
]) {
  assert.throws(() => planner(invalid));
}

console.log('adaptive command duty contracts passed');
