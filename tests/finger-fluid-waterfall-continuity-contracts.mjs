import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'finger-fluid-webgpu-core.js');
const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(join(root, 'finger-fluid-bench-witness.mjs'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');
const core = await import(corePath);

assert.equal(core.KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT, 49_152);
assert.equal(core.KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS, 1 / 60);
assert.equal(
  core.KAMINOS_FINGER_FLUID_BENCH_TIME_INTEGRATION_CONTRACT,
  'fixed-step-60hz-one-simulation-step-per-render-frame-v0',
);
assert.equal(core.resolveFingerFluidParticleCount('49152'), 49_152);
assert.equal(core.resolveFingerFluidParticleCount(98_304), 98_304);
assert.throws(() => core.resolveFingerFluidParticleCount(1023), /at least 1024/);
assert.throws(() => core.resolveFingerFluidParticleCount(24_576.5), /safe integer/);
assert.throws(() => core.resolveFingerFluidParticleCount('not-a-count'), /safe integer/);

assert.equal(
  core.KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT,
  'wgsl-support-aware-symmetric-capillary-sheet-v0',
);
assert.equal(
  core.KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA,
  'kaminos.finger-fluid.waterfall-continuity-diagnostics.v0',
);
assert.equal(
  core.KAMINOS_FINGER_FLUID_INTERFACE_PRESSURE_CONTRACT,
  'wgsl-unilateral-free-surface-pressure-v0',
);

assert.equal(
  core.evaluateFingerFluidInterfaceDensityConstraint({ densityRatio: 0.62, surfaceFactor: 1 }),
  0,
  'a free surface cannot acquire pressure suction merely because it lacks neighbors',
);
assert.equal(
  core.evaluateFingerFluidInterfaceDensityConstraint({ densityRatio: 0.62, surfaceFactor: 0 }),
  -0.03,
  'resolved interior keeps only a bounded tension allowance',
);
assert.equal(
  core.evaluateFingerFluidInterfaceDensityConstraint({ densityRatio: 1.08, surfaceFactor: 1 }),
  0.08,
  'unilateral interface pressure still projects compression',
);

const richPair = core.evaluateFingerFluidCapillaryPair({
  offset: [0.11, 0, 0],
  kernelRadius: 0.185,
  surfaceFactors: [0.9, 0.8],
  densityRatios: [0.94, 0.91],
  strength: 0.72,
});
assert.ok(richPair.magnitude > 0, JSON.stringify(richPair));
assert.deepEqual(
  richPair.accelerationA.map((value, index) => Number((value + richPair.accelerationB[index]).toFixed(12))),
  [0, 0, 0],
  'capillary pairs conserve momentum instead of normalizing each particle independently',
);

const sparsePair = core.evaluateFingerFluidCapillaryPair({
  offset: [0.11, 0, 0],
  kernelRadius: 0.185,
  surfaceFactors: [1, 1],
  densityRatios: [0.38, 0.41],
  strength: 0.72,
});
assert.ok(
  sparsePair.magnitude < richPair.magnitude * 0.2,
  `unresolved sparse support must not receive pool-strength inward attraction: ${JSON.stringify({ richPair, sparsePair })}`,
);

const outsidePair = core.evaluateFingerFluidCapillaryPair({
  offset: [0.19, 0, 0],
  kernelRadius: 0.185,
  surfaceFactors: [1, 1],
  densityRatios: [1, 1],
  strength: 0.72,
});
assert.equal(outsidePair.magnitude, 0);

assert.equal(core.evaluateFingerFluidThinSheetVorticityActivity({ surfaceFactor: 0, densityRatio: 0.3 }), 1);
assert.ok(
  core.evaluateFingerFluidThinSheetVorticityActivity({ surfaceFactor: 1, densityRatio: 0.42 }) < 0.25,
  'unresolved free sheets attenuate confinement noise',
);
assert.ok(
  core.evaluateFingerFluidThinSheetVorticityActivity({ surfaceFactor: 0.8, densityRatio: 0.96 }) > 0.8,
  'resolved interfaces retain legitimate vorticity',
);

assert.equal(core.KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST, 0.17);
assert.equal(
  core.evaluateFingerFluidFreeFlightViscosityBlend({ baseViscosity: 0.07, supportContact: 1, boost: 0.17 }),
  0.07,
  'support-adjacent transport keeps the accepted partial-slip viscosity',
);
assert.ok(
  core.evaluateFingerFluidFreeFlightViscosityBlend({ baseViscosity: 0.07, supportContact: 0, boost: 0.17 }) >= 0.23,
  'unsupported sheets receive enough XSPH alignment to suppress transverse breakup',
);

const particleCount = 108;
const particles = new Float32Array(particleCount * 16);
const restStates = new Float32Array(particleCount * 4);
const phases = [0.08, 0.48, 0.82];
for (let index = 0; index < particleCount; index += 1) {
  const sourceIndex = index % 3;
  const ordinal = Math.floor(index / 3);
  const lane = ordinal % 3;
  const row = Math.floor(ordinal / 3);
  const offset = index * 16;
  const restOffset = index * 4;
  particles[offset] = -1.34 + sourceIndex * 1.34 + (lane - 1) * 0.055;
  particles[offset + 1] = 0.15 - row * 0.07;
  particles[offset + 2] = -1.12;
  particles[offset + 7] = 0.9;
  particles[offset + 8] = 0.01 * sourceIndex;
  particles[offset + 9] = -0.72;
  particles[offset + 10] = 0.02;
  particles[offset + 11] = phases[sourceIndex];
  particles[offset + 15] = 21.4;
  restStates[restOffset] = 0.9;
  restStates[restOffset + 1] = 0.5;
}

const connected = core.measureFingerFluidWaterfallContinuity(particles, restStates, particleCount);
assert.equal(connected.schema, core.KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA);
assert.equal(connected.waterfalls.length, 3);
assert.equal(connected.accountedParticleCount, particleCount);
for (const waterfall of connected.waterfalls) {
  assert.equal(waterfall.particleCount, 36, JSON.stringify(waterfall));
  assert.equal(waterfall.componentCount, 1, JSON.stringify(waterfall));
  assert.equal(waterfall.largestComponentParticleRatio, 1, JSON.stringify(waterfall));
  assert.ok(waterfall.connectedSurvivalLength > 0.7, JSON.stringify(waterfall));
  assert.ok(waterfall.transverseVelocityStdDev < 0.02, JSON.stringify(waterfall));
  assert.ok(waterfall.averageCloseNeighborCount >= 4, JSON.stringify(waterfall));
  assert.ok(waterfall.closeNeighborSupportedParticleRatio >= 0.65, JSON.stringify(waterfall));
}
const connectedAcceptance = core.evaluateFingerFluidWaterfallContinuityAcceptance({
  diagnostics: connected,
  sourceParticleCounts: [36, 36, 36],
  activeSourceParticleCounts: [36, 36, 36],
});
assert.equal(connectedAcceptance.ok, true, JSON.stringify(connectedAcceptance));

const dormantReserveAcceptance = core.evaluateFingerFluidWaterfallContinuityAcceptance({
  diagnostics: connected,
  sourceParticleCounts: [1000, 1000, 1000],
  activeSourceParticleCounts: [36, 36, 36],
});
assert.equal(
  dormantReserveAcceptance.ok,
  true,
  `dormant reserve capacity cannot dilute active-flow coverage: ${JSON.stringify(dormantReserveAcceptance)}`,
);
assert.equal(dormantReserveAcceptance.sourcePopulationCount, 3000);
assert.equal(dormantReserveAcceptance.activeSourcePopulationCount, 108);
assert.ok(dormantReserveAcceptance.waterfalls.every(waterfall => waterfall.activeSourceParticleCount === 36));

for (let index = 54; index < particleCount; index += 1) particles[index * 16 + 1] -= 0.28;
const fragmented = core.measureFingerFluidWaterfallContinuity(particles, restStates, particleCount);
assert.ok(
  fragmented.waterfalls.some(waterfall => waterfall.componentCount > 1 && waterfall.largestComponentParticleRatio < 1),
  JSON.stringify(fragmented),
);

const sparsePopulationCount = 24576;
const sparseParticles = new Float32Array(sparsePopulationCount * 16);
const sparseRestStates = new Float32Array(sparsePopulationCount * 4);
for (let index = 0; index < sparsePopulationCount; index += 1) sparseParticles[index * 16 + 11] = -1;
for (let sourceIndex = 0; sourceIndex < 3; sourceIndex += 1) {
  for (let ordinal = 0; ordinal < 8; ordinal += 1) {
    const index = sourceIndex * 8 + ordinal;
    const offset = index * 16;
    sparseParticles[offset] = -1.34 + sourceIndex * 1.34;
    sparseParticles[offset + 1] = 0.15 - ordinal * 0.07;
    sparseParticles[offset + 2] = -1.12;
    sparseParticles[offset + 7] = 0.9;
    sparseParticles[offset + 9] = -0.72;
    sparseParticles[offset + 11] = phases[sourceIndex];
    sparseParticles[offset + 15] = 21.4;
  }
}
const sparsePopulationDiagnostics = core.measureFingerFluidWaterfallContinuity(
  sparseParticles,
  sparseRestStates,
  sparsePopulationCount,
);
const sparsePopulationAcceptance = core.evaluateFingerFluidWaterfallContinuityAcceptance({
  diagnostics: sparsePopulationDiagnostics,
  sourceParticleCounts: [9832, 7373, 7371],
  activeSourceParticleCounts: [9832, 7373, 7371],
});
assert.equal(sparsePopulationAcceptance.ok, false, 'three tiny strands cannot close a 24,576-particle source witness');
assert.ok(
  sparsePopulationAcceptance.waterfalls.every(waterfall => waterfall.coverageAccepted === false),
  JSON.stringify(sparsePopulationAcceptance),
);
assert.ok(
  sparsePopulationAcceptance.waterfalls.every(waterfall => waterfall.closeNeighborSupportAccepted === false),
  `three one-dimensional bead chains cannot masquerade as locally supported sheets: ${JSON.stringify(sparsePopulationAcceptance)}`,
);

const imageWidth = 100;
const imageHeight = 100;
const broadCurtainRgb = new Uint8Array(imageWidth * imageHeight * 3);
const sparseStrandsRgb = new Uint8Array(imageWidth * imageHeight * 3);
const wideBeadFieldRgb = new Uint8Array(imageWidth * imageHeight * 3);
const paint = (rgb, minX, maxX) => {
  for (let y = 34; y < 64; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const offset = (y * imageWidth + x) * 3;
      rgb[offset] = 20;
      rgb[offset + 1] = 180;
      rgb[offset + 2] = 220;
    }
  }
};
paint(broadCurtainRgb, 8, 46);
paint(sparseStrandsRgb, 8, 11);
paint(sparseStrandsRgb, 28, 31);
paint(sparseStrandsRgb, 48, 51);
for (let x = 4; x < 70; x += 5) paint(wideBeadFieldRgb, x, x + 2);
const broadImageAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  broadCurtainRgb,
  imageWidth,
  imageHeight,
);
const sparseImageAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  sparseStrandsRgb,
  imageWidth,
  imageHeight,
);
const wideBeadImageAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  wideBeadFieldRgb,
  imageWidth,
  imageHeight,
);
assert.equal(broadImageAcceptance.ok, true, JSON.stringify(broadImageAcceptance));
assert.equal(sparseImageAcceptance.ok, false, JSON.stringify(sparseImageAcceptance));
assert.equal(
  wideBeadImageAcceptance.ok,
  false,
  `total row coverage cannot let many disconnected beads impersonate one curtain: ${JSON.stringify(wideBeadImageAcceptance)}`,
);

