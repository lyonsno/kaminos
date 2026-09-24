import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as core from '../finger-fluid-webgpu-core.js';

const root = new URL('..', import.meta.url).pathname;
const coreSource = readFileSync(join(root, 'finger-fluid-webgpu-core.js'), 'utf8');
const witnessSource = readFileSync(join(root, 'finger-fluid-waterfall-oracle-witness.mjs'), 'utf8');

assert.equal(
  core.KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTIC_CONTRACT,
  'wgsl-per-particle-sheet-release-diagnostic-channels-v0',
);
assert.equal(
  core.KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTICS_SCHEMA,
  'kaminos.finger-fluid.sheet-release-diagnostics.v0',
);
assert.deepEqual(core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES, {
  active: 0,
  disabled: 1,
  dormant: 2,
  low_transport_speed: 3,
  support_contact: 4,
  density_loss: 5,
  bulk_density: 6,
  not_interface: 7,
  topology_loss: 8,
  neighbor_loss: 9,
  velocity_incoherent: 10,
  not_planar: 11,
  inlet_core: 12,
  activity_floor: 13,
});
assert.equal(core.resolveFingerFluidColorMode('sheet_release'), 'sheet_release');

const particleCount = 3;
const particles = new Float32Array(particleCount * 16);
const topology = new Float32Array(particleCount * core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS);
const setParticleActive = (index, active) => {
  particles[index * 16 + 11] = active ? 0.5 : -0.5;
};
const setParticlePosition = (index, position) => {
  particles.set(position, index * 16);
};
const setDiagnostic = (index, {
  reason,
  priorActivity = 0,
  activity = 0,
  inletCoreWeight = 0,
  speed = 0,
  supportContact = 0,
  densityRatio = 0,
  surfaceFactor = 0,
  neighborCount = 0,
  velocityCoherence = 0,
  transverseAnisotropy = 0,
  maximumLinkStretch = 0,
  retention = 0,
  retentionAge = 0,
  persistentLinkCount = 0,
  maximumLinkKernelRatio = 0,
}) => {
  const topologyOffset = index * core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS;
  const offset = topologyOffset + 20;
  topology[topologyOffset + 4] = retention;
  topology[topologyOffset + 5] = retentionAge;
  topology[topologyOffset + 11] = activity;
  topology.set([reason, priorActivity, inletCoreWeight, maximumLinkKernelRatio], offset);
  topology.set([speed, supportContact, densityRatio, surfaceFactor], offset + 4);
  topology.set([neighborCount, velocityCoherence, transverseAnisotropy, maximumLinkStretch], offset + 8);
};

setParticleActive(0, true);
setParticlePosition(0, [1, 2, 3]);
setDiagnostic(0, {
  reason: core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.active,
  priorActivity: 0.7,
  activity: 0.82,
  densityRatio: 0.54,
  surfaceFactor: 0.88,
  neighborCount: 6,
  velocityCoherence: 0.96,
  transverseAnisotropy: 0.91,
  maximumLinkStretch: 1.12,
  retention: 0.86,
  retentionAge: 0.44,
  persistentLinkCount: 4,
  maximumLinkKernelRatio: 1.31,
});
setParticleActive(1, true);
setParticlePosition(1, [-1, 0.5, 4]);
setDiagnostic(1, {
  reason: core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.neighbor_loss,
  priorActivity: 0.74,
  densityRatio: 0.31,
  surfaceFactor: 0.83,
  neighborCount: 2,
  velocityCoherence: 0.94,
  transverseAnisotropy: 0.89,
  maximumLinkStretch: 1.78,
  retention: 0.52,
  retentionAge: 0.21,
  persistentLinkCount: 3,
  maximumLinkKernelRatio: 1.69,
});
setParticleActive(2, false);
setDiagnostic(2, { reason: core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant });

const summary = core.summarizeFingerFluidSheetReleaseDiagnostics(topology, particles, particleCount);
assert.equal(summary.schema, core.KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTICS_SCHEMA);
assert.equal(summary.contract, core.KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTIC_CONTRACT);
assert.equal(summary.accountedParticleCount, particleCount);
assert.equal(summary.activeParticleCount, 2);
assert.equal(summary.dormantParticleCount, 1);
assert.equal(summary.diagnosedActiveParticleCount, 2);
assert.equal(summary.activeSheetParticleCount, 1);
assert.equal(summary.releasedSheetParticleCount, 1);
assert.equal(summary.reasonCounts.active, 1);
assert.equal(summary.reasonCounts.neighbor_loss, 1);
assert.equal(summary.reasonCounts.dormant, 0, 'dormant reserve cannot masquerade as a release population');
assert.equal(summary.maximumLinkStretch, 1.78);
assert.equal(summary.maximumLinkKernelRatio, 1.69);
const neighborLossRow = summary.reasonRows.find(row => row.reason === 'neighbor_loss');
assert.equal(neighborLossRow.particleCount, 1);
assert.deepEqual(neighborLossRow.positionBounds, { min: [-1, 0.5, 4], max: [-1, 0.5, 4], centroid: [-1, 0.5, 4] });
assert.equal(neighborLossRow.measurements.averagePriorActivity, 0.74);
assert.equal(neighborLossRow.measurements.averageDensityRatio, 0.31);
assert.equal(neighborLossRow.measurements.averageNeighborCount, 2);
assert.equal(neighborLossRow.measurements.maximumLinkStretch, 1.78);
assert.equal(neighborLossRow.measurements.maximumLinkKernelRatio, 1.69);
assert.equal(summary.reasonRows.find(row => row.reason === 'disabled').positionBounds, null);

