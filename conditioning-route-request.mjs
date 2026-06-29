import {
  KILN_IMAGE_ROUTE_RECEIPT_SCHEMA,
  SPECIMEN_VIEW_KINDS,
} from './specimen-checkpoint.mjs';

export const CONDITIONING_ROUTE_REQUEST_SCHEMA = 'kaminos.conditioning-route-request.v0';

function unique(values) {
  return [...new Set((values || []).map(value => String(value)).filter(Boolean))];
}

function artifactByViewKind(viewArtifacts) {
  return Object.fromEntries((viewArtifacts || [])
    .filter(artifact => artifact?.viewKind && artifact?.artifactId)
    .map(artifact => [artifact.viewKind, artifact]));
}

export function buildConditioningRouteReceipt({
  requestedRoute = 'image_conditioned_generation',
  effectiveRoute = 'request_only',
  runtime = 'kaminos-conditioning-route-request',
  fallbackReason = 'request_created_no_generator_executed',
  sourceTruthWarnings = [],
} = {}) {
  const warnings = unique(['route_request_not_generator_execution_truth', ...sourceTruthWarnings]);
  if (requestedRoute !== effectiveRoute) warnings.push('route_receipt_requested_effective_mismatch');
  return {
    schema: KILN_IMAGE_ROUTE_RECEIPT_SCHEMA,
    requestedRoute,
    effectiveRoute,
    runtime,
    fallbackReason,
    sourceTruthWarnings: unique(warnings),
  };
}

export function buildConditioningRouteRequest({
  requestId = `conditioning-request-${Date.now().toString(36)}`,
  checkpoint,
  viewArtifacts,
  requestedRoute = 'image_conditioned_generation',
  intendedEffectiveRoute = 'request_only',
  prompt = '',
  negativeLaw = checkpoint?.negativeLaw || [],
  seed = null,
  routeConfig = {},
  runtimeIdentity = {},
} = {}) {
  if (!checkpoint?.specimenId) throw new Error('specimen checkpoint is required');
  if (!Array.isArray(viewArtifacts) || viewArtifacts.length === 0) throw new Error('specimen view artifacts are required');
  const byView = artifactByViewKind(viewArtifacts);
  const missing = SPECIMEN_VIEW_KINDS.filter(kind => !byView[kind]);
  if (missing.length) throw new Error(`missing conditioning view artifacts: ${missing.join(', ')}`);
  const routeReceipt = buildConditioningRouteReceipt({
    requestedRoute,
    effectiveRoute: intendedEffectiveRoute,
    runtime: runtimeIdentity.runtime || 'kaminos-conditioning-route-request',
  });
  const conditioningArtifactIds = Object.fromEntries(SPECIMEN_VIEW_KINDS.map(kind => [kind, byView[kind].artifactId]));
  const conditioningRoles = unique(viewArtifacts.flatMap(artifact => artifact.conditioningRoles || []));
  const sourceTruthWarnings = unique([
    'route_request_not_generator_execution_truth',
    ...(checkpoint.sourceTruthWarnings || []),
    ...viewArtifacts.flatMap(artifact => artifact.sourceTruthWarnings || []),
    ...routeReceipt.sourceTruthWarnings,
  ]);
  return {
    schema: CONDITIONING_ROUTE_REQUEST_SCHEMA,
    requestId,
    specimenCheckpointId: checkpoint.specimenId,
    specimenKind: checkpoint.specimenKind,
    firstVerticalRole: checkpoint.firstVerticalRole,
    requestedRoute,
    intendedEffectiveRoute,
    inputArtifactIds: [byView.beauty.artifactId],
    conditioningArtifactIds,
    conditioningRoles,
    prompt,
    negativeLaw: unique(negativeLaw),
    seed,
    routeConfig: { ...routeConfig },
    runtimeIdentity: {
      runtime: 'kaminos-conditioning-route-request',
      ...runtimeIdentity,
    },
    outputArtifactIds: [],
    routeReceipt,
    sourceTruthWarnings,
  };
}

export function conditioningRouteRequestWitness({ request } = {}) {
  const viewKinds = Object.keys(request?.conditioningArtifactIds || {}).sort();
  const ok = request?.schema === CONDITIONING_ROUTE_REQUEST_SCHEMA
    && request?.routeReceipt?.schema === KILN_IMAGE_ROUTE_RECEIPT_SCHEMA
    && request?.inputArtifactIds?.length > 0
    && SPECIMEN_VIEW_KINDS.every(kind => viewKinds.includes(kind))
    && request?.sourceTruthWarnings?.includes('route_request_not_generator_execution_truth');
  return {
    schema: 'kaminos.conditioning-route-request-witness.v0',
    ok,
    requestSchema: request?.schema || null,
    requestId: request?.requestId || null,
    specimenCheckpointId: request?.specimenCheckpointId || null,
    conditioningViewKinds: viewKinds,
    sourceTruthWarnings: request?.sourceTruthWarnings || [],
  };
}
