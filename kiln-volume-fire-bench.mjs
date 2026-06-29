import { KAMINOS_ROUTE_ACTIVITY_SCHEMA } from './kiln-volume-fire-adapter.mjs';
import {
  BEAMING_KILN_VOLUME_WITNESS_SCHEMA,
  buildKilnVolumeFireWitness,
} from './kiln-volume-fire-bridge.mjs';

export const BEAMING_KILN_ROUTE_FIRE_BENCH_SCHEMA = 'beaming.volume-fire.route-activity-bench.v0';
export const BEAMING_KILN_ROUTE_FIRE_ACCEPTANCE_SURFACE = 'beaming-volume-witness-current-renderer';
export const BEAMING_KILN_ROUTE_FIRE_DEFAULT_EVIDENCE_MODE = 'performance';
export const BEAMING_KILN_ROUTE_FIRE_FIXTURE_ID = 'wake-route-activity-bridge-fixture-v0';

export function buildKilnVolumeFireBenchModel({
  baseUrl = 'http://127.0.0.1:8095/',
  witnessId = 'route-tray-fire-bench-001',
  evidenceMode = BEAMING_KILN_ROUTE_FIRE_DEFAULT_EVIDENCE_MODE,
} = {}) {
  const witness = buildKilnVolumeFireWitness({
    witnessId,
    routeRuns: fixtureRouteRuns(),
  });
  const primaryBridge = witness.primaryBridge;
  const launchUrl = volumeUrlForBridge(primaryBridge, baseUrl);
  const routeRows = witness.bridges.map(bridge => ({
    routeRunId: bridge.routeRunId,
    routeActivityId: bridge.routeActivityId,
    routeActivitySchema: bridge.routeActivitySchema,
    requestedRoute: bridge.routeIdentity.requestedRoute,
    effectiveRoute: bridge.routeIdentity.effectiveRoute,
    backendClass: bridge.routeIdentity.backendClass,
    receiptId: bridge.routeIdentity.receiptId,
    truthMode: bridge.truthMode,
    visualAuthority: bridge.visualAuthority,
    visualPhase: bridge.visualReceipt.visualPhase,
    allowsFullBurn: bridge.visualReceipt.allowsFullBurn,
    enabled: bridge.visualReceipt.enabled,
    falseAuthorityViolations: bridge.falseAuthorityViolations,
    truthWarnings: bridge.truthWarnings,
  }));

  return {
    schema: BEAMING_KILN_ROUTE_FIRE_BENCH_SCHEMA,
    fixtureId: BEAMING_KILN_ROUTE_FIRE_FIXTURE_ID,
    acceptanceSurface: BEAMING_KILN_ROUTE_FIRE_ACCEPTANCE_SURFACE,
    evidenceMode,
    routeActivitySchema: KAMINOS_ROUTE_ACTIVITY_SCHEMA,
    witnessSchema: BEAMING_KILN_VOLUME_WITNESS_SCHEMA,
    visualBackendId: witness.visualBackendId,
    launchUrl,
    primaryBridge,
    routeRows,
    truthWarnings: witness.truthWarnings,
    falseAuthorityViolations: witness.falseAuthorityViolations,
    witness,
  };
}

export function volumeUrlForBridge(bridge, baseUrl = 'http://127.0.0.1:8095/') {
  const url = new URL(baseUrl);
  const params = bridge?.visualReceipt?.volumeParams || {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function routeActivity(overrides = {}) {
  const fire = {
    heatClass: 'burn',
    fuelClass: 'local-webgpu',
    truthClass: 'live',
    visualAuthority: 'live-compute',
    allowsFullBurn: true,
    spendIntensity: 1,
    custodyStrength: 0.8,
    failureSharpness: 0,
    cacheWarmth: 0,
    outputSlotCount: 1,
    warningLoad: 0,
    ...overrides.fire,
  };
  return {
    schema: KAMINOS_ROUTE_ACTIVITY_SCHEMA,
    activityId: 'live-run-route-activity',
    routeRunId: 'live-run',
    activityState: 'burning',
    routePhase: 'running',
    truthMode: 'live',
    visualAuthority: 'live-compute',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'adapter.moge-local-webgpu.v0',
    backendClass: 'browser-webgpu',
    receiptId: 'receipt-live-001',
    sourceArtifactIds: ['source-image-a'],
    conditioningArtifactIds: ['depth-a'],
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'pending' }],
    sourceTruthWarnings: [],
    falseAuthorityViolations: [],
    fire,
    ...overrides,
  };
}

