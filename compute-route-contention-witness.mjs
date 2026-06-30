#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA = 'kaminos.compute-route-contention-witness.v0';
export const COMPUTE_ROUTE_CONTENTION_ACCEPTANCE_SURFACE = 'wake.compute-route-contention-witness';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(asArray(values).map(value => String(value)).filter(Boolean))];
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function worstBucket(...buckets) {
  const order = ['unknown', 'clean', 'warm', 'hot', 'deranged'];
  return buckets.reduce((worst, bucket) => (
    order.indexOf(bucket) > order.indexOf(worst) ? bucket : worst
  ), 'unknown');
}

function bucketForFrameP95(value) {
  const numeric = finiteOrNull(value);
  if (numeric === null) return { bucket: 'unknown', reason: 'frame_p95_missing' };
  if (numeric >= 120) return { bucket: 'deranged', reason: 'frame_p95_deranged' };
  if (numeric >= 50) return { bucket: 'hot', reason: 'frame_p95_hot' };
  if (numeric >= 24) return { bucket: 'warm', reason: 'frame_p95_warm' };
  return { bucket: 'clean', reason: 'frame_p95_clean' };
}

function bucketForQueueP95(value) {
  const numeric = finiteOrNull(value);
  if (numeric === null) return { bucket: 'unknown', reason: 'queue_p95_missing' };
  if (numeric >= 240) return { bucket: 'deranged', reason: 'queue_p95_deranged' };
  if (numeric >= 96) return { bucket: 'hot', reason: 'queue_p95_hot' };
  if (numeric >= 45) return { bucket: 'warm', reason: 'queue_p95_warm' };
  return { bucket: 'clean', reason: 'queue_p95_clean' };
}

export function classifyFrameTailDamage({
  frameP95Ms = null,
  frameP99Ms = null,
  queueDoneP95Ms = null,
  queueDoneP99Ms = null,
} = {}) {
  const frame = bucketForFrameP95(frameP99Ms ?? frameP95Ms);
  const queue = bucketForQueueP95(queueDoneP99Ms ?? queueDoneP95Ms);
  return {
    bucket: worstBucket(frame.bucket, queue.bucket),
    reasons: unique([frame.reason, queue.reason]),
    thresholds: {
      cleanFrameP95MsLt: 24,
      hotFrameP95MsGte: 50,
      derangedFrameP95MsGte: 120,
      cleanQueueP95MsLt: 45,
      hotQueueP95MsGte: 96,
      derangedQueueP95MsGte: 240,
    },
  };
}

function phaseFromWitness(witness) {
  const routeRun = witness?.routeRun || {};
  const receipt = witness?.primaryBridge?.visualReceipt || {};
  return {
    routeRunId: routeRun.runId || witness?.primaryBridge?.routeRunId || null,
    routePhase: routeRun.routePhase || routeRun.routeActivity?.routePhase || null,
    statusBadge: routeRun.statusBadge || null,
    visualAuthority: routeRun.routeActivity?.visualAuthority || routeRun.routeActivity?.fire?.visualAuthority || null,
    truthMode: routeRun.routeActivity?.truthMode || null,
    visualPhase: receipt.visualPhase || null,
    allowsFullBurn: receipt.allowsFullBurn === true,
  };
}

function routeIdentityFromReport(report) {
  const activeRun = report?.activeWitness?.routeRun || {};
  const pipelineReport = report?.pipelineReport || {};
  return {
    pipelineId: report?.pipelineId || pipelineReport.effectivePipelineId || pipelineReport.requestedPipelineId || null,
    requestedRoute: activeRun.requestedRoute || activeRun.routeActivity?.requestedRoute || report?.routeId || null,
    effectiveRoute: activeRun.effectiveRoute || activeRun.routeActivity?.effectiveRoute || report?.routeId || null,
    backendClass: activeRun.backendClass || activeRun.routeActivity?.backendClass || null,
    pipelineReportPath: report?.pipelineReportPath || activeRun.receiptId || null,
    inputPath: report?.input || activeRun.inputArtifactIds?.[0] || null,
  };
}

function timingFromVolumeWitness(volumeWitnessReport) {
  const timing = volumeWitnessReport?.timing;
  if (!timing) throw new Error('visualWitnessReport.timing is required');
  const evidenceSource = timing.timingEvidenceSource || volumeWitnessReport.timingEvidenceSource || null;
  const disclaimer = timing.timingDisclaimer || volumeWitnessReport.timingDisclaimer || null;
  if (!evidenceSource || !disclaimer) {
    throw new Error('timing evidenceSource and disclaimer are required');
  }
  return {
    evidenceSource,
    disclaimer,
    rafFps: finiteOrNull(timing.rafFps),
    frameDeltaMs: finiteOrNull(timing.frameDeltaMs),
    frameP95Ms: finiteOrNull(timing.frameP95Ms),
    frameP99Ms: finiteOrNull(timing.frameP99Ms),
    queueDoneMs: finiteOrNull(timing.queueDoneMs),
    queueDoneP95Ms: finiteOrNull(timing.queueDoneP95Ms),
    queueDoneP99Ms: finiteOrNull(timing.queueDoneP99Ms),
    queueSamples: finiteOrNull(timing.queueSamples),
    frameCount: finiteOrNull(volumeWitnessReport.frameCount),
  };
}

