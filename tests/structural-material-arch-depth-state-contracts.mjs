import assert from 'node:assert/strict';
import { buildArchStructuralProxy } from '../structural-material-arch-core.js';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(glbPath, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const uniform = buildArchStructuralProxy(profile, { layers: 3, depth: 0.36 });
const depthAware = buildArchStructuralProxy(profile, { layers: 3, depthMode: 'surface-envelope' });

assert.equal(depthAware.depthMode, 'surface-envelope',
  'the graph must explicitly consume the selected mesh-depth representation');
assert.equal(depthAware.nodes.length, uniform.nodes.length);
assert.equal(depthAware.components.length, 1, 'depth reconstruction must preserve the initial arch load path');
assert.ok(depthAware.nodes.some((node, index) => node.z !== uniform.nodes[index].z),
  'the depth graph must differ from the uniform extrusion at occupied cells');
assert.deepEqual(depthAware.inferredDepthCells, [1374],
  'only the measured zero-span raster cell may receive the declared local reconstruction');
assert.ok(depthAware.nodes.every(node => node.z >= profile.depthBounds.min[2] - 1e-8 &&
  node.z <= profile.depthBounds.max[2] + 1e-8),
'inferred depth nodes must stay within the source mesh bounds');

const inferredNodes = depthAware.nodes.filter(node => node.row * 48 + node.column === 1374);
assert.ok(inferredNodes[0].z <= profile.depthEnvelope[1374].minZ &&
  inferredNodes.at(-1).z >= profile.depthEnvelope[1374].maxZ,
'the reconstructed interval must retain the measured single-surface Z hit');

for (const cellIndex of [0, 8 * 48 + 24, 20 * 48 + 8, 28 * 48 + 30]) {
  if (!profile.occupancy[cellIndex]) continue;
  const cell = profile.depthEnvelope[cellIndex];
  const nodes = depthAware.nodes.filter(node => node.row * 48 + node.column === cellIndex);
  assert.equal(nodes.length, 3);
  if (cell.maxZ - cell.minZ > 1e-8) {
    assert.ok(Math.abs(nodes[0].z - cell.minZ) < 1e-8);
    assert.ok(Math.abs(nodes[2].z - cell.maxZ) < 1e-8);
  }
}

console.log('structural arch depth state contracts passed');
