import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const solverPath = join(root, 'structural-material-3d-resident-solver.js');
const hotSidecarPath = join(root, 'structural-material-3d-webgpu-hot-sidecar.js');
const hotWitnessPath = join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs');
const greenroomWrapperPath = join(root, 'structural-material-3d-resident-solver-greenroom-launch.mjs');
const tearPath = join(root, 'structural-material-3d-webgpu-tear.js');

assert.ok(
  existsSync(solverPath),
  'GPU-resident structural solver core exists as an explicit authority surface',
);

const {
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER,
  buildLayeredStructuralResidentSolverInteraction,
  solveLayeredStructuralCpuConstraints,
} = await import('../structural-material-3d-resident-solver.js');

assert.equal(
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
  'kaminos.structural-material.webgpu-resident-compliant-jacobi.v0',
);
assert.equal(
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  'retained-webgpu-node-displacement-live-bond-constraints-v0',
);
assert.match(STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER, /var<storage, read> sourceNodes/);
assert.match(STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER, /var<storage, read_write> targetNodes/);
assert.match(STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER, /bond\.material\.w < 0\.5/);
assert.match(STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER, /componentLabels/);

const hotSource = readFileSync(hotSidecarPath, 'utf8');
const tearSource = readFileSync(tearPath, 'utf8');
const hotWitnessSource = readFileSync(hotWitnessPath, 'utf8');
assert.match(hotSource, /STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_SHADER/,
  'the hot sidecar compiles the retained solver shader');
assert.match(hotSource, /hot-structural-solver-node-ping/,
  'the hot sidecar owns a second retained node-state buffer');
assert.match(hotSource, /hot-structural-solver-node-readback/,
  'interactive receipts read the solved node state consumed by the shell');
assert.match(hotSource, /solverPass\.dispatchWorkgroups/,
  'every accepted interaction dispatches bounded solver iterations');
assert.match(hotSource, /nodeDisplacements/,
  'the compact interactive receipt carries GPU-authored node displacement state');
assert.match(tearSource, /gpuStructuralState\?\.nodeDisplacements/,
  'the tear material bridge consumes GPU-authored displacement instead of inventing it');
assert.match(hotWitnessSource, /residentSolverIdentity/,
  'the native browser witness proves effective solver route and authority');
assert.match(hotWitnessSource, /retainedSolverGeneration/,
  'the native browser witness proves ordered retained solver generations');
assert.match(hotWitnessSource, /solverContactAndIsolation/,
  'the native browser witness rejects contact error, support motion, or disconnected response');
assert.match(hotWitnessSource, /cpuGpuSolverParity/,
  'the native browser witness compares WebGPU node displacement against the CPU solver oracle');
assert.ok(existsSync(greenroomWrapperPath), 'resident solver has a durable GPU Greenroom wrapper');
const greenroomWrapperSource = readFileSync(greenroomWrapperPath, 'utf8');
assert.match(greenroomWrapperSource, /failedChecks/,
  'the Greenroom wrapper fails closed on product identity and evidence checks');
assert.match(greenroomWrapperSource, /failurePhase/,
  'the Greenroom wrapper preserves failure phase before primary output');
assert.match(greenroomWrapperSource, /STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE/,
  'the Greenroom wrapper binds requested and effective solver route identity');
assert.match(greenroomWrapperSource, /screenshot.*byteLength/is,
  'the Greenroom wrapper verifies the exact screenshot artifact and byte count');

const state = createLayeredStructuralMaterial({
  columns: 9,
  rows: 5,
  layers: 4,
  notch: true,
  profile: 'rib-upper-v0',
});
const contactIndex = state.nodes.findIndex(node =>
  !node.pinned && node.x === 1 && node.y === 0.5 && node.z === 0.33333);
assert.ok(contactIndex >= 0, 'fixture resolves an unpinned right-face contact');
const contactNode = state.nodes[contactIndex];
const interaction = {
  kind: 'camera-relative-picked-layered-drag',
  gestureId: 'resident-solver-gesture-1',
  point: { x: contactNode.x, y: contactNode.y, z: contactNode.z },
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'node',
    id: contactNode.id,
    segmentT: null,
  },
  vector: { x: 0, y: 1, z: 0 },
  dragLength: 0.18,
  magnitude: 0.657,
  radius: 0.2,
};
const solverInteraction = buildLayeredStructuralResidentSolverInteraction(state, interaction);
const solved = solveLayeredStructuralCpuConstraints(state, solverInteraction);

