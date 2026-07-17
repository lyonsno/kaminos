#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = 'kaminos.boundary-splat.authored-basin-projected-work.v0';
const WITNESS_IDENTITY = 'authored-basin-same-state-projected-work-v0';
const PROTOCOL_REF = 'operator-explored-splat-experiment-protocol';
const SUPPORT_IDENTITY = 'full-flame-ridge-nonridge-live-union-v0';
const UNION_MODE = 'kernel_moment_full_flame_union';
const SELECTOR_AUTHORITY = 'explicit-source-field-operator-v0';
const SELECTOR_RECIPE_SHA256 = '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9';
const CANDIDATE_STRIDE_BYTES = 96;
const DRAW_STATE_BYTES = 80;

const args = parseArgs(process.argv.slice(2));
const authoredBasinManifestPath = stringArg('--authored-basin-manifest');
const sampleReportPath = stringArg('--sample-report');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-authored-basin-projected-work'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const runStartedAt = new Date().toISOString();
let failurePhase = 'argument-validation';
const lastTrustworthyEvidence = {};

try {
  if (!authoredBasinManifestPath) throw new Error('missing-authored-basin-manifest');
  if (!sampleReportPath) throw new Error('missing-sample-report');

  failurePhase = 'read-inputs';
  const authoredSource = readJsonWithArtifact(authoredBasinManifestPath);
  const sampleSource = readJsonWithArtifact(sampleReportPath);
  lastTrustworthyEvidence.authoredBasinManifest = authoredSource.artifact;
  lastTrustworthyEvidence.sampleReport = sampleSource.artifact;

  failurePhase = 'normalize-authored-basin';
  const authoredBasin = normalizeAuthoredBasinManifest(authoredSource.json);
  lastTrustworthyEvidence.authoredBasin = compactIdentity(authoredBasin);

  failurePhase = 'normalize-sample-report';
  const sample = normalizeSampleReport(sampleSource.json);
  lastTrustworthyEvidence.sample = compactIdentity(sample);

  failurePhase = 'same-state-route-control-validation';
  validateSameStateRouteControl(authoredBasin, sample);

  failurePhase = 'projected-work-accounting-validation';
  const projectedWork = normalizeProjectedWork(sample);

  const report = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    protocolRef: PROTOCOL_REF,
    status: 'captured',
    failurePhase: null,
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    authoredBasin,
    sampleIdentity: sample.identity,
    sourceRowsPreserved: true,
    preserveAllSourceRows: true,
    budgets: {
      requestedCandidateBudget: 'uncapped',
      effectiveCandidateBudget: sample.counts.union,
      hiddenCapInstalled: false,
    },
    projectedWork,
    routeIdentity: sample.routeIdentity,
    supportIdentity: SUPPORT_IDENTITY,
    reductionPolicyAllowed: false,
    claimBoundary: 'Matched same-state, same-route, same-control projected-work accounting for an operator-authored production-basin anchor only. This preserves all source rows and does not choose a cap, pruning policy, membership retraining, product count, support, coefficient, covariance, or radiance policy.',
    falseClosureChecks: {
      fallbackRoute: false,
      overflowOrCopy: false,
      blankOrPartialReport: false,
      staleOrCachedOutput: false,
      sameStateIdentityMismatch: false,
      sameRouteIdentityMismatch: false,
      sameControlIdentityMismatch: false,
      hiddenCapInstalled: false,
    },
    lastTrustworthyEvidence,
  };
  mkdirSync(outDir, { recursive: true });
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    protocolRef: PROTOCOL_REF,
    status: 'failed-before-primary-output',
    failurePhase,
    runStartedAt,
    failedAt: new Date().toISOString(),
    authoredBasinManifestPath: authoredBasinManifestPath || null,
    sampleReportPath: sampleReportPath || null,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    falseClosureChecks: {
      fallbackRoute: messageIncludes(error, 'fallbackRoute'),
      overflowOrCopy: messageIncludes(error, 'overflowOrCopy'),
      blankOrPartialReport: messageIncludes(error, 'blankOrPartialReport'),
      staleOrCachedOutput: messageIncludes(error, 'staleOrCachedOutput'),
      sameStateIdentityMismatch: messageIncludes(error, 'sameStateIdentityMismatch'),
      sameRouteIdentityMismatch: messageIncludes(error, 'sameRouteIdentityMismatch'),
      sameControlIdentityMismatch: messageIncludes(error, 'sameControlIdentityMismatch'),
      hiddenCapInstalled: messageIncludes(error, 'hiddenCapInstalled'),
    },
    claimBoundary: 'Failure report only. No projected-work frontier, visual quality, reduction policy, or product count claim is authorized from this output.',
  };
  mkdirSync(outDir, { recursive: true });
  writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