const separatedCurtainWidth = 1000;
const separatedCurtainRgb = new Uint8Array(separatedCurtainWidth * imageHeight * 3);
const paintSeparatedCurtain = (minX, maxX) => {
  for (let y = 34; y < 64; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const offset = (y * separatedCurtainWidth + x) * 3;
      separatedCurtainRgb[offset] = 18;
      separatedCurtainRgb[offset + 1] = 104;
      separatedCurtainRgb[offset + 2] = 196;
    }
  }
};
for (const minX of [40, 100, 160, 220, 280, 340]) paintSeparatedCurtain(minX, minX + 32);
const separatedCurtainAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  separatedCurtainRgb,
  separatedCurtainWidth,
  imageHeight,
);
assert.equal(
  separatedCurtainAcceptance.ok,
  true,
  `multiple source-separated broad curtains remain acceptable when each run is materially wider than the rejected bead field: ${JSON.stringify(separatedCurtainAcceptance)}`,
);

const acceptedEvidenceIdentity = Object.freeze({
  schema: 'kaminos.finger-fluid.waterfall-soak-evidence-identity.v0',
  truthScene: 'laminar_inlets',
  colorMode: 'phase',
  rendererMode: 'screen_space_refraction',
  rendererRoute: 'webgpu-screen-space-liquid-refraction-v0',
  solverBackend: 'webgpu_compute',
  renderBackend: 'webgpu_direct_render',
  adapterVendor: 'apple',
  adapterArchitecture: 'metal-3',
  opticalDebugMode: 'shaded',
  adaptiveDensity: false,
  baseParticleCount: 49_152,
  particleCount: 49_152,
  timeIntegrationContract: core.KAMINOS_FINGER_FLUID_BENCH_TIME_INTEGRATION_CONTRACT,
  fixedTimeStepSeconds: core.KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
  solverRoute: core.KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE,
  shaderRoute: core.KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE,
  waterfallContinuityContract: core.KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT,
  supportFriction: 1.6,
  particleShiftStrength: 0,
  chemistryDiffusion: 0,
  capillaryStrength: 0.72,
  thinSheetVorticityAttenuation: 0.88,
  freeFlightViscosityBoost: 0.17,
  densityIterationsPerStep: 3,
  substeps: 1,
});
const acceptedHorizon = (requestedTargetStep) => ({
  requestedTargetStep,
  capturedTargetStep: requestedTargetStep + 1,
  evidenceIdentity: { ...acceptedEvidenceIdentity },
  waterfallContinuityAcceptance: {
    ok: true,
    waterfalls: [0, 1, 2].map(sourceIndex => ({ sourceIndex, ok: true, closeNeighborSupportAccepted: true })),
  },
  waterfallImageContinuity: { ok: true },
});
const acceptedSoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: [480, 1200, 2400, 4800].map(acceptedHorizon),
});
assert.equal(acceptedSoak.ok, true, JSON.stringify(acceptedSoak));
assert.deepEqual(acceptedSoak.commonEvidenceIdentity, acceptedEvidenceIdentity);