function routeRun(routeActivityPayload, overrides = {}) {
  return {
    schema: 'kaminos.kiln.tray-route-run.v0',
    runId: routeActivityPayload.routeRunId,
    requestedRoute: routeActivityPayload.requestedRoute,
    effectiveRoute: routeActivityPayload.effectiveRoute,
    backendClass: routeActivityPayload.backendClass,
    statusBadge: overrides.statusBadge || 'real',
    routePhase: routeActivityPayload.routePhase,
    receiptId: routeActivityPayload.receiptId,
    inputArtifactIds: routeActivityPayload.sourceArtifactIds,
    conditioningArtifactIds: routeActivityPayload.conditioningArtifactIds,
    outputArtifactIds: (routeActivityPayload.outputSlots || []).map(slot => slot.artifactId),
    routeActivity: routeActivityPayload,
    sourceTruthWarnings: routeActivityPayload.sourceTruthWarnings,
    ...overrides,
  };
}

function fixtureRouteRuns() {
  const live = routeActivity();
  const cached = routeActivity({
    activityId: 'cached-run-route-activity',
    routeRunId: 'cached-run',
    activityState: 'cached',
    routePhase: 'completed',
    truthMode: 'cached',
    visualAuthority: 'cached',
    backendClass: 'cache',
    receiptId: 'receipt-cached-001',
    sourceTruthWarnings: ['cached_not_fresh_compute'],
    fire: {
      heatClass: 'glow',
      fuelClass: 'cached',
      truthClass: 'cached',
      visualAuthority: 'cached',
      allowsFullBurn: false,
      spendIntensity: 0,
      cacheWarmth: 0.8,
    },
  });
  const fallback = routeActivity({
    activityId: 'fallback-run-route-activity',
    routeRunId: 'fallback-run',
    activityState: 'fallback',
    routePhase: 'running',
    truthMode: 'fallback',
    visualAuthority: 'fallback',
    effectiveRoute: 'fixture-generator',
    backendClass: 'fixture',
    receiptId: 'receipt-fallback-001',
    sourceTruthWarnings: ['fallback_kiln_not_requested_route'],
    fire: {
      heatClass: 'burn',
      fuelClass: 'fixture',
      truthClass: 'fallback',
      visualAuthority: 'fallback',
      allowsFullBurn: true,
      spendIntensity: 1,
      warningLoad: 1,
    },
  });
  const unavailable = routeActivity({
    activityId: 'missing-run-route-activity',
    routeRunId: 'missing-run',
    activityState: 'unavailable',
    routePhase: 'queued',
    truthMode: 'unavailable',
    visualAuthority: 'none',
    effectiveRoute: null,
    backendClass: 'missing',
    receiptId: null,
    sourceArtifactIds: [],
    conditioningArtifactIds: [],
    outputSlots: [],
    sourceTruthWarnings: ['kiln_backend_unavailable'],
    fire: {
      heatClass: 'cold',
      fuelClass: 'unknown',
      truthClass: 'unavailable',
      visualAuthority: 'none',
      allowsFullBurn: false,
    },
  });

  return [
    routeRun(live),
    routeRun(cached, { statusBadge: 'cached' }),
    routeRun(fallback, { statusBadge: 'fallback' }),
    routeRun(unavailable, { statusBadge: 'missing-backend' }),
  ];
}
