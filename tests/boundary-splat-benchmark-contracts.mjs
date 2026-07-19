import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  acceptedFullSupportBasinReceipt,
  basinReceiptChecks,
  benchmarkRoute,
  browserContinuityChecks,
  candidateScalingFor,
  economicsClaimAllowedFor,
  exactGridCellReceipt,
  selectFootprintSweepRadii,
  selectBenchmarkResolutions,
  summarizeRun,
  workloadReceiptChecks,
} from '../volume-boundary-splat-benchmark.mjs';

const benchmark = await readFile(new URL('../volume-boundary-splat-benchmark.mjs', import.meta.url), 'utf8');
const volumeCore = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(benchmark, /BOUNDARY_SPLAT_BENCHMARK_SCHEMA\s*=\s*'kaminos\.boundary-splat\.serial-benchmark\.v1'/, 'production-grid economics benchmark report schema is explicit');
assert.match(benchmark, /volume_boundary_splat_mode', String\(testCase\.boundarySplatMode \|\| 'analytic'\)/, 'benchmark requests analytic splats by default while admitting the conserved sweep mode explicitly');
assert.match(benchmark, /volume_boundary_sidecar_source', 'baked'/, 'benchmark requests the baked sidecar source');
assert.doesNotMatch(benchmark, /url\.searchParams\.set\('volume_tall_preset', 'rgb_upscale_basin_0711'\)/, 'benchmark cannot reuse the zero-fire legacy preset');
assert.match(benchmark, /--reuse-browser[\s\S]*--keep-browser-open/, 'benchmark reuses one browser session serially');
assert.match(benchmark, /--device-scale-factor[\s\S]*String\(testCase\.deviceScaleFactor\)/, 'benchmark pins the browser device scale factor for comparable raster work');
assert.match(benchmark, /--boundary-splat-gpu-profile-samples[\s\S]*String\(BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES\)/, 'benchmark requests a warm GPU timing series instead of trusting one timestamp sample');
assert.match(benchmark, /--boundary-splat-footprint-audit/, 'benchmark requests projected footprint evidence for overdraw diagnosis');
assert.match(benchmark, /--boundary-splat-footprint-sweep-radii/, 'bounded Grid96 viability probe requests one held-state conserved-footprint sweep');
assert.match(benchmark, /--footprint-tier-sweep/, 'bounded Grid96 quadrature probe exposes one explicit tier-sweep gate');
assert.match(benchmark, /boundary-splat-footprint-tier-arms/, 'tier probe delegates to the same held-state browser witness instead of inventing a second render path');
assert.match(
  benchmark,
  /base-056[\s\S]*policy:\s*'off'[\s\S]*importance-070-098[\s\S]*policy:\s*'importance'[\s\S]*random-070-098[\s\S]*policy:\s*'random'/,
  'tier sweep contains the exact base, appearance-charged, and random-control arms',
);
assert.match(benchmark, /analytic_conserved/, 'footprint sweep uses the renderer area-opacity conservation path');
assert.match(
  volumeCore,
  /analytic-camera-billboard-from-gpu-compacted-candidates-v0[\s\S]*camera\.matrixWorld\.elements\.slice\(0, 3\)[\s\S]*camera\.matrixWorld\.elements\.slice\(4, 7\)[\s\S]*centerVisibleFootprintPixels[\s\S]*footprintPixelDistribution[\s\S]*meanDepthComplexity/,
  'analytic footprint audit mirrors the camera-right/camera-up billboard axes used by the raster vertex shader',
);
assert.match(benchmark, /closeSharedBrowser/, 'benchmark closes its kept-open browser after serial runs');
assert.match(benchmark, /falseClosureChecks[\s\S]*fallbackRoute[\s\S]*requestedEffectiveRendererDisagreement[\s\S]*unexpectedCompositionIdentity[\s\S]*missingTimestampSupport[\s\S]*blankOrPartialReport/, 'benchmark reports renderer and composition false-closure checks separately');
assert.match(benchmark, /optimizationClaimAllowed:\s*false/, 'benchmark can explicitly reject optimization claims');
assert.match(benchmark, /boundarySplatGpuProfile[\s\S]*boundarySplatCopyDisposition[\s\S]*boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount/, 'benchmark summarizes timing, copy, candidate, and overflow evidence');
assert.match(benchmark, /boundarySplatGpuProfileSeries[\s\S]*boundarySplatFootprintAudit/, 'benchmark preserves warm timing distributions and footprint evidence');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
assert.match(
  witness,
  /String\(value \|\| ''\)\s*\.split\(','\)\s*\.map\(entry => entry\.trim\(\)\)\s*\.filter\(Boolean\)\s*\.map\(entry => Number\(entry\)\)/,
  'an absent numeric-list argument remains empty instead of silently becoming the radius zero',
);
assert.match(witness, /await prototype\.setActive\(false\)[\s\S]*liveLoopSuspended: true[\s\S]*await prototype\.setActive\(true\)/, 'warm GPU profiling suspends and restores the live RAF loop');
assert.match(
  witness,
  /boundarySplatFootprintSweepRadii[\s\S]*boundarySplatMode: 'analytic_conserved'[\s\S]*sampleBoundarySplatGpuProfile[\s\S]*sampleBoundarySplatFootprintAudit[\s\S]*held-state-analytic-conserved-footprint-sweep-v0/,
  'footprint viability sweep changes only conserved analytic footprint controls on one held state',
);
assert.match(
  witness,
  /boundarySplatFootprintTierArms[\s\S]*boundarySplatFootprintTierPolicy[\s\S]*boundarySplatFootprintMediumRadius[\s\S]*boundarySplatFootprintHeroRadius[\s\S]*sampleBoundarySplatGpuProfile[\s\S]*sampleBoundarySplatFootprintAudit/,
  'tier sweep changes only explicit candidate-local charging controls on the held conserved route',
);
assert.match(
  witness,
  /footprint-tier-effective-control-mismatch[\s\S]*footprint-tier-candidate-identity-changed[\s\S]*footprint-tier-energy-conservation-failed/,
  'tier sweep fails loud on fallback controls, candidate drift, or broken optical conservation',
);
assert.match(
  witness,
  /sampleBoundarySplatGpuProfile\(\{\s*advanceSim:\s*false\s*\}\)/,
  'held-state footprint profiling explicitly disables simulation advancement',
);
assert.match(volumeCore, /async function sampleBoundarySplatGpuProfile\(options = \{\}\)/, 'GPU profiler admits explicit held-state sampling options');
assert.match(volumeCore, /const advanceSim = options\.advanceSim !== false/, 'GPU profiler defaults to the historical advancing behavior unless held-state sampling is explicit');
assert.match(volumeCore, /updateUniforms\(sampleNow\)/, 'GPU profiler uploads changed footprint controls before compaction and raster');
assert.match(volumeCore, /if \(advanceSim\) \{\s*encodeSim\(encoder/, 'GPU profiler omits simulation encoding for a held-state sample');
assert.match(
  volumeCore,
  /const queryIndices = advanceSim[\s\S]*sidecarBegin: 0[\s\S]*sidecarEnd: 1[\s\S]*compactionEnd: 2[\s\S]*rasterBegin: 3[\s\S]*rasterEnd: 4[\s\S]*raymarchEnd: 5/,
  'held-state profiling timestamps real sidecar, compaction, raster, and raymarch work instead of empty marker passes',
);
assert.match(
  witness,
  /arm\.simStepCount !== baseline\.simStepCount[\s\S]*footprint-sweep-simulation-state-changed/,
  'footprint sweep fails loud when the simulation advances between radius arms',
);
assert.match(
  witness,
  /arm\.audit\.candidatePayloadSha256 !== baseline\.audit\.candidatePayloadSha256[\s\S]*footprint-sweep-candidate-identity-changed/,
  'footprint sweep fails loud when candidate identity changes between radius arms',
);
assert.match(
  witness,
  /arm\.audit\.relativeError[\s\S]*footprint-sweep-energy-conservation-failed/,
  'footprint sweep fails loud when conserved deposition exceeds tolerance',
);
assert.match(
  witness,
  /sampleFrame\(\{[\s\S]*advanceSim:\s*false,[\s\S]*allowInactive:\s*true[\s\S]*footprint-sweep-visual-failed/,
  'each held-state footprint arm renders a frozen visual witness without resuming simulation',
);
assert.match(
  witness,
  /footprint-sweep-radius-[\s\S]*writeRgbaPng[\s\S]*previewPath/,
  'held-state footprint previews are materialized as inspectable PNG artifacts',
);
assert.match(benchmark, /renderScale[\s\S]*resolution[\s\S]*viewport/, 'benchmark characterizes viewport and candidate scaling dimensions');
assert.match(
  benchmark,
  /const ADMITTED_PRODUCTION_GRID_RESOLUTIONS = \[96, 128, 160\];/,
  'benchmark covers the admitted production-grid witness arms without silently substituting unsupported 80 or 92',
);
assert.deepEqual(selectBenchmarkResolutions('96'), [96], 'a bounded first probe can select only the admitted 96 grid');
assert.deepEqual(selectBenchmarkResolutions('96,128'), [96, 128], 'a later serial probe can select an admitted subset');
assert.deepEqual(selectBenchmarkResolutions(undefined), [96, 128, 160], 'omitting the gate preserves the full admitted sweep');
assert.deepEqual(
  selectFootprintSweepRadii('0.98,0.70,0.56,0.42'),
  [0.98, 0.7, 0.56, 0.42],
  'footprint sweep admits the bounded descending radius frontier around the projected-work knee',
);
assert.throws(
  () => selectFootprintSweepRadii('0.98,0.56,0.70'),
  /strictly descending/,
  'a reordered footprint sweep cannot hide which arm is the baseline',
);
assert.throws(
  () => selectFootprintSweepRadii('0.98,0.34'),
  /outside runtime range/,
  'the sweep cannot request a radius below the renderer runtime floor',
);
assert.throws(
  () => selectBenchmarkResolutions('92'),
  /not runtime-admitted: 92/,
  'the operator 92 hypothesis cannot silently become a runtime benchmark arm',
);
assert.throws(
  () => selectBenchmarkResolutions('96,96'),
  /duplicate resolution: 96/,
  'duplicate arms cannot impersonate a complete serial witness',
);
assert.match(
  benchmark,
  /const UNADMITTED_PRODUCTION_GRID_HYPOTHESES = \[[\s\S]*resolution: 80,[\s\S]*resolution: 92,[\s\S]*status: 'not-runtime-admitted'/,
  'benchmark records the operator production hypotheses that cannot yet produce runtime-grid evidence',
);
assert.match(
  benchmark,
  /SELECTED_PRODUCTION_GRID_RESOLUTIONS\.map\(resolution => \(\{[\s\S]*renderScale: 1,[\s\S]*viewport: windowSize/,
  'production-grid benchmark holds screen render scale and viewport fixed across simulation resolutions',
);
assert.match(
  benchmark,
  /const PRODUCTION_GRID_CELL_COUNTS = new Map\(\[\[96, 884736\], \[128, 2097152\], \[160, 4096000\]\]\);/,
  'candidate scaling receipts include exact integer cubic source-work ratios instead of floating-point prose extrapolation',
);
for (const [resolution, cellCount] of [[96, 884736], [128, 2097152], [160, 4096000]]) {
  assert.equal(resolution ** 3, cellCount, `${resolution} grid cell count remains exact`);
}
assert.match(
  benchmark,
  /visualQualityClaimAllowed:\s*false/,
  'untuned serial economics benchmark must explicitly deny visual-quality authority',
);
assert.match(
  benchmark,
  /economicsClaimAllowed/,
  'report distinguishes authenticated timing economics from visual-quality authority',
);
assert.match(benchmark, /readBrowserInstanceIdentity[\s\S]*webSocketDebuggerUrl/, 'benchmark captures the CDP browser UUID after every arm');
assert.match(benchmark, /browserInstanceIdentities[\s\S]*mismatchedBrowserInstanceIdentity/, 'serial economics authority rejects browser UUID churn across arms');
assert.match(
  benchmark,
  /EXPECTED_SPLAT_COUNT_AUTHORITY = 'gpu-indirect-post-submit-witness-readback'/,
  'economics authority requires post-submit GPU count evidence',
);
assert.match(
  benchmark,
  /incompleteWorkloadReceipt[\s\S]*capacityTruncatedWorkload[\s\S]*boundarySplatOverflowCount !== 0/,
  'missing, stale, or overflow-truncated workload receipts fail the economics claim loudly',
);
assert.match(benchmark, /value !== null[\s\S]*value !== undefined[\s\S]*Number\.isFinite/, 'null workload fields cannot masquerade as numeric zero');

const routeCase96 = {
  id: 'res096-rs100',
  resolution: 96,
  gridCellCount: 884736,
  renderScale: 1,
  deviceScaleFactor: 1,
  viewport: '1280,960',
};
const acceptedBasin = acceptedFullSupportBasinReceipt();
assert.equal(acceptedBasin.sourceArtifactSha256, '19458006f755df81e229587a4b4181f1e76043b7537b484b4439f42b60bfbf81');
assert.equal(acceptedBasin.sourcePresetId, 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2');
assert.equal(acceptedBasin.sourcePresetAuthority, 'shared-volume-settings-preset-v2');
const acceptedRoute = new URL(benchmarkRoute(routeCase96));
assert.equal(acceptedRoute.searchParams.get('kaminos_volume_smoke'), '1', 'accepted basin replay must explicitly activate the volume route');
assert.equal(acceptedRoute.searchParams.get('volume_resolution'), '96');
assert.equal(acceptedRoute.searchParams.get('volume_render_scale'), '1');
assert.equal(acceptedRoute.searchParams.get('volume_boundary_splat_mode'), 'analytic');
assert.equal(acceptedRoute.searchParams.get('volume_fire'), '2.25');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_support_thermal'), '0.98');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_support_reaction'), '1');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_support_front'), '0.66');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_support_interface'), '0.78');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_fire_ridge'), '1.52');
assert.equal(acceptedRoute.searchParams.get('volume_reaction_boundary_fire_ridge_cut'), '0.145');
assert.equal(acceptedRoute.searchParams.get('volume_quality_reason'), 'tiger-production-grid-economics-accepted-full-support-basin-v0');
assert.notEqual(acceptedRoute.searchParams.get('volume_tall_preset'), 'rgb_upscale_basin_0711');

const conservedRoute = new URL(benchmarkRoute({
  ...routeCase96,
  boundarySplatMode: 'analytic_conserved',
  boundarySplatRadius: 0.56,
}));
assert.equal(conservedRoute.searchParams.get('volume_boundary_splat_mode'), 'analytic_conserved');
assert.equal(conservedRoute.searchParams.get('volume_boundary_splat_radius'), '0.56');
assert.notEqual(conservedRoute.searchParams.get('volume_look_freeze'), '1', 'the route must settle live before the same-page witness freezes it');

const completeBasinControls = {
  density: 0.35,
  fire: 2.25,
  reactionBoundaryGradient: 1.05,
  reactionBoundarySupportThermal: 0.98,
  reactionBoundarySupportReaction: 1,
  reactionBoundarySupportFront: 0.66,
  reactionBoundarySupportInterface: 0.78,
  reactionBoundaryFireRidge: 1.52,
  reactionBoundaryFireRidgeCut: 0.145,
  pressureMode: 'global-p3',
};
assert.deepEqual(basinReceiptChecks({ controls: completeBasinControls }), {
  missingAcceptedBasinReceipt: false,
  mismatchedAcceptedBasinReceipt: false,
});
const partialBasin = structuredClone(completeBasinControls);
delete partialBasin.reactionBoundarySupportFront;
assert.equal(basinReceiptChecks({ controls: partialBasin }).missingAcceptedBasinReceipt, true, 'partial basin controls fail loud');
const legacyBasin = structuredClone(completeBasinControls);
legacyBasin.fire = 0;
assert.equal(basinReceiptChecks({ controls: legacyBasin }).mismatchedAcceptedBasinReceipt, true, 'legacy zero-fire controls cannot impersonate the accepted basin');

const completeWorkloadReceipt = {
  boundarySplatCapacity: 131072,
  boundarySplatCandidateCount: 120000,
  boundarySplatInstanceCount: 120000,
  boundarySplatOverflowCount: 0,
  boundarySplatCopyBytesThisFrame: 0,
  boundarySplatCountAuthority: 'gpu-indirect-post-submit-witness-readback',
  boundarySplatCopyDisposition: { effectiveCandidateCopyBytes: 0 },
  boundarySplatGpuProfile: { candidateCopyBytes: 0 },
};
assert.deepEqual(workloadReceiptChecks(completeWorkloadReceipt), {
  incompleteWorkloadReceipt: false,
  staleCountAuthority: false,
  capacityTruncatedWorkload: false,
});
for (const field of [
  'boundarySplatCapacity',
  'boundarySplatCandidateCount',
  'boundarySplatInstanceCount',
  'boundarySplatCopyBytesThisFrame',
]) {
  const falsified = structuredClone(completeWorkloadReceipt);
  delete falsified[field];
  assert.equal(workloadReceiptChecks(falsified).incompleteWorkloadReceipt, true, `missing ${field} denies workload authority`);
}
const staleAuthority = structuredClone(completeWorkloadReceipt);
staleAuthority.boundarySplatCountAuthority = 'gpu-indirect-async-readback';
assert.equal(workloadReceiptChecks(staleAuthority).staleCountAuthority, true, 'stale asynchronous count authority is rejected');
const overflowed = structuredClone(completeWorkloadReceipt);
overflowed.boundarySplatOverflowCount = 1;
assert.equal(workloadReceiptChecks(overflowed).capacityTruncatedWorkload, true, 'nonzero overflow rejects economics authority');

const validRuns = [96, 128, 160].map((resolution, index) => ({
  ok: true,
  economicsClaimAllowed: true,
  browserInstanceIdentity: { uuid: 'one-browser-uuid' },
  browserSession: { port: 19451 },
  renderScale: 1,
  deviceScaleFactor: 1,
  viewport: '1280,960',
  renderWidth: 1280,
  renderHeight: 960,
  falseClosureChecks: {},
  resolution,
  serialIndex: index,
}));
const validContinuity = browserContinuityChecks(validRuns);
assert.equal(economicsClaimAllowedFor(validRuns, validContinuity), true, 'complete serial fixtures permit an economics claim');
const restartedBrowserRuns = structuredClone(validRuns);
restartedBrowserRuns[2].browserInstanceIdentity.uuid = 'replacement-browser-uuid';
const restartedContinuity = browserContinuityChecks(restartedBrowserRuns);
assert.equal(restartedContinuity.mismatchedBrowserInstanceIdentity, true, 'browser UUID churn is detected');
assert.equal(economicsClaimAllowedFor(restartedBrowserRuns, restartedContinuity), false, 'browser UUID churn denies the economics claim');

for (const [resolution, numerator] of [[96, 884736], [128, 2097152], [160, 4096000]]) {
  assert.deepEqual(exactGridCellReceipt(resolution), {
    numerator,
    denominator: 4096000,
    approximate: numerator / 4096000,
  });
}

const completeProfileStages = Object.fromEntries([
  'simulation',
  'sidecar',
  'compaction',
  'candidateCopy',
  'indirectSetup',
  'splatRaster',
  'matchedRaymarchRaster',
  'total',
].map(stage => [stage, { ms: 1 }]));
const completeWitnessReport = {
  ...completeWorkloadReceipt,
  boundarySplatGpuProfile: {
    timestampStatus: 'available',
    candidateCopyBytes: 0,
    stages: completeProfileStages,
  },
  boundarySplatGpuProfileSeries: {
    identity: 'boundary-splat-gpu-profile-warm-series-v0',
    requestedSamples: 9,
    warmupSamples: 2,
    measuredSamples: 7,
    samples: Array.from({ length: 9 }, (_, index) => ({
      index,
      candidateCount: 120000,
      instanceCount: 120000,
      overflowCount: 0,
      profile: { timestampStatus: 'available', stages: completeProfileStages },
    })),
  },
  boundarySplatFootprintAudit: {
    ok: true,
    instanceCount: 120000,
  },
  boundarySplatMode: 'analytic',
  volumeReconstructionStyle: 'smoke-raymarch-under-splats-v0',
  boundarySplatRendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
  boundarySplatSourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  boundarySplatFallbackReason: null,
  expectedTallPlumePreset: null,
  controls: completeBasinControls,
  simGrid: 96,
  renderScale: 1,
  nativeDevicePixelRatio: 1,
  canvasDevicePixelRatio: 1,
  renderWidth: 1280,
  renderHeight: 960,
  litPixels: 100,
  meanLuma: 0.2,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  browserSession: { port: 19451 },
};
const testCase96 = {
  id: 'res096-rs100',
  resolution: 96,
  gridCellCount: 884736,
  renderScale: 1,
  deviceScaleFactor: 1,
  viewport: '1280,960',
};
function summarizedFixture(report) {
  return {
    ok: true,
    serialIndex: 0,
    browserInstanceIdentity: { uuid: 'one-browser-uuid' },
    ...summarizeRun(testCase96, '/tmp/report.json', '/tmp/frame.png', report),
  };
}
const completeSummary = summarizedFixture(completeWitnessReport);
assert.equal(completeSummary.economicsClaimAllowed, true, 'complete witness report survives per-run economics admission');
const composedConservedWitnessReport = structuredClone(completeWitnessReport);
composedConservedWitnessReport.boundarySplatMode = 'analytic_conserved';
composedConservedWitnessReport.volumeReconstructionStyle = 'smoke-raymarch-under-splats-v0';
const composedConservedSummary = summarizeRun(
  { ...testCase96, boundarySplatMode: 'analytic_conserved' },
  '/tmp/report.json',
  '/tmp/frame.png',
  composedConservedWitnessReport,
);
assert.equal(
  composedConservedSummary.falseClosureChecks.requestedEffectiveRendererDisagreement,
  false,
  'a truthful hybrid composition identity cannot impersonate a splat renderer disagreement',
);
assert.equal(composedConservedSummary.economicsClaimAllowed, true, 'truthful hybrid composition preserves analytical splat economics authority');
const retinaScaledWitnessReport = structuredClone(completeWitnessReport);
retinaScaledWitnessReport.nativeDevicePixelRatio = 2;
retinaScaledWitnessReport.canvasDevicePixelRatio = 2;
assert.equal(
  summarizedFixture(retinaScaledWitnessReport).falseClosureChecks.mismatchedDeviceScaleFactor,
  true,
  'Retina-scale raster work cannot impersonate the fixed-DPR benchmark contract',
);
const wrappedCompleteSummary = summarizedFixture({
  browserSession: { port: 19451 },
  state: completeWitnessReport,
});
assert.equal(wrappedCompleteSummary.economicsClaimAllowed, true, 'the actual volume-witness state wrapper survives per-run economics admission');
assert.equal(wrappedCompleteSummary.simGrid, 96, 'wrapped effective simulation grid reaches the summary');
assert.deepEqual(candidateScalingFor([completeSummary])[0].gridCellRatioTo160, {
  numerator: 884736,
  denominator: 4096000,
  approximate: 884736 / 4096000,
}, 'exact grid ratio survives the emitted candidate-scaling projection');

const workloadFalsifiers = [
  ['capacity', report => { delete report.boundarySplatCapacity; }],
  ['candidate count', report => { delete report.boundarySplatCandidateCount; }],
  ['instance count', report => { delete report.boundarySplatInstanceCount; }],
  ['overflow count', report => { delete report.boundarySplatOverflowCount; }],
  ['frame copy bytes', report => { delete report.boundarySplatCopyBytesThisFrame; }],
  ['disposition copy bytes', report => { delete report.boundarySplatCopyDisposition.effectiveCandidateCopyBytes; }],
  ['profile copy bytes', report => { delete report.boundarySplatGpuProfile.candidateCopyBytes; }],
  ['count authority', report => { report.boundarySplatCountAuthority = 'gpu-indirect-async-readback'; }],
  ['overflow', report => { report.boundarySplatOverflowCount = 1; }],
];
for (const [label, falsify] of workloadFalsifiers) {
  const report = structuredClone(completeWitnessReport);
  falsify(report);
  const summary = summarizedFixture(report);
  assert.equal(summary.economicsClaimAllowed, false, `${label} falsifier denies per-run economics authority`);
  const runs = structuredClone(validRuns);
  runs[0] = summary;
  assert.equal(economicsClaimAllowedFor(runs, browserContinuityChecks(runs)), false, `${label} falsifier denies final economics authority`);
}

console.log('boundary splat benchmark contracts passed');
