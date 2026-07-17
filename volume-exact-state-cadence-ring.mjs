export const EXACT_STATE_CADENCE_RING_IDENTITY = 'kaminos.volume.exact-state-cadence-ring.v0';

const ALLOCATION_AUTHORITY = 'requested-depth-plus-webgpu-per-buffer-limits-v0';
const ONE_SIMULATOR_AUTHORITY = 'single-authoritative-simulator-completed-state-history-v0';
const PHASE_SOURCE = 'completed-exact-state-continuation-history';

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function finiteLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number.MAX_SAFE_INTEGER;
}

function refusal(reason, receipt = {}) {
  return {
    ok: false,
    reason,
    receipt: {
      identity: EXACT_STATE_CADENCE_RING_IDENTITY,
      status: 'refused',
      reason,
      ...receipt,
    },
  };
}

export function exactStateCadenceAllocationPlan(options = {}) {
  const requestedDepth = positiveInteger(options.requestedDepth);
  const presentationDelaySteps = nonNegativeInteger(options.presentationDelaySteps);
  const requiredDepth = presentationDelaySteps + 2;
  const fluidBytes = positiveInteger(options.fluidBytes);
  const frontBytes = positiveInteger(options.frontBytes);
  const maxBufferSize = finiteLimit(options.maxBufferSize);
  const maxStorageBufferBindingSize = finiteLimit(options.maxStorageBufferBindingSize);
  const limitingBufferBytes = Math.min(maxBufferSize, maxStorageBufferBindingSize);
  const refusalReasons = [];

  if (requestedDepth < requiredDepth) {
    refusalReasons.push('requested-depth-cannot-hold-delayed-adjacent-bracket');
  }
  if (fluidBytes > maxBufferSize) refusalReasons.push('fluid-state-exceeds-device-buffer-limit');
  if (fluidBytes > maxStorageBufferBindingSize) refusalReasons.push('fluid-state-exceeds-device-storage-binding-limit');
  if (frontBytes > maxBufferSize) refusalReasons.push('front-state-exceeds-device-buffer-limit');
  if (frontBytes > maxStorageBufferBindingSize) refusalReasons.push('front-state-exceeds-device-storage-binding-limit');
  if (fluidBytes < 1) refusalReasons.push('fluid-state-byte-size-invalid');
  if (frontBytes < 1) refusalReasons.push('front-state-byte-size-invalid');

  const ok = refusalReasons.length === 0;
  const allocatedDepth = ok ? requestedDepth : 0;
  const slotBytes = fluidBytes + frontBytes;
  return {
    identity: 'kaminos.volume.exact-state-cadence-allocation-plan.v0',
    ok,
    authority: ALLOCATION_AUTHORITY,
    requestedDepth,
    allocatedDepth,
    activeDepth: allocatedDepth,
    presentationDelaySteps,
    requiredDepth,
    fluidBytes,
    frontBytes,
    slotBytes,
    ringBytes: allocatedDepth * slotBytes,
    presentationBytes: slotBytes,
    totalCadenceBytes: (allocatedDepth + 1) * slotBytes,
    maxBufferSize,
    maxStorageBufferBindingSize,
    limitingBufferBytes,
    refusalReasons,
  };
}

export function createExactStateCadenceRing(options = {}) {
  const capacity = positiveInteger(options.capacity);
  const presentationDelaySteps = nonNegativeInteger(options.presentationDelaySteps);
  if (capacity < presentationDelaySteps + 2) {
    throw new Error('exact-state cadence capacity must hold delayed adjacent presentation states');
  }
  const stepDurationMs = Number(options.stepDurationMs);
  if (!Number.isFinite(stepDurationMs) || stepDurationMs <= 0) {
    throw new Error('exact-state cadence step duration must be positive');
  }
  const controlGeneration = nonNegativeInteger(options.controlGeneration);
  return {
    identity: EXACT_STATE_CADENCE_RING_IDENTITY,
    oneSimulatorAuthority: ONE_SIMULATOR_AUTHORITY,
    phaseSource: PHASE_SOURCE,
    capacity,
    presentationDelaySteps,
    stepDurationMs,
    controlGeneration,
    resetSequence: 0,
    writeSequence: 0,
    slots: Array.from({ length: capacity }, () => null),
    residentSourceSteps: [],
    residentCount: 0,
    oldestSourceStep: null,
    newestSourceStep: null,
    presentationClockStartMs: null,
    presentationClockStartSourceStep: null,
    lastPresentationNowMs: null,
    lastPresentedFromSourceStep: null,
    lastPresentedToSourceStep: null,
    lastPresentedAlpha: null,
    completedStateCount: 0,
    refusedCompletionCount: 0,
    refusedPresentationCount: 0,
    lastRefusal: null,
  };
}

