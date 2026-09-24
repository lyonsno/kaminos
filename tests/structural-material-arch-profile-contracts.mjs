import assert from 'node:assert/strict';
import { readArchGlbTriangles, buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';
import { buildArchStructuralProxy, solveArchStructuralForce } from '../structural-material-arch-core.js';

assert.throws(() => readArchGlbTriangles(Buffer.alloc(32)), /GLB|glTF|invalid/i);

const base = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24';
const intact = buildArchProfileFromGlb(`${base}/trellis-intact/output.glb`);
const notched = buildArchProfileFromGlb(`${base}/trellis-outer-notch/output.glb`);
assert.equal(intact.source.sha256, 'c65a3cf3dc3b5a053a9a5f25c1f652d7ccd94c13236077220ce42400b765cad5');
assert.equal(notched.source.sha256, '8072e0226b19283ec26919ddf6da02ea71036423479ad7336272eaf427ccf594');
assert.equal(intact.occupancy.length, 48 * 36);
assert.equal(notched.occupancy.length, 48 * 36);
const centralOpening = (profile) => profile.occupancy[8 * 48 + 24];
assert.equal(centralOpening(intact), false);
assert.equal(centralOpening(notched), false);
const topLeftShoulderCount = (profile) => profile.occupancy.reduce((count, occupied, index) => {
  const column = index % 48;
  const row = Math.floor(index / 48);
  const x = profile.bounds.min[0] + (column + 0.5) * (profile.bounds.max[0] - profile.bounds.min[0]) / 48;
  const y = profile.bounds.min[1] + (row + 0.5) * (profile.bounds.max[1] - profile.bounds.min[1]) / 36;
  return count + Number(occupied && x > -0.17 && x < -0.08 && y > 0.26);
}, 0);
assert.ok(topLeftShoulderCount(notched) < topLeftShoulderCount(intact));
const sharedBounds = { min: [-0.5, -0.39], max: [0.5, 0.39] };
const sharedIntact = buildArchProfileFromGlb(`${base}/trellis-intact/output.glb`, 48, 36, sharedBounds);
const sharedProxy = buildArchStructuralProxy(sharedIntact);
assert.ok(sharedProxy.nodes.some(node => node.pinned && node.x < 0));
assert.ok(sharedProxy.nodes.some(node => node.pinned && node.x > 0));
const sharedNotched = buildArchStructuralProxy(buildArchProfileFromGlb(`${base}/trellis-outer-notch/output.glb`, 48, 36, sharedBounds));
const load = { x: -0.05, y: 0.29, force: 0.025, iterations: 600 };
const intactForce = solveArchStructuralForce(sharedProxy, load);
const notchedForce = solveArchStructuralForce(sharedNotched, load);
const notchedLong = solveArchStructuralForce(sharedNotched, { ...load, iterations: 1200 });
assert.deepEqual(intactForce.load.contact, notchedForce.load.contact);
assert.ok(Math.abs(intactForce.load.effectiveForce - load.force) < 1e-6);
assert.ok(Math.abs(notchedForce.load.effectiveForce - load.force) < 1e-6);
assert.ok(notchedForce.load.travel > intactForce.load.travel * 1.15);
assert.ok(Math.abs(notchedLong.load.travel - notchedForce.load.travel) / notchedLong.load.travel < 0.01,
  'equal-force travel must be stable when the iteration budget doubles');
const shoulderMean = state => {
  const bonds = state.bonds.filter(bond => bond.midpoint.x > -0.19 && bond.midpoint.x < -0.07 &&
    bond.midpoint.y > 0.16 && Math.hypot(bond.midpoint.x + 0.05, bond.midpoint.y - 0.29) > 0.05);
  return bonds.reduce((sum, bond) => sum + bond.lastStrain, 0) / bonds.length;
};
assert.ok(shoulderMean(notchedForce) > shoulderMean(intactForce) * 1.2);

console.log('structural arch GLB profile contracts passed');
