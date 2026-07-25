import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contractPath = join(root, 'volume-sparse-product-cockpit.mjs');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const cockpit = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(join(root, 'volume-sparse-product-cockpit-witness.mjs'), 'utf8');

assert.ok(existsSync(contractPath), 'the ordinary sparse product route has a reusable contract');
const contract = await import(contractPath);

assert.equal(contract.SPARSE_PRODUCT_ROUTE_IDENTITY, 'kaminos.volume.sparse-live-cockpit.v0');
assert.equal(
  contract.SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY,
  'matched-optical-recurrence-v0',
  'the ordinary live product route renders both optical-unit arms through the ordered recurrence',
);
assert.deepEqual(contract.SPARSE_PRODUCT_RESOLUTIONS, [32, 48, 64, 96, 128, 140, 160]);
assert.deepEqual(Object.keys(contract.SPARSE_PRODUCT_GEOMETRY_MODES), [
  'historical-round',
  'flow-tangent',
  'learned-tangent',
]);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['historical-round'].boundarySplatMode,
  'learned',
);
assert.equal(contract.SPARSE_PRODUCT_GEOMETRY_MODES['historical-round'].defaultRadius, 0.98);
assert.equal(contract.SPARSE_PRODUCT_GEOMETRY_MODES['historical-round'].defaultSharpness, 12);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['historical-round'].rendererIdentity,
  'live-boundary-sidecar-learned-attribute-splats-v0',
);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['flow-tangent'].boundarySplatMode,
  'kernel_moment_covariance',
);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['flow-tangent'].rendererIdentity,
  'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0',
);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['learned-tangent'].boundarySplatMode,
  'world_covariance',
);
assert.equal(
  contract.SPARSE_PRODUCT_GEOMETRY_MODES['learned-tangent'].rendererIdentity,
  'live-boundary-sidecar-world-tangent-covariance-splats-v0',
);

const flowTangentRequest = contract.parseSparseProductRoute(new URLSearchParams(
  'volume_product_cockpit=1&volume_resolution=96&volume_splat_geometry=flow-tangent',
));
assert.equal(
  flowTangentRequest.rendererIdentity,
  'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0',
  'the requested renderer identity follows the selected geometry instead of inheriting the historical renderer',
);

assert.throws(
  () => contract.parseSparseProductRoute(new URLSearchParams('volume_product_cockpit=1&full_support_live_step=120')),
  /sparse-product-route-conflicts-with-diagnostic-bootstrap/,
  'the product route rejects late full-grid takeover rather than hiding it',
);
assert.throws(
  () => contract.parseSparseProductRoute(new URLSearchParams('volume_product_cockpit=1&warmup_steps=96')),
  /sparse-product-route-conflicts-with-diagnostic-bootstrap:warmup_steps/,
  'the product route rejects checksum replay warmup instead of replacing its live source',
);
assert.throws(
  () => contract.parseSparseProductRoute(new URLSearchParams('volume_product_cockpit=1&volume_resolution=73')),
  /sparse-product-resolution-unsupported:73/,
  'unsupported grids fail loud instead of normalizing silently',
);

const requested = contract.parseSparseProductRoute(new URLSearchParams(
  'volume_product_cockpit=1&volume_resolution=96&volume_splat_geometry=historical-round'
    + '&volume_optical_unit_mode=projected-native-cell-area-integral-normalized-v0',
));
assert.equal(requested.resolution, 96);
assert.equal(requested.boundarySplatMode, 'learned');
assert.equal(requested.boundarySplatRadius, 0.98);
assert.equal(requested.boundarySplatSharpness, 12);
assert.equal(requested.opticalUnitMode, 'projected-native-cell-area-integral-normalized-v0');

