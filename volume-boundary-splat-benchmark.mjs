#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOUNDARY_SPLAT_BENCHMARK_SCHEMA = 'kaminos.boundary-splat.serial-benchmark.v1';
const BOUNDARY_SPLAT_RENDERER_IDENTITY = 'live-boundary-sidecar-analytic-splats-v0';
const BOUNDARY_SPLAT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const EXPECTED_SPLAT_COUNT_AUTHORITY = 'gpu-indirect-post-submit-witness-readback';
const EXPECTED_BOUNDARY_SPLAT_COMPOSITION = 'smoke-raymarch-under-splats-v0';
const ACCEPTED_FULL_SUPPORT_BASIN_SOURCE = fileURLToPath(new URL(
  './artifacts/intrinsic-presentation-flamebowl-0716-v12/report.json',
  import.meta.url,
));
const ACCEPTED_FULL_SUPPORT_BASIN_SOURCE_SHA256 = '19458006f755df81e229587a4b4181f1e76043b7537b484b4439f42b60bfbf81';
const ACCEPTED_FULL_SUPPORT_BASIN_QUALITY_REASON = 'tiger-production-grid-economics-accepted-full-support-basin-v0';
const ACCEPTED_FULL_SUPPORT_BASIN_CONTROLS = {
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

function loadAcceptedFullSupportBasin() {
  const bytes = readFileSync(ACCEPTED_FULL_SUPPORT_BASIN_SOURCE);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== ACCEPTED_FULL_SUPPORT_BASIN_SOURCE_SHA256) {
    throw new Error(`accepted full-support basin source sha256 mismatch: ${digest}`);
  }
  const source = JSON.parse(bytes.toString('utf8'));
  const requestedUrl = new URL(source.requestedUrl);
  const sourcePresetId = requestedUrl.searchParams.get('settings_preset');
  const sourcePresetAuthority = requestedUrl.searchParams.get('settings_preset_authority');
  if (!sourcePresetId || sourcePresetAuthority !== 'shared-volume-settings-preset-v2') {
    throw new Error('accepted full-support basin source is missing immutable preset authority');
  }
  return { requestedUrl, sourcePresetId, sourcePresetAuthority };
}

const ACCEPTED_FULL_SUPPORT_BASIN = loadAcceptedFullSupportBasin();

export function acceptedFullSupportBasinReceipt() {
  return {
    identity: 'accepted-operator-full-support-basin-replay-v0',
    sourceArtifactPath: ACCEPTED_FULL_SUPPORT_BASIN_SOURCE,
    sourceArtifactSha256: ACCEPTED_FULL_SUPPORT_BASIN_SOURCE_SHA256,
    sourcePresetId: ACCEPTED_FULL_SUPPORT_BASIN.sourcePresetId,
    sourcePresetAuthority: ACCEPTED_FULL_SUPPORT_BASIN.sourcePresetAuthority,
    expectedControls: { ...ACCEPTED_FULL_SUPPORT_BASIN_CONTROLS },
  };
}

function parseCliArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

const args = parseCliArgs(process.argv.slice(2));
const origin = String(args.get('--origin') || 'http://127.0.0.1:8095').replace(/\/+$/, '');
const out = resolve(args.get('--out') || '/tmp/kaminos-boundary-splat-benchmark.json');
const artifactDir = resolve(args.get('--artifact-dir') || out.replace(/\.json$/i, '.artifacts'));
const debugPort = Number(args.get('--debug-port') || 9537);
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = String(args.get('--window-size') || '1280,960');
const deviceScaleFactor = 1;
const BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES = 9;
const DEFAULT_FOOTPRINT_SWEEP_RADII = [0.98, 0.70, 0.56, 0.42];
const DEFAULT_FOOTPRINT_TIER_ARMS = Object.freeze([
  {
    id: 'base-056',
    policy: 'off',
    baseRadius: 0.56,
    mediumRadius: 0.70,
    heroRadius: 0.98,
    mediumThreshold: 0.78,
    heroThreshold: 0.94,
  },
  {
    id: 'importance-070-098',
    policy: 'importance',
    baseRadius: 0.56,
    mediumRadius: 0.70,
    heroRadius: 0.98,
    mediumThreshold: 0.78,
    heroThreshold: 0.94,
  },
  {
    id: 'random-070-098',
    policy: 'random',
    matchCountsFrom: 'importance-070-098',
    baseRadius: 0.56,
    mediumRadius: 0.70,
    heroRadius: 0.98,
    mediumThreshold: 0.78,
    heroThreshold: 0.94,
  },
]);
const TARGET_ORACLE_FOOTPRINT_TIER_ARMS = Object.freeze([
  DEFAULT_FOOTPRINT_TIER_ARMS[0],
  DEFAULT_FOOTPRINT_TIER_ARMS[1],
  {
    id: 'target-oracle-070-098',
    policy: 'target_oracle',
    oracleCountsFrom: 'importance-070-098',
    baseRadius: 0.56,
    mediumRadius: 0.70,
    heroRadius: 0.98,
    mediumThreshold: 0.78,
    heroThreshold: 0.94,
  },
  {
    id: 'oracle-random-070-098',
    policy: 'random',
    matchCountsFrom: 'target-oracle-070-098',
    baseRadius: 0.56,
    mediumRadius: 0.70,
    heroRadius: 0.98,
    mediumThreshold: 0.78,
    heroThreshold: 0.94,
  },
]);
const userDataDir = String(args.get('--user-data-dir') || `/tmp/kaminos-boundary-splat-benchmark-profile-${process.pid}`);