function rememberRefusal(ring, result, kind) {
  ring.lastRefusal = result.receipt;
  if (kind === 'completion') ring.refusedCompletionCount += 1;
  if (kind === 'presentation') ring.refusedPresentationCount += 1;
  return result;
}

function updateResidency(ring) {
  ring.residentSourceSteps.sort((a, b) => a - b);
  ring.residentCount = ring.residentSourceSteps.length;
  ring.oldestSourceStep = ring.residentSourceSteps[0] ?? null;
  ring.newestSourceStep = ring.residentSourceSteps.at(-1) ?? null;
}

function slotForSourceStep(ring, sourceStep) {
  return ring.slots.find(slot => slot?.sourceStep === sourceStep) || null;
}

export function recordCompletedExactState(ring, completion = {}) {
  const sourceStep = nonNegativeInteger(completion.sourceStep, -1);
  const controlGeneration = nonNegativeInteger(completion.controlGeneration, -1);
  const completedAtMs = Number(completion.completedAtMs);
  if (controlGeneration !== ring.controlGeneration) {
    return rememberRefusal(ring, refusal('completed-state-control-generation-mismatch', {
      expectedControlGeneration: ring.controlGeneration,
      receivedControlGeneration: controlGeneration,
      sourceStep,
    }), 'completion');
  }
  if (sourceStep < 0 || !Number.isFinite(completedAtMs)) {
    return rememberRefusal(ring, refusal('completed-state-metadata-invalid', { sourceStep, completedAtMs }), 'completion');
  }
  if (ring.newestSourceStep !== null && sourceStep !== ring.newestSourceStep + 1) {
    return rememberRefusal(ring, refusal('completed-state-source-step-nonconsecutive', {
      newestSourceStep: ring.newestSourceStep,
      receivedSourceStep: sourceStep,
    }), 'completion');
  }

  let slot = ring.slots.findIndex(value => value === null);
  let evictedSourceStep = null;
  if (slot < 0) {
    const oldestSourceStep = ring.oldestSourceStep;
    const safeToEvict = ring.lastPresentedFromSourceStep !== null
      && oldestSourceStep < ring.lastPresentedFromSourceStep;
    if (!safeToEvict) {
      return rememberRefusal(ring, refusal('producer-would-overwrite-unpresented-state', {
        sourceStep,
        oldestSourceStep,
        newestSourceStep: ring.newestSourceStep,
        lastPresentedFromSourceStep: ring.lastPresentedFromSourceStep,
        capacity: ring.capacity,
      }), 'completion');
    }
    slot = ring.slots.findIndex(value => value?.sourceStep === oldestSourceStep);
    evictedSourceStep = oldestSourceStep;
    ring.residentSourceSteps = ring.residentSourceSteps.filter(value => value !== oldestSourceStep);
  }

  const writeSequence = ring.writeSequence;
  ring.slots[slot] = {
    slot,
    sourceStep,
    completedAtMs,
    controlGeneration,
    writeSequence,
    status: 'completed',
  };
  ring.writeSequence += 1;
  ring.completedStateCount += 1;
  ring.residentSourceSteps.push(sourceStep);
  updateResidency(ring);
  return {
    ok: true,
    receipt: {
      identity: EXACT_STATE_CADENCE_RING_IDENTITY,
      status: 'completed',
      oneSimulatorAuthority: ring.oneSimulatorAuthority,
      phaseSource: ring.phaseSource,
      slot,
      sourceStep,
      completedAtMs,
      controlGeneration,
      writeSequence,
      evictedSourceStep,
      residentCount: ring.residentCount,
      oldestSourceStep: ring.oldestSourceStep,
      newestSourceStep: ring.newestSourceStep,
    },
  };
}

