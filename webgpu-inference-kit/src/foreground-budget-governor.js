import {
  WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA,
  WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA,
} from './command-duty-descriptor.js';

export const FOREGROUND_BUDGET_GOVERNOR_SCHEMA = 'kaminos.foreground-budget-governor-decision.v0';

const HOST_CORRELATION_SCHEMA = 'kaminos.foreground-host-event-correlation.v0';
const SHARP_CORRELATION_SCHEMA = 'kaminos.foreground-sharp-duty-correlation.v0';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function validateRange(range, name, { integer = false, multiplicative = false } = {}) {
  if (!isPlainObject(range)) throw new Error(`${name} must be a caller-declared bounds object`);
  if (!isFiniteNonNegative(range.min) || !isFiniteNonNegative(range.max) || range.max < range.min) {
    throw new Error(`${name} must declare ordered finite min and max bounds`);
  }
  if (integer && (!Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 1)) {
    throw new Error(`${name} min and max must be positive integers`);
  }
  if (multiplicative) {
    if (!Number.isFinite(range.stepFactor) || range.stepFactor <= 1) {
      throw new Error(`${name}.stepFactor must be greater than 1`);
    }
  } else if (!Number.isFinite(range.step) || range.step <= 0) {
    throw new Error(`${name}.step must be greater than 0`);
  }
}

function normalizeScheduler(input) {
  if (!isPlainObject(input)) throw new Error('scheduler must be an object');
  if (input.mode !== 'cooperative') throw new Error('foreground governor requires scheduler.mode cooperative');
  if (!isFiniteNonNegative(input.yieldMs)) throw new Error('scheduler.yieldMs must be finite and non-negative');
  if (typeof input.waitForSubmittedWorkDone !== 'boolean') {
    throw new Error('scheduler.waitForSubmittedWorkDone must be a boolean');
  }
  if (!isPlainObject(input.phaseChunkSize)) throw new Error('scheduler.phaseChunkSize must be an object');
  for (const [phase, chunkSize] of Object.entries(input.phaseChunkSize)) {
    if (!isNonEmptyString(phase) || !Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error(`scheduler.phaseChunkSize.${phase} must be a positive integer`);
    }
  }
  return clone(input);
}

function validateConfig(input) {
  if (!isNonEmptyString(input.episodeEpochId)) {
    throw new Error('episodeEpochId must be a non-empty caller-owned lifecycle identity');
  }
  if (!isFiniteNonNegative(input.targetFrameGapMs) || input.targetFrameGapMs === 0) {
    throw new Error('targetFrameGapMs must be greater than 0');
  }
  const scheduler = normalizeScheduler(input.scheduler);
  if (!isPlainObject(input.bounds)) throw new Error('foreground governor requires caller-declared bounds');
  validateRange(input.bounds.yieldMs, 'bounds.yieldMs');
  if (!isPlainObject(input.bounds.phaseChunkSize)) {
    throw new Error('bounds.phaseChunkSize must be a caller-declared bounds object');
  }
  for (const [phase, chunkSize] of Object.entries(scheduler.phaseChunkSize)) {
    const range = input.bounds.phaseChunkSize[phase];
    validateRange(range, `bounds.phaseChunkSize.${phase}`, { integer: true, multiplicative: true });
    if (chunkSize < range.min || chunkSize > range.max) {
      throw new Error(`scheduler.phaseChunkSize.${phase} is outside its caller-declared bounds`);
    }
  }
  if (scheduler.yieldMs < input.bounds.yieldMs.min || scheduler.yieldMs > input.bounds.yieldMs.max) {
    throw new Error('scheduler.yieldMs is outside its caller-declared bounds');
  }
  requirePositiveInteger(input.failureWindowsBeforeAdjust ?? 2, 'failureWindowsBeforeAdjust');
  requirePositiveInteger(input.successWindowsBeforeRelax ?? 3, 'successWindowsBeforeRelax');
  const dominantPhaseFraction = input.dominantPhaseFraction ?? 0.6;
  if (!Number.isFinite(dominantPhaseFraction) || dominantPhaseFraction <= 0 || dominantPhaseFraction > 1) {
    throw new Error('dominantPhaseFraction must be in (0, 1]');
  }
  if (input.phaseControlMap != null && !isPlainObject(input.phaseControlMap)) {
    throw new Error('phaseControlMap must be an object');
  }
  for (const [measuredPhase, schedulerControl] of Object.entries(input.phaseControlMap || {})) {
    if (!isNonEmptyString(measuredPhase) || !isNonEmptyString(schedulerControl)) {
      throw new Error('phaseControlMap entries must map non-empty phase names to scheduler controls');
    }
    if (!Object.hasOwn(scheduler.phaseChunkSize, schedulerControl)) {
      throw new Error(`phaseControlMap.${measuredPhase} names unknown scheduler control ${schedulerControl}`);
    }
  }
  if (!isPlainObject(input.attributionPolicy)) {
    throw new Error('foreground governor requires a caller-declared attributionPolicy');
  }
  const { minimumCoveredFraction, maximumSharedFraction } = input.attributionPolicy;
  if (!Number.isFinite(minimumCoveredFraction) || minimumCoveredFraction <= 0 || minimumCoveredFraction > 1) {
    throw new Error('attributionPolicy.minimumCoveredFraction must be in (0, 1]');
  }
  if (!Number.isFinite(maximumSharedFraction) || maximumSharedFraction < 0 || maximumSharedFraction > 1) {
    throw new Error('attributionPolicy.maximumSharedFraction must be in [0, 1]');
  }
  return scheduler;
}

