import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(core, /COARSE_RESIDUAL_RAYMARCH_PRESENTATION_ASSAY_IDENTITY\s*=\s*'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0'/, 'hybrid assay must have a stable route identity');
const genericLiveCompositionTable = core.match(/const SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS[\s\S]*?const SELECTIVE_HEAD_LIVE_REPLAY_ANCHOR_AUTHORITY/)?.[0] || '';
assert.doesNotMatch(genericLiveCompositionTable, /COARSE_RESIDUAL_RAYMARCH_PRESENTATION_ASSAY_IDENTITY/, 'frozen coarse assay must not be advertised by generic live composition paths');
assert.match(core, /coarseResidualPresentationAssay\s*\?[\s\S]*requested:\s*COARSE_RESIDUAL_RAYMARCH_PRESENTATION_ASSAY_IDENTITY[\s\S]*selectiveHeadLiveRenderCompositionRequest/, 'frozen capture must admit the coarse assay through its dedicated route');
assert.match(core, /function normalizeCoarseResidualRaymarchScale[\s\S]*0\.05[\s\S]*1/, 'coarse raymarch scale must be independent and permit the requested five-percent linear scale');
assert.match(core, /struct RaymarchResult[\s\S]*linearRadianceTransmittance:\s*vec4<f32>/, 'raymarch must expose pre-presentation linear radiance instead of a clipped presentation image');
assert.match(core, /fn fsLinearRadiance[\s\S]*return result\.linearRadianceTransmittance/, 'coarse raymarch target must receive linear HDR radiance');
assert.match(core, /ensureCoarseResidualRaymarchTexture[\s\S]*format:\s*BOUNDARY_SPLAT_HDR_TARGET_FORMAT/, 'coarse raymarch must preserve HDR in rgba16float');
assert.match(core, /encodeCoarseResidualRaymarchPresentationAssay[\s\S]*coarseResidualRaymarchTexture[\s\S]*boundarySplatHdrTexture[\s\S]*COARSE_RESIDUAL_RAYMARCH_PRESENTATION_RESOLVE_IDENTITY/, 'hybrid assay must combine separate coarse-raymarch and full-resolution-splat HDR targets before presentation');
assert.match(core, /fn coarseResidualRaymarchPresentationFs[\s\S]*raymarchRadiance\s*\+\s*splatRadiance[\s\S]*vec3<f32>\(1\.0\)\s*-\s*exp\(-color\s*\*\s*0\.96\)[\s\S]*pow\([\s\S]*0\.84/, 'hybrid resolve must apply the exact raymarch presentation transform once after linear-HDR composition');
assert.match(core, /selfTransmittanceParityEligible:\s*false/, 'presentation-only assay must not claim optical or self-transmittance parity');
assert.match(core, /resolutionOwnershipIdentity:\s*'full-resolution-splats-independent-coarse-linear-raymarch-v0'/, 'receipt must record separate resolution ownership');
assert.match(core, /COARSE_RESIDUAL_RAYMARCH_AUTHORITY_IDENTITY\s*=\s*'non-ridge-contribution-under-complete-flame-transmittance-v0'/, 'coarse presentation assay must name the analytical broad-radiance authority');
assert.match(core, /coarseResidualRaymarchAuthorityRequested\s*!==\s*COARSE_RESIDUAL_RAYMARCH_AUTHORITY_IDENTITY/, 'coarse assay must fail loud instead of silently rendering an empty or full-flame residual');
assert.match(core, /uniforms\[307\]\s*=\s*APPEARANCE_DECOMPOSITION_MODES\['non-ridge-transport-total-extinction'\]\.uniform/, 'coarse raymarch must privately select the analytical non-ridge transport without disabling splats globally');
assert.match(core, /COARSE_RESIDUAL_TRANSPORTED_RADIANCE_COMPOSITION_IDENTITY\s*=\s*'separately-transported-radiance-sum-presentation-only-approximation-v0'/, 'presentation ladder must name its transported-radiance approximation');
assert.match(core, /transportedRadianceCompositionIdentity:\s*COARSE_RESIDUAL_TRANSPORTED_RADIANCE_COMPOSITION_IDENTITY/, 'receipt must disclose that the first ladder is not a shared optical recurrence');
assert.match(core, /state\.sparseHybridPresentationReceipt\s*=\s*null;[\s\S]*const compositionExplicit/, 'every frozen capture must clear stale hybrid evidence before route selection');
assert.match(core, /sparseHybridPresentationReceipt:\s*coarseResidualPresentationAssay\s*&&\s*state\.sparseHybridPresentationReceipt/, 'only a coarse assay capture may return a hybrid receipt');
assert.match(core, /finally\s*\{[\s\S]*controlsSnapshot\s*=\s*controlsBefore[\s\S]*coarseResidualPresentationAssay[\s\S]*updateUniforms\(fixedNow\)/, 'all private coarse-pass uniforms must be restored after the assay');
assert.match(core, /async function sampleSparseHybridPresentationGpuProfile[\s\S]*timestamp-query/, 'hybrid assay must expose an isolated GPU timestamp profile');
assert.match(core, /sampleSparseHybridPresentationGpuProfile[\s\S]*majorant[\s\S]*sidecar[\s\S]*compaction[\s\S]*coarseRaymarch[\s\S]*splatRaster[\s\S]*compositeResolve[\s\S]*total/, 'hybrid profile must charge every renderer stage separately');
assert.match(core, /sampleSparseHybridPresentationGpuProfile,\s*\n\s*renderFrozenScaleToCanvas/, 'hybrid GPU profile must be exposed through the prototype debug API');
assert.match(core, /sampleSparseHybridPresentationGpuProfile[\s\S]*profileRenderLoopWasRunning[\s\S]*cancelAnimationFrame\(raf\)[\s\S]*requestAnimationFrame\(render\)/, 'hybrid GPU profile must suspend and faithfully restore a live render loop');

const witness = fs.readFileSync(new URL('../volume-sparse-hybrid-presentation-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /21-camera-frozen-orbit-v0/, 'witness must preserve the established 21-camera frozen orbit');
assert.match(witness, /\[0\.20,\s*0\.15,\s*0\.10,\s*0\.075,\s*0\.05\]/, 'witness must assay the planned coarse raymarch scale ladder');
assert.match(witness, /presentation-only-no-self-transmittance-claim-v0/, 'witness must name the bounded conclusion');
assert.match(witness, /validateSparseHybridPresentationReport/, 'witness must gate claims through the durable validator');

const orbitHarness = fs.readFileSync(new URL('../volume-raymarch-filament-orbit-witness.mjs', import.meta.url), 'utf8');
assert.match(orbitHarness, /--sparse-hybrid-scales/, 'frozen orbit harness must admit an explicit sparse-hybrid scale ladder');
assert.match(orbitHarness, /sparseHybridPresentation[\s\S]*renderFrozenScaleToCanvas/, 'hybrid orbit frames must use the dedicated two-resolution canvas route');
assert.match(orbitHarness, /coarseResidualRaymarchAuthority:\s*'non-ridge-contribution-under-complete-flame-transmittance-v0'/, 'hybrid orbit frames must pin the exact analytical residual authority');
assert.match(orbitHarness, /sampleSparseHybridPresentationGpuProfile/, 'hybrid orbit must collect a hardware timing receipt for each scale');
assert.match(orbitHarness, /captured-awaiting-personal-inspection/, 'captured hybrid media must remain visibly unclosed before personal inspection');
assert.match(orbitHarness, /sparseHybridRequested\s*=\s*args\.has\('--sparse-hybrid-scales'\)/, 'explicit sparse-hybrid intent must not disappear when its value is malformed');
assert.match(orbitHarness, /parseStrictNumberList\(args\.get\('--sparse-hybrid-scales'\),\s*'--sparse-hybrid-scales'\)/, 'sparse-hybrid scales must use fail-loud parsing instead of filtering malformed tokens');
assert.match(orbitHarness, /requireExplicitOptionValue\('--sparse-hybrid-scales'\)/, 'a bare sparse-hybrid scale flag must fail instead of becoming scale one');

const { validateSparseHybridPresentationReport } = await import('../volume-sparse-hybrid-presentation-report.mjs');

const validReport = {
  schema: 'kaminos.volume.sparse-hybrid-presentation-report.v0',
  status: 'complete',
  treatmentIdentity: 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0',
  conclusionScope: 'presentation-only-no-self-transmittance-claim-v0',
  requestedRoute: 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0',
  effectiveRoute: 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0',
  fallbackReason: null,
  frozenStateSha256: 'a'.repeat(64),
  candidatePayloadSha256: 'b'.repeat(64),
  cameraOrbitSha256: 'c'.repeat(64),
  controlsSha256: 'd'.repeat(64),
  target: {
    splatFormat: 'rgba16float',
    raymarchFormat: 'rgba16float',
    presentationFormat: 'bgra8unorm',
    intermediateClamped: false,
  },
  resolution: {
    ownershipIdentity: 'full-resolution-splats-independent-coarse-linear-raymarch-v0',
    splatScale: 1,
    requestedRaymarchScale: 0.05,
    effectiveRaymarchScale: 0.05,
    raymarchScaleClamped: false,
    splatWidth: 3024,
    splatHeight: 1964,
    raymarchWidth: 151,
    raymarchHeight: 98,
  },
  presentation: {
    resolveIdentity: 'coarse-linear-raymarch-plus-full-resolution-splat-raymarch-grade-v0',
    curve: { exposure: 0.96, vignetteBase: 0.80, vignetteGain: 0.18, power: 0.84 },
    blendIdentity: 'linear-radiance-sum-before-single-presentation-resolve-v0',
    selfTransmittanceParityEligible: false,
    residualAuthorityIdentity: 'non-ridge-contribution-under-complete-flame-transmittance-v0',
    transportedRadianceCompositionIdentity: 'separately-transported-radiance-sum-presentation-only-approximation-v0',
    coefficientConservationEligible: false,
  },
  timing: {
    status: 'complete',
    authority: 'gpu-timestamp-query-v0',
    coarseRaymarchMs: 0.8,
    splatRasterMs: 4.2,
    compositeResolveMs: 0.2,
    totalGpuMs: 5.2,
  },
  orbit: {
    identity: '21-camera-frozen-orbit-v0',
    expectedCameraCount: 21,
    completedCameraCount: 21,
    dynamicWitnessPath: 'artifacts/sparse-hybrid/orbit.mp4',
    nativeFramePaths: ['artifacts/sparse-hybrid/000.png', 'artifacts/sparse-hybrid/010.png', 'artifacts/sparse-hybrid/020.png'],
    personallyInspected: true,
  },
};

assert.deepEqual(validateSparseHybridPresentationReport(validReport), { ok: true, errors: [] });

const invalidCases = [
  ['fallback', report => { report.fallbackReason = 'coarse-route-unavailable'; report.effectiveRoute = 'raymarch-only-v0'; }],
  ['clamped scale', report => { report.resolution.raymarchScaleClamped = true; report.resolution.effectiveRaymarchScale = 0.1; }],
  ['shared resolution', report => { report.resolution.ownershipIdentity = 'shared-render-scale-v0'; report.resolution.splatScale = 0.05; }],
  ['wrong scale dimensions', report => { report.resolution.raymarchWidth = 1512; report.resolution.raymarchHeight = 982; }],
  ['clipped intermediate', report => { report.target.intermediateClamped = true; report.target.raymarchFormat = 'rgba8unorm'; }],
  ['optical overclaim', report => { report.presentation.selfTransmittanceParityEligible = true; report.conclusionScope = 'self-transmittance-parity'; }],
  ['coefficient conservation overclaim', report => { report.presentation.coefficientConservationEligible = true; }],
  ['wrong residual authority', report => { report.presentation.residualAuthorityIdentity = 'smoke-only-v0'; }],
  ['missing timing', report => { report.timing.status = 'unavailable'; report.timing.authority = 'cpu-encode-proxy'; }],
  ['null timing metric', report => { report.timing.coarseRaymarchMs = null; }],
  ['empty timing metric', report => { report.timing.splatRasterMs = ''; }],
  ['partial orbit', report => { report.orbit.completedCameraCount = 20; }],
  ['uninspected media', report => { report.orbit.personallyInspected = false; }],
  ['missing hash', report => { report.candidatePayloadSha256 = null; }],
];

for (const [name, mutate] of invalidCases) {
  const report = structuredClone(validReport);
  mutate(report);
  assert.equal(validateSparseHybridPresentationReport(report).ok, false, `${name} evidence must not claim presentation assay completion`);
}

console.log('volume sparse hybrid presentation contracts: ok');
