const SCHEMA = 'kaminos.volume.sparse-hybrid-presentation-report.v0';
const TREATMENT = 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0';
const SCOPE = 'presentation-only-no-self-transmittance-claim-v0';
const RESOLUTION_OWNERSHIP = 'full-resolution-splats-independent-coarse-linear-raymarch-v0';
const RESOLVE = 'coarse-linear-raymarch-plus-full-resolution-splat-raymarch-grade-v0';

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateSparseHybridPresentationReport(report) {
  const errors = [];
  if (!report || typeof report !== 'object') return { ok: false, errors: ['report-missing'] };
  if (report.schema !== SCHEMA) errors.push('schema-mismatch');
  if (report.status !== 'complete') errors.push('report-incomplete');
  if (report.treatmentIdentity !== TREATMENT) errors.push('treatment-mismatch');
  if (report.conclusionScope !== SCOPE) errors.push('conclusion-overclaim');
  if (report.requestedRoute !== TREATMENT || report.effectiveRoute !== TREATMENT) errors.push('route-substitution');
  if (report.fallbackReason != null) errors.push('fallback-present');

  for (const key of ['frozenStateSha256', 'candidatePayloadSha256', 'cameraOrbitSha256', 'controlsSha256']) {
    if (!isSha256(report[key])) errors.push(`${key}-missing-or-invalid`);
  }

  const target = report.target || {};
  if (target.splatFormat !== 'rgba16float' || target.raymarchFormat !== 'rgba16float') errors.push('hdr-target-substitution');
  if (target.intermediateClamped !== false) errors.push('intermediate-clamped-or-unknown');

  const resolution = report.resolution || {};
  if (resolution.ownershipIdentity !== RESOLUTION_OWNERSHIP) errors.push('shared-resolution-substitution');
  if (Number(resolution.splatScale) !== 1) errors.push('splat-scale-not-native');
  if (!Number.isFinite(Number(resolution.requestedRaymarchScale)) || Number(resolution.requestedRaymarchScale) < 0.05 || Number(resolution.requestedRaymarchScale) > 1) errors.push('raymarch-scale-out-of-contract');
  if (Number(resolution.effectiveRaymarchScale) !== Number(resolution.requestedRaymarchScale)) errors.push('raymarch-scale-substitution');
  if (resolution.raymarchScaleClamped !== false) errors.push('raymarch-scale-clamped-or-unknown');
  if (![resolution.splatWidth, resolution.splatHeight, resolution.raymarchWidth, resolution.raymarchHeight].every(value => Number.isInteger(value) && value > 0)) errors.push('resolution-dimensions-invalid');
  const expectedRaymarchWidth = Math.max(1, Math.floor(Number(resolution.splatWidth) * Number(resolution.effectiveRaymarchScale)));
  const expectedRaymarchHeight = Math.max(1, Math.floor(Number(resolution.splatHeight) * Number(resolution.effectiveRaymarchScale)));
  if (resolution.raymarchWidth !== expectedRaymarchWidth || resolution.raymarchHeight !== expectedRaymarchHeight) errors.push('raymarch-dimensions-scale-substitution');

  const presentation = report.presentation || {};
  if (presentation.resolveIdentity !== RESOLVE) errors.push('presentation-resolve-substitution');
  if (presentation.blendIdentity !== 'linear-radiance-sum-before-single-presentation-resolve-v0') errors.push('blend-substitution');
  if (presentation.selfTransmittanceParityEligible !== false) errors.push('self-transmittance-overclaim');
  const curve = presentation.curve || {};
  if (curve.exposure !== 0.96 || curve.vignetteBase !== 0.80 || curve.vignetteGain !== 0.18 || curve.power !== 0.84) errors.push('presentation-curve-substitution');

  const timing = report.timing || {};
  if (timing.status !== 'complete' || timing.authority !== 'gpu-timestamp-query-v0') errors.push('gpu-timing-incomplete');
  for (const key of ['coarseRaymarchMs', 'splatRasterMs', 'compositeResolveMs', 'totalGpuMs']) {
    if (!finiteNonNegative(timing[key])) errors.push(`${key}-missing-or-invalid`);
  }

  const orbit = report.orbit || {};
  if (orbit.identity !== '21-camera-frozen-orbit-v0') errors.push('orbit-identity-substitution');
  if (orbit.expectedCameraCount !== 21 || orbit.completedCameraCount !== 21) errors.push('orbit-partial');
  if (typeof orbit.dynamicWitnessPath !== 'string' || !orbit.dynamicWitnessPath) errors.push('dynamic-witness-missing');
  if (!Array.isArray(orbit.nativeFramePaths) || orbit.nativeFramePaths.length < 3 || orbit.nativeFramePaths.some(path => typeof path !== 'string' || !path)) errors.push('native-frames-missing');
  if (orbit.personallyInspected !== true) errors.push('visual-inspection-missing');

  return { ok: errors.length === 0, errors };
}
