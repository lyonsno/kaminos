#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = 'kaminos.boundary-splat.live-union-occupancy.v0';
const SUPPORT_IDENTITY = 'full-flame-ridge-nonridge-live-union-v0';
const WITNESS_IDENTITY = 'two-anchor-live-union-census-v0';
const EXPECTED_INTEGRATION_HEAD = '8e68e8bbbe6564ed7c34d2a2c15a48a4e169396c';
const EXPECTED_TIGER_HEAD = '35e76f70';
const INTEGRATION_JOB_TYPE = 'kaminos_live_nonridge_union_witness';
const TIGER_JOB_TYPE = 'kaminos_layer_coefficient_live_union_witness';
const INTEGRATION_WITNESS = 'volume-live-nonridge-union-witness.mjs';
const TIGER_WITNESS = 'volume-layer-coefficient-live-union-witness.mjs';
const INTEGRATION_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const UNION_MODE = 'kernel_moment_full_flame_union';
const UNION_COMPOSITION = 'separate-ridge-nonridge-shared-total-extinction-v0';
const SELECTOR_AUTHORITY = 'explicit-source-field-operator-v0';
const SELECTOR_RECIPE_SHA256 = '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9';
const CANDIDATE_STRIDE_BYTES = 96;
const DRAW_STATE_BYTES = 80;

const args = parseArgs(process.argv.slice(2));
const integrationReportPath = stringArg('--integration-report');
const tigerReportPath = stringArg('--tiger-report');
const expectedIntegrationHead = stringArg('--expected-integration-head');
const expectedTigerHead = stringArg('--expected-tiger-head');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-two-anchor-live-union-census/report.json'));
const outDir = resolve(String(args.get('--out-dir') || dirname(reportPath)));
const runStartedAt = new Date().toISOString();
let failurePhase = 'argument-validation';
const lastTrustworthyEvidence = {};

