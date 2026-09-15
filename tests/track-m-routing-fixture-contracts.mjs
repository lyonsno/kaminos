import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  TRACK_M_ROUTING_FIXTURE_FAILURE_SCHEMA,
  TRACK_M_ROUTING_FIXTURE_SCHEMA,
  compileTrackMRoutingFixture,
  validateMatchedRoutePreservation,
} from '../track-m-routing-fixture-core.mjs';

const SOURCE_SHA256 = 'a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3';
const GRAPH_SHA256 = 'f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0';
const GRAPH_FILE_SHA256 = '8fe8eb8c65118102243b75c324638155a814f3c70095af5f8462326f2b4d68f6';
const ASSAY_FILE_SHA256 = 'c7fdd24474f965ee92d0131c595129f4f0432bf9930bb8b6eb703ce8cbe850c2';

const ROUTES = Object.freeze({
  'muscle-31': {
    name: 'Muscle 31', instance: 'instance-cd975deb-0bb7-40ce-bbcf-ef847f537882',
    lineage: 'lineage-1fbd216b-6372-4579-b18c-0c5864a1f10f',
    originHandle: 'instance-172c5d64-554c-4d80-a9d7-f6309d720055',
    insertionHandle: 'instance-750005d7-28af-40e0-adbf-ca455aad50b2',
    origin: [5.748570919036865, -2.15970516204834, 11.065047264099121],
    insertion: [5.658816337585449, 10.92640495300293, 22.928180694580078],
    chordLength: 17.66318955443519,
    originTarget: 'Cube.002', insertionTarget: 'Cube.003', pathHash: '1'.repeat(64), surfaceHash: '2'.repeat(64),
  },
  'muscle-47': {
    name: 'Muscle 47', instance: 'instance-4531f561-09a0-4d3f-b947-c207387e9250',
    lineage: 'lineage-6307e597-56c2-4bd6-89dc-eaa85835d3bf',
    originHandle: 'instance-2413de54-8a83-4504-80a9-c2e194e61b5d',
    insertionHandle: 'instance-ce67f544-6e36-49b0-85a3-dd1bccae125e',
    origin: [8.709335327148438, -2.6468515396118164, 11.094644546508789],
    insertion: [7.339146137237549, 10.242835998535156, 23.82756805419922],
    chordLength: 18.169997137103067,
    originTarget: 'Cube.002', insertionTarget: 'Cube.003', pathHash: '3'.repeat(64), surfaceHash: '4'.repeat(64),
  },
  'muscle-35': {
    name: 'Muscle 35', instance: 'instance-df26f025-7412-43c8-abc1-c7082fdd906c',
    lineage: 'lineage-6e15ea13-947d-4971-928a-4f1547a46a65',
    originHandle: 'instance-fcf8ae57-e038-4ebe-a80b-5ad3c1c498de',
    insertionHandle: 'instance-63a2453e-0087-45f3-9106-b8bfeae4d156',
    origin: [5.643123149871826, 4.881115913391113, -4.754794597625732],
    insertion: [6.570624828338623, -4.713774681091309, 10.858918190002441],
    chordLength: 18.349664759691915,
    originTarget: 'Cube.002', insertionTarget: 'Cube.002', pathHash: '5'.repeat(64), surfaceHash: '6'.repeat(64),
  },
  'muscle-38': {
    name: 'Muscle 38', instance: 'instance-11cb7bdf-288c-4cbf-9004-f854279c5e8b',
    lineage: 'lineage-f950b812-9a33-41c0-8cc3-40b922aad2e8',
    originHandle: 'instance-5fecede8-4b52-48a2-a7fa-48562c2d7423',
    insertionHandle: 'instance-c675d994-ae3f-41ab-a830-9b05280334a3',
    origin: [2.8988864421844482, -0.5979963541030884, -9.855504035949707],
    insertion: [4.781585693359375, -0.9724617004394531, -9.411046981811523],
    chordLength: 1.9703610693309594,
    originTarget: 'SRC_PELVIS', insertionTarget: 'SRC_PELVIS', pathHash: '7'.repeat(64), surfaceHash: '8'.repeat(64),
  },
});

function matrixAt(point) {
  return [1, 0, 0, point[0], 0, 1, 0, point[1], 0, 0, 1, point[2], 0, 0, 0, 1];
}

function roundedMatrixAt(point) {
  return matrixAt(point.map(value => Number(value.toFixed(9))));
}

