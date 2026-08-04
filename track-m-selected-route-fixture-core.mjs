import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { TRACK_M_ROUTING_FIXTURE_SCHEMA } from './track-m-routing-fixture-core.mjs';

export const TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID = 'track-m-current-graph-selected-route-fixture-v0';
export const TRACK_M_SELECTED_ROUTE_FIXTURE_FAILURE_SCHEMA = 'kaminos.track-m-selected-route-fixture-failure.v0';

const SOURCE_GRAPH_SCHEMA = 'kaminos.track-m-authored-source-graph.v0';
const AUTHORITY_RECEIPT_SCHEMA = 'kaminos.authored-muscle-coordinate-authority-receipt.v0';
const TRACK_ID = 'shape-bearing-musculature';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_ROW_AUTHORITY_FIELDS = Object.freeze([
  'attachments.insertion.position',
  'attachments.origin.position',
  'centerline',
  'targetVolume',
  'volumeAuthority',
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
  return { value, sha256: createHash('sha256').update(bytes).digest('hex') };
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

function requireIdentity(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual ?? '<missing>'}`);
}

function requireExactArray(actual, expected, label) {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${expected.join(', ')}`);
  }
}

function requireFinitePoint(point, label) {
  if (!Array.isArray(point) || point.length !== 3 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must be a finite 3D point`);
  }
  return [...point];
}

function pointFromMatrix(matrix, label) {
  if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} matrix must contain 16 finite values`);
  }
  return [matrix[3], matrix[7], matrix[11]];
}

function distance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function samePoint(left, right, epsilon = 1e-9) {
  return distance(left, right) <= epsilon;
}

function uniqueByConstruction(items, constructionId, accessor, label) {
  if (!Array.isArray(items)) throw new Error(`${label} must be an array`);
  const matches = items.filter(item => accessor(item) === constructionId);
  if (matches.length === 0) throw new Error(`${constructionId} is missing from ${label}`);
  if (matches.length !== 1) throw new Error(`${constructionId} is duplicated in ${label}`);
  return matches[0];
}

function receiptCore(receipt) {
  const { receiptSha256: ignored, ...core } = receipt;
  return core;
}

function assertEnvelope(graphBytes, receiptBytes, options) {
  requireObject(options, 'compiler options');
  if (!Array.isArray(options.expectedConstructionIds) || options.expectedConstructionIds.length < 2 || options.expectedConstructionIds.length > 8) {
    throw new Error('expected construction ids must contain between two and eight routes');
  }
  if (new Set(options.expectedConstructionIds).size !== options.expectedConstructionIds.length) {
    throw new Error('expected construction ids must be unique');
  }
  options.expectedConstructionIds.forEach((id, index) => requireString(id, `expected construction id[${index}]`));
  for (const [value, label] of [
    [options.expectedSourceSha256, 'expected source hash'],
    [options.expectedGraphSha256, 'expected graph identity'],
    [options.expectedGraphFileSha256, 'expected graph file hash'],
    [options.expectedReceiptFileSha256, 'expected authority receipt file hash'],
  ]) requireHash(value, label);

  requireIdentity(graphBytes.sha256, options.expectedGraphFileSha256, 'graph file SHA-256');
  requireIdentity(receiptBytes.sha256, options.expectedReceiptFileSha256, 'authority receipt file SHA-256');

  const graph = graphBytes.value;
  const receipt = receiptBytes.value;
  requireIdentity(graph.schema, SOURCE_GRAPH_SCHEMA, 'source graph schema');
  requireIdentity(graph.status, 'compiled', 'source graph status');
  requireIdentity(graph.trackId, TRACK_ID, 'source graph track');
  requireIdentity(graph.graphSha256, options.expectedGraphSha256, 'graph identity');
  requireObject(graph.source, 'source graph source');
  requireIdentity(graph.source.sha256, options.expectedSourceSha256, 'source graph source SHA-256');
  if (!Array.isArray(graph.muscles)) throw new Error('source graph muscles must be an array');

  requireIdentity(receipt.schema, AUTHORITY_RECEIPT_SCHEMA, 'authority receipt schema');
  requireIdentity(receipt.status, 'authority-incomplete', 'authority receipt status');
  requireIdentity(receipt.admitted, false, 'authority receipt admission');
  requireHash(receipt.receiptSha256, 'authority receipt internal identity');
  requireIdentity(hashJson(receiptCore(receipt)), receipt.receiptSha256, 'authority receipt internal identity');
  requireObject(receipt.source, 'authority receipt source');
  requireIdentity(receipt.source.assetSha256, options.expectedSourceSha256, 'authority receipt source SHA-256');
  requireIdentity(receipt.source.graphSha256, options.expectedGraphSha256, 'authority receipt graph identity');
  requireIdentity(receipt.source.graphFileSha256, options.expectedGraphFileSha256, 'authority receipt graph file SHA-256');
  requireExactArray(receipt.request?.requestedConstructionIds, options.expectedConstructionIds, 'authority receipt requested construction order');
  requireExactArray(receipt.request?.effectiveConstructionIds, options.expectedConstructionIds, 'authority receipt effective construction order');
  requireExactArray(receipt.rows?.map(row => row.constructionId), options.expectedConstructionIds, 'authority receipt row order');
  requireExactArray(
    receipt.packingSelectionAuthority?.rows?.map(row => row.constructionId),
    options.expectedConstructionIds,
    'packing selection authority row order',
  );
  return { graph, receipt };
}