try {
  if (!expectedIntegrationHead) throw new Error('missing-expected-integration-head');
  if (!expectedTigerHead) throw new Error('missing-expected-tiger-head');
  if (expectedIntegrationHead !== EXPECTED_INTEGRATION_HEAD) {
    throw new Error(`stale-integration-consumer-head:${JSON.stringify({ expectedIntegrationHead, required: EXPECTED_INTEGRATION_HEAD })}`);
  }
  if (expectedTigerHead !== EXPECTED_TIGER_HEAD) {
    throw new Error(`stale-tiger-consumer-head:${JSON.stringify({ expectedTigerHead, required: EXPECTED_TIGER_HEAD })}`);
  }
  if (!integrationReportPath) throw new Error('missing --integration-report');
  if (!tigerReportPath) throw new Error('missing --tiger-report');

  failurePhase = 'read-anchor-reports';
  const integrationSource = readJsonWithArtifact(integrationReportPath);
  const tigerSource = readJsonWithArtifact(tigerReportPath);
  lastTrustworthyEvidence.integrationReport = integrationSource.artifact;
  lastTrustworthyEvidence.tigerReport = tigerSource.artifact;

  failurePhase = 'normalize-integration-anchor';
  const integrationAnchor = normalizeIntegrationAnchor(integrationSource.json);
  lastTrustworthyEvidence.integrationAnchor = compactAnchor(integrationAnchor);

  failurePhase = 'normalize-tiger-imported-state-anchor';
  const tigerImportedStateAnchor = normalizeTigerImportedStateAnchor(tigerSource.json);
  lastTrustworthyEvidence.tigerImportedStateAnchor = compactAnchor(tigerImportedStateAnchor);

  failurePhase = 'two-anchor-false-closure-validation';
  const comparison = compareAnchors(integrationAnchor, tigerImportedStateAnchor);
  const report = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    status: 'captured',
    failurePhase: null,
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    supportIdentity: SUPPORT_IDENTITY,
    expectedIntegrationHead,
    expectedTigerHead,
    producerWitnesses: {
      integration: {
        jobType: INTEGRATION_JOB_TYPE,
        script: INTEGRATION_WITNESS,
        knownGoodLocalRunnerChecked: 'yes:operator-local integration runner with direct-route source binding',
        effectiveEnvDeviceBackendPreserved: 'Chrome --enable-unsafe-webgpu; backend WebGPU:apple; route native-3d-compute-fluid-raymarch-v0; no fallback accepted',
      },
      tiger: {
        jobType: TIGER_JOB_TYPE,
        script: TIGER_WITNESS,
        knownGoodLocalRunnerChecked: 'yes:operator-local Tiger exact imported-state runner',
        effectiveEnvDeviceBackendPreserved: 'Greenroom job kaminos_layer_coefficient_live_union_witness; backend WebGPU:apple; exact field import; no lookup miss/extra/overflow accepted',
      },
      sampleBoundarySplatLiveUnionOccupancyMissingIsNotBlocker: true,
      actualSurface: [
        'sampleBoundarySplatFootprintAudit',
        'sampleBoundarySplatGpuProfile',
        'boundarySplatUnionReceipt',
        'sampleFrame',
      ],
    },
    integrationAnchor,
    tigerImportedStateAnchor,
    comparison,
    falseClosureChecks: {
      fallbackRoute: false,
      overflowOrCopy: false,
      blankOrPartialReport: false,
      staleIntegrationConsumerHead: false,
      staleTigerConsumerHead: false,
      hiddenCapInstalled: false,
      unionCountMismatch: false,
    },
    claimBoundary: 'Two-anchor uncapped occupancy/cost normalization from producer-owned live union witnesses only. This does not choose pruning, merging, learned allocation, retraining, support, coefficient, covariance, or radiance policy.',
  };
  mkdirSync(outDir, { recursive: true });
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schema: SCHEMA,
    witnessIdentity: WITNESS_IDENTITY,
    status: 'failed-before-primary-output',
    failurePhase,
    runStartedAt,
    failedAt: new Date().toISOString(),
    supportIdentity: SUPPORT_IDENTITY,
    expectedIntegrationHead: expectedIntegrationHead || null,
    expectedTigerHead: expectedTigerHead || null,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    falseClosureChecks: {
      fallbackRoute: messageIncludes(error, 'fallbackRoute'),
      overflowOrCopy: messageIncludes(error, 'overflowOrCopy'),
      blankOrPartialReport: messageIncludes(error, 'blankOrPartialReport'),
      staleIntegrationConsumerHead: messageIncludes(error, 'stale-integration-consumer-head'),
      staleTigerConsumerHead: messageIncludes(error, 'stale-tiger-consumer-head'),
      hiddenCapInstalled: messageIncludes(error, 'hiddenCapInstalled'),
      unionCountMismatch: messageIncludes(error, 'unionCountMismatch'),
    },
  };
  mkdirSync(outDir, { recursive: true });
  writeReport(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

function normalizeIntegrationAnchor(report) {
  assert.equal(report.schema, 'kaminos.volume.live-nonridge-union-witness.v0', 'blankOrPartialReport: wrong Integration schema');
  assert.equal(report.status, 'captured', 'blankOrPartialReport: Integration witness did not capture');
  assert.equal(report.effectiveRoute, INTEGRATION_ROUTE, 'fallbackRoute: Integration effective route drifted');
  assert.equal(report.backend, 'WebGPU:apple', 'fallbackRoute: Integration backend drifted');
  const main = report.main || {};
  const receipt = main.receipt || {};
  const audit = main.audit || {};
  const counts = normalizedCounts(audit.decodedMembershipCounts || receipt.boundarySplatUnionReceipt?.counts);
  validateUnionCounts(counts);
  assert.equal(receipt.boundarySplatMode, UNION_MODE, 'fallbackRoute: Integration mode drifted');
  assert.equal(receipt.boundarySplatFallbackReason, null, 'fallbackRoute: Integration fallback route');
  assert.equal(audit.overflowCount, 0, 'overflowOrCopy: Integration overflow');
  assert.equal(audit.candidateCount, audit.instanceCount, 'hiddenCapInstalled: Integration candidate/instance mismatch');
  assert.equal(audit.candidateCount, counts.union, 'hiddenCapInstalled: Integration union count not fully rendered');
  assert.equal(audit.unionReceipt?.selectorAuthorityEffective, SELECTOR_AUTHORITY, 'fallbackRoute: Integration selector authority drifted');
  assert.equal(audit.unionReceipt?.selectorRecipeSha256, SELECTOR_RECIPE_SHA256, 'fallbackRoute: Integration selector recipe drifted');
  const gpuProfile = report.performance?.gpuProfile || receipt.boundarySplatGpuProfile || null;
  const projectionMetrics = audit.projectionMetrics || {};
  return {
    anchorId: 'integrationAnchor',
    anchorLabel: 'Integration small live anchor live-union-f137-s137',
    expectedHead: EXPECTED_INTEGRATION_HEAD,
    sourceCommit: report.source?.commit || 'db060b42c203188331d0ead73460896a230e4c18',
    requestedRoute: report.requestedUrl,
    effectiveRoute: report.effectiveRoute,
    backend: report.backend,
    routeIdentity: {
      requestedRoute: report.requestedUrl,
      effectiveRoute: report.effectiveRoute,
      backend: report.backend,
      renderer: receipt.boundarySplatRendererIdentity,
      mode: receipt.boundarySplatMode,
      supportIdentity: SUPPORT_IDENTITY,
      compositionIdentity: audit.unionReceipt?.compositionIdentity,
      coefficientIdentity: {
        ridge: audit.unionReceipt?.ridgeLayerIdentity,
        nonRidge: audit.unionReceipt?.nonRidgeLayerIdentity,
      },
      covarianceIdentity: receipt.flowKernelIdentity || 'kernel-moment-covariance',
      modelIdentity: receipt.boundarySplatAttributeModelIdentity,
      sourceAuthority: receipt.boundarySplatSourceAuthority,
      selectorAuthority: audit.unionReceipt?.selectorAuthorityEffective,
      selectorRecipeSha256: audit.unionReceipt?.selectorRecipeSha256,
    },
    layerCounts: counts,
    budgets: {
      requestedCandidateBudget: 'uncapped',
      effectiveCandidateBudget: counts.union,
      hiddenCapInstalled: false,
    },
    candidateCount: audit.candidateCount,
    instanceCount: audit.instanceCount,
    zeroGradientAdmissionCount: audit.unionReceipt?.zeroGradientAdmissionCount ?? receipt.boundarySplatZeroGradientAdmissionCount ?? null,
    capacity: audit.capacityAfterRetry ?? receipt.boundarySplatCapacity ?? null,
    overflowCount: audit.overflowCount,
    capacityRetryCount: audit.capacityRetryCount ?? receipt.boundarySplatCapacityRetryCount ?? null,
    stateWitnessSha256: audit.stateWitnessSha256,
    controlSha256: audit.controlSha256,
    stableNativeCellIdSha256: audit.stableNativeCellIdSha256,
    sourceFieldManifest: null,
    sourceHashes: null,
    timings: {
      selectorGpuMs: null,
      splatRasterGpuMs: stageMs(gpuProfile, 'splatRaster'),
      compactionGpuMs: stageMs(gpuProfile, 'compaction'),
      totalGpuMs: stageMs(gpuProfile, 'total'),
      browserWallMs: {
        mainRenderElapsedMs: report.performance?.mainRenderElapsedMs ?? null,
        mainAuditElapsedMs: report.performance?.mainAuditElapsedMs ?? null,
        zeroGradientRenderElapsedMs: report.performance?.zeroGradientRenderElapsedMs ?? null,
        restoredRenderElapsedMs: report.performance?.restoredRenderElapsedMs ?? null,
      },
      timingAuthority: gpuProfile ? 'boundarySplatGpuProfile' : 'browser-wall-performance-now',
    },
    projectedWork: projectedWorkFromAudit(audit),
    memory: memoryFromCapacity(audit.capacityAfterRetry ?? receipt.boundarySplatCapacity, CANDIDATE_STRIDE_BYTES),
    diagnostics: diagnosticsFromIntegration(report),
  };
}

function normalizeTigerImportedStateAnchor(report) {
  assert.equal(report.schema, 'kaminos.volume.layer-coefficient-live-union-witness.v0', 'blankOrPartialReport: wrong Tiger schema');
  assert.equal(report.status, 'captured', 'blankOrPartialReport: Tiger witness did not capture');
  assert.equal(report.route?.effectiveRoute, INTEGRATION_ROUTE, 'fallbackRoute: Tiger effective route drifted');
  assert.equal(report.route?.backend, 'WebGPU:apple', 'fallbackRoute: Tiger backend drifted');
  const analytical = (report.conditions || []).find(condition => condition.label === 'analytical-exact');
  assert.ok(analytical, 'blankOrPartialReport: Tiger analytical-exact condition missing');
  const populationAudit = analytical.populationAudit || {};
  const unionReceipt = populationAudit.unionReceipt || {};
  const counts = normalizedCounts(unionReceipt.counts || populationAudit.decodedMembershipCounts);
  validateUnionCounts(counts);
  assert.equal(unionReceipt.effectiveMode, UNION_MODE, 'fallbackRoute: Tiger union mode drifted');
  assert.equal(unionReceipt.selectorAuthorityEffective, SELECTOR_AUTHORITY, 'fallbackRoute: Tiger selector authority drifted');
  assert.equal(unionReceipt.selectorRecipeSha256, SELECTOR_RECIPE_SHA256, 'fallbackRoute: Tiger selector recipe drifted');
  assert.equal(unionReceipt.fallbackReason, null, 'fallbackRoute: Tiger fallback route');
  assert.equal(populationAudit.overflowCount, 0, 'overflowOrCopy: Tiger overflow');
  assert.equal(populationAudit.candidateCount, populationAudit.instanceCount, 'hiddenCapInstalled: Tiger candidate/instance mismatch');
  assert.equal(populationAudit.candidateCount, counts.union, 'hiddenCapInstalled: Tiger union count not fully rendered');
  const overlayConditions = (report.conditions || []).filter(condition => condition.overlay);
  for (const condition of overlayConditions) {
    const audit = condition.populationAudit || {};
    assert.equal(audit.lookupMissCount ?? 0, 0, `blankOrPartialReport: ${condition.label} lookup miss`);
    assert.equal(audit.lookupExtraCount ?? 0, 0, `blankOrPartialReport: ${condition.label} lookup extra`);
    assert.equal(audit.overflowCount ?? 0, 0, `overflowOrCopy: ${condition.label} overflow`);
  }
  return {
    anchorId: 'tigerImportedStateAnchor',
    anchorLabel: 'Tiger exact imported state-120 anchor',
    expectedHead: EXPECTED_TIGER_HEAD,
    sourceCommit: EXPECTED_TIGER_HEAD,
    requestedRoute: report.requestedUrl,
    effectiveRoute: report.route?.effectiveRoute,
    backend: report.route?.backend,
    routeIdentity: {
      requestedRoute: report.requestedUrl,
      effectiveRoute: report.route?.effectiveRoute,
      backend: report.route?.backend,
      renderer: 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0',
      mode: unionReceipt.effectiveMode,
      supportIdentity: SUPPORT_IDENTITY,
      compositionIdentity: unionReceipt.compositionIdentity,
      coefficientIdentity: {
        analytical: 'analytical-exact',
        baseline: report.overlays?.baseline?.identity ?? null,
        flow: report.overlays?.flow?.identity ?? null,
        ridge: unionReceipt.ridgeLayerIdentity,
        nonRidge: unionReceipt.nonRidgeLayerIdentity,
      },
      covarianceIdentity: 'kernel-moment-covariance',
      modelIdentity: 'exact-live-nonridge-union-coefficient-application',
      sourceAuthority: report.source?.importReceipt?.initializationAuthority ?? 'checksum-addressed-live-replay-resume-v0',
      selectorAuthority: unionReceipt.selectorAuthorityEffective,
      selectorRecipeSha256: unionReceipt.selectorRecipeSha256,
    },
    layerCounts: counts,
    budgets: {
      requestedCandidateBudget: 'uncapped',
      effectiveCandidateBudget: counts.union,
      hiddenCapInstalled: false,
    },
    candidateCount: populationAudit.candidateCount,
    instanceCount: populationAudit.instanceCount,
    zeroGradientAdmissionCount: unionReceipt.zeroGradientAdmissionCount,
    capacity: null,
    overflowCount: populationAudit.overflowCount,
    capacityRetryCount: null,
    stateWitnessSha256: report.source?.sameStateCaptureId ?? null,
    controlSha256: report.source?.captureReport?.sha256 ?? null,
    stableNativeCellIdSha256: populationAudit.stableNativeCellIdSha256,
    sourceFieldManifest: report.source?.fieldManifest ?? null,
    sourceHashes: report.source?.sourceHashes ?? null,
    timings: {
      selectorGpuMs: null,
      splatRasterGpuMs: null,
      compactionGpuMs: null,
      totalGpuMs: null,
      browserWallMs: null,
      timingAuthority: 'not-isolated-in-tiger-coefficient-witness',
    },
    projectedWork: projectedWorkFromCondition(analytical),
    memory: memoryFromCapacity(populationAudit.candidateCount, CANDIDATE_STRIDE_BYTES),
    diagnostics: diagnosticsFromTiger(report, analytical),
  };
}

function compareAnchors(integrationAnchor, tigerImportedStateAnchor) {
  const small = integrationAnchor.layerCounts.union;
  const large = tigerImportedStateAnchor.layerCounts.union;
  const populationRatio = large / small;
  const causalDifferences = [
    {
      field: 'grid/state',
      integration: integrationAnchor.anchorLabel,
      tiger: `${tigerImportedStateAnchor.anchorLabel}; sourceFieldManifest grid ${tigerImportedStateAnchor.sourceFieldManifest?.sha256 ? 'sha256-bound' : 'present'}`,
      interpretation: 'Tiger imports an exact held state-120 160^3 field; Integration small anchor is live-union-f137-s137 from the small producer witness route.',
    },
    {
      field: 'controlSha256',
      integration: integrationAnchor.controlSha256,
      tiger: tigerImportedStateAnchor.controlSha256,
      interpretation: 'Control/source hashes differ, so the population swing is not attributable to one shared frozen state.',
    },
    {
      field: 'stableNativeCellIdSha256',
      integration: integrationAnchor.stableNativeCellIdSha256,
      tiger: tigerImportedStateAnchor.stableNativeCellIdSha256,
      interpretation: 'Stable native-cell populations are distinct; count comparison must remain state-bound.',
    },
    {
      field: 'sourceHashes',
      integration: integrationAnchor.sourceHashes,
      tiger: tigerImportedStateAnchor.sourceHashes,
      interpretation: 'Tiger has checksum-bound imported fluid/front/boundary/majorant fields; Integration report does not expose equivalent full-field hashes.',
    },
  ];
  const unresolvedCausalDifference = 'Exact causal allocation of the 627x swing remains unresolved without a matched same-state route that feeds both anchors the same field/control packet. Current evidence binds the swing to different state/control/source-field regimes, not to a reduction-policy opportunity.';
  return {
    populationRatio,
    populationRatioRounded: Math.round(populationRatio),
    unionDelta: large - small,
    causalDifferences,
    unresolvedCausalDifference,
    reductionPolicyAllowed: false,
  };
}

function normalizedCounts(counts = {}) {
  return {
    ridgeOnly: finiteInteger(counts.ridgeOnly, 'ridgeOnly'),
    nonRidgeOnly: finiteInteger(counts.nonRidgeOnly, 'nonRidgeOnly'),
    overlap: finiteInteger(counts.overlap, 'overlap'),
    union: finiteInteger(counts.union, 'union'),
  };
}

function validateUnionCounts(counts) {
  if (counts.union !== counts.ridgeOnly + counts.nonRidgeOnly + counts.overlap) {
    throw new Error(`unionCountMismatch:${JSON.stringify(counts)}`);
  }
}

function projectedWorkFromAudit(audit = {}) {
  const projectionMetrics = audit.projectionMetrics || {};
  const descriptorFrameMetrics = audit.descriptorFrameMetrics || {};
  return {
    projectedFootprintPixels: projectionMetrics.projectedFootprintPixels ?? descriptorFrameMetrics.projectedFootprintPixels ?? null,
    meanDepthComplexity: projectionMetrics.meanDepthComplexity ?? descriptorFrameMetrics.meanDepthComplexity ?? null,
    peakDepthComplexity: projectionMetrics.peakDepthComplexity ?? descriptorFrameMetrics.peakDepthComplexity ?? null,
    totalSplatPixelWork: projectionMetrics.totalSplatPixelWork ?? descriptorFrameMetrics.totalSplatPixelWork ?? null,
    authority: projectionMetrics.projectedFootprintPixels == null
      ? 'not-exposed-by-landed-integration-report'
      : 'sampleBoundarySplatFootprintAudit.projectionMetrics',
  };
}

function projectedWorkFromCondition(condition = {}) {
  return {
    projectedFootprintPixels: null,
    meanDepthComplexity: null,
    peakDepthComplexity: null,
    totalSplatPixelWork: null,
    authority: 'not-exposed-by-tiger-coefficient-witness',
    visiblePixels: condition.metrics ?? null,
  };
}

function memoryFromCapacity(capacity, strideBytes) {
  const candidateRows = Number(capacity || 0);
  const candidateBufferBytes = candidateRows > 0 ? candidateRows * strideBytes : null;
  return {
    candidateBufferBytes,
    candidateBufferBytesAuthority: candidateBufferBytes == null
      ? 'not-exposed'
      : `derived-from-capacity-or-candidate-count-times-${strideBytes}-byte-live-union-candidate-stride`,
    peakGpuBufferBytes: candidateBufferBytes == null ? null : candidateBufferBytes + DRAW_STATE_BYTES,
    peakGpuBufferBytesAuthority: candidateBufferBytes == null
      ? 'not-exposed'
      : 'lower-bound-candidate-buffer-plus-draw-state-only',
  };
}

function diagnosticsFromIntegration(report) {
  return {
    fallbackReason: report.boundarySplatFallbackReason ?? report.main?.receipt?.boundarySplatFallbackReason ?? null,
    overflowCount: report.boundarySplatOverflowCount ?? report.main?.audit?.overflowCount ?? null,
    copyBytes: report.main?.receipt?.boundarySplatCopyBytesThisFrame ?? null,
    blankOutput: report.pixels?.visibleScreenshot?.nonblank === false,
    partialOutput: report.status !== 'captured',
    gpuProfilePresent: report.performance?.gpuProfile != null,
  };
}

function diagnosticsFromTiger(report, analytical) {
  return {
    fallbackReason: analytical?.populationAudit?.unionReceipt?.fallbackReason ?? null,
    overflowCount: analytical?.populationAudit?.overflowCount ?? null,
    copyBytes: null,
    blankOutput: analytical?.metrics?.nonblank === false,
    partialOutput: report.status !== 'captured',
    lookupMissCount: (report.conditions || []).reduce((max, condition) => Math.max(max, Number(condition.populationAudit?.lookupMissCount || 0)), 0),
    lookupExtraCount: (report.conditions || []).reduce((max, condition) => Math.max(max, Number(condition.populationAudit?.lookupExtraCount || 0)), 0),
  };
}

function stageMs(profile, stage) {
  return Number.isFinite(Number(profile?.stages?.[stage]?.ms)) ? Number(profile.stages[stage].ms) : null;
}

function compactAnchor(anchor) {
  return {
    anchorId: anchor.anchorId,
    union: anchor.layerCounts?.union,
    stableNativeCellIdSha256: anchor.stableNativeCellIdSha256,
    stateWitnessSha256: anchor.stateWitnessSha256,
    controlSha256: anchor.controlSha256,
  };
}

function finiteInteger(value, label) {
  const number = Number(value);
  assert.ok(Number.isInteger(number) && number >= 0, `blankOrPartialReport: ${label} is not a nonnegative integer`);
  return number;
}

function stringArg(name) {
  return args.has(name) ? String(args.get(name)).trim() : '';
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

function readJsonWithArtifact(path) {
  const resolved = resolve(path);
  const bytes = readFileSync(resolved);
  return {
    json: JSON.parse(bytes.toString('utf8')),
    artifact: {
      path: resolved,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function messageIncludes(error, token) {
  return String(error?.message || error || '').includes(token);
}
