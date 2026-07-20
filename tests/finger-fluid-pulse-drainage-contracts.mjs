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

const captureSteps = [480, 510, 540, 600, 720, 960];
const slices = captureSteps.map((capturedStep, index) => ({
  identity: {
    schema: core.KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA,
    contract: core.KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
    truthScene: 'waterfall_resolution_oracle',
    requestedPreset: 'high',
    effectivePreset: 'high',
    sourceId: 'slot-spout',
    refinementFactor: 2,
    particleSpacing: 0.5,
    particleVolume: 0.125,
    kernelRadius: 0.0925,
    visibleParticleRadius: 0.023,
    particleCount: 98304,
    laneColumns: 48,
    laneRows: 32,
    laneCount: 1536,
    physicalSourceFlux: 1,
    expectedParticleReleaseRate: 8,
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

const leakingSlices = structuredClone(slices);
leakingSlices[2].diagnostics.sourceRecirculationCount += 1;
assert.throws(() => core.evaluateFingerFluidPulseDrainageSeries({
  slices: leakingSlices,
  expectedCaptureSteps: captureSteps,
}), /source activation continued after cutoff/i);

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
assert.match(witnessSource, /sourceRecirculationCountStableAfterCutoff/);
assert.match(witnessSource, /unsupportedSheetStrength !== 2/);
assert.match(witnessSource, /kaminos\.finger-fluid\.pulse-drainage-witness\.v0/);

console.log('finger fluid pulse drainage contracts passed');
