#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const sessionUrl = new URL('../volume-live-full-support-optics-session.mjs', import.meta.url);
const witnessUrl = new URL('../volume-live-full-support-optics-witness.mjs', import.meta.url);
assert.ok(existsSync(sessionUrl), 'the direct live optics route has a reproducible session launcher');
assert.ok(existsSync(witnessUrl), 'the direct live optics route has a visual and pixel witness');

const [core, index, session, witness] = await Promise.all([
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(sessionUrl, 'utf8'),
  readFile(witnessUrl, 'utf8'),
]);
const livePage = await readFile(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8');

assert.match(
  core,
  /pauseSelectiveHeadLiveAtSimStep/,
  'the live renderer exposes an exact simulation-step pause instead of requiring imported state',
);
assert.match(
  core,
  /renderer-internal-exact-sim-step-pause-gpu-complete-v0/,
  'the exact-step receipt waits for submitted GPU work before becoming authoritative',
);
assert.match(
  core,
  /exact-step-already-passed/,
  'an overshot live target fails loud instead of presenting a nearby state',
);
assert.match(
  core,
  /runtime-cotangent-packed-in-candidate-shape-v0/,
  'ordinary cotangent rendering stays in the compact candidate payload',
);
assert.match(
  core,
  /materializeLiveCompleteFlameOpticalCoefficients/,
  'the live renderer can materialize authored Raymarch emission and extinction directly on the paused GPU state',
);
assert.match(
  core,
  /enableLiveCompleteFlameOpticalCoefficients/,
  'the production route can allocate and enable a persistent live coefficient producer without per-frame CPU readback',
);
assert.match(
  core,
  /encodeLiveCompleteFlameOpticalCoefficients/,
  'the production coefficient producer is an encodable part of the ordinary GPU frame graph',
);
assert.match(
  core,
  /sampleLiveCompleteFlameOpticalCoefficientStats/,
  'the live producer exposes a witness-only sparse GPU sample so zero coefficients cannot look effective',
);
assert.match(
  core,
  /producerHeader[^]*rowCount[^]*capacity[^]*mode[^]*overflowCount/,
  'the coefficient witness reports the GPU producer header instead of trusting CPU encode receipts',
);
assert.match(
  core,
  /liveCompleteFlameCoefficientUniformBuffer[^]*coefficientUniforms\[307\][^]*APPEARANCE_DECOMPOSITION_MODES\['complete-flame-emission'\]\.uniform/,
  'the producer uses an isolated complete-flame uniform snapshot instead of inheriting the visible assay mode',
);
assert.match(
  core,
  /coefficientUniforms\[307\][^]*coefficientUniforms\[316\] = 0/,
  'the isolated producer restores complete-flame fire authority instead of inheriting splat-only raymarch suppression',
);
assert.match(
  core,
  /createFluidRenderBindGroup\([^]*uniformsBuffer[^]*binding: 0, resource: \{ buffer: uniformsBuffer \}/,
  'the producer bind group can bind its isolated uniform buffer without mutating ordinary presentation uniforms',
);
assert.match(
  core,
  /live-raymarch-complete-flame-native-cell-coefficients-v0/,
  'the live coefficient layer has an explicit same-state native-cell authority',
);
assert.match(
  core,
  /native-cell-projected-footprint-jacobian-v0/,
  'per-ray native-cell coefficients are converted to projected splat coverage instead of conserved as one image pixel',
);
assert.match(
  core,
  /function flowKernelDescriptorRowsRequested\(\)[^]*return flowKernelDescriptorCaptureRequested\(\);/,
  'the 100-float research descriptor is allocated only for an explicit descriptor capture',
);
assert.doesNotMatch(
  core.slice(core.indexOf('fn boundarySplatBilinearVs('), core.indexOf('@fragment', core.indexOf('fn boundarySplatBilinearVs('))),
  /flowKernelDescriptorRowsForRender/,
  'the ordinary bilinear renderer does not depend on the research descriptor buffer',
);

assert.match(index, /full_support_live_step/, 'the operator route requests its live simulation step explicitly');
assert.match(
  index,
  /full-support-live-route-conflicts-with-field-import/,
  'the live operator path rejects simultaneous frozen-field replay parameters',
);
assert.match(
  index,
  /live-simulator-exact-step-v0/,
  'the operator receipt identifies the live simulator as the state authority',
);
assert.match(
  index,
  /bootstrapLiveFullSupportOpticsState/,
  'the operator route has a direct full-support optical bootstrap',
);

const directBootstrap = index.slice(
  index.indexOf('const bootstrapLiveFullSupportOpticsState = async () => {'),
  index.indexOf('const bootstrapFullSupportStageAState = async () => {'),
);
assert.ok(directBootstrap.length > 0, 'the direct live bootstrap is independently inspectable');
assert.doesNotMatch(directBootstrap, /beginDebugFullFieldImport/, 'the live path never imports a frozen field');
assert.doesNotMatch(directBootstrap, /resumeDebugImportedFieldLive/, 'the live path never starts replay playback');
assert.doesNotMatch(directBootstrap, /bootstrapStageBConsumer/, 'the live path does not bootstrap evidence media');
assert.doesNotMatch(directBootstrap, /auditBoundarySplatLiveUnionSourceHashes/, 'ordinary live viewing does not hash-read the full grid');
assert.doesNotMatch(
  directBootstrap,
  /auditBoundarySplatLiveUnionCoefficientOverlayPopulation/,
  'ordinary live viewing does not read back the full coefficient population',
);
assert.match(
  directBootstrap,
  /setBoundarySplatPresentationMode\(FULL_SUPPORT_STAGE_A\.stageB\.identity\)/,
  'the direct path applies the existing matched emission/extinction recurrence',
);
assert.match(
  directBootstrap,
  /enableLiveCompleteFlameOpticalCoefficients/,
  'the direct path enables the persistent authored-Raymarch coefficient producer before applying recurrence',
);
assert.doesNotMatch(
  directBootstrap,
  /materializeLiveCompleteFlameOpticalCoefficients/,
  'the production path does not use the frozen one-shot coefficient materializer',
);
assert.doesNotMatch(
  directBootstrap,
  /renderFrozenScaleToCanvas/,
  'the production path does not substitute a frozen witness render for the live simulator',
);
assert.match(
  directBootstrap,
  /setSelectiveHeadLiveCapturePaused\(false\)/,
  'the production path resumes the simulator after its exact warmup transition',
);
assert.doesNotMatch(
  directBootstrap,
  /live-analytical-local-emission-extinction-v0/,
  'the direct path does not mislabel splat-opacity proxies as exact analytical coefficients',
);
assert.match(
  directBootstrap,
  /selectiveHeadLiveCompositionEffective[^]*splat-only-v0/,
  'the recurrence is admitted only on its truthful splat-only target',
);
const renderFrame = core.slice(
  core.indexOf('function render(now) {'),
  core.indexOf('function pumpLookLabFrozenFrame()', core.indexOf('function render(now) {')),
);
const simIndex = renderFrame.indexOf('encodeSim(encoder)');
const coefficientIndex = renderFrame.indexOf('encodeLiveCompleteFlameOpticalCoefficients(encoder');
const splatIndex = renderFrame.indexOf('encodeBoundarySplats(encoder');
assert.ok(simIndex >= 0, 'the ordinary live frame advances the simulator');
assert.ok(coefficientIndex > simIndex, 'the live coefficient pass runs after simulation advance');
assert.ok(splatIndex > coefficientIndex, 'splat compaction consumes coefficients from the same advanced state');
assert.match(
  renderFrame,
  /producedSimStepCount[^]*consumedSimStepCount[^]*presentedSimStepCount/,
  'the live frame receipt reports producer, consumer, and presentation step identities',
);
assert.match(
  renderFrame,
  /live-optical-frame-step-mismatch/,
  'same-step drift fails loud instead of presenting stale coefficients as live',
);
assert.match(session, /full_support_live_step/, 'the launcher requests exact live state instead of replay fields');
assert.doesNotMatch(session, /source-field-manifest/, 'the direct launcher has no frozen-field input');
assert.doesNotMatch(session, /stage-b-manifest/, 'the direct launcher has no evidence-media input');
assert.match(
  session,
  /volume_optical_unit_mode', 'projected-native-cell-area-integral-normalized-v0'/,
  'the direct live operator route does not boot into the physical optical law',
);
assert.match(
  livePage,
  /data-optical-unit-mode="legacy-global-path-scale-diagnostic-v0"[\s\S]*data-optical-unit-mode="projected-native-cell-area-integral-normalized-v0"/,
  'the volume-only toolbar does not expose an in-place legacy/physical optical toggle',
);
assert.match(
  livePage,
  /Dynamic analytical coefficients[\s\S]*not frozen round cohort/,
  'the live toolbar does not make its coefficient and geometry gap operator-visible',
);
assert.match(
  livePage,
  /function setOpticalUnitMode\(mode\)[\s\S]*setBoundarySplatOpticalUnitMode/,
  'the live toolbar cannot switch optical laws through the existing runtime setter',
);
assert.match(
  livePage,
  /requestedOpticalUnitMode[\s\S]*effectiveOpticalUnitMode[\s\S]*opticalUnitFallbackReason/,
  'the live toolbar debug receipt does not distinguish requested, effective, and fallback optical state',
);
assert.match(
  livePage,
  /dynamicCoefficientAuthority[\s\S]*dynamicFootprintAuthority[\s\S]*dynamicGaussianGeometryIdentity/,
  'the operator surface omits the effective dynamic source and geometry identities',
);
assert.match(witness, /__kaminosLiveFullSupportOpticsBootstrapReceipt/, 'the witness waits for the direct live bootstrap');
assert.match(witness, /litFraction/, 'the witness rejects blank optical output');
assert.match(witness, /rendererEncoded[^]*rendererApplied/, 'the witness checks requested optical passes were encoded and applied');
assert.match(witness, /liveMotionProbe/, 'the production witness compares two advancing live frames');
assert.match(witness, /frameStepDelta/, 'the production witness reports exact simulation-step advance');
assert.match(witness, /changedPixelFraction/, 'the production witness rejects a moving counter over frozen pixels');
assert.match(
  witness,
  /coefficientStats[^]*positiveCoefficientCount[^]*maximumEmission[^]*maximumExtinction/,
  'the live witness rejects a zero-filled coefficient producer before blaming presentation',
);
assert.match(
  witness,
  /producerHeader[^]*rowCount[^]*160 \*\* 3[^]*mode[^]*4[^]*overflowCount[^]*0/,
  'the live witness requires complete mode-4 GPU coverage before interpreting coefficient values',
);
assert.match(witness, /cameraMotionProbe/, 'the production witness verifies camera interaction without freezing simulation');
assert.match(
  witness,
  /#kaminos-host-renderer-canvas/,
  'the camera witness targets the visible OrbitControls canvas instead of an ambiguous or hidden volume canvas',
);
assert.match(
  witness,
  /pixelProbe: sampleMetrics\(second\)/,
  'the witness preserves pixel metrics and PNGs without duplicating the full RGBA payload into its report',
);
assert.doesNotMatch(
  witness,
  /renderFrozenScaleToCanvas/,
  'the production witness cannot freeze the renderer to manufacture a stable visual result',
);
assert.match(
  witness,
  /live-raymarch-complete-flame-native-cell-coefficients-v0/,
  'the visual witness rejects a proxy coefficient authority',
);
assert.match(
  witness,
  /flow-kernel-moment-gaussian-raster-v0/,
  'the production witness rejects the longitudinal five-tap diagnostic as the effective footprint',
);
assert.match(
  witness,
  /opticalToggleProbe/,
  'the production witness does not exercise the live optical-law toggle',
);
assert.match(
  witness,
  /legacy-global-path-scale-diagnostic-v0[\s\S]*projected-native-cell-area-integral-normalized-v0/,
  'the production witness does not compare both live optical laws',
);
assert.match(
  witness,
  /postToggleSimStepDelta[^]*> 0/,
  'the production witness does not prove simulation advance continued after the optical switch',
);
assert.match(
  witness,
  /persistentSparseCohortGpuReceipt[^]*null/,
  'the production witness permits a frozen cohort to impersonate the live route',
);
assert.match(
  witness,
  /live-raymarch-complete-flame-native-cell-coefficients-v0/,
  'the production witness does not preserve the exact dynamic coefficient authority across the toggle',
);

console.log('volume live full-support optics contracts passed');
