import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../finger-fluid-webgpu-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreSource = fs.readFileSync(path.join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
const cockpitSource = fs.readFileSync(path.join(root, 'finger-fluid-oracle-cockpit.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const witnessSource = fs.readFileSync(path.join(root, 'finger-fluid-waterfall-oracle-witness.mjs'), 'utf8');

assert.equal(
  core.KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
  'wgsl-anisotropic-unsupported-sheet-support-v0',
  'solver must name the explicit unsupported-sheet mechanism',
);
assert.equal(typeof core.resolveFingerFluidUnsupportedSheetStrength, 'function');
assert.equal(typeof core.evaluateFingerFluidUnsupportedSheetNeighborhood, 'function');
assert.equal(typeof core.evaluateFingerFluidUnsupportedSheetPair, 'function');
assert.equal(typeof core.evaluateFingerFluidUnsupportedSheetOraclePair, 'function');
assert.equal(typeof core.resolveFingerFluidWaterfallWitnessPresetArgument, 'function');
assert.equal(core.resolveFingerFluidWaterfallWitnessPresetArgument({
  argumentPresent: false,
  value: undefined,
  fallback: 'high',
  argumentName: '--unsupported-sheet-preset',
}), 'high');
assert.throws(() => core.resolveFingerFluidWaterfallWitnessPresetArgument({
  argumentPresent: true,
  value: undefined,
  fallback: 'high',
  argumentName: '--unsupported-sheet-preset',
}), /--unsupported-sheet-preset requires a value/);
assert.throws(() => core.resolveFingerFluidWaterfallWitnessPresetArgument({
  argumentPresent: true,
  value: '--unsupported-sheet-strength',
  fallback: 'high',
  argumentName: '--unsupported-sheet-preset',
}), /--unsupported-sheet-preset requires a value/);
assert.equal(core.resolveFingerFluidUnsupportedSheetStrength(0), 0);
assert.equal(core.resolveFingerFluidUnsupportedSheetStrength(1), 1);
assert.throws(() => core.resolveFingerFluidUnsupportedSheetStrength(-0.01), /unsupported-sheet strength/i);
assert.throws(() => core.resolveFingerFluidUnsupportedSheetStrength(2.01), /unsupported-sheet strength/i);

const coherentNeighbors = [
  { offset: [-0.070, 0.000, 0.002], velocity: [0.00, -1.02, 0.00] },
  { offset: [0.070, 0.000, -0.002], velocity: [0.00, -0.98, 0.00] },
  { offset: [-0.045, 0.055, 0.001], velocity: [0.01, -1.01, 0.00] },
  { offset: [0.045, -0.055, -0.001], velocity: [-0.01, -0.99, 0.00] },
  { offset: [0.000, 0.075, 0.003], velocity: [0.00, -1.00, 0.01] },
  { offset: [0.000, -0.075, -0.003], velocity: [0.00, -1.00, -0.01] },
];
const common = {
  velocity: [0, -1, 0],
  densityRatio: 0.52,
  surfaceFactor: 0.82,
  supportContact: 0.01,
  neighborRetention: 0.9,
  neighborRetentionAge: 0.45,
  kernelRadius: 0.0925,
  strength: 1,
};
const coherent = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  neighbors: coherentNeighbors,
});
assert.ok(coherent.activity > 0.35, JSON.stringify(coherent));
assert.ok(coherent.transverseAnisotropy > 0.72, JSON.stringify(coherent));
assert.ok(coherent.velocityCoherence > 0.95, JSON.stringify(coherent));
assert.equal(coherent.releaseReason, null, JSON.stringify(coherent));

const supported = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  supportContact: 0.82,
  neighbors: coherentNeighbors,
});
assert.equal(supported.activity, 0, JSON.stringify(supported));
assert.equal(supported.releaseReason, 'support_contact', JSON.stringify(supported));

const underSupported = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  neighbors: coherentNeighbors.slice(0, 2),
});
assert.equal(underSupported.activity, 0, JSON.stringify(underSupported));
assert.equal(underSupported.releaseReason, 'neighbor_loss', JSON.stringify(underSupported));

