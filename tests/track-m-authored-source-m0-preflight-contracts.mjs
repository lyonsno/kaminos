import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
} from '../musculature-source-m0-core.mjs';
import {
  TRACK_M_SOURCE_SCHEMA,
  buildTrackMEvidencePlan,
} from '../track-m-evidence-bundle-core.mjs';
import {
  TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA,
  validateTrackMAuthoredSourceM0Preflight,
} from '../track-m-authored-source-m0-preflight.mjs';

const H = value => value.repeat(64).slice(0, 64);
const MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

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

function routingFixtureHash(fixture) {
  const { fixtureSha256: _fixtureSha256, schema: _schema, ...fixtureCore } = fixture;
  return hashJson(fixtureCore);
}

function component(role, id, { geometry = null } = {}) {
  return {
    name: id,
    type: geometry?.kind === 'mesh' ? 'MESH' : (geometry?.kind === 'curve' ? 'CURVE' : 'EMPTY'),
    parent: 'Muscle 01',
    collections: ['Constructional Model/20 Muscle'],
    matrixWorld: [...MATRIX],
    modifiers: [],
    role,
    identity: {
      schema_version: '1',
      lineage_id: 'lineage-01',
      construction_id: id,
      instance_id: `instance-${id}`,
      variant: 'parent',
    },
    referenceResolution: 'declared',
    geometry,
  };
}

function makeGraph({ incomplete = false, provisional = false } = {}) {
  const graphCore = {
    schema: 'kaminos.track-m-authored-source-graph.v0',
    compilerId: 'track-m-source-projection-compiler-v0',
    extractorId: 'blender-track-m-source-extract-v0',
    status: 'compiled',
    trackId: 'shape-bearing-musculature',
    source: {
      requestedPath: '/caller/cat.blend',
      effectivePath: '/frozen/cat.blend',
      sha256: H('a'),
      byteLength: 549819,
    },
    blender: { version: '5.1.2' },
    scene: {
      name: 'Scene',
      frame: 0,
      unitSettings: { system: 'METRIC', lengthUnit: 'METERS', scaleLength: 1 },
    },
    sourceMeshes: [{
      name: 'SRC_PELVIS',
      type: 'MESH',
      parent: null,
      collections: ['Collection'],
      matrixWorld: [...MATRIX],
      modifiers: [],
      geometry: {
        kind: 'mesh', contentSha256: H('1'), vertexCount: 20, edgeCount: 30, polygonCount: 12,
      },
    }, {
      name: 'DISTAL_BONE',
      type: 'MESH',
      parent: null,
      collections: ['Collection'],
      matrixWorld: [...MATRIX],
      modifiers: [],
      geometry: {
        kind: 'mesh', contentSha256: H('2'), vertexCount: 20, edgeCount: 30, polygonCount: 12,
      },
    }],
    muscles: [{
      name: 'Muscle 01',
      type: 'EMPTY',
      parent: null,
      collections: ['Constructional Model/20 Muscle'],
      matrixWorld: [...MATRIX],
      modifiers: [],
      identity: {
        schema_version: '1',
        lineage_id: 'lineage-01',
        construction_id: 'muscle-01',
        instance_id: 'instance-rig-01',
        variant: 'parent',
      },
      authoredCompleteness: 'wip_procedural',
      completenessAuthority: incomplete ? 'incomplete_wip' : 'declared_components_present',
      endpointRoute: 'draw_muscle',
      endpointStrategy: 'surface_hits',
      settings: {
        origin_tendon_fraction: 0.18,
        insertion_tendon_fraction: 0.18,
        longitudinal_sections: 12,
        profile_sides: 12,
      },
      origin: {
        handleObject: 'Muscle 01 | Origin',
        handleInstanceId: 'instance-origin',
        sourceName: 'SRC_PELVIS',
        sourceAuthority: provisional ? 'provisional_muscle_surface' : 'source_mesh',
        sourceObjectType: 'MESH',
        sourceRole: provisional ? 'muscle_surface_provisional' : null,
        sourceInstanceId: provisional ? 'instance-other-surface' : null,
      },
      insertion: {
        handleObject: 'Muscle 01 | Insertion',
        handleInstanceId: 'instance-insertion',
        sourceName: 'DISTAL_BONE',
        sourceAuthority: 'source_mesh',
        sourceObjectType: 'MESH',
        sourceRole: null,
        sourceInstanceId: null,
      },
      components: {
        origin: component('attachment_origin', 'muscle-01-origin'),
        belly: component('belly_profile', 'muscle-01-belly'),
        insertion: incomplete ? null : component('attachment_insertion', 'muscle-01-insertion'),
        path: component('muscle_path', 'muscle-01-path', {
          geometry: { kind: 'curve', contentSha256: H('3'), pointCount: 25, splineCount: 1 },
        }),
        surface: component('muscle_surface_provisional', 'muscle-01-surface', {
          geometry: {
            kind: 'mesh', contentSha256: H('4'), vertexCount: 300, edgeCount: 588, polygonCount: 290,
          },
        }),
      },
      missingComponentRoles: incomplete ? ['attachment_insertion'] : [],
    }],
    semanticMarkers: [],
    missingSemanticRoles: ['attachment_patch', 'clearance_volume', 'joint_frame', 'support_target'],
    endpointAuthorityCounts: {
      source_mesh: provisional ? 1 : 2,
      provisional_muscle_surface: provisional ? 1 : 0,
      self_reference: 0,
      unclassified_object: 0,
    },
    authority: {
      anatomicalSource: 'operator-authored-cmk-scene',
      geometry: 'source-byte-bound-blender-extraction',
      endpointClassification: 'compiler-classified-from-authored-object-relations',
      missingSemantics: 'explicitly-unasserted',
    },
  };
  return canonical({ ...graphCore, graphSha256: hashJson(graphCore) });
}