function validateCommandDutyObservation(observation, state, failures) {
  const profile = observation?.commandDutyObservation;
  if (profile == null) return;
  if (profile?.schema !== WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA || profile?.status !== 'observed') {
    failures.push('command-duty-observation-invalid');
  }
  const executionIdentity = observation?.executionIdentity;
  if (!isPlainObject(executionIdentity)
    || !isNonEmptyString(executionIdentity.routeId)
    || !isNonEmptyString(executionIdentity.runId)
    || !isNonEmptyString(executionIdentity.clockId)) {
    failures.push('command-duty-execution-identity-invalid');
  }
  const profileIdentity = profile?.identity;
  if (!isPlainObject(profileIdentity)) {
    failures.push('command-duty-identity-invalid');
  } else {
    if (profileIdentity.routeId !== executionIdentity?.routeId) failures.push('command-duty-route-mismatch');
    if (profileIdentity.runId !== executionIdentity?.runId) failures.push('command-duty-run-mismatch');
    if (profileIdentity.clockId !== executionIdentity?.clockId) failures.push('command-duty-clock-mismatch');
    if (profileIdentity.firingId !== observation?.firingId) failures.push('command-duty-firing-mismatch');
  }
  if (profile?.retention !== 'uncapped') failures.push('command-duty-retention-invalid');
  if (!Array.isArray(profile?.duties)) {
    failures.push('command-duty-detail-missing');
    return;
  }
  if (profile.dutyCount !== profile.duties.length) failures.push('command-duty-count-mismatch');

  let observedDurationMs = 0;
  let foregroundOverlapDurationMs = 0;
  const dutyIds = new Set();
  for (const row of profile.duties) {
    const descriptor = row?.descriptor;
    if (descriptor?.schema !== WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA
      || !isNonEmptyString(descriptor?.dutyId)
      || !isNonEmptyString(descriptor?.phase)
      || !['compute', 'copy', 'render', 'mixed'].includes(descriptor?.kind)) {
      failures.push('command-duty-descriptor-invalid');
      continue;
    }
    if (dutyIds.has(descriptor.dutyId)) failures.push('command-duty-duplicate-id');
    dutyIds.add(descriptor.dutyId);
    if (descriptor.routeId !== profileIdentity?.routeId
      || descriptor.runId !== profileIdentity?.runId
      || descriptor.clockId !== profileIdentity?.clockId) {
      failures.push('command-duty-descriptor-identity-mismatch');
    }
    const boundary = descriptor.submissionBoundary;
    if (!isPlainObject(boundary)
      || boundary.interruptible !== false
      || boundary.canSplitBefore !== true
      || boundary.canSplitAfter !== true
      || boundary.authority !== 'submitted-command-buffer-non-preemptible') {
      failures.push('command-duty-boundary-invalid');
    }
    if (!isFiniteNonNegative(row?.observedDurationMs)
      || !isFiniteNonNegative(row?.foregroundOverlapDurationMs)
      || row.foregroundOverlapDurationMs > row.observedDurationMs) {
      failures.push('command-duty-duration-invalid');
      continue;
    }
    observedDurationMs += row.observedDurationMs;
    foregroundOverlapDurationMs += row.foregroundOverlapDurationMs;

    const control = descriptor.chunkControl;
    if (control == null) continue;
    if (!isPlainObject(control) || !isNonEmptyString(control.controlId)) {
      failures.push('command-duty-control-invalid');
      continue;
    }
    const expectedBounds = state.bounds.phaseChunkSize[control.controlId];
    const current = state.scheduler.phaseChunkSize[control.controlId];
    if (!expectedBounds || !Number.isInteger(current)) {
      failures.push('command-duty-control-unknown');
      continue;
    }
    if (control.current !== current) failures.push('command-duty-control-current-mismatch');
    if (stableSerialize(control.bounds) !== stableSerialize(expectedBounds)) {
      failures.push('command-duty-control-bounds-mismatch');
    }
  }
  if (!isPlainObject(profile.totals)
    || !isFiniteNonNegative(profile.totals.observedDurationMs)
    || !isFiniteNonNegative(profile.totals.foregroundOverlapDurationMs)
    || Math.abs(profile.totals.observedDurationMs - observedDurationMs) > 0.001
    || Math.abs(profile.totals.foregroundOverlapDurationMs - foregroundOverlapDurationMs) > 0.001) {
    failures.push('command-duty-totals-incoherent');
  }
}