function muscle(constructionId, route) {
  const component = (role, instanceId, matrixWorld, hash = null) => ({
    name: `${route.name} | ${role}`,
    identity: { construction_id: `${constructionId}-${role.toLowerCase()}`, instance_id: instanceId, lineage_id: route.lineage, schema_version: '1', variant: 'parent' },
    matrixWorld,
    geometry: hash === null ? null : { kind: role === 'Path' ? 'curve' : 'mesh', contentSha256: hash, ...(role === 'Path' ? { pointCount: 25, splineCount: 1 } : { vertexCount: 300, edgeCount: 588, polygonCount: 290, shapeKeyCount: 0 }) },
  });
  return {
    name: route.name,
    identity: { construction_id: constructionId, instance_id: route.instance, lineage_id: route.lineage, schema_version: '1', variant: 'parent' },
    authoredCompleteness: 'wip_procedural',
    completenessAuthority: 'declared_components_present',
    endpointRoute: 'draw_muscle',
    endpointStrategy: 'surface_hits',
    settings: { insertion_tendon_fraction: 0.18, longitudinal_sections: 12, origin_tendon_fraction: 0.18, profile_sides: 12 },
    origin: { handleInstanceId: route.originHandle, sourceAuthority: 'source_mesh', sourceName: route.originTarget },
    insertion: { handleInstanceId: route.insertionHandle, sourceAuthority: 'source_mesh', sourceName: route.insertionTarget },
    components: {
      origin: component('Origin', route.originHandle, roundedMatrixAt(route.origin)),
      insertion: component('Insertion', route.insertionHandle, roundedMatrixAt(route.insertion)),
      path: component('Path', `path-${constructionId}`, matrixAt([0, 0, 0]), route.pathHash),
      surface: component('Surface', `surface-${constructionId}`, matrixAt([0, 0, 0]), route.surfaceHash),
    },
    missingComponentRoles: [],
  };
}

function sourceGraph() {
  return {
    schema: 'kaminos.track-m-authored-source-graph.v0',
    compilerId: 'track-m-source-projection-compiler-v0',
    status: 'compiled',
    trackId: 'shape-bearing-musculature',
    graphSha256: GRAPH_SHA256,
    source: { requestedPath: '/source/cat.blend', effectivePath: '/frozen/cat.blend', sha256: SOURCE_SHA256, byteLength: 549819 },
    muscles: Object.entries(ROUTES).map(([id, route]) => muscle(id, route)),
  };
}

function geometryAssay() {
  return {
    schema: 'counterfactual.cat-armature-relation-geometry.v1',
    status: 'complete',
    source_sha256: SOURCE_SHA256,
    graph_identity: GRAPH_SHA256,
    graph_file_sha256: GRAPH_FILE_SHA256,
    rows: Object.entries(ROUTES).map(([constructionId, route]) => ({
      construction_id: constructionId,
      lineage_id: route.lineage,
      name: route.name,
      pair: [route.originTarget, route.insertionTarget],
      endpoint_strategy: 'surface_hits',
      endpoints: [
        { role: 'origin', point: [...route.origin], declared_target: route.originTarget, nearest_source_mesh: { name: route.originTarget, distance: 0.001 } },
        { role: 'insertion', point: [...route.insertion], declared_target: route.insertionTarget, nearest_source_mesh: { name: route.insertionTarget, distance: 0.001 } },
      ],
      path_control_point_count: 25,
      chord_length: route.chordLength,
      path_start_to_origin: 0,
      path_end_to_insertion: 0,
      settings: { insertion_tendon_fraction: 0.18, longitudinal_sections: 12, origin_tendon_fraction: 0.18, profile_sides: 12 },
    })),
  };
}