const sparsePlanar = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  densityRatio: 0.2,
  surfaceFactor: 0.72,
  neighborRetention: 0.34,
  neighborRetentionAge: 0.06,
  neighbors: coherentNeighbors.slice(0, 3),
});
assert.ok(sparsePlanar.activity > 0, JSON.stringify(sparsePlanar));
assert.equal(sparsePlanar.releaseReason, null, JSON.stringify(sparsePlanar));

const isotropic = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  neighbors: [
    { offset: [0.06, 0, 0], velocity: [0, -1, 0] },
    { offset: [-0.06, 0, 0], velocity: [0, -1, 0] },
    { offset: [0, 0, 0.06], velocity: [0, -1, 0] },
    { offset: [0, 0, -0.06], velocity: [0, -1, 0] },
    { offset: [0.04, 0.04, 0.04], velocity: [0, -1, 0] },
    { offset: [-0.04, -0.04, -0.04], velocity: [0, -1, 0] },
  ],
});
assert.equal(isotropic.activity, 0, JSON.stringify(isotropic));
assert.equal(isotropic.releaseReason, 'not_planar', JSON.stringify(isotropic));

const incoherent = core.evaluateFingerFluidUnsupportedSheetNeighborhood({
  ...common,
  neighbors: coherentNeighbors.map((neighbor, index) => ({
    ...neighbor,
    velocity: index % 2 ? [1, 0, 0] : [-1, 0, 0],
  })),
});
assert.equal(incoherent.activity, 0, JSON.stringify(incoherent));
assert.equal(incoherent.releaseReason, 'velocity_incoherent', JSON.stringify(incoherent));

const bridgePair = core.evaluateFingerFluidUnsupportedSheetPair({
  distance: common.kernelRadius * 1.4,
  kernelRadius: common.kernelRadius,
  normalAlignment: 0.96,
  particleActivity: 0.8,
  neighborActivity: 0.75,
});
assert.ok(bridgePair.gapClosureWeight > 0.1, JSON.stringify(bridgePair));
assert.equal(bridgePair.releaseReason, null, JSON.stringify(bridgePair));
const remotePair = core.evaluateFingerFluidUnsupportedSheetPair({
  distance: common.kernelRadius * 1.8,
  kernelRadius: common.kernelRadius,
  normalAlignment: 0.96,
  particleActivity: 0.8,
  neighborActivity: 0.75,
});
assert.equal(remotePair.gapClosureWeight, 0, JSON.stringify(remotePair));
assert.equal(remotePair.releaseReason, 'outside_bridge_radius', JSON.stringify(remotePair));