const budget = {
  primitiveCount: 12,
  vertexCount: 480,
  triangleCount: 912,
  parameterCount: 36,
};

function makeBundleSource() {
  return {
    schema: TRACK_M_SOURCE_SCHEMA,
    trackId: 'shape-bearing-musculature',
    receiptId: 'operator-musculature-source-receipt-v0',
    asset: { id: 'operator-musculature-source-v0', path: '/caller/source.blend', sha256: H('0') },
    pose: { id: 'conservative-pose-v0', kind: 'conservative', authorityId: 'external-pose-authority', sha256: H('1') },
    camera: { id: 'track-m-fixed-camera-v0', projection: 'orthographic', width: 640, height: 640, sha256: H('2') },
    material: { id: 'track-m-clay-v0', sha256: H('3') },
    illumination: { id: 'track-m-light-v0', sha256: H('4') },
    renderConfig: { id: 'track-m-render-v0', width: 640, height: 640, sha256: H('5') },
    route: {
      requestedRouteId: 'cpu-shape-bearing-oracle-route',
      executionClass: 'cpu',
      requiresGpu: false,
      adapterContractSha256: H('e'),
    },
    productContract: [
      { kind: 'clay', mimeType: 'image/png' },
      { kind: 'depth', mimeType: 'image/png' },
      { kind: 'normal', mimeType: 'image/png' },
    ],
    testedRelation: {
      id: 'deep-flexor-routing-v0',
      deepGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      deepGeometryContentSetSha256: H('6'),
      attachmentEndpointMultisetSha256: H('7'),
      expectedRoutingGraphSha256: H('8'),
      representationalBudget: { ...budget },
    },
    conditions: {
      'deep-geometry-absent': {
        transform: { id: 'remove-deep-geometry-v0', kind: 'remove-deep-geometry', sha256: H('a') },
        deepGeometryPresent: false,
        testedRelationPresent: false,
        removedGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      },
      'deep-geometry-correctly-routed': {
        transform: { id: 'correct-routing-v0', kind: 'preserve-correct-routing', sha256: H('b') },
        deepGeometryPresent: true,
        testedRelationPresent: true,
        deepGeometryContentSetSha256: H('6'),
        attachmentEndpointMultisetSha256: H('7'),
        routingGraphSha256: H('8'),
        representationalBudget: { ...budget },
      },
      'deep-geometry-matched-wrong-routing': {
        transform: { id: 'wrong-routing-v0', kind: 'matched-wrong-routing', sha256: H('c') },
        deepGeometryPresent: true,
        testedRelationPresent: false,
        destroyedRelationId: 'deep-flexor-routing-v0',
        deepGeometryContentSetSha256: H('6'),
        attachmentEndpointMultisetSha256: H('7'),
        routingGraphSha256: H('9'),
        routingPermutationSha256: H('d'),
        representationalBudget: { ...budget },
      },
    },
  };
}

function makeInputs(options = {}) {
  const graph = makeGraph(options);
  const bundleSource = makeBundleSource();
  return {
    graph,
    expectedGraphSha256: graph.graphSha256,
    expectedSourceSha256: graph.source.sha256,
    bundleSource,
    bundlePlan: buildTrackMEvidencePlan(bundleSource),
  };
}

