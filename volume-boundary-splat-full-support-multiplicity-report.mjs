export const FULL_SUPPORT_MULTIPLICITY_SCHEMA = 'kaminos.boundary-splat.full-support-instance-multiplicity.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function sortedNumeric(values) {
  return [...values].sort((left, right) => left - right);
}

function sameNumericSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const sortedLeft = sortedNumeric(left);
  const sortedRight = sortedNumeric(right);
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function validateFullSupportMultiplicityReport(report, expected) {
  const errors = [];
  const reject = (condition, code) => {
    if (condition) errors.push(code);
  };

  reject(report == null || typeof report !== 'object' || Array.isArray(report), 'report-not-object');
  if (errors.length > 0) return { ok: false, status: null, errors, accounting: null };

  reject(report.schema !== FULL_SUPPORT_MULTIPLICITY_SCHEMA, 'schema-mismatch');
  reject(!['captured', 'failed'].includes(report.status), 'status-invalid');
  reject(!isNonEmptyString(report.durableReportPath), 'durable-report-path-missing');

  if (report.status === 'failed') {
    reject(!isNonEmptyString(report.failurePhase), 'failure-phase-missing');
    reject(!isNonEmptyString(report.lastTrustworthyEvidence), 'last-trustworthy-evidence-missing');
    return {
      ok: errors.length === 0,
      status: 'failed',
      errors,
      accounting: null,
    };
  }

  reject(report.failurePhase != null, 'captured-report-has-failure-phase');
  reject(!isNonEmptyString(report.lastTrustworthyEvidence), 'last-trustworthy-evidence-missing');

  const route = report.route ?? {};
  reject(route.requestedRoute !== expected.effectiveRoute, 'wrong-requested-route');
  reject(route.effectiveRoute !== expected.effectiveRoute, 'wrong-effective-route');
  reject(route.backend !== expected.backend, 'wrong-backend');
  reject(route.rendererIdentity !== expected.rendererIdentity, 'wrong-renderer-identity');
  reject(route.modelIdentity !== expected.modelIdentity, 'wrong-model-identity');
  reject(route.selectorIdentity !== expected.selectorIdentity, 'wrong-selector-identity');
  reject(route.descriptorIdentity !== expected.descriptorIdentity, 'wrong-descriptor-identity');
  reject(route.allocationIdentity !== expected.allocationIdentity, 'wrong-allocation-identity');
  reject(route.fallbackReason != null, 'fallback-present');

  const source = report.source ?? {};
  reject(source.simulatorCount !== 1, 'simulator-count-not-one');
  reject(source.compactionCount !== 1, 'compaction-count-not-one');
  reject(source.sourceUnionCount !== expected.sourceUnionCount, 'source-union-count-mismatch');
  reject(source.sourceRowsPreserved !== true, 'source-rows-not-preserved');
  reject(source.hiddenCapInstalled !== false, 'hidden-cap-installed');
  reject(!isNonEmptyString(source.sameStateCaptureId), 'same-state-capture-id-missing');
  reject(!isNonEmptyString(source.stableNativeCellIdAuthority), 'stable-native-cell-id-authority-missing');

  const requested = report.request ?? {};
  const effective = report.effective ?? {};
  reject(requested.requestedInstanceCount !== expected.requestedInstanceCount, 'requested-instance-count-mismatch');
  reject(effective.instanceCount !== requested.requestedInstanceCount, 'requested-effective-instance-count-mismatch');
  reject(!sameNumericSet(requested.requestedTargetPixels, expected.allowedTargetPixels), 'requested-target-set-mismatch');
  reject(!sameNumericSet(effective.targetPixels, expected.allowedTargetPixels), 'effective-target-set-mismatch');

  const tiers = Array.isArray(report.tiers) ? report.tiers : [];
  reject(tiers.length === 0, 'tiers-missing');
  reject(!sameNumericSet(tiers.map(tier => tier.requestedTargetPixels), expected.allowedTargetPixels), 'tier-target-set-mismatch');

  let descriptorTotal = 0;
  let rasterInstanceTotal = 0;
  let maximumSelectedCandidateCount = 0;
  for (const tier of tiers) {
    const requestedTarget = tier?.requestedTargetPixels;
    const effectiveTarget = tier?.effectiveTargetPixels;
    const descriptorCount = tier?.descriptorCount;
    const selectedCandidateCount = tier?.selectedCandidateCount;
    const renderedInstanceCount = tier?.renderedInstanceCount;
    reject(requestedTarget !== effectiveTarget, 'requested-effective-target-mismatch');
    reject(!expected.allowedTargetPixels.includes(requestedTarget), 'tier-target-not-allowed');
    reject(!isPositiveInteger(descriptorCount), 'tier-descriptor-count-invalid');
    reject(
      !isPositiveInteger(selectedCandidateCount) || selectedCandidateCount > expected.sourceUnionCount,
      'selected-candidate-count-out-of-range',
    );
    reject(
      selectedCandidateCount !== expected.selectedCandidateCountByTarget?.[requestedTarget],
      'selected-candidate-count-mismatch',
    );
    reject(
      !Number.isInteger(renderedInstanceCount)
        || renderedInstanceCount !== descriptorCount * selectedCandidateCount,
      'tier-rendered-instance-count-mismatch',
    );
    if (isPositiveInteger(descriptorCount)) descriptorTotal += descriptorCount;
    if (Number.isInteger(renderedInstanceCount)) rasterInstanceTotal += renderedInstanceCount;
    if (isPositiveInteger(selectedCandidateCount)) {
      maximumSelectedCandidateCount = Math.max(maximumSelectedCandidateCount, selectedCandidateCount);
    }
  }

  reject(descriptorTotal !== effective.instanceCount, 'tier-descriptor-count-mismatch');
  reject(effective.uniqueSelectedCandidateCount !== maximumSelectedCandidateCount, 'unique-selected-candidate-count-mismatch');

  const residency = report.selectionResidency ?? {};
  const residencyCohorts = Array.isArray(residency.cohorts) ? residency.cohorts : [];
  reject(residency.authority !== 'gpu-compacted-stable-native-cell-id-prefix-audit-v0', 'selection-residency-authority-mismatch');
  reject(residency.stableOrderIdentity !== 'boundary-splat-deterministic-native-cell-hash-order-v0', 'selection-residency-order-identity-mismatch');
  reject(residency.populationStateId !== source.sameStateCaptureId, 'selection-residency-state-mismatch');
  reject(residency.nestedPrefixValidated !== true, 'nested-prefix-not-validated');
  reject(
    !sameNumericSet(residencyCohorts.map(cohort => cohort.targetPixels), expected.allowedTargetPixels),
    'selection-residency-target-set-mismatch',
  );
  for (const cohort of residencyCohorts) {
    reject(
      cohort.selectedCandidateCount !== expected.selectedCandidateCountByTarget?.[cohort.targetPixels],
      'selection-residency-count-mismatch',
    );
    reject(!/^[0-9a-f]{64}$/.test(cohort.nativeCellIdSha256 ?? ''), 'selection-residency-hash-invalid');
  }

  const accounting = report.accounting ?? {};
  reject(accounting.totalRasterInstanceCount !== rasterInstanceTotal, 'total-raster-instance-count-mismatch');
  reject(!isFiniteNonNegative(accounting.projectedFragmentCount), 'projected-fragment-count-invalid');
  reject(accounting.finalOverflowCount !== 0, 'final-overflow-present');
  reject(!Number.isInteger(accounting.initialOverflowCount) || accounting.initialOverflowCount < 0, 'initial-overflow-count-invalid');
  reject(!Number.isInteger(accounting.capacityRetryCount) || accounting.capacityRetryCount < 0, 'capacity-retry-count-invalid');
  reject(accounting.initialOverflowCount > 0 && accounting.capacityRetryCount === 0, 'initial-overflow-retry-hidden');
  reject(accounting.candidateCopyBytes !== 0, 'candidate-copy-present');

  const timing = report.timing ?? {};
  reject(timing.timestampStatus !== 'available', 'timestamp-status-unavailable');
  reject(timing.timeUnit !== 'ms', 'timestamp-unit-not-ms');
  const stages = timing.stages ?? {};
  const requiredStageNames = ['compaction', 'tierSetup', 'splatRaster', 'chargedTotal'];
  const stageTimes = Object.fromEntries(requiredStageNames.map(name => [name, stages[name]?.ms]));
  const stagesComplete = requiredStageNames.every(name => (
    stages[name]?.status === 'sampled' && isFiniteNonNegative(stageTimes[name])
  ));
  reject(!stagesComplete, 'partial-stage-timestamps');
  const computedChargedTotal = stageTimes.compaction + stageTimes.tierSetup + stageTimes.splatRaster;
  reject(
    stagesComplete
      && Math.abs(computedChargedTotal - stageTimes.chargedTotal) > 1e-6,
    'charged-total-mismatch',
  );

  const capture = report.capture ?? {};
  reject(capture.authority !== 'gpu-rgba8-readback-frozen-sim-state-v0', 'capture-authority-mismatch');
  reject(capture.freshnessStatus !== 'live-controlled-capture', 'capture-not-live');
  reject(!isNonEmptyString(capture.captureNonce), 'capture-nonce-missing');
  reject(!isPositiveInteger(capture.width) || !isPositiveInteger(capture.height), 'capture-dimensions-invalid');
  reject(!isPositiveInteger(capture.litPixels), 'blank-capture');
  reject(!isPositiveInteger(capture.rgbaByteLength), 'capture-payload-missing');
  reject(
    isPositiveInteger(capture.width)
      && isPositiveInteger(capture.height)
      && capture.rgbaByteLength !== capture.width * capture.height * 4,
    'capture-payload-partial',
  );
  reject(!/^[0-9a-f]{64}$/.test(capture.pngSha256 ?? ''), 'capture-sha256-invalid');

  return {
    ok: errors.length === 0,
    status: 'captured',
    errors,
    accounting: {
      sourceUnionCount: source.sourceUnionCount,
      uniqueSelectedCandidateCount: maximumSelectedCandidateCount,
      totalRasterInstanceCount: rasterInstanceTotal,
      projectedFragmentCount: accounting.projectedFragmentCount,
      compactionMs: stageTimes.compaction,
      tierSetupMs: stageTimes.tierSetup,
      splatRasterMs: stageTimes.splatRaster,
      chargedTotalMs: stageTimes.chargedTotal,
    },
  };
}