function normalizeAuthoredBasinManifest(manifest) {
  const evidenceState = String(
    manifest.evidenceState
    || manifest.evidence?.state
    || manifest.status
    || manifest.capture?.status
    || '',
  );
  const operatorExplored = Boolean(
    manifest.operatorExplored
    || manifest.evidence?.operatorExplored
    || manifest.authoredFork
    || manifest.namedAuthoredFork
    || evidenceState === 'operator-explored'
    || evidenceState === 'decision-bearing',
  );
  if (!operatorExplored) {
    throw new Error('operator-authored-production-basin-anchor-missing: operatorExplored false');
  }

  const route = extractRoute(manifest);
  const stateIdentity = firstString(
    manifest.sameStateCaptureId,
    manifest.sourceState?.sameStateCaptureId,
    manifest.frozenState?.sameStateCaptureId,
    manifest.capture?.sameStateCaptureId,
    manifest.capture?.sourceState?.sameStateCaptureId,
  );
  const controlIdentity = firstString(
    manifest.effectiveControlIdentity,
    manifest.requestedControlIdentity,
    manifest.controlSha256,
    manifest.frozenState?.controlsHash,
    manifest.capture?.effectiveControlIdentity,
    manifest.capture?.requestedControlIdentity,
    manifest.capture?.controlsHash,
  );
  return {
    identity: firstString(manifest.identity, manifest.schema, 'authored-basin-manifest'),
    protocolRef: PROTOCOL_REF,
    evidenceState,
    operatorExplored,
    authoredFork: manifest.authoredFork || manifest.namedAuthoredFork || null,
    sameStateCaptureId: stateIdentity,
    route,
    controlIdentity,
    mutableControlAuthority: manifest.mutableControlAuthority || manifest.mutableAxes || null,
    lockedControlAuthority: manifest.lockedControlAuthority || manifest.lockedAxes || null,
  };
}

function normalizeSampleReport(report) {
  if (report.status !== 'captured' && report.status !== 'complete') {
    throw new Error(`blankOrPartialReport: sample status ${JSON.stringify(report.status)}`);
  }
  const schema = String(report.schema || '');
  if (schema === 'kaminos.volume.live-nonridge-union-witness.v0') return normalizeLiveUnionSample(report);
  if (schema === 'kaminos.boundary-splat.authored-basin-projected-work.sample.v0') return normalizeNativeProjectedWorkSample(report);
  throw new Error(`blankOrPartialReport: unsupported sample schema ${JSON.stringify(schema)}`);
}