function validateCandidateField(row, authorityRow, field, expectedPoint = null) {
  const value = row.fields?.[field];
  if (row.state !== 'candidate') throw new Error(`${row.constructionId} state must remain candidate`);
  if (authorityRow?.state !== 'candidate') throw new Error(`${row.constructionId} packing selection state must remain candidate`);
  if (authorityRow.requiredFields?.[field] !== 'candidate') {
    throw new Error(`${row.constructionId} ${field} authority must remain candidate`);
  }
  if (value?.state !== 'candidate' || value.selected !== null) {
    throw new Error(`${row.constructionId} ${field} receipt field must remain unselected candidate`);
  }
  if (!Array.isArray(value.candidates) || value.candidates.length === 0 || value.candidates.some(candidate => candidate.authority !== 'candidate')) {
    throw new Error(`${row.constructionId} ${field} candidates must retain candidate authority`);
  }
  if (expectedPoint) {
    const points = value.candidates.map(candidate => candidate.value).filter(candidate => Array.isArray(candidate));
    if (!points.some(point => samePoint(requireFinitePoint(point, `${row.constructionId} ${field} candidate`), expectedPoint))) {
      throw new Error(`${row.constructionId} ${field} has no current-graph point measurement`);
    }
  }
}

function validateRoute(graph, receipt, constructionId) {
  const muscle = uniqueByConstruction(graph.muscles, constructionId, item => item.identity?.construction_id, 'source graph');
  const row = uniqueByConstruction(receipt.rows, constructionId, item => item.constructionId, 'authority receipt');
  const authorityRow = uniqueByConstruction(
    receipt.packingSelectionAuthority.rows,
    constructionId,
    item => item.constructionId,
    'packing selection authority',
  );
  requireIdentity(row.name, muscle.name, `${constructionId} name`);
  requireIdentity(row.lineageId, muscle.identity?.lineage_id, `${constructionId} lineage`);
  requireIdentity(row.instanceId, muscle.identity?.instance_id, `${constructionId} instance`);
  if (muscle.completenessAuthority !== 'declared_components_present' || muscle.missingComponentRoles?.length !== 0) {
    throw new Error(`${constructionId} is not a complete declared construction`);
  }

  const graphComponentIds = Object.values(muscle.components ?? {}).map(component => component?.identity?.construction_id);
  const graphComponentInstances = Object.values(muscle.components ?? {}).map(component => component?.identity?.instance_id);
  requireExactArray(row.selectedConstructionIds, graphComponentIds, `${constructionId} selected component constructions`);
  requireExactArray(row.selectedComponentInstanceIds, graphComponentInstances, `${constructionId} selected component instances`);

  const components = {};
  for (const role of ['path', 'surface']) {
    const component = muscle.components?.[role];
    requireObject(component, `${constructionId} ${role} component`);
    requireObject(component.identity, `${constructionId} ${role} identity`);
    requireObject(component.geometry, `${constructionId} ${role} geometry`);
    requireHash(component.geometry.contentSha256, `${constructionId} ${role} geometry identity`);
    requireIdentity(row.components?.[`${role}InstanceId`], component.identity.instance_id, `${constructionId} ${role} instance`);
    requireIdentity(row.components?.[`${role}GeometrySha256`], component.geometry.contentSha256, `${constructionId} ${role} geometry`);
    components[`${role}InstanceId`] = component.identity.instance_id;
    components[`${role}GeometrySha256`] = component.geometry.contentSha256;
  }
  Object.assign(components, {
    originInstanceId: muscle.components?.origin?.identity?.instance_id,
    insertionInstanceId: muscle.components?.insertion?.identity?.instance_id,
    pathPointCount: muscle.components.path.geometry.pointCount,
    surfaceVertexCount: muscle.components.surface.geometry.vertexCount,
    surfaceEdgeCount: muscle.components.surface.geometry.edgeCount,
    surfacePolygonCount: muscle.components.surface.geometry.polygonCount,
  });

  const endpoint = role => {
    const source = muscle[role];
    const component = muscle.components?.[role];
    requireObject(source, `${constructionId} ${role} source`);
    requireObject(component, `${constructionId} ${role} component`);
    requireIdentity(source.sourceAuthority, 'source_mesh', `${constructionId} ${role} source authority`);
    requireIdentity(row.sourceAuthorities?.[role], source.sourceAuthority, `${constructionId} ${role} row source authority`);
    requireIdentity(row.attachments?.[role]?.id, source.handleInstanceId, `${constructionId} ${role} handle`);
    requireIdentity(row.attachments?.[role]?.sourceAuthority, source.sourceAuthority, `${constructionId} ${role} attachment authority`);
    const point = pointFromMatrix(component.matrixWorld, `${constructionId} ${role}`);
    validateCandidateField(row, authorityRow, `attachments.${role}.position`, point);
    return {
      authoredHandleInstanceId: source.handleInstanceId,
      assignedFromConstructionId: constructionId,
      assignedHandleInstanceId: source.handleInstanceId,
      sourceAuthority: source.sourceAuthority,
      sourceName: source.sourceName,
      point,
      matrixWorld: [...component.matrixWorld],
      graphToReceiptRegistrationDelta: 0,
    };
  };

  const origin = endpoint('origin');
  const insertion = endpoint('insertion');
  for (const field of REQUIRED_ROW_AUTHORITY_FIELDS.filter(field => !field.startsWith('attachments.'))) {
    validateCandidateField(row, authorityRow, field);
  }
  const chordLength = distance(origin.point, insertion.point);
  return canonical({
    constructionId,
    name: muscle.name,
    instanceId: muscle.identity.instance_id,
    lineageId: muscle.identity.lineage_id,
    authoredCompleteness: muscle.authoredCompleteness,
    completenessAuthority: muscle.completenessAuthority,
    endpointRoute: muscle.endpointRoute,
    endpointStrategy: muscle.endpointStrategy,
    settings: structuredClone(muscle.settings),
    components,
    origin,
    insertion,
    authoredChordLength: chordLength,
    endpointDerivedChordLength: chordLength,
    chordConsistencyDelta: 0,
  });
}

