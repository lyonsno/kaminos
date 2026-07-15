import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const temporalUrl = new URL('../smoke-gaussian-oracle-temporal.mjs', import.meta.url);
const {
  SMOKE_GAUSSIAN_ORACLE_TEMPORAL_IDENTITY,
  analyzeSmokeGaussianTemporalCorrespondence,
} = await import(temporalUrl);

assert.equal(SMOKE_GAUSSIAN_ORACLE_TEMPORAL_IDENTITY, 'smoke-gaussian-oracle-temporal-correspondence-v0');

const gaussianChannels = [
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
  'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
  'radius0', 'radius1', 'radius2',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeGaussianArtifact(directory, budget, rows) {
  const values = new Float32Array(rows.length * gaussianChannels.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    values.set([
      row.position[0], row.position[1], row.position[2],
      0.01, 0, 0, 0.01, 0, 0.01,
      1, 0, 0, 0, 1, 0, 0, 0, 1,
      row.radius ?? 0.04, row.radius ?? 0.04, row.radius ?? 0.04,
      row.mass, 0.2, 0.1,
      row.velocity?.[0] ?? 0, row.velocity?.[1] ?? 0, row.velocity?.[2] ?? 0,
      row.sourceVoxelCount ?? 10,
    ], rowIndex * gaussianChannels.length);
  }
  const bytes = Buffer.from(values.buffer);
  const path = join(directory, `budget-${budget}.gaussians.f32`);
  await writeFile(path, bytes);
  return {
    path,
    sha256: `sha256:${sha256(bytes)}`,
    byteLength: bytes.byteLength,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [rows.length, gaussianChannels.length],
    channelOrder: gaussianChannels,
  };
}

async function writeStaticFitReport(directory, { step, budget = 3, rows, route = 'native-3d-compute-fluid-raymarch-v0' }) {
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, `sim-step-${step}.manifest.json`);
  const manifest = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: route,
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    grid: 16,
    worldSpace: {
      coordinateFrame: 'kaminos-volume-world-v0',
      transformAuthority: 'native-volume-grid-world-transform-v0',
      bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
    },
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      completedSteps: step,
      simStepCount: step,
      grid: 16,
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const artifact = await writeGaussianArtifact(directory, budget, rows);
  const representedExtinction = rows.reduce((sum, row) => sum + row.mass, 0);
  const report = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    teacher: {
      manifestPath,
      manifestIdentity: `synthetic-step-${step}`,
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      grid: 16,
      worldSpace: manifest.worldSpace,
      activeSmokeVoxelCount: 32,
      totalSmokeExtinction: representedExtinction,
      maxSmokeDensity: 0.5,
    },
    requestedBudgets: [budget],
    hiddenBudgetCapApplied: false,
    optimizer: {
      identity: 'deterministic-weighted-kmeans-anisotropic-moment-fit-v0',
      positionAuthority: 'continuous-mass-weighted-world-centroids',
      covarianceAuthority: 'cluster-smoke-density-weighted-world-covariance',
    },
    budgetCurve: [{
      requestedBudget: budget,
      activeGaussianCount: rows.length,
      totalAssignedExtinction: representedExtinction,
      massWeightedSse: 1,
      meanSquaredErrorPerExtinction: 0.01,
      extinctionAccounting: {
        teacherTotalExtinction: representedExtinction,
        representedExtinction,
        absoluteError: 0,
        relativeError: 0,
      },
      covariance: {
        axisSystem: 'jacobi-eigenbasis-3x3-v0',
        minRadius: 0.04,
        maxRadius: 0.04,
        maxEigenValue: 0.01,
      },
      support: {
        supportLeakageGaussianCount: 0,
        supportLeakageFraction: 0,
        maxThreeSigmaDiameter: 0.24,
      },
      artifact,
    }],
  };
  const reportPath = join(directory, 'oracle-fit-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-gaussian-temporal-'));
try {
  const first = await writeStaticFitReport(join(directory, 'step-10'), {
    step: 10,
    rows: [
      { position: [0, 0, 0], mass: 4, velocity: [0.02, 0, 0] },
      { position: [0.5, 0, 0], mass: 3 },
      { position: [-0.5, 0, 0], mass: 2 },
    ],
  });
  const second = await writeStaticFitReport(join(directory, 'step-11'), {
    step: 11,
    rows: [
      { position: [0.025, 0, 0], mass: 3.8 },
      { position: [0.53, 0, 0], mass: 2.7 },
      { position: [0.56, 0, 0], mass: 0.9 },
    ],
  });
  const third = await writeStaticFitReport(join(directory, 'step-12'), {
    step: 12,
    rows: [
      { position: [0.05, 0, 0], mass: 3.5 },
      { position: [0.55, 0, 0], mass: 3.1 },
      { position: [-0.72, 0, 0], mass: 1.1 },
    ],
  });

  const outDir = join(directory, 'temporal');
  const report = await analyzeSmokeGaussianTemporalCorrespondence({
    fitReports: [first, second, third],
    outDir,
    budgets: [3],
    maxMatchDistanceMultiplier: 3,
  });

  assert.equal(report.identity, SMOKE_GAUSSIAN_ORACLE_TEMPORAL_IDENTITY);
  assert.equal(report.status, 'passed');
  assert.equal(report.hiddenBudgetCapApplied, false);
  assert.deepEqual(report.requestedBudgets, [3]);
  assert.equal(report.frameSequence.length, 3);
  assert.deepEqual(report.frameSequence.map(frame => frame.simStepCount), [10, 11, 12]);
  assert.equal(report.frameSequence.every(frame => frame.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0'), true);
  assert.equal(report.budgetTransitions.length, 2);
  assert.equal(report.budgetTransitions[0].budget, 3);
  assert.ok(report.budgetTransitions[0].topology.splits.length >= 1, 'nearby duplicate child must be called out as a split/merge-risk event');
  assert.ok(report.budgetTransitions[1].topology.births.length >= 1, 'unmatched later support must be called out as a birth');
  assert.ok(report.budgetTransitions[1].topology.deaths.length >= 1, 'unmatched earlier support must be called out as a death');
  assert.ok(report.budgetTransitions[0].opticalDrift.totalExtinctionDelta < 0);
  assert.ok(report.budgetSummaries[0].maxP95Displacement >= report.budgetSummaries[0].maxMeanDisplacement);

  const wrongRoute = await writeStaticFitReport(join(directory, 'wrong-route'), {
    step: 13,
    route: 'cached-demo-route-v0',
    rows: [
      { position: [0, 0, 0], mass: 1 },
      { position: [0.1, 0, 0], mass: 1 },
      { position: [0.2, 0, 0], mass: 1 },
    ],
  });
  await assert.rejects(
    () => analyzeSmokeGaussianTemporalCorrespondence({
      fitReports: [first, wrongRoute],
      outDir: join(directory, 'wrong-route-temporal'),
      budgets: [3],
    }),
    /wrong effective route/i,
    'wrong or fallback static-fit teachers must not enter temporal correspondence evidence',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke gaussian oracle temporal contracts passed');
