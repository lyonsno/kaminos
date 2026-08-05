import assert from 'node:assert/strict';

import {
  ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA,
  createAnalyticalElbowP0CageManifest,
  createAnalyticalElbowRowSBundle,
  createAsymmetricNonRingBundle,
  createAsymmetricNonRingCageManifest,
} from '../analytical-elbow-positive-volume-cage-preflight-core.mjs';
import {
  runPositiveVolumeCagePreflight,
  validatePositiveVolumeCageManifest,
} from '../positive-volume-cage-core.mjs';

const nonRingManifest = createAsymmetricNonRingCageManifest();
assert.equal(nonRingManifest.fixture.kind, 'asymmetric-non-ring-contract');
assert.equal(nonRingManifest.fixture.ringIndexingUsed, false);
assert.equal(runPositiveVolumeCagePreflight(nonRingManifest).status, 'admitted');

const nonRingBundle = createAsymmetricNonRingBundle();
assert.equal(nonRingBundle.schema, ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA);
assert.equal(nonRingBundle.status, 'complete');
assert.equal(nonRingBundle.case, 'asymmetric-non-ring');
assert.equal(nonRingBundle.report.status, 'admitted');
assert.equal(nonRingBundle.manifest.id, nonRingManifest.id);

const p0 = createAnalyticalElbowP0CageManifest();
const validatedP0 = validatePositiveVolumeCageManifest(p0);
assert.equal(p0.fixture.kind, 'analytical-elbow-sleeve-p0');
assert.equal(p0.fixture.axialSectionCount, 7);
assert.equal(p0.fixture.circumferentialSectorCount, 8);
assert.equal(p0.nodes.length, 63);
assert.equal(p0.cells.length, 144);
assert.ok(p0.source.vertexIds.length > 0);
assert.equal(p0.source.vertexPositions.length, p0.source.vertexIds.length);
assert.equal(p0.embedding.length, p0.source.vertexIds.length);
assert.ok(validatedP0.cells.every(cell => cell.restSignedVolume > 0));
assert.ok(
  validatedP0.embedding.every(entry => entry.restReconstructionError <= 1e-12),
);

const rowS = createAnalyticalElbowRowSBundle();
assert.equal(rowS.schema, ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA);
assert.equal(rowS.status, 'complete');
assert.equal(rowS.case, 'row-s');
assert.equal(rowS.report.status, 'failed');
assert.equal(rowS.report.failurePhase, 'constraint-validation');
assert.equal(rowS.report.error.code, 'constraint-conflict');
assert.match(rowS.report.error.nodeId, /^p0:section:0:/);
assert.deepEqual(
  rowS.report.error.authorities,
  ['child-rigid-target', 'row-s-source-frozen-sentinel'],
);
assert.equal(rowS.report.primaryOutput, null);
assert.equal(rowS.manifest.id, 'analytical-elbow-row-s-v0');

const rowSWithInvalidGeometry = structuredClone(rowS.manifest);
const invertedCell = rowSWithInvalidGeometry.cells[0];
[
  invertedCell.nodeIds[1],
  invertedCell.nodeIds[2],
] = [
  invertedCell.nodeIds[2],
  invertedCell.nodeIds[1],
];
const preGeometryConflict = runPositiveVolumeCagePreflight(rowSWithInvalidGeometry);
assert.equal(preGeometryConflict.status, 'failed');
assert.equal(preGeometryConflict.failurePhase, 'constraint-validation');
assert.equal(preGeometryConflict.error.code, 'constraint-conflict');
assert.equal(preGeometryConflict.primaryOutput, null);

console.log('analytical elbow positive-volume cage preflight contracts passed');
