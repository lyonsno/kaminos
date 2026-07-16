import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../smoke-matched-optics-falsifier.mjs', import.meta.url);
const {
  buildConnectedSparseGrid,
  integrateGaussianExtinctionSegment,
  runSmokeMatchedOpticsFalsifier,
  sampleDenseGridTrilinear,
  sampleSparseGridTrilinear,
} = await import(moduleUrl);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function numericalGaussianIntegral({ origin, direction, start, end, mean, covariance, mass, steps = 200000 }) {
  const determinant = covariance[0] * covariance[3] * covariance[5];
  const normalization = mass / (Math.pow(2 * Math.PI, 1.5) * Math.sqrt(determinant));
  const dt = (end - start) / steps;
  let integral = 0;
  for (let index = 0; index < steps; index += 1) {
    const distance = start + (index + 0.5) * dt;
    const delta = origin.map((value, axis) => value + direction[axis] * distance - mean[axis]);
    const exponent = delta[0] ** 2 / covariance[0]
      + delta[1] ** 2 / covariance[3]
      + delta[2] ** 2 / covariance[5];
    integral += normalization * Math.exp(-0.5 * exponent) * dt;
  }
  return integral;
}

const grid = 4;
const dense = new Float32Array(grid ** 3);
dense[0] = 1;
dense[1] = 0.5;
dense[grid ** 3 - 1] = 0.25;
const sparse = buildConnectedSparseGrid({ values: dense, grid });
assert.equal(sparse.positiveCellCount, 3);
assert.equal(sparse.componentCount, 2, 'six-neighbor connectivity must distinguish disconnected smoke support');
assert.equal(sparse.hiddenCellCapApplied, false);
for (const point of [[-0.9, -0.9, -0.9], [-0.55, -0.8, -0.8], [0, 0, 0], [0.9, 0.9, 0.9]]) {
  assert.ok(Math.abs(
    sampleDenseGridTrilinear(dense, grid, [-1, -1, -1], [1, 1, 1], point)
      - sampleSparseGridTrilinear(sparse, [-1, -1, -1], [1, 1, 1], point),
  ) < 1e-12, 'connected sparse sampling must reconstruct the exact dense scalar field');
}

const gaussian = {
  origin: [0.15, -0.1, 2.4],
  direction: [0, 0, -1],
  start: 0.4,
  end: 4.2,
  mean: [0.05, 0.12, 0.1],
  covariance: [0.08, 0, 0, 0.05, 0, 0.12],
  mass: 1.7,
};
const analytic = integrateGaussianExtinctionSegment(gaussian);
const numerical = numericalGaussianIntegral(gaussian);
assert.ok(Math.abs(analytic - numerical) / numerical < 2e-7, 'closed-form finite-ray Gaussian extinction must match numerical quadrature');
assert.throws(
  () => integrateGaussianExtinctionSegment({ ...gaussian, covariance: [1, 0, 0, 1, 0, 0] }),
  /positive definite/i,
  'invalid covariance cannot silently become plausible extinction',
);

async function writeFixture(directory) {
  await mkdir(directory, { recursive: true });
  const fixtureGrid = 8;
  const sidecar = new Float32Array(fixtureGrid ** 3 * 4);
  let totalMass = 0;
  for (let z = 0; z < fixtureGrid; z += 1) {
    for (let y = 0; y < fixtureGrid; y += 1) {
      for (let x = 0; x < fixtureGrid; x += 1) {
        const nx = (x + 0.5) / fixtureGrid * 2 - 1;
        const ny = (y + 0.5) / fixtureGrid * 2 - 1;
        const nz = (z + 0.5) / fixtureGrid * 2 - 1;
        const value = nx * nx + ny * ny + nz * nz < 0.42 ? 0.7 : 0;
        const offset = (z * fixtureGrid * fixtureGrid + y * fixtureGrid + x) * 4;
        sidecar[offset] = value;
        totalMass += value;
      }
    }
  }
  const sidecarBytes = Buffer.from(sidecar.buffer);
  await writeFile(join(directory, 'sidecar.f32'), sidecarBytes);

  const channels = [
    'positionX', 'positionY', 'positionZ',
    'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
    'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
    'radius0', 'radius1', 'radius2', 'extinctionMass', 'densityWitness', 'temperatureWitness',
    'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
  ];
  const gaussianValues = new Float32Array(channels.length);
  gaussianValues.set([0, 0, 0], 0);
  gaussianValues.set([0.18, 0, 0, 0.18, 0, 0.18], 3);
  gaussianValues.set([1, 0, 0, 0, 1, 0, 0, 0, 1], 9);
  gaussianValues.set([Math.sqrt(0.18), Math.sqrt(0.18), Math.sqrt(0.18)], 18);
  gaussianValues[21] = totalMass;
  gaussianValues[27] = 1;
  const gaussianBytes = Buffer.from(gaussianValues.buffer);
  await writeFile(join(directory, 'combined.gaussians.f32'), gaussianBytes);

  const camera = {
    position: [0, 0, 3],
    target: [0, 0, 0],
    projectionMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -101 / 99, -1,
      0, 0, -200 / 99, 0,
    ],
    matrixWorldInverse: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -3, 1,
    ],
  };
  const fit = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      sourceSchema: 'kaminos.volume.full-grid-field-export.v0',
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:test',
      grid: fixtureGrid,
      worldSpace: {
        transformAuthority: 'native-volume-grid-world-transform-v0',
        bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
      },
      camera,
      cameraIdentity: `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`,
      totalSmokeExtinction: totalMass,
    },
    budgetCurve: [{
      requestedBudget: 1,
      activeGaussianCount: 1,
      extinctionAccounting: { teacherTotalExtinction: totalMass, representedExtinction: totalMass, relativeError: 0 },
      artifact: {
        path: 'combined.gaussians.f32',
        sha256: `sha256:${sha256(gaussianBytes)}`,
        byteLength: gaussianBytes.byteLength,
        dtype: 'float32',
        byteOrder: 'little-endian',
        shape: [1, channels.length],
        channelOrder: channels,
      },
    }],
  };
  const fitBytes = Buffer.from(`${JSON.stringify(fit, null, 2)}\n`);
  await writeFile(join(directory, 'combined.fit-report.json'), fitBytes);
  const oracle = {
    schema: 'kaminos.smoke-extinction-residual-oracle.v0',
    authority: 'exact-fluid-extinction-neighborhood-residual-oracle-v0',
    status: 'passed',
    hiddenCandidateCapApplied: false,
    effective: {
      route: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:test',
      grid: fixtureGrid,
    },
    sidecar: {
      path: 'sidecar.f32',
      sha256: `sha256:${sha256(sidecarBytes)}`,
      byteLength: sidecarBytes.byteLength,
      dtype: 'float32',
      byteOrder: 'little-endian',
      shape: [fixtureGrid, fixtureGrid, fixtureGrid, 4],
      channelOrder: ['physicalExtinction', 'coverage', 'ridge', 'residualExtinction'],
    },
    accounting: { physicalExtinctionMass: totalMass, combinedRelativeError: 0 },
    products: {
      combined: {
        role: 'coarse-plus-residual',
        count: 1,
        targetMass: totalMass,
        representedExtinction: totalMass,
        descriptor: fit.budgetCurve[0].artifact,
        fitPath: 'combined.fit-report.json',
      },
    },
  };
  const oracleBytes = Buffer.from(`${JSON.stringify(oracle, null, 2)}\n`);
  const oraclePath = join(directory, 'oracle-report.json');
  await writeFile(oraclePath, oracleBytes);
  return {
    oraclePath,
    oracleSha256: `sha256:${sha256(oracleBytes)}`,
    fitSha256: `sha256:${sha256(fitBytes)}`,
  };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-matched-optics-'));
