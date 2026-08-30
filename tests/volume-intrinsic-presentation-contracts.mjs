import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const selectiveWrapper = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');

const targetIdentity = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is present`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

assert.match(
  core,
  new RegExp(`INTRINSIC_PRESENTATION_TARGET_IDENTITY\\s*=\\s*'${targetIdentity}'`),
  'Intrinsic declares the exact supervision target identity',
);

assert.match(
  index,
  /role="group"[^>]+aria-label="Volume presentation"[\s\S]*data-volume-presentation-mode="beauty"[\s\S]*data-volume-presentation-mode="intrinsic"/,
  'operator renderer exposes a top-level Beauty and Intrinsic segmented control',
);
assert.match(index, /id="volume-presentation-effective"/, 'operator surface exposes effective presentation mode');
assert.match(index, /id="volume-presentation-ray-quality"/, 'operator surface exposes effective ray quality');
assert.match(
  index,
  /role="group"[^>]+aria-label="Raymarch smoke presentation"[\s\S]*data-raymarch-smoke-presentation="on"[\s\S]*data-raymarch-smoke-presentation="off"/,
  'native operator surface exposes a top-level Raymarch Smoke On/Off presentation control',
);
assert.match(
  selectiveWrapper,
  /aria-label="Raymarch smoke presentation"[\s\S]*data-smoke-presentation="on"[\s\S]*data-smoke-presentation="off"/,
  'selective wrapper exposes the same top-level smoke presentation axis',
);

const normalizeMode = functionSource(core, 'normalizeVolumePresentationMode');
assert.match(normalizeMode, /requestedRaw[\s\S]*requested[\s\S]*fallbackReason/, 'mode normalization preserves requested identity and fallback');
assert.match(normalizeMode, /intrinsic[\s\S]*beauty/, 'mode normalization accepts only Beauty and Intrinsic');

const presentationOverrides = functionSource(core, 'boundarySplatIntrinsicPresentationOverrides');
for (const contract of [
  /boundarySplatMode:\s*'off'/,
  /boundarySplatFeatureCapture:\s*false/,
  /volumeResidualMode:\s*'off'/,
  /fireRenderMode:\s*'stock'/,
  /shellInspectMode:\s*'boundary_fire'/,
]) {
  assert.match(presentationOverrides, contract, `Intrinsic capture-parity override is explicit: ${contract}`);
}
assert.match(
  presentationOverrides,
  /raySteps:\s*controls\.raySteps[\s\S]*adaptiveRays:\s*controls\.adaptiveRays[\s\S]*renderScale:\s*controls\.renderScale/,
  'Intrinsic preserves authored/effective ray quality instead of silently replacing it',
);

const setMode = functionSource(core, 'setVolumePresentationMode');
assert.doesNotMatch(setMode, /controlsSnapshot\s*=/, 'presentation switching does not mutate authored controls');
assert.doesNotMatch(setMode, /resetTemporalHistory|rebuildFluidState|encodeSim/, 'presentation switching does not reset or advance simulation');
const setSmokePresentation = functionSource(core, 'setRaymarchSmokePresentationMode');
assert.match(setSmokePresentation, /requestedMode[\s\S]*effectiveMode[\s\S]*fallbackReason[\s\S]*targetIdentity/, 'smoke presentation has failure-loud requested/effective identity');
assert.match(setSmokePresentation, /authoredSmokeControlMutated:\s*false[\s\S]*simulationAdvanced:\s*false[\s\S]*cameraMutated:\s*false/, 'smoke presentation receipt names its no-mutation contract');
assert.doesNotMatch(setSmokePresentation, /controlsSnapshot\s*=|resetTemporalHistory|rebuildFluidState|encodeSim/, 'smoke presentation does not mutate basin controls, reset, or advance simulation');
assert.match(
  core,
  /raymarchSmokeSuppressed[\s\S]*visibleSmokeAlpha[\s\S]*smokeAlpha \* \(1\.0 - raymarchSmokeSuppressed\)/,
  'shader derives a presentation-only visible smoke carrier without changing simulated smoke',
);
assert.match(core, /uniforms\[306\]\s*=\s*raymarchSmokePresentationEffectiveMode\(\) === 'off' \? 1 : 0/, 'smoke presentation is encoded through its own render uniform');
assert.match(core, /if \(volumePresentationModeEffective !== 'intrinsic' && raymarchSmokePresentationEffectiveMode\(\) === 'on'\) encodeHistoryCopy/, 'smoke-off pixels cannot contaminate preserved smoke-on history');
assert.match(setMode, /requestedMode[\s\S]*effectiveMode[\s\S]*fallbackReason[\s\S]*targetIdentity[\s\S]*effectiveRayQuality/, 'mode switch returns an honest effective receipt');

assert.match(core, /supervisionFireOnlyTarget\s*=\s*clamp\(u\.boundary_fire_display\.y/, 'raymarch shader reads the exact intrinsic target gate');
assert.match(core, /visibleSmokeAlpha\s*=\s*smokeAlpha\s*\*\s*\(1\.0\s*-\s*raymarchSmokeSuppressed\)\s*\*\s*\(1\.0\s*-\s*supervisionFireOnlyTarget\)/, 'Intrinsic suppresses smoke contribution through the shared presentation carrier');
assert.match(core, /directFlameUnitEmission\s*=\s*fireRadianceEmission\([^;]+1\.0,\s*0\.0\)/s, 'Intrinsic uses unit-gain direct-flame emission');
assert.match(core, /directFlameCandidateStructuralSignal[\s\S]*directFlameCandidateSupport[\s\S]*step\(0\.11,\s*directFlameCandidateStructuralSignal\)/, 'Intrinsic uses the candidate-support gate');
assert.match(core, /directFlameCandidateAlpha\s*=\s*clamp\(directFlameCandidateSupport\s*\*\s*rayStepOpacity\s*\*\s*0\.55/, 'Intrinsic uses fixed candidate alpha');
assert.match(core, /directFlameSupervisionExtinction\s*=\s*clamp\(directFlameCandidateAlpha\s*\*\s*0\.54/, 'Intrinsic uses fixed direct-flame extinction');
assert.match(core, /INTRINSIC_PRESENTATION_TARGET_IDENTITY[\s\S]*boundarySplatIntrinsicPresentationOverrides/, 'presentation receipt and override contract share the exact target identity');

assert.match(core, /function boundarySplatRequested\(\)[\s\S]*volumePresentationModeEffective !== 'intrinsic'/, 'Intrinsic prevents splat encoding without changing the authored splat control');
assert.match(core, /function browserResidualCanApply\(\)[\s\S]*volumePresentationModeEffective !== 'intrinsic'/, 'Intrinsic prevents residual application without changing the authored residual control');
assert.match(core, /uniforms\[305\]\s*=\s*volumePresentationModeEffective === 'intrinsic'\s*\?\s*1\s*:\s*0/, 'Intrinsic activates the exact shader branch through the reserved uniform');
assert.match(
  core,
  /temporalAccumulationForPresentation\s*=\s*\([\s\S]*volumePresentationModeEffective === 'intrinsic'[\s\S]*raymarchSmokePresentationEffectiveMode\(\) === 'off'[\s\S]*\? 0 : uniforms\[44\][\s\S]*uniforms\[44\]\s*=\s*temporalAccumulationForPresentation/,
  'Intrinsic cannot inherit Beauty temporal radiance after a presentation-only switch',
);
assert.match(
  core,
  /if \(volumePresentationModeEffective !== 'intrinsic' && raymarchSmokePresentationEffectiveMode\(\) === 'on'\) encodeHistoryCopy\(encoder, currentTexture\)/,
  'Intrinsic cannot overwrite the preserved Beauty history used on restoration',
);
assert.match(
  core,
  /finally \{[\s\S]*if \(!selectiveHeadLiveCapturePaused && state\.active\) raf = requestAnimationFrame\(render\)/,
  'the live render loop re-checks capture pause before scheduling its successor',
);
assert.doesNotMatch(
  functionSource(core, 'render'),
  /if \(selectiveHeadLiveCapturePaused\)[\s\S]*raf = requestAnimationFrame\(render\)[\s\S]*try \{/,
  'the live render loop cannot pre-schedule a frame that escapes a concurrent pause request',
);
const sampleFrame = functionSource(core, 'sampleFrame');
assert.match(
  sampleFrame,
  /volumePresentationReceipt:\s*state\.volumePresentationReceipt[\s\S]*selectiveHeadLivePassReceipt:\s*state\.selectiveHeadLivePassReceipt/,
  'sampled pixels carry the effective presentation and applied composition receipts',
);
assert.match(
  sampleFrame,
  /advanceSim\s*\?\s*await sampleBoundarySplatGpuProfile\(\)[\s\S]*frozen-sample-profile-suppressed-no-sim-advance/,
  'render-only sampling cannot run the timestamp profiler that advances simulation',
);
assert.match(
  core,
  /function recordVolumePresentationApplication\([\s\S]*raymarchEncoded[\s\S]*raymarchApplied[\s\S]*splatsEncoded[\s\S]*splatsApplied[\s\S]*residualEncoded[\s\S]*residualApplied[\s\S]*featureCaptureEncoded[\s\S]*featureCaptureApplied/,
  'presentation receipts distinguish declared passes from encoded and applied passes',
);

assert.match(
  index,
  /setVolumePresentationMode\?\.\(button\.dataset\.volumePresentationMode\)[\s\S]*syncVolumePresentationControls/,
  'presentation buttons call the presentation-only runtime API and synchronize requested/effective UI',
);
assert.match(index, /params\.get\('volume_presentation'\)/, 'Intrinsic can be requested by an explicit direct route');
assert.match(index, /params\.get\('volume_raymarch_smoke'\)/, 'raymarch smoke presentation can be requested by an explicit direct route');
assert.match(
  selectiveWrapper,
  /requestedRaymarchSmokePresentationRaw[\s\S]*unsupported-raymarch-smoke-presentation-mode/,
  'wrapper direct routes fail loud instead of normalizing an unsupported smoke presentation to On',
);
assert.match(
  index,
  /setVolumePresentationMode\?\.\(requestedVolumePresentation\)[\s\S]*__kaminosVolumePresentationReceipt/,
  'direct-route admission publishes the requested/effective presentation receipt',
);
assert.doesNotMatch(
  index,
  /data-volume-presentation-mode[^\n]+(?:input|select|textarea)/,
  'presentation state cannot enter the 189-control settings preset',
);
assert.match(
  selectiveWrapper,
  /aria-label="Volume presentation"[\s\S]*data-presentation="beauty"[\s\S]*data-presentation="intrinsic"/,
  'the selective-head operator wrapper exposes top-level Beauty and Intrinsic controls',
);
assert.match(
  selectiveWrapper,
  /requestedPresentation[\s\S]*setVolumePresentationMode[\s\S]*effectivePresentation[\s\S]*volumePresentationReceipt/,
  'the wrapper proxies presentation-only switching and reports requested/effective identity',
);
assert.match(
  selectiveWrapper,
  /const appliedPass = state\.volumePresentationReceipt\?\.application \|\| state\.selectiveHeadLivePassReceipt \|\| \{\}/,
  'operator pass status reports the presentation application that produced current pixels',
);
assert.match(
  selectiveWrapper,
  /function syncSubordinateControlAvailability\(\)[\s\S]*requestedPresentation !== 'beauty'[\s\S]*button\.disabled = disabled[\s\S]*aria-disabled/,
  'Intrinsic visibly disables Beauty-only Splats and Smoke controls',
);
assert.match(
  selectiveWrapper,
  /function setComposition\(composition\)[\s\S]*requestedPresentation !== 'beauty'[\s\S]*composition-controls-disabled-during-intrinsic[\s\S]*requestedComposition = composition/,
  'Intrinsic composition clicks fail explicitly before mutating remembered Beauty composition',
);
assert.match(
  selectiveWrapper,
  /function setPresentation\(presentation\)[\s\S]*setVolumePresentationMode[\s\S]*presentation === 'beauty'[\s\S]*applyRequestedBeautyComposition\(\)/,
  'returning to Beauty explicitly reapplies the remembered Beauty composition',
);
assert.match(
  selectiveWrapper,
  /function setRaymarchSmokePresentation\(mode, \{ preserveDiagnostic = false \} = \{\}\)[\s\S]*setRaymarchSmokePresentationMode[\s\S]*requestedRaymarchSmokePresentation[\s\S]*effectiveRaymarchSmokePresentation/,
  'wrapper proxies the independent requested/effective smoke presentation identity',
);
assert.match(
  core,
  /setSelectiveHeadLiveRenderComposition\(composition\)[\s\S]*previousComposition[\s\S]*compositionChanged[\s\S]*if \(compositionChanged\) resetTemporalHistory/,
  'idempotent Beauty composition reapplication does not reset temporal history',
);

console.log('volume intrinsic presentation contracts passed');
