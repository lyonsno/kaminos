import assert from 'node:assert/strict';

import {
  buildClaySculptHashGridOracle,
  normalizeClaySculptPointerCollider,
  normalizeClaySculptConfig,
  runClaySculptFirstBrushOracle,
  seedClaySculptParticles,
} from '../clay-core.js';

const config = normalizeClaySculptConfig('12x8x12');
assert.equal(config.requestedClaySculptParticles, '12x8x12');
assert.equal(config.effectiveClaySculptParticles, '12x8x12');
assert.equal(config.sculptX, 12);
assert.equal(config.sculptY, 8);
assert.equal(config.sculptZ, 12);
assert.equal(config.particleCount, 1152);
assert.equal(config.hashGridDimension, 16);
assert.equal(config.hashGridCellCapacity, 12);
assert.deepEqual(config.claySculptConfigWarnings, []);

const sculptPointer = normalizeClaySculptPointerCollider({
  id: 'front-face-sculpt-pointer',
  center: [0.12, 0.36, 0.38],
  rawCenter: [0.12, 0.36, 0.38],
  surfaceNormal: [0, 0, -1],
  radius: 0.17,
  strength: 1.18,
});
assert.equal(sculptPointer.id, 'front-face-sculpt-pointer');
assert.deepEqual(sculptPointer.center, [0.12, 0.36, 0.38]);
assert.deepEqual(sculptPointer.surfaceNormal, [0, 0, -1], 'sculpt pointer preserves inward face normal for front-face contact');
assert.equal(sculptPointer.boundaryClamped, false, 'sculpt pointer should not be inset by the old heightfield margin clamp');

const fallbackConfig = normalizeClaySculptConfig('999x1x1');
assert.equal(fallbackConfig.effectiveClaySculptParticles, '12x8x12');
assert.deepEqual(fallbackConfig.claySculptConfigWarnings, ['unsupported-clay-sculpt-particles:999x1x1']);

const particles = seedClaySculptParticles(config);
assert.equal(particles.length, config.particleCount * 4, 'sculpt particles are packed as vec4 positions');
assert.equal(particles[3], 1, 'sculpt particle w lane stores active mass');

const hashGrid = buildClaySculptHashGridOracle(particles, config);
assert.equal(hashGrid.evidenceKind, 'deterministic-js-hash-grid-oracle-not-runtime-fallback');
assert.equal(hashGrid.hashGridContract, 'fixed-capacity-uniform-grid-neighbor-bins-v0');
assert.equal(hashGrid.hashGridDimension, config.hashGridDimension);
assert.equal(hashGrid.hashGridCellCapacity, config.hashGridCellCapacity);
assert.ok(hashGrid.activeCellCount > 0, 'hash grid oracle records active occupied cells');
assert.ok(hashGrid.maxCellOccupancy > 1, 'seeded sculpt blob should put multiple particles in at least one cell');
assert.equal(hashGrid.overflowCount, 0, 'first sculpt seed should not overflow fixed cell capacity');

const firstIdleOracle = runClaySculptFirstBrushOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  brush: {
    center: [9, 9, 9],
    radius: 0.05,
    strength: 1,
    normal: [0, 0, -1],
  },
});
assert.equal(firstIdleOracle.neighborCohesionDisplacement, 0, 'seed particle w lane is active mass and must not be treated as previous contact');
assert.equal(firstIdleOracle.deformedParticleCount, 0, 'idle sculpt brush should not deform on the first step');

const oracle = runClaySculptFirstBrushOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  brush: {
    center: [0.18, 0.42, 0.34],
    radius: 0.22,
    strength: 1.1,
    normal: [0, 0, -1],
  },
});

assert.equal(oracle.solverIdentity, 'webgpu-clay-particle-sculpt-hash-grid-v0');
assert.equal(oracle.evidenceKind, 'deterministic-js-sculpt-oracle-not-runtime-fallback');
assert.equal(oracle.hashGridEvidenceKind, 'deterministic-js-hash-grid-oracle-not-runtime-fallback');
assert.equal(oracle.hashGridContract, 'fixed-capacity-uniform-grid-neighbor-bins-v0');
assert.equal(oracle.particleCount, config.particleCount);
assert.ok(oracle.activeCellCount > 0, 'sculpt oracle preserves hash-grid active-cell count');
assert.ok(oracle.neighborSampleCount > 0, 'sculpt oracle actually samples hash-grid neighbors');
assert.ok(oracle.contactParticleCount > 0, 'sculpt brush contacts particles');
assert.ok(oracle.deformedParticleCount > 0, 'sculpt brush deforms particles');
assert.ok(oracle.maxDisplacement > 0.02, 'sculpt brush produces readable displacement');
assert.ok(oracle.averageNeighborCount > 1, 'sculpt seed has meaningful neighborhood density');
assert.ok(oracle.neighborCohesionDisplacement > 0, 'sculpt oracle applies a first cohesion term from hash-grid neighbors');

let idleState = particles;
for (let step = 0; step < 4; step += 1) {
  idleState = runClaySculptFirstBrushOracle({
    basePositions: particles,
    previousPositions: idleState,
    config,
    brush: {
      center: [9, 9, 9],
      radius: 0.05,
      strength: 1,
      normal: [0, 0, -1],
    },
  }).positions;
}
const idleOracle = runClaySculptFirstBrushOracle({
  basePositions: particles,
  previousPositions: idleState,
  config,
  brush: {
    center: [9, 9, 9],
    radius: 0.05,
    strength: 1,
    normal: [0, 0, -1],
  },
});
assert.equal(idleOracle.contactParticleCount, 0, 'idle sculpt brush should not contact particles');
assert.equal(idleOracle.deformedParticleCount, 0, 'hash-grid cohesion must not shrink the whole sculpt body without brush contact');

let repeatedBrushState = particles;
let repeatedBrushOracle = null;
for (let step = 0; step < 8; step += 1) {
  repeatedBrushOracle = runClaySculptFirstBrushOracle({
    basePositions: particles,
    previousPositions: repeatedBrushState,
    config,
    brush: {
      center: [0.18, 0.42, 0.34],
      radius: 0.22,
      strength: 1.1,
      normal: [0, 0, -1],
    },
  });
  repeatedBrushState = repeatedBrushOracle.positions;
}
assert.ok(repeatedBrushOracle.deformedParticleCount < config.particleCount * 0.45, 'small sculpt brush leaked deformation into most of the body');
assert.ok(repeatedBrushOracle.contactParticleCount < config.particleCount * 0.20, 'small sculpt brush contact footprint grew too broad');
