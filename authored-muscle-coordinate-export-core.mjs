import { createHash } from 'node:crypto';

import {
  AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA,
} from './authored-muscle-packing-intake-core.mjs';
import { TRACK_M_ROUTING_FIXTURE_SCHEMA } from './track-m-routing-fixture-core.mjs';

export const AUTHORED_MUSCLE_COORDINATE_PARENT_ATLAS_SCHEMA =
  'kaminos.authored-muscle-coordinate-parent-atlas.v0';
export const AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA =
  'kaminos.authored-muscle-coordinate-authority-receipt.v0';
export const AUTHORED_MUSCLE_COORDINATE_EXPORT_FAILURE_SCHEMA =
  'kaminos.authored-muscle-coordinate-export-failure.v0';

const EXTRACTION_SCHEMA = 'kaminos.track-m-blender-extraction.v0';
const SOURCE_GRAPH_SCHEMA = 'kaminos.track-m-authored-source-graph.v0';
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_ROW_FIELDS = Object.freeze([
  'attachments.origin.position',
  'attachments.insertion.position',
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

export function hashCanonicalJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function requireSchema(value, expected, label) {
  if (value?.schema !== expected) throw new Error(`${label} schema mismatch: ${value?.schema ?? 'missing'}`);
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function samePoint(left, right, tolerance = 1e-6) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 3 && right.length === 3
    && left.every((value, index) => Number.isFinite(value)
      && Number.isFinite(right[index])
      && Math.abs(value - right[index]) <= tolerance);
}

function translation(matrix, label) {
  if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some(value => !Number.isFinite(value))) {
    throw new Error(`${label} matrixWorld must contain 16 finite numbers`);
  }
  return [matrix[3], matrix[7], matrix[11]].map(value => Object.is(value, -0) ? 0 : value);
}

function transformPoint(matrix, rawPoint, label) {
  if (!Array.isArray(rawPoint) || rawPoint.length < 3) throw new Error(`${label} point must contain three coordinates`);
  const [x, y, z] = rawPoint;
  if (![x, y, z].every(Number.isFinite)) throw new Error(`${label} point must be finite`);
  if (!Array.isArray(matrix) || matrix.length !== 16) throw new Error(`${label} matrixWorld must contain 16 values`);
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ].map(value => Object.is(value, -0) ? 0 : value);
}

function determinant3(matrix) {
  return (
    matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[1] * (matrix[4] * matrix[10] - matrix[6] * matrix[8])
    + matrix[2] * (matrix[4] * matrix[9] - matrix[5] * matrix[8])
  );
}

function graphConstructionId(muscle) {
  return muscle?.identity?.construction_id;
}

function routeEvidence(constructionId, suffix) {
  return `sourceGraph.muscles[constructionId=${constructionId}]${suffix}`;
}

function fieldRecord({ candidates = [], authorityCandidateKind = null, missingReason = null }) {
  if (candidates.length === 0) {
    return {
      state: 'missing',
      selected: null,
      candidates: [],
      reason: missingReason ?? 'no source-backed candidate was extracted',
    };
  }
  const authorityConflict = candidates.find(candidate => candidate.authorityConflict)?.authorityConflict;
  if (authorityConflict) {
    return {
      state: 'conflict',
      selected: null,
      candidates,
      reason: `${authorityConflict.field} authority binding expected ${authorityConflict.expected ?? 'missing'} but received ${authorityConflict.actual ?? 'missing'}`,
    };
  }
  const first = candidates[0].value;
  const disagreement = candidates.some(candidate => !samePoint(first, candidate.value));
  if (disagreement) {
    return {
      state: 'conflict',
      selected: null,
      candidates,
      reason: 'named source-backed candidates disagree and no conflict resolution authority is present',
    };
  }
  const selected = authorityCandidateKind
    ? candidates.find(candidate => candidate.kind === authorityCandidateKind) ?? null
    : null;
  return {
    state: selected ? 'admitted' : 'candidate',
    selected: selected ? structuredClone(selected) : null,
    candidates,
    reason: selected
      ? null
      : 'mechanically measured agreement is not an authority source',
  };
}

