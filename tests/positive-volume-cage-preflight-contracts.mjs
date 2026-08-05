import assert from 'node:assert/strict';

import {
  POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA,
  POSITIVE_VOLUME_CAGE_PREFLIGHT_SCHEMA,
  runPositiveVolumeCagePreflight,
  validatePositiveVolumeCageManifest,
} from '../positive-volume-cage-core.mjs';

function asymmetricNonRingManifest() {
  return {
    schema: POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA,
    id: 'asymmetric-non-ring-v0',
    source: {
      id: 'asymmetric-wedge-surface-v0',
      vertexIds: ['surface:a'],
      vertexPositions: [
        { id: 'surface:a', rest: [0.3, 0.28, 0.28] },
      ],
      triangleIds: [],
    },
    requestedRoute: 'positive-volume-cage-preflight',
    effectiveRoute: 'positive-volume-cage-preflight',
    fallbackUsed: false,
    nodes: [
      { id: 'node:a', rest: [0, 0, 0] },
      { id: 'node:b', rest: [1.2, 0.1, 0] },
      { id: 'node:c', rest: [0.2, 1.1, 0.1] },
      { id: 'node:d', rest: [0.1, 0.2, 1.3] },
    ],
    cells: [
      { id: 'cell:skew', nodeIds: ['node:a', 'node:b', 'node:c', 'node:d'] },
    ],
    constraints: [
      {
        nodeId: 'node:a',
        authority: 'fixture-anchor',
        position: [0, 0, 0],
      },
    ],
    embedding: [
      {
        surfaceVertexId: 'surface:a',
        nodeIds: ['node:a', 'node:b', 'node:c', 'node:d'],
        weights: [0.4, 0.2, 0.2, 0.2],
      },
    ],
    requestedConfig: {
      objective: 'preflight-only',
      initialization: 'rest',
      budget: 0,
    },
    effectiveConfig: {
      objective: 'preflight-only',
      initialization: 'rest',
      budget: 0,
    },
  };
}

const nonRing = asymmetricNonRingManifest();
const validated = validatePositiveVolumeCageManifest(nonRing);
assert.equal(validated.id, nonRing.id);
assert.equal(validated.cells.length, 1);
assert.ok(validated.cells[0].restSignedVolume > 0);

const admitted = runPositiveVolumeCagePreflight(nonRing);
assert.equal(admitted.schema, POSITIVE_VOLUME_CAGE_PREFLIGHT_SCHEMA);
assert.equal(admitted.status, 'admitted');
assert.equal(admitted.failurePhase, null);
assert.equal(admitted.primaryOutput, null);
assert.equal(admitted.requestedRoute, nonRing.requestedRoute);
assert.equal(admitted.effectiveRoute, nonRing.effectiveRoute);
assert.equal(admitted.fallbackUsed, false);
assert.equal(admitted.manifestIdentity.id, nonRing.id);

const sham = structuredClone(nonRing);
sham.id = 'row-s-contradictory-boundary-v0';
sham.constraints.push({
  nodeId: 'node:a',
  authority: 'contradictory-target',
  position: [0.25, 0, 0],
});
const rejected = runPositiveVolumeCagePreflight(sham);
assert.equal(rejected.status, 'failed');
assert.equal(rejected.failurePhase, 'constraint-validation');
assert.equal(rejected.error.code, 'constraint-conflict');
assert.equal(rejected.error.nodeId, 'node:a');
assert.deepEqual(
  rejected.error.authorities,
  ['fixture-anchor', 'contradictory-target'],
);
assert.equal(rejected.primaryOutput, null);
assert.equal(
  rejected.lastTrustworthyEvidence,
  'manifest, route, node, and constraint identity validated; topology not evaluated',
);

const fallback = structuredClone(nonRing);
fallback.effectiveRoute = 'silent-fallback';
assert.throws(
  () => runPositiveVolumeCagePreflight(fallback),
  /requested and effective route identity mismatch/,
);

const badEmbedding = structuredClone(nonRing);
badEmbedding.embedding[0].weights = [0.5, 0.2, 0.2, 0.2];
assert.throws(
  () => validatePositiveVolumeCageManifest(badEmbedding),
  /embedding weights must sum to one/,
);

const missingSourceGeometry = structuredClone(nonRing);
delete missingSourceGeometry.source.vertexPositions;
assert.throws(
  () => validatePositiveVolumeCageManifest(missingSourceGeometry),
  /source vertexPositions must cover every source vertex exactly once/,
);

const falseRestReconstruction = structuredClone(nonRing);
falseRestReconstruction.source.vertexPositions[0].rest = [0.31, 0.28, 0.28];
assert.throws(
  () => validatePositiveVolumeCageManifest(falseRestReconstruction),
  /embedding must reconstruct source rest position/,
);

const inverted = structuredClone(nonRing);
inverted.cells[0].nodeIds = ['node:a', 'node:c', 'node:b', 'node:d'];
assert.throws(
  () => validatePositiveVolumeCageManifest(inverted),
  /rest cell orientation must be positive/,
);

console.log('positive-volume cage preflight contracts passed');
