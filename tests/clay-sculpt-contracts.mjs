import assert from 'node:assert/strict';

import {
  buildClaySculptHashGridOracle,
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