function scalarFieldRecord({ candidates = [], missingReason = null }) {
  if (candidates.length === 0) {
    return { state: 'missing', selected: null, candidates: [], reason: missingReason };
  }
  const first = candidates[0].value;
  const disagreement = candidates.some(candidate => !same(first, candidate.value));
  return {
    state: disagreement ? 'conflict' : 'candidate',
    selected: null,
    candidates,
    reason: disagreement
      ? 'named source-backed candidates disagree and no conflict resolution authority is present'
      : 'mechanically derived value is not admitted authority',
  };
}

function curveNativeSamples(muscle) {
  const path = muscle.components?.path;
  const splines = path?.geometry?.nativeSplines;
  if (!Array.isArray(splines) || splines.length !== 1 || !Array.isArray(splines[0].points)) return [];
  return splines[0].points.map((point, index) => ({
    position: transformPoint(path.matrixWorld, point.co, `${graphConstructionId(muscle)} path point ${index}`),
    radius: Number.isFinite(point.radius) ? point.radius : null,
    nativeIndex: index,
  }));
}

function arcLength(samples) {
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    total += Math.hypot(...samples[index].position.map(
      (value, axis) => value - samples[index - 1].position[axis],
    ));
  }
  return total;
}

function resamplePolyline(samples, count = 13) {
  if (samples.length < 2) return samples.map(sample => structuredClone(sample));
  const cumulative = [0];
  for (let index = 1; index < samples.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(...samples[index].position.map(
      (value, axis) => value - samples[index - 1].position[axis],
    )));
  }
  const total = cumulative.at(-1);
  if (total === 0) return samples.map(sample => structuredClone(sample));
  return Array.from({ length: count }, (_, outputIndex) => {
    const distance = total * outputIndex / (count - 1);
    let right = cumulative.findIndex(value => value >= distance);
    if (right <= 0) right = 1;
    const left = right - 1;
    const span = cumulative[right] - cumulative[left];
    const amount = span === 0 ? 0 : (distance - cumulative[left]) / span;
    const leftSample = samples[left];
    const rightSample = samples[right];
    const radius = Number.isFinite(leftSample.radius) && Number.isFinite(rightSample.radius)
      ? leftSample.radius + (rightSample.radius - leftSample.radius) * amount
      : null;
    return {
      position: leftSample.position.map(
        (value, axis) => value + (rightSample.position[axis] - value) * amount,
      ),
      radius,
      arcFraction: outputIndex / (count - 1),
    };
  });
}

function matchingFixtureRoute(routingFixture, muscle) {
  const constructionId = graphConstructionId(muscle);
  const route = routingFixture?.conditions?.correct?.routes?.find(
    candidate => candidate.constructionId === constructionId,
  );
  if (!route) return null;
  const identityMatches = route.lineageId === muscle.identity.lineage_id
    && route.instanceId === muscle.identity.instance_id
    && route.components?.surfaceInstanceId === muscle.components?.surface?.identity?.instance_id
    && route.components?.surfaceGeometrySha256 === muscle.components?.surface?.geometry?.contentSha256
    && route.components?.pathInstanceId === muscle.components?.path?.identity?.instance_id
    && route.components?.pathGeometrySha256 === muscle.components?.path?.geometry?.contentSha256;
  return identityMatches ? route : null;
}

function visibleSurfaceEndpoint(muscle, endpoint) {
  const surface = muscle.components?.surface;
  const vertices = surface?.geometry?.sourceMeasurements?.vertexPositions;
  const originComponent = muscle.components?.origin;
  const insertionComponent = muscle.components?.insertion;
  if (!Array.isArray(vertices) || vertices.length === 0 || !originComponent || !insertionComponent) {
    return surface?.geometry?.sourceMeasurements?.endpointCandidates?.[endpoint] ?? null;
  }
  const origin = translation(originComponent.matrixWorld, `${graphConstructionId(muscle)} origin`);
  const insertion = translation(insertionComponent.matrixWorld, `${graphConstructionId(muscle)} insertion`);
  const axis = insertion.map((value, index) => value - origin[index]);
  const magnitude = Math.hypot(...axis);
  if (magnitude === 0) return null;
  const unit = axis.map(value => value / magnitude);
  const worldVertices = vertices.map((vertex, index) => (
    transformPoint(surface.matrixWorld, vertex, `${graphConstructionId(muscle)} surface vertex ${index}`)
  ));
  const projections = worldVertices.map(vertex => vertex.reduce(
    (sum, value, index) => sum + value * unit[index],
    0,
  ));
  const extreme = endpoint === 'origin' ? Math.min(...projections) : Math.max(...projections);
  const axialTieTolerance = Math.max(1e-6, magnitude * 2e-7);
  const tied = worldVertices.filter(
    (vertex, index) => Math.abs(projections[index] - extreme) <= axialTieTolerance,
  );
  return tied.reduce(
    (sum, vertex) => sum.map((value, index) => value + vertex[index] / tied.length),
    [0, 0, 0],
  );
}

