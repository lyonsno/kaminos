export const ROUTE_COMPOSITION_TRAY_SCHEMA = 'kaminos.kiln.route-composition-tray.v0';
export const TRAY_ARTIFACT_ENTRY_SCHEMA = 'kaminos.kiln.tray-artifact-entry.v0';
export const TRAY_ROUTE_RUN_SCHEMA = 'kaminos.kiln.tray-route-run.v0';
export const KILN_ACTIVITY_STATE_SCHEMA = 'kaminos.kiln.activity-state.v0';

export const CONDITIONING_LINK_ROLES = [
  'source-image',
  'mask',
  'matte',
  'depth',
  'normal',
  'scribble',
  'reference',
  'negative-law',
  'canny',
  'segmentation',
];

export const ARTIFACT_SOURCE_KINDS = [
  'fixture',
  'imported-external',
  'imported-manual',
  'generated',
  'cached',
  'failed',
  'browser-local',
];

export const ROUTE_STATUS_BADGES = [
  'real',
  'fixture',
  'cached',
  'fallback',
  'missing-backend',
  'failed',
  'partial',
  'stale',
];

export const KILN_ACTIVITY_STATES = [
  'cold',
  'queued',
  'warming',
  'burning',
  'banking',
  'cooled',
  'failed',
  'cached',
  'fixture',
  'fallback',
  'unavailable',
];

export const KILN_TRUTH_MODES = [
  'live',
  'cached',
  'fixture',
  'fallback',
  'unavailable',
  'failed',
];

const SOURCE_KIND_DISPLAY = {
  'fixture': 'Fixture',
  'imported-external': 'External import',
  'imported-manual': 'Manual import',
  'generated': 'Generated',
  'cached': 'Cached',
  'failed': 'Failed',
  'browser-local': 'Browser local',
};

const STATUS_BADGE_DISPLAY = {
  'real': 'Completed',
  'fixture': 'Fixture (not live)',
  'cached': 'Cached result',
  'fallback': 'Fallback route',
  'missing-backend': 'Backend unavailable',
  'failed': 'Failed',
  'partial': 'Partial result',
  'stale': 'Stale',
};

function routeRunDisplayStatus(statusBadge, routePhase) {
  if (statusBadge === 'real') {
    if (routePhase === 'queued') return 'Queued';
    if (routePhase === 'warming' || routePhase === 'preparing') return 'Warming';
    if (routePhase === 'running') return 'Running';
    if (routePhase === 'banking' || routePhase === 'settling' || routePhase === 'importing') return 'Banking';
    if (routePhase === 'failed') return 'Failed';
    return 'Completed';
  }
  return STATUS_BADGE_DISPLAY[statusBadge] || statusBadge;
}