export function selectExactStatePresentation(ring, options = {}) {
  const nowMs = Number(options.nowMs);
  if (!Number.isFinite(nowMs)) {
    return rememberRefusal(ring, refusal('presentation-clock-invalid', { nowMs }), 'presentation');
  }
  if (ring.residentCount < ring.presentationDelaySteps + 2) {
    return rememberRefusal(ring, refusal('presentation-history-warmup-incomplete', {
      residentCount: ring.residentCount,
      requiredResidentCount: ring.presentationDelaySteps + 2,
    }), 'presentation');
  }
  if (ring.lastPresentationNowMs !== null && nowMs <= ring.lastPresentationNowMs) {
    return rememberRefusal(ring, refusal('duplicate-presentation-clock-sample', {
      nowMs,
      lastPresentationNowMs: ring.lastPresentationNowMs,
    }), 'presentation');
  }
  if (ring.presentationClockStartMs === null) {
    ring.presentationClockStartMs = nowMs;
    ring.presentationClockStartSourceStep = ring.newestSourceStep - ring.presentationDelaySteps;
  }

  const sourcePosition = ring.presentationClockStartSourceStep
    + (nowMs - ring.presentationClockStartMs) / ring.stepDurationMs;
  const fromSourceStep = Math.floor(sourcePosition + Number.EPSILON);
  const toSourceStep = fromSourceStep + 1;
  const alpha = Math.max(0, Math.min(1, sourcePosition - fromSourceStep));
  if (toSourceStep > ring.newestSourceStep) {
    return rememberRefusal(ring, refusal('presentation-lead-underflow', {
      nowMs,
      sourcePosition,
      requestedFromSourceStep: fromSourceStep,
      requestedToSourceStep: toSourceStep,
      newestSourceStep: ring.newestSourceStep,
    }), 'presentation');
  }
  if (fromSourceStep < ring.oldestSourceStep) {
    return rememberRefusal(ring, refusal('presentation-history-overrun', {
      nowMs,
      sourcePosition,
      requestedFromSourceStep: fromSourceStep,
      oldestSourceStep: ring.oldestSourceStep,
    }), 'presentation');
  }
  const fromSlot = slotForSourceStep(ring, fromSourceStep);
  const toSlot = slotForSourceStep(ring, toSourceStep);
  if (!fromSlot || !toSlot) {
    return rememberRefusal(ring, refusal('presentation-adjacent-state-missing', {
      fromSourceStep,
      toSourceStep,
    }), 'presentation');
  }
  if (fromSlot.controlGeneration !== ring.controlGeneration || toSlot.controlGeneration !== ring.controlGeneration) {
    return rememberRefusal(ring, refusal('presentation-cross-generation-interpolation-refused', {
      controlGeneration: ring.controlGeneration,
      fromControlGeneration: fromSlot.controlGeneration,
      toControlGeneration: toSlot.controlGeneration,
    }), 'presentation');
  }

  ring.lastPresentationNowMs = nowMs;
  ring.lastPresentedFromSourceStep = fromSourceStep;
  ring.lastPresentedToSourceStep = toSourceStep;
  ring.lastPresentedAlpha = alpha;
  return {
    ok: true,
    receipt: {
      identity: EXACT_STATE_CADENCE_RING_IDENTITY,
      status: 'selected',
      oneSimulatorAuthority: ring.oneSimulatorAuthority,
      phaseSource: ring.phaseSource,
      controlGeneration: ring.controlGeneration,
      nowMs,
      sourcePosition,
      fromSourceStep,
      toSourceStep,
      fromSlot: fromSlot.slot,
      toSlot: toSlot.slot,
      alpha,
      producerLeadSteps: ring.newestSourceStep - sourcePosition,
      oldestSourceStep: ring.oldestSourceStep,
      newestSourceStep: ring.newestSourceStep,
    },
  };
}

export function resetExactStateCadenceRing(ring, options = {}) {
  const nextControlGeneration = nonNegativeInteger(options.controlGeneration, ring.controlGeneration + 1);
  if (nextControlGeneration <= ring.controlGeneration) {
    return refusal('control-generation-must-increase-on-reset', {
      currentControlGeneration: ring.controlGeneration,
      requestedControlGeneration: nextControlGeneration,
    });
  }
  ring.controlGeneration = nextControlGeneration;
  ring.resetSequence += 1;
  ring.slots.fill(null);
  ring.residentSourceSteps = [];
  ring.residentCount = 0;
  ring.oldestSourceStep = null;
  ring.newestSourceStep = null;
  ring.presentationClockStartMs = null;
  ring.presentationClockStartSourceStep = null;
  ring.lastPresentationNowMs = null;
  ring.lastPresentedFromSourceStep = null;
  ring.lastPresentedToSourceStep = null;
  ring.lastPresentedAlpha = null;
  ring.lastRefusal = null;
  return {
    ok: true,
    receipt: {
      identity: EXACT_STATE_CADENCE_RING_IDENTITY,
      status: 'reset',
      reason: String(options.reason || 'unspecified'),
      controlGeneration: ring.controlGeneration,
      resetSequence: ring.resetSequence,
    },
  };
}