function compile(graph = sourceGraph(), assay = geometryAssay(), overrides = {}) {
  const graphBytes = `${JSON.stringify(graph, null, 2)}\n`;
  const graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  const boundAssay = structuredClone(assay);
  boundAssay.graph_file_sha256 = graphFileSha256;
  const assayBytes = `${JSON.stringify(boundAssay, null, 2)}\n`;
  const assayFileSha256 = createHash('sha256').update(assayBytes).digest('hex');
  return compileTrackMRoutingFixture(graphBytes, assayBytes, {
    expectedSourceSha256: SOURCE_SHA256,
    expectedGraphSha256: GRAPH_SHA256,
    expectedGraphFileSha256: graphFileSha256,
    expectedAssayFileSha256: assayFileSha256,
    ...overrides,
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeSyntheticInputs(root) {
  const graphPath = join(root, 'graph.json');
  const assayPath = join(root, 'assay.json');
  const graphBytes = `${JSON.stringify(sourceGraph(), null, 2)}\n`;
  const graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  const assay = geometryAssay();
  assay.graph_file_sha256 = graphFileSha256;
  const assayBytes = `${JSON.stringify(assay, null, 2)}\n`;
  const assayFileSha256 = createHash('sha256').update(assayBytes).digest('hex');
  await writeFile(graphPath, graphBytes);
  await writeFile(assayPath, assayBytes);
  return { graphPath, assayPath, graphFileSha256, assayFileSha256 };
}

test('fixture binds exact correct and matched cross-wired M31/M47 transforms', () => {
  const fixture = compile();
  assert.equal(fixture.schema, TRACK_M_ROUTING_FIXTURE_SCHEMA);
  assert.equal(fixture.selection.correctConstructionId, 'muscle-31');
  assert.equal(fixture.selection.crossWireDonorConstructionId, 'muscle-47');
  assert.deepEqual(fixture.selection.family, { originSource: 'Cube.002', insertionSource: 'Cube.003' });
  assert.equal(fixture.conditions.correct.routes[0].insertion.assignedHandleInstanceId, ROUTES['muscle-31'].insertionHandle);
  assert.equal(fixture.conditions.matchedWrong.routes[0].insertion.assignedHandleInstanceId, ROUTES['muscle-47'].insertionHandle);
  assert.equal(fixture.conditions.matchedWrong.routes[1].insertion.assignedHandleInstanceId, ROUTES['muscle-31'].insertionHandle);
  assert.ok(Math.abs(fixture.deltaLedger.routes[0].authoredChordLength - 17.66318955443519) < 1e-12);
  assert.ok(Math.abs(fixture.deltaLedger.routes[0].crossWireChordLength - 17.867145650116) < 1e-12);
  assert.ok(Math.abs(fixture.deltaLedger.routes[0].relativeChange - 0.011546957306450889) < 1e-12);
  assert.ok(Math.abs(fixture.deltaLedger.routes[1].authoredChordLength - 18.169997137103067) < 1e-12);
  assert.ok(Math.abs(fixture.deltaLedger.routes[1].crossWireChordLength - 18.26394085863461) < 1e-12);
  assert.equal(fixture.deltaLedger.tolerance, null);
  assert.equal(fixture.deltaLedger.toleranceAuthority, 'unassigned');
});

test('matched wrong changes only insertion assignments while preserving budget and endpoint inventory', () => {
  const fixture = compile();
  assert.equal(fixture.conditions.correct.deepGeometryContentSetSha256, fixture.conditions.matchedWrong.deepGeometryContentSetSha256);
  assert.equal(fixture.conditions.correct.attachmentEndpointMultisetSha256, fixture.conditions.matchedWrong.attachmentEndpointMultisetSha256);
  assert.deepEqual(fixture.conditions.correct.representationalBudget, fixture.conditions.matchedWrong.representationalBudget);
  assert.notEqual(fixture.conditions.correct.routingGraphSha256, fixture.conditions.matchedWrong.routingGraphSha256);
  assert.deepEqual(fixture.fieldLedger.changed.map(change => change.field), [
    'routes.muscle-31.insertion.assignment',
    'routes.muscle-47.insertion.assignment',
  ]);
  assert.ok(fixture.fieldLedger.preserved.includes('route.identity'));
  assert.ok(fixture.fieldLedger.preserved.includes('route.origin.assignment'));
  assert.ok(fixture.fieldLedger.preserved.includes('component.geometry.identity'));
  assert.ok(fixture.fieldLedger.preserved.includes('representational.budget'));
});

test('matched-route validator rejects duplicate/drop endpoint laundering even with stale matching receipts', () => {
  const fixture = compile();
  const laundered = structuredClone(fixture.conditions.matchedWrong);
  laundered.routes[1].insertion = structuredClone(laundered.routes[0].insertion);
  assert.throws(
    () => validateMatchedRoutePreservation(fixture.conditions.correct, laundered),
    /effective endpoint inventory|endpoint.*multiset/i,
  );
});

test('fixture carries same-object nulls and an explicit packing geometry hold', () => {
  const fixture = compile();
  assert.deepEqual(fixture.nulls.map(item => item.constructionId), ['muscle-35', 'muscle-38']);
  assert.ok(fixture.nulls.every(item => item.sameObject === true));
  assert.equal(fixture.geometricCoherence.endpointCoordinates, 'byte-bound-full-precision-assay-points');
  assert.equal(fixture.geometricCoherence.endpointTransforms, 'byte-bound-rounded-source-graph-matrices');
  assert.equal(fixture.geometricCoherence.centerlineCoordinates, 'unavailable-hash-only');
  assert.equal(fixture.geometricCoherence.packingAdmission, 'identity-coherent_geometry-unavailable');
  assert.deepEqual(fixture.authority.admittedClaims, ['source-side-routing-sensitivity-fixture']);
  assert.ok(fixture.authority.heldClaims.includes('correct-route-superiority'));
});

test('fixture fails loud on identity drift, missing selected routes, and inadmissible endpoints', () => {
  const wrongGraph = sourceGraph();
  wrongGraph.graphSha256 = 'f'.repeat(64);
  assert.throws(() => compile(wrongGraph), /graph identity.*mismatch/i);

  const missing = sourceGraph();
  missing.muscles = missing.muscles.filter(item => item.identity.construction_id !== 'muscle-47');
  assert.throws(() => compile(missing), /selected construction muscle-47.*missing/i);

  const provisional = sourceGraph();
  provisional.muscles.find(item => item.identity.construction_id === 'muscle-31').insertion.sourceAuthority = 'provisional_muscle_surface';
  assert.throws(() => compile(provisional), /muscle-31.*source_mesh authority/i);

  const incomplete = sourceGraph();
  incomplete.muscles.find(item => item.identity.construction_id === 'muscle-31').completenessAuthority = 'incomplete_wip';
  assert.throws(() => compile(incomplete), /muscle-31.*complete/i);
});

test('fixture rejects stale geometry registration and assay source substitution', () => {
  const stale = geometryAssay();
  stale.rows.find(item => item.construction_id === 'muscle-31').endpoints[0].point[0] += 0.01;
  assert.throws(() => compile(sourceGraph(), stale), /muscle-31 origin.*registration/i);

  const substituted = geometryAssay();
  substituted.source_sha256 = 'e'.repeat(64);
  assert.throws(() => compile(sourceGraph(), substituted), /assay source.*mismatch/i);

  assert.throws(
    () => compile(sourceGraph(), geometryAssay(), { expectedAssayFileSha256: 'd'.repeat(64) }),
    /assay file.*mismatch/i,
  );
});

test('condition identities are deterministic under input ordering changes while byte receipts remain honest', () => {
  const first = compile();
  const graph = sourceGraph();
  const assay = geometryAssay();
  graph.muscles.reverse();
  assay.rows.reverse();
  const reversed = compile(graph, assay);
  assert.deepEqual(reversed.conditions, first.conditions);
  assert.deepEqual(reversed.deltaLedger, first.deltaLedger);
  assert.notEqual(reversed.source.graphFileSha256, first.source.graphFileSha256);
  assert.notEqual(reversed.source.geometryAssayFileSha256, first.source.geometryAssayFileSha256);
  assert.notEqual(reversed.fixtureSha256, first.fixtureSha256);
  assert.match(first.fixtureSha256, /^[0-9a-f]{64}$/);
  assert.match(first.conditions.correct.transform.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.conditions.matchedWrong.transform.sha256, /^[0-9a-f]{64}$/);
});

test('CLI writes a durable identity-bound failure before primary output exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-'));
  const graphPath = join(root, 'graph.json');
  const assayPath = join(root, 'assay.json');
  const outputPath = join(root, 'fixture.json');
  const failurePath = join(root, 'failure.json');
  await writeFile(graphPath, `${JSON.stringify(sourceGraph(), null, 2)}\n`);
  await writeFile(assayPath, `${JSON.stringify(geometryAssay(), null, 2)}\n`);
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', failurePath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', 'f'.repeat(64),
    '--expected-assay-file-sha256', ASSAY_FILE_SHA256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.schema, TRACK_M_ROUTING_FIXTURE_FAILURE_SCHEMA);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'source-identity-validation');
  assert.equal(failure.requestedGraphPath, graphPath);
  assert.equal(failure.requestedAssayPath, assayPath);
  assert.equal(failure.expectedGraphFileSha256, 'f'.repeat(64));
  assert.match(failure.error, /graph file.*mismatch/i);
  assert.equal(failure.lastTrustworthyEvidence, 'graph and assay bytes read and hashed');
});