function fixtureEndpointAuthority(routingFixture, constructionId, endpoint) {
  const receipt = routingFixture?.selection?.authorityReceipt;
  const receiptPresent = receipt && typeof receipt === 'object';
  const receiptRow = Array.isArray(receipt?.rows)
    ? receipt.rows.find(row => row.constructionId === constructionId)
    : null;
  const field = `attachments.${endpoint}.position`;
  const fieldState = receiptRow?.requiredFields?.[field] ?? null;
  const geometryState = routingFixture?.authority?.geometryAuthority ?? null;
  const explicitStates = [
    ...(receiptPresent ? [fieldState] : []),
    ...(geometryState ? [geometryState] : []),
  ];
  return {
    admitted: explicitStates.length === 0 || explicitStates.every(state => state === 'admitted'),
    evidenceLocators: [
      ...(receiptPresent
        ? [`routingFixture.selection.authorityReceipt.rows[constructionId=${constructionId}].requiredFields.${field}`]
        : []),
      ...(geometryState ? ['routingFixture.authority.geometryAuthority'] : []),
    ],
  };
}

function endpointField(muscle, endpoint, fixtureRoute, routingFixture) {
  const constructionId = graphConstructionId(muscle);
  const component = muscle.components?.[endpoint];
  const nativeSamples = curveNativeSamples(muscle);
  const pathPoint = endpoint === 'origin' ? nativeSamples[0] : nativeSamples.at(-1);
  const surfaceValue = visibleSurfaceEndpoint(muscle, endpoint);
  const fixtureEndpoint = fixtureRoute?.[endpoint];
  const expectedHandleInstanceId = component?.identity?.instance_id ?? null;
  const fixtureHandleMatches = fixtureEndpoint?.assignedHandleInstanceId === expectedHandleInstanceId;
  const fixtureAuthority = fixtureEndpointAuthority(routingFixture, constructionId, endpoint);
  const fixtureEndpointAdmitted = fixtureEndpoint?.sourceAuthority === 'source_mesh'
    && fixtureHandleMatches
    && fixtureAuthority.admitted;
  const candidates = [];
  if (component) {
    candidates.push({
      kind: 'helper-transform',
      value: translation(component.matrixWorld, `${constructionId} ${endpoint}`),
      method: 'component-world-matrix-translation',
      authority: 'candidate',
      evidenceLocators: [routeEvidence(constructionId, `.components.${endpoint}.matrixWorld`)],
    });
  }
  if (pathPoint) {
    candidates.push({
      kind: 'curve-endpoint',
      value: pathPoint.position,
      method: endpoint === 'origin' ? 'native-path-first-sample' : 'native-path-last-sample',
      authority: 'candidate',
      evidenceLocators: [routeEvidence(constructionId, '.components.path.geometry.nativeSplines')],
    });
  }
  if (Array.isArray(surfaceValue)) {
    candidates.push({
      kind: 'visible-surface-endpoint',
      value: structuredClone(surfaceValue),
      method: 'source-surface-endpoint-measurement',
      authority: 'candidate',
      evidenceLocators: [routeEvidence(constructionId, `.components.surface.geometry.sourceMeasurements.endpointCandidates.${endpoint}`)],
    });
  }
  if (fixtureEndpoint?.point) {
    candidates.push({
      kind: 'routing-fixture-endpoint',
      value: structuredClone(fixtureEndpoint.point),
      method: 'reviewed-routing-fixture-selection',
      authority: fixtureEndpointAdmitted ? 'admitted' : 'candidate',
      ...(!fixtureHandleMatches ? {
        authorityConflict: {
          field: 'assignedHandleInstanceId',
          expected: expectedHandleInstanceId,
          actual: fixtureEndpoint.assignedHandleInstanceId ?? null,
        },
      } : {}),
      evidenceLocators: [
        `routingFixture.conditions.correct.routes[constructionId=${constructionId}].${endpoint}`,
        ...fixtureAuthority.evidenceLocators,
      ],
    });
  }
  return fieldRecord({
    candidates,
    authorityCandidateKind: fixtureEndpointAdmitted ? 'routing-fixture-endpoint' : null,
  });
}

