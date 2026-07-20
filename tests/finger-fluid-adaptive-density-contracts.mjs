import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT,
  createFingerFluidWaterfallSoakEvidenceIdentity,
  evaluateFingerFluidAdaptivePairTransition,
  summarizeFingerFluidAdaptiveDensityLedger,
} from '../finger-fluid-webgpu-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreSource = fs.readFileSync(path.join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const witnessSource = fs.readFileSync(path.join(root, 'finger-fluid-bench-witness.mjs'), 'utf8');

assert.equal(
  KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT,
  'deterministic-binary-volume-weighted-sheet-refinement-v0',
);

const parent = {
  active: true,
  volumeScale: 1,
  position: [1.2, -0.4, 0.7],
  velocity: [0.6, -1.1, 0.2],
  chemistry: 0.35,
};
const split = evaluateFingerFluidAdaptivePairTransition({
  action: 'split',
  parent,
  child: { active: false, volumeScale: 0, position: [0, 0, 0], velocity: [0, 0, 0], chemistry: 0 },
  splitDirection: [0, 0, 1],
  splitDistance: 0.04,
});
assert.equal(split.parent.volumeScale, 0.5);
assert.equal(split.child.volumeScale, 0.5);
assert.deepEqual(split.parent.velocity, parent.velocity);
assert.deepEqual(split.child.velocity, parent.velocity);
assert.deepEqual(split.conservation.before, split.conservation.after);
assert.deepEqual(split.centerOfMassBefore, split.centerOfMassAfter);

const merged = evaluateFingerFluidAdaptivePairTransition({
  action: 'merge',
  parent: { ...split.parent, velocity: [0.8, -1, 0.1], chemistry: 0.2 },
  child: { ...split.child, velocity: [0.2, -1.2, 0.3], chemistry: 0.5 },
});
assert.equal(merged.parent.volumeScale, 1);
assert.equal(merged.child.volumeScale, 0);
assert.equal(merged.child.active, false);
assert.deepEqual(merged.parent.velocity, [0.5, -1.1, 0.2]);
assert.equal(merged.parent.chemistry, 0.35);
assert.deepEqual(merged.conservation.before, merged.conservation.after);

const ledger = summarizeFingerFluidAdaptiveDensityLedger([
  { active: true, volumeScale: 1, role: 'base', velocity: [1, 0, 0], chemistry: 0.2 },
  { active: true, volumeScale: 0.5, role: 'parent', velocity: [0, 2, 0], chemistry: 0.4 },
  { active: true, volumeScale: 0.5, role: 'child', velocity: [0, 2, 0], chemistry: 0.4 },
  { active: false, volumeScale: 0, role: 'child', velocity: [0, 0, 0], chemistry: 0 },
]);
assert.deepEqual(ledger, {
  activeParticleCount: 3,
  baseParticleCount: 1,
  refinedParentCount: 1,
  activeChildCount: 1,
  reservedChildCount: 1,
  representedVolume: 2,
  momentum: [1, 2, 0],
  chemistryMass: 0.6,
});

