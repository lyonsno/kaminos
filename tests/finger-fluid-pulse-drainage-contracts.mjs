import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../finger-fluid-webgpu-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreSource = fs.readFileSync(path.join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const witnessSource = fs.readFileSync(path.join(root, 'finger-fluid-waterfall-oracle-witness.mjs'), 'utf8');

assert.equal(
  core.KAMINOS_FINGER_FLUID_PULSE_DRAINAGE_CONTRACT,
  'fixed-step-source-cutoff-drainage-v0',
);
assert.equal(core.resolveFingerFluidInletCutoffStep(null), null);
assert.equal(core.resolveFingerFluidInletCutoffStep(480), 480);
assert.throws(() => core.resolveFingerFluidInletCutoffStep(0), /cutoff step/i);
assert.throws(() => core.resolveFingerFluidInletCutoffStep(1.5), /cutoff step/i);

assert.deepEqual(core.createFingerFluidPulseControlReadout({
  stepCount: 400,
  inletCutoffStep: 480,
  witnessTargetStep: 960,
  paused: false,
}), {
  stepLabel: 'STEP 400 / 960',
  sourceLabel: 'SOURCE OPEN · CUT @ 480',
  runLabel: 'RUNNING',
  text: 'STEP 400 / 960\nSOURCE OPEN · CUT @ 480\nRUNNING',
});
assert.deepEqual(core.createFingerFluidPulseControlReadout({
  stepCount: 591,
  inletCutoffStep: 480,
  witnessTargetStep: 960,
  paused: false,
}), {
  stepLabel: 'STEP 591 / 960',
  sourceLabel: 'SOURCE CUT @ 480 · DRAINING ACTIVE RESERVOIR',
  runLabel: 'RUNNING',
  text: 'STEP 591 / 960\nSOURCE CUT @ 480 · DRAINING ACTIVE RESERVOIR\nRUNNING',
});
assert.deepEqual(core.createFingerFluidPulseControlReadout({
  stepCount: 960,
  inletCutoffStep: 480,
  witnessTargetStep: 960,
  paused: true,
}), {
  stepLabel: 'STEP 960 / 960',
  sourceLabel: 'SOURCE CUT @ 480 · DRAINING ACTIVE RESERVOIR',
  runLabel: 'PAUSED',
  text: 'STEP 960 / 960\nSOURCE CUT @ 480 · DRAINING ACTIVE RESERVOIR\nPAUSED',
});

const captureSteps = [480, 510, 540, 600, 720, 960];
const highConfig = core.createFingerFluidWaterfallOracleConfig('high');
const slices = captureSteps.map((capturedStep, index) => ({
  identity: {
    schema: core.KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA,
    contract: core.KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
    truthScene: 'waterfall_resolution_oracle',
    requestedPreset: 'high',
    effectivePreset: 'high',
    sourceId: 'slot-spout',
    refinementFactor: highConfig.refinementFactor,
    particleSpacing: highConfig.particleSpacing,
    particleVolume: highConfig.particleVolume,
    kernelRadius: highConfig.kernelRadius,
    visibleParticleRadius: highConfig.visibleParticleRadius,
    particleCount: highConfig.defaultParticleCount,
    laneColumns: highConfig.laneColumns,
    laneRows: highConfig.laneRows,
    laneCount: highConfig.laneCount,
    releaseScheduleContract: highConfig.releaseScheduleContract,
    physicalSourceFlux: highConfig.physicalSourceFlux,
    expectedParticleReleaseRate: highConfig.expectedParticleReleaseRate,
    rendererMode: 'sphere_debug',
    colorMode: 'phase',
    opticalDebugMode: 'shaded',
    fixedTimeStepSeconds: 1 / 60,
    capturedStep,
    densityIterations: 3,
    capillaryStrength: 0.72,
    supportFriction: 1.6,
    freeFlightViscosityBoost: 0.17,
    thinSheetVorticityAttenuation: 0.88,
    unsupportedSheetStrength: 2,
    inletCutoffStep: 480,
    camera: { yaw: -0.46, pitch: 0.3, distance: 3.05, target: [0, -0.35, -0.92] },
  },
  artifact: {
    path: `/tmp/pulse-${capturedStep}.png`,
    sha256: String(index + 1).repeat(64),
    width: 1800,
    height: 1120,
  },
  diagnostics: {
    stepCount: capturedStep,
    inletCutoffStep: 480,
    inletCutoffReached: true,
    sourceRecirculationCount: 1200,
    activeParticleCount: 90000 - index * 5000,
    dormantParticleCount: 8304 + index * 5000,
  },
}));

const series = core.evaluateFingerFluidPulseDrainageSeries({
  slices,
  expectedCaptureSteps: captureSteps,
});
assert.equal(series.mechanicalChecksOk, true);
assert.equal(series.status, 'captured_pending_operator_disposition');
assert.equal(series.sourceActivationCountStableAfterCutoff, true);
assert.equal(series.visualDrainageAccepted, null);

const productionConfig = core.createFingerFluidWaterfallOracleConfig('production');
const productionSlices = structuredClone(slices).map((slice, index) => ({
  ...slice,
  identity: {
    ...slice.identity,
    requestedPreset: 'production',
    effectivePreset: 'production',
    refinementFactor: productionConfig.refinementFactor,
    particleSpacing: productionConfig.particleSpacing,
    particleVolume: productionConfig.particleVolume,
    kernelRadius: productionConfig.kernelRadius,
    visibleParticleRadius: productionConfig.visibleParticleRadius,
    particleCount: productionConfig.defaultParticleCount,
    laneColumns: productionConfig.laneColumns,
    laneRows: productionConfig.laneRows,
    laneCount: productionConfig.laneCount,
    releaseScheduleContract: productionConfig.releaseScheduleContract,
    physicalSourceFlux: productionConfig.physicalSourceFlux,
    expectedParticleReleaseRate: productionConfig.expectedParticleReleaseRate,
  },
  diagnostics: {
    ...slice.diagnostics,
    activeParticleCount: 22_000 - index * 1_000,
    dormantParticleCount: productionConfig.defaultParticleCount - (22_000 - index * 1_000),
  },
}));
const productionSeries = core.evaluateFingerFluidPulseDrainageSeries({
  slices: productionSlices,
  expectedCaptureSteps: captureSteps,
  expectedPreset: 'production',
});
assert.equal(productionSeries.mechanicalChecksOk, true);
assert.equal(productionSeries.effectivePreset, 'production');
assert.equal(productionSeries.particleCount, 24_576);

const leakingSlices = structuredClone(slices);
leakingSlices[2].diagnostics.sourceRecirculationCount += 1;
assert.throws(() => core.evaluateFingerFluidPulseDrainageSeries({
  slices: leakingSlices,
  expectedCaptureSteps: captureSteps,
}), /source activation continued after cutoff/i);

const neverActivatedSlices = structuredClone(slices);
for (const slice of neverActivatedSlices) slice.diagnostics.sourceRecirculationCount = 0;
assert.throws(() => core.evaluateFingerFluidPulseDrainageSeries({
  slices: neverActivatedSlices,
  expectedCaptureSteps: captureSteps,
}), /source never activated before cutoff/i);

const staticSlices = structuredClone(slices);
for (const slice of staticSlices) {
  slice.diagnostics.activeParticleCount = 90000;
  slice.diagnostics.dormantParticleCount = 8304;
}
assert.throws(() => core.evaluateFingerFluidPulseDrainageSeries({
  slices: staticSlices,
  expectedCaptureSteps: captureSteps,
}), /no particle drainage observed after cutoff/i);

assert.match(coreSource, /sourceControl: vec4<u32>/);
assert.match(coreSource, /params\.frameIndex >= params\.sourceControl\.x/);
assert.match(coreSource, /inletCutoffStep/);
assert.match(indexSource, /finger_fluid_inlet_cutoff_step/);
assert.match(witnessSource, /pulse_drainage/);
assert.match(witnessSource, /--capture-steps/);
assert.match(witnessSource, /--pulse-preset/);
assert.match(witnessSource, /sourceRecirculationCountStableAfterCutoff/);
assert.match(witnessSource, /unsupportedSheetStrength !== 2/);
assert.match(witnessSource, /kaminos\.finger-fluid\.pulse-drainage-witness\.v0/);
assert.match(indexSource, /pulseControlReadout/);
assert.match(indexSource, /finger-fluid-bench-pulse-control/);

console.log('finger fluid pulse drainage contracts passed');