function effectiveVisualBudgetFromVolumeWitness(volumeWitnessReport = {}) {
  const controls = volumeWitnessReport.controls || {};
  return {
    budgetId: controls.rayBudgetPreset || volumeWitnessReport.rayBudgetPreset || 'custom',
    evidenceMode: volumeWitnessReport.evidenceMode || null,
    visualEvidenceMode: volumeWitnessReport.visualEvidenceMode || null,
    visualBackendId: volumeWitnessReport.visualBackendId || 'beaming.volume-fire.kiln-v0',
    liveSimulation: true,
    prerecorded: false,
    rayBudgetPreset: controls.rayBudgetPreset || volumeWitnessReport.rayBudgetPreset || null,
    raySteps: finiteOrNull(controls.raySteps ?? volumeWitnessReport.raySteps),
    adaptiveRays: finiteOrNull(controls.adaptiveRays ?? volumeWitnessReport.adaptiveRays),
    renderScale: finiteOrNull(controls.renderScale ?? volumeWitnessReport.renderScale),
    simCostEvidenceSource: volumeWitnessReport.simCostLedger?.simCostEvidenceSource || null,
    fullGridPassesPerFrame: finiteOrNull(volumeWitnessReport.simCostLedger?.fullGridPassesPerFrame),
    fullGridCellVisitsPerFrame: finiteOrNull(volumeWitnessReport.simCostLedger?.fullGridCellVisitsPerFrame),
  };
}

function outputHandoffFromReport(report = {}) {
  const artifacts = Object.entries(report.pipelineReport?.artifacts || {})
    .filter(([id]) => id !== 'input')
    .map(([id, artifact]) => ({
      id,
      role: artifact?.role || id,
      status: artifact?.status || null,
      path: artifact?.path || null,
      bytes: finiteOrNull(artifact?.bytes),
    }));
  const realArtifacts = artifacts.filter(artifact => artifact.status === 'real' && artifact.path);
  const failed = report.phase?.startsWith?.('failed') || report.pipelineReport?.ok === false;
  return {
    status: failed ? 'failed-before-output' : realArtifacts.length > 0 ? 'real-output-produced' : 'no-real-output-recorded',
    artifactCount: artifacts.length,
    realArtifactCount: realArtifacts.length,
    artifacts,
  };
}

function sourceTruthWarningsFromReport(report = {}) {
  return unique([
    ...asArray(report.activeWitness?.routeRun?.sourceTruthWarnings),
    ...asArray(report.finalWitness?.routeRun?.sourceTruthWarnings),
    ...asArray(report.smokePayload?.warnings),
  ]);
}

function hasFixtureOrCachedEvidence(report, sourceTruthWarnings) {
  const runs = [
    report?.activeWitness?.routeRun,
    report?.finalWitness?.routeRun,
  ].filter(Boolean);
  return runs.some(run => ['fixture', 'cached', 'fallback', 'missing-backend'].includes(run.statusBadge))
    || sourceTruthWarnings.some(warning => /fixture|cached|fallback/i.test(warning));
}

function normalizeRequestedVisualBudget(requestedVisualBudget = {}) {
  return {
    budgetId: requestedVisualBudget.budgetId || requestedVisualBudget.rayBudgetPreset || 'unspecified',
    rayBudgetPreset: requestedVisualBudget.rayBudgetPreset || null,
    liveSimulation: requestedVisualBudget.liveSimulation !== false,
    prerecorded: requestedVisualBudget.prerecorded === true,
  };
}

function assertPrimaryEvidenceAllowed({ visualBudget, timing, sourceTruthWarnings, fixtureOrCachedRoute }) {
  if (!timing?.evidenceSource || !timing?.disclaimer) {
    throw new Error('timing evidenceSource and disclaimer are required');
  }
  if (visualBudget?.requested?.prerecorded === true || visualBudget?.requested?.liveSimulation === false) {
    throw new Error('pre-recorded visual budget cannot be primary contention evidence');
  }
  if (fixtureOrCachedRoute) {
    throw new Error(`fixture or cached route cannot be primary contention evidence: ${sourceTruthWarnings.join(', ')}`);
  }
}

