#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA = 'kaminos.compute-route-contention-witness.v0';
export const COMPUTE_ROUTE_CONTENTION_ACCEPTANCE_SURFACE = 'wake.compute-route-contention-witness';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstStage(report) {
  return Array.isArray(report?.pipelineReport?.stages) ? report.pipelineReport.stages[0] || null : null;
}

function unique(values) {
  return [...new Set(asArray(values).map(value => String(value)).filter(Boolean))];
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function worstBucket(...buckets) {
  const order = ['unknown', 'clean', 'warm', 'hot', 'deranged'];
  return buckets.reduce((worst, bucket) => (
    order.indexOf(bucket) > order.indexOf(worst) ? bucket : worst
  ), 'unknown');
}

function bucketForFrameTail(value, reasonPrefix = 'frame_p95') {
  const numeric = finiteOrNull(value);
  if (numeric === null) return { bucket: 'unknown', reason: `${reasonPrefix}_missing` };
  if (numeric >= 120) return { bucket: 'deranged', reason: `${reasonPrefix}_deranged` };
  if (numeric >= 50) return { bucket: 'hot', reason: `${reasonPrefix}_hot` };
  if (numeric >= 24) return { bucket: 'warm', reason: `${reasonPrefix}_warm` };
  return { bucket: 'clean', reason: `${reasonPrefix}_clean` };
}

function bucketForQueueTail(value, reasonPrefix = 'queue_p95') {
  const numeric = finiteOrNull(value);
  if (numeric === null) return { bucket: 'unknown', reason: `${reasonPrefix}_missing` };
  if (numeric >= 240) return { bucket: 'deranged', reason: `${reasonPrefix}_deranged` };
  if (numeric >= 96) return { bucket: 'hot', reason: `${reasonPrefix}_hot` };
  if (numeric >= 45) return { bucket: 'warm', reason: `${reasonPrefix}_warm` };
  return { bucket: 'clean', reason: `${reasonPrefix}_clean` };
}

export function classifyFrameTailDamage({
  frameP95Ms = null,
  frameP99Ms = null,
  queueDoneP95Ms = null,
  queueDoneP99Ms = null,
} = {}) {
  const frameUsesP99 = finiteOrNull(frameP99Ms) !== null;
  const queueUsesP99 = finiteOrNull(queueDoneP99Ms) !== null;
  const frame = bucketForFrameTail(frameUsesP99 ? frameP99Ms : frameP95Ms, frameUsesP99 ? 'frame_p99' : 'frame_p95');
  const queue = bucketForQueueTail(queueUsesP99 ? queueDoneP99Ms : queueDoneP95Ms, queueUsesP99 ? 'queue_p99' : 'queue_p95');
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
  const runtimeQuality = runtimeQualityFromVolumeWitness(volumeWitnessReport);
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
    runtimeQuality,
  };
}

function runtimeQualityFromVolumeWitness(volumeWitnessReport = {}) {
  const receipt = volumeWitnessReport.runtimeQualityReceipt || volumeWitnessReport.runtimeQuality || null;
  if (!receipt) return null;
  return {
    schema: receipt.schema || receipt.source || 'volume-runtime-quality-ladder-v0',
    requested: receipt.requested || receipt.requestedRuntimeQuality || null,
    effective: receipt.effective || receipt.effectiveRuntimeQuality || null,
    reason: receipt.reason || null,
    source: receipt.source || receipt.schema || 'volume-runtime-quality-ladder-v0',
    changedControls: asArray(receipt.changedControls),
    knobs: cloneObject(receipt.knobs) || {},
  };
}

function visualSourceTruthFromVolumeWitness(volumeWitnessReport = {}) {
  const sourceTruth = cloneObject(volumeWitnessReport.visualSourceTruth) || {};
  const source = sourceTruth.source || 'unwitnessed';
  return {
    source,
    fallbackReason: sourceTruth.fallbackReason || null,
    mayClaimLiveNovelty: sourceTruth.mayClaimLiveNovelty ?? false,
  };
}

