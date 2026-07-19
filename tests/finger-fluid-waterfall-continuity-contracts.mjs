import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'finger-fluid-webgpu-core.js');
const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(join(root, 'finger-fluid-bench-witness.mjs'), 'utf8');
const indexSource = readFileSync(join(root, 'index.html'), 'utf8');
const core = await import(corePath);

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

const particleCount = 36;
const particles = new Float32Array(particleCount * 16);
const restStates = new Float32Array(particleCount * 4);
const phases = [0.08, 0.48, 0.82];
for (let index = 0; index < particleCount; index += 1) {
  const sourceIndex = index % 3;
  const ordinal = Math.floor(index / 3);
  const offset = index * 16;
  const restOffset = index * 4;
  particles[offset] = -1.34 + sourceIndex * 1.34;
  particles[offset + 1] = 0.15 - ordinal * 0.07;
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
  assert.equal(waterfall.particleCount, 12, JSON.stringify(waterfall));
  assert.equal(waterfall.componentCount, 1, JSON.stringify(waterfall));
  assert.equal(waterfall.largestComponentParticleRatio, 1, JSON.stringify(waterfall));
  assert.ok(waterfall.connectedSurvivalLength > 0.6, JSON.stringify(waterfall));
  assert.ok(waterfall.transverseVelocityStdDev < 0.02, JSON.stringify(waterfall));
}
const connectedAcceptance = core.evaluateFingerFluidWaterfallContinuityAcceptance({
  diagnostics: connected,
  sourceParticleCounts: [12, 12, 12],
});
assert.equal(connectedAcceptance.ok, true, JSON.stringify(connectedAcceptance));

for (let index = 18; index < particleCount; index += 1) particles[index * 16 + 1] -= 0.28;
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
});
assert.equal(sparsePopulationAcceptance.ok, false, 'three tiny strands cannot close a 24,576-particle source witness');
assert.ok(
  sparsePopulationAcceptance.waterfalls.every(waterfall => waterfall.coverageAccepted === false),
  JSON.stringify(sparsePopulationAcceptance),
);

const imageWidth = 100;
const imageHeight = 100;
const broadCurtainRgb = new Uint8Array(imageWidth * imageHeight * 3);
const sparseStrandsRgb = new Uint8Array(imageWidth * imageHeight * 3);
const broadBinarySupportRgb = new Uint8Array(imageWidth * imageHeight * 3);
const sparseBinarySupportRgb = new Uint8Array(imageWidth * imageHeight * 3);
const corridorFillingBinarySupportRgb = new Uint8Array(imageWidth * imageHeight * 3);
const allWhiteBinarySupportRgb = new Uint8Array(imageWidth * imageHeight * 3);
allWhiteBinarySupportRgb.fill(255);
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
const paintBinarySupport = (rgb, minX, maxX) => {
  for (let y = 34; y < 64; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const offset = (y * imageWidth + x) * 3;
      rgb.fill(255, offset, offset + 3);
    }
  }
};
paintBinarySupport(broadBinarySupportRgb, 8, 46);
paintBinarySupport(sparseBinarySupportRgb, 8, 11);
paintBinarySupport(sparseBinarySupportRgb, 28, 31);
paintBinarySupport(sparseBinarySupportRgb, 48, 51);
paintBinarySupport(corridorFillingBinarySupportRgb, 0, 72);
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
const broadBinarySupportAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  broadBinarySupportRgb,
  imageWidth,
  imageHeight,
  { pixelMode: 'binary_liquid_support' },
);
const sparseBinarySupportAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  sparseBinarySupportRgb,
  imageWidth,
  imageHeight,
  { pixelMode: 'binary_liquid_support' },
);
const corridorFillingBinarySupportAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  corridorFillingBinarySupportRgb,
  imageWidth,
  imageHeight,
  { pixelMode: 'binary_liquid_support' },
);
const allWhiteBinarySupportAcceptance = core.measureFingerFluidWaterfallImageContinuity(
  allWhiteBinarySupportRgb,
  imageWidth,
  imageHeight,
  { pixelMode: 'binary_liquid_support' },
);
assert.equal(broadImageAcceptance.ok, true, JSON.stringify(broadImageAcceptance));
assert.equal(sparseImageAcceptance.ok, false, JSON.stringify(sparseImageAcceptance));
assert.equal(broadBinarySupportAcceptance.ok, true, JSON.stringify(broadBinarySupportAcceptance));
assert.equal(broadBinarySupportAcceptance.measurement, 'same_camera_sphere_debug_binary_liquid_support_row_coverage_v1');
assert.equal(sparseBinarySupportAcceptance.ok, false, JSON.stringify(sparseBinarySupportAcceptance));
assert.equal(corridorFillingBinarySupportAcceptance.ok, false, JSON.stringify(corridorFillingBinarySupportAcceptance));
assert.equal(allWhiteBinarySupportAcceptance.ok, false, JSON.stringify(allWhiteBinarySupportAcceptance));
assert.equal(broadBinarySupportAcceptance.binarySupportLocalizationAccepted, true, JSON.stringify(broadBinarySupportAcceptance));
assert.equal(corridorFillingBinarySupportAcceptance.binarySupportLocalizationAccepted, false, JSON.stringify(corridorFillingBinarySupportAcceptance));
assert.equal(allWhiteBinarySupportAcceptance.binarySupportLocalizationAccepted, false, JSON.stringify(allWhiteBinarySupportAcceptance));
assert.equal(allWhiteBinarySupportAcceptance.frameBackgroundAccepted, false, JSON.stringify(allWhiteBinarySupportAcceptance));
assert.throws(
  () => core.measureFingerFluidWaterfallImageContinuity(broadBinarySupportRgb, imageWidth, imageHeight, { pixelMode: 'fallback' }),
  /Unsupported waterfall image continuity pixel mode/,
);

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
assert.match(witnessSource, /waterfallLiquidSupportOut[\s\S]*'liquid_support',\s*0,[\s\S]*'binary_liquid_support'/);
assert.match(witnessSource, /waterfallLiquidSupport\.receipt\.sphereDebugRenderFrameCount !== sphereDebug\.receipt\.sphereDebugRenderFrameCount \+ 1/);
assert.match(witnessSource, /sphereCounterAuthority[\s\S]*screenSpaceSurface\.receipt\.sphereDebugRenderFrameCount !== sphereCounterAuthority\.sphereDebugRenderFrameCount/);
assert.match(indexSource, /kaminosFingerFluidBenchSetSimulationPausedForWitness/);
assert.match(witnessSource, /finger_fluid_witness_target_step/);
assert.match(witnessSource, /capturedTargetStep/);
assert.doesNotMatch(witnessSource, /targetDeadline/, 'exact-step capture cannot castrate a slow valid GPU route with a local deadline');

console.log('finger fluid waterfall continuity contracts passed');
