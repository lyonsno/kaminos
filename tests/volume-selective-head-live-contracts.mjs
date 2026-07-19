#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const corePath = join(root, 'volume-core.js');
const runtimePath = join(root, 'selective-head-live-runtime.mjs');
const pagePath = join(root, 'volume-selective-head-live.html');
const witnessPath = join(root, 'volume-selective-head-live-witness.mjs');
const sequenceWitnessPath = join(root, 'volume-selective-head-live-sequence-witness.mjs');
const compositionWitnessPath = join(root, 'volume-selective-head-composition-witness.mjs');
const exporterPath = join(root, 'volume-selective-head-live-model-export.py');
const modelRoot = join(root, 'models', 'selective-head-live', 'exact-basin-160-to-128-v0');
const modelManifestPath = join(modelRoot, 'manifest.json');
const modelDataPath = join(modelRoot, 'model.f32');

assert.ok(existsSync(exporterPath), 'frozen selective-head model exporter exists');
assert.ok(existsSync(modelManifestPath), 'checksum-bound browser model manifest exists');
assert.ok(existsSync(modelDataPath), 'packed frozen browser model exists');
assert.ok(existsSync(pagePath), 'operator-clickable selective-head live page exists');
assert.ok(existsSync(witnessPath), 'continuous live route witness exists');
assert.ok(existsSync(sequenceWitnessPath), 'frame-locked continuous sequence witness exists');
assert.ok(existsSync(compositionWitnessPath), 'same-state renderer-composition witness exists');
assert.ok(existsSync(runtimePath), 'WebGPU selective-head live runtime exists');

const model = JSON.parse(readFileSync(modelManifestPath, 'utf8'));
assert.equal(model.schema, 'kaminos.volume.selective-head-live-model.v0');
assert.equal(model.identity, 'exact-basin-selective-carrier-heads-160-to-128-v0');
assert.equal(model.source.lowGrid, 128);
assert.equal(model.source.highGrid, 160);
assert.equal(model.features.identity, 'full-low-field-plus-spatial-rbf-features-v0');
assert.equal(model.features.featureCount, 185);
assert.equal(model.features.lowFieldCount, 17);
assert.equal(model.features.squaredLowFieldCount, 17);
assert.equal(model.features.positionCount, 5);
assert.equal(model.features.fourierCount, 18);
assert.equal(model.features.rbfCount, 128);
assert.equal(model.architecture.activation, 'tanh');
assert.equal(model.architecture.hiddenWidth, 48);
assert.deepEqual(model.outputs.map(output => output.channel), [
  'supportProbability',
  'fuel',
  'fireLick',
  'visibleFireCarrier',
  'frontTopology',
]);
assert.equal(model.composition.supportThreshold, 0.98);
assert.equal(model.composition.frontTopology, 'dense-ungated-residual-v0');
assert.equal(model.composition.fuel, 'sparse-hard-support-gated-residual-v0');
assert.equal(model.packed.dtype, 'float32-le');
assert.equal(model.packed.byteLength, readFileSync(modelDataPath).byteLength);
assert.match(model.packed.sha256, /^[a-f0-9]{64}$/);

