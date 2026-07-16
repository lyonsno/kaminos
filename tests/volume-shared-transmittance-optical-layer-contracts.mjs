import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const wrapper = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const presetContract = readFileSync(join(root, 'volume-settings-preset-contract.mjs'), 'utf8');

const transportModes = [
  {
    mode: 'ridge-emission-under-ridge-extinction',
    emission: "Object.freeze({ ridge: true, nonRidge: false })",
    extinction: "Object.freeze({ ridge: true, nonRidge: false })",
  },
  {
    mode: 'ridge-emission-under-total-flame-extinction',
    emission: "Object.freeze({ ridge: true, nonRidge: false })",
    extinction: "Object.freeze({ ridge: true, nonRidge: true })",
  },
  {
    mode: 'nonridge-emission-under-total-flame-extinction',
    emission: "Object.freeze({ ridge: false, nonRidge: true })",
    extinction: "Object.freeze({ ridge: true, nonRidge: true })",
  },
  {
    mode: 'complete-flame-under-total-extinction',
    emission: "Object.freeze({ ridge: true, nonRidge: true })",
    extinction: "Object.freeze({ ridge: true, nonRidge: true })",
  },
];

for (const { mode, emission, extinction } of transportModes) {
  assert.match(core, new RegExp(`['"]${mode}['"]\\s*:\\s*\\{[\\s\\S]*?emissionMask:\\s*${emission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?extinctionMask:\\s*${extinction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${mode} declares independent emission and extinction masks`);
  assert.match(wrapper, new RegExp(`data-appearance-assay=['"]${mode}['"]`), `operator exposes ${mode}`);
  assert.match(presetContract, new RegExp(`['"]${mode}['"]`), `preset routes admit ${mode}`);
}

assert.match(core, /var ridgeOnlyTransmittance\s*=\s*1\.0/, 'Ridge-only counterfactual owns an explicit transmittance');
assert.match(core, /var sharedTotalTransmittance\s*=\s*1\.0/, 'shared modes own one running total transmittance');
assert.match(core, /var sharedRidgeContribution\s*=\s*vec3<f32>\(0\.0\)/, 'Ridge contribution is accumulated separately');
assert.match(core, /var sharedNonRidgeContribution\s*=\s*vec3<f32>\(0\.0\)/, 'Non-Ridge contribution is accumulated separately');
assert.match(core, /ridgeOnlyContribution\s*=\s*ridgeOnlyContribution\s*\+\s*ridgeOnlyTransmittance\s*\*\s*ridgeOwnedEmissionCoefficient/, 'mode 1 transports fixed Ridge emission through Ridge extinction');
assert.match(core, /ridgeOnlyTransmittance\s*=\s*ridgeOnlyTransmittance\s*\*\s*exp\(-ridgeOwnedExtinctionCoefficient\)/, 'mode 1 excludes Non-Ridge extinction');
assert.match(core, /sharedRidgeContribution\s*=\s*sharedRidgeContribution\s*\+\s*sharedTotalTransmittance\s*\*\s*ridgeOwnedEmissionCoefficient/, 'shared Ridge contribution uses total transmittance');
assert.match(core, /sharedNonRidgeContribution\s*=\s*sharedNonRidgeContribution\s*\+\s*sharedTotalTransmittance\s*\*\s*nonRidgeEmissionCoefficient/, 'shared Non-Ridge contribution uses the same total transmittance');
assert.match(core, /sharedTotalExtinctionCoefficient\s*=\s*ridgeOwnedExtinctionCoefficient\s*\+\s*nonRidgeExtinctionCoefficient/, 'shared extinction preserves both authored layers');
assert.match(core, /sharedTotalTransmittance\s*=\s*sharedTotalTransmittance\s*\*\s*exp\(-sharedTotalExtinctionCoefficient\)/, 'one total recurrence transports both contribution channels');
assert.match(core, /color\s*=\s*sharedRidgeContribution\s*\+\s*sharedNonRidgeContribution/, 'Complete mode sums contribution channels before global tone mapping');
assert.match(core, /appearanceDecompositionMode\s*>\s*12\.5[\s\S]*trans\s*=\s*ridgeOnlyTransmittance[\s\S]*appearanceDecompositionMode\s*>\s*13\.5[\s\S]*trans\s*=\s*sharedTotalTransmittance/, 'ray termination follows the selected Ridge-only or shared extinction authority');

assert.match(core, /requestedEmissionMask[\s\S]*effectiveEmissionMask[\s\S]*requestedExtinctionMask[\s\S]*effectiveExtinctionMask/, 'receipt publishes requested and effective coefficient masks');
assert.match(core, /sourceState:[\s\S]*frameCount[\s\S]*simStepCount[\s\S]*sameStateCaptureId/, 'sample receipt binds transport to the frozen source state');
assert.match(core, /camera:[\s\S]*signature[\s\S]*position[\s\S]*quaternion[\s\S]*projectionMatrix/, 'sample receipt binds transport to the exact camera');
assert.match(core, /route:[\s\S]*requested[\s\S]*effective[\s\S]*backend/, 'sample receipt binds requested/effective route and backend');
assert.match(core, /route:\s*\{\s*requested:\s*state\.requestedRoute,\s*effective:\s*state\.effectiveRoute,\s*locationHref:/, 'route receipt does not substitute browser location for requested renderer route');
assert.match(core, /quality:[\s\S]*raySteps[\s\S]*adaptiveRays[\s\S]*renderScale/, 'sample receipt binds effective ray quality');
assert.match(core, /postprocess:[\s\S]*sumDomain:\s*'pre-tone-map-linear-radiance'/, 'receipt forbids independently tone-mapped image addition');
assert.match(core, /numericPrecision:[\s\S]{0,160}'wgsl-f32-same-invocation-componentwise-v0'/, 'receipt declares the recomposition precision');
assert.match(core, /fallbackReason:\s*fallbackReason\s*\|\|\s*null/, 'applied transport receipt preserves fallback truth');
assert.match(core, /unsupported-appearance-decomposition-mode:/, 'unsupported transport requests fail loud instead of looking authoritative');
assert.match(core, /struct OpticalTransportContributionOutput[\s\S]*sharedRidge[\s\S]*sharedNonRidge[\s\S]*sharedComplete/, 'renderer exposes all pre-tone-map contribution channels from one fragment result');
assert.match(core, /fn fsOpticalTransportContributions[\s\S]*result\.sharedRidgeContribution[\s\S]*result\.sharedNonRidgeContribution[\s\S]*result\.sharedCompleteContribution/, 'contribution readback is sourced from the renderer recurrence');
assert.match(core, /opticalTransportContributionPipeline[\s\S]*rgba16float/, 'renderer owns an explicit float contribution pipeline');
assert.match(core, /async function sampleSharedTransmittanceContributions[\s\S]*readRgba16FloatTexture[\s\S]*maxAbsError[\s\S]*exactWithinDeclaredPrecision/, 'runtime computes renderer-derived pre-tone-map reconstruction error');
assert.match(
  core,
  /async function sampleSharedTransmittanceContributions[\s\S]*device\.pushErrorScope\('validation'\);\s*let errorScopeOpen = true;[\s\S]*const validationError = await device\.popErrorScope\(\);\s*errorScopeOpen = false;[\s\S]*catch \(error\) \{\s*if \(errorScopeOpen\) await device\.popErrorScope\(\)\.catch\(\(\) => null\);/,
  'contribution readback owns its error-scope lifetime and preserves structured exception receipts',
);
assert.match(core, /sampleSharedTransmittanceContributions,[\s\S]*setAppearanceDecompositionMode/, 'prototype publishes the contribution witness API');

function integrate(samples, emissionMask, extinctionMask) {
  let transmittance = 1;
  let radiance = 0;
  for (const sample of samples) {
    const emission = sample.ridgeEmission * Number(emissionMask.ridge)
      + sample.nonRidgeEmission * Number(emissionMask.nonRidge);
    const extinction = sample.ridgeExtinction * Number(extinctionMask.ridge)
      + sample.nonRidgeExtinction * Number(extinctionMask.nonRidge);
    radiance += transmittance * emission;
    transmittance *= Math.exp(-extinction);
  }
  return radiance;
}

const samples = [
  { ridgeEmission: 0.7, nonRidgeEmission: 0.2, ridgeExtinction: 0.15, nonRidgeExtinction: 0.33 },
  { ridgeEmission: 0.4, nonRidgeEmission: 0.5, ridgeExtinction: 0.28, nonRidgeExtinction: 0.11 },
  { ridgeEmission: 0.9, nonRidgeEmission: 0.3, ridgeExtinction: 0.09, nonRidgeExtinction: 0.42 },
];
const totalExtinction = { ridge: true, nonRidge: true };
const ridgeUnderTotal = integrate(samples, { ridge: true, nonRidge: false }, totalExtinction);
const nonRidgeUnderTotal = integrate(samples, { ridge: false, nonRidge: true }, totalExtinction);
const completeUnderTotal = integrate(samples, { ridge: true, nonRidge: true }, totalExtinction);
assert.ok(Math.abs((ridgeUnderTotal + nonRidgeUnderTotal) - completeUnderTotal) < 1e-12, 'shared pre-tone-map contributions reconstruct Complete');
assert.notEqual(
  integrate(samples, { ridge: true, nonRidge: false }, { ridge: true, nonRidge: false }),
  ridgeUnderTotal,
  'Ridge-only and total-extinction counterfactuals differ when Non-Ridge extinction is positive',
);

console.log('volume shared transmittance optical layer contracts passed');
