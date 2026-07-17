import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const wrapper = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const presetContract = readFileSync(join(root, 'volume-settings-preset-contract.mjs'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is present`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

const modes = [
  'structural-a',
  'broad-carrier-b',
  'b-applied-to-fixed-a',
  'a-plus-b-recomposition',
  'smoke-off-beauty-control',
];

for (const mode of modes) {
  assert.match(core, new RegExp(`['"]${mode}['"]`), `core declares ${mode}`);
  assert.match(wrapper, new RegExp(`data-appearance-assay=['"]${mode}['"]`), `wrapper exposes ${mode}`);
}
assert.match(wrapper, /data-assay-enabled[^>]*aria-pressed=['"]false['"]/, 'operator can explicitly leave the appearance assay without using a fake optical-view identity');

const normalize = functionSource(core, 'normalizeAppearanceDecompositionMode');
assert.match(normalize, /requestedRaw[\s\S]*requested[\s\S]*fallbackReason/, 'normalization preserves requested and effective identity');
assert.match(normalize, /unsupported-appearance-decomposition-mode/, 'unsupported modes fail loud');

const setMode = functionSource(core, 'setAppearanceDecompositionMode');
assert.match(setMode, /requestedMode[\s\S]*effectiveMode[\s\S]*fallbackReason[\s\S]*targetIdentity/, 'mode switch returns an honest requested/effective receipt');
assert.match(setMode, /simulationAdvanced:\s*false[\s\S]*simulationReset:\s*false[\s\S]*cameraMutated:\s*false/, 'assay switching preserves same-state authority');
assert.match(setMode, /splatsApplied:\s*false[\s\S]*residualApplied:\s*false[\s\S]*smokeApplied:\s*false/, 'assay receipt reports the exact suppressed passes');
assert.doesNotMatch(setMode, /controlsSnapshot\s*=|encodeSim|rebuildFluidState/, 'assay selection cannot mutate the basin or advance simulation');
assert.match(core, /function recordAppearanceDecompositionApplication\([\s\S]*raymarchEncoded[\s\S]*raymarchApplied[\s\S]*splatsEncoded[\s\S]*splatsApplied[\s\S]*residualEncoded[\s\S]*residualApplied/, 'assay records the passes actually encoded and applied to current pixels');
assert.match(core, /appearanceDecompositionReceipt[\s\S]*requestedPasses[\s\S]*application/, 'assay distinguishes requested passes from applied evidence');

assert.match(core, /uniforms\[307\]\s*=\s*appearanceDecompositionUniformMode\(\)/, 'assay has a dedicated shader uniform');
assert.match(core, /appearanceDecompositionMode\s*=\s*u\.boundary_fire_display\.w/, 'shader reads the assay identity before tone mapping');
assert.match(core, /appearanceAssayActive[\s\S]*effectiveRaymarchSmokeSuppressed/, 'every assay view suppresses rendered smoke');
assert.match(core, /appearanceAssayActive[\s\S]*directFlameCandidateStructuralSignal/, 'A support is evaluated in every assay view');

assert.match(core, /let structuralAEmissionCoefficient\s*=\s*directFlameCandidateAlpha\s*\*\s*directFlameUnitEmission/, 'A carries the exact unit-gain support-gated emission coefficient');
assert.match(core, /let structuralAExtinctionCoefficient\s*=\s*clamp\(directFlameCandidateAlpha\s*\*\s*0\.54/, 'A carries the exact fixed extinction coefficient');
assert.match(core, /let smokeOffBeautyEmissionCoefficient\s*=\s*standardRadianceContribution/, 'control exposes its local pre-tone-map emission coefficient');
assert.match(core, /let smokeOffBeautyExtinctionCoefficient\s*=\s*standardExtinctionStep/, 'control exposes its local extinction coefficient');
assert.match(core, /let broadCarrierEmissionCoefficient\s*=\s*smokeOffBeautyEmissionCoefficient\s*-\s*structuralAEmissionCoefficient/, 'B emission is the local signed residual, not a screenshot difference');
assert.match(core, /let broadCarrierExtinctionCoefficient\s*=\s*smokeOffBeautyExtinctionCoefficient\s*-\s*structuralAExtinctionCoefficient/, 'B extinction is the local signed residual');
assert.match(core, /let recomposedEmissionCoefficient\s*=\s*structuralAEmissionCoefficient\s*\+\s*broadCarrierEmissionCoefficient/, 'A+B emission is explicitly recomposed');
assert.match(core, /let recomposedExtinctionCoefficient\s*=\s*structuralAExtinctionCoefficient\s*\+\s*broadCarrierExtinctionCoefficient/, 'A+B extinction is explicitly recomposed');
assert.match(core, /recomposedTransmittance\s*=\s*recomposedTransmittance\s*\*\s*exp\(-recomposedExtinctionCoefficient\)/, 'A+B uses the real nonlinear transmittance recurrence');
assert.match(core, /controlTransmittance\s*=\s*controlTransmittance\s*\*\s*exp\(-smokeOffBeautyExtinctionCoefficient\)/, 'control uses an independently accumulated optical recurrence');
assert.match(core, /bAppliedToFixedAColor\s*=\s*recomposedColor\s*-\s*structuralAColor/, 'B-on-fixed-A is derived before tone mapping from transported HDR fields');

const assayShaderBoundary = core.slice(core.indexOf('let appearanceDecompositionMode'), core.indexOf('let exposed ='));
assert.doesNotMatch(assayShaderBoundary, /textureLoad\([^\n]*current|readPixels|getImageData|toneMap/i, 'decomposition does not use framebuffer or post-tone-map subtraction');

assert.match(index, /params\.get\('volume_appearance_decomposition'\)/, 'native route admits an explicit assay identity');
assert.match(presetContract, /requestedAppearanceDecompositionModes[\s\S]*volume_appearance_decomposition[\s\S]*unsupported[^\n]*appearance decomposition/, 'preset routes admit only canonical target-only assay identities');
assert.match(presetContract, /key !== 'volume_appearance_decomposition'/, 'target-only assay identity is excluded from the immutable preset control count');
assert.match(wrapper, /unsupported-appearance-decomposition-mode/, 'wrapper rejects unsupported assay substitution');
assert.match(wrapper, /requestedAppearanceAssay[\s\S]*effectiveAppearanceAssay[\s\S]*appearanceDecompositionReceipt/, 'wrapper reports requested and effective assay identity');
assert.match(wrapper, /function syncSubordinateControlAvailability\(\)[\s\S]*requestedAppearanceAssayEnabled[\s\S]*button\.disabled = disabled/, 'assay visibly disables subordinate controls whose passes it suppresses');
assert.match(wrapper, /function setComposition\(composition\)[\s\S]*requestedAppearanceAssayEnabled[\s\S]*composition-controls-disabled-during-appearance-assay/, 'assay composition calls fail before mutating remembered Beauty composition');

console.log('volume appearance decomposition contracts passed');