function addRelation(graph, {
  constructionId,
  originSourceName,
  insertionSourceName,
  hashCharacter,
}) {
  const muscle = structuredClone(graph.muscles[0]);
  muscle.name = constructionId;
  muscle.identity = {
    ...muscle.identity,
    construction_id: constructionId,
    instance_id: `instance-${constructionId}`,
    lineage_id: `lineage-${constructionId}`,
  };
  muscle.origin = {
    ...muscle.origin,
    handleObject: `${constructionId} | Origin`,
    handleInstanceId: `instance-${constructionId}-origin`,
    sourceName: originSourceName,
  };
  muscle.insertion = {
    ...muscle.insertion,
    handleObject: `${constructionId} | Insertion`,
    handleInstanceId: `instance-${constructionId}-insertion`,
    sourceName: insertionSourceName,
  };
  for (const [role, componentValue] of Object.entries(muscle.components)) {
    if (!componentValue) continue;
    componentValue.name = `${constructionId}-${role}`;
    componentValue.parent = constructionId;
    componentValue.identity = {
      ...componentValue.identity,
      construction_id: `${constructionId}-${role}`,
      instance_id: `instance-${constructionId}-${role}`,
      lineage_id: `lineage-${constructionId}`,
    };
    if (componentValue.geometry?.contentSha256) {
      componentValue.geometry.contentSha256 = H(hashCharacter);
    }
  }
  graph.muscles.push(muscle);
}

function makeFixtureInputs() {
  const inputs = makeInputs();
  addRelation(inputs.graph, {
    constructionId: 'muscle-47',
    originSourceName: 'SRC_PELVIS',
    insertionSourceName: 'DISTAL_BONE',
    hashCharacter: '5',
  });
  addRelation(inputs.graph, {
    constructionId: 'muscle-35',
    originSourceName: 'SRC_PELVIS',
    insertionSourceName: 'SRC_PELVIS',
    hashCharacter: '6',
  });
  addRelation(inputs.graph, {
    constructionId: 'muscle-38',
    originSourceName: 'DISTAL_BONE',
    insertionSourceName: 'DISTAL_BONE',
    hashCharacter: '7',
  });
  inputs.graph.endpointAuthorityCounts.source_mesh = 8;
  const graphCore = structuredClone(inputs.graph);
  delete graphCore.graphSha256;
  inputs.graph.graphSha256 = hashJson(graphCore);
  inputs.expectedGraphSha256 = inputs.graph.graphSha256;
  return inputs;
}

function makeRoutingFixture(graph, {
  routeIds = ['muscle-01', 'muscle-47'],
  compilerId = 'track-m-m31-m47-routing-fixture-v0',
  selectionId = null,
  selectionAuthority = 'external-relation-selection-authority-v0',
} = {}) {
  const correctRoutes = routeIds.map((constructionId, index) => ({
    constructionId,
    origin: {
      assignedFromConstructionId: constructionId,
      assignedHandleInstanceId: `origin-${index}`,
      authoredHandleInstanceId: `origin-${index}`,
      point: [index, 0, 0],
      sourceAuthority: 'source_mesh',
      sourceName: 'SRC_PELVIS',
    },
    insertion: {
      assignedFromConstructionId: constructionId,
      assignedHandleInstanceId: `insertion-${index}`,
      authoredHandleInstanceId: `insertion-${index}`,
      point: [index, 1, 0],
      sourceAuthority: 'source_mesh',
      sourceName: 'DISTAL_BONE',
    },
  }));
  const matchedWrongRoutes = correctRoutes.map((route, index) => {
    const donorInsertion = correctRoutes[1 - index].insertion;
    return {
      constructionId: route.constructionId,
      origin: structuredClone(route.origin),
      insertion: {
        ...structuredClone(donorInsertion),
        authoredHandleInstanceId: route.insertion.authoredHandleInstanceId,
      },
    };
  });
  const fixtureCore = {
    compilerId,
    status: 'compiled',
    trackId: 'shape-bearing-musculature',
    source: {
      assetSha256: graph.source.sha256,
      graphSha256: graph.graphSha256,
    },
    selection: {
      ...(selectionId === null ? {} : { id: selectionId }),
      correctConstructionId: routeIds[0],
      crossWireDonorConstructionId: routeIds[1],
      nullConstructionIds: ['muscle-35', 'muscle-38'],
      selectionAuthority,
    },
    conditions: {
      correct: { routes: correctRoutes },
      matchedWrong: { routes: matchedWrongRoutes },
    },
    nulls: [
      { constructionId: 'muscle-35', sameObject: true },
      { constructionId: 'muscle-38', sameObject: true },
    ],
    authority: {
      admittedClaims: ['source-side-routing-sensitivity-fixture'],
      heldClaims: ['selected-relation-m0', 'packing-geometry-admission'],
    },
  };
  const fixture = canonical({
    schema: 'kaminos.track-m-source-routing-fixture.v0',
    ...fixtureCore,
  });
  return canonical({ ...fixture, fixtureSha256: routingFixtureHash(fixture) });
}

