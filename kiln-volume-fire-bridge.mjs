import {
  BEAMING_KILN_VOLUME_BACKEND_ID,
  KAMINOS_ROUTE_ACTIVITY_SCHEMA,
  deriveKilnVolumeFireVisual,
} from './kiln-volume-fire-adapter.mjs';

export const BEAMING_KILN_VOLUME_BRIDGE_SCHEMA = 'beaming.volume-fire.route-activity-bridge.v0';
export const BEAMING_KILN_VOLUME_WITNESS_SCHEMA = 'beaming.volume-fire.route-activity-witness.v0';

export function bridgeKilnRouteRunToVolumeFire(routeRun = {}, options = {}) {
  const sourceRouteActivity = normalizeRouteActivity(routeRun);
  const visualReceipt = deriveKilnVolumeFireVisual(sourceRouteActivity, options.visualOptions || {});
  const routeRunId = sourceRouteActivity.routeRunId || routeRun.runId || null;
  const falseAuthorityViolations = [
    ...prefixViolations(sourceRouteActivity.falseAuthorityViolations),
    ...visualReceipt.falseAuthorityViolations,
  ];
  const truthWarnings = unique([
    ...arrayOrEmpty(routeRun.sourceTruthWarnings),
    ...arrayOrEmpty(sourceRouteActivity.sourceTruthWarnings),
    ...visualReceipt.truthWarnings,
  ]);

  return {
    schema: BEAMING_KILN_VOLUME_BRIDGE_SCHEMA,
    visualBackendId: BEAMING_KILN_VOLUME_BACKEND_ID,
    routeRunSchema: routeRun.schema || null,
    routeActivitySchema: sourceRouteActivity.schema || KAMINOS_ROUTE_ACTIVITY_SCHEMA,
    routeRunId,
    routeActivityId: sourceRouteActivity.activityId || null,
    activityState: sourceRouteActivity.activityState || null,
    routePhase: sourceRouteActivity.routePhase || routeRun.routePhase || null,
    truthMode: sourceRouteActivity.truthMode || null,
    visualAuthority: sourceRouteActivity.visualAuthority || null,
    heatClass: sourceRouteActivity.fire?.heatClass || null,
    displayAuthority: displayAuthorityFor(visualReceipt),
    routeIdentity: {
      requestedRoute: sourceRouteActivity.requestedRoute ?? routeRun.requestedRoute ?? null,
      effectiveRoute: sourceRouteActivity.effectiveRoute ?? routeRun.effectiveRoute ?? null,
      backendClass: sourceRouteActivity.backendClass ?? routeRun.backendClass ?? null,
      receiptId: sourceRouteActivity.receiptId ?? routeRun.receiptId ?? null,
      sourceArtifactIds: arrayOrEmpty(sourceRouteActivity.sourceArtifactIds),
      conditioningArtifactIds: arrayOrEmpty(sourceRouteActivity.conditioningArtifactIds),
    },
    outputSlots: arrayOrEmpty(sourceRouteActivity.outputSlots),
    truthWarnings,
    falseAuthorityViolations,
    sourceRouteActivity,
    visualReceipt,
  };
}

export function buildKilnVolumeFireWitness({ witnessId = null, routeRuns = [] } = {}) {
  const bridges = routeRuns.map(routeRun => bridgeKilnRouteRunToVolumeFire(routeRun));
  const falseAuthorityViolations = [];
  const truthWarnings = [];
  const phaseCounts = {};
  const truthModeCounts = {};
  let fullBurnCount = 0;
  let enabledCount = 0;

  for (const bridge of bridges) {
    increment(phaseCounts, bridge.visualReceipt.visualPhase || 'unknown');
    increment(truthModeCounts, bridge.truthMode || 'unknown');
    if (bridge.visualReceipt.allowsFullBurn) fullBurnCount++;
    if (bridge.visualReceipt.enabled) enabledCount++;
    for (const violation of bridge.falseAuthorityViolations) {
      falseAuthorityViolations.push(`${bridge.routeRunId || 'unknown'}:${violation}`);
    }
    truthWarnings.push(...bridge.truthWarnings);
  }

  return {
    schema: BEAMING_KILN_VOLUME_WITNESS_SCHEMA,
    witnessId,
    visualBackendId: BEAMING_KILN_VOLUME_BACKEND_ID,
    bridgeSchema: BEAMING_KILN_VOLUME_BRIDGE_SCHEMA,
    routeRunCount: bridges.length,
    fullBurnCount,
    enabledCount,
    phaseCounts,
    truthModeCounts,
    truthWarnings: unique(truthWarnings),
    falseAuthorityViolations: unique(falseAuthorityViolations),
    primaryBridge: primaryBridgeFor(bridges),
    bridges,
  };
}

