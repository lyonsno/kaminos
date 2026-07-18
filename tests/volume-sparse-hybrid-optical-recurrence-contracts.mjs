import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(join(root, 'volume-raymarch-filament-orbit-witness.mjs'), 'utf8');

assert.match(
  core,
  /COARSE_RESIDUAL_SHARED_OPTICAL_RECURRENCE_IDENTITY\s*=\s*['"]coarse-residual-plus-full-resolution-splat-shared-optical-recurrence-v1['"]/,
  'hybrid path lacks the repaired shared optical recurrence route',
);
assert.match(core, /COARSE_RESIDUAL_OPTICAL_INTERVALS\s*=\s*4/, 'shared hybrid route must retain four residual optical intervals');
assert.match(
  core,
  /coarseResidualOptical0\.rgb\s*=\s*coarseResidualOptical0\.rgb\s*\+\s*exp\(-coarseResidualOptical0\.a\)\s*\*\s*nonRidgeEmissionCoefficient[\s\S]*coarseResidualOptical0\.a\s*=\s*coarseResidualOptical0\.a\s*\+\s*nonRidgeExtinctionCoefficient/,
  'residual intervals must preintegrate raymarch emission under their local transmittance',
);
assert.match(
  core,
  /fn fsCoarseResidualOpticalIntervals[\s\S]*out\.interval0\s*=\s*result\.coarseResidualOptical0[\s\S]*out\.interval3\s*=\s*result\.coarseResidualOptical3/,
  'coarse optical fragment must retain all four accumulated coefficient intervals',
);
assert.match(
  core,
  /fn coarseResidualSharedOpticalFs[\s\S]*residualIntervalAlpha\s*=\s*1\.0\s*-\s*exp\(-residualAccumulated\.a\)[\s\S]*residualSubintervalEmission[\s\S]*residualSourceNumerator[\s\S]*splatAccumulated[\s\S]*1\.0\s*-\s*exp\(-opticalDepth\)/,
  'shared resolve must reconstruct raymarch-equivalent interval emission before merging ordered splat optical bins',
);
assert.match(core, /far-to-near-shared-alpha-over-v0/, 'shared route receipt must name the effective ordered recurrence');
assert.match(core, /raymarch-equivalent-homogeneous-four-way-subinterval-distribution-v1/, 'shared route must disclose its raymarch-equivalent within-interval approximation');
assert.doesNotMatch(
  core,
  /let accumulated\s*=\s*residualAccumulated\s*\/\s*4\.0\s*\+\s*splatAccumulated/,
  'already-integrated raymarch emission must never be reinterpreted as a source-function numerator',
);
assert.match(
  core,
  /let residualSourceNumerator\s*=\s*select\(\s*residualSubintervalEmission,[\s\S]*residualSubintervalOpticalDepth\s*>\s*1e-6[\s\S]*let binEmission\s*=\s*select\(\s*accumulated\.rgb,[\s\S]*opticalDepth\s*>\s*1e-6/,
  'zero-extinction residual emission must use the shared-bin transport limit instead of bypassing splat extinction',
);
assert.doesNotMatch(core, /residualVacuumEmission/, 'residual emission must not bypass the shared optical recurrence');
assert.match(core, /COARSE_RESIDUAL_SHARED_OPTICAL_DEPTH_INTERVAL_IDENTITY\s*=\s*['"]camera-ray-entry-to-exit-sixteen-equal-intervals-v0['"]/, 'splat and residual recurrence must share linear camera-ray depth semantics');
assert.match(core, /boundarySplatSharedOpticalPipelines[\s\S]*SHARED_LINEAR_OPTICAL_DEPTH:\s*1/, 'shared route must not reuse projected-NDC bins against linear residual intervals');
assert.match(core, /coefficientConservationEligible:\s*false/, 'unproven learned splat coefficients must not claim exact coefficient conservation');
assert.match(core, /selfTransmittanceParityEligible:\s*true/, 'accepted shared recurrence must expose its bounded optical parity eligibility');

assert.match(witness, /--sparse-hybrid-optical-scales/, 'orbit witness must require explicit shared-optical intent');
assert.match(witness, /sparseHybridOpticalRecurrence/, 'orbit witness must capture the shared recurrence as a distinct arm');
assert.match(witness, /profileSparseHybridOptical/, 'witness must expose corrected-route optical timing');
assert.match(witness, /warmupIterations:\s*3/, 'timing must include explicit warmup iterations');
assert.match(witness, /sampleIterations:\s*7/, 'timing must retain repeated post-warmup samples');
assert.match(core, /median[\s\S]*p10[\s\S]*p90/, 'timing evidence must report a distribution rather than one noisy sample');
assert.match(core, /reconstructionMs[\s\S]*splatRasterMs[\s\S]*recurrenceMs[\s\S]*totalGpuMs/, 'timing must split reconstruction, recurrence, splat, and total');
assert.match(
  core,
  /async function sampleSparseHybridOpticalGpuProfile[\s\S]*const telemetryEncoded\s*=\s*encodeBoundarySplatTelemetry\(encoder, true\)[\s\S]*boundary-splat-optical-profile-telemetry-unavailable[\s\S]*await resolveBoundarySplatTelemetry\(\)[\s\S]*Number\.isInteger\(overflowCount\)[\s\S]*boundary-splat-optical-profile-overflow/,
  'shared-optical timings must reject capacity-truncated splat raster evidence',
);
assert.match(witness, /captured-awaiting-personal-inspection/, 'nonblank shared-optical output must not claim visual acceptance');
assert.match(witness, /candidate payload hash disagrees with requested authority/, 'shared-optical replay must fail on candidate substitution');

console.log('volume sparse hybrid optical recurrence contracts: ok');
