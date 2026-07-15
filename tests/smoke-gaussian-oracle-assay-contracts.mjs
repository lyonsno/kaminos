import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../smoke-gaussian-oracle-assay.mjs', import.meta.url);
const moduleSource = await readFile(moduleUrl, 'utf8').catch(() => '');

assert.match(
  moduleSource,
  /export function validateSmokeGaussianOracleAssayReport/,
  'oracle assay must expose reusable report validation before any fitter can claim evidence',
);
assert.match(
  moduleSource,
  /export async function writeSmokeGaussianOracleFailureReport/,
  'oracle assay must write a durable failure report even when primary output fails',
);

const {
  SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY,
  validateSmokeGaussianOracleAssayReport,
  writeSmokeGaussianOracleFailureReport,
} = await import(moduleUrl);

assert.equal(SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY, 'smoke-gaussian-oracle-ceiling-assay-v0');

const validReport = {
  identity: SMOKE_GAUSSIAN_ORACLE_ASSAY_IDENTITY,
  status: 'passed',
  requestedTeacherRoute: 'native-3d-compute-fluid-raymarch-v0',
  effectiveTeacherRoute: 'native-3d-compute-fluid-raymarch-v0',
  requestedSequence: 'tall_plume',
  effectiveSequence: 'tall_plume',
  teacher: {
    rendererIdentity: 'native-3d-compute-fluid-raymarch-smoke-only-v0',
    sourceGeneration: 12,
    fallbackIdentity: null,
    denseStateAuthority: 'milky-near-far-phase-state-current-v0',
  },
  frames: [
    {
      frameId: 'sim-step-96',
      step: 96,
      status: 'passed',
      complete: true,
      stale: false,
      sourceManifestIdentity: 'sha256:manifest96',
      denseStateIdentity: 'sha256:dense96',
      opticalDepthIdentity: 'sha256:depth96',
      transmittanceIdentity: 'sha256:trans96',
      hdrReferenceIdentity: 'sha256:hdr96',
      worldSpace: {
        coordinateFrame: 'kaminos-volume-world-v0',
        transformAuthority: 'milky-current-state-transform-v0',
        extinctionCoefficient: 1.35,
        bounds: { minimum: [-1, -1, -1], maximum: [1, 2.5, 1] },
      },
    },
    {
      frameId: 'sim-step-97',
      step: 97,
      status: 'passed',
      complete: true,
      stale: false,
      sourceManifestIdentity: 'sha256:manifest97',
      denseStateIdentity: 'sha256:dense97',
      opticalDepthIdentity: 'sha256:depth97',
      transmittanceIdentity: 'sha256:trans97',
      hdrReferenceIdentity: 'sha256:hdr97',
      worldSpace: {
        coordinateFrame: 'kaminos-volume-world-v0',
        transformAuthority: 'milky-current-state-transform-v0',
        extinctionCoefficient: 1.35,
        bounds: { minimum: [-1, -1, -1], maximum: [1, 2.5, 1] },
      },
    },
  ],
  cameraSplit: {
    authority: 'explicit-disjoint-hostile-heldout-camera-split-v0',
    trainCameraIds: ['front', 'three-quarter-high'],
    heldOutCameraIds: ['grazing-hostile', 'back-high'],
    overlap: 0,
  },
  budgets: {
    authority: 'geometric-active-splat-budget-sweep-v0',
    hiddenCapApplied: false,
    activeCounts: [512, 1024, 2048, 4096],
    sweep: [
      { requestedActiveCount: 512, effectiveActiveCount: 512, outputWasTruncated: false },
      { requestedActiveCount: 1024, effectiveActiveCount: 1024, outputWasTruncated: false },
      { requestedActiveCount: 2048, effectiveActiveCount: 2048, outputWasTruncated: false },
      { requestedActiveCount: 4096, effectiveActiveCount: 4096, outputWasTruncated: false },
    ],
  },
  multiviewMetrics: {
    train: { cameraIds: ['front', 'three-quarter-high'], opticalDepthRmse: 0.04, structureSsim: 0.91 },
    heldOut: { cameraIds: ['grazing-hostile', 'back-high'], opticalDepthRmse: 0.08, structureSsim: 0.84 },
  },
  worldSpaceDiagnostics: {
    extinctionRetentionRatio: 0.998,
    supportLeakageFraction: 0.018,
    covarianceInflationP95: 1.8,
    deepOverlapOrderViolationFraction: 0.03,
  },
  temporalContinuation: {
    authority: 'warm-start-bounded-residual-smoke-correspondence-v0',
    frameIds: ['sim-step-96', 'sim-step-97'],
    correspondenceRetainedFraction: 0.82,
    births: 22,
    deaths: 14,
    splits: 6,
    merges: 4,
    opticalDriftHeldOutRmse: 0.05,
  },
  costs: {
    chargedGpu: {
      productBuildMs: 12,
      optimizerMs: 2200,
      rasterSortMs: 4,
      compositeMs: 2,
      raymarchTeacherMs: 36,
    },
  },
  visualWitnesses: [
    {
      kind: 'matched-raymarch',
      path: 'artifacts/smoke-gaussian-oracle-ceiling-0715/front-raymarch.png',
      sha256: 'sha256:raymarch',
      inspected: true,
      pixelStats: { width: 640, height: 360, nonzeroAlphaPixels: 1294, lumaP99: 0.44 },
      route: { requested: 'native-3d-compute-fluid-raymarch-v0', effective: 'native-3d-compute-fluid-raymarch-v0' },
    },
    {
      kind: 'oracle-fit-heldout',
      path: 'artifacts/smoke-gaussian-oracle-ceiling-0715/grazing-oracle.png',
      sha256: 'sha256:oracle',
      inspected: true,
      pixelStats: { width: 640, height: 360, nonzeroAlphaPixels: 1180, lumaP99: 0.39 },
      route: { requested: 'smoke-gaussian-oracle-ceiling-assay-v0', effective: 'smoke-gaussian-oracle-ceiling-assay-v0' },
    },
  ],
  verdict: {
    wall: 'representation',
    supported: true,
    rationale: 'fixture verdict only',
  },
};

