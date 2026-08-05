import assert from 'node:assert/strict';

import {
  createM31GeneratedRelationTransfer,
  validateM31GeneratedRelationTransfer,
} from '../m31-generated-relation-transfer-core.mjs';

const SOURCE_SHA256 =
  'a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3';
const ROUTING_FIXTURE_SHA256 =
  'ed0b95da9cdb7560e877869ab7d1f92423f8ec343712dbf40986ed63e5b48075';
const C_P0_SHA256 =
  '4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005';
const ROUTE = 'm31-generated-relation-positive-volume-c-p0-transfer';
const SOURCE_GRAPH_IDENTITY =
  'f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0';
const SOURCE_GRAPH_FILE_SHA256 =
  '8fe8eb8c65118102243b75c324638155a814f3c70095af5f8462326f2b4d68f6';

function syntheticSourceFixture() {
  const profileSideCount = 4;
  const sectionCount = 7;
  const vertices = [];
  const sections = [];
  for (let section = 0; section < sectionCount; section += 1) {
    const ids = [];
    for (let profile = 0; profile < profileSideCount; profile += 1) {
      const id = `muscle-31:vertex:${section}:${profile}`;
      const angle = profile * Math.PI * 2 / profileSideCount;
      const radius = 0.6 + 0.15 * Math.sin(section * Math.PI / (sectionCount - 1));
      vertices.push({
        id,
        index: vertices.length,
        sectionIndex: section,
        profileIndex: profile,
        rest: [Math.cos(angle) * radius, section, Math.sin(angle) * radius],
      });
      ids.push(id);
    }
    sections.push({ index: section, vertexIds: ids });
  }
  const triangles = [];
  for (let section = 0; section < sectionCount - 1; section += 1) {
    for (let profile = 0; profile < profileSideCount; profile += 1) {
      const next = (profile + 1) % profileSideCount;
      const a = section * profileSideCount + profile;
      const b = (section + 1) * profileSideCount + profile;
      const c = (section + 1) * profileSideCount + next;
      const d = section * profileSideCount + next;
      for (const indices of [[a, b, c], [a, c, d]]) {
        triangles.push({
          id: `muscle-31:triangle:${triangles.length}`,
          index: triangles.length,
          vertexIndices: indices,
          vertexIds: indices.map(index => vertices[index].id),
        });
      }
    }
  }
  return {
    schema: 'kaminos.m31-generated-relation-source-fixture.v0',
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    source: {
      assetSha256: SOURCE_SHA256,
      byteLength: 549819,
      routingFixtureSha256: ROUTING_FIXTURE_SHA256,
      cP0ArtifactSha256: C_P0_SHA256,
      fixtureContractSchema: 'm31_m47_source_fixture_station_binding.v1',
      graphIdentity: SOURCE_GRAPH_IDENTITY,
      graphFileSha256: SOURCE_GRAPH_FILE_SHA256,
    },
    selection: {
      constructionId: 'muscle-31',
      frozenBeforeOutput: true,
      eligibilityStatus: 'eligible',
      supportFamily: ['Cube.002', 'Cube.003'],
      observedAt: '2026-08-05T19:00:00.000Z',
    },
    identities: {
      path: 'Muscle 31 | Path',
      surface: 'Muscle 31 | Surface',
      originHandle: 'Muscle 31 | Origin',
      insertionHandle: 'Muscle 31 | Insertion',
      fixedSupport: 'Cube.002',
      movingSupport: 'Cube.003',
    },
    componentInstanceIds: {
      path: 'instance-4f1543af-4afe-4446-8d5d-7cd1e935ae3f',
      surface: 'instance-88a8fb11-9799-4085-a0e4-867f6490d451',
      originHandle: 'instance-172c5d64-554c-4d80-a9d7-f6309d720055',
      insertionHandle: 'instance-750005d7-28af-40e0-adbf-ca455aad50b2',
    },
    hinge: {
      pivotWorld: [0, 4, 0],
      axisWorld: [1, 0, 0],
      pivotStrategy: 'moving-support-object-origin',
      axisStrategy: 'moving-support-local-x',
    },
    profileSideCount,
    sections,
    vertices,
    triangles,
  };
}

const sourceFixture = syntheticSourceFixture();
const bundle = createM31GeneratedRelationTransfer(sourceFixture);

assert.equal(bundle.status, 'M31_TRANSFER_COMPLETE');

const originalDateNow = Date.now;
let earlierReplay;
let laterReplay;
try {
  Date.now = () => Date.parse('2026-08-05T20:00:00.000Z');
  earlierReplay = createM31GeneratedRelationTransfer(sourceFixture);
  Date.now = () => Date.parse('2026-08-05T21:00:00.000Z');
  laterReplay = createM31GeneratedRelationTransfer(sourceFixture);
} finally {
  Date.now = originalDateNow;
}
assert.notEqual(earlierReplay.producerEnvelope.transfer_requested_at,
  laterReplay.producerEnvelope.transfer_requested_at);
assert.equal(earlierReplay.producerEnvelope.transfer_hash,
  laterReplay.producerEnvelope.transfer_hash,
  'transfer identity must remain stable when only the replay timestamp changes');
