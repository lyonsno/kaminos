import assert from 'node:assert/strict';

import {
  normalizeClayCubePointerCollider,
  normalizeClayCubeConfig,
  runClayCubeFirstLoopOracle,
  seedClayCubeMaterialPoints,
} from '../clay-core.js';

const config = normalizeClayCubeConfig('8x8x8');
assert.equal(config.requestedClayCube, '8x8x8');
assert.equal(config.effectiveClayCube, '8x8x8');
assert.equal(config.cubeX, 8);
assert.equal(config.cubeY, 8);
assert.equal(config.cubeZ, 8);
assert.equal(config.particleCount, 512);
assert.equal(config.gridDimension, 16);
assert.deepEqual(config.clayCubeConfigWarnings, []);

const unsupported = normalizeClayCubeConfig('99x2x1');
assert.equal(unsupported.effectiveClayCube, '8x8x8', 'unsupported cube preset falls back to default explicitly');
assert.deepEqual(unsupported.clayCubeConfigWarnings, ['unsupported-clay-cube:99x2x1']);

const particles = seedClayCubeMaterialPoints(config);
assert.equal(particles.length, config.particleCount * 4, 'cube material points are packed as vec4 positions');
assert.ok(particles[0] < 0 && particles[2] < 0, 'first material point starts in the negative cube corner');
assert.ok(particles[particles.length - 4] > 0, 'last material point reaches positive X extent');
assert.equal(particles[3], 1, 'material point w lane stores active mass');

const oracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [{
    id: 'test-finger',
    center: [0, 0.34, 0],
    radius: 0.46,
    strength: 1.35,
  }],
});

assert.equal(oracle.evidenceKind, 'deterministic-js-oracle-not-runtime-fallback');
assert.equal(oracle.particleCount, config.particleCount);
assert.equal(oracle.gridDimension, config.gridDimension);
assert.ok(oracle.deformedParticleCount > 0, 'cube oracle produces hand-influenced deformation');
assert.ok(oracle.contactParticleCount > 0, 'cube oracle records hand contact over material points');
assert.ok(oracle.activeGridCellCount > 0, 'cube oracle records occupied grid cells');
assert.equal(oracle.surfaceVisible, false, 'cube oracle defaults to cube-only witness visibility');
assert.equal(oracle.diagnosticColorMode, 'cube-diagnostic-contact-displacement-colors-v0');
assert.ok(oracle.diagnosticColoredParticleCount > 0, 'cube oracle records particles receiving diagnostic color');
assert.ok(oracle.diagnosticHotParticleCount > 0, 'cube oracle records hot/contact diagnostic particles');
assert.equal(oracle.faceMetricEvidenceKind, 'solver-space-material-point-face-locality-v0');
assert.ok(Number.isFinite(oracle.frontBackDeformationRatio), 'cube oracle reports front/back deformation ratio');
assert.ok(oracle.edgeBandDeformedParticleCount >= 0, 'cube oracle reports edge-band deformation count');
assert.ok(oracle.cornerBandDeformedParticleCount >= 0, 'cube oracle reports corner-band deformation count');
assert.ok(['front', 'back', 'left', 'right', 'top', 'bottom', 'interior'].includes(oracle.maxDisplacementFace), 'cube oracle names max displacement face');
assert.ok(oracle.maxDisplacement > 0.01, 'cube oracle produces readable 3D displacement');
assert.ok(oracle.minY < 0.08, 'cube oracle lets lower/interior material move, not only the top skin');
assert.ok(oracle.heightRange > 0.25, 'cube oracle keeps a coherent 3D height span');

const cubePointer = normalizeClayCubePointerCollider({
  id: 'front-face-pointer',
  center: [0.0968, 0.4468, 0.34],
  rawCenter: [0.0968, 0.4468, 0.34],
  surfaceNormal: [0, 0, -1],
  radius: 0.17,
  strength: 1.18,
});

assert.equal(cubePointer.id, 'front-face-pointer');
assert.equal(cubePointer.center[0], 0.0968);
assert.equal(cubePointer.center[1], 0.4468);
assert.equal(cubePointer.center[2], 0.34, 'cube pointer normalization must not inset a front-face hit with the old heightfield edge clamp');
assert.deepEqual(cubePointer.rawCenter, [0.0968, 0.4468, 0.34]);
assert.deepEqual(cubePointer.surfaceNormal, [0, 0, -1], 'cube pointer preserves inward face normal for front-face contact');
assert.equal(cubePointer.radius, 0.17);
assert.equal(cubePointer.strength, 1.18);

const frontFaceOracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [cubePointer],
});

let maxAbsY = 0;
let maxInwardZ = 0;
for (let i = 0; i < config.particleCount; i += 1) {
  const offset = i * 4;
  maxAbsY = Math.max(maxAbsY, Math.abs(frontFaceOracle.positions[offset + 1] - particles[offset + 1]));
  maxInwardZ = Math.max(maxInwardZ, particles[offset + 2] - frontFaceOracle.positions[offset + 2]);
}
assert.ok(maxInwardZ > maxAbsY * 2, `front-face cube brush should press inward along Z, not down like the top surface: z=${maxInwardZ} y=${maxAbsY}`);

const leftFacePointer = normalizeClayCubePointerCollider({
  id: 'left-face-pointer',
  center: [-0.44, 0.34, 0.02],
  rawCenter: [-0.44, 0.34, 0.02],
  surfaceNormal: [1, 0, 0],
  radius: 0.17,
  strength: 1.18,
});
const leftFaceOracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [leftFacePointer],
});

let maxInwardX = 0;
let leftMaxAbsY = 0;
for (let i = 0; i < config.particleCount; i += 1) {
  const offset = i * 4;
  maxInwardX = Math.max(maxInwardX, leftFaceOracle.positions[offset] - particles[offset]);
  leftMaxAbsY = Math.max(leftMaxAbsY, Math.abs(leftFaceOracle.positions[offset + 1] - particles[offset + 1]));
}
assert.ok(maxInwardX > leftMaxAbsY * 2, `side-face cube brush should press inward along X, not down like the top surface: x=${maxInwardX} y=${leftMaxAbsY}`);
