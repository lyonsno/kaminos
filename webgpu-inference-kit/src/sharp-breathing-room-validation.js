export const SHARP_BREATHING_ROOM_VALIDATION_SCHEMA = 'kaminos.sharp-breathing-room-validation.v0';

import { validateSchedulerVerificationReceipt } from './scheduler-verification-receipt.js';

export const SHARP_BREATHING_ROOM_SINGLE_PAIR_CLAIM_BOUNDARY =
  'single-pair smoke only; no optimization, speedup, slowdown, or stable throughput claim';

const SHARP_BREATHING_ROOM_COMPARISON_SCHEMA = 'kaminos.sharp-breathing-room-comparison.v0';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function addUnique(values, value) {
  if (value && !values.includes(value)) values.push(value);
}

function finite(value) {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function runByProfile(comparison, profileId) {
  return asArray(comparison.runs).find(run => run?.profileId === profileId) || null;
}

function timing(run = {}) {
  return asObject(run.timing);
}

function hasFrameQueueEvidence(run = {}) {
  const runTiming = timing(run);
  return finite(runTiming.frameP95Ms) && finite(runTiming.queueDoneP95Ms);
}

function verification(run = {}) {
  return asObject(run.schedulerVerification);
}

function hasObservedSchedulerBoundaryProof(schedulerVerification = {}) {
  const validated = validateSchedulerVerificationReceipt(schedulerVerification);
  if (!validated.ok) return false;
  if (!['verified', 'unsupported'].includes(schedulerVerification.status)) return false;
  if (schedulerVerification.falseAuthorityChecks?.timingProxyOnly) return false;
  if (schedulerVerification.falseAuthorityChecks?.eventTraceMissing) return false;
  if (schedulerVerification.falseAuthorityChecks?.queueWaitEventsMissing) return false;
  if (schedulerVerification.falseAuthorityChecks?.boundaryAssertionEventMismatch) return false;
  if (schedulerVerification.falseAuthorityChecks?.requestedBoundaryAssertionMissing) return false;
  if (schedulerVerification.falseAuthorityChecks?.requestedFieldDroppedWithoutUnsupported) return false;
  const downgrades = asArray(schedulerVerification.downgrades);
  if (downgrades.some(downgrade => [
    'event-trace-missing',
    'timing-proxy-only',
    'queue-wait-events-missing',
    'yield-events-missing',
    'boundary-assertion-event-mismatch',
    'requested-boundary-assertion-missing',
    'requested-field-dropped-without-unsupported',
  ].includes(downgrade))) return false;
  const events = asArray(schedulerVerification.eventTrace?.events);
  return events.length > 0
    && asArray(schedulerVerification.boundaryAssertions).some(assertionHasVerifiedEventEvidence(events));
}

function verifiedWithoutBoundaryProof(schedulerVerification = {}) {
  return schedulerVerification.status === 'verified' && !hasObservedSchedulerBoundaryProof(schedulerVerification);
}

function schedulerProofIsProxyOnly(schedulerVerification = {}) {
  return schedulerVerification.falseAuthorityChecks?.timingProxyOnly === true
    || schedulerVerification.eventTrace?.timingAuthority === 'raf-and-queue-proxy';
}

function unsupportedFieldsForRun(run = {}) {
  return uniq([
    ...asArray(run.unsupportedFields),
    ...asArray(run.schedulerComparison?.unsupportedFields),
    ...asArray(run.schedulerVerification?.unsupportedFields),
    ...asArray(run.schedulerVerification?.scheduler?.unsupportedFields),
    ...asArray(run.schedulerVerification?.scheduler?.effectiveScheduler?.unsupportedFields),
  ]);
}

function fieldIsVitBlock(field) {
  return field === 'phaseChunkSize.vitBlock'
    || field === 'vitBlockChunkSize'
    || field === 'vitBlock'
    || field === 'phaseChunkSize';
}

function unsupportedCoversVitBlock(unsupportedFields = []) {
  return unsupportedFields.some(field => fieldIsVitBlock(field));
}

function schedulerRequestsVitBlock(schedulerVerification = {}) {
  const requested = asObject(schedulerVerification.scheduler?.requestedScheduler);
  const effective = asObject(schedulerVerification.scheduler?.effectiveScheduler);
  return finite(requested.vitBlockChunkSize)
    || finite(effective.vitBlockChunkSize)
    || finite(requested.phaseChunkSize?.vitBlock)
    || finite(effective.phaseChunkSize?.vitBlock);
}

function vitBlockIsAsserted(run = {}) {
  return asArray(run.schedulerVerification?.boundaryAssertions).some(assertion => (
    fieldIsVitBlock(assertion?.field)
      && (assertion?.status === 'verified' || assertion?.status === 'observed')
  ));
}

function hasVitBlockOverclaim(run = {}) {
  const unsupportedFields = unsupportedFieldsForRun(run);
  if (unsupportedCoversVitBlock(unsupportedFields)) return false;
  return vitBlockIsAsserted(run) || schedulerRequestsVitBlock(verification(run));
}

function expectedBoundaryForAssertion(assertion = {}) {
  if (assertion.observedBoundary) return assertion.observedBoundary;
  if (assertion.field === 'phaseChunkSize.spnPatch' || assertion.field === 'spnPatchChunkSize') {
    return 'spn-patch-chunk';
  }
  if (assertion.field === 'phaseYieldMs.gaussianPhase' || assertion.field === 'gaussianPhaseYieldMs') {
    return 'gaussian-phase';
  }
  return null;
}

function eventMatchesBoundary(event = {}, boundary) {
  if (!boundary) return false;
  return event.boundary === boundary
    || event.phase === boundary
    || event.stage === boundary
    || event.name === boundary;
}

function assertionHasVerifiedEventEvidence(events = []) {
  return assertion => {
    if (assertion?.status !== 'verified') return false;
    if (!finite(assertion.observedCount) || Number(assertion.observedCount) <= 0) return false;
    if (!finite(assertion.observedQueueWaitCount) || Number(assertion.observedQueueWaitCount) <= 0) return false;
    if (!finite(assertion.observedYieldCount) || Number(assertion.observedYieldCount) <= 0) return false;
    return events.some(event => eventMatchesBoundary(event, expectedBoundaryForAssertion(assertion)));
  };
}

function artifact(run = {}) {
  return asObject(run.artifact);
}

function artifactsMismatch(baseline, cooperative) {
  const baselineArtifact = artifact(baseline);
  const cooperativeArtifact = artifact(cooperative);
  if (baselineArtifact.sha256 && cooperativeArtifact.sha256) {
    return baselineArtifact.sha256 !== cooperativeArtifact.sha256;
  }
  if (baselineArtifact.bytes != null && cooperativeArtifact.bytes != null) {
    return baselineArtifact.bytes !== cooperativeArtifact.bytes;
  }
  return false;
}

function outputMismatch(comparison, baseline, cooperative) {
  if (comparison.outputEquivalence?.status && comparison.outputEquivalence.status !== 'same-output') return true;
  return artifactsMismatch(baseline, cooperative);
}

function routeIdentityMissing(comparison = {}) {
  const route = asObject(comparison.routeIdentity);
  return !(route.requestedPipelineId || route.requestedRouteId || route.effectiveRouteId);
}

function isFallbackOrFixture(run = {}) {
  return ['fixture', 'fallback', 'cached', 'prerecorded'].includes(run.stageStatus)
    || ['fixture', 'fallback', 'cached', 'prerecorded'].includes(run.artifact?.status)
    || ['fixture', 'fallback', 'cached', 'prerecorded'].includes(run.visualSourceTruth?.source)
    || run.visualSourceTruth?.fallbackReason != null;
}

function visibleUiContradicts(comparison = {}, cooperative = {}) {
  const visible = asObject(comparison.visibleUi || comparison.visibleSurface);
  if (!Object.keys(visible).length) return false;
  const cooperativeVerification = verification(cooperative);
  if (visible.schedulerVerificationStatus && cooperativeVerification.status
    && visible.schedulerVerificationStatus !== cooperativeVerification.status) {
    return true;
  }
  if (visible.evidenceClass && comparison.evidenceClass && visible.evidenceClass !== comparison.evidenceClass) return true;
  if (visible.routeSource && ['fixture', 'fallback', 'demo', 'cached', 'prerecorded'].includes(visible.routeSource)) return true;
  if (visible.evidenceClass && ['fixture', 'fallback-demo', 'demo', 'cached'].includes(visible.evidenceClass)) return true;
  return visible.stale === true || visible.fallback === true;
}

function hasOptimizationClaim(comparison = {}) {
  if (comparison.optimizationClaim) return true;
  const value = String(comparison.claim || comparison.claimedOutcome || comparison.summaryClaim || '').toLowerCase();
  return /\b(optimization|optimized|speedup|faster|slower|regression|throughput win|throughput loss)\b/.test(value);
}

function comparisonClaimsSmoke(comparison = {}) {
  return comparison.status === 'valid-smoke'
    || comparison.evidenceClass === 'single-pair-smoke'
    || comparison.evidenceClass === 'flame-contention-smoke';
}

function comparisonClaimsRouteBridge(comparison = {}) {
  return comparison.status === 'route-bridge' || comparison.evidenceClass === 'route-bridge';
}

function deriveStatus(comparison, errors) {
  if (errors.length) return 'invalid';
  if (comparisonClaimsSmoke(comparison)) return 'valid-smoke';
  if (comparisonClaimsRouteBridge(comparison)) return 'route-bridge';
  const baseline = runByProfile(comparison, 'baseline-default');
  const cooperative = runByProfile(comparison, 'cooperative-spn-gaussian');
  return baseline && cooperative && hasFrameQueueEvidence(baseline) && hasFrameQueueEvidence(cooperative)
    ? 'valid-smoke'
    : 'route-bridge';
}

export function validateSharpBreathingRoomComparisonEvidence(comparison = {}) {
  const baseline = runByProfile(comparison, 'baseline-default');
  const cooperative = runByProfile(comparison, 'cooperative-spn-gaussian');
  const errors = [];
  const warnings = [];
  const downgrades = [...asArray(comparison.downgrades)];
  const falseClosureChecks = {
    singlePairOptimizationClaimRejected: true,
    sameInputOutputMismatch: false,
    verifiedWithoutObservedBoundary: false,
    proxyOnlySchedulerProof: false,
    missingFrameQueueEvidence: false,
    visibleUiContradiction: false,
    fallbackOrFixtureRoute: false,
    unsupportedVitBlockOverclaimed: false,
    routeIdentityMissing: false,
  };

  if (comparison.schema !== SHARP_BREATHING_ROOM_COMPARISON_SCHEMA) {
    addUnique(errors, 'schema-mismatch');
  }
  if (!baseline || !cooperative) addUnique(errors, 'baseline-cooperative-pair-missing');
  if (routeIdentityMissing(comparison)) {
    falseClosureChecks.routeIdentityMissing = true;
    addUnique(errors, 'route-identity-missing');
  }

  if (baseline && cooperative && outputMismatch(comparison, baseline, cooperative)) {
    falseClosureChecks.sameInputOutputMismatch = true;
    addUnique(errors, 'same-input-output-mismatch');
  }

  const cooperativeVerification = verification(cooperative);
  const cooperativeHasSchedulerProof = hasObservedSchedulerBoundaryProof(cooperativeVerification);
  if (comparisonClaimsSmoke(comparison) && cooperative && !cooperativeHasSchedulerProof) {
    addUnique(errors, 'cooperative-scheduler-receipt-invalid');
  }
  if (verifiedWithoutBoundaryProof(cooperativeVerification)) {
    falseClosureChecks.verifiedWithoutObservedBoundary = true;
    addUnique(errors, 'cooperative-verified-without-boundary-proof');
  }
  if (schedulerProofIsProxyOnly(cooperativeVerification)) {
    falseClosureChecks.proxyOnlySchedulerProof = true;
    addUnique(errors, 'cooperative-scheduler-proof-proxy-only');
  }
  if (cooperative && hasVitBlockOverclaim(cooperative)) {
    falseClosureChecks.unsupportedVitBlockOverclaimed = true;
    addUnique(errors, 'vit-block-chunking-overclaimed');
  }

  if (comparisonClaimsSmoke(comparison)) {
    if (baseline && !hasFrameQueueEvidence(baseline)) {
      falseClosureChecks.missingFrameQueueEvidence = true;
      addUnique(errors, 'baseline-frame-queue-evidence-missing');
    }
    if (cooperative && !hasFrameQueueEvidence(cooperative)) {
      falseClosureChecks.missingFrameQueueEvidence = true;
      addUnique(errors, 'cooperative-frame-queue-evidence-missing');
    }
    if (comparison.claimBoundary !== SHARP_BREATHING_ROOM_SINGLE_PAIR_CLAIM_BOUNDARY) {
      addUnique(errors, 'claim-boundary-missing-or-overstated');
    }
  } else if (comparisonClaimsRouteBridge(comparison)) {
    addUnique(warnings, 'flame-contention-evidence-not-provided');
  }

  for (const run of [baseline, cooperative].filter(Boolean)) {
    if (isFallbackOrFixture(run)) {
      falseClosureChecks.fallbackOrFixtureRoute = true;
      addUnique(errors, `${run.profileId || 'run'}-fixture-route`);
    }
  }

  if (visibleUiContradicts(comparison, cooperative || {})) {
    falseClosureChecks.visibleUiContradiction = true;
    addUnique(errors, 'visible-ui-contradiction');
  }

  if (hasOptimizationClaim(comparison)) {
    falseClosureChecks.singlePairOptimizationClaimRejected = true;
    addUnique(errors, 'single-pair-optimization-claim');
  }

  for (const downgrade of errors) addUnique(downgrades, downgrade);
  if (!downgrades.includes('single-pair-smoke-not-optimization-proof')) {
    addUnique(downgrades, 'single-pair-smoke-not-optimization-proof');
  }

  const status = deriveStatus(comparison, errors);
  return {
    schema: SHARP_BREATHING_ROOM_VALIDATION_SCHEMA,
    ok: errors.length === 0,
    status,
    evidenceClass: status === 'valid-smoke'
      ? 'single-pair-smoke'
      : (status === 'route-bridge' ? 'route-bridge' : 'invalid'),
    canClaim: {
      routeBridge: errors.length === 0 && status === 'route-bridge',
      breathingRoomSmoke: errors.length === 0 && status === 'valid-smoke',
      schedulerProof: errors.length === 0 && cooperativeHasSchedulerProof,
      optimization: false,
    },
    claimBoundary: SHARP_BREATHING_ROOM_SINGLE_PAIR_CLAIM_BOUNDARY,
    errors,
    warnings,
    downgrades: uniq(downgrades),
    falseClosureChecks,
  };
}

export function classifySharpBreathingRoomComparisonEvidence(comparison = {}) {
  const validation = validateSharpBreathingRoomComparisonEvidence(comparison);
  return {
    status: validation.status,
    evidenceClass: validation.evidenceClass,
    ok: validation.ok,
    canClaim: validation.canClaim,
    downgrades: validation.downgrades,
    errors: validation.errors,
  };
}