function validateObservation(observation, state) {
  const failures = [];
  const host = observation?.hostEventCorrelation;
  const sharp = observation?.sharpDutyCorrelation;
  const firingId = observation?.firingId;
  if (!isNonEmptyString(observation?.episodeId)) failures.push('episode-id-missing');
  if (!isNonEmptyString(observation?.episodeEpochId)) failures.push('episode-epoch-id-missing');
  if (!isNonEmptyString(firingId)) failures.push('firing-id-missing');
  if (!isPlainObject(observation?.frameTail) || !isFiniteNonNegative(observation.frameTail.maxFrameGapMs)) {
    failures.push('frame-tail-invalid');
  }
  if (host?.schema !== HOST_CORRELATION_SCHEMA || host?.status !== 'verified'
    || (Array.isArray(host?.failures) && host.failures.length > 0)) {
    failures.push('host-correlation-invalid');
  }
  if (sharp?.schema !== SHARP_CORRELATION_SCHEMA || sharp?.status !== 'verified'
    || (Array.isArray(sharp?.failures) && sharp.failures.length > 0)) {
    failures.push('sharp-correlation-invalid');
  }
  if (host?.firingId !== firingId) failures.push('host-correlation-firing-mismatch');
  if (sharp?.firingId !== firingId) failures.push('sharp-correlation-firing-mismatch');
  if (!Array.isArray(host?.phaseRankings) || !Array.isArray(host?.unexplainedGapsAtOrAboveThreshold)) {
    failures.push('host-correlation-detail-missing');
  }
  if (!Array.isArray(sharp?.phaseRankings)) failures.push('sharp-correlation-detail-missing');

  validateCommandDutyObservation(observation, state, failures);

  const totals = host?.totals;
  const totalFields = [
    'foregroundGapDurationMs',
    'sharpCoveredDurationMs',
    'hostCoveredDurationMs',
    'sharedSharpHostDurationMs',
    'hostOnlyDurationMs',
    'combinedCoveredDurationMs',
    'uncoveredDurationMs',
  ];
  if (!isPlainObject(totals) || totalFields.some(field => !isFiniteNonNegative(totals?.[field]))) {
    failures.push('host-correlation-totals-invalid');
  } else {
    const epsilon = 1;
    if (Math.abs(totals.hostOnlyDurationMs
      - (totals.hostCoveredDurationMs - totals.sharedSharpHostDurationMs)) > epsilon
      || Math.abs(totals.combinedCoveredDurationMs
        - (totals.sharpCoveredDurationMs + totals.hostCoveredDurationMs
          - totals.sharedSharpHostDurationMs)) > epsilon
      || Math.abs(totals.foregroundGapDurationMs
        - (totals.combinedCoveredDurationMs + totals.uncoveredDurationMs)) > epsilon) {
      failures.push('host-correlation-totals-incoherent');
    }
  }
  return failures;
}

function rankedLeader(rankings, key) {
  return [...rankings]
    .filter(row => isNonEmptyString(row?.[key]) && isFiniteNonNegative(row?.overlapDurationMs))
    .sort((left, right) => right.overlapDurationMs - left.overlapDurationMs
      || left[key].localeCompare(right[key]))[0] || null;
}