const core = `${readFileSync(corePath, 'utf8')}\n${readFileSync(runtimePath, 'utf8')}`;
assert.match(core, /exact-basin-selective-head-live-v0/, 'core names the exact live route');
assert.match(core, /box-average-linear-field-v0/, 'live route preserves the phase-aligned fluid downsample operator');
assert.match(core, /max-pool-support-field-v0/, 'live route preserves the phase-aligned front downsample operator');
assert.match(core, /full-low-field-plus-spatial-rbf-features-v0/, 'live route reports exact feature authority');
assert.match(core, /downsampled-same-high-history-input-to-exact-high-target/, 'live route reports same-high-history input authority');
assert.match(core, /selectiveHeadLiveRole/, 'live route exposes explicit truth, low-control, and learned roles');
assert.match(core, /selectiveHeadLiveModelIdentity/, 'live debug state exposes frozen model identity');
assert.match(core, /selectiveHeadLiveEffectiveRole/, 'live debug state distinguishes requested from effective role');
assert.match(core, /current-high-field-reference-no-learned-composition-v0/, 'truthHigh names its intentional learned-composition bypass authority');
assert.match(core, /phase-aligned-low-field-control-v0/, 'lowPhaseAligned names its control authority');
assert.match(core, /learned-selective-full-residual-composition-v0/, 'selectiveFullResidual names its learned composition authority');
assert.match(core, /if \(requestedRole === 'truthHigh'\) \{[\s\S]*selectiveHeadLiveRoleAuthority[\s\S]*return false;[\s\S]*selectiveHeadLiveRuntime\.encode/, 'truthHigh bypasses learned inference explicitly before the learned composition path');
assert.match(core, /selectiveHeadLiveFallbackReason/, 'live route fails loud when exact inference cannot apply');
assert.match(core, /encodeSelectiveHeadLiveFields/, 'live frame derives low and learned fields before rendering');
assert.match(core, /sampleSelectiveHeadLiveFields/, 'frame-locked samples derive the learned fields on each controlled simulation step');
assert.match(core, /SELECTIVE_HEAD_LIVE_DEFAULT_RENDER_COMPOSITION\s*=\s*'smoke-raymarch-under-splats-v0'/, 'selective live defaults to smoke raymarch under splat fire instead of duplicate full-fire hybrid');
assert.match(core, /splat-only-v0/, 'selective live exposes splat-only attribution composition');
assert.match(core, /raymarch-only-v0/, 'selective live exposes raymarch-only diagnostic composition');
assert.match(core, /full-raymarch-under-splats-diagnostic-v0/, 'selective live preserves the old full hybrid as an explicit diagnostic');
assert.match(core, /selectiveHeadLiveCompositionRequested/, 'live debug state records requested renderer composition');
assert.match(core, /selectiveHeadLiveCompositionEffective/, 'live debug state records effective renderer composition');
assert.match(core, /selectiveHeadLiveCompositionFallbackReason/, 'live route fails loud when renderer composition substitutes or falls back');
assert.match(core, /selectiveHeadLivePassReceipt/, 'frame-locked samples preserve exact raymarch/splat pass receipts');
assert.match(core, /selectiveRaymarchFireAuthority/, 'smoke-hybrid raymarch suppresses fire authority without changing simulation state');
assert.match(core, /selective-head-live-lean-frame-readback-v0/, 'movie capture avoids unrelated full-grid telemetry readbacks');
assert.match(core, /loadSelectiveHeadLiveReplayAnchor/, 'live route can load the checksum-bound exact training-horizon fields');
assert.match(core, /setSelectiveHeadLiveCapturePaused/, 'live route exposes witness-owned pause and single-step release control');
assert.match(core, /stepSelectiveHeadLiveCaptureFrame/, 'live route admits exactly one paused render and waits for GPU completion');
assert.match(core, /checksum-bound-exact-basin-step96-field-anchor-v0/, 'live route reports exact field-anchor authority');
assert.match(core, /SELECTIVE_HEAD_LIVE_MODEL_URL/, 'live route loads the checksum-bound packed model');

const page = readFileSync(pagePath, 'utf8');
assert.match(page, /Truth high/);
assert.match(page, /Low phase-aligned control/);
assert.match(page, /Selective full residual/);
assert.match(page, /Continuous same-history live assay/);
assert.match(page, /window\.__kaminosSelectiveHeadLive/);
assert.match(page, /setCapturePaused/, 'operator page relays the frame-lock pause handshake');
assert.match(page, /stepCaptureFrame/, 'operator page relays renderer-internal single-step capture');
assert.match(page, /data-splats-enabled/, 'operator page exposes ordinary splat authority explicitly');
assert.match(page, /data-smoke-presentation="on"[\s\S]*data-smoke-presentation="off"/, 'operator page exposes raymarch smoke authority explicitly');
assert.match(page, /function deriveRequestedBeautyComposition\(\)[\s\S]*smoke-raymarch-under-splats-v0[\s\S]*splat-only-v0[\s\S]*raymarch-only-v0/, 'operator page derives ordinary composition from Splats and Smoke');
assert.doesNotMatch(page, /data-composition="full-raymarch-under-splats-diagnostic-v0"/, 'old full hybrid is absent from the compact operator controls');
assert.match(page, /legacyDiagnosticCompositionRequested/, 'explicit diagnostic routes remain compatible beneath the compact controls');
assert.match(page, /setSelectiveHeadLiveRenderComposition/, 'operator page relays renderer-composition changes to the volume runtime');
assert.match(page, /model identity/i);
assert.match(page, /effective role/i);
assert.match(page, /role authority/i);
assert.match(page, /effective composition/i);
assert.match(page, /composition authority/i);
assert.match(page, /pass receipt/i);
assert.match(page, /fallback/i);
assert.match(page, /checksum-bound-exact-basin-step96-field-anchor-v0/, 'page names the exact replay-anchor authority');
assert.match(page, /d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1/, 'page pins the exact high fluid checksum');
assert.match(page, /1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8/, 'page pins the exact high front checksum');
assert.match(page, /warmupTarget/, 'page exposes the requested replay horizon');
assert.match(page, /warmupComplete/, 'page distinguishes warmup from learned execution');
assert.match(page, /SELECTIVE_HEAD_LIVE_BASIN_PARAM_OVERRIDES/, 'page names the allowlisted basin param forwarding surface');
assert.match(page, /volume_reaction_boundary_support_front/, 'page can forward support/front audit controls into the inner basin route');
assert.match(page, /basinQuery\.set\(key, value\)/, 'page forwards selected outer URL params into the inner basin query');
assert.match(page, /capture_paused/, 'page exposes a capture-paused start route for exact frozen-state comparison');
assert.match(page, /setSelectiveHeadLiveCapturePaused\(true\)/, 'page can pause the live route before activating the render loop');
assert.match(page, /effectiveBasinControls/, 'page exposes effective inner-basin control receipts for audit comparisons');
assert.match(page, /selective-head-live-effective-basin-controls-v0/, 'page names effective control receipt authority');
assert.match(page, /sourceStateIdentity/, 'page exposes a frozen source-state identity receipt');
assert.match(page, /canvasClip/, 'page exposes canvas-only screenshot geometry for visual witnesses');
assert.match(
  page,
  /for \(const \[key, value\] of params\)[\s\S]*if \(key\.startsWith\('volume_'\) \|\| key\.startsWith\('full_support_'\)\) basinQuery\.set\(key, value\)/,
  'selective-head wrapper passes explicitly routed basin settings into the native iframe instead of silently replacing them with its defaults',
);
assert.match(
  page,
  /kaminos_volume_smoke:\s*'1'[\s\S]*if \(key\.startsWith\('volume_'\) \|\| key\.startsWith\('full_support_'\)\) basinQuery\.set\(key, value\)/,
  'selective-head wrapper keeps its required inner smoke route active instead of accepting an outer route-gate override',
);
assert.match(
  page,
  /const warmupTarget = warmupParam === '0'\s*\?\s*0[\s\S]*fresh-live-settings-no-anchor-v0/,
  'only an explicit valid zero-step request reports that no checksum field anchor was imported',
);
assert.match(page, /sourceCaptureId:\s*params\.get\('basin_capture'\)/, 'selective-head wrapper records the durable source-capture id');
assert.match(page, /validateVolumeSettingsPresetVisualTarget[\s\S]*sourceSettingsPresetId:/, 'preset-backed visual routes independently validate and report settings-preset identity');
assert.match(page, /sourceSettingsPresetAuthority:/, 'preset-backed visual routes report derived preset authority separately from captures');
assert.match(page, /sourceSettingsPresetStorePath:/, 'preset-backed visual routes report the effective shared store path');
assert.match(page, /sourceSettingsPresetContentHash:/, 'preset-backed visual routes report immutable preset content identity');
assert.match(page, /capture: \$\{state\.sourceCaptureId/, 'operator status names the durable source capture that actually rendered');
assert.match(page, /presentationSettled[\s\S]*effectiveComposition === requestedComposition[\s\S]*rendererSettled[\s\S]*effectiveRole === requestedRole[\s\S]*presentationSettled[\s\S]*'running'[\s\S]*'settling'/, 'wrapper reports running only after the requested role and presentation-specific pass tuple become effective');
assert.match(page, /function passReceiptMatchesComposition\(/, 'wrapper has a named exact pass-tuple predicate');
assert.match(page, /splat-only-v0[\s\S]*splatApplied === true[\s\S]*raymarchApplied === false/, 'splat-only running requires splats applied and raymarch absent');
assert.match(page, /raymarch-only-v0[\s\S]*raymarchApplied === true[\s\S]*splatApplied === false/, 'raymarch-only running requires raymarch applied and splats absent');
assert.match(page, /smoke-raymarch-under-splats-v0[\s\S]*raymarchApplied === true[\s\S]*splatApplied === true/, 'hybrid running requires both passes applied');

const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos\.volume\.selective-head-live-witness\.v0/);
assert.match(witness, /exact-basin-selective-head-live-v0/);
assert.match(witness, /minimumContinuousSeconds/);
assert.match(witness, /continuousFrameDelta/);
assert.match(witness, /requestedRole/);
assert.match(witness, /effectiveRole/);
assert.match(witness, /expectedRoleAuthority/);
assert.match(witness, /expectedComposition/);
assert.match(witness, /PRESET_VIEW_COMPOSITIONS[\s\S]*raymarch-only[\s\S]*raymarch-only-v0/, 'continuous witness understands explicit raymarch-only preset loading');
assert.match(witness, /PRESET_VIEW_COMPOSITIONS[\s\S]*smoke-hybrid[\s\S]*smoke-raymarch-under-splats-v0/, 'continuous witness understands explicit smoke-hybrid preset loading');
assert.match(witness, /effectiveComposition/);
assert.match(witness, /composition drift/i);
assert.match(witness, /selectiveHeadLivePassReceipt/);
assert.match(witness, /isPresetLoader[\s\S]*requestedParams\.get\('view'\)[\s\S]*missing explicit preset renderer view/, 'visual witness rejects viewless loader evidence instead of inferring a composition');
assert.match(witness, /requestedPresetRef[\s\S]*get\('settings_preset'\)[\s\S]*get\('preset'\)/, 'visual witness derives source expectations from direct and loader-form preset references');
assert.match(witness, /resolveExpectedSettingsPreset[\s\S]*\/api\/volume-settings-preset/, 'visual witness independently resolves loader aliases to immutable preset identity');
assert.match(witness, /sourceSettingsPresetId[\s\S]*expectedSettingsPresetId/, 'visual witness rejects a loader that renders the wrong immutable preset');
assert.match(witness, /sourceSettingsPresetAuthority[\s\S]*shared-volume-settings-preset-v2/, 'visual witness rejects loader output without derived shared-store authority');
assert.match(witness, /roleAuthority/);
assert.match(witness, /fallbackReason/);
assert.match(witness, /failurePhase/);
assert.match(witness, /const timer = setTimeout[\s\S]*CDP call timed out/, 'visual witness bounds every CDP call');
assert.match(witness, /rejectPending[\s\S]*CDP socket closed/, 'visual witness rejects pending calls when CDP closes');
assert.match(witness, /sourceSettingsPresetId:\s*endState\.sourceSettingsPresetId/, 'visual witness promotes independently validated settings-preset identity into its report');
assert.match(witness, /sourceSettingsPresetAuthority:\s*endState\.sourceSettingsPresetAuthority/, 'visual witness promotes derived settings-preset authority into its report');
assert.match(witness, /sourceSettingsPresetStorePath:\s*endState\.sourceSettingsPresetStorePath/, 'visual witness preserves the effective shared store path');
assert.match(witness, /sourceSettingsPresetContentHash:\s*endState\.sourceSettingsPresetContentHash/, 'visual witness preserves immutable preset content identity');
assert.match(witness, /effectiveUrl,\n/, 'visual witness records the final browser target rather than only the requested loader URL');

const sequenceWitness = readFileSync(sequenceWitnessPath, 'utf8');
assert.match(sequenceWitness, /kaminos\.volume\.selective-head-live-sequence-witness\.v0/);
assert.match(sequenceWitness, /frame-locked-consecutive-simulation-steps-v0/);
assert.match(sequenceWitness, /cdp-presented-frame-after-consecutive-sim-step-v0/);
assert.match(sequenceWitness, /setCapturePaused\(true\)/);
assert.match(sequenceWitness, /stepCaptureFrame\(\)/);
assert.match(sequenceWitness, /canvasElement\(\)\.getBoundingClientRect/);
assert.match(sequenceWitness, /captureBeyondViewport: false, clip/);
assert.match(sequenceWitness, /Emulation\.setDeviceMetricsOverride/);
assert.match(sequenceWitness, /width: 1620, height: 633, deviceScaleFactor: 2/);
assert.match(sequenceWitness, /requestedFrameCount/);
assert.match(sequenceWitness, /capturedSimSteps/);
assert.match(sequenceWitness, /assertConsecutiveSteps/);
assert.match(sequenceWitness, /effectiveRole/);
assert.match(sequenceWitness, /expectedRoleAuthority/);
assert.match(sequenceWitness, /expectedComposition/);
assert.match(sequenceWitness, /effectiveComposition/);
assert.match(sequenceWitness, /composition drift/i);
assert.match(sequenceWitness, /selectiveHeadLivePassReceipt/);
assert.match(sequenceWitness, /roleAuthority/);
assert.match(sequenceWitness, /failurePhase/);
assert.match(sequenceWitness, /ffmpeg/);
for (const source of [witness, sequenceWitness]) {
  assert.match(source, /isInspectablePageTarget/);
  assert.ok(source.includes('chrome-extension://'));
}

const compositionWitness = readFileSync(compositionWitnessPath, 'utf8');
assert.match(compositionWitness, /kaminos\.volume\.selective-head-composition-witness\.v0/);
assert.match(compositionWitness, /same-state-selective-render-composition-v0/);
assert.match(compositionWitness, /advanceSim:\s*false/);
assert.match(compositionWitness, /presentToCanvas:\s*true/);
assert.match(compositionWitness, /splat-only-v0/);
assert.match(compositionWitness, /smoke-raymarch-under-splats-v0/);
assert.match(compositionWitness, /full-raymarch-under-splats-diagnostic-v0/);
assert.match(compositionWitness, /selectiveHeadLivePassReceipt/);
assert.match(
  compositionWitness,
  /composition === 'splat-only-v0'[\s\S]*requestedRaymarchSmokePresentation[\s\S]*raymarchSmokeApplied, false[\s\S]*raymarch pass was absent/,
  'same-state composition witness rejects Smoke On looking applied when splat-only has no raymarch pass',
);
assert.match(compositionWitness, /renderElapsedMs/);
assert.match(compositionWitness, /captureScope:\s*'canvas-only'/, 'composition witness records canvas-only screenshot scope');
assert.match(compositionWitness, /toolbar'\)\.style\.display='none'/, 'composition witness hides outer route chrome before screenshot capture');
assert.match(compositionWitness, /effectiveControls:\s*pausedState\.effectiveBasinControls/, 'composition witness records effective control receipts');
assert.match(compositionWitness, /sourceStateIdentity:\s*pausedState\.sourceStateIdentity/, 'composition witness records frozen source-state receipts');
assert.match(compositionWitness, /isInspectablePageTarget/);
assert.ok(compositionWitness.includes('chrome-extension://'));
assert.ok(compositionWitness.includes("lastTrustworthyEvidence = { phase: 'route-settle', state };"));

console.log('selective-head live contracts passed');
