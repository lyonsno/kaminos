const REPORT_SCHEMA = 'kaminos.finger-fluid.analytic-carrier-visual-witness.v2';
const HYBRID_MODE = 'hybrid_analytic_carrier';
const ANALYTIC_ONLY_MODE = 'analytic_carrier_only';
const PARTICLE_MODE = 'particle_only';
const ANALYTIC_ROUTE = 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0';
const REQUIRED_PRIMARY_OUTPUT_FILES = Object.freeze([
  'dynamic-hybrid-start.png',
  'dynamic-hybrid-end.png',
  'hybrid-analytic-carrier.png',
  'analytic-carrier-only.png',
  'particle-only.png',
]);
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

function validateVisual(visual, label) {
  if (
    !visual
    || visual.partial === true
    || !Number.isSafeInteger(visual.pixelCount)
    || visual.pixelCount < 10_000
    || !Number.isSafeInteger(visual.activePixels)
    || visual.activePixels < 1
    || !Number.isFinite(visual.activeRatio)
    || visual.activeRatio < 0.02
  ) {
    fail(`${label} output is blank or partial`, visual);
  }
}

function validateVisualDelta(delta, label) {
  if (
    !Number.isSafeInteger(delta?.changedPixels)
    || delta.changedPixels < 1
    || !Number.isFinite(delta?.changedRatio)
    || delta.changedRatio < 0.0001
    || !Number.isFinite(delta?.meanAbsoluteChannelDelta)
    || delta.meanAbsoluteChannelDelta <= 0
  ) {
    fail(`${label} produced no measurable visual delta`, { visualDelta: delta });
  }
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
  validateVisual(capture.visual, mode);
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
  const outputFiles = Array.isArray(report.outputFiles)
    ? report.outputFiles.filter(path => typeof path === 'string')
    : [];
  const missingPrimaryOutputs = REQUIRED_PRIMARY_OUTPUT_FILES.filter(
    filename => !outputFiles.some(path => path.endsWith(filename)),
  );
  if (
    missingPrimaryOutputs.length > 0
    || new Set(outputFiles).size !== outputFiles.length
  ) {
    fail('analytic carrier primary output set is missing, partial, or duplicated', {
      outputFiles,
      missingPrimaryOutputs,
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
  const hybrid = validateCapture(report, HYBRID_MODE, ANALYTIC_ROUTE);
  const analyticOnly = validateCapture(report, ANALYTIC_ONLY_MODE, ANALYTIC_ROUTE);
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
    || hybrid.canonicalParticleVisibility !== 'matching_pre_impact_suppressed'
  ) {
    fail('hybrid particle suppression contract is missing or substituted', {
      particleSuppressionContract: hybrid.particleSuppressionContract,
      canonicalParticleVisibility: hybrid.canonicalParticleVisibility,
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
  if (!sameJson(analyticOnly.admittedCarrierSourceIdentity, report.sourceIdentity)) {
    fail('analytic-only admitted carrier source identity is stale or substituted', {
      expected: report.sourceIdentity,
      effective: analyticOnly.admittedCarrierSourceIdentity,
    });
  }
  if (
    analyticOnly.particleSuppressionContract !== null
    || analyticOnly.canonicalParticleVisibility !== 'hidden'
    || !Number.isSafeInteger(analyticOnly.sampleCount)
    || analyticOnly.sampleCount < 2
    || !Number.isSafeInteger(analyticOnly.carrierDrawCount)
    || analyticOnly.carrierDrawCount < 1
  ) {
    fail('analytic-only isolation is contaminated, blank, or partial', {
      particleSuppressionContract: analyticOnly.particleSuppressionContract,
      canonicalParticleVisibility: analyticOnly.canonicalParticleVisibility,
      sampleCount: analyticOnly.sampleCount,
      carrierDrawCount: analyticOnly.carrierDrawCount,
    });
  }
  if (
    particleOnly.sampleCount !== 0
    || particleOnly.carrierDrawCount !== 0
    || particleOnly.admittedCarrierSourceIdentity !== null
    || particleOnly.particleSuppressionContract !== null
    || particleOnly.canonicalParticleVisibility !== 'all'
  ) {
    fail('particle-only control contains analytic carrier contamination', {
      sampleCount: particleOnly.sampleCount,
      carrierDrawCount: particleOnly.carrierDrawCount,
      admittedCarrierSourceIdentity: particleOnly.admittedCarrierSourceIdentity,
      particleSuppressionContract: particleOnly.particleSuppressionContract,
      canonicalParticleVisibility: particleOnly.canonicalParticleVisibility,
    });
  }
  validateVisualDelta(report.visualDelta, 'hybrid analytic carrier mode');
  validateVisualDelta(report.analyticOnlyVisualDelta, 'analytic-only carrier mode');
  const dynamic = report.dynamicOutput;
  if (
    dynamic?.requestedMode !== HYBRID_MODE
    || dynamic?.effectiveMode !== HYBRID_MODE
    || dynamic?.requestedRoute !== ANALYTIC_ROUTE
    || dynamic?.effectiveRoute !== ANALYTIC_ROUTE
    || dynamic?.fallbackRoute !== null
  ) {
    fail('dynamic output route is stale, defaulted, or fallback', dynamic);
  }
  if (
    !Number.isSafeInteger(dynamic.startStep)
    || !Number.isSafeInteger(dynamic.endStep)
    || dynamic.startStep < 1
    || dynamic.endStep <= dynamic.startStep
    || dynamic.endStep !== report.sameState.stepCount
    || !sameJson(dynamic.camera, report.sameState.camera)
  ) {
    fail('dynamic output did not advance into the fixed comparison state', dynamic);
  }
  validateVisual(dynamic.startVisual, 'dynamic start');
  validateVisual(dynamic.endVisual, 'dynamic end');
  validateVisualDelta(dynamic.visualDelta, 'dynamic carrier output');
  return {
    schema: 'kaminos.finger-fluid.analytic-carrier-visual-witness-acceptance.v2',
    ok: true,
    stepCount: report.sameState.stepCount,
    camera: report.sameState.camera,
    sourceIdentity: report.sourceIdentity,
    sourceMechanicsRevision: report.sourceIdentity.sourceMechanicsRevision,
    ageContract: report.sourceIdentity.ageContract,
    hybridSampleCount: hybrid.sampleCount,
    analyticOnlySampleCount: analyticOnly.sampleCount,
    particleOnlySampleCount: particleOnly.sampleCount,
    visualDelta: report.visualDelta,
    analyticOnlyVisualDelta: report.analyticOnlyVisualDelta,
    dynamicVisualDelta: dynamic.visualDelta,
  };
}