function rankedCommandDuty(duties) {
  return [...duties]
    .filter(row => isNonEmptyString(row?.descriptor?.dutyId)
      && isFiniteNonNegative(row?.foregroundOverlapDurationMs))
    .sort((left, right) => right.foregroundOverlapDurationMs - left.foregroundOverlapDurationMs
      || left.descriptor.dutyId.localeCompare(right.descriptor.dutyId))[0] || null;
}

function makeDecision({
  state,
  observation,
  status,
  action,
  target = null,
  measuredPhase = null,
  commandDutyId = null,
  commandDutyKind = null,
  schedulerChanged = false,
  failures = [],
  attribution = null,
}) {
  return {
    schema: FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
    status,
    action,
    target,
    measuredPhase,
    commandDutyId,
    commandDutyKind,
    schedulerChanged,
    applicationAuthority: 'decision-state-only-not-runtime-application',
    revision: state.revision,
    observation: {
      episodeId: observation?.episodeId || null,
      episodeEpochId: observation?.episodeEpochId || null,
      firingId: observation?.firingId || null,
      maxFrameGapMs: observation?.frameTail?.maxFrameGapMs ?? null,
      targetFrameGapMs: state.targetFrameGapMs,
    },
    attribution,
    consecutivePressureWindows: state.consecutivePressureWindows,
    consecutiveHealthyWindows: state.consecutiveHealthyWindows,
    previousScheduler: clone(state.previousScheduler),
    effectiveScheduler: clone(state.scheduler),
    failures: [...failures],
  };
}

function relaxScheduler(state) {
  for (const [phase, baselineChunk] of Object.entries(state.baseline.phaseChunkSize)) {
    const currentChunk = state.scheduler.phaseChunkSize[phase];
    if (currentChunk < baselineChunk) {
      const stepFactor = state.bounds.phaseChunkSize[phase].stepFactor;
      state.scheduler.phaseChunkSize[phase] = Math.min(
        baselineChunk,
        Math.max(currentChunk + 1, Math.ceil(currentChunk * stepFactor)),
      );
      return { action: 'relax-phase-chunk', target: phase };
    }
  }
  if (state.scheduler.yieldMs > state.baseline.yieldMs) {
    state.scheduler.yieldMs = Math.max(
      state.baseline.yieldMs,
      state.scheduler.yieldMs - state.bounds.yieldMs.step,
    );
    return { action: 'reduce-yield-budget', target: 'yieldMs' };
  }
  return null;
}

