import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const wrapper = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const presetContract = readFileSync(join(root, 'volume-settings-preset-contract.mjs'), 'utf8');
const witness = readFileSync(join(root, 'volume-raymarch-filament-orbit-witness.mjs'), 'utf8');

const transportModes = [
  ['ridge-transport-ridge-extinction', 'ridge-owned', 'ridge-owned'],
  ['ridge-transport-total-extinction', 'ridge-owned', 'complete-flame'],
  ['non-ridge-transport-total-extinction', 'non-ridge', 'complete-flame'],
  ['shared-transmittance-contribution-sum', 'ridge-owned-plus-non-ridge', 'complete-flame'],
];

for (const [mode, emissionMask, extinctionMask] of transportModes) {
  assert.match(core, new RegExp(`['"]${mode}['"]\\s*:\\s*\\{[^}]*emissionMask:\\s*['"]${emissionMask}['"][^}]*extinctionMask:\\s*['"]${extinctionMask}['"]`), `${mode} declares exact coefficient masks`);
  assert.match(wrapper, new RegExp(`data-appearance-assay=['"]${mode}['"]`), `operator exposes ${mode}`);
  assert.match(presetContract, new RegExp(`['"]${mode}['"]`), `preset contract admits ${mode}`);
}

assert.match(core, /ridgeOnlyTransportColor\s*=\s*ridgeOnlyTransportColor\s*\+\s*ridgeOnlyTransportTransmittance\s*\*\s*ridgeOwnedEmissionCoefficient/, 'Ridge-only mode transports fixed Ridge emission');
assert.match(core, /ridgeOnlyTransportTransmittance\s*=\s*ridgeOnlyTransportTransmittance\s*\*\s*exp\(-ridgeOwnedExtinctionCoefficient\)/, 'Ridge-only mode uses Ridge extinction only');
assert.match(core, /ridgeSharedTransportColor\s*=\s*ridgeSharedTransportColor\s*\+\s*sharedFlameTransmittance\s*\*\s*ridgeOwnedEmissionCoefficient/, 'shared mode transports the same Ridge emission');
assert.match(core, /nonRidgeSharedTransportColor\s*=\s*nonRidgeSharedTransportColor\s*\+\s*sharedFlameTransmittance\s*\*\s*nonRidgeEmissionCoefficient/, 'shared mode separately transports Non-Ridge emission');
assert.match(core, /sharedFlameTransmittance\s*=\s*sharedFlameTransmittance\s*\*\s*exp\(-positiveRecomposedExtinctionCoefficient\)/, 'both contribution channels use one total transmittance');
assert.match(core, /sharedContributionColor\s*=\s*ridgeSharedTransportColor\s*\+\s*nonRidgeSharedTransportColor/, 'contribution channels recompose before tone mapping');
assert.match(core, /appearanceDecompositionMode\s*>\s*12\.5\s*&&\s*appearanceDecompositionMode\s*<\s*13\.5[\s\S]*trans\s*=\s*ridgeOnlyTransportTransmittance/, 'Ridge-only traversal terminates against Ridge extinction rather than leaked total extinction');
assert.match(core, /appearanceDecompositionMode\s*>\s*13\.5[\s\S]*trans\s*=\s*sharedFlameTransmittance/, 'shared-transport traversal terminates against total extinction');
assert.match(core, /emissionMask:\s*modeContract\.emissionMask/, 'receipt records the effective emission mask');
assert.match(core, /extinctionMask:\s*modeContract\.extinctionMask/, 'receipt records the effective extinction mask');
assert.match(core, /sharedTransmittanceIdentity:\s*'ridge-plus-non-ridge-extinction-one-running-transmittance-v0'/, 'receipt names shared transmittance authority');
assert.match(witness, /ridgeTransportRidgeExtinction/, 'witness captures Ridge emission under Ridge-only extinction');
assert.match(witness, /ridgeTransportTotalExtinction/, 'witness captures the same Ridge emission under total extinction');
assert.match(witness, /nonRidgeTransportTotalExtinction/, 'witness captures Non-Ridge emission under total extinction');
assert.match(witness, /sharedTransmittanceContributionSum/, 'witness captures pre-tone-map shared contribution recomposition');
assert.match(witness, /analyzeCrossExtinction/, 'witness computes the cross-extinction causal comparison');
assert.match(witness, /expectedTransportMasks/, 'witness rejects effective emission or extinction mask substitution');
assert.match(witness, /sharedRecompositionPixelDelta/, 'witness reports shared-contribution recomposition error');
assert.match(witness, /crossExtinctionResidualReduction/, 'witness reports improvement against the fixed world-covariance reconstruction');
assert.match(witness, /replayAuthority:\s*\{[\s\S]*warmupAuthority:\s*wrapperBefore\.warmupAuthority[\s\S]*warmupReceipt:\s*wrapperBefore\.warmupReceipt/, 'completed report preserves effective checksum-anchor replay authority');
assert.match(witness, /expectedWarmupAuthority[\s\S]*initialization\.summary\.replayAuthority\.warmupAuthority/, 'witness rejects replay-authority substitution');
assert.match(witness, /expectedWarmupTarget[\s\S]*initialization\.summary\.replayAuthority\.warmupReceipt\?\.completedSteps/, 'witness rejects replay-step substitution');
assert.match(witness, /expectedAnchorFluidSha256[\s\S]*initialization\.summary\.replayAuthority\.warmupReceipt\?\.fluidSha256/, 'witness rejects replay fluid-anchor substitution');
assert.match(witness, /expectedAnchorFrontSha256[\s\S]*initialization\.summary\.replayAuthority\.warmupReceipt\?\.frontSha256/, 'witness rejects replay front-anchor substitution');
assert.match(wrapper, /freeze_after_warmup/, 'wrapper exposes an explicit witness-owned post-anchor freeze request');
assert.match(wrapper, /await prototype\(\)\.setActive\(true\);[\s\S]*setSelectiveHeadLiveCapturePaused\?\.\(true\)/, 'wrapper freezes in the same microtask that activates the imported anchor');
assert.match(wrapper, /frozenAnchorSettled[\s\S]*postWarmupFreezeReceipt\?\.paused[\s\S]*frameCount\s*===\s*warmupTarget[\s\S]*simStepCount\s*===\s*warmupTarget/, 'wrapper admits the exact frozen anchor without requiring a state-advancing presentation frame');
assert.match(witness, /route\.searchParams\.get\(['"]freeze_after_warmup['"]\)[\s\S]*['"]1['"]/, 'checksum-anchor bridge requires the exact post-warmup freeze request');
assert.match(witness, /postWarmupFreezeReceipt[\s\S]*paused/, 'completed replay authority preserves the effective post-warmup freeze receipt');
assert.match(witness, /lastTrustworthyEvidence\.routeAdmissionProbe\s*=\s*state/, 'route-admission polling preserves the last effective state before timeout');

console.log('volume ridge cross-extinction contracts passed');