function centerlineField(muscle) {
  const constructionId = graphConstructionId(muscle);
  const nativeSamples = curveNativeSamples(muscle);
  if (nativeSamples.length < 2) {
    return scalarFieldRecord({
      missingReason: 'native source curve samples are absent or do not form a line',
    });
  }
  const resampledSamples = resamplePolyline(nativeSamples);
  return scalarFieldRecord({ candidates: [{
    kind: 'source-curve-centerline',
    value: {
      nativeSamples,
      resampledSamples,
      sourcePathSha256: muscle.components.path.geometry.contentSha256,
      arcLength: arcLength(nativeSamples),
      resamplingResidual: 0,
    },
    method: 'world-transform-native-polyline-and-uniform-arc-resample',
    authority: 'candidate',
    evidenceLocators: [routeEvidence(constructionId, '.components.path.geometry.nativeSplines')],
  }] });
}

function targetVolumeField(muscle) {
  const surface = muscle.components?.surface;
  const explicitValue = surface?.geometry?.sourceMeasurements?.targetVolume;
  const localValue = surface?.geometry?.sourceMeasurements?.localTargetVolume;
  const value = Number.isFinite(explicitValue)
    ? explicitValue
    : Number.isFinite(localValue) && Array.isArray(surface?.matrixWorld)
      ? localValue * Math.abs(determinant3(surface.matrixWorld))
      : null;
  return scalarFieldRecord({
    candidates: Number.isFinite(value) ? [{
      kind: 'visible-surface-volume',
      value,
      method: 'source-mesh-volume-measurement',
      authority: 'candidate',
      evidenceLocators: [routeEvidence(graphConstructionId(muscle), '.components.surface.geometry.sourceMeasurements.targetVolume')],
    }] : [],
    missingReason: 'no source surface volume measurement is present',
  });
}

function volumeAuthorityField(muscle) {
  const measurements = muscle.components?.surface?.geometry?.sourceMeasurements;
  const targetVolume = measurements?.targetVolume ?? measurements?.localTargetVolume;
  return scalarFieldRecord({
    candidates: Number.isFinite(targetVolume) ? [{
      kind: 'volume-derivation-classification',
      value: 'source-visible-surface-measured-candidate',
      method: 'classify-source-measurement-without-promotion',
      authority: 'candidate',
      evidenceLocators: [routeEvidence(graphConstructionId(muscle), '.components.surface.geometry.sourceMeasurements')],
    }] : [],
    missingReason: 'volume derivation cannot be classified without a source measurement',
  });
}