export function createForegroundBudgetGovernor(input = {}) {
  const baseline = validateConfig(input);
  const state = {
    episodeEpochId: input.episodeEpochId,
    targetFrameGapMs: input.targetFrameGapMs,
    failureWindowsBeforeAdjust: input.failureWindowsBeforeAdjust ?? 2,
    successWindowsBeforeRelax: input.successWindowsBeforeRelax ?? 3,
    dominantPhaseFraction: input.dominantPhaseFraction ?? 0.6,
    phaseControlMap: clone(input.phaseControlMap || {}),
    attributionPolicy: clone(input.attributionPolicy),
    bounds: clone(input.bounds),
    baseline: clone(baseline),
    scheduler: clone(baseline),
    previousScheduler: clone(baseline),
    revision: 0,
    consecutivePressureWindows: 0,
    consecutiveHealthyWindows: 0,
    pressureKey: null,
    decisionsByEpisode: new Map(),
    episodeIdentities: new Map(),
  };

  function remember(observation, decision, evidenceFingerprint) {
    state.episodeIdentities.set(observation.episodeId, {
      firingId: observation.firingId,
      evidenceFingerprint,
    });
    state.decisionsByEpisode.set(observation.episodeId, clone(decision));
    return decision;
  }

  function observe(observation = {}) {
    state.previousScheduler = clone(state.scheduler);
    const failures = validateObservation(observation, state);
    if (isNonEmptyString(observation?.episodeEpochId)
      && observation.episodeEpochId !== state.episodeEpochId) {
      failures.push('episode-epoch-mismatch');
    }
    if (failures.length) {
      state.consecutivePressureWindows = 0;
      state.consecutiveHealthyWindows = 0;
      state.pressureKey = null;
      return makeDecision({
        state,
        observation,
        status: 'held-invalid-evidence',
        action: 'hold',
        failures,
      });
    }
    const evidenceFingerprint = stableSerialize(observation);
    const priorIdentity = state.episodeIdentities.get(observation.episodeId);
    if (priorIdentity) {
      if (priorIdentity.firingId !== observation.firingId) {
        state.consecutivePressureWindows = 0;
        state.consecutiveHealthyWindows = 0;
        state.pressureKey = null;
        return makeDecision({
          state,
          observation,
          status: 'held-invalid-evidence',
          action: 'hold',
          failures: ['episode-firing-mismatch'],
        });
      }
      if (priorIdentity.evidenceFingerprint !== evidenceFingerprint) {
        state.consecutivePressureWindows = 0;
        state.consecutiveHealthyWindows = 0;
        state.pressureKey = null;
        return makeDecision({
          state,
          observation,
          status: 'held-invalid-evidence',
          action: 'hold',
          failures: ['episode-evidence-mismatch'],
        });
      }
      const retainedDecision = state.decisionsByEpisode.get(observation.episodeId);
      if (retainedDecision) return clone(retainedDecision);
      return makeDecision({
        state,
        observation,
        status: 'duplicate-observation-held',
        action: 'hold',
      });
    }

    const host = observation.hostEventCorrelation;
    const totals = host.totals;
    const attribution = {
      foregroundGapDurationMs: totals.foregroundGapDurationMs,
      sharpOnlyDurationMs: Math.max(0, totals.sharpCoveredDurationMs - totals.sharedSharpHostDurationMs),
      hostOnlyDurationMs: totals.hostOnlyDurationMs,
      sharedSharpHostDurationMs: totals.sharedSharpHostDurationMs,
      uncoveredDurationMs: totals.uncoveredDurationMs,
      coveredFraction: totals.foregroundGapDurationMs > 0
        ? totals.combinedCoveredDurationMs / totals.foregroundGapDurationMs
        : 0,
      sharedFraction: totals.foregroundGapDurationMs > 0
        ? totals.sharedSharpHostDurationMs / totals.foregroundGapDurationMs
        : 0,
    };
    if (host.unexplainedGapsAtOrAboveThreshold.length > 0) {
      state.consecutivePressureWindows = 0;
      state.consecutiveHealthyWindows = 0;
      state.pressureKey = null;
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'instrumentation-required',
        action: 'instrument-unattributed-gap',
        attribution,
      }), evidenceFingerprint);
    }
    if (attribution.coveredFraction < state.attributionPolicy.minimumCoveredFraction) {
      state.consecutivePressureWindows = 0;
      state.consecutiveHealthyWindows = 0;
      state.pressureKey = null;
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'instrumentation-required',
        action: 'increase-attribution-coverage',
        attribution,
      }), evidenceFingerprint);
    }
    if (attribution.sharedFraction > state.attributionPolicy.maximumSharedFraction) {
      state.consecutivePressureWindows = 0;
      state.consecutiveHealthyWindows = 0;
      state.pressureKey = null;
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'instrumentation-required',
        action: 'disambiguate-shared-pressure',
        attribution,
      }), evidenceFingerprint);
    }

    if (observation.frameTail.maxFrameGapMs <= state.targetFrameGapMs) {
      state.consecutivePressureWindows = 0;
      state.pressureKey = null;
      state.consecutiveHealthyWindows += 1;
      if (state.consecutiveHealthyWindows >= state.successWindowsBeforeRelax) {
        const relaxation = relaxScheduler(state);
        state.consecutiveHealthyWindows = 0;
        if (relaxation) {
          state.revision += 1;
          return remember(observation, makeDecision({
            state,
            observation,
            status: 'relaxed',
            action: relaxation.action,
            target: relaxation.target,
            schedulerChanged: true,
            attribution,
          }), evidenceFingerprint);
        }
      }
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'maintaining',
        action: 'hold',
        attribution,
      }), evidenceFingerprint);
    }

    state.consecutiveHealthyWindows = 0;
    const hostLeader = rankedLeader(host.phaseRankings, 'phase');
    if (attribution.hostOnlyDurationMs > attribution.sharpOnlyDurationMs && hostLeader) {
      state.consecutivePressureWindows = 0;
      state.pressureKey = null;
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'host-phase-split-required',
        action: 'split-host-phase',
        target: hostLeader.phase,
        attribution,
      }), evidenceFingerprint);
    }

    const commandDutyLeader = observation.commandDutyObservation
      ? rankedCommandDuty(observation.commandDutyObservation.duties)
      : null;
    const sharpLeader = commandDutyLeader
      ? null
      : rankedLeader(observation.sharpDutyCorrelation.phaseRankings, 'phase');
    const leaderOverlapDurationMs = commandDutyLeader?.foregroundOverlapDurationMs
      ?? sharpLeader?.overlapDurationMs
      ?? 0;
    const leaderFraction = totals.sharpCoveredDurationMs > 0
      ? leaderOverlapDurationMs / totals.sharpCoveredDurationMs
      : 0;
    const phaseControl = commandDutyLeader?.descriptor.chunkControl?.controlId
      || (sharpLeader ? (state.phaseControlMap[sharpLeader.phase] || sharpLeader.phase) : null);
    const canReducePhase = (commandDutyLeader || sharpLeader)
      && leaderFraction >= state.dominantPhaseFraction
      && state.bounds.phaseChunkSize[phaseControl]
      && Number.isInteger(state.scheduler.phaseChunkSize[phaseControl]);
    const action = canReducePhase ? 'reduce-phase-chunk' : 'increase-yield-budget';
    const target = canReducePhase ? phaseControl : 'yieldMs';
    const measuredPhase = commandDutyLeader?.descriptor.phase || sharpLeader?.phase || null;
    const commandDutyId = commandDutyLeader?.descriptor.dutyId || null;
    const commandDutyKind = commandDutyLeader?.descriptor.kind || null;
    const pressureKey = `${action}:${target}`;
    if (state.pressureKey === pressureKey) state.consecutivePressureWindows += 1;
    else {
      state.pressureKey = pressureKey;
      state.consecutivePressureWindows = 1;
    }
    if (state.consecutivePressureWindows < state.failureWindowsBeforeAdjust) {
      return remember(observation, makeDecision({
        state,
        observation,
        status: 'accumulating-pressure',
        action,
        target,
        measuredPhase,
        commandDutyId,
        commandDutyKind,
        attribution,
      }), evidenceFingerprint);
    }

    if (canReducePhase) {
      const range = state.bounds.phaseChunkSize[target];
      const current = state.scheduler.phaseChunkSize[target];
      state.scheduler.phaseChunkSize[target] = Math.max(
        range.min,
        Math.floor(current / range.stepFactor),
      );
    } else {
      const range = state.bounds.yieldMs;
      state.scheduler.yieldMs = Math.min(range.max, state.scheduler.yieldMs + range.step);
    }
    state.consecutivePressureWindows = 0;
    state.pressureKey = null;
    const schedulerChanged = JSON.stringify(state.scheduler) !== JSON.stringify(state.previousScheduler);
    if (schedulerChanged) state.revision += 1;
    return remember(observation, makeDecision({
      state,
      observation,
      status: schedulerChanged ? 'adjusted' : 'saturated',
      action,
      target,
      measuredPhase,
      commandDutyId,
      commandDutyKind,
      schedulerChanged,
      attribution,
    }), evidenceFingerprint);
  }

  return {
    observe,
    forgetEpisode(episodeId) {
      return state.decisionsByEpisode.delete(episodeId);
    },
    clearDecisionHistory() {
      state.decisionsByEpisode.clear();
    },
    beginEpisodeEpoch(nextEpisodeEpochId) {
      if (!isNonEmptyString(nextEpisodeEpochId)) {
        throw new Error('nextEpisodeEpochId must be a non-empty caller-owned lifecycle identity');
      }
      if (nextEpisodeEpochId === state.episodeEpochId) {
        throw new Error('nextEpisodeEpochId must differ from the current episode epoch');
      }
      const previousEpisodeEpochId = state.episodeEpochId;
      state.episodeEpochId = nextEpisodeEpochId;
      state.decisionsByEpisode.clear();
      state.episodeIdentities.clear();
      state.consecutivePressureWindows = 0;
      state.consecutiveHealthyWindows = 0;
      state.pressureKey = null;
      state.previousScheduler = clone(state.scheduler);
      return {
        previousEpisodeEpochId,
        episodeEpochId: state.episodeEpochId,
        revision: state.revision,
        scheduler: clone(state.scheduler),
      };
    },
    snapshot() {
      return {
        schema: FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
        revision: state.revision,
        scheduler: clone(state.scheduler),
        baseline: clone(state.baseline),
        bounds: clone(state.bounds),
        targetFrameGapMs: state.targetFrameGapMs,
        attributionPolicy: clone(state.attributionPolicy),
        episodeEpochId: state.episodeEpochId,
        retainedDecisionCount: state.decisionsByEpisode.size,
        retainedEpisodeIdentityCount: state.episodeIdentities.size,
      };
    },
  };
}