const identityConfig = core.createFingerFluidWaterfallOracleConfig('high');
const identityCommon = {
  truthScene: 'waterfall_resolution_oracle',
  requestedPreset: 'high',
  effectivePreset: 'high',
  ...identityConfig,
  particleCount: identityConfig.defaultParticleCount,
  rendererMode: 'sphere_debug',
  colorMode: 'phase',
  opticalDebugMode: 'shaded',
  fixedTimeStepSeconds: 1 / 60,
  capturedStep: 480,
  densityIterations: 3,
  capillaryStrength: 0.72,
  supportFriction: 1.6,
  freeFlightViscosityBoost: 0.17,
  thinSheetVorticityAttenuation: 0.88,
  camera: identityConfig.camera,
};
const controlIdentity = core.createFingerFluidWaterfallOracleEvidenceIdentity({
  ...identityCommon,
  unsupportedSheetStrength: 0,
});
const treatmentIdentity = core.createFingerFluidWaterfallOracleEvidenceIdentity({
  ...identityCommon,
  unsupportedSheetStrength: 1,
});
const treatmentPair = core.evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity,
  treatmentIdentity,
  controlArtifact: { path: '/tmp/control.png', sha256: 'c'.repeat(64), width: 1800, height: 1120 },
  treatmentArtifact: { path: '/tmp/treatment.png', sha256: 'd'.repeat(64), width: 1800, height: 1120 },
});
assert.equal(treatmentPair.mechanicalChecksOk, true);
assert.equal(treatmentPair.status, 'captured_pending_operator_disposition');
assert.equal(treatmentPair.visualContinuityAccepted, null);
const productionConfig = core.createFingerFluidWaterfallOracleConfig('production');
const productionCommon = {
  ...identityCommon,
  ...productionConfig,
  requestedPreset: 'production',
  effectivePreset: 'production',
  particleCount: productionConfig.defaultParticleCount,
  camera: productionConfig.camera,
};
const productionControlIdentity = core.createFingerFluidWaterfallOracleEvidenceIdentity({
  ...productionCommon,
  unsupportedSheetStrength: 0,
});
const productionTreatmentIdentity = core.createFingerFluidWaterfallOracleEvidenceIdentity({
  ...productionCommon,
  unsupportedSheetStrength: 2,
});
const productionPair = core.evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity: productionControlIdentity,
  treatmentIdentity: productionTreatmentIdentity,
  controlArtifact: { path: '/tmp/production-control.png', sha256: 'e'.repeat(64), width: 1800, height: 1120 },
  treatmentArtifact: { path: '/tmp/production-treatment.png', sha256: 'f'.repeat(64), width: 1800, height: 1120 },
});
assert.equal(productionPair.mechanicalChecksOk, true);
assert.equal(productionPair.controlIdentity.effectivePreset, 'production');
assert.throws(() => core.evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity: { ...productionControlIdentity, particleCount: 98_304 },
  treatmentIdentity: { ...productionTreatmentIdentity, particleCount: 98_304 },
  controlArtifact: { path: '/tmp/forged-production-control.png', sha256: '1'.repeat(64), width: 1800, height: 1120 },
  treatmentArtifact: { path: '/tmp/forged-production-treatment.png', sha256: '2'.repeat(64), width: 1800, height: 1120 },
}), /unsupported-sheet oracle canonical production identity mismatch at particleCount/);
assert.throws(() => core.evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity,
  treatmentIdentity: { ...treatmentIdentity, capturedStep: 481 },
  controlArtifact: { path: '/tmp/control.png', sha256: 'c'.repeat(64), width: 1800, height: 1120 },
  treatmentArtifact: { path: '/tmp/treatment.png', sha256: 'd'.repeat(64), width: 1800, height: 1120 },
}), /common identity mismatch at capturedStep/);
assert.throws(() => core.evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity,
  treatmentIdentity: { ...treatmentIdentity, maxFluidSpeed: 8 },
  controlArtifact: { path: '/tmp/control.png', sha256: 'c'.repeat(64), width: 1800, height: 1120 },
  treatmentArtifact: { path: '/tmp/treatment.png', sha256: 'd'.repeat(64), width: 1800, height: 1120 },
}), /common identity mismatch at maxFluidSpeed/);

assert.match(coreSource, /fn apply_unsupported_sheet_support/);
assert.match(coreSource, /fn commit_unsupported_sheet_support/);
assert.match(coreSource, /sheetNeighborIds: vec4<u32>/);
assert.match(coreSource, /sheetRestDistances: vec4<f32>/);
assert.match(coreSource, /params\.sheet/);
assert.match(coreSource, /sheetSupportPassCount/);
assert.match(coreSource, /unsupportedSheetActiveParticleCount/);
assert.match(cockpitSource, /finger_fluid_oracle_sheet_support/);
assert.match(cockpitSource, /unsupportedSheetStrength/);
assert.match(indexSource, /id="finger-fluid-oracle-sheet-support"/);
assert.match(indexSource, /finger_fluid_unsupported_sheet_strength/);
assert.match(witnessSource, /--unsupported-sheet-strength/);
assert.match(witnessSource, /--unsupported-sheet-preset/);
assert.match(witnessSource, /runPreset\(unsupportedSheetPreset, debugPort/);
assert.match(witnessSource, /runPreset\(unsupportedSheetPreset, debugPort \+ 1/);
assert.match(witnessSource, /runtime\.unsupportedSheetStrength !== unsupportedSheetStrength/);
assert.match(witnessSource, /kaminosFingerFluidBenchRequestDiagnostics/);
assert.match(witnessSource, /unsupportedSheetActiveParticleCount/);
assert.match(witnessSource, /comparisonAxis/);

console.log('finger fluid unsupported sheet contracts passed');