function normalizeLiveUnionSample(report) {
  const main = report.main || {};
  const receipt = main.receipt || {};
  const audit = main.audit || {};
  const unionReceipt = audit.unionReceipt || receipt.boundarySplatUnionReceipt || {};
  const counts = normalizedCounts(audit.decodedMembershipCounts || unionReceipt.counts);
  validateUnionCounts(counts);
  assert.equal(receipt.boundarySplatMode || unionReceipt.effectiveMode, UNION_MODE, 'fallbackRoute: union mode drifted');
  assert.equal(receipt.boundarySplatFallbackReason ?? unionReceipt.fallbackReason ?? null, null, 'fallbackRoute: sample fallback route');
  assert.equal(audit.overflowCount ?? 0, 0, 'overflowOrCopy: sample overflow');
  assert.equal(Number(audit.candidateCount), Number(audit.instanceCount), 'hiddenCapInstalled: sample candidate/instance mismatch');
  assert.equal(Number(audit.candidateCount), counts.union, 'hiddenCapInstalled: sample union count not fully rendered');
  assert.equal(unionReceipt.selectorAuthorityEffective, SELECTOR_AUTHORITY, 'fallbackRoute: selector authority drifted');
  assert.equal(unionReceipt.selectorRecipeSha256, SELECTOR_RECIPE_SHA256, 'fallbackRoute: selector recipe drifted');
  const route = {
    requestedRoute: report.requestedUrl,
    effectiveRoute: report.effectiveRoute,
    backend: report.backend,
  };
  return {
    identity: {
      schema: report.schema,
      sameStateCaptureId: firstString(report.sameStateCaptureId, receipt.sameStateCaptureId, audit.sameStateCaptureId),
      stateWitnessSha256: audit.stateWitnessSha256,
      controlIdentity: audit.controlSha256,
      route,
      renderer: receipt.boundarySplatRendererIdentity,
      supportIdentity: SUPPORT_IDENTITY,
      coefficientIdentity: {
        ridge: unionReceipt.ridgeLayerIdentity,
        nonRidge: unionReceipt.nonRidgeLayerIdentity,
      },
      covarianceIdentity: receipt.flowKernelIdentity || 'kernel-moment-covariance',
    },
    routeIdentity: {
      ...route,
      renderer: receipt.boundarySplatRendererIdentity,
      mode: receipt.boundarySplatMode,
      supportIdentity: SUPPORT_IDENTITY,
      compositionIdentity: unionReceipt.compositionIdentity,
      coefficientIdentity: {
        ridge: unionReceipt.ridgeLayerIdentity,
        nonRidge: unionReceipt.nonRidgeLayerIdentity,
      },
      covarianceIdentity: receipt.flowKernelIdentity || 'kernel-moment-covariance',
      sourceAuthority: receipt.boundarySplatSourceAuthority,
      selectorAuthority: unionReceipt.selectorAuthorityEffective,
      selectorRecipeSha256: unionReceipt.selectorRecipeSha256,
    },
    counts,
    projectionMetrics: audit.projectionMetrics || {},
    descriptorFrameMetrics: audit.descriptorFrameMetrics || {},
    gpuProfile: report.performance?.gpuProfile || receipt.boundarySplatGpuProfile || null,
    performance: report.performance || {},
    memoryBasis: {
      candidateRows: audit.capacityAfterRetry ?? receipt.boundarySplatCapacity ?? counts.union,
      sourceRows: audit.candidateCount ?? counts.union,
    },
    diagnostics: {
      fallbackReason: receipt.boundarySplatFallbackReason ?? unionReceipt.fallbackReason ?? null,
      overflowCount: audit.overflowCount ?? null,
      copyBytes: receipt.boundarySplatCopyBytesThisFrame ?? report.boundarySplatCopyBytesThisFrame ?? null,
      blankOutput: report.pixels?.visibleScreenshot?.nonblank === false || report.pixels?.nonblank === false,
      partialOutput: report.status !== 'captured',
    },
  };
}

function normalizeNativeProjectedWorkSample(report) {
  const counts = normalizedCounts(report.counts || report.layerCounts);
  validateUnionCounts(counts);
  return {
    identity: report.identity || {},
    routeIdentity: report.routeIdentity || {},
    counts,
    projectionMetrics: report.projectedWork || {},
    descriptorFrameMetrics: {},
    gpuProfile: report.gpuProfile || null,
    performance: report.performance || {},
    memoryBasis: report.memoryBasis || { candidateRows: counts.union, sourceRows: counts.union },
    diagnostics: report.diagnostics || {},
  };
}

function validateSameStateRouteControl(authoredBasin, sample) {
  const sampleIdentity = sample.identity || {};
  if (!authoredBasin.sameStateCaptureId || !sampleIdentity.sameStateCaptureId) {
    throw new Error('sameStateIdentityMismatch: missing same-state identity');
  }
  if (authoredBasin.sameStateCaptureId !== sampleIdentity.sameStateCaptureId) {
    throw new Error(`sameStateIdentityMismatch:${JSON.stringify({
      authored: authoredBasin.sameStateCaptureId,
      sample: sampleIdentity.sameStateCaptureId,
    })}`);
  }
  if (!authoredBasin.route?.effectiveRoute || !sampleIdentity.route?.effectiveRoute) {
    throw new Error('sameRouteIdentityMismatch: missing effective route identity');
  }
  if (authoredBasin.route.effectiveRoute !== sampleIdentity.route.effectiveRoute) {
    throw new Error(`sameRouteIdentityMismatch:${JSON.stringify({
      authored: authoredBasin.route.effectiveRoute,
      sample: sampleIdentity.route.effectiveRoute,
    })}`);
  }
  if (!authoredBasin.controlIdentity || !sampleIdentity.controlIdentity) {
    throw new Error('sameControlIdentityMismatch: missing control identity');
  }
  if (authoredBasin.controlIdentity !== sampleIdentity.controlIdentity) {
    throw new Error(`sameControlIdentityMismatch:${JSON.stringify({
      authored: authoredBasin.controlIdentity,
      sample: sampleIdentity.controlIdentity,
    })}`);
  }
  if (sample.diagnostics?.fallbackReason) throw new Error(`fallbackRoute:${sample.diagnostics.fallbackReason}`);
  if (Number(sample.diagnostics?.overflowCount || 0) !== 0 || Number(sample.diagnostics?.copyBytes || 0) !== 0) {
    throw new Error(`overflowOrCopy:${JSON.stringify(sample.diagnostics)}`);
  }
  if (sample.diagnostics?.blankOutput || sample.diagnostics?.partialOutput) {
    throw new Error(`blankOrPartialReport:${JSON.stringify(sample.diagnostics)}`);
  }
}

