import assert from 'node:assert/strict';
import { buildArchStructuralProxy } from '../structural-material-arch-core.js';
import { carveArchBoundaryNotch } from '../structural-material-arch-depth-assay.mjs';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const glbPath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(glbPath, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const notched = carveArchBoundaryNotch(profile, {
  side: 'left',
  region: { minX: -0.42, maxX: -0.34, minY: 0.2, maxY: 0.27 },
});

assert.deepEqual(notched.controlledNotch.removedCells.sort((a, b) => a - b),
  [1301, 1302, 1303, 1350, 1351, 1399],
  'the shoulder cut must remove the full exterior-connected region from one explicit source profile');
assert.equal(notched.source.sha256, profile.source.sha256);
assert.equal(notched.occupancy.filter(Boolean).length, profile.occupancy.filter(Boolean).length - 6);
assert.ok(notched.controlledNotch.removedCells.every(index => notched.depthEnvelope[index] === null));
assert.equal(buildArchStructuralProxy(notched, { depthMode: 'surface-envelope' }).components.length, 1,
  'the controlled notch must not sever the arch before loading');

console.log('structural arch controlled notch contracts passed');
