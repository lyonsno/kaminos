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

function makeFixtureSelection(graph) {
  return {
    schema: 'kaminos.track-m-authored-relation-fixture-selection.v0',
    graphSha256: graph.graphSha256,
    primaryConstructionId: 'muscle-01',
    matchedWrongDonorConstructionId: 'muscle-47',
    nullConstructionIds: ['muscle-35', 'muscle-38'],
    authority: { id: 'external-relation-selection-authority-v0', sha256: H('f') },
    selectedBeforeOutputInspection: true,
  };
}

test('authenticated graph returns an exact hold and a non-selecting adapter contract', () => {
  const result = validateTrackMAuthoredSourceM0Preflight(makeInputs());

  assert.equal(result.schema, TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA);
  assert.equal(result.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(result.graphIdentityVerified, true);
  assert.equal(result.bundlePredecessorCompatible, true);
  assert.equal(result.selectedFixture, null);
  assert.equal(result.candidates.completeSourceMeshRelations, 1);
  assert.ok(result.satisfied.some(item => item.field === 'sourceUnits'));
  assert.ok(result.satisfied.some(item => item.field === 'sourceCompletenessAndKnownOmissions'));
  assert.ok(result.missing.some(item => item.field === 'selectedFixture'));
  assert.ok(result.missing.some(item => item.field === 'localFrames'));
  assert.deepEqual(result.contradictory, []);
  assert.deepEqual(result.selectionAdapter.requiredCallerFields, [
    'schema',
    'graphSha256',
    'primaryConstructionId',
    'matchedWrongDonorConstructionId',
    'nullConstructionIds',
    'authority',
    'selectedBeforeOutputInspection',
  ]);
  assert.equal(result.selectionAdapter.selectsForCaller, false);
});

test('Golden selection resolves one causal relation fixture without promoting M0', () => {
  const inputs = makeFixtureInputs();
  inputs.selection = makeFixtureSelection(inputs.graph);
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
  for (const mutate of [
    selection => { selection.matchedWrongDonorConstructionId = selection.primaryConstructionId; },
    (_selection, graph) => { graph.muscles[1].insertion.sourceName = 'SRC_PELVIS'; },
    (_selection, graph) => { graph.muscles[2].insertion.sourceName = 'DISTAL_BONE'; },
  ]) {
    const inputs = makeFixtureInputs();
    inputs.selection = makeFixtureSelection(inputs.graph);
    mutate(inputs.selection, inputs.graph);
    if (inputs.graph.graphSha256 === inputs.expectedGraphSha256) {
      const graphCore = structuredClone(inputs.graph);
      delete graphCore.graphSha256;
      inputs.graph.graphSha256 = hashJson(graphCore);
      inputs.expectedGraphSha256 = inputs.graph.graphSha256;
      inputs.selection.graphSha256 = inputs.graph.graphSha256;
    }
    const result = validateTrackMAuthoredSourceM0Preflight(inputs);
    assert.equal(result.disposition, 'FAIL_MUSCULATURE_SOURCE');
    assert.ok(result.contradictory.some(item => item.field.startsWith('selectedFixture')));
  }
});

test('fixture rejects incomplete or provisional members and authority substitution', () => {
  for (const mutate of [
    (_selection, graph) => { graph.muscles[1].origin.sourceAuthority = 'provisional_muscle_surface'; },
    (_selection, graph) => {
      graph.muscles[3].completenessAuthority = 'incomplete_wip';
      graph.muscles[3].missingComponentRoles = ['attachment_insertion'];
    },
    selection => { selection.authority.sha256 = 'not-a-hash'; },
  ]) {
    const inputs = makeFixtureInputs();
    inputs.selection = makeFixtureSelection(inputs.graph);
    mutate(inputs.selection, inputs.graph);
    if (inputs.selection.authority.sha256 !== 'not-a-hash') {
      inputs.graph.endpointAuthorityCounts = inputs.graph.muscles.reduce((counts, muscle) => {
        for (const endpoint of [muscle.origin, muscle.insertion]) counts[endpoint.sourceAuthority] += 1;
        return counts;
      }, { source_mesh: 0, provisional_muscle_surface: 0, self_reference: 0, unclassified_object: 0 });
      const graphCore = structuredClone(inputs.graph);
      delete graphCore.graphSha256;
      inputs.graph.graphSha256 = hashJson(graphCore);
      inputs.expectedGraphSha256 = inputs.graph.graphSha256;
      inputs.selection.graphSha256 = inputs.graph.graphSha256;
    }
    const result = validateTrackMAuthoredSourceM0Preflight(inputs);
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

test('CLI records effective input identities and preserves a valid hold report', async () => {
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

  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'validated');
  assert.equal(report.validation.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(report.inputs.graph.effectivePath, await realpath(graphPath));
  assert.match(report.inputs.graph.bytesSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.inputs.bundleSource.effectivePath, await realpath(bundleSourcePath));
  assert.equal(report.effectivePlanRoute, 'deterministic-plan-from-verified-bundle-source');
  assert.equal(report.failurePhase, null);
});

test('CLI writes a durable parse-failure report before validation exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-cat-m0-preflight-failure-'));
  const inputs = makeInputs();
  const graphPath = join(root, 'graph.json');
  const bundleSourcePath = join(root, 'bundle-source.json');
  const outputPath = join(root, 'report.json');
  await writeFile(graphPath, '{');
  await writeFile(bundleSourcePath, `${JSON.stringify(inputs.bundleSource)}\n`);

  const run = spawnSync(process.execPath, [
    'tools/track-m-authored-source-m0-preflight.mjs',
    '--graph', graphPath,
    '--bundle-source', bundleSourcePath,
    '--expected-graph-sha256', inputs.expectedGraphSha256,
    '--expected-source-sha256', inputs.expectedSourceSha256,
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