function normalizeProjectedWork(sample) {
  const metrics = {
    ...sample.descriptorFrameMetrics,
    ...sample.projectionMetrics,
  };
  const projectedSurvivors = finitePositiveInteger(
    metrics.projectedSurvivors ?? metrics.positiveClipWCount ?? metrics.centerInFrustumCount ?? sample.counts.union,
    'projectedSurvivors',
  );
  const footprintIntersections = finiteNonnegativeNumber(
    metrics.footprintIntersections ?? metrics.projectedFootprintPixels,
    'footprintIntersections',
  );
  const fragmentWork = finiteNonnegativeNumber(
    metrics.fragmentWork ?? metrics.totalSplatPixelWork ?? metrics.projectedFootprintPixels,
    'fragmentWork',
  );
  const overlap = {
    mean: finiteNonnegativeNumber(metrics.meanOverlap ?? metrics.meanDepthComplexity, 'overlap.mean'),
    median: nullableNonnegativeNumber(metrics.medianOverlap ?? metrics.medianDepthComplexity),
    p95: nullableNonnegativeNumber(metrics.p95Overlap ?? metrics.p95DepthComplexity),
    max: finiteNonnegativeNumber(metrics.maxOverlap ?? metrics.peakDepthComplexity, 'overlap.max'),
  };
  const depthBinOccupancy = normalizeDepthBinOccupancy(metrics.depthBinOccupancy || metrics.depthBins);
  const gpuProfile = sample.gpuProfile || {};
  const sortCost = normalizeCost(
    metrics.sortCost || metrics.sort || gpuProfile.stages?.sort,
    'sortCost',
    { allowedMissing: false },
  );
  const accumulationCost = normalizeCost(
    metrics.accumulationCost || metrics.accumulation || gpuProfile.stages?.splatRaster,
    'accumulationCost',
    { allowedMissing: false },
  );
  const buildCost = normalizeCost(
    metrics.buildCost || metrics.build || gpuProfile.stages?.compaction,
    'buildCost',
    { allowedMissing: false },
  );
  const renderCost = normalizeCost(
    metrics.renderCost || metrics.render || gpuProfile.stages?.total || gpuProfile.stages?.splatRaster,
    'renderCost',
    { allowedMissing: false },
  );
  const reuseCadence = normalizeReuseCadence(metrics.reuseCadence || sample.performance?.reuseCadence);
  const memory = normalizeMemory(sample.memoryBasis, metrics.memory);

  return {
    projectedSurvivors,
    footprintIntersections,
    fragmentWork,
    overlap,
    depthBinOccupancy,
    sortCost,
    accumulationCost,
    memory,
    buildCost,
    renderCost,
    reuseCadence,
    authority: metrics.authority || 'sample-report-projected-work-accounting',
  };
}

function normalizeDepthBinOccupancy(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('missing-projected-work-accounting: depthBinOccupancy');
  }
  return {
    binCount: finitePositiveInteger(value.binCount ?? value.depthBinCount, 'depthBinOccupancy.binCount'),
    occupiedBins: finiteNonnegativeNumber(value.occupiedBins, 'depthBinOccupancy.occupiedBins'),
    meanEntriesPerOccupiedBin: finiteNonnegativeNumber(value.meanEntriesPerOccupiedBin, 'depthBinOccupancy.meanEntriesPerOccupiedBin'),
    p95EntriesPerOccupiedBin: nullableNonnegativeNumber(value.p95EntriesPerOccupiedBin),
    maxEntriesPerOccupiedBin: finiteNonnegativeNumber(value.maxEntriesPerOccupiedBin, 'depthBinOccupancy.maxEntriesPerOccupiedBin'),
    authority: value.authority || 'depth-bin-occupancy',
  };
}

function normalizeCost(value, label, { allowedMissing }) {
  if (!value || typeof value !== 'object') {
    if (allowedMissing) return { ms: null, authority: 'not-exposed' };
    throw new Error(`missing-projected-work-accounting: ${label}`);
  }
  const ms = finiteNonnegativeNumber(value.ms ?? value.medianMs ?? value.totalMs, `${label}.ms`);
  return {
    ms,
    authority: value.authority || value.status || 'sample-report',
    disposition: value.disposition || null,
  };
}