const adaptiveEvidenceIdentity = createFingerFluidWaterfallSoakEvidenceIdentity({
  requestedParticleCount: 24_576,
  effectiveParticleCount: 49_152,
  particleCount: 49_152,
  baseParticleCount: 24_576,
  simulationCapacity: 49_152,
  requestedAdaptiveDensity: true,
  effectiveAdaptiveDensity: true,
  requestedTruthScene: 'waterfall_resolution_oracle',
  effectiveTruthScene: 'waterfall_resolution_oracle',
  requestedColorMode: 'sheet_release',
  effectiveColorMode: 'sheet_release',
  requestedRendererMode: 'sphere_debug',
  effectiveRendererMode: 'sphere_debug',
  requestedRenderer: 'webgpu-particle-sphere-debug-renderer-v0',
  effectiveRenderer: 'webgpu-particle-sphere-debug-renderer-v0',
  solver_backend: 'webgpu_compute',
  render_backend: 'webgpu_direct_render',
  adapterInfo: { vendor: 'apple', architecture: 'metal-3' },
  requestedOpticalDebugMode: 'shaded',
  effectiveOpticalDebugMode: 'shaded',
  timeIntegrationContract: 'fixed-step-60hz-one-simulation-step-per-render-frame-v0',
  fixedTimeStepSeconds: 1 / 60,
  solverRoute: 'webgpu-pbf-linked-cell-fluid-v0',
  shaderRoute: 'wgsl-pbf-linked-cell-fluid-v0',
  waterfallContinuityContract: 'wgsl-support-aware-symmetric-capillary-sheet-v0',
  requestedSupportFriction: 1.6,
  effectiveSupportFriction: 1.6,
  requestedParticleShiftStrength: 0,
  effectiveParticleShiftStrength: 0,
  requestedChemistryDiffusion: 0,
  effectiveChemistryDiffusion: 0,
  requestedCapillaryStrength: 0.72,
  effectiveCapillaryStrength: 0.72,
  requestedThinSheetVorticityAttenuation: 0.88,
  effectiveThinSheetVorticityAttenuation: 0.88,
  requestedFreeFlightViscosityBoost: 0.17,
  effectiveFreeFlightViscosityBoost: 0.17,
  densityIterationsPerStep: 3,
  substeps: 1,
});
assert.equal(adaptiveEvidenceIdentity.adaptiveDensity, true);
assert.equal(adaptiveEvidenceIdentity.baseParticleCount, 24_576);
assert.equal(adaptiveEvidenceIdentity.particleCount, 49_152);

assert.match(coreSource, /refinement:\s*vec4<f32>/, 'adaptive state remains colocated with each particle topology record');
assert.match(coreSource, /refinementControl:\s*vec4<u32>/, 'shader receives separate base-population and capacity truth');
assert.match(coreSource, /fn adaptive_refine_or_merge/, 'one ordered GPU pass owns deterministic pair transitions');
assert.match(coreSource, /let childIndex = index \+ params\.refinementControl\.x/, 'each base particle owns exactly one deterministic child slot');
assert.match(coreSource, /fn adaptive_pair_kernel_weight/, 'mixed-resolution PBF uses a volume-normalized pair kernel');
assert.match(coreSource, /neighborVolumeScale \* kernelNormalization/, 'neighbor quadrature carries represented volume without creating mass');
assert.match(coreSource, /pipelineFor\('adaptive_refine_or_merge'\)/, 'adaptive transitions execute on the GPU');
assert.match(
  coreSource,
  /neighborTopology\[childIndex\]\.sheetDiagnosticClassification\s*=\s*vec4<f32>\([^\n]*SHEET_RELEASE_REASON_CODES\.dormant/,
  'a merged child cannot retain a stale active sheet-release diagnostic after becoming dormant',
);
assert.match(coreSource, /adaptiveDensityLedger/, 'diagnostics expose active refinement and conservation accounting');
assert.match(indexSource, /finger_fluid_adaptive_density/, 'the operator route requests adaptive density explicitly');
assert.match(indexSource, /requestedAdaptiveDensity/, 'route identity preserves the requested adaptive-density state');
assert.match(indexSource, /effectiveAdaptiveDensity/, 'runtime identity preserves the effective adaptive-density state');
assert.match(witnessSource, /requestedAdaptiveDensity/, 'the witness independently resolves the requested adaptive-density route');
assert.match(witnessSource, /adaptive base-population disagreement rejected/, 'the witness rejects stale requested/base population identity');
assert.match(witnessSource, /adaptive simulation-capacity disagreement rejected/, 'the witness rejects stale allocated-capacity identity');
assert.match(witnessSource, /adaptive accounting invalid/, 'the witness rejects non-conservative adaptive readback');

console.log('finger fluid adaptive density contracts passed');
