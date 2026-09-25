import assert from 'node:assert/strict';
import { buildArchStructuralProxy, solveArchStructuralForce } from '../structural-material-arch-core.js';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(glbPath, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const state = buildArchStructuralProxy(profile, { layers: 3, depthMode: 'surface-envelope' });
const requested = { x: -0.05, y: 0.29, force: 0.25, patchRadius: 0.032 };
const solved = solveArchStructuralForce(state, requested);
const point = solveArchStructuralForce(state, { x: requested.x, y: requested.y, force: requested.force });

assert.deepEqual(solved.load.contact, { column: 21, row: 31 });
assert.equal(solved.load.patchRadius, requested.patchRadius);
assert.equal(solved.load.contactCells.length, 9);
assert.equal(solved.load.loadedNodeCount, 27);
assert.equal(solved.load.forcePerNode * solved.load.loadedNodeCount, requested.force);
assert.ok(Math.abs(solved.load.effectiveForce - requested.force) < 1e-6);
assert.deepEqual(solved.load.contactCells, [...solved.load.contactCells].sort((a, b) =>
  a.row - b.row || a.column - b.column));
assert.equal(point.load.patchRadius, 0);
assert.equal(point.load.contactCells.length, 1);
assert.equal(point.load.loadedNodeCount, 3);
assert.equal(point.load.forcePerNode * point.load.loadedNodeCount, requested.force);
assert.throws(() => solveArchStructuralForce(state, { ...requested, patchRadius: -0.001 }), /invalid arch load/);
assert.equal(solved.nodes.filter(node => node.pinned).every(node =>
  node.displacement.x === 0 && node.displacement.y === 0 && node.displacement.z === 0), true);

console.log('structural arch contact patch contracts passed');
