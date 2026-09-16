#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapper = readFileSync(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../volume-selective-head-live-witness.mjs', import.meta.url), 'utf8');
const sequenceWitness = readFileSync(new URL('../volume-selective-head-live-sequence-witness.mjs', import.meta.url), 'utf8');
const {
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetVisualTarget,
} = await import('../volume-settings-preset-contract.mjs');

assert.match(
  wrapper,
  /id="appearance-assay-enabled"[^>]*data-assay-enabled[^>]*aria-pressed=/,
  'appearance assay has an explicit On/Off toggle separate from its remembered selection',
);
assert.match(
  wrapper,
  /<select id="appearance-assay"[\s\S]*?<option value="structural-a"[\s\S]*?<\/select>/,
  'Optical View remains a compact assay-selection menu',
);
assert.doesNotMatch(
  wrapper,
  /<option value="off"[^>]*data-appearance-assay="off"/,
  'Assay Off cannot impersonate an optical diagnostic identity inside the selection menu',
);
assert.match(
  wrapper,
  /id="splats-enabled"[^>]*data-splats-enabled[^>]*aria-pressed=/,
  'ordinary Beauty rendering has an explicit Splats On/Off toggle',
);
assert.doesNotMatch(
  wrapper,
  /<select id="compositions"|for="compositions">Renderer/,
  'the compact cockpit does not expose the legacy renderer identity dropdown',
);

assert.match(
  wrapper,
  /function deriveRequestedBeautyComposition\(\)[\s\S]*requestedSplatsEnabled[\s\S]*requestedRaymarchSmokePresentation === 'on'[\s\S]*'smoke-raymarch-under-splats-v0'[\s\S]*'splat-only-v0'[\s\S]*'raymarch-only-v0'/,
  'Splats and Smoke derive the ordinary Beauty composition without ambiguous full-fire duplication',
);
assert.match(
  wrapper,
  /function setSplatsEnabled\(enabled\)[\s\S]*requestedSplatsEnabled[\s\S]*applyRequestedBeautyComposition/,
  'the Splats toggle changes requested state through the composition authority function',
);
assert.match(
  wrapper,
  /function setRaymarchSmokePresentation\(mode, \{ preserveDiagnostic = false \} = \{\}\)[\s\S]*applyRequestedBeautyComposition/,
  'the Smoke toggle recomputes the hybrid identity when splats are requested',
);
assert.match(
  wrapper,
  /function setAppearanceAssaySelection\(mode\)[\s\S]*requestedAppearanceAssaySelection[\s\S]*requestedAppearanceAssayEnabled[\s\S]*applyAppearanceAssayState/,
  'Optical View selection is remembered while Assay is off and applied immediately while it is on',
);
assert.match(
  wrapper,
  /function setAppearanceAssayEnabled\(enabled\)[\s\S]*requestedAppearanceAssayEnabled[\s\S]*applyAppearanceAssayState/,
  'Assay enablement is an explicit authority axis',
);
assert.match(
  wrapper,
  /function setAppearanceAssay\(mode\)[\s\S]*mode === 'off'[\s\S]*setAppearanceAssayEnabled\(false\)[\s\S]*setAppearanceAssaySelection\(mode\)[\s\S]*setAppearanceAssayEnabled\(true\)/,
  'legacy assay API calls map honestly onto selection plus enablement',
);
assert.match(
  wrapper,
  /function syncSubordinateControlAvailability\(\)[\s\S]*requestedAppearanceAssayEnabled[\s\S]*requestedPresentation !== 'beauty'[\s\S]*splatsEnabledButton\.disabled[\s\S]*smokePresentationButtons/,
  'Assay and Intrinsic visibly override subordinate Splats and Smoke controls',
);
assert.match(
  wrapper,
  /requestedSplatsEnabled[\s\S]*effectiveSplatsApplied[\s\S]*compositionOverrideReason/,
  'operator receipts distinguish requested splats, applied splats, and the override reason',
);
assert.match(
  wrapper,
  /full-raymarch-under-splats-diagnostic-v0[\s\S]*legacyDiagnosticCompositionRequested/,
  'explicit legacy full-fire hybrid routes remain diagnosable but outside ordinary toggle derivation',
);
assert.doesNotMatch(
  wrapper.match(/function setComposition\(composition\)[\s\S]*?(?=\n    function setPresentation)/)?.[0] || '',
  /requestedRaymarchSmokePresentation\s*=|setRaymarchSmokePresentationMode/,
  'legacy composition calls do not mutate the independent requested Smoke axis',
);
assert.match(
  wrapper,
  /function setRaymarchSmokePresentation\(mode, \{ preserveDiagnostic = false \} = \{\}\)[\s\S]*if \(!preserveDiagnostic\) legacyDiagnosticCompositionRequested = false[\s\S]*setRaymarchSmokePresentation\(requestedRaymarchSmokePresentation, \{ preserveDiagnostic: true \}\)/,
  'initialization preserves an explicitly routed diagnostic while operator Smoke actions return to ordinary composition derivation',
);