function effectiveVolumeParamsFromVolumeWitness(volumeWitnessReport = {}) {
  const controls = volumeWitnessReport.controls || {};
  const runtimeKnobs = volumeWitnessReport.runtimeQualityReceipt?.knobs || volumeWitnessReport.runtimeQuality?.knobs || {};
  return {
    renderScale: finiteOrNull(controls.renderScale ?? runtimeKnobs.renderScale ?? volumeWitnessReport.renderScale),
    reconstructionStyle: controls.reconstructionStyle || runtimeKnobs.reconstructionStyle || volumeWitnessReport.reconstructionStyle || null,
    raySteps: finiteOrNull(controls.raySteps ?? runtimeKnobs.raySteps ?? volumeWitnessReport.raySteps),
    adaptiveRays: finiteOrNull(controls.adaptiveRays ?? runtimeKnobs.adaptiveRays ?? volumeWitnessReport.adaptiveRays),
    grid: controls.grid || runtimeKnobs.grid || volumeWitnessReport.grid || null,
    pressureStrategy: controls.pressureStrategy || runtimeKnobs.pressureStrategy || volumeWitnessReport.pressureStrategy || null,
    pressureIterations: finiteOrNull(controls.pressureIterations ?? runtimeKnobs.pressureIterations ?? volumeWitnessReport.pressureIterations),
    majorantSkip: finiteOrNull(controls.majorantSkip ?? runtimeKnobs.majorantSkip ?? volumeWitnessReport.majorantSkip),
    majorantCadence: finiteOrNull(controls.majorantCadence ?? runtimeKnobs.majorantCadence ?? volumeWitnessReport.majorantCadence),
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

function stringByteLength(value) {
  if (value === null || value === undefined) return 0;
  return Buffer.byteLength(String(value), 'utf8');
}

function normalizePipelineExit(pipelineExit = null) {
  if (!pipelineExit || typeof pipelineExit !== 'object') return null;
  return {
    status: finiteOrNull(pipelineExit.status),
    startedAt: pipelineExit.startedAt || null,
    finishedAt: pipelineExit.finishedAt || null,
    durationMs: finiteOrNull(pipelineExit.durationMs),
    stdoutTailBytes: stringByteLength(pipelineExit.stdoutTail),
    stderrTailBytes: stringByteLength(pipelineExit.stderrTail),
    hasStdoutTail: stringByteLength(pipelineExit.stdoutTail) > 0,
    hasStderrTail: stringByteLength(pipelineExit.stderrTail) > 0,
  };
}

function routeStageTelemetry(stage = {}) {
  const effectiveRoute = stage.effectiveRoute || {};
  return {
    id: stage.id || null,
    label: stage.label || null,
    status: stage.status || null,
    requestedRoute: stage.requestedRoute || null,
    effectiveRoute: effectiveRoute.id || null,
    effectiveBackend: effectiveRoute.effectiveBackend || effectiveRoute.backendClass || null,
    realModel: effectiveRoute.realModel === true,
    requestedRealModel: effectiveRoute.requestedRealModel === true,
    executesModel: effectiveRoute.executesModel === true,
    commandEnv: effectiveRoute.commandEnv || null,
    adapterReportPath: effectiveRoute.adapterReportPath || null,
    exitCode: finiteOrNull(effectiveRoute.exitCode),
    signal: effectiveRoute.signal || null,
    stdoutTailBytes: stringByteLength(effectiveRoute.stdoutTail),
    stderrTailBytes: stringByteLength(effectiveRoute.stderrTail),
    outputArtifact: stage.outputArtifact || null,
    outputPath: stage.outputPath || null,
    outputBytes: finiteOrNull(stage.outputBytes ?? effectiveRoute.outputBytes),
    outputSha256: stage.outputSha256 || effectiveRoute.outputSha256 || null,
    truthBoundary: effectiveRoute.truthBoundary || null,
  };
}

function artifactByteTelemetry(artifacts = {}) {
  const entries = Object.entries(artifacts)
    .filter(([id]) => id !== 'input')
    .map(([id, artifact]) => ({
      id,
      role: artifact?.role || id,
      status: artifact?.status || null,
      bytes: finiteOrNull(artifact?.bytes),
      path: artifact?.path || null,
    }));
  return {
    artifactCount: entries.length,
    realArtifactCount: entries.filter(entry => entry.status === 'real').length,
    realOutputBytes: entries
      .filter(entry => entry.status === 'real')
      .reduce((total, entry) => total + (entry.bytes || 0), 0),
    entries,
  };
}

function routeTelemetryFromReport(report = {}) {
  const pipelineReport = report.pipelineReport || null;
  const stages = asArray(pipelineReport?.stages);
  const declaredStageCount = finiteOrNull(pipelineReport?.effectiveRouteConfig?.stageCount);
  const telemetryWarnings = [];
  if (!pipelineReport) telemetryWarnings.push('pipeline_report_missing');
  if (pipelineReport?.ok === false || String(pipelineReport?.phase || '').startsWith('failed')) {
    telemetryWarnings.push('pipeline_report_failed');
  }
  if (pipelineReport && stages.length === 0) telemetryWarnings.push('pipeline_report_stages_missing');
  if (declaredStageCount !== null && declaredStageCount !== stages.length) {
    telemetryWarnings.push('pipeline_report_stage_count_mismatch');
  }
  for (const stage of stages) {
    const stageId = stage?.id || 'unknown-stage';
    if (stage?.status === 'failed') telemetryWarnings.push(`pipeline_stage_status_failed:${stageId}`);
    if (stage?.status === 'partial') telemetryWarnings.push(`pipeline_stage_status_partial:${stageId}`);
    const exitCode = finiteOrNull(stage?.effectiveRoute?.exitCode);
    if (exitCode !== null && exitCode !== 0) telemetryWarnings.push(`pipeline_stage_exit_nonzero:${stageId}`);
    if (stage?.effectiveRoute?.signal) telemetryWarnings.push(`pipeline_stage_signal:${stageId}`);
  }
  for (const [artifactId, artifact] of Object.entries(pipelineReport?.artifacts || {})) {
    if (artifactId === 'input') continue;
    if (artifact?.status === 'partial') telemetryWarnings.push(`pipeline_artifact_status_partial:${artifactId}`);
  }
  if (report.runPipeline === true && !report.pipelineExit) telemetryWarnings.push('pipeline_exit_missing');
  const pipelineExit = normalizePipelineExit(report.pipelineExit);
  if (pipelineExit && pipelineExit.status !== 0) telemetryWarnings.push('pipeline_exit_nonzero');
  return {
    schema: 'kaminos.compute-route-telemetry.v0',
    evidenceSource: 'compute-route-fire-visual-report.pipeline-report',
    reportPhase: report.phase || null,
    pipelineReportPath: report.pipelineReportPath || null,
    pipeline: pipelineReport ? {
      ok: pipelineReport.ok === true,
      phase: pipelineReport.phase || null,
      requestedPipelineId: pipelineReport.requestedPipelineId || null,
      effectivePipelineId: pipelineReport.effectivePipelineId || null,
      routeId: pipelineReport.effectiveRouteConfig?.routeId || null,
      outputRoot: pipelineReport.effectiveRouteConfig?.outputRoot || null,
      declaredStageCount,
    } : null,
    pipelineExit,
    stageCount: stages.length,
    stages: stages.map(routeStageTelemetry),
    artifactBytes: artifactByteTelemetry(pipelineReport?.artifacts || {}),
    telemetryWarnings: unique(telemetryWarnings),
  };
}

function sourceTruthWarningsFromReport(report = {}) {
  return unique([
    ...asArray(report.activeWitness?.routeRun?.sourceTruthWarnings),
    ...asArray(report.finalWitness?.routeRun?.sourceTruthWarnings),
    ...asArray(report.smokePayload?.warnings),
  ]);
}

function cloneObject(value) {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map(pruneUndefined);
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const pruned = pruneUndefined(child);
    if (pruned !== undefined) output[key] = pruned;
  }
  return output;
}

function canonicalSchedulerConfig(config) {
  if (!isPlainObject(config)) return null;
  const canonical = cloneObject(config);
  if (!isPlainObject(canonical.phaseChunkSize)) canonical.phaseChunkSize = {};
  if (canonical.spnPatchChunkSize !== undefined) canonical.phaseChunkSize.spnPatch = canonical.spnPatchChunkSize;
  if (canonical.vitBlockChunkSize !== undefined) canonical.phaseChunkSize.vitBlock = canonical.vitBlockChunkSize;
  delete canonical.spnPatchChunkSize;
  delete canonical.vitBlockChunkSize;
  delete canonical.unsupportedFields;
  if (Object.keys(canonical.phaseChunkSize).length === 0) delete canonical.phaseChunkSize;
  return pruneUndefined(canonical);
}

function leafPaths(value, prefix = '') {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  const entries = Object.entries(value);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function valueAtPath(value, path) {
  return path.split('.').reduce((cursor, key) => (cursor && cursor[key] !== undefined ? cursor[key] : undefined), value);
}

function valuesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isUnsupported(path, unsupportedFields) {
  return unsupportedFields.some(field => path === field || path.startsWith(`${field}.`));
}

function unsupportedFieldsFrom(...configs) {
  return unique(configs.flatMap(config => asArray(config?.unsupportedFields)));
}

function schedulerDriftViolations(requested, effective, unsupportedFields, prefix) {
  const requestedCanonical = canonicalSchedulerConfig(requested);
  const effectiveCanonical = canonicalSchedulerConfig(effective);
  if (!requestedCanonical || !effectiveCanonical) return [];
  return leafPaths(requestedCanonical)
    .filter(path => !isUnsupported(path, unsupportedFields))
    .filter(path => !valuesMatch(valueAtPath(requestedCanonical, path), valueAtPath(effectiveCanonical, path)))
    .map(path => `${prefix}:${path}`);
}

function adapterKitDisagreements(kitScheduler, adapterEvidence) {
  if (!kitScheduler || !adapterEvidence) return [];
  const violations = [];
  for (const field of ['requestedScheduler', 'effectiveScheduler']) {
    const kitConfig = canonicalSchedulerConfig(kitScheduler[field]);
    const adapterConfig = canonicalSchedulerConfig(adapterEvidence[field]);
    if (!kitConfig || !adapterConfig) continue;
    const unsupported = field === 'effectiveScheduler'
      ? unsupportedFieldsFrom(kitScheduler.effectiveScheduler, adapterEvidence.effectiveScheduler)
      : [];
    const kitPaths = leafPaths(kitConfig);
    const adapterPaths = new Set(leafPaths(adapterConfig));
    const paths = kitPaths.filter(path => adapterPaths.has(path));
    for (const path of paths) {
      if (isUnsupported(path, unsupported)) continue;
      if (!valuesMatch(valueAtPath(kitConfig, path), valueAtPath(adapterConfig, path))) {
        violations.push(`adapter_scheduler_disagrees_with_kit_scheduler:${field}.${path}`);
      }
    }
  }
  return unique(violations);
}

function schedulerTelemetryWarnings(scheduler, adapterEvidence) {
  const warnings = [];
  for (const source of [scheduler, adapterEvidence]) {
    const age = finiteOrNull(source?.telemetryAgeMs);
    const maxAge = finiteOrNull(source?.maxTelemetryAgeMs);
    if (age !== null && maxAge !== null && age > maxAge) warnings.push('scheduler_telemetry_stale');
  }
  return unique(warnings);
}

function effectiveRouteEvidence(report = {}) {
  return {
    ...(report.pipelineReport?.effectiveRouteConfig || {}),
    ...(firstStage(report)?.effectiveRoute || {}),
  };
}

function pipelineSchedulerFromReport(report = {}) {
  const routeEvidence = effectiveRouteEvidence(report);
  const pipelineScheduler = cloneObject(
    routeEvidence.pipelineScheduler || routeEvidence.adapterReport?.pipelineScheduler,
  );
  if (pipelineScheduler?.schema === 'kaminos.pipeline-scheduler-composition.v0') {
    return pipelineScheduler;
  }
  return null;
}

function schedulerVerificationState(scheduler, adapterEvidence) {
  if (scheduler && !scheduler.effectiveScheduler) {
    return 'scheduler-unverified';
  }
  if (scheduler?.verificationState) return scheduler.verificationState;
  if (scheduler?.effectiveScheduler && adapterEvidence?.verificationState) return 'adapter-evidence';
  if (scheduler?.effectiveScheduler) return 'effective-evidence';
  if (!scheduler?.effectiveScheduler && !adapterEvidence?.effectiveScheduler) {
    return 'scheduler-unverified';
  }
  if (adapterEvidence?.verificationState) return adapterEvidence.verificationState;
  if (scheduler?.effectiveScheduler || adapterEvidence?.effectiveScheduler) return 'adapter-evidence';
  return 'scheduler-unverified';
}

function schedulerFromReport(report = {}) {
  const routeEvidence = effectiveRouteEvidence(report);
  const pipelineScheduler = pipelineSchedulerFromReport(report);
  if (pipelineScheduler?.scheduler) {
    return {
      ...cloneObject(pipelineScheduler.scheduler),
      adapterEvidence: pipelineScheduler.scheduler.adapterEvidence || pipelineScheduler.raw?.breathingRoom || null,
    };
  }
  const scheduler = cloneObject(routeEvidence.scheduler);
  const adapterEvidence = cloneObject(routeEvidence.breathingRoom || routeEvidence.schedulerEvidence);
  if (scheduler) {
    return {
      ...scheduler,
      adapterEvidence: scheduler.adapterEvidence || adapterEvidence,
    };
  }
  return adapterEvidence ? { adapterEvidence } : null;
}

function normalizeScheduler(scheduler = null, adapterEvidence = null) {
  const normalizedScheduler = cloneObject(scheduler);
  const normalizedAdapterEvidence = cloneObject(adapterEvidence || scheduler?.adapterEvidence);
  const hasKitScheduler = Boolean(
    normalizedScheduler?.requestedScheduler
      || normalizedScheduler?.effectiveScheduler,
  );
  if (normalizedScheduler && hasKitScheduler) {
    const effectiveScheduler = normalizedScheduler.effectiveScheduler || null;
    const base = {
      schema: normalizedScheduler.schema || 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: normalizedScheduler.requestedScheduler || null,
      effectiveScheduler,
      verificationState: schedulerVerificationState(normalizedScheduler, normalizedAdapterEvidence),
      adapterEvidence: normalizedAdapterEvidence,
    };
    const driftViolations = schedulerDriftViolations(
      base.requestedScheduler,
      base.effectiveScheduler,
      unsupportedFieldsFrom(base.effectiveScheduler),
      'requested_effective_scheduler_drift_without_unsupported_fields',
    );
    const verifiedWithoutEffective = normalizedScheduler.verificationState === 'verified' && !effectiveScheduler
      ? ['scheduler_verified_without_effective_scheduler']
      : [];
    const kitVerificationMissing = effectiveScheduler && !normalizedScheduler.verificationState
      ? ['kit_scheduler_verification_state_missing']
      : [];
    const adapterDisagreements = adapterKitDisagreements(base, normalizedAdapterEvidence);
    const validationWarnings = unique([
      ...verifiedWithoutEffective,
      ...kitVerificationMissing,
      ...driftViolations,
      ...adapterDisagreements,
      ...schedulerTelemetryWarnings(normalizedScheduler, normalizedAdapterEvidence),
    ]);
    return {
      ...base,
      validationWarnings,
      falseAuthorityViolations: unique([
        ...verifiedWithoutEffective,
        ...driftViolations,
        ...adapterDisagreements,
      ]),
    };
  }
  if (normalizedAdapterEvidence) {
    return {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: null,
      effectiveScheduler: null,
      verificationState: 'scheduler-unverified',
      adapterEvidence: normalizedAdapterEvidence,
      validationWarnings: unique([
        'route_specific_scheduler_without_kit_mapping',
        ...schedulerTelemetryWarnings(null, normalizedAdapterEvidence),
      ]),
      falseAuthorityViolations: [],
    };
  }
  return {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: null,
    effectiveScheduler: null,
    verificationState: 'scheduler-unverified',
    adapterEvidence: null,
    validationWarnings: [],
    falseAuthorityViolations: [],
  };
}

function backpressureFromReport(report = {}) {
  const routeEvidence = effectiveRouteEvidence(report);
  const pipelineScheduler = pipelineSchedulerFromReport(report);
  if (pipelineScheduler?.backpressure) return pipelineScheduler.backpressure;
  const backpressure = cloneObject(routeEvidence.backpressure);
  return backpressure || {
    schema: 'kaminos.webgpu-route-backpressure.v0',
    requestedBudget: null,
    effectiveBudget: null,
    memoryExclusivity: 'unknown',
    warmCacheState: 'unknown',
    frameTail: {
      sampleWindowMs: 0,
      longFrameCount: 0,
      maxFrameGapMs: 0,
      p95FrameGapMs: null,
      p99FrameGapMs: null,
    },
  };
}

function optimizationFromReport(report = {}) {
  const routeEvidence = effectiveRouteEvidence(report);
  const pipelineScheduler = pipelineSchedulerFromReport(report);
  if (pipelineScheduler?.optimizationIdentity) {
    const optimizationIdentity = cloneObject(pipelineScheduler.optimizationIdentity);
    const mode = optimizationIdentity.vitEncoderMode || null;
    return {
      profile: pipelineScheduler.scheduler?.effectiveScheduler?.mode || 'unknown',
      kernelProfile: mode ? `sharp-vit-${mode}` : null,
      fusionBoundary: mode === 'split' ? 'bounded-phase' : mode === 'fused' ? 'cross-phase' : 'unknown',
      ...optimizationIdentity,
    };
  }
  const optimization = cloneObject(routeEvidence.optimization);
  return optimization || {
    profile: 'unknown',
    kernelProfile: null,
    fusionBoundary: 'unknown',
  };
}

function witnessWarningsFor({ scheduler, routeTelemetry = null, pipelineScheduler = null }) {
  const warnings = [];
  warnings.push(...asArray(scheduler?.validationWarnings));
  warnings.push(...asArray(scheduler?.falseAuthorityViolations));
  warnings.push(...asArray(routeTelemetry?.telemetryWarnings));
  warnings.push(...asArray(pipelineScheduler?.failureDowngrades).map(downgrade => `pipeline_scheduler_downgrade:${downgrade}`));
  if (scheduler?.verificationState === 'scheduler-unverified') warnings.push('scheduler_unverified');
  const requested = scheduler?.requestedScheduler;
  const effective = scheduler?.effectiveScheduler;
  if (requested && !effective) warnings.push('requested_scheduler_without_effective_scheduler');
  if (requested && effective) {
    const unsupported = asArray(effective.unsupportedFields);
    for (const [key, value] of Object.entries(requested)) {
      const same = JSON.stringify(value) === JSON.stringify(effective[key]);
      if (!same && unsupported.length === 0) {
        warnings.push(`requested_effective_scheduler_drift_without_unsupported_fields:${key}`);
      }
    }
  }
  return unique(warnings);
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

function visualSourceTruthBlocksPrimary(visualSourceTruth = null) {
  const source = visualSourceTruth?.source || 'unwitnessed';
  return source === 'unwitnessed'
    || ['cached-volume', 'prerender', 'fixture', 'failed', 'fallback'].includes(source)
    || Boolean(visualSourceTruth?.fallbackReason)
    || visualSourceTruth?.mayClaimLiveNovelty !== true;
}

function assertPrimaryEvidenceAllowed({
  visualBudget,
  visualSourceTruth,
  timing,
  sourceTruthWarnings,
  fixtureOrCachedRoute,
}) {
  if (!timing?.evidenceSource || !timing?.disclaimer) {
    throw new Error('timing evidenceSource and disclaimer are required');
  }
  const hasFrameTail = Number.isFinite(timing.frameP99Ms) || Number.isFinite(timing.frameP95Ms);
  const hasQueueTail = Number.isFinite(timing.queueDoneP99Ms) || Number.isFinite(timing.queueDoneP95Ms);
  if (!hasFrameTail || !hasQueueTail) {
    throw new Error('finite frame-tail and queue-tail timing are required for primary contention evidence');
  }
  if (visualBudget?.requested?.prerecorded === true || visualBudget?.requested?.liveSimulation === false) {
    throw new Error('pre-recorded visual budget cannot be primary contention evidence');
  }
  if (visualSourceTruthBlocksPrimary(visualSourceTruth)) {
    throw new Error('non-live visual source truth cannot be primary contention evidence');
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
  scheduler = null,
  routeTelemetry = null,
  backpressure = null,
  optimization = null,
  pipelineScheduler = null,
  visualSourceTruth = null,
  effectiveVolumeParams = null,
  outputHandoff = null,
  sourceTruthWarnings = [],
  pipelineReportPath = null,
  visualWitnessReportPath = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedWarnings = unique(sourceTruthWarnings);
  const normalizedVisualSourceTruth = visualSourceTruth || {
    source: 'unwitnessed',
    fallbackReason: null,
    mayClaimLiveNovelty: false,
  };
  const fixtureOrCachedRoute = normalizedWarnings.some(warning => /fixture|cached|fallback/i.test(warning))
    || ['fixture', 'cached', 'fallback', 'missing-backend'].includes(routePhase?.active?.statusBadge)
    || ['fixture', 'cached', 'fallback', 'missing-backend'].includes(routePhase?.final?.statusBadge);
  assertPrimaryEvidenceAllowed({
    visualBudget,
    visualSourceTruth: normalizedVisualSourceTruth,
    timing,
    sourceTruthWarnings: normalizedWarnings,
    fixtureOrCachedRoute,
  });
  const missingTiming = !(Number.isFinite(timing.frameP99Ms) || Number.isFinite(timing.frameP95Ms))
    || !(Number.isFinite(timing.queueDoneP99Ms) || Number.isFinite(timing.queueDoneP95Ms));
  const frameTailDamage = classifyFrameTailDamage(timing);
  const normalizedScheduler = normalizeScheduler(scheduler);
  const normalizedPipelineScheduler = cloneObject(pipelineScheduler);
  const normalizedRouteTelemetry = routeTelemetry || {
    schema: 'kaminos.compute-route-telemetry.v0',
    evidenceSource: 'unreported',
    reportPhase: null,
    pipelineReportPath: null,
    pipeline: null,
    pipelineExit: null,
    stageCount: 0,
    stages: [],
    artifactBytes: artifactByteTelemetry({}),
    telemetryWarnings: ['route_telemetry_missing'],
  };
  const witnessWarnings = witnessWarningsFor({
    scheduler: normalizedScheduler,
    routeTelemetry: normalizedRouteTelemetry,
    pipelineScheduler: normalizedPipelineScheduler,
  });
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
    visualSourceTruth: normalizedVisualSourceTruth,
    effectiveVolumeParams: effectiveVolumeParams || {
      renderScale: null,
      reconstructionStyle: null,
      raySteps: null,
      adaptiveRays: null,
      grid: null,
      pressureStrategy: null,
      pressureIterations: null,
      majorantSkip: null,
      majorantCadence: null,
    },
    pipelineScheduler: normalizedPipelineScheduler,
    scheduler: normalizedScheduler,
    routeTelemetry: normalizedRouteTelemetry,
    backpressure: backpressure || {
      schema: 'kaminos.webgpu-route-backpressure.v0',
      requestedBudget: null,
      effectiveBudget: null,
      memoryExclusivity: 'unknown',
      warmCacheState: 'unknown',
      frameTail: {
        sampleWindowMs: 0,
        longFrameCount: 0,
        maxFrameGapMs: 0,
        p95FrameGapMs: null,
        p99FrameGapMs: null,
      },
    },
    optimization: optimization || {
      profile: 'unknown',
      kernelProfile: null,
      fusionBoundary: 'unknown',
    },
    outputHandoff: outputHandoff || {
      status: 'unreported',
      artifactCount: 0,
      realArtifactCount: 0,
      artifacts: [],
    },
    sourceTruthWarnings: normalizedWarnings,
    witnessWarnings,
    falseClosureChecks: {
      missingTiming,
      prerecordedMainPath: visualBudget?.requested?.prerecorded === true || visualBudget?.requested?.liveSimulation === false,
      fixtureOrCachedRoute,
      visualSourceNotLive: visualSourceTruthBlocksPrimary(normalizedVisualSourceTruth),
      missingRouteTelemetry: asArray(normalizedRouteTelemetry.telemetryWarnings).some(warning => (
        warning === 'route_telemetry_missing'
          || warning === 'pipeline_report_missing'
          || warning === 'pipeline_report_stages_missing'
          || warning === 'pipeline_report_stage_count_mismatch'
      )),
      schedulerUnverified: normalizedScheduler.verificationState === 'scheduler-unverified',
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
  const visualSourceTruth = visualSourceTruthFromVolumeWitness(report.visualWitnessReport || {});
  const timing = timingFromVolumeWitness(report.visualWitnessReport || {});
  assertPrimaryEvidenceAllowed({
    visualBudget,
    visualSourceTruth,
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
    visualSourceTruth,
    effectiveVolumeParams: effectiveVolumeParamsFromVolumeWitness(report.visualWitnessReport || {}),
    pipelineScheduler: pipelineSchedulerFromReport(report),
    scheduler: schedulerFromReport(report),
    routeTelemetry: routeTelemetryFromReport(report),
    backpressure: backpressureFromReport(report),
    optimization: optimizationFromReport(report),
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