const ADMITTED_PRODUCTION_GRID_RESOLUTIONS = [96, 128, 160];
export function selectBenchmarkResolutions(specification) {
  if (specification === undefined || specification === null || specification === true || specification === '') {
    return [...ADMITTED_PRODUCTION_GRID_RESOLUTIONS];
  }
  const selected = String(specification).split(',').map(value => Number(value.trim()));
  if (selected.some(resolution => !Number.isInteger(resolution))) {
    throw new Error(`invalid resolution list: ${specification}`);
  }
  const seen = new Set();
  for (const resolution of selected) {
    if (!ADMITTED_PRODUCTION_GRID_RESOLUTIONS.includes(resolution)) {
      throw new Error(`resolution is not runtime-admitted: ${resolution}`);
    }
    if (seen.has(resolution)) throw new Error(`duplicate resolution: ${resolution}`);
    seen.add(resolution);
  }
  return selected;
}

export function selectFootprintSweepRadii(specification) {
  const selected = specification === undefined || specification === null || specification === true || specification === ''
    ? [...DEFAULT_FOOTPRINT_SWEEP_RADII]
    : String(specification).split(',').map(value => Number(value.trim()));
  if (selected.length < 2 || selected.some(radius => !Number.isFinite(radius))) {
    throw new Error(`invalid footprint sweep radii: ${specification}`);
  }
  for (let index = 0; index < selected.length; index += 1) {
    const radius = selected[index];
    if (radius < 0.35 || radius > 1.5) throw new Error(`footprint radius outside runtime range: ${radius}`);
    if (index > 0 && !(radius < selected[index - 1])) {
      throw new Error(`footprint sweep must be strictly descending: ${selected.join(',')}`);
    }
  }
  return selected;
}
const UNADMITTED_PRODUCTION_GRID_HYPOTHESES = [
  {
    resolution: 80,
    status: 'not-runtime-admitted',
    role: 'background-production-hypothesis',
    evidenceDisposition: 'no-runtime-economics-claim',
  },
  {
    resolution: 92,
    status: 'not-runtime-admitted',
    role: 'primary-production-hypothesis',
    evidenceDisposition: 'use-96-as-explicit-upper-grid-proxy-not-substitute',
  },
];
const REFERENCE_GRID_CELL_COUNT = 4096000;
const PRODUCTION_GRID_CELL_COUNTS = new Map([[96, 884736], [128, 2097152], [160, 4096000]]);
const SELECTED_PRODUCTION_GRID_RESOLUTIONS = selectBenchmarkResolutions(args.get('--resolutions'));
const FOOTPRINT_SWEEP_REQUESTED = args.has('--footprint-sweep-radii');
const FOOTPRINT_SWEEP_RADII = FOOTPRINT_SWEEP_REQUESTED
  ? selectFootprintSweepRadii(args.get('--footprint-sweep-radii'))
  : [];
const FOOTPRINT_TIER_SWEEP_REQUESTED = args.has('--footprint-tier-sweep');
const FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED = args.has('--footprint-tier-oracle-sweep');
const ANY_FOOTPRINT_TIER_SWEEP_REQUESTED = FOOTPRINT_TIER_SWEEP_REQUESTED || FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED;
const ACTIVE_FOOTPRINT_TIER_ARMS = FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED
  ? TARGET_ORACLE_FOOTPRINT_TIER_ARMS
  : DEFAULT_FOOTPRINT_TIER_ARMS;
if (FOOTPRINT_TIER_SWEEP_REQUESTED && FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED) {
  throw new Error('ordinary and target-oracle footprint tier sweeps are mutually exclusive');
}
if (FOOTPRINT_SWEEP_REQUESTED && ANY_FOOTPRINT_TIER_SWEEP_REQUESTED) {
  throw new Error('footprint radius and tier sweeps are mutually exclusive');
}
if ((FOOTPRINT_SWEEP_REQUESTED || ANY_FOOTPRINT_TIER_SWEEP_REQUESTED)
  && (SELECTED_PRODUCTION_GRID_RESOLUTIONS.length !== 1 || SELECTED_PRODUCTION_GRID_RESOLUTIONS[0] !== 96)) {
  throw new Error('footprint sweep requires the single admitted Grid96 arm');
}
const CASES = SELECTED_PRODUCTION_GRID_RESOLUTIONS.map(resolution => ({
  id: `res${String(resolution).padStart(3, '0')}-rs100`,
  resolution,
  gridCellCount: PRODUCTION_GRID_CELL_COUNTS.get(resolution),
  renderScale: 1,
  deviceScaleFactor,
  viewport: windowSize,
  ...((FOOTPRINT_SWEEP_REQUESTED || ANY_FOOTPRINT_TIER_SWEEP_REQUESTED) ? {
    boundarySplatMode: 'analytic_conserved',
    boundarySplatRadius: ANY_FOOTPRINT_TIER_SWEEP_REQUESTED ? 0.56 : FOOTPRINT_SWEEP_RADII[0],
  } : {}),
}));

export function exactGridCellReceipt(resolution) {
  const numerator = PRODUCTION_GRID_CELL_COUNTS.get(Number(resolution));
  if (!Number.isInteger(numerator)) return null;
  return {
    numerator,
    denominator: REFERENCE_GRID_CELL_COUNT,
    approximate: numerator / REFERENCE_GRID_CELL_COUNT,
  };
}