const mixedIdentityHorizons = [480, 1200, 2400, 4800].map(acceptedHorizon);
mixedIdentityHorizons[2].evidenceIdentity.particleCount = 24_576;
const mixedIdentitySoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: mixedIdentityHorizons,
});
assert.equal(mixedIdentitySoak.ok, false, 'mixed particle populations cannot impersonate one sustained soak');
assert.deepEqual(mixedIdentitySoak.identityRejectedTargetSteps, [2400]);

const mixedVisualRouteHorizons = [480, 1200, 2400, 4800].map(acceptedHorizon);
mixedVisualRouteHorizons[3].evidenceIdentity.colorMode = 'speed';
mixedVisualRouteHorizons[3].evidenceIdentity.adapterArchitecture = 'fallback-adapter';
const mixedVisualRouteSoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: mixedVisualRouteHorizons,
});
assert.equal(mixedVisualRouteSoak.ok, false, 'mixed visual or GPU routes cannot impersonate one sustained soak');
assert.deepEqual(mixedVisualRouteSoak.identityRejectedTargetSteps, [4800]);

const missingIdentityHorizons = [480, 1200, 2400, 4800].map(acceptedHorizon);
delete missingIdentityHorizons[1].evidenceIdentity;
const missingIdentitySoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: missingIdentityHorizons,
});
assert.equal(missingIdentitySoak.ok, false, 'missing route/config identity must fail loud');
assert.deepEqual(missingIdentitySoak.identityRejectedTargetSteps, [1200]);

const duplicateHorizonSoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: [480, 1200, 2400, 4800, 2400].map(acceptedHorizon),
});
assert.equal(duplicateHorizonSoak.ok, false, 'duplicate horizon evidence cannot be silently overwritten');
assert.deepEqual(duplicateHorizonSoak.duplicateTargetSteps, [2400]);

const selectedEarlyFrameSoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: [acceptedHorizon(480)],
});
assert.equal(selectedEarlyFrameSoak.ok, false, 'one attractive early frame cannot close a sustained-fluid claim');
assert.deepEqual(selectedEarlyFrameSoak.missingTargetSteps, [1200, 2400, 4800]);

const marbleCollapseSoak = core.evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps: [480, 1200, 2400, 4800],
  horizons: [480, 1200, 2400, 4800].map(step => {
    const horizon = acceptedHorizon(step);
    if (step >= 1200) {
      horizon.waterfallContinuityAcceptance = {
        ok: false,
        waterfalls: [0, 1, 2].map(sourceIndex => ({ sourceIndex, ok: false, closeNeighborSupportAccepted: false })),
      };
    }
    return horizon;
  }),
});
assert.equal(marbleCollapseSoak.ok, false, JSON.stringify(marbleCollapseSoak));
assert.deepEqual(marbleCollapseSoak.rejectedTargetSteps, [1200, 2400, 4800]);

