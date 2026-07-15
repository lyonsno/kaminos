export const SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA = 'kaminos.single-flame-bounded-history-holdover.v0';
export const SHARED_CURRENT_FROZEN_SMOKE_AUTHORITY = 'shared-current-frozen-simulator-smoke-no-history-replay';
export const HOLDOVER_FLAME_AUTHORITY = 'bounded-completed-live-history-replay-no-independent-simulation-no-learned-prediction';
export const HOLDOVER_RENDERER_ABI = 'renderBoundarySplatHistorySlotToCanvas';

export const HOLDOVER_FRAME_SKIP_FLAGS = Object.freeze({
  simulationSubmitted: false,
  sidecarSubmitted: false,
  majorantSubmitted: false,
  compactionSubmitted: false,
  archiveSubmitted: false,
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteInteger(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

function previousCounts(previousDecision) {
  const counts = previousDecision?.counts || {};
  return {
    live: finiteInteger(counts.live) || 0,
    holdover: finiteInteger(counts.holdover) || 0,
    fallback: finiteInteger(counts.fallback) || 0,
  };
}

function cloneSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  return {
    slotIndex: finiteInteger(slot.slotIndex),
    initialized: slot.initialized === true,
    writeSubmissionCompleted: slot.writeSubmissionCompleted === true,
    historyAllocationGeneration: finiteInteger(slot.historyAllocationGeneration),
    archiveWriteSequence: finiteInteger(slot.archiveWriteSequence),
    sourceCandidateGeneration: finiteInteger(slot.sourceCandidateGeneration),
    sourceSimStepCount: finiteInteger(slot.sourceSimStepCount),
    sourceRenderFrameCount: finiteInteger(slot.sourceRenderFrameCount),
    sourceCandidateCount: finiteInteger(slot.sourceCandidateCount),
    effectiveDrawCount: finiteInteger(slot.effectiveDrawCount ?? slot.requestedDrawCount),
    candidateCapacity: finiteInteger(slot.candidateCapacity),
    completedAtMs: finiteNumber(slot.completedAtMs),
  };
}

function liveGeneration(liveState) {
  return finiteInteger(liveState?.sourceCandidateGeneration ?? liveState?.currentSourceCandidateGeneration);
}

function liveAllocationGeneration(liveState) {
  return finiteInteger(liveState?.historyAllocationGeneration ?? liveState?.currentHistoryAllocationGeneration);
}

function liveCapacity(liveState) {
  return finiteInteger(liveState?.candidateCapacity ?? liveState?.boundarySplatCapacity);
}

function validateSlot(slot, { liveState, maxHoldoverAgeGenerations }) {
  const normalized = cloneSlot(slot);
  const reasons = [];
  const currentGeneration = liveGeneration(liveState);
  const currentAllocation = liveAllocationGeneration(liveState);
  const currentCapacity = liveCapacity(liveState);
  if (!normalized) {
    return { slot: null, reasons: ['slot-missing'] };
  }
  if (normalized.slotIndex === null || normalized.slotIndex < 0) reasons.push('slot-index-invalid');
  if (!normalized.initialized) reasons.push('slot-uninitialized');
  if (!normalized.writeSubmissionCompleted) reasons.push('slot-write-incomplete');
  if (currentAllocation === null || normalized.historyAllocationGeneration !== currentAllocation) {
    reasons.push('slot-allocation-generation-mismatch');
  }
  if (currentCapacity === null || normalized.candidateCapacity !== currentCapacity) {
    reasons.push('slot-candidate-capacity-mismatch');
  }
  if (currentGeneration === null || normalized.sourceCandidateGeneration === null) {
    reasons.push('slot-source-generation-missing');
  } else if (normalized.sourceCandidateGeneration >= currentGeneration) {
    reasons.push('slot-source-generation-future');
  }
  if (normalized.sourceCandidateCount === null || normalized.sourceCandidateCount <= 0) {
    reasons.push('slot-candidate-count-empty');
  }
  if (normalized.effectiveDrawCount === null || normalized.effectiveDrawCount <= 0) {
    reasons.push('slot-effective-draw-count-empty');
  }
  if (
    normalized.effectiveDrawCount !== null
    && normalized.sourceCandidateCount !== null
    && normalized.effectiveDrawCount > normalized.sourceCandidateCount
  ) {
    reasons.push('slot-draw-count-exceeds-source');
  }
  if (
    normalized.sourceCandidateCount !== null
    && normalized.candidateCapacity !== null
    && normalized.sourceCandidateCount > normalized.candidateCapacity
  ) {
    reasons.push('slot-candidate-count-exceeds-capacity');
  }
  const sourceAgeGenerations = currentGeneration !== null && normalized.sourceCandidateGeneration !== null
    ? currentGeneration - normalized.sourceCandidateGeneration
    : null;
  if (
    sourceAgeGenerations !== null
    && Number.isFinite(Number(maxHoldoverAgeGenerations))
    && sourceAgeGenerations > Number(maxHoldoverAgeGenerations)
  ) {
    reasons.push('slot-source-age-exceeded');
  }
  return { slot: normalized, reasons, sourceAgeGenerations };
}

function refusalEvidence({ slot, reasons, sourceAgeGenerations }) {
  return {
    slotIndex: slot?.slotIndex ?? null,
    sourceCandidateGeneration: slot?.sourceCandidateGeneration ?? null,
    archiveWriteSequence: slot?.archiveWriteSequence ?? null,
    reasons,
    sourceAgeGenerations: sourceAgeGenerations ?? null,
  };
}

function liveDecision({ liveState, previousDecision, fallbackReason, refusedSlots = [] }) {
  const counts = previousCounts(previousDecision);
  const isFallback = fallbackReason && fallbackReason !== 'simulator-not-starved';
  return {
    schema: SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA,
    mode: 'live',
    rendererAbi: HOLDOVER_RENDERER_ABI,
    firingId: String(liveState?.firingId || ''),
    selectedHistorySlot: null,
    holdoverOrdinal: 0,
    sourceAgeGenerations: null,
    repeatedSlotCount: 0,
    skip: null,
    flameAuthority: 'current-live-candidate-buffer',
    smokeAuthority: 'shared-current-live-simulator-smoke',
    fallbackReason,
    refusedSlots,
    counts: {
      live: counts.live + 1,
      holdover: counts.holdover,
      fallback: counts.fallback + (isFallback ? 1 : 0),
    },
  };
}

export function createSingleFlameHistoryHoldoverDecision({
  liveState = {},
  historySlots = [],
  previousDecision = null,
  maxHoldoverAgeGenerations = 8,
} = {}) {
  if (!liveState?.simulatorStarved) {
    return liveDecision({
      liveState,
      previousDecision,
      fallbackReason: 'simulator-not-starved',
      refusedSlots: [],
    });
  }
  const previousGeneration = finiteInteger(previousDecision?.selectedHistorySlot?.sourceCandidateGeneration);
  const refusedSlots = [];
  const candidates = [];
  for (const rawSlot of Array.isArray(historySlots) ? historySlots : []) {
    const validation = validateSlot(rawSlot, { liveState, maxHoldoverAgeGenerations });
    const reasons = [...validation.reasons];
    if (
      previousGeneration !== null
      && validation.slot?.sourceCandidateGeneration !== null
      && validation.slot.sourceCandidateGeneration <= previousGeneration
    ) {
      reasons.push('slot-not-after-previous-holdover');
    }
    if (reasons.length) {
      refusedSlots.push(refusalEvidence({ ...validation, reasons }));
      continue;
    }
    candidates.push(validation);
  }
  candidates.sort((left, right) => {
    const leftGeneration = left.slot.sourceCandidateGeneration;
    const rightGeneration = right.slot.sourceCandidateGeneration;
    if (leftGeneration !== rightGeneration) return leftGeneration - rightGeneration;
    return left.slot.archiveWriteSequence - right.slot.archiveWriteSequence;
  });
  const selected = candidates[0] || null;
  if (!selected) {
    return liveDecision({
      liveState,
      previousDecision,
      fallbackReason: previousGeneration === null ? 'no-valid-history-slot' : 'holdover-exhausted',
      refusedSlots,
    });
  }
  const counts = previousCounts(previousDecision);
  const previousSlotIndex = finiteInteger(previousDecision?.selectedHistorySlot?.slotIndex);
  const repeatedSlotCount = previousSlotIndex !== null && previousSlotIndex === selected.slot.slotIndex
    ? (finiteInteger(previousDecision?.repeatedSlotCount) || 0) + 1
    : 0;
  return {
    schema: SINGLE_FLAME_BOUNDED_HISTORY_HOLDOVER_SCHEMA,
    mode: 'holdover',
    rendererAbi: HOLDOVER_RENDERER_ABI,
    firingId: String(liveState?.firingId || ''),
    selectedHistorySlot: selected.slot,
    holdoverOrdinal: counts.holdover + 1,
    sourceAgeGenerations: selected.sourceAgeGenerations,
    repeatedSlotCount,
    skip: { ...HOLDOVER_FRAME_SKIP_FLAGS },
    flameAuthority: HOLDOVER_FLAME_AUTHORITY,
    smokeAuthority: SHARED_CURRENT_FROZEN_SMOKE_AUTHORITY,
    fallbackReason: null,
    refusedSlots,
    counts: {
      live: counts.live,
      holdover: counts.holdover + 1,
      fallback: counts.fallback,
    },
  };
}