export function benchmarkRoute(testCase) {
  const url = new URL('/', origin);
  for (const [key, value] of ACCEPTED_FULL_SUPPORT_BASIN.requestedUrl.searchParams) {
    if (key === 'kaminos_volume_smoke' || key.startsWith('volume_')) url.searchParams.set(key, value);
  }
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_resolution', String(testCase.resolution));
  url.searchParams.set('volume_boundary_sidecar_source', 'baked');
  url.searchParams.set('volume_boundary_splat_mode', String(testCase.boundarySplatMode || 'analytic'));
  if (Number.isFinite(Number(testCase.boundarySplatRadius))) {
    url.searchParams.set('volume_boundary_splat_radius', String(Number(testCase.boundarySplatRadius)));
  }
  url.searchParams.set('volume_render_scale', String(testCase.renderScale));
  url.searchParams.set('volume_quality_reason', ACCEPTED_FULL_SUPPORT_BASIN_QUALITY_REASON);
  return url.toString();
}

function writeReport(report) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    schema: BOUNDARY_SPLAT_BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    origin,
    out,
    artifactDir,
    debugPort,
    settleMs,
    windowSize,
    deviceScaleFactor,
    userDataDir,
    acceptedFullSupportBasin: acceptedFullSupportBasinReceipt(),
    admittedProductionGridResolutions: ADMITTED_PRODUCTION_GRID_RESOLUTIONS,
    selectedProductionGridResolutions: SELECTED_PRODUCTION_GRID_RESOLUTIONS,
    footprintSweep: FOOTPRINT_SWEEP_REQUESTED ? {
      identity: 'held-state-analytic-conserved-footprint-sweep-v0',
      radii: FOOTPRINT_SWEEP_RADII,
      fixedGrid: 96,
      conservationAuthority: 'analytic-conserved-area-opacity-v0',
    } : null,
    footprintTierSweep: ANY_FOOTPRINT_TIER_SWEEP_REQUESTED ? {
      identity: FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED
        ? 'held-state-target-salience-oracle-footprint-tier-sweep-v0'
        : 'held-state-candidate-local-conserved-footprint-tier-sweep-v0',
      arms: ACTIVE_FOOTPRINT_TIER_ARMS,
      fixedGrid: 96,
      candidateAuthority: 'unchanged-native-cell-selection-before-footprint-charging-v0',
      conservationAuthority: 'analytic-conserved-area-opacity-v0',
    } : null,
    unadmittedProductionGridHypotheses: UNADMITTED_PRODUCTION_GRID_HYPOTHESES,
    productionGridProxyContract: {
      requestedProductionGrid: 92,
      admittedProxyGrid: 96,
      authority: 'explicit-upper-grid-proxy-not-exact-production-substitute',
    },
    ...report,
  }, null, 2)}\n`);
}

function initialFalseClosureChecks() {
  return {
    fallbackRoute: false,
    requestedEffectiveRendererDisagreement: false,
    unexpectedCompositionIdentity: false,
    missingTimestampSupport: false,
    staleOrDefaultConfig: false,
    missingAcceptedBasinReceipt: false,
    mismatchedAcceptedBasinReceipt: false,
    mismatchedRaymarchQuality: false,
    blankOrPartialReport: false,
    multipleParallelBrowsers: false,
    missingBrowserInstanceIdentity: false,
    mismatchedBrowserInstanceIdentity: false,
    mismatchedScreenConditions: false,
    mismatchedDeviceScaleFactor: false,
    missingWarmGpuProfileSeries: false,
    incompleteFootprintAudit: false,
    incompleteFootprintSweep: false,
    incompleteFootprintTierSweep: false,
    mismatchedFootprintTierPopulation: false,
    mismatchedFootprintTierCalibration: false,
    missingFootprintTierTargetComparison: false,
    invalidFootprintTierOracle: false,
    incompleteWorkloadReceipt: false,
    staleCountAuthority: false,
    capacityTruncatedWorkload: false,
  };
}

function numericDistribution(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const quantile = fraction => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  return {
    samples: sorted.length,
    min: sorted[0],
    median: quantile(0.5),
    p95: quantile(0.95),
    max: sorted.at(-1),
  };
}

export function summarizeGpuProfileSeries(series) {
  const samples = Array.isArray(series?.samples) ? series.samples : [];
  const warmupSamples = Number(series?.warmupSamples || 0);
  const measured = samples.slice(warmupSamples);
  const stageNames = [
    'simulation',
    'sidecar',
    'compaction',
    'candidateCopy',
    'indirectSetup',
    'splatRaster',
    'matchedRaymarchRaster',
    'total',
  ];
  return {
    identity: series?.identity || null,
    requestedSamples: Number(series?.requestedSamples || 0),
    warmupSamples,
    measuredSamples: measured.length,
    candidateCount: numericDistribution(measured.map(sample => sample.candidateCount)),
    instanceCount: numericDistribution(measured.map(sample => sample.instanceCount)),
    stages: Object.fromEntries(stageNames.map(stage => [
      stage,
      numericDistribution(measured.map(sample => sample.profile?.stages?.[stage]?.ms)),
    ])),
    rawSamples: samples,
  };
}

function profileHasStageTimes(profile) {
  const stages = profile?.stages || {};
  return [
    'simulation',
    'sidecar',
    'compaction',
    'candidateCopy',
    'indirectSetup',
    'splatRaster',
    'matchedRaymarchRaster',
    'total',
  ].every(stage => Number.isFinite(Number(stages[stage]?.ms)));
}

function isFiniteReceipt(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function workloadReceiptChecks(report) {
  const profile = report.boundarySplatGpuProfile || {};
  const copyDisposition = report.boundarySplatCopyDisposition || {};
  const workloadReceiptFields = [
    report.boundarySplatCapacity,
    report.boundarySplatCandidateCount,
    report.boundarySplatInstanceCount,
    report.boundarySplatOverflowCount,
    report.boundarySplatCopyBytesThisFrame,
    copyDisposition.effectiveCandidateCopyBytes,
    profile.candidateCopyBytes,
  ];
  const boundarySplatCapacity = Number(report.boundarySplatCapacity);
  const boundarySplatCandidateCount = Number(report.boundarySplatCandidateCount);
  const boundarySplatInstanceCount = Number(report.boundarySplatInstanceCount);
  const boundarySplatOverflowCount = Number(report.boundarySplatOverflowCount);
  return {
    incompleteWorkloadReceipt: workloadReceiptFields.some(value => !isFiniteReceipt(value))
      || boundarySplatCapacity <= 0
      || boundarySplatCandidateCount <= 0
      || boundarySplatInstanceCount <= 0,
    staleCountAuthority: report.boundarySplatCountAuthority !== EXPECTED_SPLAT_COUNT_AUTHORITY,
    capacityTruncatedWorkload: boundarySplatOverflowCount !== 0
      || boundarySplatCandidateCount > boundarySplatCapacity
      || boundarySplatInstanceCount > boundarySplatCapacity
      || boundarySplatInstanceCount > boundarySplatCandidateCount,
  };
}

export function basinReceiptChecks(report) {
  const controls = report?.controls;
  const entries = Object.entries(ACCEPTED_FULL_SUPPORT_BASIN_CONTROLS);
  const missingAcceptedBasinReceipt = !controls
    || entries.some(([key]) => controls[key] === null || controls[key] === undefined || controls[key] === '');
  const mismatchedAcceptedBasinReceipt = !missingAcceptedBasinReceipt && entries.some(([key, expected]) => {
    const effective = controls[key];
    if (typeof expected === 'number') return !Number.isFinite(Number(effective)) || Math.abs(Number(effective) - expected) > 1e-6;
    return effective !== expected;
  });
  return { missingAcceptedBasinReceipt, mismatchedAcceptedBasinReceipt };
}

export function footprintTierSweepReceiptChecks({ requested, expectedArms, sweep }) {
  if (!requested) {
    return {
      incompleteFootprintTierSweep: false,
      mismatchedFootprintTierPopulation: false,
      mismatchedFootprintTierCalibration: false,
      missingFootprintTierTargetComparison: false,
      invalidFootprintTierOracle: false,
    };
  }
  const expectedArmIds = expectedArms.map(arm => arm.id);
  const receivedArmIds = Array.isArray(sweep?.arms) ? sweep.arms.map(arm => arm?.id ?? null) : [];
  const mismatchedFootprintTierPopulation = expectedArms.some(expectedArm => {
    if (!expectedArm.matchCountsFrom) return false;
    const treatment = sweep?.arms?.find(arm => arm?.id === expectedArm.id);
    const control = sweep?.arms?.find(arm => arm?.id === expectedArm.matchCountsFrom);
    const treatmentCounts = treatment?.audit?.footprintTier?.counts;
    const controlCounts = control?.audit?.footprintTier?.counts;
    return !treatmentCounts
      || !controlCounts
      || treatmentCounts.base !== controlCounts.base
      || treatmentCounts.medium !== controlCounts.medium
      || treatmentCounts.hero !== controlCounts.hero;
  });
  const mismatchedFootprintTierCalibration = expectedArms.some(expectedArm => {
    if (!expectedArm.matchCountsFrom) return false;
    const treatment = sweep?.arms?.find(arm => arm?.id === expectedArm.id);
    const control = sweep?.arms?.find(arm => arm?.id === expectedArm.matchCountsFrom);
    const treatmentCounts = treatment?.audit?.footprintTier?.counts;
    const controlCounts = control?.audit?.footprintTier?.counts;
    const calibration = treatment?.matchedRandomTierThresholds;
    const requestedCounts = calibration?.requestedCounts;
    const candidateCount = controlCounts
      ? Number(controlCounts.base) + Number(controlCounts.medium) + Number(controlCounts.hero)
      : NaN;
    return treatment?.matchCountsFrom !== expectedArm.matchCountsFrom
      || calibration?.identity !== 'boundary-splat-held-cohort-random-tier-count-match-v0'
      || Number(calibration?.candidateCount) !== candidateCount
      || !controlCounts
      || !treatmentCounts
      || requestedCounts?.base !== controlCounts.base
      || requestedCounts?.medium !== controlCounts.medium
      || requestedCounts?.hero !== controlCounts.hero
      || !Number.isFinite(Number(calibration?.mediumThreshold))
      || !Number.isFinite(Number(calibration?.heroThreshold))
      || Number(calibration?.mediumThreshold) !== Number(treatment?.mediumThreshold)
      || Number(calibration?.heroThreshold) !== Number(treatment?.heroThreshold);
  });
  const target = sweep?.target;
  const targetVisual = target?.visual;
  const targetPassReceipt = targetVisual?.volumePresentationApplication;
  const targetPreview = targetVisual?.preview;
  const baselineArm = sweep?.arms?.find(arm => arm?.id === expectedArmIds[0]);
  const baselineVisual = baselineArm?.visual;
  const baselineAudit = baselineArm?.audit;
  const missingFootprintTierTargetComparison = target?.effectiveMode !== 'off'
    || target?.fallbackReason != null
    || target?.volumeReconstructionStyle !== 'native-resolution'
    || targetVisual?.sampleAuthority !== 'render-only-frozen-sim-state'
    || targetVisual?.simAdvanced !== false
    || targetVisual?.sameStateCaptureId !== 'footprint-tier-raymarch-target'
    || !Number.isInteger(Number(targetVisual?.simStepCount))
    || targetVisual?.simStepCount !== baselineVisual?.simStepCount
    || targetVisual?.effectiveRoute !== baselineVisual?.effectiveRoute
    || !Number.isInteger(Number(targetPreview?.width))
    || Number(targetPreview?.width) <= 0
    || !Number.isInteger(Number(targetPreview?.height))
    || Number(targetPreview?.height) <= 0
    || targetPassReceipt?.identity !== 'volume-presentation-applied-pass-receipt-v0'
    || targetPassReceipt?.compositionEffective !== 'raymarch-only-v0'
    || targetPassReceipt?.raymarchApplied !== true
    || targetPassReceipt?.splatsApplied !== false
    || targetPassReceipt?.fallbackReason != null
    || expectedArms.some(expectedArm => {
      const arm = sweep?.arms?.find(candidate => candidate?.id === expectedArm.id);
      const comparison = arm?.targetComparison;
      const comparisonWidth = Number(comparison?.width);
      const comparisonHeight = Number(comparison?.height);
      const comparisonPixelCount = Number(comparison?.pixelCount);
      const targetPeakPixelCount = Number(comparison?.targetPeakPixelCount);
      const rgbMaeNormalized = Number(comparison?.rgbMaeNormalized);
      const targetWeightedRgbMaeNormalized = Number(comparison?.targetWeightedRgbMaeNormalized);
      const targetPeakLumaRatio = Number(comparison?.targetPeakLumaRatio);
      return comparison?.identity !== 'same-state-rgba8-target-relative-footprint-tier-metrics-v0'
        || arm?.visual?.simStepCount !== targetVisual?.simStepCount
        || arm?.visual?.effectiveRoute !== targetVisual?.effectiveRoute
        || comparisonWidth !== Number(targetPreview?.width)
        || comparisonHeight !== Number(targetPreview?.height)
        || !Number.isInteger(comparisonPixelCount)
        || comparisonPixelCount !== comparisonWidth * comparisonHeight
        || !Number.isInteger(targetPeakPixelCount)
        || targetPeakPixelCount < 0
        || targetPeakPixelCount > comparisonPixelCount
        || !Number.isFinite(rgbMaeNormalized)
        || rgbMaeNormalized < 0
        || rgbMaeNormalized > 1
        || !Number.isFinite(targetWeightedRgbMaeNormalized)
        || targetWeightedRgbMaeNormalized < 0
        || targetWeightedRgbMaeNormalized > 1
        || !Number.isFinite(targetPeakLumaRatio)
        || targetPeakLumaRatio < 0;
    });
  const invalidFootprintTierOracle = expectedArms.some(expectedArm => {
    if (expectedArm.policy !== 'target_oracle') return false;
    const arm = sweep?.arms?.find(candidate => candidate?.id === expectedArm.id);
    const receipt = arm?.oracleReceipt;
    const auditedReceipt = arm?.audit?.footprintTier?.oracleReceipt;
    const counts = arm?.audit?.footprintTier?.counts;
    const targetCamera = targetVisual?.camera;
    const viewProjectionMatches = Array.isArray(receipt?.camera?.viewProjection)
      && Array.isArray(targetCamera?.viewProjection)
      && receipt.camera.viewProjection.length === targetCamera.viewProjection.length
      && receipt.camera.viewProjection.every(
        (value, index) => Math.abs(Number(value) - Number(targetCamera.viewProjection[index])) <= 1e-6,
      );
    const viewportMatches = Array.isArray(receipt?.camera?.viewport)
      && Array.isArray(targetCamera?.viewport)
      && receipt.camera.viewport.length === targetCamera.viewport.length
      && receipt.camera.viewport.every(
        (value, index) => Number(value) === Number(targetCamera.viewport[index]),
      );
    return receipt?.identity !== 'boundary-splat-target-salience-oracle-v0'
      || receipt?.status !== 'applied'
      || auditedReceipt?.status !== 'applied'
      || receipt?.oracleScoreSha256 !== auditedReceipt?.oracleScoreSha256
      || receipt?.targetPreviewSha256 !== targetVisual?.previewSha256
      || auditedReceipt?.targetPreviewSha256 !== targetVisual?.previewSha256
      || receipt?.candidatePositionSha256 !== baselineAudit?.candidatePositionSha256
      || receipt?.expectedCandidatePositionSha256 !== baselineAudit?.candidatePositionSha256
      || auditedReceipt?.candidatePositionSha256 !== baselineAudit?.candidatePositionSha256
      || arm?.audit?.candidatePositionSha256 !== baselineAudit?.candidatePositionSha256
      || receipt?.targetSameStateCaptureId !== targetVisual?.sameStateCaptureId
      || receipt?.simStepCount !== targetVisual?.simStepCount
      || receipt?.counts?.base !== counts?.base
      || receipt?.counts?.medium !== counts?.medium
      || receipt?.counts?.hero !== counts?.hero
      || !viewProjectionMatches
      || !viewportMatches;
  });
  return {
    incompleteFootprintTierSweep: sweep?.ok !== true
      || receivedArmIds.length !== expectedArmIds.length
      || receivedArmIds.some((id, index) => id !== expectedArmIds[index]),
    mismatchedFootprintTierPopulation,
    mismatchedFootprintTierCalibration,
    missingFootprintTierTargetComparison,
    invalidFootprintTierOracle,
  };
}

export function summarizeRun(testCase, reportPath, screenshotPath, report, options = {}) {
  const wrapper = report;
  report = report?.state && typeof report.state === 'object'
    ? {
        ...report.state,
        browserSession: report.browserSession ?? report.state.browserSession,
        boundarySplatGpuProfileSeries: report.boundarySplatGpuProfileSeries ?? report.state.boundarySplatGpuProfileSeries,
        boundarySplatFootprintAudit: report.boundarySplatFootprintAudit ?? report.state.boundarySplatFootprintAudit,
        boundarySplatFootprintSweep: report.boundarySplatFootprintSweep ?? report.state.boundarySplatFootprintSweep,
        boundarySplatFootprintTierSweep: report.boundarySplatFootprintTierSweep ?? report.state.boundarySplatFootprintTierSweep,
      }
    : report;
  const profile = report.boundarySplatGpuProfile || {};
  const profileSeries = summarizeGpuProfileSeries(report.boundarySplatGpuProfileSeries);
  const footprintAudit = report.boundarySplatFootprintAudit || null;
  const footprintSweep = report.boundarySplatFootprintSweep || null;
  const footprintTierSweep = report.boundarySplatFootprintTierSweep || null;
  const copyDisposition = report.boundarySplatCopyDisposition || {};
  const litPixels = Number(report.litPixels ?? report.mainRendererMetrics?.litPixels ?? 0);
  const meanLuma = Number(report.meanLuma ?? report.mainRendererMetrics?.meanLuma ?? 0);
  const boundarySplatCapacity = Number(report.boundarySplatCapacity);
  const boundarySplatCandidateCount = Number(report.boundarySplatCandidateCount);
  const boundarySplatInstanceCount = Number(report.boundarySplatInstanceCount);
  const boundarySplatOverflowCount = Number(report.boundarySplatOverflowCount);
  const boundarySplatCopyBytesThisFrame = Number(report.boundarySplatCopyBytesThisFrame);
  const falseClosureChecks = initialFalseClosureChecks();
  falseClosureChecks.fallbackRoute = report.boundarySplatFallbackReason != null;
  falseClosureChecks.requestedEffectiveRendererDisagreement = report.boundarySplatMode !== (testCase.boundarySplatMode || 'analytic')
    || report.boundarySplatRendererIdentity !== BOUNDARY_SPLAT_RENDERER_IDENTITY
    || report.boundarySplatSourceAuthority !== BOUNDARY_SPLAT_SOURCE_AUTHORITY;
  falseClosureChecks.unexpectedCompositionIdentity = report.volumeReconstructionStyle !== EXPECTED_BOUNDARY_SPLAT_COMPOSITION;
  falseClosureChecks.missingTimestampSupport = profile.timestampStatus !== 'available' || !profileHasStageTimes(profile);
  falseClosureChecks.staleOrDefaultConfig = Number(report.simGrid) !== testCase.resolution
    || Math.abs(Number(report.renderScale) - testCase.renderScale) > 0.02;
  falseClosureChecks.mismatchedDeviceScaleFactor = Number(report.nativeDevicePixelRatio) !== testCase.deviceScaleFactor
    || Number(report.canvasDevicePixelRatio) !== testCase.deviceScaleFactor;
  falseClosureChecks.missingWarmGpuProfileSeries = profileSeries.requestedSamples !== BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES
    || profileSeries.warmupSamples !== 2
    || profileSeries.measuredSamples !== BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES - 2
    || !profileSeries.stages.splatRaster
    || profileSeries.stages.splatRaster.samples !== BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES - 2;
  falseClosureChecks.incompleteFootprintAudit = footprintAudit?.ok !== true
    || Number(footprintAudit?.instanceCount || 0) <= 0;
  falseClosureChecks.incompleteFootprintSweep = FOOTPRINT_SWEEP_REQUESTED && (
    footprintSweep?.ok !== true
    || footprintSweep?.arms?.length !== FOOTPRINT_SWEEP_RADII.length
  );
  Object.assign(falseClosureChecks, footprintTierSweepReceiptChecks({
    requested: options.footprintTierSweepRequested ?? ANY_FOOTPRINT_TIER_SWEEP_REQUESTED,
    expectedArms: options.expectedFootprintTierArms ?? ACTIVE_FOOTPRINT_TIER_ARMS,
    sweep: footprintTierSweep,
  }));
  falseClosureChecks.mismatchedRaymarchQuality = !profile?.stages?.matchedRaymarchRaster;
  Object.assign(falseClosureChecks, workloadReceiptChecks(report));
  Object.assign(falseClosureChecks, basinReceiptChecks(report));
  falseClosureChecks.blankOrPartialReport = !Number.isFinite(litPixels)
    || litPixels <= 0
    || !report.boundarySplatGpuProfile
    || !report.boundarySplatCopyDisposition;

  const gridCellCount = testCase.gridCellCount;
  const nonProductionOracleSweep = options.footprintTierOracleSweepRequested
    ?? FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED;
  const boundedClaimAllowed = !Object.values(falseClosureChecks).some(Boolean)
    && !nonProductionOracleSweep;
  return {
    id: testCase.id,
    requestedRoute: benchmarkRoute(testCase),
    acceptedFullSupportBasin: acceptedFullSupportBasinReceipt(),
    witnessReportPath: reportPath,
    screenshotPath,
    resolution: testCase.resolution,
    gridCellCount,
    gridCellRatioTo160: exactGridCellReceipt(testCase.resolution),
    gridCellRatioTo160Approx: exactGridCellReceipt(testCase.resolution).approximate,
    simGrid: report.simGrid,
    renderScale: testCase.renderScale,
    deviceScaleFactor: testCase.deviceScaleFactor,
    viewport: testCase.viewport,
    effectiveRoute: report.effectiveRoute,
    volumeReconstructionStyle: report.volumeReconstructionStyle,
    backend: report.backend,
    browserSession: report.browserSession,
    renderWidth: report.renderWidth,
    renderHeight: report.renderHeight,
    nativeDevicePixelRatio: report.nativeDevicePixelRatio,
    canvasDevicePixelRatio: report.canvasDevicePixelRatio,
    boundarySplatMode: report.boundarySplatMode,
    boundarySplatRendererIdentity: report.boundarySplatRendererIdentity,
    boundarySplatSourceAuthority: report.boundarySplatSourceAuthority,
    boundarySplatCapacity,
    boundarySplatCandidateCount,
    boundarySplatInstanceCount,
    boundarySplatOverflowCount,
    boundarySplatCountAuthority: report.boundarySplatCountAuthority,
    boundarySplatFallbackReason: report.boundarySplatFallbackReason,
    boundarySplatGpuProfile: profile,
    boundarySplatGpuProfileSeries: profileSeries,
    boundarySplatFootprintAudit: footprintAudit,
    boundarySplatFootprintSweep: footprintSweep,
    boundarySplatFootprintTierSweep: footprintTierSweep,
    boundarySplatCopyDisposition: copyDisposition,
    boundarySplatCopyBytesThisFrame,
    litPixels,
    meanLuma,
    falseClosureChecks,
    economicsClaimAllowed: boundedClaimAllowed,
    optimizationClaimAllowed: boundedClaimAllowed,
    visualQualityClaimAllowed: false,
  };
}

async function readBrowserInstanceIdentity() {
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json());
  const webSocketDebuggerUrl = String(version.webSocketDebuggerUrl || '');
  const uuid = webSocketDebuggerUrl.match(/\/devtools\/browser\/([^/?#]+)/)?.[1] || null;
  return {
    uuid,
    webSocketDebuggerUrl,
    browser: version.Browser || null,
    protocolVersion: version['Protocol-Version'] || null,
  };
}

export function browserContinuityChecks(runs) {
  const successfulRuns = runs.filter(run => run.ok);
  const browserInstanceIdentities = successfulRuns
    .map(run => run.browserInstanceIdentity?.uuid)
    .filter(Boolean);
  const screenContracts = new Set(successfulRuns.map(run => JSON.stringify({
    renderScale: run.renderScale,
    deviceScaleFactor: run.deviceScaleFactor,
    viewport: run.viewport,
    renderWidth: run.renderWidth,
    renderHeight: run.renderHeight,
  })));
  return {
    multipleParallelBrowsers: new Set(successfulRuns.map(run => run.browserSession?.port).filter(Boolean)).size > 1,
    missingBrowserInstanceIdentity: browserInstanceIdentities.length !== successfulRuns.length,
    mismatchedBrowserInstanceIdentity: new Set(browserInstanceIdentities).size > 1,
    mismatchedScreenConditions: screenContracts.size > 1,
  };
}

export function economicsClaimAllowedFor(runs, falseClosureChecks) {
  return runs.length === CASES.length
    && runs.every(run => run.ok && run.economicsClaimAllowed)
    && !Object.values(falseClosureChecks).some(Boolean);
}

export function candidateScalingFor(runs) {
  return runs
    .filter(run => run.ok)
    .map(run => ({
      id: run.id,
      resolution: run.resolution,
      gridCellCount: run.gridCellCount,
      gridCellRatioTo160: run.gridCellRatioTo160,
      gridCellRatioTo160Approx: run.gridCellRatioTo160Approx,
      renderScale: run.renderScale,
      viewport: run.viewport,
      renderPixels: Number(run.renderWidth || 0) * Number(run.renderHeight || 0),
      boundarySplatCandidateCount: run.boundarySplatCandidateCount,
      boundarySplatOverflowCount: run.boundarySplatOverflowCount,
      candidateCopyBytes: run.boundarySplatCopyBytesThisFrame,
      timestampStatus: run.boundarySplatGpuProfile?.timestampStatus || null,
      splatRasterMs: run.boundarySplatGpuProfile?.stages?.splatRaster?.ms ?? null,
      matchedRaymarchRasterMs: run.boundarySplatGpuProfile?.stages?.matchedRaymarchRaster?.ms ?? null,
    }));
}

function runWitness(testCase, index) {
  const screenshotPath = resolve(artifactDir, `${testCase.id}.png`);
  const reportPath = resolve(artifactDir, `${testCase.id}.json`);
  const witnessArgs = [
    'volume-witness.mjs',
    '--url', benchmarkRoute(testCase),
    '--out', screenshotPath,
    '--report', reportPath,
    '--settle-ms', String(settleMs),
    '--window-size', testCase.viewport,
    '--device-scale-factor', String(testCase.deviceScaleFactor),
    '--boundary-splat-gpu-profile-samples', String(BOUNDARY_SPLAT_GPU_PROFILE_SAMPLES),
    '--boundary-splat-footprint-audit',
    '--debug-port', String(debugPort),
    '--user-data-dir', userDataDir,
    '--reuse-browser',
    '--keep-browser-open',
  ];
  if (FOOTPRINT_SWEEP_REQUESTED) {
    witnessArgs.push('--boundary-splat-footprint-sweep-radii', FOOTPRINT_SWEEP_RADII.join(','));
  }
  if (ANY_FOOTPRINT_TIER_SWEEP_REQUESTED) {
    witnessArgs.push('--boundary-splat-footprint-tier-arms', JSON.stringify(ACTIVE_FOOTPRINT_TIER_ARMS));
  }
  const result = spawnSync(process.execPath, witnessArgs, {
    cwd: new URL('.', import.meta.url).pathname,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    let partialReport = null;
    try {
      partialReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {}
    return {
      ok: false,
      id: testCase.id,
      phase: 'witness',
      requestedRoute: benchmarkRoute(testCase),
      command: [process.execPath, ...witnessArgs],
      status: result.status,
      signal: result.signal,
      stderr: result.stderr,
      reportPath,
      screenshotPath,
      boundarySplatFootprintSweep: partialReport?.boundarySplatFootprintSweep ?? null,
      witnessFailureReport: partialReport,
      economicsClaimAllowed: false,
      optimizationClaimAllowed: false,
      visualQualityClaimAllowed: false,
      falseClosureChecks: {
        ...initialFalseClosureChecks(),
        blankOrPartialReport: true,
      },
    };
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return {
    ok: true,
    serialIndex: index,
    ...summarizeRun(testCase, reportPath, screenshotPath, report),
  };
}

async function closeSharedBrowser() {
  try {
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json());
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', resolveOpen, { once: true });
      ws.addEventListener('error', rejectOpen, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
    await new Promise(resolveClose => {
      ws.addEventListener('close', resolveClose, { once: true });
      setTimeout(resolveClose, 500);
    });
    return { attempted: true, status: 'closed', leftAlive: false };
  } catch (error) {
    return { attempted: true, status: 'close-failed', leftAlive: true, error: error?.message || String(error) };
  }
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const runs = [];
  writeReport({
    status: 'running',
    phase: 'start',
    cases: CASES,
    runs,
    falseClosureChecks: initialFalseClosureChecks(),
    economicsClaimAllowed: false,
    optimizationClaimAllowed: false,
    visualQualityClaimAllowed: false,
  });

  let phase = 'runs';
  let browserClose = { attempted: false, status: 'not-started', leftAlive: false };
  try {
    for (const [index, testCase] of CASES.entries()) {
      const run = runWitness(testCase, index);
      if (run.ok) run.browserInstanceIdentity = await readBrowserInstanceIdentity();
      runs.push(run);
      writeReport({
        status: 'running',
        phase,
        cases: CASES,
        runs,
        browserClose,
        falseClosureChecks: initialFalseClosureChecks(),
        economicsClaimAllowed: false,
        optimizationClaimAllowed: false,
        visualQualityClaimAllowed: false,
      });
      if (!run.ok) break;
    }
  } catch (error) {
    runs.push({
      ok: false,
      phase,
      error: error?.message || String(error),
      economicsClaimAllowed: false,
      optimizationClaimAllowed: false,
      visualQualityClaimAllowed: false,
      falseClosureChecks: {
        ...initialFalseClosureChecks(),
        blankOrPartialReport: true,
      },
    });
  } finally {
    phase = 'browser-close';
    browserClose = await closeSharedBrowser();
  }

  const falseClosureChecks = initialFalseClosureChecks();
  falseClosureChecks.blankOrPartialReport = runs.length !== CASES.length || runs.some(run => !run.ok);
  Object.assign(falseClosureChecks, browserContinuityChecks(runs));
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.falseClosureChecks || {})) {
      falseClosureChecks[key] ||= Boolean(value);
    }
  }
  const economicsClaimAllowed = !FOOTPRINT_TIER_ORACLE_SWEEP_REQUESTED
    && economicsClaimAllowedFor(runs, falseClosureChecks);
  const optimizationClaimAllowed = economicsClaimAllowed;
  const status = economicsClaimAllowed ? 'valid-economics-evidence' : 'invalid-for-economics-claim';

  const candidateScaling = candidateScalingFor(runs);

  writeReport({
    status,
    phase: 'complete',
    cases: CASES,
    runs,
    candidateScaling,
    browserClose,
    falseClosureChecks,
    economicsClaimAllowed,
    optimizationClaimAllowed,
    visualQualityClaimAllowed: false,
    conclusion: economicsClaimAllowed
      ? 'Timestamp-backed same-screen splat/raymarch economics are claimable for these serial cases; the untuned basin grants no visual-quality authority.'
      : 'No economics claim is allowed: at least one false-closure check tripped, most likely missing timestamp support or mismatched screen conditions.',
  });

  console.log(JSON.stringify({
    status,
    out,
    browserClose,
    falseClosureChecks,
    economicsClaimAllowed,
    optimizationClaimAllowed,
    visualQualityClaimAllowed: false,
  }, null, 2));
  if (runs.some(run => !run.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    const browserClose = await closeSharedBrowser();
    writeReport({
      status: 'failed-before-primary-output',
      phase: 'top-level',
      error: error?.message || String(error),
      browserClose,
      falseClosureChecks: {
        ...initialFalseClosureChecks(),
        blankOrPartialReport: true,
      },
      economicsClaimAllowed: false,
      optimizationClaimAllowed: false,
      visualQualityClaimAllowed: false,
    });
    process.exitCode = 1;
  });
}