assert.equal(bundle.requestedRoute, ROUTE);
assert.equal(bundle.effectiveRoute, ROUTE);
assert.equal(bundle.fallbackUsed, false);
assert.equal(bundle.selection.constructionId, 'muscle-31');
assert.equal(bundle.selection.frozenBeforeOutput, true);
assert.deepEqual(bundle.poses.map(pose => pose.angleDegrees), [0, 24]);
assert.ok(bundle.poses.every(pose => pose.outputVertices.length === sourceFixture.vertices.length));
assert.ok(bundle.poses.every(pose => pose.outputTriangles.length === sourceFixture.triangles.length));
assert.ok(bundle.poses.every(pose => Object.values(pose.hardVetoes)
  .every(veto => veto.pass === true)));

assert.deepEqual(bundle.identityMap.sourceVertexIds,
  sourceFixture.vertices.map(vertex => vertex.id));
assert.deepEqual(bundle.identityMap.sourceTriangleIds,
  sourceFixture.triangles.map(triangle => triangle.id));
assert.equal(new Set(bundle.identityMap.outputVertexIds).size,
  sourceFixture.vertices.length);
assert.equal(new Set(bundle.identityMap.outputTriangleIds).size,
  sourceFixture.triangles.length);
assert.equal(bundle.identityMap.vertexMap.length, sourceFixture.vertices.length);
assert.equal(bundle.identityMap.triangleMap.length, sourceFixture.triangles.length);
assert.equal(bundle.identityMap.total, true);
assert.equal(bundle.identityMap.bijective, true);

const membershipSets = Object.values(bundle.semanticMemberships)
  .map(membership => new Set(membership.sourceVertexIds));
assert.ok(membershipSets.every(set => set.size > 0));
for (let left = 0; left < membershipSets.length; left += 1) {
  for (let right = left + 1; right < membershipSets.length; right += 1) {
    assert.equal([...membershipSets[left]].some(id => membershipSets[right].has(id)), false);
  }
}
assert.deepEqual(bundle.poses[0].semanticMemberships, bundle.poses[1].semanticMemberships);
assert.equal(bundle.producerEnvelope.schema,
  'm31_m47_experimental_transfer_producer.v1');
assert.equal(bundle.producerEnvelope.source_fixture_schema,
  'm31_m47_source_fixture_station_binding.v1');
assert.equal(bundle.producerEnvelope.source_graph_identity, SOURCE_GRAPH_IDENTITY);
assert.equal(bundle.producerEnvelope.source_graph_file_sha256, SOURCE_GRAPH_FILE_SHA256);
assert.equal(bundle.producerEnvelope.selected_path_instance_id,
  sourceFixture.componentInstanceIds.path);
assert.equal(bundle.producerEnvelope.selected_surface_instance_id,
  sourceFixture.componentInstanceIds.surface);
assert.ok(bundle.producerEnvelope.transfer_requested_at >
  bundle.producerEnvelope.selection_observed_at);
for (const role of Object.values(bundle.semanticMemberships)) {
  assert.ok(role.sourceTriangleIds.length > 0);
  assert.ok(role.outputTriangleIds.length > 0);
}
assert.deepEqual(bundle.producerEnvelope.ordered_neutral_output_vertex_ids,
  bundle.producerEnvelope.ordered_plus24_output_vertex_ids);
assert.deepEqual(bundle.producerEnvelope.membership_hashes.neutral,
  bundle.producerEnvelope.membership_hashes.plus24);
assert.deepEqual(Object.keys(bundle.manifest.semanticHashes).sort(), [
  'boundaryRoles',
  'cells',
  'embedding',
  'nodes',
  'sourceContainmentEnvelope',
  'targetTransforms',
]);
assert.equal(bundle.coreIdentity.cP0ArtifactSha256, C_P0_SHA256);
assert.equal(bundle.claimCeiling,
  'experimental shape retention and identity-preserving semantic carry-through on one preselected relation');

const valid = validateM31GeneratedRelationTransfer(bundle);
assert.equal(valid.status, 'M31_TRANSFER_VALID');

const wrongSource = structuredClone(sourceFixture);
wrongSource.source.assetSha256 = '0'.repeat(64);
assert.equal(createM31GeneratedRelationTransfer(wrongSource).failurePhase,
  'source-authentication');

const routeMismatch = structuredClone(sourceFixture);
routeMismatch.effectiveRoute = 'fallback-route';
assert.equal(createM31GeneratedRelationTransfer(routeMismatch).failurePhase,
  'route-validation');

const duplicateMap = structuredClone(bundle);
duplicateMap.identityMap.outputVertexIds[1] = duplicateMap.identityMap.outputVertexIds[0];
assert.equal(validateM31GeneratedRelationTransfer(duplicateMap).failurePhase,
  'identity-map-validation');

const emptyMask = structuredClone(bundle);
emptyMask.semanticMemberships.transitionBelly.sourceVertexIds = [];
emptyMask.semanticMemberships.transitionBelly.outputVertexIds = [];
assert.equal(validateM31GeneratedRelationTransfer(emptyMask).failurePhase,
  'semantic-membership-validation');

console.log('m31 generated-relation transfer contracts passed');
