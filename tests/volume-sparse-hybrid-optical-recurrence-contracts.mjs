import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(join(root, 'volume-raymarch-filament-orbit-witness.mjs'), 'utf8');

assert.match(
  core,
  /COARSE_RESIDUAL_SHARED_OPTICAL_RECURRENCE_IDENTITY\s*=\s*['"]coarse-residual-plus-full-resolution-splat-shared-optical-recurrence-v0['"]/,
  'hybrid path lacks the distinct shared optical recurrence route',
);
assert.match(core, /COARSE_RESIDUAL_OPTICAL_INTERVALS\s*=\s*4/, 'shared hybrid route must retain four residual optical intervals');
assert.match(
  core,
  /fn fsCoarseResidualOpticalIntervals[\s\S]*nonRidgeEmissionCoefficient[\s\S]*nonRidgeExtinctionCoefficient/,
  'residual intervals must carry the exact positive non-ridge emission and extinction complement',
);
assert.match(
  core,
  /fn coarseResidualSharedOpticalFs[\s\S]*residualAccumulated\s*\/\s*4\.0[\s\S]*splatAccumulated[\s\S]*1\.0\s*-\s*exp\(-opticalDepth\)/,
  'shared resolve must conserve each coarse interval while merging it into ordered splat optical bins',
);
assert.match(core, /far-to-near-shared-alpha-over-v0/, 'shared route receipt must name the effective ordered recurrence');
assert.match(core, /uniform-four-way-subinterval-distribution-v0/, 'shared route must disclose its within-interval approximation');
assert.match(core, /coefficientConservationEligible:\s*false/, 'unproven learned splat coefficients must not claim exact coefficient conservation');
assert.match(core, /selfTransmittanceParityEligible:\s*true/, 'accepted shared recurrence must expose its bounded optical parity eligibility');

assert.match(witness, /--sparse-hybrid-optical-scales/, 'orbit witness must require explicit shared-optical intent');
assert.match(witness, /sparseHybridOpticalRecurrence/, 'orbit witness must capture the shared recurrence as a distinct arm');
assert.match(witness, /profileSparseHybridOptical/, 'witness must expose corrected-route optical timing');
assert.match(witness, /warmupIterations:\s*3/, 'timing must include explicit warmup iterations');
assert.match(witness, /sampleIterations:\s*7/, 'timing must retain repeated post-warmup samples');
assert.match(witness, /median[\s\S]*p10[\s\S]*p90/, 'timing evidence must report a distribution rather than one noisy sample');
assert.match(witness, /reconstructionMs[\s\S]*recurrenceMs[\s\S]*splatRasterMs[\s\S]*totalGpuMs/, 'timing must split reconstruction, recurrence, splat, and total');
assert.match(witness, /captured-awaiting-personal-inspection/, 'nonblank shared-optical output must not claim visual acceptance');
assert.match(witness, /candidate payload hash disagrees with requested authority/, 'shared-optical replay must fail on candidate substitution');

console.log('volume sparse hybrid optical recurrence contracts: ok');