function representationalBudget(routes) {
  const sum = (selector, fallback = 0) => routes.reduce((total, route) => total + (selector(route) ?? fallback), 0);
  return canonical({
    routeCount: routes.length,
    pathPointCount: sum(route => route.components.pathPointCount),
    surfaceVertexCount: sum(route => route.components.surfaceVertexCount),
    surfaceEdgeCount: sum(route => route.components.surfaceEdgeCount),
    surfacePolygonCount: sum(route => route.components.surfacePolygonCount),
    longitudinalSectionCount: sum(route => route.settings?.longitudinal_sections),
    profileSideCount: sum(route => route.settings?.profile_sides),
    originTendonFractionSum: sum(route => route.settings?.origin_tendon_fraction),
    insertionTendonFractionSum: sum(route => route.settings?.insertion_tendon_fraction),
  });
}

function condition(routes) {
  const transform = canonical({
    id: `current-graph-correctly-routed-${routes.map(route => route.constructionId).join('-')}-v0`,
    kind: 'preserve-current-graph-routing',
    constructionIds: routes.map(route => route.constructionId),
  });
  return canonical({
    id: 'current-graph-selected-route-correct',
    transform: { ...transform, sha256: hashJson(transform) },
    representationalBudget: representationalBudget(routes),
    routes,
    routingGraphSha256: hashJson(routes.map(route => ({
      constructionId: route.constructionId,
      lineageId: route.lineageId,
      instanceId: route.instanceId,
      origin: route.origin,
      insertion: route.insertion,
    }))),
    deepGeometryContentSetSha256: hashJson(routes.map(route => ({
      constructionId: route.constructionId,
      pathGeometrySha256: route.components.pathGeometrySha256,
      surfaceGeometrySha256: route.components.surfaceGeometrySha256,
    }))),
    attachmentEndpointMultisetSha256: hashJson(
      routes.flatMap(route => [route.origin, route.insertion].map(endpoint => ({
        assignedHandleInstanceId: endpoint.assignedHandleInstanceId,
        point: endpoint.point,
        sourceAuthority: endpoint.sourceAuthority,
      }))).sort((left, right) => left.assignedHandleInstanceId.localeCompare(right.assignedHandleInstanceId)),
    ),
  });
}