function makeDenseFixtureInputs() {
  const inputs = makeInputs();
  inputs.graph.muscles[0].origin.sourceName = 'DISTAL_BONE';
  inputs.graph.muscles[0].insertion.sourceName = 'SRC_PELVIS';
  for (const [constructionId, hashCharacter] of [
    ['muscle-34', '8'],
    ['muscle-13', '9'],
    ['muscle-35', '6'],
    ['muscle-38', '7'],
  ]) {
    addRelation(inputs.graph, {
      constructionId,
      originSourceName: constructionId === 'muscle-38' ? 'DISTAL_BONE' : 'SRC_PELVIS',
      insertionSourceName: constructionId === 'muscle-35' ? 'SRC_PELVIS' : 'DISTAL_BONE',
      hashCharacter,
    });
  }
  for (let index = 1; index <= 34; index += 1) {
    addRelation(inputs.graph, {
      constructionId: `muscle-neighbor-${String(index).padStart(2, '0')}`,
      originSourceName: 'SRC_PELVIS',
      insertionSourceName: 'DISTAL_BONE',
      hashCharacter: 'a',
    });
  }
  rehashGraph(inputs);
  return inputs;
}

function denseRouteIdentity(muscle) {
  return {
    constructionId: muscle.identity.construction_id,
    instanceId: muscle.identity.instance_id,
    lineageId: muscle.identity.lineage_id,
    originHandleInstanceId: muscle.origin.handleInstanceId,
    insertionHandleInstanceId: muscle.insertion.handleInstanceId,
    pathGeometrySha256: muscle.components.path.geometry.contentSha256,
    surfaceGeometrySha256: muscle.components.surface.geometry.contentSha256,
  };
}

function makeDenseRoutingFixture(graph) {
  const fixture = makeRoutingFixture(graph, {
    routeIds: ['muscle-34', 'muscle-13'],
    compilerId: 'track-m-m34-m13-dense-routing-fixture-v0',
    selectionId: 'src-pelvis-cube002-m34-m13-routing-sensitivity-v0',
    selectionAuthority: 'golden-object-parallel-assay-portfolio-2026-08-03',
  });
  fixture.selection.family = {
    originSource: 'SRC_PELVIS',
    insertionSource: 'DISTAL_BONE',
  };
  const neighborConstructionIds = Array.from(
    { length: 34 },
    (_, index) => `muscle-neighbor-${String(index + 1).padStart(2, '0')}`,
  );
  const byId = new Map(graph.muscles.map(muscle => [muscle.identity.construction_id, muscle]));
  const familyConstructionIds = ['muscle-34', 'muscle-13', ...neighborConstructionIds];
  const familyRelations = familyConstructionIds
    .map(constructionId => denseRouteIdentity(byId.get(constructionId)))
    .sort((left, right) => left.constructionId.localeCompare(right.constructionId));
  const neighborRelations = neighborConstructionIds
    .map(constructionId => denseRouteIdentity(byId.get(constructionId)))
    .sort((left, right) => left.constructionId.localeCompare(right.constructionId));
  const neighborIdentity = hashJson(neighborRelations);
  fixture.conditions.absent = {
    id: 'deep-geometry-absent',
    routes: [],
    deepGeometryPresent: false,
    testedRelationPresent: false,
    removedConstructionIds: ['muscle-13', 'muscle-34'],
    preservedNeighborRouteCount: 34,
    preservedNeighborConstructionIds: neighborConstructionIds,
    preservedNeighborFamilyIdentitySha256: neighborIdentity,
    budgetMatchStatus: 'outside-matched-budget-pair',
  };
  fixture.conditions.correct.id = 'deep-geometry-correctly-routed';
  fixture.conditions.correct.deepGeometryPresent = true;
  fixture.conditions.correct.testedRelationPresent = true;
  fixture.conditions.matchedWrong.id = 'deep-geometry-matched-wrong-routing';
  fixture.conditions.matchedWrong.deepGeometryPresent = true;
  fixture.conditions.matchedWrong.testedRelationPresent = false;
  fixture.densityContext = {
    family: { originSource: 'SRC_PELVIS', insertionSource: 'DISTAL_BONE' },
    familyRouteCount: 36,
    neighborRouteCount: 34,
    familyConstructionIds,
    familyIdentitySha256: hashJson(familyRelations),
    neighborConstructionIds,
    neighborFamilyIdentitySha256: neighborIdentity,
    targetCorridor: {
      freezeStatus: 'frozen-before-condition-output',
      conditionIndependent: true,
      authority: 'authenticated-source-route-endpoints',
      attachmentNeighborhoodRadius: null,
      castProjection: 'unavailable-held',
      expectedSignedLocalization: 'unassigned-held',
      neighboringRouteLeakage: 'unmeasured-held',
    },
  };
  fixture.deltaLedger = {
    routes: [
      { constructionId: 'muscle-34', relativeChange: 0.02731012950405119 },
      { constructionId: 'muscle-13', relativeChange: 0.005295978656482437 },
    ],
    maximumAbsoluteRelativeChange: 0.02731012950405119,
    tolerance: null,
    toleranceAuthority: 'unassigned',
    budgetMatchStatus: 'measured-awaiting-owner-tolerance',
  };
  fixture.authority.heldClaims = [
    'correct-route-superiority',
    'musculature-source-evidence',
    'selected-relation-m0',
    'station-instance',
    'source-to-cast-correspondence',
    'expected-signed-localization',
    'packing-geometry-admission',
  ];
  fixture.fixtureSha256 = routingFixtureHash(fixture);
  return canonical(fixture);
}

