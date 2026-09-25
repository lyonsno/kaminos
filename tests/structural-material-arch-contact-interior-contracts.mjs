import assert from 'node:assert/strict';
import {
  buildArchStructuralProxy,
  fractureArchStructuralProxy,
  solveArchStructuralForce,
} from '../structural-material-arch-core.js';
import { buildArchProfileFromGlb } from '../structural-material-arch-profile.mjs';

const source = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/trellis-intact/output.glb';
const profile = buildArchProfileFromGlb(source, 48, 36, {
  min: [-0.5, -0.39],
  max: [0.5, 0.39],
});
const graphOptions = { layers: 3, depthMode: 'surface-envelope' };
const continuous = buildArchStructuralProxy(profile, graphOptions);

const throughThickness = solveArchStructuralForce(continuous, {
  x: -0.05,
  y: 0.29,
  force: 0.25,
  patchRadius: 0.032,
  contactDepthMode: 'through-thickness',
});
const cameraFace = solveArchStructuralForce(continuous, {
  x: -0.05,
  y: 0.29,
  force: 0.25,
  patchRadius: 0.032,
  contactDepthMode: 'camera-facing-surface',
});

assert.equal(continuous.interiorMode, 'continuous');
assert.equal(throughThickness.load.requestedForce, 0.25);
assert.equal(cameraFace.load.requestedForce, 0.25);
assert.equal(throughThickness.load.contactDepthMode, 'through-thickness');
assert.equal(cameraFace.load.contactDepthMode, 'camera-facing-surface');
assert.equal(throughThickness.load.loadedNodeCount, 27);
assert.equal(cameraFace.load.loadedNodeCount, 9);
assert.ok(cameraFace.load.loadedNodeLayers.every(layer => layer === 2));

const jointed = buildArchStructuralProxy(profile, {
  ...graphOptions,
  interiorMode: 'radial-voussoir-joints',
  radialJointCount: 9,
  jointStiffnessRatio: 0.35,
  jointStrength: 0.025,
});
const jointBonds = jointed.bonds.filter(bond => bond.kind === 'joint');
assert.equal(jointed.interiorMode, 'radial-voussoir-joints');
assert.equal(jointed.components.length, 1);
assert.ok(jointed.interiorConstruction.radialFanCenter);
assert.ok(jointed.interiorConstruction.springlineY < jointed.bounds.max[1]);
assert.ok(jointBonds.length > 0);
assert.ok(jointBonds.every(bond => bond.stiffness < 1 && bond.strength === 0.025));
assert.ok(jointBonds.every(bond => bond.midpoint.y >= jointed.interiorConstruction.springlineY));

const targetJoint = jointBonds[0];
const strainedJoint = {
  ...jointed,
  bonds: jointed.bonds.map(bond => bond.id === targetJoint.id
    ? { ...bond, lastStrain: 0.03 }
    : { ...bond, lastStrain: 0 }),
};
const jointFailure = fractureArchStructuralProxy(strainedJoint, { threshold: 0.04 });
assert.equal(jointFailure.events.length, 1);
assert.equal(jointFailure.events[0].bondId, targetJoint.id);

console.log('structural arch contact/interior contracts passed');
