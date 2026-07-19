export const EXTINCTION_COMMON_LEDGER_SCHEMA = 'kaminos.boundary-splat.extinction-correct-common-ledger.v0';

const REQUIRED_STAGE_NAMES = [
  'selection',
  'compaction',
  'deposition',
  'splatRaster',
  'residualMarch',
  'reconstruction',
  'composition',
];

const ARM_POLICIES = {
  'full-correct': {
    role: 'reference',
    disposition: 'all-source-coefficients-in-splats-v0',
    residualEnabled: false,
  },
  'sparse-drop': {
    role: 'comparison',
    disposition: 'omitted-coefficients-dropped-ablation-v0',
    residualEnabled: false,
  },
  'sparse-conservative': {
    role: 'comparison',
    disposition: 'omitted-coefficients-redistributed-to-splats-v0',
    residualEnabled: false,
  },
  'sparse-positive-complement': {
    role: 'comparison',
    disposition: 'complementary-coefficients-in-positive-residual-v0',
    residualEnabled: true,
  },
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(value ?? '');
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function samePositiveIntegerMap(left, right, keys) {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
  if (!right || typeof right !== 'object' || Array.isArray(right)) return false;
  const expectedKeys = [...keys].sort();
  if (!sameStringSet(Object.keys(left), expectedKeys) || !sameStringSet(Object.keys(right), expectedKeys)) return false;
  return expectedKeys.every(key => isPositiveInteger(left[key]) && left[key] === right[key]);
}

function approximatelyEqual(left, right, tolerance = 1e-6) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function validateCoefficientChannel(channel, channelName, errors) {
  const values = ['source', 'splat', 'residual', 'dropped'].map(key => channel?.[key]);
  if (!values.every(isFiniteNonNegative)) {
    errors.push(`${channelName}-ledger-invalid`);
    return false;
  }
  if (!approximatelyEqual(channel.splat + channel.residual + channel.dropped, channel.source)) {
    errors.push(`${channelName}-ledger-not-conservative`);
    return false;
  }
  return true;
}

function failureRequestedConfigMatches(requested, expected) {
  return sameStringSet(requested?.stateIds, expected.stateIds)
    && sameStringSet(requested?.armIds, expected.armIds)
    && requested?.fullCandidateCount == null
    && samePositiveIntegerMap(requested?.fullCandidateCountByState, expected.fullCandidateCountByState, expected.stateIds)
    && requested?.sparseCandidateCount === expected.sparseCandidateCount
    && requested?.residualGridScale === expected.residualGridScale
    && requested?.residualRaySteps === expected.residualRaySteps
    && requested?.width === expected.width
    && requested?.height === expected.height;
}

export function validateExtinctionCommonLedgerReport(report, expected) {
  const errors = [];
  const reject = (condition, code) => {
    if (condition) errors.push(code);
  };

  reject(report == null || typeof report !== 'object' || Array.isArray(report), 'report-not-object');
  if (errors.length > 0) return { ok: false, status: null, errors, accounting: null };

  reject(report.schema !== EXTINCTION_COMMON_LEDGER_SCHEMA, 'schema-mismatch');
  reject(!['captured', 'failed'].includes(report.status), 'status-invalid');
  reject(!isNonEmptyString(report.durableReportPath), 'durable-report-path-missing');

  if (report.status === 'failed') {
    reject(!isNonEmptyString(report.failurePhase), 'failure-phase-missing');
    reject(!isNonEmptyString(report.lastTrustworthyEvidence), 'last-trustworthy-evidence-missing');
    const failureRoute = report.route ?? {};
    const failureSource = report.source ?? {};
    const failureContext = report.failureContext ?? {};
    reject(failureRoute.requestedRoute !== expected.effectiveRoute, 'failure-requested-route-mismatch');
    reject(failureSource.cohortSchema !== expected.cohortSchema, 'failure-cohort-schema-mismatch');
    reject(failureSource.cohortManifestSha256 !== expected.cohortManifestSha256, 'failure-cohort-manifest-mismatch');
    reject(failureSource.cohortAuthority !== expected.cohortAuthority, 'failure-cohort-authority-mismatch');
    reject(failureSource.coefficientAuthority !== expected.coefficientAuthority, 'failure-coefficient-authority-mismatch');
    reject(
      failureSource.implementationBundleSha256 !== expected.implementationBundleSha256,
      'failure-implementation-bundle-mismatch',
    );
    reject(failureSource.ownershipAuthority !== expected.ownershipAuthority, 'failure-ownership-authority-mismatch');
    reject(!failureRequestedConfigMatches(report.request, expected), 'failure-requested-config-mismatch');

    const routeStatuses = ['verified', 'unresolved-before-effective-route'];
    const sourceStatuses = ['authenticated', 'unresolved-before-source-binding'];
    const configStatuses = ['verified', 'unresolved-before-effective-config'];
    reject(!routeStatuses.includes(failureContext.effectiveRouteStatus), 'failure-effective-route-status-invalid');
    reject(!sourceStatuses.includes(failureContext.sourceBindingStatus), 'failure-source-binding-status-invalid');
    reject(!configStatuses.includes(failureContext.effectiveConfigStatus), 'failure-effective-config-status-invalid');

    if (failureContext.effectiveRouteStatus === 'verified') {
      reject(
        ![
          failureRoute.effectiveRoute,
          failureRoute.backend,
          failureRoute.rendererIdentity,
          failureRoute.modelIdentity,
          failureRoute.recurrenceIdentity,
          failureRoute.depthAuthority,
        ].every(isNonEmptyString),
        'failure-effective-route-identity-missing',
      );
    }
    if (failureContext.effectiveConfigStatus === 'verified') {
      const effective = report.effective ?? {};
      reject(
        !Array.isArray(effective.stateIds)
          || !Array.isArray(effective.armIds)
          || effective.fullCandidateCount != null
          || !samePositiveIntegerMap(effective.fullCandidateCountByState, expected.fullCandidateCountByState, expected.stateIds)
          || !Number.isInteger(effective.sparseCandidateCount)
          || !Number.isFinite(effective.residualGridScale)
          || !Number.isInteger(effective.residualRaySteps)
          || !isPositiveInteger(effective.width)
          || !isPositiveInteger(effective.height),
        'failure-effective-config-missing',
      );
    }
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
  reject(route.recurrenceIdentity !== expected.recurrenceIdentity, 'wrong-recurrence-identity');
  reject(route.depthAuthority !== expected.depthAuthority, 'wrong-depth-authority');
  reject(route.fallbackReason != null, 'fallback-present');

  const source = report.source ?? {};
  reject(source.cohortSchema !== expected.cohortSchema, 'cohort-schema-mismatch');
  reject(source.cohortManifestSha256 !== expected.cohortManifestSha256, 'cohort-manifest-mismatch');
  reject(source.cohortAuthority !== expected.cohortAuthority, 'cohort-authority-mismatch');
  reject(source.coefficientAuthority !== expected.coefficientAuthority, 'coefficient-authority-mismatch');
  reject(source.implementationBundleSha256 !== expected.implementationBundleSha256, 'implementation-bundle-mismatch');
  reject(source.ownershipAuthority !== expected.ownershipAuthority, 'ownership-authority-mismatch');
  reject(source.selectionRerun !== false, 'selection-rerun');
  reject(source.residualAwareRetargeting !== false, 'residual-aware-retargeting');
  reject(source.supportRedefined !== false, 'support-redefined');
  reject(source.coefficientsRedefined !== false, 'coefficients-redefined');
  reject(source.covarianceRedefined !== false, 'covariance-redefined');
  reject(source.radianceRetuned !== false, 'radiance-retuned');
  reject(source.cameraRedefined !== false, 'camera-redefined');

  const requested = report.request ?? {};
  const effective = report.effective ?? {};
  reject(!sameStringSet(requested.stateIds, expected.stateIds), 'requested-state-set-mismatch');
  reject(!sameStringSet(requested.armIds, expected.armIds), 'requested-arm-set-mismatch');
  reject(requested.fullCandidateCount != null, 'requested-scalar-full-count-alias');
  reject(
    !samePositiveIntegerMap(requested.fullCandidateCountByState, expected.fullCandidateCountByState, expected.stateIds),
    'requested-full-count-map-mismatch',
  );
  reject(requested.sparseCandidateCount !== expected.sparseCandidateCount, 'requested-sparse-count-mismatch');
  reject(requested.residualGridScale !== expected.residualGridScale, 'requested-grid-scale-mismatch');
  reject(requested.residualRaySteps !== expected.residualRaySteps, 'requested-ray-steps-mismatch');
  reject(requested.width !== expected.width || requested.height !== expected.height, 'requested-resolution-mismatch');
  reject(!sameStringSet(effective.stateIds, requested.stateIds), 'effective-state-set-mismatch');
  reject(!sameStringSet(effective.armIds, requested.armIds), 'effective-arm-set-mismatch');
  reject(effective.fullCandidateCount != null, 'effective-scalar-full-count-alias');
  reject(
    !samePositiveIntegerMap(effective.fullCandidateCountByState, requested.fullCandidateCountByState, expected.stateIds),
    'requested-effective-full-count-map-mismatch',
  );
  reject(effective.sparseCandidateCount !== requested.sparseCandidateCount, 'requested-effective-sparse-count-mismatch');
  reject(effective.residualGridScale !== requested.residualGridScale, 'requested-effective-grid-scale-mismatch');
  reject(effective.residualRaySteps !== requested.residualRaySteps, 'requested-effective-ray-steps-mismatch');
  reject(effective.width !== requested.width || effective.height !== requested.height, 'requested-effective-resolution-mismatch');

  const states = Array.isArray(report.states) ? report.states : [];
  reject(!sameStringSet(states.map(state => state?.stateId), expected.stateIds), 'state-set-mismatch');
  const cameraHashes = states.map(state => state?.cameraSha256);
  reject(cameraHashes.some(hash => !isSha256(hash)), 'camera-hash-invalid');
  reject(cameraHashes.some(hash => hash !== expected.cameraSha256), 'camera-hash-mismatch');

  let armCount = 0;
  const totalMsByArm = Object.fromEntries(expected.armIds.map(armId => [armId, 0]));
  const captureNonces = new Set();
  const captureHashesByArm = Object.fromEntries(expected.armIds.map(armId => [armId, new Set()]));

  for (const state of states) {
    const arms = Array.isArray(state?.arms) ? state.arms : [];
    reject(!sameStringSet(arms.map(arm => arm?.armId), expected.armIds), 'state-arm-set-mismatch');
    const sparseMembershipHashes = new Set();
    const armsById = new Map();

    for (const arm of arms) {
      armCount += 1;
      armsById.set(arm?.armId, arm);
      const policy = ARM_POLICIES[arm?.armId];
      if (!policy) continue;
      const isFull = arm.armId === 'full-correct';
      const expectedCount = isFull
        ? expected.fullCandidateCountByState?.[state.stateId]
        : expected.sparseCandidateCount;

      reject(arm.stateId !== state.stateId, 'arm-state-mismatch');
      reject(arm.role !== policy.role, 'arm-role-mismatch');
      reject(arm.requestedCandidateCount !== expectedCount, 'arm-requested-count-mismatch');
      reject(arm.effectiveCandidateCount !== arm.requestedCandidateCount, 'arm-requested-effective-count-mismatch');
      reject(!isSha256(arm.membershipSha256), 'arm-membership-hash-invalid');
      if (isFull) {
        reject(
          arm.membershipSha256 !== expected.fullMembershipSha256ByState?.[state.stateId],
          'full-membership-state-binding-mismatch',
        );
      } else {
        reject(
          arm.membershipSha256 !== expected.sparseMembershipSha256ByState?.[state.stateId],
          'sparse-membership-state-binding-mismatch',
        );
        if (isSha256(arm.membershipSha256)) sparseMembershipHashes.add(arm.membershipSha256);
      }
      reject(arm.recurrenceIdentity !== expected.recurrenceIdentity, 'arm-recurrence-mismatch');
      reject(arm.depthAuthority !== expected.depthAuthority, 'arm-depth-authority-mismatch');
      reject(arm.coefficientAuthority !== expected.coefficientAuthority, 'arm-coefficient-authority-mismatch');
      reject(arm.coefficientDisposition !== policy.disposition, 'arm-coefficient-disposition-mismatch');

      const emissionOk = validateCoefficientChannel(arm.coefficientLedger?.emission, 'emission', errors);
      const extinctionOk = validateCoefficientChannel(arm.coefficientLedger?.extinction, 'extinction', errors);
      if (arm.armId === 'sparse-positive-complement') {
        reject(arm.coefficientLedger?.emission?.dropped !== 0, 'positive-complement-drops-coefficients');
        reject(arm.coefficientLedger?.extinction?.dropped !== 0, 'positive-complement-drops-coefficients');
      }
      if (emissionOk && extinctionOk) {
        const emission = arm.coefficientLedger.emission;
        const extinction = arm.coefficientLedger.extinction;
        if (arm.armId === 'full-correct' || arm.armId === 'sparse-conservative') {
          reject(emission.residual !== 0 || emission.dropped !== 0 || emission.splat !== emission.source, 'all-splat-emission-policy-mismatch');
          reject(extinction.residual !== 0 || extinction.dropped !== 0 || extinction.splat !== extinction.source, 'all-splat-extinction-policy-mismatch');
        } else if (arm.armId === 'sparse-drop') {
          reject(emission.residual !== 0 || !(emission.dropped > 0), 'drop-emission-policy-mismatch');
          reject(extinction.residual !== 0 || !(extinction.dropped > 0), 'drop-extinction-policy-mismatch');
        } else {
          reject(!(emission.residual > 0), 'positive-complement-emission-missing');
          reject(!(extinction.residual > 0), 'positive-complement-extinction-missing');
        }
      }

      const residual = arm.residual ?? {};
      reject(residual.enabled !== policy.residualEnabled, 'arm-residual-enabled-mismatch');
      reject(residual.requestedGridScale !== requested.residualGridScale, 'arm-requested-grid-scale-mismatch');
      reject(residual.effectiveGridScale !== residual.requestedGridScale, 'arm-grid-scale-mismatch');
      reject(residual.requestedRaySteps !== requested.residualRaySteps, 'arm-requested-ray-steps-mismatch');
      reject(residual.effectiveRaySteps !== residual.requestedRaySteps, 'arm-ray-steps-mismatch');
      reject(residual.imageResidualUsed !== false, 'image-residual-used');
      reject(residual.independentlyToneMapped !== false, 'independent-tone-map-used');
      reject(residual.postToneMapAddition !== false, 'post-tonemap-addition-used');

      const accounting = arm.accounting ?? {};
      reject(accounting.hiddenCapInstalled !== false, 'hidden-cap-installed');
      reject(accounting.hiddenTimeoutInstalled !== false, 'hidden-timeout-installed');
      reject(accounting.candidateCopyBytes !== 0, 'candidate-copy-present');
      reject(accounting.finalOverflowCount !== 0, 'final-overflow-present');
      reject(accounting.fallbackReason != null, 'arm-fallback-present');

      const timing = arm.timing ?? {};
      reject(timing.timestampStatus !== 'available', 'timestamp-status-unavailable');
      reject(timing.timeUnit !== 'ms', 'timestamp-unit-not-ms');
      const stages = timing.stages ?? {};
      const completeStages = REQUIRED_STAGE_NAMES.every(name => (
        stages[name]?.status === 'sampled' && isFiniteNonNegative(stages[name]?.ms)
      ));
      const chargedComplete = stages.chargedTotal?.status === 'sampled'
        && isFiniteNonNegative(stages.chargedTotal?.ms);
      reject(!completeStages || !chargedComplete, 'partial-stage-timestamps');
      if (completeStages && chargedComplete) {
        const computedTotal = REQUIRED_STAGE_NAMES.reduce((sum, name) => sum + stages[name].ms, 0);
        reject(!approximatelyEqual(computedTotal, stages.chargedTotal.ms), 'charged-total-mismatch');
        totalMsByArm[arm.armId] += stages.chargedTotal.ms;
      }

      const metrics = arm.metrics ?? {};
      reject(metrics.authority !== 'linear-hdr-pre-tonemap-matched-reference-v0', 'metric-authority-mismatch');
      reject(
        !['radianceMae', 'opticalDepthMae', 'transmittanceMae', 'temporalDeltaMae']
          .every(name => isFiniteNonNegative(metrics[name])),
        'transport-metrics-invalid',
      );
      reject(!Number.isFinite(metrics.silhouetteIou) || metrics.silhouetteIou < 0 || metrics.silhouetteIou > 1, 'silhouette-metric-invalid');

      const capture = arm.capture ?? {};
      reject(capture.authority !== 'gpu-linear-hdr-readback-live-held-state-v0', 'capture-authority-mismatch');
      reject(capture.freshnessStatus !== 'live-controlled-capture', 'capture-not-live');
      reject(!isNonEmptyString(capture.captureNonce), 'capture-nonce-missing');
      reject(captureNonces.has(capture.captureNonce), 'capture-nonce-reused');
      if (isNonEmptyString(capture.captureNonce)) captureNonces.add(capture.captureNonce);
      reject(capture.width !== requested.width || capture.height !== requested.height, 'capture-resolution-mismatch');
      reject(capture.finitePixelCount !== requested.width * requested.height, 'capture-finite-pixel-count-mismatch');
      reject(!isPositiveInteger(capture.litPixels), 'blank-capture');
      reject(capture.rgbaFloatCount !== requested.width * requested.height * 4, 'capture-payload-partial');
      reject(!isSha256(capture.linearHdrSha256), 'capture-sha256-invalid');
      reject(captureHashesByArm[arm.armId]?.has(capture.linearHdrSha256), 'capture-sha256-reused-across-states');
      if (isSha256(capture.linearHdrSha256)) captureHashesByArm[arm.armId]?.add(capture.linearHdrSha256);
    }

    reject(sparseMembershipHashes.size !== 1, 'sparse-membership-mismatch-within-state');
    const fullLedger = armsById.get('full-correct')?.coefficientLedger;
    const dropLedger = armsById.get('sparse-drop')?.coefficientLedger;
    const complementLedger = armsById.get('sparse-positive-complement')?.coefficientLedger;
    const dropCaptureHash = armsById.get('sparse-drop')?.capture?.linearHdrSha256;
    reject(
      [...armsById.entries()].some(([armId, arm]) => (
        armId !== 'sparse-drop' && arm?.capture?.linearHdrSha256 === dropCaptureHash
      )),
      'drop-capture-aliases-nondrop-arm',
    );
    reject(
      armsById.get('full-correct')?.membershipSha256 === armsById.get('sparse-drop')?.membershipSha256,
      'full-sparse-membership-alias',
    );
    for (const arm of arms) {
      reject(
        !approximatelyEqual(arm?.coefficientLedger?.emission?.source, fullLedger?.emission?.source),
        'cross-arm-source-emission-mismatch',
      );
      reject(
        !approximatelyEqual(arm?.coefficientLedger?.extinction?.source, fullLedger?.extinction?.source),
        'cross-arm-source-extinction-mismatch',
      );
    }
    reject(
      !approximatelyEqual(dropLedger?.emission?.splat, complementLedger?.emission?.splat)
        || !approximatelyEqual(dropLedger?.emission?.dropped, complementLedger?.emission?.residual),
      'drop-complement-emission-mismatch',
    );
    reject(
      !approximatelyEqual(dropLedger?.extinction?.splat, complementLedger?.extinction?.splat)
        || !approximatelyEqual(dropLedger?.extinction?.dropped, complementLedger?.extinction?.residual),
      'drop-complement-extinction-mismatch',
    );
  }

  return {
    ok: errors.length === 0,
    status: 'captured',
    errors,
    accounting: {
      stateCount: states.length,
      armCount,
      meanChargedMsByArm: Object.fromEntries(
        expected.armIds.map(armId => [armId, states.length > 0 ? totalMsByArm[armId] / states.length : null]),
      ),
    },
  };
}