export function compileTrackMSelectedRouteFixture(sourceGraphBytes, authorityReceiptBytes, options) {
  const graphBytes = parseAuthenticatedBytes(sourceGraphBytes, 'source graph');
  const receiptBytes = parseAuthenticatedBytes(authorityReceiptBytes, 'authority receipt');
  const { graph, receipt } = assertEnvelope(graphBytes, receiptBytes, options);
  const routes = options.expectedConstructionIds.map(constructionId => validateRoute(graph, receipt, constructionId));

  const authorityRows = options.expectedConstructionIds.map(constructionId => {
    const row = uniqueByConstruction(
      receipt.packingSelectionAuthority.rows,
      constructionId,
      item => item.constructionId,
      'packing selection authority',
    );
    return canonical(structuredClone(row));
  });
  const core = canonical({
    compilerId: TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID,
    status: 'compiled',
    source: {
      assetSha256: options.expectedSourceSha256,
      requestedAssetPath: graph.source.requestedPath,
      effectiveAssetPath: graph.source.effectivePath,
      graphCompilerId: graph.compilerId,
      graphSha256: options.expectedGraphSha256,
      graphFileSha256: options.expectedGraphFileSha256,
      authorityReceiptId: receipt.id,
      authorityReceiptSha256: receipt.receiptSha256,
      authorityReceiptFileSha256: options.expectedReceiptFileSha256,
    },
    selection: {
      id: `current-graph-k${routes.length}-${routes.map(route => route.constructionId.replace('muscle-', 'm')).join('-')}-v0`,
      constructionIds: [...options.expectedConstructionIds],
      selectionAuthority: 'exact-ordered-candidate-authority-receipt',
      authorityReceipt: {
        id: receipt.id,
        sha256: receipt.receiptSha256,
        fileSha256: options.expectedReceiptFileSha256,
        status: receipt.status,
        admitted: receipt.admitted,
        rows: authorityRows,
        sharedFields: canonical(structuredClone(receipt.packingSelectionAuthority.sharedFields)),
      },
    },
    conditions: { correct: condition(routes) },
    authority: {
      geometryAuthority: 'candidate',
      admittedClaims: ['current-graph-selected-route-identity-fixture'],
      heldClaims: [
        'authority-complete-coordinate-carrier',
        'packing-geometry-admission',
        'packing-solve',
        'selected-relation-m0',
        'station-instance',
        'source-to-cast-correspondence',
        'expected-signed-localization',
        'correct-route-superiority',
      ],
    },
  });
  return canonical({
    schema: TRACK_M_ROUTING_FIXTURE_SCHEMA,
    fixtureSha256: hashJson(core),
    ...core,
  });
}