function rehashGraph(inputs) {
  inputs.graph.endpointAuthorityCounts = inputs.graph.muscles.reduce((counts, muscle) => {
    for (const endpoint of [muscle.origin, muscle.insertion]) counts[endpoint.sourceAuthority] += 1;
    return counts;
  }, { source_mesh: 0, provisional_muscle_surface: 0, self_reference: 0, unclassified_object: 0 });
  const graphCore = structuredClone(inputs.graph);
  delete graphCore.graphSha256;
  inputs.graph.graphSha256 = hashJson(graphCore);
  inputs.expectedGraphSha256 = inputs.graph.graphSha256;
}

function withRoutingFixture(inputs) {
  const routingFixture = makeRoutingFixture(inputs.graph);
  return {
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  };
}

test('routing fixture is semantic-hash-bound and chronology remains caller asserted', () => {
  const inputs = makeFixtureInputs();
  const routingFixture = makeRoutingFixture(inputs.graph);
  const result = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });

  assert.equal(result.selectedFixture.primaryRoute.constructionId, 'muscle-01');
  assert.equal(result.selectedFixture.matchedWrongDonor.constructionId, 'muscle-47');
  const selectedEvidence = result.satisfied.find(item => item.field === 'selectedFixture');
  assert.equal(selectedEvidence.routingFixtureSha256, routingFixture.fixtureSha256);
  assert.equal(selectedEvidence.selectionChronology, 'caller_asserted_not_validator_proven');

  const substituted = structuredClone(routingFixture);
  substituted.selection.selectionAuthority = 'self-asserted-substitute';
  substituted.fixtureSha256 = routingFixtureHash(substituted);
  const rejected = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture: substituted,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });
  assert.equal(rejected.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(rejected.contradictory.some(item => item.field === 'routingFixtureIdentity'));
});

test('routing fixture rejects rehashed matched-wrong origin reassignment', () => {
  const inputs = makeFixtureInputs();
  const routingFixture = makeRoutingFixture(inputs.graph);
  const [first, second] = routingFixture.conditions.matchedWrong.routes;
  [first.origin, second.origin] = [second.origin, first.origin];
  routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);

  const result = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });

  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'routingFixtureMatchedRoutePreservation'));
});

test('dense M34/M13 profile preserves absent neighbors and null tolerance without promoting M0', () => {
  const inputs = makeDenseFixtureInputs();
  const routingFixture = makeDenseRoutingFixture(inputs.graph);
  const result = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });

  assert.equal(result.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(result.selectedFixture.primaryRoute.constructionId, 'muscle-34');
  assert.equal(result.selectedFixture.matchedWrongDonor.constructionId, 'muscle-13');
  const selectedEvidence = result.satisfied.find(item => item.field === 'selectedFixture');
  assert.equal(selectedEvidence.fixtureProfile, 'dense-m34-m13');
  assert.equal(selectedEvidence.absentNeighborRouteCount, 34);
  assert.equal(selectedEvidence.tolerance, null);
  assert.deepEqual(result.contradictory, []);
});