function routeRow(muscle, routingFixture) {
  const constructionId = graphConstructionId(muscle);
  const fixtureRoute = matchingFixtureRoute(routingFixture, muscle);
  const fields = {
    'attachments.origin.position': endpointField(muscle, 'origin', fixtureRoute, routingFixture),
    'attachments.insertion.position': endpointField(muscle, 'insertion', fixtureRoute, routingFixture),
    centerline: centerlineField(muscle),
    targetVolume: targetVolumeField(muscle),
    volumeAuthority: volumeAuthorityField(muscle),
  };
  const fieldStates = REQUIRED_ROW_FIELDS.map(field => fields[field].state);
  let state = 'candidate';
  if (fieldStates.includes('conflict')) state = 'conflict';
  else if (fieldStates.includes('missing') || muscle.missingComponentRoles?.length > 0) state = 'missing';
  else if (fieldStates.every(fieldState => fieldState === 'admitted')) state = 'admitted';
  return canonical({
    constructionId,
    name: muscle.name,
    lineageId: muscle.identity.lineage_id,
    instanceId: muscle.identity.instance_id,
    state,
    selectedConstructionIds: Object.values(muscle.components ?? {})
      .filter(Boolean)
      .map(component => component.identity?.construction_id)
      .filter(Boolean),
    selectedComponentInstanceIds: Object.values(muscle.components ?? {})
      .filter(Boolean)
      .map(component => component.identity?.instance_id)
      .filter(Boolean),
    components: {
      surfaceInstanceId: muscle.components?.surface?.identity?.instance_id ?? null,
      surfaceGeometrySha256: muscle.components?.surface?.geometry?.contentSha256 ?? null,
      pathInstanceId: muscle.components?.path?.identity?.instance_id ?? null,
      pathGeometrySha256: muscle.components?.path?.geometry?.contentSha256 ?? null,
    },
    attachments: {
      origin: {
        id: muscle.components?.origin?.identity?.instance_id ?? null,
        sourceAuthority: muscle.origin?.sourceAuthority ?? null,
      },
      insertion: {
        id: muscle.components?.insertion?.identity?.instance_id ?? null,
        sourceAuthority: muscle.insertion?.sourceAuthority ?? null,
      },
    },
    sourceAuthorities: {
      origin: muscle.origin?.sourceAuthority ?? null,
      insertion: muscle.insertion?.sourceAuthority ?? null,
    },
    fields,
    reasons: [
      ...(muscle.missingComponentRoles ?? []).map(role => `missing authored component role ${role}`),
      ...Object.entries(fields)
        .filter(([, field]) => field.state === 'missing' || field.state === 'conflict')
        .map(([field, record]) => `${field}: ${record.reason}`),
    ],
  });
}

function parentCore(parentAtlas) {
  const { atlasSha256: ignored, ...core } = parentAtlas;
  return core;
}

function receiptCore(authorityReceipt) {
  const { receiptSha256: ignored, ...core } = authorityReceipt;
  return core;
}

function authorityStateRows(rows) {
  return rows.map(row => ({
    constructionId: row.constructionId,
    state: row.state,
    requiredFields: Object.fromEntries(
      REQUIRED_ROW_FIELDS.map(field => [field, row.fields[field].state]),
    ),
  }));
}

function selectedValue(field) {
  return field.selected?.value ?? field.candidates?.[0]?.value ?? null;
}

function buildCarrier({ authorityReceipt, rows, routingFixture }) {
  const complete = authorityReceipt.blockers.length === 0
    && Object.values(authorityReceipt.sharedFields).every(field => field.state === 'admitted')
    && rows.every(row => row.state === 'admitted');
  if (!complete) return null;
  return canonical({
    schema: AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA,
    id: `coordinate-carrier-${authorityReceipt.receiptSha256.slice(0, 16)}`,
    derivation: {
      kind: 'atlas-route-subset',
      atlas: structuredClone(authorityReceipt.derivation.atlas),
      selectedConstructionIds: [...authorityReceipt.derivation.selectedConstructionIds],
      selectionAuthority: {
        receipt: { id: authorityReceipt.id, sha256: authorityReceipt.receiptSha256 },
        sharedFields: Object.fromEntries(
          Object.entries(authorityReceipt.sharedFields).map(([key, field]) => [key, field.state]),
        ),
        rows: authorityStateRows(rows),
      },
    },
    source: {
      assetSha256: authorityReceipt.source.assetSha256,
      graphSha256: authorityReceipt.source.graphSha256,
      graphFileSha256: authorityReceipt.source.graphFileSha256,
      routingFixtureSha256: routingFixture.fixtureSha256,
    },
    coordinateSpace: selectedValue(authorityReceipt.sharedFields.coordinateSpace),
    compartment: selectedValue(authorityReceipt.sharedFields.compartment),
    obstacles: selectedValue(authorityReceipt.sharedFields.obstacles),
    muscles: rows.map(row => ({
      constructionId: row.constructionId,
      lineageId: row.lineageId,
      instanceId: row.instanceId,
      attachments: {
        origin: { position: selectedValue(row.fields['attachments.origin.position']) },
        insertion: { position: selectedValue(row.fields['attachments.insertion.position']) },
      },
      centerline: selectedValue(row.fields.centerline)?.resampledSamples,
      targetVolume: selectedValue(row.fields.targetVolume),
      volumeAuthority: selectedValue(row.fields.volumeAuthority),
    })),
  });
}