assert.match(
  page,
  /<option value="kernel_moment_full_flame_union">ridge \+ fire-active union<\/option>/,
  'the current union label describes candidate admission without claiming complete optical support',
);
assert.doesNotMatch(page, />kernel moment full flame union<|\? 'full flame union'/, 'the misleading Full Flame union display label is gone');

const presetReceipt = {
  presetId: `vsp-${'a'.repeat(64)}`,
  sourcePresetAuthority: 'shared-volume-settings-preset-v2',
  routeVolumeEntries: [['volume_scene', 'tall_plume']],
};
const splatTarget = buildVolumeSettingsPresetVisualTarget(presetReceipt, 'http://127.0.0.1:18781', 'splat-only');
assert.equal(splatTarget.searchParams.get('volume_raymarch_smoke'), 'off', 'generated splat-only targets cannot contradict themselves with Smoke On');
splatTarget.searchParams.set('volume_appearance_selection', 'ridge-owned-emission');
assert.equal(validateVolumeSettingsPresetVisualTarget(presetReceipt, splatTarget.searchParams), true, 'remembered Optical View selection survives preset-route reload');
const invalidSelectionTarget = new URL(splatTarget);
invalidSelectionTarget.searchParams.set('volume_appearance_selection', 'off');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(presetReceipt, invalidSelectionTarget.searchParams),
  /appearance decomposition selection/,
  'a forged remembered Optical View selection fails loud',
);
const contradictorySplatTarget = new URL(splatTarget);
contradictorySplatTarget.searchParams.set('volume_raymarch_smoke', 'on');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(presetReceipt, contradictorySplatTarget.searchParams),
  /composition.*smoke|smoke.*composition/i,
  'a visual target cannot validate as splat-only while requesting Smoke On',
);
const smokeHybridTarget = buildVolumeSettingsPresetVisualTarget(presetReceipt, 'http://127.0.0.1:18781', 'smoke-hybrid');
smokeHybridTarget.searchParams.set('volume_raymarch_smoke', 'off');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(presetReceipt, smokeHybridTarget.searchParams),
  /composition.*smoke|smoke.*composition/i,
  'a visual target cannot validate as smoke-hybrid while requesting Smoke Off',
);
const conflictingActiveAssayTarget = new URL(splatTarget);
conflictingActiveAssayTarget.searchParams.set('volume_appearance_decomposition', 'structural-a');
conflictingActiveAssayTarget.searchParams.set('volume_appearance_selection', 'ridge-owned-emission');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(presetReceipt, conflictingActiveAssayTarget.searchParams),
  /active.*appearance.*selection|selection.*active.*appearance/i,
  'an active assay cannot validate with a different remembered Optical View selection',
);
conflictingActiveAssayTarget.searchParams.set('volume_appearance_selection', 'structural-a');
assert.equal(
  validateVolumeSettingsPresetVisualTarget(presetReceipt, conflictingActiveAssayTarget.searchParams),
  true,
  'matching active and remembered assay identities remain valid',
);

for (const witness of [liveWitness, sequenceWitness]) {
  assert.match(witness, /function expectedCompositionFromAxes\([\s\S]*volume_raymarch_smoke[\s\S]*splat-only-v0[\s\S]*smoke-raymarch-under-splats-v0/, 'witness derives expected composition from the compact Smoke axis');
  assert.match(witness, /compositionOverrideReason[\s\S]*unexpected-composition-override/, 'witness rejects Assay or Intrinsic pixels masquerading as a Beauty composition');
}

console.log('volume cockpit authority toggle contracts passed');