test('dense M34/M13 profile rejects assigned tolerance and forged neighbor preservation', () => {
  for (const mutate of [
    fixture => { fixture.deltaLedger.tolerance = 0.03; },
    fixture => { fixture.conditions.absent.preservedNeighborConstructionIds.pop(); },
  ]) {
    const inputs = makeDenseFixtureInputs();
    const routingFixture = makeDenseRoutingFixture(inputs.graph);
    mutate(routingFixture);
    routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);
    const result = validateTrackMAuthoredSourceM0Preflight({
      ...inputs,
      routingFixture,
      expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
    });
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => (
      item.field === 'routingFixtureDenseTolerance'
      || item.field === 'routingFixtureDenseNeighborPreservation'
    )));
  }
});

test('dense M34/M13 profile rejects an internally rehashed family absent from the source graph', () => {
  const inputs = makeDenseFixtureInputs();
  const routingFixture = makeDenseRoutingFixture(inputs.graph);
  const replacedNeighbor = routingFixture.densityContext.neighborConstructionIds[0];
  routingFixture.densityContext.neighborConstructionIds[0] = 'muscle-forged-neighbor';
  routingFixture.conditions.absent.preservedNeighborConstructionIds[0] = 'muscle-forged-neighbor';
  routingFixture.densityContext.familyConstructionIds = routingFixture.densityContext.familyConstructionIds
    .map(id => id === replacedNeighbor ? 'muscle-forged-neighbor' : id);
  routingFixture.densityContext.neighborFamilyIdentitySha256 = H('d');
  routingFixture.conditions.absent.preservedNeighborFamilyIdentitySha256 = H('d');
  routingFixture.densityContext.familyIdentitySha256 = H('e');
  routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);

  const result = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });

  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'routingFixtureDenseGraphFamily'));
});

test('dense M34/M13 profile returns structured failure for a falsely complete graph member', () => {
  const inputs = makeDenseFixtureInputs();
  const routingFixture = makeDenseRoutingFixture(inputs.graph);
  const malformedMember = inputs.graph.muscles.find(muscle => (
    muscle.identity.construction_id === 'muscle-neighbor-01'
  ));
  delete malformedMember.components.path;
  rehashGraph(inputs);
  routingFixture.source.graphSha256 = inputs.graph.graphSha256;
  routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);

  const result = validateTrackMAuthoredSourceM0Preflight({
    ...inputs,
    routingFixture,
    expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
  });

  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => (
    item.field === 'graphCompleteConstructionGeometry'
    && item.constructionId === 'muscle-neighbor-01'
  )));
});

test('dense M34/M13 profile pins route and null role identities', () => {
  for (const mutate of [
    fixture => {
      [fixture.selection.correctConstructionId, fixture.selection.crossWireDonorConstructionId] =
        [fixture.selection.crossWireDonorConstructionId, fixture.selection.correctConstructionId];
      fixture.conditions.correct.routes.reverse();
      fixture.conditions.matchedWrong.routes.reverse();
    },
    fixture => {
      fixture.selection.nullConstructionIds.reverse();
      fixture.nulls.reverse();
    },
  ]) {
    const inputs = makeDenseFixtureInputs();
    const routingFixture = makeDenseRoutingFixture(inputs.graph);
    mutate(routingFixture);
    routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);
    const result = validateTrackMAuthoredSourceM0Preflight({
      ...inputs,
      routingFixture,
      expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
    });
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => item.field === 'routingFixtureDenseSelection'));
  }
});

test('dense M34/M13 profile rejects claim promotion and lost holds', () => {
  for (const mutate of [
    fixture => { fixture.authority.admittedClaims.push('correct-route-superiority'); },
    fixture => {
      fixture.authority.heldClaims = fixture.authority.heldClaims
        .filter(claim => claim !== 'source-to-cast-correspondence');
    },
  ]) {
    const inputs = makeDenseFixtureInputs();
    const routingFixture = makeDenseRoutingFixture(inputs.graph);
    mutate(routingFixture);
    routingFixture.fixtureSha256 = routingFixtureHash(routingFixture);
    const result = validateTrackMAuthoredSourceM0Preflight({
      ...inputs,
      routingFixture,
      expectedRoutingFixtureSha256: routingFixture.fixtureSha256,
    });
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => item.field === 'routingFixtureClaimBoundary'));
  }
});

