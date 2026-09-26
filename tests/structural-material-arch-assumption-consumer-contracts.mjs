import assert from 'node:assert/strict';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';
import { buildArchAssumptionComparison } from '../structural-material-arch-assumption-consumer.mjs';

const source = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(source, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const positions = new Float32Array([
  0.35, 0.2, 0,
  0.34, 0.2, 0.03,
  0.36, 0.19, -0.02,
]);
const comparison = buildArchAssumptionComparison(profile, positions, { force: 0.15 });

assert.equal(comparison.schema, 'kaminos.structural-material.arch-assumption-mesh-consumer.v0');
assert.equal(comparison.cases.length, 4);
assert.deepEqual(comparison.cases.map(item => [item.interiorMode, item.contact.contactDepthMode]), [
  ['continuous', 'through-thickness'],
  ['continuous', 'camera-facing-surface'],
  ['radial-voussoir-joints', 'through-thickness'],
  ['radial-voussoir-joints', 'camera-facing-surface'],
]);
for (const item of comparison.cases) {
  assert.equal(item.force, 0.15);
  assert.equal(item.contact.column, comparison.contactCell.column);
  assert.equal(item.contact.row, comparison.contactCell.row);
  assert.equal(item.surfaceVertexCount, 3);
  assert.equal(item.unmappedVertexCount, 0);
  assert.equal(item.brokenBondCount, 0, 'moderate comparison load must not silently become a fracture showcase');
  assert.ok(item.maxRawVertexDisplacement > 0);
}
assert.ok(comparison.cases[0].loadedNodeCount > comparison.cases[1].loadedNodeCount);
assert.equal(comparison.cases[0].loadedNodeCount, comparison.cases[2].loadedNodeCount);
assert.equal(comparison.cases[1].loadedNodeCount, comparison.cases[3].loadedNodeCount);
assert.ok(comparison.adjudication.contactChangesProjection);
assert.ok(comparison.adjudication.interiorChangesProjection);
assert.equal(comparison.claimCeiling.includes('the radial-joint case is a counterfactual, not source-truth construction'), true);

console.log('structural arch assumption mesh consumer contracts passed');