const summary = validateSmokeGaussianOracleAssayReport(validReport);
assert.equal(summary.status, 'passed');
assert.equal(summary.frameCount, 2);
assert.equal(summary.heldOutCameraCount, 2);
assert.equal(summary.maximumRequestedActiveCount, 4096);

function invalid(mutator) {
  const candidate = structuredClone(validReport);
  mutator(candidate);
  return candidate;
}

assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.effectiveTeacherRoute = 'fallback-demo-smoke-v0'; })),
  /teacher route/i,
  'wrong or fallback teacher route cannot seed an oracle receipt',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => {
    report.cameraSplit.heldOutCameraIds = [];
    report.multiviewMetrics.heldOut.cameraIds = [];
  })),
  /held-out/i,
  'training-view-only closure must fail before visual quality is reported',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.frames[1].stale = true; })),
  /stale/i,
  'stale teacher frames cannot impersonate a fresh temporal window',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.frames[0].complete = false; })),
  /partial|complete/i,
  'partial teacher frames cannot become authoritative optical evidence',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.budgets.hiddenCapApplied = true; })),
  /hidden cap/i,
  'silent budget caps must be reported as assay failure',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.budgets.sweep[2].effectiveActiveCount = 1536; })),
  /effective active/i,
  'effective active-count changes cannot hide behind requested budget labels',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { delete report.frames[0].worldSpace.transformAuthority; })),
  /world-space|transform/i,
  'dense smoke frames must carry world-space transform authority',
);
assert.throws(
  () => validateSmokeGaussianOracleAssayReport(invalid(report => { report.visualWitnesses[1].pixelStats.nonzeroAlphaPixels = 0; })),
  /blank/i,
  'blank visual output must fail loud instead of looking like a receipt',
);

const failureDir = await mkdtemp(join(tmpdir(), 'kaminos-oracle-failure-'));
try {
  const reportPath = join(failureDir, 'failure-report.json');
  const failureReport = await writeSmokeGaussianOracleFailureReport({
    reportPath,
    failurePhase: 'teacher-capture',
    requestedTeacherRoute: 'native-3d-compute-fluid-raymarch-v0',
    effectiveTeacherRoute: 'missing-route',
    requestedSequence: 'tall_plume',
    effectiveSequence: null,
    lastTrustworthyEvidence: {
      sourceGeneration: 12,
      frameId: 'sim-step-95',
      denseStateIdentity: 'sha256:last-good',
    },
    cause: 'synthetic capture failure',
  });
  assert.equal(existsSync(reportPath), true, 'failure report must be durable on disk');
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'teacher-capture');
  assert.equal(failureReport.lastTrustworthyEvidence.denseStateIdentity, 'sha256:last-good');
  const written = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(written.status, 'failed');
  assert.equal(written.failurePhase, 'teacher-capture');
  assert.match(written.cause, /synthetic capture failure/);
} finally {
  await rm(failureDir, { recursive: true, force: true });
}

console.log('smoke gaussian oracle assay contracts passed');
