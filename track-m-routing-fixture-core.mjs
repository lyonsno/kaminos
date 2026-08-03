import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const TRACK_M_ROUTING_FIXTURE_SCHEMA = 'kaminos.track-m-source-routing-fixture.v0';
export const TRACK_M_ROUTING_FIXTURE_FAILURE_SCHEMA = 'kaminos.track-m-source-routing-fixture-failure.v0';
export const TRACK_M_ROUTING_FIXTURE_COMPILER_ID = 'track-m-m31-m47-routing-fixture-v0';

const SOURCE_GRAPH_SCHEMA = 'kaminos.track-m-authored-source-graph.v0';
const GEOMETRY_ASSAY_SCHEMA = 'counterfactual.cat-armature-relation-geometry.v1';
const TRACK_ID = 'shape-bearing-musculature';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REGISTRATION_EPSILON = 1e-6;
const CHORD_CONSISTENCY_EPSILON = 1e-6;
const ROUTE_SPECS = Object.freeze([
  {
    constructionId: 'muscle-31',
    name: 'Muscle 31',
    instanceId: 'instance-cd975deb-0bb7-40ce-bbcf-ef847f537882',
    lineageId: 'lineage-1fbd216b-6372-4579-b18c-0c5864a1f10f',
  },
  {
    constructionId: 'muscle-47',
    name: 'Muscle 47',
    instanceId: 'instance-4531f561-09a0-4d3f-b947-c207387e9250',
    lineageId: 'lineage-6307e597-56c2-4bd6-89dc-eaa85835d3bf',
  },
]);
const NULL_SPECS = Object.freeze([
  {
    constructionId: 'muscle-35',
    name: 'Muscle 35',
    instanceId: 'instance-df26f025-7412-43c8-abc1-c7082fdd906c',
    lineageId: 'lineage-6e15ea13-947d-4971-928a-4f1547a46a65',
    sourceName: 'Cube.002',
  },
  {
    constructionId: 'muscle-38',
    name: 'Muscle 38',
    instanceId: 'instance-11cb7bdf-288c-4cbf-9004-f854279c5e8b',
    lineageId: 'lineage-f950b812-9a33-41c0-8cc3-40b922aad2e8',
    sourceName: 'SRC_PELVIS',
  },
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function parseAuthenticatedBytes(input, label) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new Error(`${label} input bytes are required; parsed objects cannot carry file identity`);
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} bytes are not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  return {
    value,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function requireFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requireIdentity(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual ?? '<missing>'}`);
}

function pointFromMatrix(matrix, label) {
  if (!Array.isArray(matrix) || matrix.length !== 16) throw new Error(`${label} matrix must contain 16 values`);
  matrix.forEach((value, index) => requireFinite(value, `${label} matrix[${index}]`));
  return [matrix[3], matrix[7], matrix[11]];
}

function requirePoint(point, label) {
  if (!Array.isArray(point) || point.length !== 3) throw new Error(`${label} point must contain three values`);
  point.forEach((value, index) => requireFinite(value, `${label} point[${index}]`));
  return [...point];
}

function distance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function assertSourceIdentities(graph, assay, options) {
  requireObject(graph, 'source graph');
  requireObject(assay, 'geometry assay');
  for (const [value, label] of [
    [options.graphFileSha256, 'graph file hash'],
    [options.assayFileSha256, 'assay file hash'],
    [options.expectedSourceSha256, 'expected source hash'],
    [options.expectedGraphSha256, 'expected graph identity'],
    [options.expectedGraphFileSha256, 'expected graph file hash'],
    [options.expectedAssayFileSha256, 'expected assay file hash'],
  ]) requireHash(value, label);

  requireIdentity(options.graphFileSha256, options.expectedGraphFileSha256, 'graph file SHA-256');
  requireIdentity(options.assayFileSha256, options.expectedAssayFileSha256, 'assay file SHA-256');
  requireIdentity(graph.schema, SOURCE_GRAPH_SCHEMA, 'source graph schema');
  requireIdentity(graph.status, 'compiled', 'source graph status');
  requireIdentity(graph.trackId, TRACK_ID, 'source graph track');
  requireIdentity(graph.graphSha256, options.expectedGraphSha256, 'graph identity');
  requireObject(graph.source, 'source graph source');
  requireIdentity(graph.source.sha256, options.expectedSourceSha256, 'source graph source SHA-256');

  requireIdentity(assay.schema, GEOMETRY_ASSAY_SCHEMA, 'geometry assay schema');
  requireIdentity(assay.status, 'complete', 'geometry assay status');
  requireIdentity(assay.source_sha256, options.expectedSourceSha256, 'assay source SHA-256');
  requireIdentity(assay.graph_identity, options.expectedGraphSha256, 'assay graph identity');
  requireIdentity(assay.graph_file_sha256, options.expectedGraphFileSha256, 'assay graph file SHA-256');
  if (!Array.isArray(graph.muscles)) throw new Error('source graph muscles must be an array');
  if (!Array.isArray(assay.rows)) throw new Error('geometry assay rows must be an array');
}

function uniqueByConstruction(items, constructionId, label) {
  const matches = items.filter(item => (item.identity?.construction_id ?? item.construction_id) === constructionId);
  if (matches.length === 0) throw new Error(`selected construction ${constructionId} is missing from ${label}`);
  if (matches.length !== 1) throw new Error(`selected construction ${constructionId} is duplicated in ${label}`);
  return matches[0];
}

function requireSettingsMatch(graphSettings, assaySettings, label) {
  requireObject(graphSettings, `${label} graph settings`);
  requireObject(assaySettings, `${label} assay settings`);
  if (JSON.stringify(canonical(graphSettings)) !== JSON.stringify(canonical(assaySettings))) {
    throw new Error(`${label} settings drift between graph and assay`);
  }
}

function validateRoute(graph, assay, spec, expectedPair = ['Cube.002', 'Cube.003']) {
  const muscle = uniqueByConstruction(graph.muscles, spec.constructionId, 'source graph');
  const row = uniqueByConstruction(assay.rows, spec.constructionId, 'geometry assay');
  requireIdentity(muscle.name, spec.name, `${spec.constructionId} name`);
  requireIdentity(muscle.identity?.instance_id, spec.instanceId, `${spec.constructionId} instance`);
  requireIdentity(muscle.identity?.lineage_id, spec.lineageId, `${spec.constructionId} lineage`);
  requireIdentity(row.name, spec.name, `${spec.constructionId} assay name`);
  requireIdentity(row.lineage_id, spec.lineageId, `${spec.constructionId} assay lineage`);
  if (muscle.completenessAuthority !== 'declared_components_present' || muscle.missingComponentRoles?.length !== 0) {
    throw new Error(`${spec.constructionId} is not a complete declared construction`);
  }
  if (muscle.origin?.sourceAuthority !== 'source_mesh' || muscle.insertion?.sourceAuthority !== 'source_mesh') {
    throw new Error(`${spec.constructionId} endpoints require source_mesh authority`);
  }
  if (muscle.origin.sourceName !== expectedPair[0] || muscle.insertion.sourceName !== expectedPair[1]) {
    throw new Error(`${spec.constructionId} source pair drifted from ${expectedPair.join(' -> ')}`);
  }
  if (JSON.stringify(row.pair) !== JSON.stringify(expectedPair)) {
    throw new Error(`${spec.constructionId} assay pair drifted from ${expectedPair.join(' -> ')}`);
  }
  requireSettingsMatch(muscle.settings, row.settings, spec.constructionId);
  if (row.endpoint_strategy !== muscle.endpointStrategy) throw new Error(`${spec.constructionId} endpoint strategy drift`);
  if (row.path_control_point_count !== muscle.components?.path?.geometry?.pointCount) {
    throw new Error(`${spec.constructionId} path point count drift`);
  }
  if (row.path_start_to_origin !== 0 || row.path_end_to_insertion !== 0) {
    throw new Error(`${spec.constructionId} path endpoints do not bind the selected handles`);
  }
  if (!Array.isArray(row.endpoints) || row.endpoints.length !== 2) {
    throw new Error(`${spec.constructionId} assay must contain exactly two endpoints`);
  }

  const endpoint = role => {
    const assayEndpoint = row.endpoints.find(item => item.role === role);
    if (!assayEndpoint) throw new Error(`${spec.constructionId} ${role} assay endpoint is missing`);
    const graphEndpoint = muscle[role];
    const component = muscle.components?.[role];
    requireObject(component, `${spec.constructionId} ${role} component`);
    requireIdentity(assayEndpoint.declared_target, graphEndpoint.sourceName, `${spec.constructionId} ${role} target`);
    requireIdentity(assayEndpoint.nearest_source_mesh?.name, graphEndpoint.sourceName, `${spec.constructionId} ${role} nearest source mesh`);
    const point = requirePoint(assayEndpoint.point, `${spec.constructionId} ${role}`);
    const matrixPoint = pointFromMatrix(component.matrixWorld, `${spec.constructionId} ${role}`);
    const registrationDelta = distance(point, matrixPoint);
    if (registrationDelta > REGISTRATION_EPSILON) {
      throw new Error(`${spec.constructionId} ${role} registration drift ${registrationDelta} exceeds ${REGISTRATION_EPSILON}`);
    }
    return {
      authoredHandleInstanceId: graphEndpoint.handleInstanceId,
      assignedFromConstructionId: spec.constructionId,
      assignedHandleInstanceId: graphEndpoint.handleInstanceId,
      sourceAuthority: graphEndpoint.sourceAuthority,
      sourceName: graphEndpoint.sourceName,
      point,
      matrixWorld: [...component.matrixWorld],
      graphToAssayRegistrationDelta: registrationDelta,
    };
  };

  const origin = endpoint('origin');
  const insertion = endpoint('insertion');
  requireFinite(row.chord_length, `${spec.constructionId} authored chord length`);
  const endpointChordLength = distance(origin.point, insertion.point);
  const chordConsistencyDelta = Math.abs(row.chord_length - endpointChordLength);
  if (chordConsistencyDelta > CHORD_CONSISTENCY_EPSILON) {
    throw new Error(
      `${spec.constructionId} authored chord differs from endpoint-derived chord by ${chordConsistencyDelta}`,
    );
  }
  return {
    constructionId: spec.constructionId,
    name: spec.name,
    instanceId: spec.instanceId,
    lineageId: spec.lineageId,
    authoredCompleteness: muscle.authoredCompleteness,
    completenessAuthority: muscle.completenessAuthority,
    endpointRoute: muscle.endpointRoute,
    endpointStrategy: muscle.endpointStrategy,
    settings: canonical(structuredClone(muscle.settings)),
    components: {
      originInstanceId: muscle.components.origin.identity.instance_id,
      insertionInstanceId: muscle.components.insertion.identity.instance_id,
      pathInstanceId: muscle.components.path.identity.instance_id,
      pathGeometrySha256: muscle.components.path.geometry.contentSha256,
      pathPointCount: muscle.components.path.geometry.pointCount,
      surfaceInstanceId: muscle.components.surface.identity.instance_id,
      surfaceGeometrySha256: muscle.components.surface.geometry.contentSha256,
      surfaceVertexCount: muscle.components.surface.geometry.vertexCount,
      surfaceEdgeCount: muscle.components.surface.geometry.edgeCount,
      surfacePolygonCount: muscle.components.surface.geometry.polygonCount,
    },
    origin,
    insertion,
    authoredChordLength: row.chord_length,
    endpointDerivedChordLength: endpointChordLength,
    chordConsistencyDelta,
  };
}

function assignedRoute(route, donor = null) {
  const output = structuredClone(route);
  if (donor) {
    output.insertion = {
      ...structuredClone(donor.insertion),
      authoredHandleInstanceId: route.insertion.authoredHandleInstanceId,
      assignedFromConstructionId: donor.constructionId,
    };
  }
  return output;
}

function routeGraph(routes) {
  return routes.map(route => ({
    constructionId: route.constructionId,
    origin: {
      assignedFromConstructionId: route.origin.assignedFromConstructionId,
      assignedHandleInstanceId: route.origin.assignedHandleInstanceId,
      sourceName: route.origin.sourceName,
    },
    insertion: {
      assignedFromConstructionId: route.insertion.assignedFromConstructionId,
      assignedHandleInstanceId: route.insertion.assignedHandleInstanceId,
      sourceName: route.insertion.sourceName,
    },
  }));
}

function contentIdentity(routes) {
  return hashJson(routes.flatMap(route => [
    route.components.pathGeometrySha256,
    route.components.surfaceGeometrySha256,
  ]).sort());
}

function endpointMultisetIdentity(routes) {
  return hashJson(routes.flatMap(route => [
    route.origin.assignedHandleInstanceId,
    route.insertion.assignedHandleInstanceId,
  ]).sort());
}

function representationalBudget(routes) {
  return {
    routeCount: routes.length,
    pathPointCount: routes.reduce((sum, route) => sum + route.components.pathPointCount, 0),
    surfaceVertexCount: routes.reduce((sum, route) => sum + route.components.surfaceVertexCount, 0),
    surfaceEdgeCount: routes.reduce((sum, route) => sum + route.components.surfaceEdgeCount, 0),
    surfacePolygonCount: routes.reduce((sum, route) => sum + route.components.surfacePolygonCount, 0),
    longitudinalSectionCount: routes.reduce((sum, route) => sum + route.settings.longitudinal_sections, 0),
    profileSideCount: routes.reduce((sum, route) => sum + route.settings.profile_sides, 0),
    originTendonFractionSum: routes.reduce((sum, route) => sum + route.settings.origin_tendon_fraction, 0),
    insertionTendonFractionSum: routes.reduce((sum, route) => sum + route.settings.insertion_tendon_fraction, 0),
  };
}

function condition(id, kind, routes) {
  const routingGraphSha256 = hashJson(routeGraph(routes));
  const core = {
    id,
    routes,
    deepGeometryContentSetSha256: contentIdentity(routes),
    attachmentEndpointMultisetSha256: endpointMultisetIdentity(routes),
    routingGraphSha256,
    representationalBudget: representationalBudget(routes),
  };
  return {
    ...core,
    transform: {
      id: `${id}-m31-m47-v0`,
      kind,
      sha256: hashJson({ kind, routingGraphSha256, routes: routeGraph(routes) }),
    },
  };
}

function assertConditionReceipts(conditionValue, label) {
  requireObject(conditionValue, label);
  if (!Array.isArray(conditionValue.routes)) throw new Error(`${label} routes must be an array`);
  requireObject(conditionValue.transform, `${label} transform`);
  requireString(conditionValue.transform.id, `${label} transform id`);
  requireString(conditionValue.transform.kind, `${label} transform kind`);
  requireHash(conditionValue.transform.sha256, `${label} transform receipt`);
  const expectedGeometry = contentIdentity(conditionValue.routes);
  const expectedEndpoints = endpointMultisetIdentity(conditionValue.routes);
  const expectedRouteGraph = routeGraph(conditionValue.routes);
  const expectedRouting = hashJson(expectedRouteGraph);
  const expectedBudget = representationalBudget(conditionValue.routes);
  requireIdentity(conditionValue.deepGeometryContentSetSha256, expectedGeometry, `${label} deep geometry receipt`);
  requireIdentity(conditionValue.attachmentEndpointMultisetSha256, expectedEndpoints, `${label} effective endpoint multiset receipt`);
  requireIdentity(conditionValue.routingGraphSha256, expectedRouting, `${label} routing graph receipt`);
  if (hashJson(conditionValue.representationalBudget) !== hashJson(expectedBudget)) {
    throw new Error(`${label} representational budget receipt mismatch`);
  }
  const expectedTransform = hashJson({
    kind: conditionValue.transform.kind,
    routingGraphSha256: expectedRouting,
    routes: expectedRouteGraph,
  });
  requireIdentity(conditionValue.transform.sha256, expectedTransform, `${label} transform receipt`);
}

export function validateMatchedRoutePreservation(correct, matchedWrong) {
  assertConditionReceipts(correct, 'correct condition');
  assertConditionReceipts(matchedWrong, 'matched-wrong condition');
  requireIdentity(correct.id, 'deep-geometry-correctly-routed', 'correct condition id');
  requireIdentity(correct.transform.id, 'deep-geometry-correctly-routed-m31-m47-v0', 'correct condition transform id');
  requireIdentity(correct.transform.kind, 'preserve-correct-routing', 'correct condition transform kind');
  requireIdentity(matchedWrong.id, 'deep-geometry-matched-wrong-routing', 'matched-wrong condition id');
  requireIdentity(matchedWrong.transform.id, 'deep-geometry-matched-wrong-routing-m31-m47-v0', 'matched-wrong condition transform id');
  requireIdentity(matchedWrong.transform.kind, 'matched-wrong-routing', 'matched-wrong condition transform kind');
  if (correct.routes.length !== ROUTE_SPECS.length || matchedWrong.routes.length !== ROUTE_SPECS.length) {
    throw new Error(`matched route comparison requires exactly ${ROUTE_SPECS.length} ordered routes`);
  }

  ROUTE_SPECS.forEach((spec, index) => {
    const correctRoute = correct.routes[index];
    const wrongRoute = matchedWrong.routes[index];
    for (const [field, expected] of [
      ['constructionId', spec.constructionId],
      ['instanceId', spec.instanceId],
      ['lineageId', spec.lineageId],
    ]) {
      requireIdentity(correctRoute?.[field], expected, `correct route ${index} ${field}`);
      requireIdentity(wrongRoute?.[field], expected, `matched-wrong route ${index} ${field}`);
    }
    requireIdentity(
      correctRoute.origin?.assignedFromConstructionId,
      spec.constructionId,
      `correct route ${spec.constructionId} origin assignment`,
    );
    requireIdentity(
      correctRoute.origin?.assignedHandleInstanceId,
      correctRoute.origin?.authoredHandleInstanceId,
      `correct route ${spec.constructionId} origin handle assignment`,
    );
    requireIdentity(
      correctRoute.insertion?.assignedFromConstructionId,
      spec.constructionId,
      `correct route ${spec.constructionId} insertion assignment`,
    );
    requireIdentity(
      correctRoute.insertion?.assignedHandleInstanceId,
      correctRoute.insertion?.authoredHandleInstanceId,
      `correct route ${spec.constructionId} insertion handle assignment`,
    );

    const correctPreserved = structuredClone(correctRoute);
    const wrongPreserved = structuredClone(wrongRoute);
    delete correctPreserved.insertion;
    delete wrongPreserved.insertion;
    if (JSON.stringify(canonical(correctPreserved)) !== JSON.stringify(canonical(wrongPreserved))) {
      throw new Error(
        `matched-wrong route ${spec.constructionId} changes fields outside insertion assignment, including origin assignment`,
      );
    }

    const donorRoute = correct.routes[ROUTE_SPECS.length - 1 - index];
    const expectedInsertion = structuredClone(donorRoute.insertion);
    expectedInsertion.authoredHandleInstanceId = correctRoute.insertion.authoredHandleInstanceId;
    expectedInsertion.assignedFromConstructionId = donorRoute.constructionId;
    if (JSON.stringify(canonical(wrongRoute.insertion)) !== JSON.stringify(canonical(expectedInsertion))) {
      throw new Error(`matched-wrong route ${spec.constructionId} does not carry the intended insertion permutation`);
    }
  });
  if (correct.deepGeometryContentSetSha256 !== matchedWrong.deepGeometryContentSetSha256) {
    throw new Error('matched-wrong condition does not preserve deep geometry content');
  }
  if (correct.attachmentEndpointMultisetSha256 !== matchedWrong.attachmentEndpointMultisetSha256) {
    throw new Error('matched-wrong condition does not preserve the effective endpoint inventory');
  }
  if (hashJson(correct.representationalBudget) !== hashJson(matchedWrong.representationalBudget)) {
    throw new Error('matched-wrong condition does not preserve representational budget');
  }
  if (correct.routingGraphSha256 === matchedWrong.routingGraphSha256) {
    throw new Error('matched-wrong condition does not destroy the selected routing graph');
  }
  return true;
}

function validateNull(graph, assay, spec) {
  const route = validateRoute(graph, assay, spec, [spec.sourceName, spec.sourceName]);
  return {
    constructionId: route.constructionId,
    instanceId: route.instanceId,
    lineageId: route.lineageId,
    sourceName: spec.sourceName,
    sameObject: true,
    originPoint: route.origin.point,
    insertionPoint: route.insertion.point,
    pathGeometrySha256: route.components.pathGeometrySha256,
    surfaceGeometrySha256: route.components.surfaceGeometrySha256,
  };
}

export function compileTrackMRoutingFixture(graphBytes, assayBytes, options = {}) {
  const graphInput = parseAuthenticatedBytes(graphBytes, 'source graph');
  const assayInput = parseAuthenticatedBytes(assayBytes, 'geometry assay');
  const graph = graphInput.value;
  const assay = assayInput.value;
  const authenticatedOptions = {
    ...options,
    graphFileSha256: graphInput.sha256,
    assayFileSha256: assayInput.sha256,
  };
  assertSourceIdentities(graph, assay, authenticatedOptions);
  const authoredRoutes = ROUTE_SPECS.map(spec => validateRoute(graph, assay, spec));
  const correctRoutes = authoredRoutes.map(route => assignedRoute(route));
  const wrongRoutes = authoredRoutes.map((route, index) => assignedRoute(route, authoredRoutes[1 - index]));
  const correct = condition('deep-geometry-correctly-routed', 'preserve-correct-routing', correctRoutes);
  const matchedWrong = condition('deep-geometry-matched-wrong-routing', 'matched-wrong-routing', wrongRoutes);
  validateMatchedRoutePreservation(correct, matchedWrong);

  const deltaRoutes = authoredRoutes.map((route, index) => {
    const crossWireChordLength = distance(route.origin.point, authoredRoutes[1 - index].insertion.point);
    const absoluteChange = crossWireChordLength - route.authoredChordLength;
    const relativeChange = absoluteChange / route.authoredChordLength;
    return {
      constructionId: route.constructionId,
      authoredChordLength: route.authoredChordLength,
      crossWireChordLength,
      absoluteChange,
      relativeChange,
      relativePercent: relativeChange * 100,
    };
  });

  const fixtureCore = {
    compilerId: TRACK_M_ROUTING_FIXTURE_COMPILER_ID,
    status: 'compiled',
    trackId: TRACK_ID,
    selection: {
      id: 'cube002-cube003-m31-m47-routing-sensitivity-v0',
      family: { originSource: 'Cube.002', insertionSource: 'Cube.003' },
      correctConstructionId: 'muscle-31',
      crossWireDonorConstructionId: 'muscle-47',
      nullConstructionIds: NULL_SPECS.map(spec => spec.constructionId),
      selectionAuthority: 'track-m-relation-selection-2026-08-03',
    },
    source: {
      assetSha256: graph.source.sha256,
      requestedAssetPath: graph.source.requestedPath,
      effectiveAssetPath: graph.source.effectivePath,
      graphSha256: graph.graphSha256,
      graphFileSha256: authenticatedOptions.graphFileSha256,
      geometryAssayFileSha256: authenticatedOptions.assayFileSha256,
      graphCompilerId: graph.compilerId,
    },
    conditions: { correct, matchedWrong },
    nulls: NULL_SPECS.map(spec => validateNull(graph, assay, spec)),
    deltaLedger: {
      routes: deltaRoutes,
      maximumAbsoluteRelativeChange: Math.max(...deltaRoutes.map(route => Math.abs(route.relativeChange))),
      tolerance: null,
      toleranceAuthority: 'unassigned',
      budgetMatchStatus: 'measured-awaiting-owner-tolerance',
    },
    fieldLedger: {
      preserved: [
        'source.asset.identity',
        'source.graph.identity',
        'route.set.identity',
        'route.identity',
        'route.origin.assignment',
        'component.identity',
        'component.geometry.identity',
        'authored.completeness',
        'endpoint.route',
        'endpoint.strategy',
        'muscle.settings',
        'attachment.endpoint.multiset',
        'deep.geometry.content.set',
        'representational.budget',
        'total.route.count',
      ],
      changed: authoredRoutes.map((route, index) => ({
        field: `routes.${route.constructionId}.insertion.assignment`,
        from: {
          assignedFromConstructionId: route.constructionId,
          assignedHandleInstanceId: route.insertion.assignedHandleInstanceId,
          sourceName: route.insertion.sourceName,
          point: route.insertion.point,
          matrixWorld: route.insertion.matrixWorld,
        },
        to: {
          assignedFromConstructionId: authoredRoutes[1 - index].constructionId,
          assignedHandleInstanceId: authoredRoutes[1 - index].insertion.assignedHandleInstanceId,
          sourceName: authoredRoutes[1 - index].insertion.sourceName,
          point: authoredRoutes[1 - index].insertion.point,
          matrixWorld: authoredRoutes[1 - index].insertion.matrixWorld,
        },
      })),
    },
    geometricCoherence: {
      endpointCoordinates: 'byte-bound-full-precision-assay-points',
      endpointTransforms: 'byte-bound-rounded-source-graph-matrices',
      endpointRegistrationEpsilon: REGISTRATION_EPSILON,
      chordConsistencyEpsilon: CHORD_CONSISTENCY_EPSILON,
      authoredChordAuthority: 'byte-bound-independent-assay-measurement',
      counterfactualChordAuthority: 'derived-from-byte-bound-full-precision-assay-points',
      centerlineCoordinates: 'unavailable-hash-only',
      surfaceCoordinates: 'unavailable-hash-only',
      packingAdmission: 'identity-coherent_geometry-unavailable',
    },
    authority: {
      admittedClaims: ['source-side-routing-sensitivity-fixture'],
      heldClaims: [
        'correct-route-superiority',
        'musculature-source-evidence',
        'selected-relation-m0',
        'station-instance',
        'source-to-cast-correspondence',
        'expected-signed-localization',
        'packing-geometry-admission',
      ],
    },
  };
  return canonical({
    schema: TRACK_M_ROUTING_FIXTURE_SCHEMA,
    fixtureSha256: hashJson(fixtureCore),
    ...fixtureCore,
  });
}