const disabledReserveTopology = topology.slice();
disabledReserveTopology[2 * core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS + 20]
  = core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.disabled;
const disabledReserveSummary = core.summarizeFingerFluidSheetReleaseDiagnostics(
  disabledReserveTopology,
  particles,
  particleCount,
);
assert.equal(disabledReserveSummary.dormantParticleCount, 1, 'a disabled adaptive reserve slot remains dormant');
assert.equal(disabledReserveSummary.reasonCounts.disabled, 0, 'a disabled adaptive reserve slot cannot masquerade as an active release population');
assert.equal(disabledReserveSummary.accountedParticleCount, particleCount);

assert.throws(
  () => core.summarizeFingerFluidSheetReleaseDiagnostics(topology.subarray(0, -1), particles, particleCount),
  /partial topology diagnostics/i,
);
assert.throws(
  () => core.summarizeFingerFluidSheetReleaseDiagnostics(topology, particles.subarray(0, -1), particleCount),
  /partial particle diagnostics/i,
);
const malformed = topology.slice();
malformed[20] = 99;
assert.throws(
  () => core.summarizeFingerFluidSheetReleaseDiagnostics(malformed, particles, particleCount),
  /unknown sheet release reason code/i,
);

const assertRejectsNonFiniteReadback = (label, mutate) => {
  const candidateTopology = topology.slice();
  const candidateParticles = particles.slice();
  mutate(candidateTopology, candidateParticles);
  assert.throws(
    () => core.summarizeFingerFluidSheetReleaseDiagnostics(candidateTopology, candidateParticles, particleCount),
    /non-finite sheet diagnostic readback/i,
    label,
  );
};
assertRejectsNonFiniteReadback('particle position cannot serialize NaN as a null bound', (_candidateTopology, candidateParticles) => {
  candidateParticles[0] = Number.NaN;
});
assertRejectsNonFiniteReadback('active discriminator must be finite even when its reason says dormant', (candidateTopology, candidateParticles) => {
  candidateParticles[2 * 16 + 11] = Number.NaN;
  candidateTopology[2 * core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS + 20]
    = core.KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant;
});
assertRejectsNonFiniteReadback('sheet activity cannot serialize NaN as a null mean', (candidateTopology) => {
  candidateTopology[11] = Number.NaN;
});
assertRejectsNonFiniteReadback('topology retention cannot serialize Infinity', (candidateTopology) => {
  candidateTopology[4] = Number.POSITIVE_INFINITY;
});
assertRejectsNonFiniteReadback('topology retention age cannot serialize NaN', (candidateTopology) => {
  candidateTopology[5] = Number.NaN;
});

const validRenderRoute = {
  requestedRendererMode: 'sphere_debug',
  effectiveRendererMode: 'sphere_debug',
  requestedColorMode: 'sheet_release',
  effectiveColorMode: 'sheet_release',
  requestedOpticalDebugMode: 'shaded',
  effectiveOpticalDebugMode: 'shaded',
};
assert.deepEqual(
  core.validateFingerFluidWaterfallWitnessRenderIdentity(validRenderRoute, {
    rendererMode: 'sphere_debug',
    colorMode: 'sheet_release',
    opticalDebugMode: 'shaded',
  }),
  validRenderRoute,
);
for (const [field, wrongValue] of [
  ['requestedColorMode', 'phase'],
  ['effectiveColorMode', 'phase'],
  ['requestedOpticalDebugMode', 'normal'],
  ['effectiveOpticalDebugMode', 'normal'],
]) {
  assert.throws(
    () => core.validateFingerFluidWaterfallWitnessRenderIdentity(
      { ...validRenderRoute, [field]: wrongValue },
      { rendererMode: 'sphere_debug', colorMode: 'sheet_release', opticalDebugMode: 'shaded' },
    ),
    /requested\/effective waterfall witness render identity mismatch/i,
    `${field} mismatch must fail loud`,
  );
}
assert.equal(core.validateFingerFluidFiniteDiagnosticPayload(summary), summary);
const nonFiniteNestedSummary = structuredClone(summary);
nonFiniteNestedSummary.reasonRows.find(row => row.reason === 'active').measurements.averageCurrentActivity = Number.NaN;
assert.throws(
  () => core.validateFingerFluidFiniteDiagnosticPayload(nonFiniteNestedSummary),
  /non-finite diagnostic payload/i,
);

assert.match(coreSource, /sheetDiagnosticClassification: vec4<f32>/);
assert.match(coreSource, /sheetDiagnosticKinematics: vec4<f32>/);
assert.match(coreSource, /sheetDiagnosticNeighborhood: vec4<f32>/);
assert.doesNotMatch(coreSource, /sheetDiagnosticTopology: vec4<f32>/, 'diagnostics reuse existing topology metrics instead of reducing particle capacity');
assert.match(coreSource, /fn write_sheet_release_diagnostics/);
assert.match(coreSource, /sheet_release_reason_color/);
assert.match(coreSource, /unsupportedSheetReleaseDiagnostics/);
assert.match(coreSource, /colorMode == 7u[\s\S]*sheetDiagnosticClassification\.x/);
assert.match(witnessSource, /sheet release diagnostics missing or partial at capture/i);
assert.match(witnessSource, /diagnosedActiveParticleCount\s*!==\s*releaseDiagnostics\.activeParticleCount/);
assert.match(witnessSource, /reasonRows\.reduce/);
assert.match(witnessSource, /validateFingerFluidWaterfallWitnessRenderIdentity\(route/);
assert.match(witnessSource, /validateFingerFluidFiniteDiagnosticPayload\(releaseDiagnostics/);

console.log('finger fluid sheet release diagnostics contracts passed');