assert.equal(solved.status, 'passed');
assert.equal(solved.route, STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE);
assert.equal(solved.iterationCount, 12);
assert.deepEqual(
  solved.nodes[contactIndex].displacement,
  solverInteraction.contactTargetDisplacements[0],
  'the picked structural owner lands exactly on the gesture-relative target',
);
assert.ok(
  solved.nodes.some((node, index) => index !== contactIndex && !node.pinned &&
    Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z) > 0.000001),
  'live constraints propagate nonzero displacement beyond the picked node',
);
assert.ok(
  Math.max(...solved.nodes.filter(node => !node.pinned && node.id !== contactNode.id)
    .map(node => Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z))) < 0.18,
  'non-contact response remains below the exact contact displacement',
);
for (const node of solved.nodes.filter(node => node.pinned)) {
  assert.deepEqual(node.displacement, { x: 0, y: 0, z: 0 }, 'non-contact supports remain exact');
}
assert.ok(solved.metrics.maxConstraintResidual > 0, 'the solved field exposes a finite residual');
assert.ok(solved.iterations.at(-1).maxCorrection < solved.iterations[1].maxCorrection,
  'bounded Jacobi iterations reduce correction magnitude after contact propagation begins');

const splitState = createLayeredStructuralMaterial({
  columns: 9,
  rows: 5,
  layers: 4,
  notch: true,
  profile: 'rib-upper-v0',
});
splitState.bonds = splitState.bonds.map(bond => {
  const a = splitState.nodes.find(node => node.id === bond.a);
  const b = splitState.nodes.find(node => node.id === bond.b);
  return a.x < 0.75 && b.x >= 0.75 || b.x < 0.75 && a.x >= 0.75
    ? { ...bond, alive: false }
    : bond;
});
const splitInteraction = buildLayeredStructuralResidentSolverInteraction(splitState, interaction);
const splitSolved = solveLayeredStructuralCpuConstraints(splitState, splitInteraction);
for (const node of splitSolved.nodes.filter(node => node.x < 0.75)) {
  assert.deepEqual(
    node.displacement,
    { x: 0, y: 0, z: 0 },
    'the disconnected non-contact component receives no current solver response',
  );
}
assert.notDeepEqual(
  splitSolved.nodes.map(node => node.displacement),
  solved.nodes.map(node => node.displacement),
  'removing live transmission bonds changes the solved displacement field',
);

const continuedInteraction = buildLayeredStructuralResidentSolverInteraction(
  { ...state, nodes: solved.nodes },
  { ...interaction, gestureId: 'resident-solver-gesture-2', vector: { x: 1, y: 0, z: 0 }, dragLength: 0.08 },
);
const continued = solveLayeredStructuralCpuConstraints({ ...state, nodes: solved.nodes }, continuedInteraction);
assert.ok(
  continued.nodes.some(node => Math.abs(node.displacement.y) > 0.000001),
  'a second gesture begins from and retains the first solved state',
);
assert.ok(continued.nodes[contactIndex].displacement.x > 0, 'the second gesture adds its own axis');

const upper = createLayeredStructuralMaterial({
  columns: 9, rows: 5, layers: 4, notch: true, profile: 'rib-upper-v0',
});
const lower = createLayeredStructuralMaterial({
  columns: 9, rows: 5, layers: 4, notch: true, profile: 'rib-lower-v0',
});
const offCenterContact = upper.nodes.find(node =>
  !node.pinned && node.x === 1 && node.y === 0.25 && node.z === 0.33333);
const profileInteraction = {
  ...interaction,
  gestureId: 'profile-discrimination',
  point: { x: offCenterContact.x, y: offCenterContact.y, z: offCenterContact.z },
  contactIdentity: { ...interaction.contactIdentity, id: offCenterContact.id },
};
const upperSolved = solveLayeredStructuralCpuConstraints(
  upper,
  buildLayeredStructuralResidentSolverInteraction(upper, profileInteraction),
);
const lowerSolved = solveLayeredStructuralCpuConstraints(
  lower,
  buildLayeredStructuralResidentSolverInteraction(lower, profileInteraction),
);
assert.ok(
  Math.abs(upperSolved.metrics.meanConstraintResidual - lowerSolved.metrics.meanConstraintResidual) > 1e-8,
  'mirrored rib stiffness produces a measurably different solved residual field',
);

console.log('structural-material-3d resident solver contracts passed');