const effectiveRuntimeState = {
  active: true,
  simGrid: 96,
  simStepCount: 12,
  frameCount: 13,
  fluidStateResetCount: 2,
  boundarySplatMode: 'learned',
  boundarySplatRadius: 0.98,
  boundarySplatSharpness: 12,
  boundarySplatRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  boundarySplatAttributeModelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  boundarySplatFootprintAuthority: 'learned-camera-facing-billboard-v0',
  boundarySplatSourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  boundarySplatCandidateCount: 1200,
  boundarySplatOverflowCount: 0,
  boundarySplatFallbackReason: null,
  boundarySplatControlGeneration: 7,
  effectiveBoundarySplatOpticalUnitMode: requested.opticalUnitMode,
  boundarySplatOpticalUnitModeFallbackReason: null,
  boundarySplatPresentationModeEffective: 'matched-optical-recurrence-v0',
  boundarySplatPresentationReceipt: {
    effectiveMode: 'matched-optical-recurrence-v0',
    accumulationIdentity: 'depth-binned-emission-optical-depth-v0',
    transportIdentity: 'depth-binned-exponential-self-transmittance-v0',
    fallbackReason: null,
  },
  selectiveHeadLiveRole: 'off',
  selectiveHeadLiveEffectiveRole: 'off',
  selectiveHeadLiveCompositionRequested: 'splat-only-v0',
  selectiveHeadLiveCompositionEffective: 'splat-only-v0',
  selectiveHeadLivePassReceipt: {
    identity: 'selective-head-live-render-pass-receipt-v0',
    composition: 'splat-only-v0',
    controlGeneration: 7,
    splatEncoded: true,
    splatApplied: true,
    fallbackReason: null,
  },
  liveCompleteFlameOpticalCoefficientsEnabled: false,
  persistentSparseCohortGpuReceipt: null,
};
for (const field of [
  'simGrid',
  'boundarySplatSourceAuthority',
  'boundarySplatMode',
  'boundarySplatFootprintAuthority',
  'boundarySplatRadius',
  'boundarySplatSharpness',
  'boundarySplatRendererIdentity',
  'boundarySplatAttributeModelIdentity',
  'boundarySplatCandidateCount',
  'boundarySplatOverflowCount',
  'boundarySplatFallbackReason',
  'boundarySplatControlGeneration',
  'effectiveBoundarySplatOpticalUnitMode',
  'boundarySplatOpticalUnitModeFallbackReason',
  'boundarySplatPresentationModeEffective',
  'boundarySplatPresentationReceipt',
  'selectiveHeadLiveEffectiveRole',
  'selectiveHeadLiveCompositionEffective',
  'selectiveHeadLivePassReceipt',
  'liveCompleteFlameOpticalCoefficientsEnabled',
  'persistentSparseCohortGpuReceipt',
]) {
  const incompleteState = { ...effectiveRuntimeState };
  delete incompleteState[field];
  assert.throws(
    () => contract.makeSparseProductRuntimeReceipt(requested, incompleteState),
    new RegExp(`sparse-product-effective-field-missing:${field}`),
    `missing ${field} cannot settle as effective authority`,
  );
}
const missingPassGenerationState = {
  ...effectiveRuntimeState,
  selectiveHeadLivePassReceipt: { ...effectiveRuntimeState.selectiveHeadLivePassReceipt },
};
delete missingPassGenerationState.selectiveHeadLivePassReceipt.controlGeneration;
assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, missingPassGenerationState),
  /sparse-product-effective-field-missing:selectiveHeadLivePassReceipt\.controlGeneration/,
  'a missing applied-pass generation cannot settle as effective authority',
);
assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, {
    ...effectiveRuntimeState,
    boundarySplatFallbackReason: 'boundary-splat-gpu-route-unavailable',
  }),
  /sparse-product-renderer-fallback:boundary-splat-gpu-route-unavailable/,
  'a renderer fallback cannot retain effective sparse-product authority',
);
const unappliedPassReceipt = contract.makeSparseProductRuntimeReceipt(requested, {
  ...effectiveRuntimeState,
  selectiveHeadLivePassReceipt: {
    ...effectiveRuntimeState.selectiveHeadLivePassReceipt,
    splatEncoded: false,
    splatApplied: false,
    fallbackReason: 'awaiting-frame-after-control-change',
  },
});
assert.equal(unappliedPassReceipt.status, 'settling');
assert.equal(unappliedPassReceipt.fallbackReason, 'sparse-product-render-pass-not-applied');
const staleGenerationReceipt = contract.makeSparseProductRuntimeReceipt(requested, {
  ...effectiveRuntimeState,
  boundarySplatControlGeneration: effectiveRuntimeState.boundarySplatControlGeneration + 1,
});
assert.equal(staleGenerationReceipt.status, 'settling');
assert.equal(staleGenerationReceipt.fallbackReason, 'sparse-product-render-pass-generation-stale:7:8');
const zeroProgressReceipt = contract.makeSparseProductRuntimeReceipt(requested, {
  ...effectiveRuntimeState,
  simStepCount: 0,
});
assert.equal(zeroProgressReceipt.status, 'settling');
assert.equal(zeroProgressReceipt.fallbackReason, 'sparse-product-runtime-progress-incomplete');
const zeroFrameReceipt = contract.makeSparseProductRuntimeReceipt(requested, {
  ...effectiveRuntimeState,
  frameCount: 0,
});
assert.equal(zeroFrameReceipt.status, 'settling');
assert.equal(zeroFrameReceipt.fallbackReason, 'sparse-product-runtime-progress-incomplete');

assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, {
    ...effectiveRuntimeState,
    liveCompleteFlameOpticalCoefficientsEnabled: true,
  }),
  /sparse-product-diagnostic-coefficients-active/,
  'full-grid analytical coefficients cannot look like product sparse authority',
);
assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, {
    ...effectiveRuntimeState,
    boundarySplatCandidateCount: 96 ** 3,
  }),
  /sparse-product-population-not-sparse/,
  'a full-grid population cannot be mislabeled as the sparse product renderer',
);
assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, {
    ...effectiveRuntimeState,
    boundarySplatFootprintAuthority: 'world-gradient-tangent-covariance-v0',
  }),
  /sparse-product-footprint-substitution/,
  'a mislabeled effective footprint cannot inherit the requested product geometry identity',
);

const receipt = contract.makeSparseProductRuntimeReceipt(requested, effectiveRuntimeState);
assert.equal(receipt.status, 'effective');
assert.equal(receipt.effective.geometry, 'historical-round');
assert.deepEqual(receipt.material.requested, {
  boundarySplatRadius: 0.98,
  boundarySplatSharpness: 12,
  rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  attributeModelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
});
assert.deepEqual(receipt.material.effective, receipt.material.requested);
assert.equal(receipt.material.authoredOverrideApplied, false);
assert.equal(receipt.population.authority, 'ordinary-live-sparse-compaction-v0');
assert.equal(receipt.population.candidates, 1200);
assert.equal(receipt.diagnosticBootstrapApplied, false);
assert.equal(receipt.effective.presentationMode, 'matched-optical-recurrence-v0');
assert.equal(receipt.opticalTransport.accumulationIdentity, 'depth-binned-emission-optical-depth-v0');
assert.equal(receipt.opticalTransport.transportIdentity, 'depth-binned-exponential-self-transmittance-v0');

assert.throws(
  () => contract.makeSparseProductRuntimeReceipt(requested, {
    ...effectiveRuntimeState,
    boundarySplatPresentationModeEffective: 'current-additive-v0',
    boundarySplatPresentationReceipt: {
      effectiveMode: 'current-additive-v0',
      accumulationIdentity: 'additive-rgb-gaussian-alpha-v0',
      transportIdentity: null,
      fallbackReason: null,
    },
  }),
  /sparse-product-optical-presentation-substitution/,
  'a physical-unit label over the legacy additive presentation cannot settle as effective product optics',
);