const capacity = core.measureFingerFluidParticleAllocationCapacity({
  maxBufferSize: 64 * 1024 * 1024,
  maxStorageBufferBindingSize: 4 * 1024 * 1024,
});
assert.equal(capacity.contract, 'webgpu-device-limit-derived-particle-allocation-preflight-v0');
assert.equal(capacity.limitingBuffer, 'neighbor-topology');
assert.equal(capacity.maximumSupportedParticleCount, Math.floor((4 * 1024 * 1024) / (36 * 4)));
assert.equal(
  core.evaluateFingerFluidParticleAllocationRequest(capacity.maximumSupportedParticleCount, capacity).ok,
  true,
  'the exact device-derived boundary remains usable',
);
const oversizedAllocation = core.evaluateFingerFluidParticleAllocationRequest(capacity.maximumSupportedParticleCount + 1, capacity);
assert.equal(oversizedAllocation.ok, false);
assert.equal(oversizedAllocation.requestedParticleCount, capacity.maximumSupportedParticleCount + 1);
assert.equal(oversizedAllocation.maximumSupportedParticleCount, capacity.maximumSupportedParticleCount);
assert.match(oversizedAllocation.reason, /exceeds device-derived maximum/);

assert.doesNotMatch(
  coreSource,
  /attraction\s*\/\s*max\(attractionWeight/,
  'locally normalized one-sided attraction is the kernel-periodic bead mechanism',
);
assert.match(coreSource, /fn capillary_pair_weight/);
assert.match(coreSource, /fn interface_density_constraint/);
assert.match(coreSource, /pairSupportConfidence/);
assert.match(coreSource, /thin_sheet_vorticity_activity/);
assert.match(coreSource, /waterfallContinuityContract/);
assert.match(witnessSource, /waterfall continuity diagnostics missing or partial/);
assert.match(witnessSource, /waterfall fragmented at the source-relative aperture scale/);
assert.match(witnessSource, /waterfall transverse velocity coherence escaped/);
assert.match(witnessSource, /waterfall image continuity escaped/);
assert.match(indexSource, /kaminosFingerFluidBenchSetSimulationPausedForWitness/);
assert.match(witnessSource, /finger_fluid_witness_target_step/);
assert.match(witnessSource, /capturedTargetStep/);
assert.match(indexSource, /finger_fluid_particle_count/);
assert.match(indexSource, /requestedParticleCount/);
assert.match(indexSource, /effectiveParticleCount/);
assert.match(
  indexSource,
  /particleCount:\s*fingerFluidBenchConfig\.effectiveParticleCount/,
  'the route-selected population reaches the actual GPU solver allocation',
);
assert.match(
  indexSource,
  /fingerFluidBenchSolver\.step\(KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS\)/,
  'bench simulation horizons advance at a deterministic physical timestep',
);
assert.doesNotMatch(
  indexSource,
  /fingerFluidBenchSolver\.step\(Math\.min\([\s\S]*?drawFingerFluidBenchFrame\.lastNow/,
  'browser scheduling jitter cannot change physical time per witness step',
);
assert.match(indexSource, /timeIntegrationContract:\s*KAMINOS_FINGER_FLUID_BENCH_TIME_INTEGRATION_CONTRACT/);
assert.match(indexSource, /fixedTimeStepSeconds:\s*KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS/);
assert.match(witnessSource, /requestedParticleCount/);
assert.match(witnessSource, /effectiveParticleCount/);
assert.match(witnessSource, /particle-count disagreement rejected/);
assert.match(witnessSource, /fixed-step integration disagreement rejected/);
assert.match(witnessSource, /waterfallSoakEvidenceIdentity/);
assert.match(
  witnessSource,
  /finger fluid bench route rejected before primary output/,
  'pre-allocation route rejection must remain the durable witness failure reason',
);
assert.match(
  witnessSource,
  /activeSourceParticleCounts:\s*inletDiagnostics\.inlets\.map\(inlet => inlet\.activeParticleCount\)/,
  'waterfall coverage uses the source population active at the captured horizon, not dormant reserve capacity',
);
assert.doesNotMatch(witnessSource, /targetDeadline/, 'exact-step capture cannot castrate a slow valid GPU route with a local deadline');
const preflightIndex = coreSource.indexOf('evaluateFingerFluidParticleAllocationRequest(safeParticleCount');
const truthSceneAllocationIndex = coreSource.indexOf('createFingerFluidTruthSceneParticles(safeBaseParticleCount');
assert.ok(preflightIndex >= 0, 'solver must execute the device-derived particle allocation preflight');
assert.ok(
  preflightIndex < truthSceneAllocationIndex,
  'particle allocation preflight must run before proportional CPU truth-scene arrays are created',
);

console.log('finger fluid waterfall continuity contracts passed');