test('exact selected-relation consumer rejects an absent routing fixture', () => {
  const result = validateTrackMAuthoredSourceM0Preflight(makeInputs());

  assert.equal(result.schema, TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA);
  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.equal(result.selectedFixture, null);
  assert.ok(result.contradictory.some(item => (
    item.field === 'routingFixtureIdentity'
    && item.reason === 'routing fixture and caller-expected semantic identity are required'
  )));
});

test('Golden selection resolves one causal relation fixture without promoting M0', () => {
  const inputs = withRoutingFixture(makeFixtureInputs());
  const result = validateTrackMAuthoredSourceM0Preflight(inputs);

  assert.equal(result.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(result.selectedFixture.primaryRoute.constructionId, 'muscle-01');
  assert.equal(result.selectedFixture.matchedWrongDonor.constructionId, 'muscle-47');
  assert.deepEqual(
    result.selectedFixture.nullControls.map(relation => relation.constructionId),
    ['muscle-35', 'muscle-38'],
  );
  assert.deepEqual(result.selectedFixture.sourceObjectFamily, {
    originSourceName: 'SRC_PELVIS',
    insertionSourceName: 'DISTAL_BONE',
  });
  assert.equal(result.selectedFixture.claimCeiling, 'routing-sensitivity-only');
  assert.ok(!result.missing.some(item => item.field === 'selectedFixture'));
  assert.ok(!result.missing.some(item => item.field === 'matchedControlIdentity'));
  assert.ok(result.missing.some(item => item.field === 'm0MatchedBudgetLedgerAndWitnesses'));
  assert.ok(result.missing.some(item => item.field === 'localFrames'));
  assert.deepEqual(result.contradictory, []);
});

test('fixture rejects duplicate roles, unmatched route families, and invalid nulls', () => {
  const cases = [
    inputs => {
      const routed = withRoutingFixture(inputs);
      routed.routingFixture.selection.crossWireDonorConstructionId = 'muscle-01';
      routed.routingFixture.fixtureSha256 = routingFixtureHash(routed.routingFixture);
      routed.expectedRoutingFixtureSha256 = routed.routingFixture.fixtureSha256;
      return routed;
    },
    inputs => {
      inputs.graph.muscles[1].insertion.sourceName = 'SRC_PELVIS';
      rehashGraph(inputs);
      return withRoutingFixture(inputs);
    },
    inputs => {
      inputs.graph.muscles[2].insertion.sourceName = 'DISTAL_BONE';
      rehashGraph(inputs);
      return withRoutingFixture(inputs);
    },
  ];
  for (const buildCase of cases) {
    const result = validateTrackMAuthoredSourceM0Preflight(buildCase(makeFixtureInputs()));
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => (
      item.field.startsWith('selectedFixture') || item.field.startsWith('routingFixture')
    )));
  }
});

test('fixture rejects incomplete or provisional members', () => {
  for (const mutate of [
    graph => { graph.muscles[1].origin.sourceAuthority = 'provisional_muscle_surface'; },
    graph => {
      graph.muscles[3].completenessAuthority = 'incomplete_wip';
      graph.muscles[3].missingComponentRoles = ['attachment_insertion'];
    },
  ]) {
    const inputs = makeFixtureInputs();
    mutate(inputs.graph);
    rehashGraph(inputs);
    const result = validateTrackMAuthoredSourceM0Preflight(withRoutingFixture(inputs));
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => item.field.startsWith('selectedFixture')));
  }
});

test('graph substitution and self-hash drift fail loud', () => {
  const wrongExpected = makeInputs();
  wrongExpected.expectedGraphSha256 = H('e');
  let result = validateTrackMAuthoredSourceM0Preflight(wrongExpected);
  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'graphIdentity'));

  const drifted = makeInputs();
  drifted.graph.muscles[0].origin.sourceName = 'SUBSTITUTED';
  result = validateTrackMAuthoredSourceM0Preflight(drifted);
  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'graphSelfHash'));
});

test('source substitution and stale bundle plan fail instead of becoming evidence holds', () => {
  const sourceSubstitution = makeInputs();
  sourceSubstitution.expectedSourceSha256 = H('e');
  let result = validateTrackMAuthoredSourceM0Preflight(sourceSubstitution);
  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'sourceIdentity'));

  const stalePlan = makeInputs();
  stalePlan.bundlePlan.id = H('f');
  result = validateTrackMAuthoredSourceM0Preflight(stalePlan);
  assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
  assert.ok(result.contradictory.some(item => item.field === 'bundlePredecessor'));
});

