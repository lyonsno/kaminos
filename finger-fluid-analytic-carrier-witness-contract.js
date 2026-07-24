const REPORT_SCHEMA = 'kaminos.finger-fluid.analytic-carrier-visual-witness.v1';
const HYBRID_MODE = 'hybrid_analytic_carrier';
const PARTICLE_MODE = 'particle_only';
const HYBRID_ROUTE = 'kaminos.finger-fluid.source-derived-swept-volume-quadrature.v0';
export const KAMINOS_ANALYTIC_CARRIER_EXPECTED_SOURCE_MECHANICS_REVISION =
  '3db86bc203c954fb76d301e21b0ba7126d5c36be';
export const KAMINOS_ANALYTIC_CARRIER_EXPECTED_AGE_CONTRACT =
  'gpu-material-tracer-release-age-v0';

function fail(message, details = {}) {
  const error = new Error(message);
  error.code = 'invalid_analytic_carrier_visual_witness';
  error.details = details;
  throw error;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCapture(report, mode, expectedRoute) {
  const capture = report.captures?.[mode];
  if (!capture) fail(`missing ${mode} capture`);
  if (capture.requestedMode !== mode || capture.effectiveMode !== mode) {
    fail(`${mode} requested mode is stale, defaulted, or substituted`, {
      requestedMode: capture.requestedMode,
      effectiveMode: capture.effectiveMode,
    });
  }
  if (
    capture.requestedRoute !== expectedRoute
    || capture.effectiveRoute !== expectedRoute
    || capture.fallbackRoute !== null
  ) {
    fail(`${mode} route or fallback identity disagrees`, {
      requestedRoute: capture.requestedRoute,
      effectiveRoute: capture.effectiveRoute,
      fallbackRoute: capture.fallbackRoute,
    });
  }
  if (!capture.primaryOutputWritten) {
    fail(`${mode} failed before primary output`, capture);
  }
  if (
    !capture.visual
    || capture.visual.partial === true
    || !Number.isSafeInteger(capture.visual.pixelCount)
    || capture.visual.pixelCount < 10_000
    || !Number.isSafeInteger(capture.visual.activePixels)
    || capture.visual.activePixels < 1
    || !Number.isFinite(capture.visual.activeRatio)
    || capture.visual.activeRatio < 0.02
  ) {
    fail(`${mode} output is blank or partial`, capture.visual);
  }
  if (
    capture.stepCount !== report.sameState?.stepCount
    || !sameJson(capture.camera, report.sameState?.camera)
  ) {
    fail(`${mode} did not preserve the same simulation state and fixed camera`, {
      sameState: report.sameState,
      captureStepCount: capture.stepCount,
      captureCamera: capture.camera,
    });
  }
  if (!sameJson(capture.sourceIdentity, report.sourceIdentity)) {
    fail(`${mode} source identity is stale or substituted`, {
      expected: report.sourceIdentity,
      effective: capture.sourceIdentity,
    });
  }
  return capture;
}

export function validateFingerFluidAnalyticCarrierWitnessReport(report) {
  if (!report || report.schema !== REPORT_SCHEMA) {
    fail('analytic carrier witness schema mismatch', { schema: report?.schema });
  }
  if (
    report.ok !== true
    || report.failure_phase !== null
    || report.primary_output_written !== true
  ) {
    fail('analytic carrier witness failed before primary output', {
      ok: report.ok,
      failurePhase: report.failure_phase,
      primaryOutputWritten: report.primary_output_written,
    });
  }
  if (!report.requestedUrl || report.effectiveUrl !== report.requestedUrl) {
    fail('requested and effective browser URL identity disagree', {
      requestedUrl: report.requestedUrl,
      effectiveUrl: report.effectiveUrl,
    });
  }
  const servedEntries = Object.values(report.servedSourceIdentity || {});
  if (
    servedEntries.length < 2
    || servedEntries.some(entry => entry?.exactLocalMatch !== true)
  ) {
    fail('served source is stale or does not match the witness checkout', {
      servedSourceIdentity: report.servedSourceIdentity,
    });
  }
  if (
    report.backend?.solver !== 'webgpu_compute'
    || report.backend?.renderer !== 'webgpu_direct_render'
    || report.backend?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0'
    || report.backend?.rendererRoute !== 'webgpu-screen-space-liquid-refraction-v0'
  ) {
    fail('fallback backend or renderer route rejected', report.backend);
  }
  if (
    report.sameState?.exact !== true
    || !Number.isSafeInteger(report.sameState?.stepCount)
    || report.sameState.stepCount < 1
    || !report.sameState.camera
  ) {
    fail('same simulation state evidence is missing or partial', report.sameState);
  }
  if (
    report.sourceIdentity?.sourceMechanicsRevision
      !== KAMINOS_ANALYTIC_CARRIER_EXPECTED_SOURCE_MECHANICS_REVISION
  ) {
    fail('analytic carrier source mechanics revision is missing or stale', {
      expected: KAMINOS_ANALYTIC_CARRIER_EXPECTED_SOURCE_MECHANICS_REVISION,
      effective: report.sourceIdentity?.sourceMechanicsRevision,
    });
  }
  if (
    report.sourceIdentity?.ageContract !== KAMINOS_ANALYTIC_CARRIER_EXPECTED_AGE_CONTRACT
  ) {
    fail('analytic carrier live-inlet age contract is missing or substituted', {
      expected: KAMINOS_ANALYTIC_CARRIER_EXPECTED_AGE_CONTRACT,
      effective: report.sourceIdentity?.ageContract,
    });
  }
  const hybrid = validateCapture(report, HYBRID_MODE, HYBRID_ROUTE);
  const particleOnly = validateCapture(report, PARTICLE_MODE, PARTICLE_MODE);
  if (!sameJson(hybrid.admittedCarrierSourceIdentity, report.sourceIdentity)) {
    fail('hybrid admitted carrier source identity is stale or substituted', {
      expected: report.sourceIdentity,
      effective: hybrid.admittedCarrierSourceIdentity,
    });
  }
  if (
    hybrid.particleSuppressionContract
      !== 'matching-source-pre-impact-age-exclusive-visibility-v0'
  ) {
    fail('hybrid particle suppression contract is missing or substituted', {
      particleSuppressionContract: hybrid.particleSuppressionContract,
    });
  }
  if (
    !Number.isSafeInteger(hybrid.sampleCount)
    || hybrid.sampleCount < 2
    || !Number.isSafeInteger(hybrid.carrierDrawCount)
    || hybrid.carrierDrawCount < 1
  ) {
    fail('hybrid analytic carrier output is blank or partial', {
      sampleCount: hybrid.sampleCount,
      carrierDrawCount: hybrid.carrierDrawCount,
    });
  }
  if (
    particleOnly.sampleCount !== 0
    || particleOnly.carrierDrawCount !== 0
    || particleOnly.admittedCarrierSourceIdentity !== null
    || particleOnly.particleSuppressionContract !== null
  ) {
    fail('particle-only control contains analytic carrier contamination', {
      sampleCount: particleOnly.sampleCount,
      carrierDrawCount: particleOnly.carrierDrawCount,
      admittedCarrierSourceIdentity: particleOnly.admittedCarrierSourceIdentity,
      particleSuppressionContract: particleOnly.particleSuppressionContract,
    });
  }
  if (
    !Number.isSafeInteger(report.visualDelta?.changedPixels)
    || report.visualDelta.changedPixels < 1
    || !Number.isFinite(report.visualDelta?.changedRatio)
    || report.visualDelta.changedRatio < 0.0001
    || !Number.isFinite(report.visualDelta?.meanAbsoluteChannelDelta)
    || report.visualDelta.meanAbsoluteChannelDelta <= 0
  ) {
    fail('analytic carrier mode produced no measurable same-state visual delta', {
      visualDelta: report.visualDelta,
    });
  }
  return {
    schema: 'kaminos.finger-fluid.analytic-carrier-visual-witness-acceptance.v1',
    ok: true,
    stepCount: report.sameState.stepCount,
    camera: report.sameState.camera,
    sourceIdentity: report.sourceIdentity,
    sourceMechanicsRevision: report.sourceIdentity.sourceMechanicsRevision,
    ageContract: report.sourceIdentity.ageContract,
    hybridSampleCount: hybrid.sampleCount,
    particleOnlySampleCount: particleOnly.sampleCount,
    visualDelta: report.visualDelta,
  };
}