test('CLI success removes stale failure evidence and publishes only the primary fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-success-'));
  const { graphPath, assayPath, graphFileSha256, assayFileSha256 } = await writeSyntheticInputs(root);
  const outputPath = join(root, 'fixture.json');
  const failurePath = join(root, 'failure.json');
  await writeFile(failurePath, '{"status":"stale"}\n');
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', failurePath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', graphFileSha256,
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(outputPath), true);
  assert.equal(await exists(failurePath), false);
});

test('CLI failure removes stale primary evidence and publishes only the failure receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-failure-'));
  const { graphPath, assayPath, assayFileSha256 } = await writeSyntheticInputs(root);
  const outputPath = join(root, 'fixture.json');
  const failurePath = join(root, 'failure.json');
  await writeFile(outputPath, '{"status":"stale"}\n');
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', failurePath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', 'f'.repeat(64),
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(await exists(outputPath), false);
  assert.equal(await exists(failurePath), true);
});

test('CLI missing-input failure removes stale primary evidence and writes an input-read receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-missing-input-'));
  const { assayPath, assayFileSha256 } = await writeSyntheticInputs(root);
  const missingGraphPath = join(root, 'missing-graph.json');
  const outputPath = join(root, 'fixture.json');
  const failurePath = join(root, 'failure.json');
  await writeFile(outputPath, '{"status":"stale"}\n');
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', missingGraphPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', failurePath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', GRAPH_FILE_SHA256,
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(await exists(outputPath), false);
  assert.equal(await exists(failurePath), true);
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.failurePhase, 'input-read');
  assert.equal(failure.requestedGraphPath, missingGraphPath);
  assert.match(failure.error, /ENOENT|no such file/i);
});