function humanizeRouteId(id) {
  if (!id) return '';
  return id
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function unique(values) {
  return [...new Set((values || []).map(v => String(v)).filter(Boolean))];
}

function sourceTruthWarningsForEntry({ sourceKind, packetBindingRole, routeReceipt, sourceTruthWarnings = [] }) {
  const warnings = [...(sourceTruthWarnings || [])];
  if (sourceKind === 'fixture') warnings.push('fixture_not_live_generated_output');
  if (sourceKind === 'failed') warnings.push('failed_artifact_no_usable_output');
  if (packetBindingRole === 'truth-layer' && routeReceipt?.schema === 'kaminos.webgpu-route-receipt.v0') {
    const hasPartialOutput = (routeReceipt.outputs || []).some(output => output.status === 'partial');
    if (hasPartialOutput) warnings.push('anonymous_imagedata_receipt_partial');
  }
  return unique(warnings);
}

function sourceTruthWarningsForRun({ statusBadge, requestedRoute, effectiveRoute }) {
  const warnings = [];
  if (statusBadge === 'fixture') warnings.push('fixture_route_not_live_execution');
  if (statusBadge === 'missing-backend') warnings.push('missing_backend_route_unavailable');
  if (statusBadge === 'fallback') warnings.push('fallback_not_requested_route');
  if (statusBadge === 'failed') warnings.push('route_execution_failed');
  if (requestedRoute && effectiveRoute && requestedRoute !== effectiveRoute) {
    warnings.push('route_requested_effective_mismatch');
  }
  return unique(warnings);
}

export function deriveKilnActivityState({
  statusBadge,
  routePhase = 'completed',
  backendClass,
  requestedRoute,
  effectiveRoute,
  receiptId,
}) {
  let activityState = 'cooled';
  let truthMode = 'live';
  let visualAuthority = 'settled-output';
  let allowsFullBurn = false;
  let claimsLiveCompute = false;
  const warnings = [];

  if (statusBadge === 'fixture') {
    activityState = 'fixture';
    truthMode = 'fixture';
    visualAuthority = 'demo-fixture';
    warnings.push('fixture_kiln_not_live_compute');
  } else if (statusBadge === 'cached') {
    activityState = 'cached';
    truthMode = 'cached';
    visualAuthority = 'warm-recall';
    warnings.push('cached_not_fresh_compute');
  } else if (statusBadge === 'fallback') {
    activityState = 'fallback';
    truthMode = 'fallback';
    visualAuthority = 'degraded-fallback';
    warnings.push('fallback_kiln_not_requested_route');
  } else if (statusBadge === 'missing-backend') {
    activityState = 'unavailable';
    truthMode = 'unavailable';
    visualAuthority = 'none';
    warnings.push('kiln_backend_unavailable');
  } else if (statusBadge === 'failed') {
    activityState = 'failed';
    truthMode = 'failed';
    visualAuthority = 'failure-snuff';
    warnings.push('kiln_route_failed');
  } else if (routePhase === 'queued') {
    activityState = 'queued';
    visualAuthority = 'preheat';
  } else if (routePhase === 'warming' || routePhase === 'preparing') {
    activityState = 'warming';
    visualAuthority = 'low-heat';
  } else if (routePhase === 'running') {
    activityState = 'burning';
    visualAuthority = 'live-compute';
    allowsFullBurn = true;
    claimsLiveCompute = true;
  } else if (routePhase === 'banking' || routePhase === 'settling' || routePhase === 'importing') {
    activityState = 'banking';
    visualAuthority = 'coals-settling';
  }

  return {
    schema: KILN_ACTIVITY_STATE_SCHEMA,
    activityState,
    routePhase,
    truthMode,
    visualAuthority,
    allowsFullBurn,
    claimsLiveCompute,
    requestedRoute: requestedRoute || null,
    effectiveRoute: effectiveRoute || null,
    backendClass: backendClass || null,
    statusBadge: statusBadge || null,
    receiptId: receiptId || null,
    sourceTruthWarnings: unique(warnings),
  };
}

export function createTray({ trayId = `tray-${Date.now().toString(36)}` } = {}) {
  return {
    schema: ROUTE_COMPOSITION_TRAY_SCHEMA,
    trayId,
    sourceArtifacts: [],
    conditioningLinks: [],
    routeRuns: [],
    outputArtifacts: [],
  };
}

function makeArtifactEntry({
  artifactId,
  title,
  sourceKind,
  mimeType,
  source,
  width,
  height,
  routeRunId,
  conditioningRoles,
  viewKind,
  packetBindingRole,
  routeReceipt,
  sha256,
  shape,
  outputRole,
  status,
  sourceTruthWarnings,
}) {
  const warnings = sourceTruthWarningsForEntry({ sourceKind, packetBindingRole, routeReceipt, sourceTruthWarnings });
  return {
    schema: TRAY_ARTIFACT_ENTRY_SCHEMA,
    artifactId,
    title: title || artifactId,
    sourceKind,
    displaySourceKind: SOURCE_KIND_DISPLAY[sourceKind] || sourceKind,
    mimeType: mimeType || null,
    source: source || null,
    width: width || null,
    height: height || null,
    routeRunId: routeRunId || null,
    conditioningRoles: conditioningRoles || [],
    viewKind: viewKind || null,
    packetBindingRole: packetBindingRole || null,
    routeReceipt: routeReceipt || null,
    sha256: sha256 || null,
    shape: Array.isArray(shape) ? [...shape] : null,
    outputRole: outputRole || viewKind || null,
    status: status || null,
    sourceTruthWarnings: warnings,
  };
}

export function addSourceArtifact(tray, { artifactId, title, sourceKind, mimeType, source, width, height, conditioningRoles }) {
  const entry = makeArtifactEntry({ artifactId, title, sourceKind, mimeType, source, width, height, conditioningRoles });
  return {
    ...tray,
    sourceArtifacts: [...tray.sourceArtifacts, entry],
  };
}

export function addConditioningLink(tray, { sourceArtifactId, conditioningArtifactId, role, title, sourceKind, source }) {
  const link = {
    sourceArtifactId,
    conditioningArtifactId,
    role,
    title: title || `${role} conditioning`,
    sourceKind: sourceKind || 'generated',
    source: source || null,
  };
  return {
    ...tray,
    conditioningLinks: [...tray.conditioningLinks, link],
  };
}

export function addRouteRun(tray, {
  runId,
  requestedRoute,
  effectiveRoute,
  backendClass,
  statusBadge,
  routePhase = 'completed',
  receiptId,
  inputArtifactIds = [],
  conditioningArtifactIds = [],
  outputArtifactIds = [],
  routeReceipt = null,
}) {
  const run = makeRouteRun({
    runId,
    requestedRoute,
    effectiveRoute,
    backendClass,
    statusBadge,
    routePhase,
    receiptId,
    inputArtifactIds,
    conditioningArtifactIds,
    outputArtifactIds,
    routeReceipt,
  });
  return {
    ...tray,
    routeRuns: [...tray.routeRuns, run],
  };
}

function makeRouteRun({
  runId,
  requestedRoute,
  effectiveRoute,
  backendClass,
  statusBadge,
  routePhase = 'completed',
  receiptId,
  inputArtifactIds = [],
  conditioningArtifactIds = [],
  outputArtifactIds = [],
  routeReceipt = null,
}) {
  const warnings = sourceTruthWarningsForRun({ statusBadge, requestedRoute, effectiveRoute });
  const kilnActivity = deriveKilnActivityState({
    statusBadge,
    routePhase,
    backendClass,
    requestedRoute,
    effectiveRoute,
    receiptId,
  });
  const run = {
    schema: TRAY_ROUTE_RUN_SCHEMA,
    runId,
    requestedRoute,
    effectiveRoute,
    backendClass,
    statusBadge,
    routePhase,
    receiptId: receiptId || null,
    inputArtifactIds,
    conditioningArtifactIds,
    outputArtifactIds,
    routeReceipt,
    displayRoute: humanizeRouteId(effectiveRoute),
    displayStatus: routeRunDisplayStatus(statusBadge, routePhase),
    kilnActivity,
    sourceTruthWarnings: unique([...warnings, ...kilnActivity.sourceTruthWarnings]),
  };
  return run;
}

export function updateRouteRun(tray, opts) {
  if (!opts?.runId) throw new Error('updateRouteRun requires runId');
  const existing = (tray.routeRuns || []).find(run => run.runId === opts.runId) || null;
  const merged = {
    ...(existing || {}),
    ...opts,
    inputArtifactIds: opts.inputArtifactIds ?? existing?.inputArtifactIds ?? [],
    conditioningArtifactIds: opts.conditioningArtifactIds ?? existing?.conditioningArtifactIds ?? [],
    outputArtifactIds: opts.outputArtifactIds ?? existing?.outputArtifactIds ?? [],
    requestedRoute: opts.requestedRoute ?? existing?.requestedRoute,
    effectiveRoute: opts.effectiveRoute ?? existing?.effectiveRoute,
    backendClass: opts.backendClass ?? existing?.backendClass,
    statusBadge: opts.statusBadge ?? existing?.statusBadge,
    routePhase: opts.routePhase ?? existing?.routePhase ?? 'completed',
    receiptId: opts.receiptId ?? existing?.receiptId ?? null,
    routeReceipt: opts.routeReceipt ?? existing?.routeReceipt ?? null,
  };
  const run = makeRouteRun(merged);
  if (!existing) {
    return {
      ...tray,
      routeRuns: [...(tray.routeRuns || []), run],
    };
  }
  return {
    ...tray,
    routeRuns: (tray.routeRuns || []).map(candidate => candidate.runId === opts.runId ? run : candidate),
  };
}

export function appendOutputArtifact(tray, opts) {
  const entry = makeArtifactEntry(opts);
  return {
    ...tray,
    outputArtifacts: [...tray.outputArtifacts, entry],
  };
}

export function buildFixtureWitnessTray() {
  let tray = createTray({ trayId: 'fixture-witness-tray-001' });

  // One source/import artifact
  tray = addSourceArtifact(tray, {
    artifactId: 'fixture-source-red-lerm-photo',
    title: 'Red lerm reference photo',
    sourceKind: 'imported-external',
    mimeType: 'image/png',
  });

  // Conditioning links: depth, normal, mask, reference
  tray = addConditioningLink(tray, {
    sourceArtifactId: 'fixture-source-red-lerm-photo',
    conditioningArtifactId: 'fixture-depth-001',
    role: 'depth',
    title: 'Depth map',
    sourceKind: 'fixture',
  });
  tray = addConditioningLink(tray, {
    sourceArtifactId: 'fixture-source-red-lerm-photo',
    conditioningArtifactId: 'fixture-normal-001',
    role: 'normal',
    title: 'Normal map',
    sourceKind: 'fixture',
  });
  tray = addConditioningLink(tray, {
    sourceArtifactId: 'fixture-source-red-lerm-photo',
    conditioningArtifactId: 'fixture-mask-001',
    role: 'mask',
    title: 'Foreground mask',
    sourceKind: 'fixture',
  });

  // Route run: fixture route
  tray = addRouteRun(tray, {
    runId: 'fixture-run-001',
    requestedRoute: 'image_conditioned_generation',
    effectiveRoute: 'fixture_generator',
    backendClass: 'fixture',
    statusBadge: 'fixture',
    receiptId: 'fixture-receipt-001',
    inputArtifactIds: ['fixture-source-red-lerm-photo'],
    conditioningArtifactIds: ['fixture-depth-001', 'fixture-normal-001', 'fixture-mask-001'],
  });

  // Second route run: missing backend
  tray = addRouteRun(tray, {
    runId: 'fixture-run-002',
    requestedRoute: 'sdxl_controlnet',
    effectiveRoute: 'missing',
    backendClass: 'missing',
    statusBadge: 'missing-backend',
    receiptId: 'fixture-receipt-002',
    inputArtifactIds: ['fixture-source-red-lerm-photo'],
    conditioningArtifactIds: ['fixture-depth-001'],
  });

  // Output artifact from fixture route
  tray = appendOutputArtifact(tray, {
    artifactId: 'fixture-output-001',
    title: 'Fixture generated concept',
    sourceKind: 'fixture',
    routeRunId: 'fixture-run-001',
    mimeType: 'image/png',
  });

  return tray;
}

export function trayWitness(tray) {
  const kilnActivityStateCounts = {};
  for (const run of tray?.routeRuns || []) {
    const state = run.kilnActivity?.activityState || 'unknown';
    kilnActivityStateCounts[state] = (kilnActivityStateCounts[state] || 0) + 1;
  }
  const ok = tray?.schema === ROUTE_COMPOSITION_TRAY_SCHEMA
    && tray.sourceArtifacts?.length >= 1
    && tray.conditioningLinks?.length >= 2
    && tray.routeRuns?.length >= 1
    && tray.outputArtifacts?.length >= 1;
  return {
    schema: 'kaminos.kiln.route-composition-tray-witness.v0',
    ok,
    trayId: tray?.trayId || null,
    sourceArtifactCount: tray?.sourceArtifacts?.length || 0,
    conditioningLinkCount: tray?.conditioningLinks?.length || 0,
    routeRunCount: tray?.routeRuns?.length || 0,
    outputArtifactCount: tray?.outputArtifacts?.length || 0,
    kilnActivityStateCounts,
    sourceTruthWarnings: unique([
      ...(tray?.sourceArtifacts || []).flatMap(a => a.sourceTruthWarnings || []),
      ...(tray?.routeRuns || []).flatMap(r => r.sourceTruthWarnings || []),
      ...(tray?.routeRuns || []).flatMap(r => r.kilnActivity?.sourceTruthWarnings || []),
      ...(tray?.outputArtifacts || []).flatMap(a => a.sourceTruthWarnings || []),
    ]),
  };
}
