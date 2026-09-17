/**
 * kiln-moge-route-activity.mjs — convert a MoGe WebGPU route result
 * (kaminos.webgpu-route-result.v0, receipt kaminos.webgpu-route-receipt.v0)
 * into kiln route-activity fuel (kaminos.kiln.route-activity.v0) for the
 * volume fire bridge.
 *
 * Truth mapping is conservative and receipt-derived:
 *   - live burn requires real weights and no fallback reason; a hash-less
 *     browser receipt ('partial' from missing hashes alone) stays live but
 *     carries a custody warning and weaker custody strength;
 *   - stub/fallback/cached runs can never claim live-compute or full burn;
 *   - a requested-but-unverified cooperative scheduler is flagged, not fatal.
 */

export const KILN_MOGE_ROUTE_ACTIVITY_SCHEMA = 'kaminos.kiln.route-activity.v0';
const MOGE_ROUTE_RESULT_SCHEMA = 'kaminos.webgpu-route-result.v0';
const MOGE_ROUTE_RECEIPT_SCHEMA = 'kaminos.webgpu-route-receipt.v0';

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

export function routeActivityFromMogeRouteResult(routeResult) {
  if (!routeResult || typeof routeResult !== 'object') {
    throw new Error('routeActivityFromMogeRouteResult requires a moge route result object');
  }
  if (routeResult.schema !== MOGE_ROUTE_RESULT_SCHEMA) {
    throw new Error(`unexpected route result schema: ${routeResult.schema}`);
  }
  const receipt = routeResult.receipt;
  if (!receipt || receipt.schema !== MOGE_ROUTE_RECEIPT_SCHEMA) {
    throw new Error(`unexpected route receipt schema: ${receipt?.schema}`);
  }

  const warnings = [];
  const weights = receipt.runtimeEvidence?.weights ?? 'unknown';
  const fallbackReason = receipt.fallbackReason || null;
  const stub = weights !== 'real';
  const hashless = !stub && !fallbackReason && receipt.status === 'partial';
  const live = !stub && !fallbackReason && (receipt.status === 'real' || hashless);

  let truthMode;
  if (live) {
    truthMode = 'live';
  } else if (stub) {
    truthMode = 'fixture';
    warnings.push('moge_stub_weights_not_live');
  } else if (receipt.status === 'cached') {
    truthMode = 'cached';
  } else if (receipt.status === 'fallback' || fallbackReason) {
    truthMode = 'fallback';
    warnings.push('moge_fallback_route_not_live');
  } else {
    truthMode = 'partial';
  }
  if (hashless) warnings.push('moge_artifact_hashes_missing_browser_runtime');

  const schedulerVerification = receipt.runtime?.schedulerVerification || null;
  const cooperativeRequested =
    receipt.runtime?.scheduler?.requestedScheduler?.mode === 'cooperative';
  if (cooperativeRequested && schedulerVerification?.status !== 'verified') {
    warnings.push('moge_cooperative_scheduling_unverified');
  }

  const visualAuthority = live ? 'live-compute' : 'projection';
  const custodyStrength = live ? (hashless ? 0.6 : 0.8) : 0.2;
  const outputSlots = arrayOrEmpty(receipt.outputs).map(output => ({
    role: output.role,
    artifactId: output.artifactId,
    status: output.status || receipt.status,
  }));

  return {
    schema: KILN_MOGE_ROUTE_ACTIVITY_SCHEMA,
    activityId: `${routeResult.requestId || 'moge-run'}-route-activity`,
    routeRunId: routeResult.requestId || null,
    activityState: live ? 'burning' : (stub ? 'fixture' : receipt.status || 'unknown'),
    routePhase: 'running',
    truthMode,
    visualAuthority,
    requestedRoute: receipt.requestedRouteId || routeResult.routeId || null,
    effectiveRoute: receipt.effectiveRouteId || null,
    backendClass: receipt.backend?.kind === 'webgpu-local' ? 'browser-webgpu' : (receipt.backend?.kind || null),
    receiptId: routeResult.requestId || null,
    sourceArtifactIds: arrayOrEmpty(receipt.inputs).map(input => input.artifactId).filter(Boolean),
    conditioningArtifactIds: [],
    outputSlots,
    sourceTruthWarnings: warnings,
    falseAuthorityViolations: [],
    fire: {
      heatClass: live ? 'burn' : (stub ? 'pilot' : 'ember'),
      fuelClass: 'local-webgpu',
      truthClass: truthMode,
      visualAuthority,
      allowsFullBurn: live,
      spendIntensity: live ? 1 : 0.2,
      custodyStrength,
      failureSharpness: 0,
      cacheWarmth: truthMode === 'cached' ? 1 : 0,
      outputSlotCount: outputSlots.length,
      warningLoad: warnings.length,
    },
    mogeEvidence: {
      receiptStatus: receipt.status,
      weights,
      schedulerVerificationStatus: schedulerVerification?.status ?? null,
      schedulerClassification: schedulerVerification?.classification ?? null,
      timingSource: receipt.timings?.source ?? null,
      totalMs: receipt.timings?.totalMs ?? null,
      modelId: receipt.model?.id ?? null,
      adapterName: receipt.backend?.adapterName ?? null,
    },
  };
}