function routeSelectionError(message) {
  const error = new Error(message);
  error.failurePhase = 'route-selection';
  error.lastTrustworthyEvidence = 'source extraction and source graph identities verified';
  return error;
}

export function buildAuthoredMuscleCoordinateExport({
  extraction,
  sourceGraph,
  sourceGraphFileSha256,
  routingFixture,
  routingFixtureFileSha256,
  requestedConstructionIds,
}) {
  requireSchema(extraction, EXTRACTION_SCHEMA, 'source extraction');
  requireSchema(sourceGraph, SOURCE_GRAPH_SCHEMA, 'source graph');
  requireSchema(routingFixture, TRACK_M_ROUTING_FIXTURE_SCHEMA, 'routing fixture');
  requireHash(sourceGraph.graphSha256, 'source graph identity');
  requireHash(sourceGraphFileSha256, 'source graph file');
  requireHash(routingFixture.fixtureSha256, 'routing fixture identity');
  requireHash(routingFixtureFileSha256, 'routing fixture file');
  requireObject(extraction.source, 'source extraction identity');
  requireObject(sourceGraph.source, 'source graph identity');
  requireHash(extraction.source.sha256, 'source extraction asset');
  if (!same(extraction.source, sourceGraph.source)) {
    throw new Error('source extraction and source graph source identities disagree');
  }
  if (!Array.isArray(sourceGraph.muscles)) throw new Error('source graph muscles must be an array');
  if (!Array.isArray(requestedConstructionIds) || requestedConstructionIds.length === 0
    || requestedConstructionIds.some(id => typeof id !== 'string' || id.length === 0)) {
    throw routeSelectionError('requested construction ids must be a nonempty ordered string array');
  }
  if (new Set(requestedConstructionIds).size !== requestedConstructionIds.length) {
    throw routeSelectionError('requested construction ids must be unique');
  }
  const musclesById = new Map();
  for (const muscle of sourceGraph.muscles) {
    const constructionId = graphConstructionId(muscle);
    if (typeof constructionId !== 'string' || constructionId.length === 0) {
      throw new Error('source graph muscle construction id is missing');
    }
    if (musclesById.has(constructionId)) throw new Error(`duplicate source graph route ${constructionId}`);
    musclesById.set(constructionId, muscle);
  }
  for (const constructionId of requestedConstructionIds) {
    if (!musclesById.has(constructionId)) {
      throw routeSelectionError(`requested route ${constructionId} is not present in the source graph`);
    }
  }

  const routeInventory = [...musclesById.values()]
    .sort((left, right) => graphConstructionId(left).localeCompare(graphConstructionId(right)))
    .map(muscle => routeRow(muscle, routingFixture));
  const source = canonical({
    requestedBlendPath: extraction.source.requestedPath,
    effectiveBlendPath: extraction.source.effectivePath,
    assetSha256: extraction.source.sha256,
    byteLength: extraction.source.byteLength,
    graphSha256: sourceGraph.graphSha256,
    graphFileSha256: sourceGraphFileSha256,
    routingFixtureSha256: routingFixture.fixtureSha256,
    routingFixtureFileSha256,
  });
  const parentWithoutHash = canonical({
    schema: AUTHORED_MUSCLE_COORDINATE_PARENT_ATLAS_SCHEMA,
    id: `coordinate-parent-atlas-${sourceGraph.graphSha256.slice(0, 16)}`,
    source,
    sourceGraphIdentity: {
      schema: sourceGraph.schema,
      compilerId: sourceGraph.compilerId,
      graphSha256: sourceGraph.graphSha256,
    },
    completeRouteInventory: true,
    routeCount: routeInventory.length,
    routeInventory,
  });
  const parentAtlas = canonical({
    ...parentWithoutHash,
    atlasSha256: hashCanonicalJson(parentWithoutHash),
  });

  const selectedRows = requestedConstructionIds.map(constructionId => (
    routeInventory.find(row => row.constructionId === constructionId)
  ));
  const sharedFields = canonical({
    'coordinateSpace.unit': {
      state: 'candidate',
      selected: null,
      candidates: [{
        kind: 'blender-scene-unit-declaration',
        value: structuredClone(sourceGraph.scene?.unitSettings ?? extraction.scene?.unitSettings),
        method: 'preserve-blender-unit-declaration',
        authority: 'candidate',
        evidenceLocators: ['sourceGraph.scene.unitSettings'],
      }],
      reason: 'Blender unit declaration is not real-world unit authority',
    },
    coordinateSpace: {
      state: 'candidate',
      selected: null,
      candidates: [{
        kind: 'source-world-coordinate-space',
        value: { kind: 'source-world', dimension: 3, unit: 'blender-scene-unit' },
        method: 'source-object-world-matrices',
        authority: 'candidate',
        evidenceLocators: ['sourceGraph.muscles[].components.*.matrixWorld'],
      }],
      reason: 'coordinate convention is measured but unit authority is unresolved',
    },
    compartment: {
      state: 'missing', selected: null, candidates: [],
      reason: 'no named source-authority compartment exists',
    },
    obstacles: {
      state: 'missing', selected: null, candidates: [],
      reason: 'no named source-authority obstacle membership exists',
    },
  });
  const bindingConflicts = [];
  if (routingFixture.source?.assetSha256 !== source.assetSha256) {
    bindingConflicts.push('routingFixture.source.assetSha256');
  }
  if (routingFixture.source?.graphSha256 !== source.graphSha256) {
    bindingConflicts.push('routingFixture.source.graphSha256');
  }
  if (routingFixture.source?.graphFileSha256 !== source.graphFileSha256) {
    bindingConflicts.push('routingFixture.source.graphFileSha256');
  }
  const blockers = [
    ...bindingConflicts.map(field => `source-to-fixture binding conflict at ${field}`),
    ...Object.entries(sharedFields)
      .filter(([key, field]) => ['coordinateSpace.unit', 'compartment', 'obstacles'].includes(key)
        && field.state !== 'admitted')
      .map(([key, field]) => `${key} authority ${field.state}: ${field.reason}`),
    ...selectedRows.flatMap(row => Object.entries(row.fields)
      .filter(([, field]) => field.state !== 'admitted')
      .map(([field, record]) => record.state === 'conflict'
        ? `unresolved ${row.constructionId} ${field} conflict: ${record.reason}`
        : `${row.constructionId} ${field} authority ${record.state}: ${record.reason}`)),
  ];
  const receiptWithoutHash = canonical({
    schema: AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA,
    id: `coordinate-authority-receipt-${hashCanonicalJson([parentAtlas.atlasSha256, requestedConstructionIds]).slice(0, 16)}`,
    status: blockers.length === 0 ? 'authority-complete' : 'authority-incomplete',
    admitted: blockers.length === 0,
    source,
    request: {
      requestedConstructionIds: [...requestedConstructionIds],
      effectiveConstructionIds: selectedRows.map(row => row.constructionId),
    },
    derivation: {
      kind: 'atlas-route-subset',
      atlas: { id: parentAtlas.id, sha256: parentAtlas.atlasSha256 },
      selectedConstructionIds: selectedRows.map(row => row.constructionId),
    },
    sharedFields,
    rows: selectedRows,
    bindingConflicts,
    blockers,
    packingSelectionAuthority: {
      sharedFields: Object.fromEntries(
        ['coordinateSpace.unit', 'compartment', 'obstacles']
          .map(field => [field, sharedFields[field].state]),
      ),
      rows: authorityStateRows(selectedRows),
    },
  });
  const authorityReceipt = canonical({
    ...receiptWithoutHash,
    receiptSha256: hashCanonicalJson(receiptWithoutHash),
  });
  const coordinateCarrier = buildCarrier({
    authorityReceipt,
    rows: selectedRows,
    routingFixture,
  });
  return canonical({ parentAtlas, authorityReceipt, coordinateCarrier });
}

