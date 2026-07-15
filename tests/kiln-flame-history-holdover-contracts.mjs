import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../kiln-flame-history-holdover.mjs', import.meta.url);
const moduleSource = await readFile(moduleUrl, 'utf8');

assert.match(
  moduleSource,
  /SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA/,
  'single-flame holdover must be an explicit reusable policy contract',
);
assert.match(
  moduleSource,
  /renderBoundarySplatHistorySlotToCanvas/,
  'the selector must name the renderer ABI it is allowed to actuate',
);

const {
  HOLDOVER_FRAME_SKIP_FLAGS,
  SHARED_CURRENT_FROZEN_SMOKE_AUTHORITY,
  SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA,
  createSingleFlameHistoryHoldoverDecision,
} = await import(moduleUrl);

assert.equal(
  SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA,
  'kaminos.single-flame-bounded-history-holdover.v0',
);
assert.equal(
  SHARED_CURRENT_FROZEN_SMOKE_AUTHORITY,
  'shared-current-frozen-simulator-smoke-no-history-replay',
);
assert.deepEqual(HOLDOVER_FRAME_SKIP_FLAGS, {
  simulationSubmitted: false,
  sidecarSubmitted: false,
  majorantSubmitted: false,
  compactionSubmitted: false,
  archiveSubmitted: false,
});

const baseSlots = [
  {
    slotIndex: 0,
    initialized: true,
    writeSubmissionCompleted: true,
    historyAllocationGeneration: 4,
    archiveWriteSequence: 30,
    sourceCandidateGeneration: 30,
    sourceSimStepCount: 130,
    sourceRenderFrameCount: 129,
    sourceCandidateCount: 1100,
    effectiveDrawCount: 900,
    candidateCapacity: 2048,
  },
  {
    slotIndex: 1,
    initialized: true,
    writeSubmissionCompleted: true,
    historyAllocationGeneration: 4,
    archiveWriteSequence: 31,
    sourceCandidateGeneration: 31,
    sourceSimStepCount: 131,
    sourceRenderFrameCount: 130,
    sourceCandidateCount: 1200,
    effectiveDrawCount: 1000,
    candidateCapacity: 2048,
  },
  {
    slotIndex: 2,
    initialized: true,
    writeSubmissionCompleted: true,
    historyAllocationGeneration: 4,
    archiveWriteSequence: 32,
    sourceCandidateGeneration: 32,
    sourceSimStepCount: 132,
    sourceRenderFrameCount: 131,
    sourceCandidateCount: 1250,
    effectiveDrawCount: 1000,
    candidateCapacity: 2048,
  },
];

const liveState = {
  firingId: 'firing-holdover-a',
  sourceCandidateGeneration: 33,
  sourceSimStepCount: 133,
  renderFrameOrdinal: 400,
  historyAllocationGeneration: 4,
  candidateCapacity: 2048,
  simulatorStarved: true,
};

const first = createSingleFlameHistoryHoldoverDecision({
  liveState,
  historySlots: baseSlots,
  previousDecision: null,
  maxHoldoverAgeGenerations: 8,
});
assert.equal(first.schema, SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA);
assert.equal(first.mode, 'holdover');
assert.equal(first.rendererAbi, 'renderBoundarySplatHistorySlotToCanvas');
assert.equal(first.selectedHistorySlot.slotIndex, 0);
assert.equal(first.selectedHistorySlot.sourceCandidateGeneration, 30);
assert.equal(first.holdoverOrdinal, 1);
assert.equal(first.repeatedSlotCount, 0);
assert.equal(first.sourceAgeGenerations, 3);
assert.deepEqual(first.skip, HOLDOVER_FRAME_SKIP_FLAGS);
assert.equal(first.flameAuthority, 'bounded-completed-live-history-replay-no-independent-simulation-no-learned-prediction');
assert.equal(first.smokeAuthority, SHARED_CURRENT_FROZEN_SMOKE_AUTHORITY);
assert.deepEqual(first.counts, { live: 0, holdover: 1, fallback: 0 });

const second = createSingleFlameHistoryHoldoverDecision({
  liveState: { ...liveState, renderFrameOrdinal: 401 },
  historySlots: baseSlots,
  previousDecision: first,
  maxHoldoverAgeGenerations: 8,
});
assert.equal(second.mode, 'holdover');
assert.equal(second.selectedHistorySlot.slotIndex, 1);
assert.equal(second.selectedHistorySlot.sourceCandidateGeneration, 31);
assert.equal(second.holdoverOrdinal, 2);
assert.equal(second.repeatedSlotCount, 0);
assert.deepEqual(second.counts, { live: 0, holdover: 2, fallback: 0 });

const exhausted = createSingleFlameHistoryHoldoverDecision({
  liveState: { ...liveState, renderFrameOrdinal: 402 },
  historySlots: baseSlots.slice(0, 2),
  previousDecision: second,
  maxHoldoverAgeGenerations: 8,
});
assert.equal(exhausted.mode, 'live');
assert.equal(exhausted.fallbackReason, 'holdover-exhausted');
assert.equal(exhausted.selectedHistorySlot, null);
assert.equal(exhausted.repeatedSlotCount, 0, 'exhaustion must not silently repeat the last disclosed slot');
assert.deepEqual(exhausted.counts, { live: 1, holdover: 2, fallback: 1 });

const liveWhenNotStarved = createSingleFlameHistoryHoldoverDecision({
  liveState: { ...liveState, simulatorStarved: false },
  historySlots: baseSlots,
  previousDecision: second,
});
assert.equal(liveWhenNotStarved.mode, 'live');
assert.equal(liveWhenNotStarved.fallbackReason, 'simulator-not-starved');

for (const [slotPatch, expectedReason] of [
  [{ initialized: false }, 'slot-uninitialized'],
  [{ writeSubmissionCompleted: false }, 'slot-write-incomplete'],
  [{ historyAllocationGeneration: 3 }, 'slot-allocation-generation-mismatch'],
  [{ candidateCapacity: 1024 }, 'slot-candidate-capacity-mismatch'],
  [{ sourceCandidateGeneration: 99 }, 'slot-source-generation-future'],
  [{ sourceCandidateCount: 0 }, 'slot-candidate-count-empty'],
  [{ effectiveDrawCount: 1300, sourceCandidateCount: 1200 }, 'slot-draw-count-exceeds-source'],
]) {
  const decision = createSingleFlameHistoryHoldoverDecision({
    liveState,
    historySlots: [{ ...baseSlots[0], ...slotPatch }],
    previousDecision: null,
    maxHoldoverAgeGenerations: 8,
  });
  assert.equal(decision.mode, 'live', expectedReason);
  assert.equal(decision.fallbackReason, 'no-valid-history-slot');
  assert.ok(
    decision.refusedSlots.some(slot => slot.reasons.includes(expectedReason)),
    `refused slot evidence must include ${expectedReason}`,
  );
}

const tooOld = createSingleFlameHistoryHoldoverDecision({
  liveState,
  historySlots: baseSlots,
  previousDecision: null,
  maxHoldoverAgeGenerations: 2,
});
assert.equal(tooOld.mode, 'holdover');
assert.equal(tooOld.selectedHistorySlot.slotIndex, 1, 'policy should select the earliest valid slot within the bounded age');
assert.equal(tooOld.selectedHistorySlot.sourceCandidateGeneration, 31);
assert.ok(tooOld.refusedSlots.some(slot => slot.reasons.includes('slot-source-age-exceeded')));

console.log('kiln flame history holdover contracts passed');
