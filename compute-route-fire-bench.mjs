export const COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA = 'kaminos.compute-route-fire-smoke-payload.v0';
export const COMPUTE_ROUTE_FIRE_BENCH_SCHEMA = 'kaminos.compute-route-fire-bench.v0';

function encodeBase64Url(value) {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url');
  }
  const utf8 = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  if (!value) return null;
  if (typeof Buffer !== 'undefined') {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePhase(phase = {}) {
  const p = phase || {};
  return {
    routeRunId: p.routeRunId || null,
    routePhase: p.routePhase || null,
    statusBadge: p.statusBadge || null,
    visualPhase: p.visualPhase || null,
    fullBurnCount: Number.isFinite(p.fullBurnCount) ? p.fullBurnCount : 0,
    allowsFullBurn: p.allowsFullBurn === true,
  };
}

function artifactLabel(artifact) {
  return artifact.role || artifact.id || 'artifact';
}

function summarizePayload(payload) {
  const active = normalizePhase(payload.active);
  const final = normalizePhase(payload.final);
  if (active.allowsFullBurn && active.visualPhase === 'burn' && final.visualPhase === 'cooled') {
    return 'active burn from real SHARP route; final cooled after real output';
  }
  if (active.allowsFullBurn) return 'active burn from compute route evidence';
  if (final.visualPhase === 'cooled') return 'settled output from completed route';
  return 'compute route evidence present';
}

export function computeRouteFirePayloadFromSearch(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('kaminos_compute_route_fire') !== '1') return null;
  const payload = decodeBase64Url(params.get('compute_route_fire_payload'));
  if (!payload || payload.schema !== COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA) return null;
  return payload;
}

export function computeRouteFireSmokeUrl(payload, {
  baseUrl = 'http://127.0.0.1:18121/',
  volumeWitnessUrl = null,
} = {}) {
  if (!payload || payload.schema !== COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA) {
    throw new Error(`payload with schema ${COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA} is required`);
  }
  const url = new URL(volumeWitnessUrl || baseUrl);
  if (!url.searchParams.has('kaminos_volume_smoke')) {
    url.searchParams.set('kaminos_volume_smoke', '1');
  }
  url.searchParams.set('kaminos_compute_route_fire', '1');
  url.searchParams.set('compute_route_fire_payload', encodeBase64Url(payload));
  return url.toString();
}

export function buildComputeRouteFireBenchModel({
  payload,
  launchUrl = null,
} = {}) {
  if (!payload || payload.schema !== COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA) {
    throw new Error(`payload with schema ${COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA} is required`);
  }
  const active = normalizePhase(payload.active);
  const final = normalizePhase(payload.final);
  const artifactRows = asArray(payload.artifacts).map(artifact => ({
    id: artifact.id || artifact.role || 'artifact',
    role: artifact.role || artifact.id || 'artifact',
    label: artifactLabel(artifact),
    status: artifact.status || 'unknown',
    schema: artifact.schema || null,
    path: artifact.path || null,
    bytes: Number.isFinite(artifact.bytes) ? artifact.bytes : null,
  }));
  const warningRows = asArray(payload.warnings).map(String);
  return {
    schema: COMPUTE_ROUTE_FIRE_BENCH_SCHEMA,
    payloadSchema: payload.schema,
    pipelineId: payload.pipelineId || null,
    routeLabel: payload.pipelineId || payload.effectiveRoute || payload.requestedRoute || 'compute route',
    requestedRoute: payload.requestedRoute || null,
    effectiveRoute: payload.effectiveRoute || null,
    backendClass: payload.backendClass || null,
    pipelineReportPath: payload.pipelineReportPath || null,
    inputPath: payload.inputPath || null,
    launchUrl,
    active,
    final,
    artifactRows,
    warningRows,
    sourceTruthSummary: summarizePayload({ ...payload, active, final }),
  };
}

export function computeRouteFirePayloadFromReport(report) {
  const active = report?.activeWitness;
  const final = report?.finalWitness;
  const pipelineReport = report?.pipelineReport;
  if (!active?.routeRun) throw new Error('activeWitness.routeRun is required');
  const routeRun = active.routeRun;
  const activeReceipt = active.primaryBridge?.visualReceipt || {};
  const finalRouteRun = final?.routeRun || null;
  const finalReceipt = final?.primaryBridge?.visualReceipt || {};
  const artifacts = Object.entries(pipelineReport?.artifacts || {})
    .filter(([id]) => id !== 'input')
    .map(([id, artifact]) => ({
      id,
      role: artifact.role || id,
      status: artifact.status || null,
      schema: artifact.schema || null,
      path: artifact.path || null,
      bytes: artifact.bytes || null,
    }));
  return {
    schema: COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA,
    pipelineId: report.pipelineId || pipelineReport?.effectivePipelineId || pipelineReport?.requestedPipelineId || null,
    requestedRoute: routeRun.requestedRoute || routeRun.routeActivity?.requestedRoute || null,
    effectiveRoute: routeRun.effectiveRoute || routeRun.routeActivity?.effectiveRoute || null,
    backendClass: routeRun.backendClass || routeRun.routeActivity?.backendClass || null,
    pipelineReportPath: report.pipelineReportPath || active.routeRun?.receiptId || null,
    inputPath: report.input || routeRun.inputArtifactIds?.[0] || null,
    active: {
      routeRunId: routeRun.runId || active.primaryBridge?.routeRunId || null,
      routePhase: routeRun.routePhase || routeRun.routeActivity?.routePhase || null,
      statusBadge: routeRun.statusBadge || null,
      visualPhase: activeReceipt.visualPhase || null,
      fullBurnCount: active.routeActivityWitness?.fullBurnCount || 0,
      allowsFullBurn: activeReceipt.allowsFullBurn === true,
    },
    final: finalRouteRun ? {
      routeRunId: finalRouteRun.runId || final.primaryBridge?.routeRunId || null,
      routePhase: finalRouteRun.routePhase || finalRouteRun.routeActivity?.routePhase || null,
      statusBadge: finalRouteRun.statusBadge || null,
      visualPhase: finalReceipt.visualPhase || null,
      fullBurnCount: final.routeActivityWitness?.fullBurnCount || 0,
      allowsFullBurn: finalReceipt.allowsFullBurn === true,
    } : null,
    artifacts,
    warnings: [
      ...asArray(finalRouteRun?.sourceTruthWarnings),
      ...asArray(routeRun.sourceTruthWarnings),
    ],
  };
}