export function verifyAuthorityReceiptParentBinding(parentAtlas, authorityReceipt) {
  requireSchema(parentAtlas, AUTHORED_MUSCLE_COORDINATE_PARENT_ATLAS_SCHEMA, 'parent atlas');
  requireSchema(authorityReceipt, AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA, 'authority receipt');
  requireHash(parentAtlas.atlasSha256, 'parent atlas');
  requireHash(authorityReceipt.receiptSha256, 'authority receipt');
  const actualParentSha256 = hashCanonicalJson(parentCore(parentAtlas));
  if (actualParentSha256 !== parentAtlas.atlasSha256) {
    throw new Error('parent atlas SHA-256 does not match its effective payload');
  }
  if (authorityReceipt.derivation?.atlas?.id !== parentAtlas.id
    || authorityReceipt.derivation?.atlas?.sha256 !== parentAtlas.atlasSha256) {
    throw new Error('authority receipt parent atlas binding does not match the supplied parent');
  }
  const actualReceiptSha256 = hashCanonicalJson(receiptCore(authorityReceipt));
  if (actualReceiptSha256 !== authorityReceipt.receiptSha256) {
    throw new Error('authority receipt SHA-256 does not match its effective payload');
  }
  return true;
}

export function buildPackerAuthorityProbe(authorityReceipt) {
  requireSchema(
    authorityReceipt,
    AUTHORED_MUSCLE_COORDINATE_AUTHORITY_RECEIPT_SCHEMA,
    'authority receipt',
  );
  requireHash(authorityReceipt.receiptSha256, 'authority receipt');
  if (authorityReceipt.admitted || authorityReceipt.status === 'authority-complete') {
    throw new Error('an authority-complete receipt must use its admitted coordinate carrier, not a diagnostic probe');
  }
  const selectionAuthority = {
    receipt: {
      id: authorityReceipt.id,
      sha256: authorityReceipt.receiptSha256,
    },
    sharedFields: structuredClone(authorityReceipt.packingSelectionAuthority.sharedFields),
    rows: structuredClone(authorityReceipt.packingSelectionAuthority.rows),
  };
  return canonical({
    schema: AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA,
    id: `packer-authority-probe-${authorityReceipt.receiptSha256.slice(0, 16)}`,
    diagnostic: {
      kind: 'candidate-authority-consumer-probe',
      notAnAdmittedCoordinateCarrier: true,
      sourceReceipt: { id: authorityReceipt.id, sha256: authorityReceipt.receiptSha256 },
    },
    derivation: {
      kind: 'atlas-route-subset',
      atlas: structuredClone(authorityReceipt.derivation.atlas),
      selectedConstructionIds: [...authorityReceipt.derivation.selectedConstructionIds],
      selectionAuthority,
    },
    source: {
      assetSha256: authorityReceipt.source.assetSha256,
      graphSha256: authorityReceipt.source.graphSha256,
      graphFileSha256: authorityReceipt.source.graphFileSha256,
      routingFixtureSha256: authorityReceipt.source.routingFixtureSha256,
    },
    coordinateSpace: selectedValue(authorityReceipt.sharedFields.coordinateSpace)
      ?? { kind: 'source-world', dimension: 3, unit: 'unresolved' },
    compartment: selectedValue(authorityReceipt.sharedFields.compartment),
    obstacles: selectedValue(authorityReceipt.sharedFields.obstacles) ?? [],
    muscles: authorityReceipt.rows.map(row => ({
      constructionId: row.constructionId,
      lineageId: row.lineageId,
      instanceId: row.instanceId,
      ...structuredClone(row.components),
      attachments: {
        origin: {
          ...structuredClone(row.attachments.origin),
          position: selectedValue(row.fields['attachments.origin.position']),
        },
        insertion: {
          ...structuredClone(row.attachments.insertion),
          position: selectedValue(row.fields['attachments.insertion.position']),
        },
      },
      centerline: selectedValue(row.fields.centerline)?.resampledSamples ?? [],
      targetVolume: selectedValue(row.fields.targetVolume),
      volumeAuthority: selectedValue(row.fields.volumeAuthority) ?? 'unresolved',
    })),
  });
}