const startupReceipt = contract.makeSparseProductRuntimeReceipt(requested, {
  ...effectiveRuntimeState,
  active: false,
  simStepCount: 0,
  frameCount: 0,
  boundarySplatCandidateCount: null,
  selectiveHeadLiveCompositionEffective: 'off',
  selectiveHeadLivePassReceipt: {
    ...effectiveRuntimeState.selectiveHeadLivePassReceipt,
    composition: 'full-raymarch-under-splats-diagnostic-v0',
    splatEncoded: false,
    splatApplied: false,
  },
});
assert.equal(startupReceipt.status, 'settling');
assert.equal(startupReceipt.fallbackReason, 'sparse-product-composition-awaiting-first-frame');

assert.equal(
  typeof contract.runSparseProductResolutionTransition,
  'function',
  'the product route owns a reusable transactional resolution handover',
);
const retainedRuntime = { id: 'old-live-runtime' };
let committedRuntime = retainedRuntime;
let disposedRuntime = null;
await assert.rejects(
  contract.runSparseProductResolutionTransition({
    currentResolution: 96,
    requestedResolution: 64,
    currentRuntime: retainedRuntime,
    stage: async () => {
      throw new Error('injected-stage-allocation-failure');
    },
    commit: async runtime => {
      committedRuntime = runtime;
    },
    rollback: async () => {},
    dispose: async runtime => {
      disposedRuntime = runtime;
    },
  }),
  error => {
    assert.equal(error.receipt?.status, 'failed');
    assert.equal(error.receipt?.requestedResolution, 64);
    assert.equal(error.receipt?.effectiveResolution, 96);
    assert.equal(error.receipt?.retainedRuntime, true);
    assert.match(error.receipt?.failureReason || '', /injected-stage-allocation-failure/);
    return true;
  },
);
assert.equal(committedRuntime, retainedRuntime, 'a failed stage cannot replace the active runtime');
assert.equal(disposedRuntime, null, 'a failed stage cannot dispose the active runtime');

const oldRuntime = { id: 'rollback-old-runtime' };
const nextRuntime = { id: 'rollback-next-runtime' };
let authoritativeRuntime = oldRuntime;
const rollbackDisposals = [];
await assert.rejects(
  contract.runSparseProductResolutionTransition({
    currentResolution: 96,
    requestedResolution: 64,
    currentRuntime: oldRuntime,
    stage: async () => ({
      status: 'effective',
      effectiveResolution: 64,
      runtime: nextRuntime,
    }),
    commit: async runtime => {
      authoritativeRuntime = runtime;
      throw new Error('injected-post-swap-commit-failure');
    },
    rollback: async ({ currentRuntime }) => {
      authoritativeRuntime = currentRuntime;
    },
    dispose: async runtime => {
      rollbackDisposals.push(runtime);
    },
  }),
  error => {
    assert.equal(error.receipt?.status, 'failed');
    assert.equal(error.receipt?.retainedRuntime, true);
    assert.equal(error.receipt?.effectiveResolution, 96);
    assert.equal(error.receipt?.rollback?.status, 'effective');
    return true;
  },
);
assert.equal(authoritativeRuntime, oldRuntime, 'a post-swap failure restores old runtime authority');
assert.deepEqual(rollbackDisposals, [nextRuntime], 'rollback disposes only the rejected staged runtime');

const cleanupOldRuntime = { id: 'cleanup-old-runtime' };
const cleanupNextRuntime = { id: 'cleanup-next-runtime' };
const cleanupReceipt = await contract.runSparseProductResolutionTransition({
  currentResolution: 96,
  requestedResolution: 64,
  currentRuntime: cleanupOldRuntime,
  stage: async () => ({
    status: 'effective',
    effectiveResolution: 64,
    runtime: cleanupNextRuntime,
  }),
  commit: async () => {},
  rollback: async () => {
    throw new Error('rollback-must-not-run-after-commit');
  },
  dispose: async runtime => {
    if (runtime === cleanupOldRuntime) throw new Error('injected-old-runtime-cleanup-failure');
  },
});
assert.equal(cleanupReceipt.status, 'effective');
assert.equal(cleanupReceipt.effectiveResolution, 64);
assert.equal(cleanupReceipt.retainedRuntime, false);
assert.equal(cleanupReceipt.previousRuntimeCleanup.status, 'failed');
assert.match(cleanupReceipt.previousRuntimeCleanup.error, /injected-old-runtime-cleanup-failure/);