test('core rejects parsed-object substitution because only bytes can carry file identity', () => {
  const graph = sourceGraph();
  const assay = geometryAssay();
  const graphBytes = `${JSON.stringify(graph, null, 2)}\n`;
  const graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  assay.graph_file_sha256 = graphFileSha256;
  const assayBytes = `${JSON.stringify(assay, null, 2)}\n`;
  const assayFileSha256 = createHash('sha256').update(assayBytes).digest('hex');
  assert.throws(() => compileTrackMRoutingFixture(graph, assay, {
    expectedSourceSha256: SOURCE_SHA256,
    expectedGraphSha256: GRAPH_SHA256,
    expectedGraphFileSha256: graphFileSha256,
    expectedAssayFileSha256: assayFileSha256,
  }), /bytes.*identity|input.*bytes/i);
});

test('CLI rejects output aliasing without deleting either authenticated input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-output-alias-'));
  const { graphPath, assayPath, graphFileSha256, assayFileSha256 } = await writeSyntheticInputs(root);
  const graphBefore = await readFile(graphPath);
  const failurePath = join(root, 'failure.json');
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphPath,
    '--assay', assayPath,
    '--out', graphPath,
    '--failure', failurePath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', graphFileSha256,
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(graphPath), graphBefore);
  assert.equal(await exists(failurePath), true);
  assert.match((await readFile(failurePath, 'utf8')), /must not alias an input/i);
});

test('CLI redirects an aliased failure path to a durable sidecar without overwriting input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-failure-alias-'));
  const { graphPath, assayPath, graphFileSha256, assayFileSha256 } = await writeSyntheticInputs(root);
  const graphBefore = await readFile(graphPath);
  const outputPath = join(root, 'fixture.json');
  const sidecarPath = `${graphPath}.track-m-routing-fixture-failure.json`;
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', graphPath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', graphFileSha256,
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(graphPath), graphBefore);
  assert.equal(await exists(outputPath), false);
  assert.equal(await exists(sidecarPath), true);
  assert.match((await readFile(sidecarPath, 'utf8')), /failure receipt path.*alias/i);
});

test('CLI preserves symlink-resolved inputs when the first failure sidecar also collides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'track-m-routing-fixture-effective-alias-'));
  const { graphPath, assayPath, graphFileSha256, assayFileSha256 } = await writeSyntheticInputs(root);
  const graphAliasPath = join(root, 'graph-alias.json');
  await symlink(graphPath, graphAliasPath);
  const graphBefore = await readFile(graphPath);
  const assayBefore = await readFile(assayPath);
  const outputPath = `${graphPath}.track-m-routing-fixture-failure.json`;
  const fallbackPath = `${graphPath}.track-m-routing-fixture-failure.1.json`;
  await writeFile(outputPath, '{"status":"stale"}\n');
  const result = spawnSync('node', [
    'tools/compile-track-m-routing-fixture.mjs',
    '--graph', graphAliasPath,
    '--assay', assayPath,
    '--out', outputPath,
    '--failure', graphPath,
    '--expected-source-sha256', SOURCE_SHA256,
    '--expected-graph-sha256', GRAPH_SHA256,
    '--expected-graph-file-sha256', graphFileSha256,
    '--expected-assay-file-sha256', assayFileSha256,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readFile(graphPath), graphBefore);
  assert.deepEqual(await readFile(assayPath), assayBefore);
  assert.equal(await exists(outputPath), false);
  assert.equal(await exists(fallbackPath), true);
  assert.match((await readFile(fallbackPath, 'utf8')), /failure receipt path.*alias/i);
});
