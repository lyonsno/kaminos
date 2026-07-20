import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
  KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS,
  createFingerFluidTruthSceneParticles,
  createFingerFluidWaterfallOracleConfig,
  createFingerFluidWaterfallOracleEvidenceIdentity,
  evaluateFingerFluidWaterfallOraclePair,
  resolveFingerFluidWaterfallOraclePreset,
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
assert.deepEqual(KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS, ['baseline', 'high']);
assert.equal(resolveFingerFluidWaterfallOraclePreset('baseline'), 'baseline');
assert.equal(resolveFingerFluidWaterfallOraclePreset('high'), 'high');
assert.throws(() => resolveFingerFluidWaterfallOraclePreset('ultra'), /Unsupported finger fluid waterfall oracle preset/);

const baseline = createFingerFluidWaterfallOracleConfig('baseline');
const high = createFingerFluidWaterfallOracleConfig('high');
assert.equal(baseline.contract, KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT);
assert.equal(baseline.sourceId, 'slot-spout');
assert.equal(baseline.refinementFactor, 1);
assert.equal(high.refinementFactor, 2);
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

const baselineParticles = createFingerFluidTruthSceneParticles(
  baseline.defaultParticleCount,
  'waterfall_resolution_oracle',
  { waterfallOraclePreset: 'baseline' },
);
const highParticles = createFingerFluidTruthSceneParticles(
  high.defaultParticleCount,
  'waterfall_resolution_oracle',
  { waterfallOraclePreset: 'high' },
);
assert.equal(baselineParticles.length, baseline.defaultParticleCount * 16);
assert.equal(highParticles.length, high.defaultParticleCount * 16);
for (let index = 0; index < baseline.defaultParticleCount; index += 1) {
  assert.ok(Math.abs(Math.abs(baselineParticles[index * 16 + 11]) - 0.48) < 1e-6, 'the isolated oracle contains only the slot source');
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
assert.match(indexSource, /submittedState\.stepCount >= fingerFluidBenchConfig\.effectiveWitnessTargetStep/);
assert.match(indexSource, /witnessTargetAutoPaused/);

console.log('finger fluid waterfall resolution oracle contracts passed');
