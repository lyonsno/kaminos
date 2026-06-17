import assert from 'node:assert/strict';

import {
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
assert.ok(oracle.maxDisplacement > 0.01, 'cube oracle produces readable 3D displacement');
assert.ok(oracle.minY < 0.08, 'cube oracle lets lower/interior material move, not only the top skin');
assert.ok(oracle.heightRange > 0.25, 'cube oracle keeps a coherent 3D height span');
