import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const wrapper = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');

const positiveModes = [
  'complete-flame-emission',
  'complete-flame-extinction',
  'ridge-owned-emission',
  'ridge-owned-extinction',
  'non-ridge-emission',
  'non-ridge-extinction',
  'positive-optical-recomposition',
];

for (const mode of positiveModes) {
  assert.match(core, new RegExp(`['"]${mode}['"]`), `core declares ${mode}`);
  assert.match(wrapper, new RegExp(`data-appearance-assay=['"]${mode}['"]`), `operator exposes ${mode}`);
}

assert.match(core, /let completeFlameEmissionCoefficient\s*=\s*max\(standardRadianceContribution,\s*vec3<f32>\(0\.0\)\)/, 'Complete Flame emission is explicitly nonnegative');
assert.match(core, /let completeFlameExtinctionCoefficient\s*=\s*max\(standardExtinctionStep,\s*0\.0\)/, 'Complete Flame extinction is explicitly nonnegative');
assert.match(core, /let ridgeOwnershipWeight\s*=\s*clamp\(directFlameCandidateSupport,\s*0\.0,\s*1\.0\)/, 'ridge ownership comes from the frozen state-derived candidate support');
assert.match(core, /let ridgeOwnedEmissionCoefficient\s*=\s*completeFlameEmissionCoefficient\s*\*\s*ridgeOwnershipWeight/, 'Ridge-Owned emission is a positive allocation of Complete Flame');
assert.match(core, /let ridgeOwnedExtinctionCoefficient\s*=\s*completeFlameExtinctionCoefficient\s*\*\s*ridgeOwnershipWeight/, 'Ridge-Owned extinction is a positive allocation of Complete Flame');
assert.match(core, /let nonRidgeEmissionCoefficient\s*=\s*completeFlameEmissionCoefficient\s*-\s*ridgeOwnedEmissionCoefficient/, 'Non-Ridge emission receives the exact positive remainder');
assert.match(core, /let nonRidgeExtinctionCoefficient\s*=\s*completeFlameExtinctionCoefficient\s*-\s*ridgeOwnedExtinctionCoefficient/, 'Non-Ridge extinction receives the exact positive remainder');
assert.match(core, /let positiveRecomposedEmissionCoefficient\s*=\s*ridgeOwnedEmissionCoefficient\s*\+\s*nonRidgeEmissionCoefficient/, 'positive emission partition is explicitly recomposed');
assert.match(core, /let positiveRecomposedExtinctionCoefficient\s*=\s*ridgeOwnedExtinctionCoefficient\s*\+\s*nonRidgeExtinctionCoefficient/, 'positive extinction partition is explicitly recomposed');
assert.match(core, /positiveRecomposedColor\s*=\s*positiveRecomposedColor\s*\+\s*positiveRecomposedTransmittance\s*\*\s*positiveRecomposedEmissionCoefficient/, 'positive partition uses an independent front-to-back emission recurrence');
assert.match(core, /positiveRecomposedTransmittance\s*=\s*positiveRecomposedTransmittance\s*\*\s*exp\(-positiveRecomposedExtinctionCoefficient\)/, 'positive partition uses real exponential transmittance');
assert.match(core, /positivePartitionIdentity:\s*'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0'/, 'receipt names the exact positive partition authority');
assert.match(core, /completeFlameIdentity:\s*'smoke-off-complete-flame-local-emission-extinction-v0'/, 'receipt names the complete optical target');
assert.match(core, /ridgeOwnershipIdentity:\s*'state-derived-direct-flame-candidate-support-allocation-v0'/, 'receipt identifies the ridge ownership source');
assert.match(core, /coefficientSigns:[\s\S]*ridgeOwned:\s*'nonnegative'[\s\S]*nonRidge:\s*'nonnegative'/, 'receipt does not launder signed Closure into the positive targets');
assert.match(core, /'broad-carrier-b'[\s\S]*signed-control-minus-structural-a-local-coefficients-v0/, 'signed Appearance Closure remains an explicit comparator');

console.log('volume positive flame partition contracts passed');
