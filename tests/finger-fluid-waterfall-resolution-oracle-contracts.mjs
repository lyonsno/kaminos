import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED,
  KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE,
  KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
  KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS,
  createFingerFluidTruthSceneParticles,
  createFingerFluidWaterfallOracleConfig,
  createFingerFluidWaterfallOracleEvidenceIdentity,
  evaluateFingerFluidWaterfallOraclePair,
  resolveFingerFluidMaxSpeed,
  resolveFingerFluidWaterfallOraclePreset,
  sampleFingerFluidWaterfallOracleParticle,
} from '../finger-fluid-webgpu-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreSource = fs.readFileSync(path.join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
const witnessSource = fs.readFileSync(path.join(root, 'finger-fluid-waterfall-oracle-witness.mjs'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.equal(
  KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
  'isolated-slot-waterfall-uniform-resolution-oracle-v0',
);
assert.equal(KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED, Math.fround(3.2));
assert.equal(KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE, 3.2);
assert.equal(resolveFingerFluidMaxSpeed(undefined), KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED);
assert.equal(resolveFingerFluidMaxSpeed(8), 8);
assert.equal(resolveFingerFluidMaxSpeed(8.123456789), Math.fround(8.123456789));
assert.throws(() => resolveFingerFluidMaxSpeed(0), /maximum speed must be finite and positive/);
assert.throws(() => resolveFingerFluidMaxSpeed(Number.NaN), /maximum speed must be finite and positive/);
assert.throws(() => resolveFingerFluidMaxSpeed(4e-40), /normal finite f32/);
assert.throws(() => resolveFingerFluidMaxSpeed(Number.MAX_VALUE), /normal finite f32/);
assert.deepEqual(KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS, ['baseline', 'production', 'sweep3x', 'sweep4x', 'sweep6x', 'high']);
assert.equal(resolveFingerFluidWaterfallOraclePreset('baseline'), 'baseline');
assert.equal(resolveFingerFluidWaterfallOraclePreset('production'), 'production');
assert.equal(resolveFingerFluidWaterfallOraclePreset('sweep3x'), 'sweep3x');
assert.equal(resolveFingerFluidWaterfallOraclePreset('sweep4x'), 'sweep4x');
assert.equal(resolveFingerFluidWaterfallOraclePreset('sweep6x'), 'sweep6x');
assert.equal(resolveFingerFluidWaterfallOraclePreset('high'), 'high');
assert.throws(() => resolveFingerFluidWaterfallOraclePreset('ultra'), /Unsupported finger fluid waterfall oracle preset/);

const baseline = createFingerFluidWaterfallOracleConfig('baseline');
const production = createFingerFluidWaterfallOracleConfig('production');
const sweep3x = createFingerFluidWaterfallOracleConfig('sweep3x');
const sweep4x = createFingerFluidWaterfallOracleConfig('sweep4x');
const sweep6x = createFingerFluidWaterfallOracleConfig('sweep6x');
const high = createFingerFluidWaterfallOracleConfig('high');
assert.equal(baseline.contract, KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT);
assert.equal(baseline.sourceId, 'slot-spout');
assert.equal(baseline.refinementFactor, 1);
assert.equal(production.refinementFactor, Math.cbrt(2));
assert.equal(high.refinementFactor, 2);
assert.ok(Math.abs(production.particleSpacing - baseline.particleSpacing / Math.cbrt(2)) < 1e-12);
assert.ok(Math.abs(production.kernelRadius - baseline.kernelRadius / Math.cbrt(2)) < 1e-12);
assert.ok(Math.abs(production.visibleParticleRadius - baseline.visibleParticleRadius / Math.cbrt(2)) < 1e-12);
assert.ok(Math.abs(production.particleVolume - baseline.particleVolume / 2) < 1e-12);
assert.equal(production.defaultParticleCount, 24_576);
assert.equal(production.laneColumns, 19);
assert.equal(production.laneRows, 5);
assert.equal(production.laneCount, 95);
assert.equal(production.physicalSourceFlux, baseline.physicalSourceFlux);
assert.ok(Math.abs(production.expectedParticleReleaseRate - baseline.expectedParticleReleaseRate * 2) < 1e-9);
assert.deepEqual(production.camera, baseline.camera);
for (const [config, multiplier, columns, rows] of [
  [sweep3x, 3, 22, 6],
  [sweep4x, 4, 24, 6],
  [sweep6x, 6, 27, 7],
]) {
  assert.equal(config.refinementFactor, Math.cbrt(multiplier));
  assert.ok(Math.abs(config.particleSpacing - baseline.particleSpacing / Math.cbrt(multiplier)) < 1e-12);
  assert.ok(Math.abs(config.particleVolume - baseline.particleVolume / multiplier) < 1e-12);
  assert.equal(config.defaultParticleCount, baseline.defaultParticleCount * multiplier);
  assert.equal(config.laneColumns, columns);
  assert.equal(config.laneRows, rows);
  assert.ok(Math.abs(config.expectedParticleReleaseRate - baseline.expectedParticleReleaseRate * multiplier) < 1e-9);
  assert.equal(config.physicalSourceFlux, baseline.physicalSourceFlux);
  assert.deepEqual(config.camera, baseline.camera);
}
assert.equal(high.particleSpacing, baseline.particleSpacing / 2);
assert.equal(high.kernelRadius, baseline.kernelRadius / 2);
assert.equal(high.visibleParticleRadius, baseline.visibleParticleRadius / 2);
assert.equal(high.particleVolume, baseline.particleVolume / 8);
assert.equal(high.defaultParticleCount, baseline.defaultParticleCount * 8);
assert.equal(high.laneColumns, baseline.laneColumns * 2);
assert.equal(high.laneRows, baseline.laneRows * 2);
assert.equal(high.laneCount, baseline.laneCount * 4);
assert.equal(high.physicalSourceFlux, baseline.physicalSourceFlux);
assert.equal(high.expectedParticleReleaseRate, baseline.expectedParticleReleaseRate * 8);
assert.deepEqual(high.camera, baseline.camera);

function realizedOracleSourceFlux(config) {
  let particleRate = 0;
  for (let lane = 0; lane < config.laneCount; lane += 1) {
    particleRate += 60 / sampleFingerFluidWaterfallOracleParticle(lane, config.preset).releasePeriodFrames;
  }
  return particleRate * config.particleVolume;
}

for (const config of [baseline, production, high]) {
  assert.ok(
    Math.abs(realizedOracleSourceFlux(config) - baseline.physicalSourceFlux) < 1e-9,
    `${config.preset} realized source flux must match the common physical source flux`,
  );
}
assert.match(coreSource, /fractional-lane-error-diffusion-v0/);
assert.match(coreSource, /laminar_inlet_release_due/);

const baselineParticles = createFingerFluidTruthSceneParticles(
  baseline.defaultParticleCount,
  'waterfall_resolution_oracle',
  { waterfallOraclePreset: 'baseline' },
);
const productionParticles = createFingerFluidTruthSceneParticles(
  production.defaultParticleCount,
  'waterfall_resolution_oracle',
  { waterfallOraclePreset: 'production' },
);
const highParticles = createFingerFluidTruthSceneParticles(
  high.defaultParticleCount,
  'waterfall_resolution_oracle',
  { waterfallOraclePreset: 'high' },
);
assert.equal(baselineParticles.length, baseline.defaultParticleCount * 16);
assert.equal(productionParticles.length, production.defaultParticleCount * 16);
assert.equal(highParticles.length, high.defaultParticleCount * 16);
for (let index = 0; index < baseline.defaultParticleCount; index += 1) {
  assert.ok(Math.abs(Math.abs(baselineParticles[index * 16 + 11]) - 0.48) < 1e-6, 'the isolated oracle contains only the slot source');
}
for (let index = 0; index < production.defaultParticleCount; index += 1) {
  assert.ok(Math.abs(Math.abs(productionParticles[index * 16 + 11]) - 0.48) < 1e-6, 'the production oracle contains only the slot source');
}
for (let index = 0; index < high.defaultParticleCount; index += 1) {
  assert.ok(Math.abs(Math.abs(highParticles[index * 16 + 11]) - 0.48) < 1e-6, 'the high oracle contains only the slot source');
}

const common = {
  truthScene: 'waterfall_resolution_oracle',
  rendererMode: 'sphere_debug',
  colorMode: 'phase',
  opticalDebugMode: 'shaded',
  fixedTimeStepSeconds: 1 / 60,
  capturedStep: 480,
  physicalSourceFlux: baseline.physicalSourceFlux,
  capillaryStrength: 0.72,
  supportFriction: 1.6,
  freeFlightViscosityBoost: 0.17,
  thinSheetVorticityAttenuation: 0.88,
  unsupportedSheetStrength: 0,
  maxFluidSpeed: KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED,
  densityIterations: 3,
  camera: baseline.camera,
};
const baselineIdentity = createFingerFluidWaterfallOracleEvidenceIdentity({
  ...common,
  ...baseline,
  requestedPreset: 'baseline',
  effectivePreset: 'baseline',
  particleCount: baseline.defaultParticleCount,
});
const highIdentity = createFingerFluidWaterfallOracleEvidenceIdentity({
  ...common,
  ...high,
  requestedPreset: 'high',
  effectivePreset: 'high',
  particleCount: high.defaultParticleCount,
});
const acceptedPair = evaluateFingerFluidWaterfallOraclePair({
  baselineIdentity,
  highIdentity,
  baselineArtifact: { path: '/tmp/baseline.png', sha256: 'a'.repeat(64), width: 1600, height: 1000 },
  highArtifact: { path: '/tmp/high.png', sha256: 'b'.repeat(64), width: 1600, height: 1000 },
});
assert.equal(acceptedPair.mechanicalChecksOk, true);
assert.equal(acceptedPair.status, 'captured_pending_operator_disposition');
assert.equal(acceptedPair.operatorDispositionRequired, true);
assert.equal(acceptedPair.visualContinuityAccepted, null);

assert.throws(() => evaluateFingerFluidWaterfallOraclePair({
  baselineIdentity,
  highIdentity: { ...highIdentity, physicalSourceFlux: highIdentity.physicalSourceFlux * 1.1 },
  baselineArtifact: { path: '/tmp/baseline.png', sha256: 'a'.repeat(64), width: 1600, height: 1000 },
  highArtifact: { path: '/tmp/high.png', sha256: 'b'.repeat(64), width: 1600, height: 1000 },
}), /physical source flux mismatch/);

assert.throws(() => evaluateFingerFluidWaterfallOraclePair({
  baselineIdentity,
  highIdentity,
  baselineArtifact: null,
  highArtifact: { path: '/tmp/high.png', sha256: 'b'.repeat(64), width: 1600, height: 1000 },
}), /baseline artifact missing or partial/);

assert.throws(() => evaluateFingerFluidWaterfallOraclePair({
  baselineIdentity,
  highIdentity: { ...highIdentity, particleSpacing: baselineIdentity.particleSpacing * 0.75 },
  baselineArtifact: { path: '/tmp/baseline.png', sha256: 'a'.repeat(64), width: 1600, height: 1000 },
  highArtifact: { path: '/tmp/high.png', sha256: 'b'.repeat(64), width: 1600, height: 1000 },
}), /high-resolution spacing is not exactly half baseline/);

assert.match(coreSource, /waterfallOracleScene = params\.particleShift\.z > 1\.5/);
assert.match(coreSource, /params\.particleShift\.w/);
assert.match(coreSource, /safeKernelRadius/);
assert.match(coreSource, /safeVisibleParticleRadius/);
assert.match(coreSource, /KAMINOS_FINGER_FLUID_COMPUTE_MAX_SPEED_TOKEN/);
assert.match(coreSource, /COMPUTE_SHADER\.replaceAll\(\s*KAMINOS_FINGER_FLUID_COMPUTE_MAX_SPEED_TOKEN/);
assert.match(witnessSource, /captured_pending_operator_disposition/);
assert.match(witnessSource, /requestedPreset/);
assert.match(witnessSource, /effectivePreset/);
assert.match(witnessSource, /visualContinuityAccepted:\s*null/);
assert.match(witnessSource, /Page\.captureScreenshot/);
assert.match(witnessSource, /kaminosFingerFluidBenchSetSimulationPausedForWitness/);
assert.match(witnessSource, /lastTrustworthyEvidence/);
assert.match(witnessSource, /effectiveRouteIdentity/);
assert.match(witnessSource, /finger_fluid_density_iterations/);
assert.match(witnessSource, /runtime\.densityIterationsPerStep !== densityIterations/);
assert.doesNotMatch(witnessSource, /url\.searchParams\.set\('finger_fluid_oracle_pressure_iterations'/);
assert.doesNotMatch(witnessSource, /finger-fluid-bench-witness\.mjs/);
assert.match(indexSource, /requestedWitnessTargetStep/);
assert.match(indexSource, /effectiveWitnessTargetStep/);
assert.match(indexSource, /finger_fluid_witness_target_step/);
assert.match(indexSource, /finger_fluid_max_speed/);
assert.match(indexSource, /submittedState\.stepCount >= fingerFluidBenchConfig\.effectiveWitnessTargetStep/);
assert.match(indexSource, /witnessTargetAutoPaused/);

console.log('finger fluid waterfall resolution oracle contracts passed');