function normalizeRouteActivity(routeRun) {
  const activity = routeRun?.routeActivity || routeRun || {};
  return {
    schema: activity.schema || KAMINOS_ROUTE_ACTIVITY_SCHEMA,
    activityId: activity.activityId || null,
    routeRunId: activity.routeRunId || routeRun.runId || null,
    activityState: activity.activityState || routeRun.kilnActivity?.activityState || null,
    routePhase: activity.routePhase || routeRun.routePhase || null,
    truthMode: activity.truthMode || routeRun.kilnActivity?.truthMode || null,
    visualAuthority: activity.visualAuthority || routeRun.kilnActivity?.visualAuthority || null,
    requestedRoute: activity.requestedRoute ?? routeRun.requestedRoute ?? null,
    effectiveRoute: activity.effectiveRoute ?? routeRun.effectiveRoute ?? null,
    backendClass: activity.backendClass ?? routeRun.backendClass ?? null,
    receiptId: activity.receiptId ?? routeRun.receiptId ?? null,
    sourceArtifactIds: arrayOrEmpty(activity.sourceArtifactIds || routeRun.inputArtifactIds),
    conditioningArtifactIds: arrayOrEmpty(activity.conditioningArtifactIds || routeRun.conditioningArtifactIds),
    outputSlots: arrayOrEmpty(activity.outputSlots || routeRun.outputArtifactIds?.map(artifactId => ({
      role: 'output',
      artifactId,
      status: 'pending',
    }))),
    sourceTruthWarnings: unique([
      ...arrayOrEmpty(routeRun.sourceTruthWarnings),
      ...arrayOrEmpty(activity.sourceTruthWarnings),
      ...arrayOrEmpty(routeRun.kilnActivity?.sourceTruthWarnings),
    ]),
    falseAuthorityViolations: arrayOrEmpty(activity.falseAuthorityViolations),
    fire: activity.fire || fireFromKilnActivity(routeRun.kilnActivity),
  };
}

function fireFromKilnActivity(kilnActivity = {}) {
  return {
    heatClass: heatClassFromAuthority(kilnActivity.visualAuthority),
    fuelClass: 'unknown',
    truthClass: kilnActivity.truthMode || 'unavailable',
    visualAuthority: kilnActivity.visualAuthority || 'none',
    allowsFullBurn: kilnActivity.allowsFullBurn === true,
    spendIntensity: kilnActivity.allowsFullBurn === true ? 1 : 0,
    custodyStrength: kilnActivity.truthMode === 'live' ? 0.8 : 0,
    failureSharpness: kilnActivity.truthMode === 'failed' ? 1 : 0,
    cacheWarmth: kilnActivity.truthMode === 'cached' ? 0.8 : 0,
    outputSlotCount: 0,
    warningLoad: arrayOrEmpty(kilnActivity.sourceTruthWarnings).length,
  };
}

function heatClassFromAuthority(visualAuthority) {
  if (visualAuthority === 'live-compute') return 'burn';
  if (visualAuthority === 'preheat' || visualAuthority === 'low-heat') return 'preheat';
  if (visualAuthority === 'coals-settling') return 'bank';
  if (visualAuthority === 'settled-output') return 'cooled';
  if (visualAuthority === 'warm-recall') return 'glow';
  if (visualAuthority === 'demo-fixture') return 'pilot';
  if (visualAuthority === 'degraded-fallback') return 'weak-heat';
  if (visualAuthority === 'partial-output') return 'ember';
  if (visualAuthority === 'failure-snuff') return 'snuff';
  return 'cold';
}

function displayAuthorityFor(visualReceipt) {
  return `${visualReceipt.visualAuthority || 'none'} ${visualReceipt.visualPhase || 'cold'}`.trim();
}

function primaryBridgeFor(bridges) {
  const fullBurn = bridges.find(bridge => bridge.visualReceipt.allowsFullBurn);
  if (fullBurn) return fullBurn;
  const enabled = bridges.find(bridge => bridge.visualReceipt.enabled);
  return enabled || bridges[0] || null;
}

function prefixViolations(violations) {
  return arrayOrEmpty(violations).map(violation => `route_activity:${violation}`);
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? [...value] : [];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(value => String(value)))];
}