test('missing or malformed graphs return structured failure evidence', () => {
  for (const graph of [null, [], {}, 'cached-default']) {
    const inputs = makeInputs();
    inputs.graph = graph;
    const result = validateTrackMAuthoredSourceM0Preflight(inputs);
    assert.equal(result.schema, TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA);
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.equal(result.graphIdentityVerified, false);
    assert.ok(result.contradictory.length > 0);
  }
});

test('CLI rejects an absent routing fixture and preserves a phase-local report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-cat-m0-preflight-'));
  const inputs = makeInputs();
  const graphPath = join(root, 'graph.json');
  const bundleSourcePath = join(root, 'bundle-source.json');
  const outputPath = join(root, 'report.json');
  await writeFile(graphPath, `${JSON.stringify(inputs.graph)}\n`);
  await writeFile(bundleSourcePath, `${JSON.stringify(inputs.bundleSource)}\n`);

  const run = spawnSync(process.execPath, [
    'tools/track-m-authored-source-m0-preflight.mjs',
    '--graph', graphPath,
    '--bundle-source', bundleSourcePath,
    '--expected-graph-sha256', inputs.expectedGraphSha256,
    '--expected-source-sha256', inputs.expectedSourceSha256,
    '--output', outputPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'failed-before-validation');
  assert.equal(report.failurePhase, 'arguments');
  assert.equal(report.inputs.routingFixture.requestedPath, null);
  assert.match(report.error, /--routing-fixture is required/);
});

test('CLI consumes a semantic-hash-bound routing fixture without promoting M0', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-cat-m0-routing-fixture-'));
  const inputs = makeFixtureInputs();
  const routingFixture = makeRoutingFixture(inputs.graph);
  const graphPath = join(root, 'graph.json');
  const bundleSourcePath = join(root, 'bundle-source.json');
  const routingFixturePath = join(root, 'routing-fixture.json');
  const outputPath = join(root, 'report.json');
  await writeFile(graphPath, `${JSON.stringify(inputs.graph)}\n`);
  await writeFile(bundleSourcePath, `${JSON.stringify(inputs.bundleSource)}\n`);
  await writeFile(routingFixturePath, `${JSON.stringify(routingFixture)}\n`);

  const run = spawnSync(process.execPath, [
    'tools/track-m-authored-source-m0-preflight.mjs',
    '--graph', graphPath,
    '--bundle-source', bundleSourcePath,
    '--routing-fixture', routingFixturePath,
    '--expected-graph-sha256', inputs.expectedGraphSha256,
    '--expected-source-sha256', inputs.expectedSourceSha256,
    '--expected-routing-fixture-sha256', routingFixture.fixtureSha256,
    '--output', outputPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.validation.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(report.validation.selectedFixture.primaryRoute.constructionId, 'muscle-01');
  assert.equal(report.inputs.routingFixture.effectivePath, await realpath(routingFixturePath));
  assert.equal(report.requested.expectedRoutingFixtureSha256, routingFixture.fixtureSha256);
  assert.equal(
    report.validation.satisfied.find(item => item.field === 'selectedFixture').selectionChronology,
    'caller_asserted_not_validator_proven',
  );
});

test('CLI writes a durable parse-failure report before validation exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-cat-m0-preflight-failure-'));
  const inputs = makeFixtureInputs();
  const routingFixture = makeRoutingFixture(inputs.graph);
  const graphPath = join(root, 'graph.json');
  const bundleSourcePath = join(root, 'bundle-source.json');
  const routingFixturePath = join(root, 'routing-fixture.json');
  const outputPath = join(root, 'report.json');
  await writeFile(graphPath, '{');
  await writeFile(bundleSourcePath, `${JSON.stringify(inputs.bundleSource)}\n`);
  await writeFile(routingFixturePath, `${JSON.stringify(routingFixture)}\n`);

  const run = spawnSync(process.execPath, [
    'tools/track-m-authored-source-m0-preflight.mjs',
    '--graph', graphPath,
    '--bundle-source', bundleSourcePath,
    '--routing-fixture', routingFixturePath,
    '--expected-graph-sha256', inputs.expectedGraphSha256,
    '--expected-source-sha256', inputs.expectedSourceSha256,
    '--expected-routing-fixture-sha256', routingFixture.fixtureSha256,
    '--output', outputPath,
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 1);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'failed-before-validation');
  assert.equal(report.failurePhase, 'graph-parse');
  assert.match(report.inputs.graph.bytesSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.validation, null);
  assert.match(report.error, /json|position|end/i);
});