try {
  const fixture = await writeFixture(join(directory, 'source'));
  const report = await runSmokeMatchedOpticsFalsifier({
    oracleReportPath: fixture.oraclePath,
    expectedOracleReportSha256: fixture.oracleSha256,
    expectedGaussianFitReportSha256: fixture.fitSha256,
    outDir: join(directory, 'witness'),
    width: 40,
    height: 32,
    samplesPerCell: 1,
    extinctionCoefficient: 0.731,
    displayExposure: 8,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.hiddenCellCapApplied, false);
  assert.equal(report.requested.extinctionCoefficient, 0.731);
  assert.equal(report.effective.extinctionCoefficient, 0.731);
  assert.equal(report.requested.displayExposure, 8);
  assert.equal(report.effective.displayExposure, 8);
  assert.deepEqual(report.roles.map(role => role.id), ['dense-direct', 'connected-sparse-grid', 'analytic-gaussian']);
  assert.equal(report.roles.every(role => role.opticalModel === 'beer-lambert-one-minus-exp-negative-depth-v0'), true);
  assert.equal(report.roles.every(role => role.extinctionCoefficient === 0.731), true);
  assert.equal(report.comparisons.connectedToDense.maximumAbsoluteOpticalDepthError, 0);
  assert.equal(report.comparisons.connectedToDense.luma.normalizedMse, 0);
  assert.ok(Number.isFinite(report.comparisons.gaussianToDense.luma.normalizedMse));
  assert.ok(report.comparisons.gaussianToDense.luma.normalizedMse >= 0);
  assert.ok(Number.isFinite(report.comparisons.gaussianToDense.luma.maximumErrorToTargetPeak));
  assert.ok(report.roles.every(role => role.nonzeroPixelCount > 0));
  assert.ok(report.roles.every(role => existsSync(role.artifacts.displayPng.path)));
  for (const role of report.roles) {
    const png = await readFile(role.artifacts.displayPng.path);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${role.id} must emit a decodable PNG signature`);
  }
  assert.ok(existsSync(report.contextHtml.path));

  await assert.rejects(
    () => runSmokeMatchedOpticsFalsifier({
      oracleReportPath: fixture.oraclePath,
      expectedOracleReportSha256: `sha256:${'0'.repeat(64)}`,
      expectedGaussianFitReportSha256: fixture.fitSha256,
      outDir: join(directory, 'wrong-source'),
      width: 16,
      height: 16,
      samplesPerCell: 1,
      extinctionCoefficient: 0.731,
      displayExposure: 8,
    }),
    /oracle report sha256 mismatch/i,
  );
  const failed = JSON.parse(await readFile(join(directory, 'wrong-source', 'matched-optics-report.json'), 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failurePhase, 'source-validation');
  assert.match(failed.error, /sha256 mismatch/i);

  await rm(join(directory, 'source', 'combined.gaussians.f32'));
  await assert.rejects(
    () => runSmokeMatchedOpticsFalsifier({
      oracleReportPath: fixture.oraclePath,
      expectedOracleReportSha256: fixture.oracleSha256,
      expectedGaussianFitReportSha256: fixture.fitSha256,
      outDir: join(directory, 'missing-gaussian'),
      width: 16,
      height: 16,
      samplesPerCell: 1,
      extinctionCoefficient: 0.731,
      displayExposure: 8,
    }),
    /gaussian artifact/i,
  );
  const missing = JSON.parse(await readFile(join(directory, 'missing-gaussian', 'matched-optics-report.json'), 'utf8'));
  assert.equal(missing.status, 'failed');
  assert.equal(missing.failurePhase, 'source-validation');
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke matched optics falsifier contracts passed');