assert.match(index, /const fullSupportBootstrapRequested = /);
assert.match(
  index,
  /fullSupportBootstrapRequested\s*\?\s*\([\s\S]*bootstrapLiveFullSupportOpticsState[\s\S]*bootstrapFullSupportStageAState[\s\S]*\)\s*:\s*Promise\.resolve\(null\)/,
  'Stage A/B work is not invoked on an ordinary product route',
);
assert.match(index, /sparse-product-route-conflicts-with-diagnostic-bootstrap/);
assert.match(index, /volume-sparse-product-cockpit\.mjs/);
assert.match(
  index,
  /__kaminosVolumeRouteInitReceipt/,
  'the inner route publishes a settled initialization receipt instead of exposing only an opaque promise',
);
assert.match(
  index,
  /selectiveHeadLiveRole:\s*sparseProductControlsRequested\s*\?\s*['"]off['"]/,
  'the inner product control snapshot owns the ordinary high-field role',
);
assert.match(
  index,
  /selectiveHeadLiveRenderComposition:\s*sparseProductControlsRequested\s*\?\s*['"]splat-only-v0['"]/,
  'every inner product control update preserves splat-only composition instead of reviving the historical hybrid default',
);
assert.match(index, /data-volume-presentation-mode[\s\S]*setAttribute\('hidden'/);
for (const id of [
  'volume-reaction-live-view',
  'volume-boundary-sidecar-source',
  'volume-boundary-sidecar-view',
  'volume-boundary-splat-mode',
  'volume-majorant-grid',
  'volume-grid-overlay',
  'volume-flow-debug',
  'volume-residual-mode',
  'volume-residual-model-url',
  'volume-residual-feature-debug',
]) {
  assert.match(
    index,
    new RegExp(`['"]${id}['"]`),
    `the product route inventory explicitly removes diagnostic control ${id}`,
  );
}

assert.match(cockpit, /volume_product_cockpit/);
assert.match(cockpit, /id="splat-geometry"/);
assert.match(cockpit, /data-splat-geometry="historical-round"/);
assert.match(cockpit, /data-splat-geometry="flow-tangent"/);
assert.match(cockpit, /data-splat-geometry="learned-tangent"/);
assert.match(cockpit, /setSparseProductGeometry/);
assert.match(
  cockpit,
  /status:\s*geometryApplied\s*\?\s*['"]effective['"]\s*:\s*['"]settling['"]/,
  'geometry selection distinguishes projected control state from a frame-applied renderer',
);
assert.match(cockpit, /setSparseProductResolution/);
assert.match(
  cockpit,
  /function replaceSparseProductInnerRouteParameter\(/,
  'live product selectors have one helper for keeping the effective inner route truthful without reloading it',
);
assert.match(
  cockpit,
  /innerUrl\.protocol !== location\.protocol\s*\|\|\s*innerUrl\.origin !== location\.origin/,
  'live product selectors defer route mutation while the iframe is still on about:blank or another origin',
);
assert.match(
  cockpit,
  /replaceSparseProductInnerRouteParameter\('volume_splat_geometry', geometry\)/,
  'geometry changes update the effective inner route identity',
);
assert.match(
  cockpit,
  /replaceSparseProductInnerRouteParameter\('volume_optical_unit_mode', mode\)/,
  'optical-unit changes update the effective inner route identity',
);
assert.match(
  cockpit,
  /setBoundarySplatPresentationMode\?\.\(SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY\)/,
  'the product optics control keeps both unit arms on the ordered optical recurrence',
);
const opticalUnitSetter = cockpit.match(
  /function setOpticalUnitMode\(mode\) \{[\s\S]*?\n    \}\n\n    function setSparseProductGeometry/,
)?.[0] || '';
assert.match(
  opticalUnitSetter,
  /if \(sparseProductRequested\) \{[\s\S]*setBoundarySplatPresentationMode\?\.\(SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY\)/,
  'the product recurrence is installed only on the sparse product route, never on an ordinary hybrid route',
);
assert.match(
  cockpit,
  /volume_boundary_splat_presentation_mode:\s*SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY/,
  'the inner live route receives the product optical presentation before renderer initialization',
);
assert.match(
  index,
  /setBoundarySplatPresentationMode\?\.\(sparseProductRequest\.presentationMode\)/,
  'the inner route applies the product optical presentation beside optical-unit initialization',
);
assert.match(cockpit, /makeSparseProductRuntimeReceipt/);
assert.match(cockpit, /footprintAuthority: SPARSE_PRODUCT_GEOMETRY_MODES\[requestedSplatGeometry\]\.footprintAuthority/);
assert.match(cockpit, /Ordinary sparse live renderer/);
assert.match(cockpit, /ordinary-live-high-field-no-selective-head-v0/);
assert.match(cockpit, /appearance-assay-control[\s\S]*hidden = true/);
assert.match(cockpit, /\[hidden\] \{ display: none !important; \}/);
assert.match(
  cockpit,
  /!sparseProductRequested \|\| sparseProductReceipt\?\.status === 'effective'/,
  'the product cockpit does not announce running while its post-rebuild sparse population is still empty',
);
assert.doesNotMatch(
  cockpit,
  /opticalUnitModesGroup\.hidden = !liveFullSupportOpticsRequested/,
  'physical optics are not hidden behind the full-grid diagnostic route',
);

assert.match(core, /volumeResolutionTransitionReceipt/);
assert.match(core, /requestedResolution/);
assert.match(core, /effectiveResolution/);
assert.match(core, /sourceAuthorityAfter/);
assert.match(cockpit, /volumeResolutionTransitionReceipt/);
assert.match(cockpit, /runSparseProductResolutionTransition/);
assert.match(cockpit, /staged sparse product resolution/);
assert.match(cockpit, /kaminosReadVolumeControls/);
assert.match(
  contract.makeSparseProductRuntimeReceipt.toString(),
  /fluidStateResetCount/,
  'the product runtime receipt carries its effective reset identity',
);

assert.match(witness, /outerRoute/);
assert.match(witness, /innerRoute/);
assert.match(witness, /requestedRole[\s\S]*['"]off['"]/);
assert.match(witness, /effectiveRole[\s\S]*['"]off['"]/);
assert.match(witness, /requestedComposition[\s\S]*['"]splat-only-v0['"]/);
assert.match(witness, /effectiveComposition[\s\S]*['"]splat-only-v0['"]/);
assert.match(witness, /boundarySplatFootprintAuthority/);
assert.match(witness, /boundarySplatOverflowCount/);
assert.doesNotMatch(
  witness,
  /['"]--headless=new['"]/,
  'the product cockpit witness uses the established headed Chrome WebGPU path',
);
assert.match(
  witness,
  /headed-owned-cdp-browser-v0/,
  'the browser receipt identifies the headed harness-owned CDP session',
);
assert.match(
  witness,
  /detached:\s*true/,
  'the witness owns a distinct browser process group that can be torn down without touching operator Chrome',
);
assert.match(
  witness,
  /cleanupOwnedBrowserProcessGroup/,
  'the witness verifies cleanup of its exact browser process group',
);
assert.match(
  witness,
  /browserLifecycle/,
  'success and failure reports preserve browser launch and cleanup authority',
);
assert.match(
  witness,
  /assertDebugPortAvailable/,
  'the headed witness rejects a pre-existing debug-port owner before launch',
);
assert.match(
  witness,
  /bindOwnedCdpEndpoint/,
  'the headed witness binds its CDP endpoint to the launched process group and unique profile',
);
assert.match(
  witness,
  /boundarySplatControlGeneration:\s*inner\.boundarySplatControlGeneration[\s\S]*appliedPassControlGeneration:\s*inner\.selectiveHeadLivePassReceipt\?\.controlGeneration/,
  'the headed witness preserves current and applied control generations for independent receipt audit',
);
assert.match(
  witness,
  /setCapturePaused\(true\)/,
  'the Legacy/Physical witness holds simulation state while comparing optical laws',
);
assert.match(
  witness,
  /assertOpticalModePixelDelta/,
  'the witness rejects a presentation-only optics toggle whose pixels do not change',
);
assert.match(
  witness,
  /const opticalSameStateCaptureId\s*=/,
  'both optics arms share one explicit same-state capture identity',
);
assert.match(
  witness,
  /const opticalRenderTimeMs = await evaluate/,
  'both optics arms use one explicit renderer timestamp rather than independent wall times',
);
assert.match(
  witness,
  /opticalHeldState,[\s\S]*opticalRenderTimeMs,[\s\S]*opticalSameStateCaptureId,[\s\S]*cameraProbe/,
  'the final witness report exposes the fixed optical capture authority at top level',
);
assert.match(
  witness,
  /captureVolumeCanvasScreenshot/,
  'the optics witness captures the actual presented Volume canvas instead of accepting an offscreen preview alone',
);
assert.match(
  witness,
  /inflateSync/,
  'the witness decodes actual PNG pixels before accepting the visual discriminator',
);
assert.match(
  witness,
  /assertOpticalModePixelDelta\(\s*opticalCanvasSamples\[/,
  'the accepted optical delta is computed from presented canvas pixels',
);
assert.match(
  witness,
  /assertOpticalComparisonFalsifiers\(\)/,
  'the evidence harness proves identical and blank canvas pairs cannot close the witness',
);
const captureFrameImplementation = core.match(
  /async function captureSelectiveHeadLiveFrame\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  async function controlledStepSequence/,
)?.[0] || '';
assert.match(
  captureFrameImplementation,
  /sameStateCaptureId/,
  'a presented held frame preserves its caller-owned same-state identity',
);
assert.match(
  captureFrameImplementation,
  /baseFrameCount/,
  'a presented held frame preserves its base-frame authority even though presentation advances the frame counter',
);
assert.match(
  captureFrameImplementation,
  /sampleNowMs/,
  'a presented held frame reports the exact fixed renderer timestamp it consumed',
);
assert.match(
  witness,
  /writeReportSafely/,
  'preflight failures use the durable report path when it is writable and an explicit stderr fallback otherwise',
);
assert.ok(
  witness.indexOf("failurePhase = 'preflight'") < witness.indexOf('new URL('),
  'malformed route parsing happens inside the durable preflight failure boundary',
);
assert.match(
  witness,
  /args\.get\(['"]--chrome['"]\)/,
  'the witness permits deterministic missing-browser preflight injection',
);
assert.match(
  witness,
  /outerRuntimePresent/,
  'cold-load diagnostics distinguish a missing wrapper runtime from a missing inner renderer',
);
assert.match(
  witness,
  /innerRouteInitPromisePresent/,
  'cold-load diagnostics report whether the inner route initialization handshake ever started',
);
assert.match(
  witness,
  /failure-screenshot\.png/,
  'a cold-load failure preserves inspectable pixels instead of returning only a null state',
);
assert.match(
  witness,
  /browserEvents:\s*summarizeBrowserEvents/,
  'failure reports preserve browser exceptions and error logs observed before primary output',
);

console.log('volume sparse product cockpit contracts passed');