function normalizeReuseCadence(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('missing-projected-work-accounting: reuseCadence');
  }
  return {
    sourceRowsPreserved: value.sourceRowsPreserved !== false,
    sourceReusedAcrossFrames: Boolean(value.sourceReusedAcrossFrames),
    rebuildEveryFrame: Boolean(value.rebuildEveryFrame),
    updateCadenceFrames: finitePositiveInteger(value.updateCadenceFrames ?? 1, 'reuseCadence.updateCadenceFrames'),
    authority: value.authority || 'sample-report-reuse-cadence',
  };
}

function normalizeMemory(memoryBasis = {}, explicit = {}) {
  const sourceRows = finitePositiveInteger(memoryBasis.sourceRows ?? memoryBasis.candidateRows, 'memory.sourceRows');
  const candidateRows = finitePositiveInteger(memoryBasis.candidateRows ?? sourceRows, 'memory.candidateRows');
  const candidateBufferBytes = Number(explicit.candidateBufferBytes ?? candidateRows * CANDIDATE_STRIDE_BYTES);
  return {
    sourceRows,
    candidateRows,
    candidateBufferBytes: finitePositiveInteger(candidateBufferBytes, 'memory.candidateBufferBytes'),
    candidateBufferBytesAuthority: explicit.candidateBufferBytesAuthority || `candidateRows-times-${CANDIDATE_STRIDE_BYTES}-byte-live-union-candidate-stride`,
    peakGpuBufferBytes: finitePositiveInteger(explicit.peakGpuBufferBytes ?? candidateBufferBytes + DRAW_STATE_BYTES, 'memory.peakGpuBufferBytes'),
    peakGpuBufferBytesAuthority: explicit.peakGpuBufferBytesAuthority || 'candidate-buffer-plus-draw-state-lower-bound',
  };
}

function extractRoute(value = {}) {
  const route = value.route || value.requestedRoute || value.capture?.route || value.capture?.requestedRoute || {};
  if (typeof route === 'string') {
    return {
      requestedRoute: route,
      effectiveRoute: firstString(value.effectiveRoute, value.route?.effective, value.capture?.effectiveRoute),
      backend: firstString(value.backend, value.route?.backend, value.capture?.backend),
    };
  }
  return {
    requestedRoute: firstString(route.requested, route.requestedRoute, value.href, value.sourceHref, value.capture?.sourceHref),
    effectiveRoute: firstString(route.effective, route.effectiveRoute, value.effectiveRoute, value.capture?.effectiveRoute),
    backend: firstString(route.backend, value.backend, value.capture?.backend),
  };
}

function normalizedCounts(counts = {}) {
  return {
    ridgeOnly: finiteNonnegativeInteger(counts.ridgeOnly, 'ridgeOnly'),
    nonRidgeOnly: finiteNonnegativeInteger(counts.nonRidgeOnly, 'nonRidgeOnly'),
    overlap: finiteNonnegativeInteger(counts.overlap, 'overlap'),
    union: finiteNonnegativeInteger(counts.union, 'union'),
  };
}

function validateUnionCounts(counts) {
  if (counts.union !== counts.ridgeOnly + counts.nonRidgeOnly + counts.overlap) {
    throw new Error(`unionCountMismatch:${JSON.stringify(counts)}`);
  }
}

function finitePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`missing-projected-work-accounting: ${label}`);
  }
  return number;
}

function finiteNonnegativeInteger(value, label) {
  const number = Number(value);
  assert.ok(Number.isInteger(number) && number >= 0, `blankOrPartialReport: ${label} is not a nonnegative integer`);
  return number;
}

function finiteNonnegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`missing-projected-work-accounting: ${label}`);
  }
  return number;
}

function nullableNonnegativeNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compactIdentity(value = {}) {
  return {
    identity: value.identity,
    sameStateCaptureId: value.sameStateCaptureId ?? value.identity?.sameStateCaptureId ?? null,
    controlIdentity: value.controlIdentity ?? value.identity?.controlIdentity ?? null,
    route: value.route ?? value.identity?.route ?? null,
  };
}

function readJsonWithArtifact(path) {
  const resolved = resolve(path);
  const raw = readFileSync(resolved, 'utf8');
  const json = JSON.parse(raw);
  return {
    json,
    artifact: {
      path: resolved,
      byteLength: Buffer.byteLength(raw),
    },
  };
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed.set(key, '1');
    else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function stringArg(name) {
  return args.has(name) ? String(args.get(name)).trim() : '';
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function messageIncludes(error, text) {
  return String(error?.message || error || '').includes(text);
}