export function buildComputeRouteContentionWitness({
  witnessId = 'compute-route-contention-witness-001',
  routeIdentity,
  routePhase,
  visualBudget,
  timing,
  outputHandoff = null,
  sourceTruthWarnings = [],
  pipelineReportPath = null,
  visualWitnessReportPath = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedWarnings = unique(sourceTruthWarnings);
  const fixtureOrCachedRoute = normalizedWarnings.some(warning => /fixture|cached|fallback/i.test(warning))
    || ['fixture', 'cached', 'fallback', 'missing-backend'].includes(routePhase?.active?.statusBadge)
    || ['fixture', 'cached', 'fallback', 'missing-backend'].includes(routePhase?.final?.statusBadge);
  assertPrimaryEvidenceAllowed({
    visualBudget,
    timing,
    sourceTruthWarnings: normalizedWarnings,
    fixtureOrCachedRoute,
  });
  const missingTiming = !Number.isFinite(timing.frameP95Ms) || !Number.isFinite(timing.queueDoneP95Ms);
  const frameTailDamage = classifyFrameTailDamage(timing);
  return {
    schema: COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA,
    witnessId,
    acceptanceSurface: COMPUTE_ROUTE_CONTENTION_ACCEPTANCE_SURFACE,
    generatedAt,
    routeIdentity: routeIdentity || {},
    routePhase: routePhase || {},
    visualBudget: visualBudget || {},
    timing,
    frameTailDamage,
    outputHandoff: outputHandoff || {
      status: 'unreported',
      artifactCount: 0,
      realArtifactCount: 0,
      artifacts: [],
    },
    sourceTruthWarnings: normalizedWarnings,
    falseClosureChecks: {
      missingTiming,
      prerecordedMainPath: visualBudget?.requested?.prerecorded === true || visualBudget?.requested?.liveSimulation === false,
      fixtureOrCachedRoute,
      timingProxyOnly: timing.disclaimer === 'not-gpu-exclusive-or-present-latency',
    },
    reportRefs: {
      pipelineReportPath,
      visualWitnessReportPath,
    },
  };
}

export function buildComputeRouteContentionWitnessFromReport(report, {
  witnessId = 'compute-route-contention-witness-001',
  requestedVisualBudget = {},
  visualWitnessReportPath = null,
} = {}) {
  if (!report || report.schema !== 'kaminos.compute-route-fire-visual-report.v0') {
    throw new Error('kaminos.compute-route-fire-visual-report.v0 report is required');
  }
  const sourceTruthWarnings = sourceTruthWarningsFromReport(report);
  const fixtureOrCachedRoute = hasFixtureOrCachedEvidence(report, sourceTruthWarnings);
  const visualBudget = {
    requested: normalizeRequestedVisualBudget(requestedVisualBudget),
    effective: effectiveVisualBudgetFromVolumeWitness(report.visualWitnessReport || {}),
  };
  const timing = timingFromVolumeWitness(report.visualWitnessReport || {});
  assertPrimaryEvidenceAllowed({
    visualBudget,
    timing,
    sourceTruthWarnings,
    fixtureOrCachedRoute,
  });
  return buildComputeRouteContentionWitness({
    witnessId,
    routeIdentity: routeIdentityFromReport(report),
    routePhase: {
      active: phaseFromWitness(report.activeWitness),
      final: report.finalWitness ? phaseFromWitness(report.finalWitness) : null,
    },
    visualBudget,
    timing,
    outputHandoff: outputHandoffFromReport(report),
    sourceTruthWarnings,
    pipelineReportPath: report.pipelineReportPath || null,
    visualWitnessReportPath,
  });
}

function parseArgs(argv) {
  const args = {
    inputReport: null,
    report: '/tmp/kaminos-compute-route-contention-witness/report.json',
    witnessId: 'compute-route-contention-witness-cli',
    requestedBudgetId: 'unspecified',
    requestedRayBudgetPreset: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-report') args.inputReport = argv[++index] || args.inputReport;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--witness-id') args.witnessId = argv[++index] || args.witnessId;
    else if (arg === '--requested-budget-id') args.requestedBudgetId = argv[++index] || args.requestedBudgetId;
    else if (arg === '--requested-ray-budget-preset') args.requestedRayBudgetPreset = argv[++index] || args.requestedRayBudgetPreset;
  }
  return args;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputReport) throw new Error('--input-report is required');
  const inputReportPath = resolve(args.inputReport);
  const outputReportPath = resolve(args.report);
  const inputReport = JSON.parse(readFileSync(inputReportPath, 'utf8'));
  const witness = buildComputeRouteContentionWitnessFromReport(inputReport, {
    witnessId: args.witnessId,
    requestedVisualBudget: {
      budgetId: args.requestedBudgetId,
      rayBudgetPreset: args.requestedRayBudgetPreset,
      liveSimulation: true,
      prerecorded: false,
    },
    visualWitnessReportPath: inputReport.volumeWitnessReportPath || null,
  });
  writeJson(outputReportPath, witness);
  console.log(outputReportPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
