import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';

const rendererUrl = new URL('../smoke-gaussian-oracle-renderer.mjs', import.meta.url);
const rendererSource = await readFile(rendererUrl, 'utf8');
assert.match(rendererSource, /args\.get\('--projection'\)/, 'native-camera projection must be selectable from the reproducible CLI');
assert.match(rendererSource, /args\.has\('--optimize-structure'\)/, 'direct structural optimization must be selectable from the reproducible CLI');
assert.match(rendererSource, /args\.has\('--optimize-geometry'\)/, 'multi-view geometry optimization must be selectable from the reproducible CLI');
assert.match(rendererSource, /args\.get\('--geometry-config'\)/, 'multi-view geometry inputs must come from an explicit file contract');
const {
  SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY,
  projectOrthographicGaussianFootprint,
  projectPerspectiveGaussianFootprint,
  buildPerspectiveGaussianBasis,
  renderSparseGaussianBasis,
  multiscaleStructuralLoss,
  optimizeGaussianExtinctionMasses,
  optimizeGaussianGeometryMultiView,
  optimizeSmokeGaussianGeometryProduct,
  optimizeSmokeGaussianStructureProduct,
  renderSmokeGaussianOracleWitness,
} = await import(rendererUrl);

assert.equal(SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY, 'smoke-gaussian-oracle-render-witness-v1');

const structureTarget = Float32Array.from([
  0, 0, 1, 1,
  0, 0.25, 1, 0.75,
  0, 0.5, 1, 0.5,
  0, 0, 1, 1,
]);
const identityStructure = multiscaleStructuralLoss({
  prediction: structureTarget,
  target: structureTarget,
  width: 4,
  height: 4,
  scales: [1, 2],
  valueWeight: 1,
  gradientWeight: 2,
});
assert.equal(identityStructure.totalLoss, 0);
assert.equal(identityStructure.gradient.every(value => value === 0), true);
assert.deepEqual(identityStructure.levels.map(level => level.scale), [1, 2]);

const smoothPrediction = Float32Array.from({ length: 16 }, () => 0.35);
const structureLoss = multiscaleStructuralLoss({
  prediction: smoothPrediction,
  target: structureTarget,
  width: 4,
  height: 4,
  scales: [1, 2],
  valueWeight: 1,
  gradientWeight: 2,
});
assert.ok(structureLoss.totalLoss > 0);
assert.ok(structureLoss.gradientLoss > 0, 'missing articulated edges must incur explicit gradient loss');
const probeIndex = 5;
const epsilon = 1e-4;
const plus = smoothPrediction.slice();
const minus = smoothPrediction.slice();
plus[probeIndex] += epsilon;
minus[probeIndex] -= epsilon;
const plusLoss = multiscaleStructuralLoss({ prediction: plus, target: structureTarget, width: 4, height: 4, scales: [1, 2], valueWeight: 1, gradientWeight: 2 }).totalLoss;
const minusLoss = multiscaleStructuralLoss({ prediction: minus, target: structureTarget, width: 4, height: 4, scales: [1, 2], valueWeight: 1, gradientWeight: 2 }).totalLoss;
const finiteDifference = (plusLoss - minusLoss) / (2 * epsilon);
assert.ok(Math.abs(structureLoss.gradient[probeIndex] - finiteDifference) < 1e-4, 'analytic structural gradient must match finite difference');

const toyBasis = [
  { indices: Uint32Array.from([0, 1, 4, 5, 8, 9, 12, 13]), values: Float32Array.from({ length: 8 }, () => 1) },
  { indices: Uint32Array.from([2, 3, 6, 7, 10, 11, 14, 15]), values: Float32Array.from({ length: 8 }, () => 1) },
];
const toyTarget = new Float32Array(16);
for (let index = 0; index < toyTarget.length; index += 1) {
  const depth = index % 4 < 2 ? 3 : 1;
  toyTarget[index] = 1 - Math.exp(-0.5 * depth);
}
const optimizedMasses = optimizeGaussianExtinctionMasses({
  basis: toyBasis,
  initialMasses: Float64Array.from([2, 2]),
  target: toyTarget,
  width: 4,
  height: 4,
  extinctionScale: 0.5,
  iterations: 120,
  learningRate: 0.08,
  scales: [1, 2],
  valueWeight: 1,
  gradientWeight: 2,
});
assert.equal(optimizedMasses.iterationCount, 120, 'requested optimizer iterations must not be silently capped');
assert.ok(optimizedMasses.finalLoss < optimizedMasses.initialLoss * 0.01, 'direct extinction optimization must materially reduce structural loss');
assert.ok(Math.abs(optimizedMasses.masses[0] - 3) < 0.05);
assert.ok(Math.abs(optimizedMasses.masses[1] - 1) < 0.05);
assert.ok(optimizedMasses.masses.every(value => value >= 0));
assert.ok(Math.abs(optimizedMasses.masses.reduce((sum, value) => sum + value, 0) - 4) < 1e-10, 'optimizer must conserve requested total extinction');

const tiltedFootprint = projectOrthographicGaussianFootprint([4, 1.5, 0.25, 1, 0.1, 2]);
assert.equal(tiltedFootprint.varianceX, 4, 'orthographic footprint preserves world X variance');
assert.equal(tiltedFootprint.covarianceXY, 1.5, 'orthographic footprint preserves covariance rotation instead of discarding it');
assert.equal(tiltedFootprint.varianceY, 1, 'orthographic footprint preserves world Y variance');
assert.ok(Math.abs(tiltedFootprint.determinant - 1.75) < 1e-12, 'projected covariance determinant is exact');
assert.ok(Math.abs(tiltedFootprint.inverseXX - (1 / 1.75)) < 1e-12);
assert.ok(Math.abs(tiltedFootprint.inverseXY - (-1.5 / 1.75)) < 1e-12);
assert.ok(Math.abs(tiltedFootprint.inverseYY - (4 / 1.75)) < 1e-12);
assert.ok(Math.abs(tiltedFootprint.normalization - (1 / (2 * Math.PI * Math.sqrt(1.75)))) < 1e-12);

const dilatedFootprint = projectOrthographicGaussianFootprint([4, 1.5, 0.25, 1, 0.1, 2], 0, 2);
assert.equal(dilatedFootprint.varianceX, 16, 'coverage dilation scales projected variance quadratically');
assert.equal(dilatedFootprint.covarianceXY, 6, 'coverage dilation preserves covariance orientation');
assert.equal(dilatedFootprint.varianceY, 4);
assert.ok(Math.abs(dilatedFootprint.determinant - 28) < 1e-12, '2x footprint dilation scales 2D determinant by 16');
assert.ok(Math.abs(dilatedFootprint.normalization - (tiltedFootprint.normalization / 4)) < 1e-12, 'mass normalization falls with projected area');

const perspectiveMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -11 / 9, -1,
  0, 0, -20 / 9, 0,
];
const identityViewMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const perspectiveFootprint = projectPerspectiveGaussianFootprint({
  position: [0, 0, -2],
  covariance: [0.04, 0, 0, 0.09, 0, 0.16],
  projectionMatrix: perspectiveMatrix,
  matrixWorldInverse: identityViewMatrix,
  width: 200,
  height: 100,
});
assert.equal(perspectiveFootprint.visible, true, 'front-facing Gaussian must survive native-camera projection');
assert.ok(Math.abs(perspectiveFootprint.pixelX - 100) < 1e-12, 'perspective mean projects through the recorded matrix');
assert.ok(Math.abs(perspectiveFootprint.pixelY - 50) < 1e-12);
assert.ok(Math.abs(perspectiveFootprint.varianceX - 100) < 1e-10, 'world covariance is pushed through the perspective Jacobian');
assert.ok(Math.abs(perspectiveFootprint.varianceY - 56.25) < 1e-10);
assert.ok(Math.abs(perspectiveFootprint.covarianceXY) < 1e-12);
assert.ok(Math.abs(perspectiveFootprint.determinant - 5625) < 1e-8);

const sparsePerspective = buildPerspectiveGaussianBasis({
  rows: [{
    position: [0, 0, -2],
    covariance: [0.04, 0, 0, 0.09, 0, 0.16],
    extinctionMass: 3,
  }],
  width: 200,
  height: 100,
  camera: { projectionMatrix: perspectiveMatrix, matrixWorldInverse: identityViewMatrix },
  coverageScale: 1,
});
assert.equal(sparsePerspective.visibleGaussianCount, 1);
assert.equal(sparsePerspective.basis.length, 1);
assert.ok(sparsePerspective.basis[0].indices.length > 0);
const sparseDepth = renderSparseGaussianBasis(sparsePerspective.basis, Float64Array.from([3]), 200 * 100);
assert.ok(sparseDepth[50 * 200 + 100] > 0, 'sparse basis must render nonblank projected optical depth');
const expectedCenterDepth = 3 * perspectiveFootprint.normalization * Math.exp(-0.5 * (
  perspectiveFootprint.inverseXX * 0.5 ** 2 + perspectiveFootprint.inverseYY * 0.5 ** 2
));
assert.ok(Math.abs(sparseDepth[50 * 200 + 100] - expectedCenterDepth) < 1e-8, 'sparse basis must use the exact perspective Gaussian contribution');

assert.equal(typeof optimizeGaussianGeometryMultiView, 'function', 'multi-view geometry refinement must be exported as a testable pure contract');
const shiftedViewMatrix = identityViewMatrix.slice();
shiftedViewMatrix[12] = -0.2;
const geometryInitialRows = [{
  position: [-0.12, -0.04, -2],
  covariance: [0.02, 0, 0, 0.02, 0, 0.02],
  extinctionMass: 2,
}];
const geometryTargetRows = [{
  position: [0.1, 0.06, -2],
  covariance: [0.035, 0.008, 0, 0.012, 0, 0.02],
  extinctionMass: 2,
}];
const geometryViews = [
  { id: 'camera-a', matrixWorldInverse: identityViewMatrix },
  { id: 'camera-b', matrixWorldInverse: shiftedViewMatrix },
].map(view => {
  const width = 48;
  const height = 32;
  const camera = { projectionMatrix: perspectiveMatrix, matrixWorldInverse: view.matrixWorldInverse };
  const targetBasis = buildPerspectiveGaussianBasis({ rows: geometryTargetRows, width, height, camera, coverageScale: 1 });
  const targetDepth = renderSparseGaussianBasis(targetBasis.basis, Float64Array.from([2]), width * height);
  return {
    id: view.id,
    width,
    height,
    camera,
    coverageScale: 1,
    extinctionScale: 1,
    weight: 1,
    target: Float32Array.from(targetDepth, value => 1 - Math.exp(-value)),
  };
});
const optimizedGeometry = optimizeGaussianGeometryMultiView({
  rows: geometryInitialRows,
  views: geometryViews,
  iterations: 80,
  positionLearningRate: 0.025,
  covarianceLearningRate: 0.015,
  maxCenterResidual: 0.4,
  maxLogScaleResidual: 1,
  maxCholeskyResidual: 0.15,
  scales: [1, 2],
  valueWeight: 1,
  gradientWeight: 1,
});
const initialCenterError = Math.hypot(
  geometryInitialRows[0].position[0] - geometryTargetRows[0].position[0],
  geometryInitialRows[0].position[1] - geometryTargetRows[0].position[1],
);
const finalCenterError = Math.hypot(
  optimizedGeometry.rows[0].position[0] - geometryTargetRows[0].position[0],
  optimizedGeometry.rows[0].position[1] - geometryTargetRows[0].position[1],
);
assert.equal(optimizedGeometry.identity, 'bounded-center-cholesky-adam-multiview-structure-v0');
assert.equal(optimizedGeometry.viewCount, 2);
assert.equal(optimizedGeometry.iterationCount, 80);
assert.equal(optimizedGeometry.hiddenIterationCapApplied, false);
assert.ok(optimizedGeometry.finalLoss < optimizedGeometry.initialLoss * 0.35, 'multi-view geometry must materially reduce displaced/reshaped target loss');
assert.ok(finalCenterError < initialCenterError * 0.35, 'multi-view image gradients must move the world-space center toward the target');
assert.notDeepEqual(optimizedGeometry.rows[0].covariance, geometryInitialRows[0].covariance, 'covariance refinement must update more than extinction or center');
assert.ok(optimizedGeometry.maximumCenterResidual <= 0.4 + 1e-12);
assert.ok(optimizedGeometry.maximumLogScaleResidual <= 1 + 1e-12);

const covarianceOnlyGeometry = optimizeGaussianGeometryMultiView({
  rows: geometryInitialRows,
  views: geometryViews,
  iterations: 12,
  optimizePositions: false,
  optimizeCovariances: true,
  positionLearningRate: 0.025,
  covarianceLearningRate: 0.015,
  maxCenterResidual: 0.4,
  maxLogScaleResidual: 1,
  maxCholeskyResidual: 0.15,
  scales: [1, 2],
});
assert.deepEqual(covarianceOnlyGeometry.rows[0].position, geometryInitialRows[0].position, 'a disabled center head must remain exact');
assert.notDeepEqual(covarianceOnlyGeometry.rows[0].covariance, geometryInitialRows[0].covariance, 'the enabled covariance head must still update');
assert.equal(covarianceOnlyGeometry.heads.position, 'disabled');
assert.equal(covarianceOnlyGeometry.heads.covariance, 'enabled');

const centerOnlyGeometry = optimizeGaussianGeometryMultiView({
  rows: geometryInitialRows,
  views: geometryViews,
  iterations: 12,
  optimizePositions: true,
  optimizeCovariances: false,
  positionLearningRate: 0.025,
  covarianceLearningRate: 0.015,
  maxCenterResidual: 0.4,
  maxLogScaleResidual: 1,
  maxCholeskyResidual: 0.15,
  scales: [1, 2],
});
assert.notDeepEqual(centerOnlyGeometry.rows[0].position, geometryInitialRows[0].position, 'the enabled center head must still update');
assert.deepEqual(centerOnlyGeometry.rows[0].covariance, geometryInitialRows[0].covariance, 'a disabled covariance head must remain exact');
assert.equal(centerOnlyGeometry.heads.position, 'enabled');
assert.equal(centerOnlyGeometry.heads.covariance, 'disabled');

const behindCamera = projectPerspectiveGaussianFootprint({
  position: [0, 0, 2],
  covariance: [0.04, 0, 0, 0.09, 0, 0.16],
  projectionMatrix: perspectiveMatrix,
  matrixWorldInverse: identityViewMatrix,
  width: 200,
  height: 100,
});
assert.equal(behindCamera.visible, false, 'behind-camera support cannot be mirrored into a plausible witness');
assert.equal(behindCamera.rejectionReason, 'behind-camera');

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

async function writeTinyPng(path) {
  const width = 8;
  const height = 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const hot = x >= 2 && x <= 5 && y >= 1 && y <= 6;
      rgba[offset] = hot ? 180 : 0;
      rgba[offset + 1] = hot ? 180 : 0;
      rgba[offset + 2] = hot ? 180 : 0;
      rgba[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(path, png);
  return png;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

async function writeGaussianArtifact(directory, budget, rows) {
  const values = new Float32Array(rows.length * gaussianChannels.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    values.set([
      row.position[0], row.position[1], row.position[2],
      0.01, 0, 0, 0.01, 0, 0.01,
      1, 0, 0, 0, 1, 0, 0, 0, 1,
      row.radius ?? 0.22, row.radius ?? 0.22, row.radius ?? 0.22,
      row.mass, 0.3, 0.1,
      0, 0, 0,
      12,
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

async function writeFitReport(directory, { route = 'native-3d-compute-fluid-raymarch-v0', camera = null, nativeCamera = false } = {}) {
  await mkdir(directory, { recursive: true });
  const raymarchPath = join(directory, 'teacher.png');
  const raymarchBytes = await writeTinyPng(raymarchPath);
  const artifact = await writeGaussianArtifact(directory, 2, [
    { position: [0, 0, 0], mass: 4 },
    { position: [0.35, 0.1, 0], mass: 2 },
  ]);
  const manifestPath = join(directory, 'frame.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: route,
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    grid: 8,
    worldSpace: {
      coordinateFrame: 'kaminos-volume-world-v0',
      transformAuthority: 'native-volume-grid-world-transform-v0',
      bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
    },
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      simStepCount: 7,
      completedSteps: 7,
      grid: 8,
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
  }, null, 2)}\n`);
  const reportPath = join(directory, 'oracle-fit-report.json');
  await writeFile(reportPath, `${JSON.stringify({
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    teacher: {
      manifestPath,
      manifestIdentity: 'synthetic',
      sourceSchema: camera && !nativeCamera ? 'kaminos.volume.operator-basin-replay.v0' : 'kaminos.volume.full-grid-field-export.v0',
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      fluidIdentity: `sha256:${'c'.repeat(64)}`,
      camera,
      cameraIdentity: camera ? `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}` : null,
      grid: 8,
      worldSpace: {
        coordinateFrame: 'kaminos-volume-world-v0',
        transformAuthority: camera && !nativeCamera ? 'operator-basin-normalized-volume-domain-v0' : 'native-volume-grid-world-transform-v0',
        bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
      },
      activeSmokeVoxelCount: 16,
      totalSmokeExtinction: 6,
      maxSmokeDensity: 0.5,
    },
    requestedBudgets: [2],
    hiddenBudgetCapApplied: false,
    budgetCurve: [{
      requestedBudget: 2,
      activeGaussianCount: 2,
      totalAssignedExtinction: 6,
      extinctionAccounting: {
        teacherTotalExtinction: 6,
        representedExtinction: 6,
        absoluteError: 0,
        relativeError: 0,
      },
      support: { supportLeakageFraction: 0, maxThreeSigmaDiameter: 1.32 },
      artifact,
    }],
    cameraEvaluation: camera ? {
      identity: 'smoke-oracle-camera-evaluation-product-v0',
      cameraId: 'recorded-native',
      role: 'calibration',
      fitAuthority: 'world-space-state-fit-camera-independent-v0',
    } : null,
  }, null, 2)}\n`);
  return { reportPath, raymarchPath, raymarchSha: `sha256:${sha256(raymarchBytes)}` };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-gaussian-renderer-'));
try {
  const { reportPath, raymarchPath, raymarchSha } = await writeFitReport(join(directory, 'fit'));
  const report = await renderSmokeGaussianOracleWitness({
    fitReportPath: reportPath,
    raymarchPngPath: raymarchPath,
    outDir: join(directory, 'render'),
    budgets: [2],
    extinctionScales: [0.04, 0.08],
    coverageScales: [1, 1.7],
  });
  assert.equal(report.identity, SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY);
  assert.equal(report.status, 'passed');
  assert.equal(report.teacher.raymarchSha256, raymarchSha);
  assert.equal(report.renderer.cameraAuthority, 'orthographic-world-proxy-not-native-camera-v0');
  assert.equal(report.renderer.projectionAuthority, 'exact-world-xy-covariance-line-integral-v0');
  assert.deepEqual(report.renderer.requestedCoverageScales, [1, 1.7]);
  assert.equal(report.hiddenBudgetCapApplied, false);
  assert.equal(report.budgetCurve[0].activeGaussianCount, 2);
  assert.ok(report.budgetCurve[0].metrics.renderActivePixels > 0, 'render witness must reject blank Gaussian output');
  assert.ok(report.budgetCurve[0].metrics.lumaMse >= 0);
  assert.ok([1, 1.7].includes(report.budgetCurve[0].selectedCoverageScale));
  assert.ok(existsSync(report.budgetCurve[0].images.renderPngPath));
  assert.ok(existsSync(report.budgetCurve[0].images.diffPngPath));
  assert.ok(existsSync(report.contactSheet.path));
  assert.equal((await readFile(report.contactSheet.path)).readUInt32BE(0), 0x89504e47, 'contact sheet must be a PNG');

  const lowRadianceReport = await renderSmokeGaussianOracleWitness({
    fitReportPath: reportPath,
    raymarchPngPath: raymarchPath,
    outDir: join(directory, 'low-radiance-render'),
    budgets: [2],
    extinctionScales: [0.0001],
    coverageScales: [1],
  });
  assert.equal(lowRadianceReport.status, 'passed', 'numerically nonzero low-radiance roles must not be mislabeled as blank');
  assert.equal(lowRadianceReport.budgetCurve[0].metrics.renderActivePixels, 0, 'semantic support occupancy remains thresholded independently');
  assert.ok(lowRadianceReport.budgetCurve[0].metrics.nonzeroRenderPixels > 0);
  assert.ok(lowRadianceReport.budgetCurve[0].metrics.maximumRenderLuma > 0);

  const heldCamera = {
    position: [0, 0, 2],
    target: [0, 0, 0],
    projectionMatrix: perspectiveMatrix,
    matrixWorldInverse: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -2, 1,
    ],
  };
  const held = await writeFitReport(join(directory, 'held'), { camera: heldCamera });
  const heldFit = JSON.parse(await readFile(held.reportPath, 'utf8'));
  const teacherValues = Float32Array.from({ length: 64 }, (_, index) => {
    const x = index % 8;
    const y = Math.floor(index / 8);
    return x >= 2 && x <= 5 && y >= 1 && y <= 6 ? 180 / 255 : 0;
  });
  const teacherBytes = Buffer.from(teacherValues.buffer);
  const teacherRadiancePath = join(directory, 'held', 'linear-smoke-radiance.f32');
  await writeFile(teacherRadiancePath, teacherBytes);
  const teacherReportPath = join(directory, 'held', 'dense-raymarch-teacher-report.json');
  await writeFile(teacherReportPath, `${JSON.stringify({
    schema: 'kaminos.smoke-dense-raymarch-teacher-report.v0',
    identity: 'smoke-dense-state-raymarch-teacher-v0',
    status: 'passed',
    source: {
      fitReportPath: held.reportPath,
      manifestIdentity: heldFit.teacher.manifestIdentity,
      fluidIdentity: heldFit.teacher.fluidIdentity,
      cameraIdentity: heldFit.teacher.cameraIdentity,
      effectiveRoute: heldFit.teacher.effectiveRoute,
      prototypeIdentity: heldFit.teacher.prototypeIdentity,
      backend: heldFit.teacher.backend,
      camera: heldFit.teacher.camera,
    },
    raymarch: { width: 8, height: 8, productionCompositorAuthority: false },
    pixelStats: { blank: false, nonzeroOpticalPixels: 24 },
    artifacts: {
      linearRadiance: {
        path: teacherRadiancePath,
        sha256: `sha256:${sha256(teacherBytes)}`,
        dtype: 'float32',
        byteOrder: 'little-endian',
        shape: [8, 8],
        byteLength: teacherBytes.byteLength,
      },
    },
  }, null, 2)}\n`);
  const structureProduct = await optimizeSmokeGaussianStructureProduct({
    fitReportPath: held.reportPath,
    teacherReportPath,
    outDir: join(directory, 'optimized-structure'),
    budget: 2,
    coverageScale: 1.5,
    extinctionScale: 1,
    iterations: 12,
    learningRate: 0.02,
    scales: [1, 2],
    valueWeight: 1,
    gradientWeight: 2,
  });
  assert.equal(structureProduct.status, 'passed');
  assert.equal(structureProduct.identity, 'smoke-gaussian-oracle-structure-optimization-v0');
  assert.equal(structureProduct.hiddenIterationCapApplied, false);
  assert.equal(structureProduct.trainView.cameraId, 'recorded-native');
  assert.equal(structureProduct.trainView.role, 'calibration');
  assert.equal(structureProduct.budget.activeGaussianCount, 2);
  assert.ok(existsSync(structureProduct.optimizedFitReportPath));
  assert.ok(existsSync(structureProduct.optimizedArtifact.path));
  assert.ok(Math.abs(structureProduct.extinctionAccounting.relativeError) < 1e-10);
  const durableFit = JSON.parse(await readFile(structureProduct.optimizedFitReportPath, 'utf8'));
  const durableArtifact = durableFit.budgetCurve[0].artifact;
  const durableBytes = await readFile(durableArtifact.path);
  const durableValues = new Float32Array(
    durableBytes.buffer,
    durableBytes.byteOffset,
    durableBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const durableMassChannel = durableArtifact.channelOrder.indexOf('extinctionMass');
  const durableMassSum = Array.from(
    { length: durableArtifact.shape[0] },
    (_, index) => durableValues[index * durableArtifact.shape[1] + durableMassChannel],
  ).reduce((sum, value) => sum + value, 0);
  assert.equal(
    structureProduct.extinctionAccounting.representedExtinction,
    durableMassSum,
    'extinction accounting must describe the serialized Float32 product, not pre-serialization optimizer values',
  );

  assert.equal(typeof optimizeSmokeGaussianGeometryProduct, 'function', 'multi-view geometry product wrapper must be exported');
  const geometryTargetRowsForProduct = [
    { position: [0.08, 0.04, 0], covariance: [0.015, 0.003, 0, 0.008, 0, 0.01], extinctionMass: 4 },
    { position: [0.43, 0.16, 0], covariance: [0.008, -0.002, 0, 0.016, 0, 0.01], extinctionMass: 2 },
  ];
  const secondCamera = structuredClone(heldCamera);
  secondCamera.matrixWorldInverse[12] = -0.2;
  const secondFitDirectory = join(directory, 'held-second-camera');
  await mkdir(secondFitDirectory, { recursive: true });
  const secondFit = structuredClone(heldFit);
  secondFit.teacher.camera = secondCamera;
  secondFit.teacher.cameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(secondCamera)))}`;
  secondFit.cameraEvaluation.cameraId = 'shifted-camera';
  secondFit.cameraEvaluation.role = 'held-out';
  const secondFitReportPath = join(secondFitDirectory, 'oracle-fit-report.json');
  await writeFile(secondFitReportPath, `${JSON.stringify(secondFit, null, 2)}\n`);

  const writeGeometryTeacher = async ({ fit, fitReportPath, camera, cameraId, directory: teacherDirectory }) => {
    await mkdir(teacherDirectory, { recursive: true });
    const width = 32;
    const height = 24;
    const targetBasis = buildPerspectiveGaussianBasis({ rows: geometryTargetRowsForProduct, width, height, camera, coverageScale: 1 });
    const targetDepth = renderSparseGaussianBasis(targetBasis.basis, Float64Array.from([4, 2]), width * height);
    const target = Float32Array.from(targetDepth, value => 1 - Math.exp(-value));
    const bytes = Buffer.from(target.buffer);
    const radiancePath = join(teacherDirectory, 'linear-smoke-radiance.f32');
    await writeFile(radiancePath, bytes);
    const reportPath = join(teacherDirectory, 'dense-raymarch-teacher-report.json');
    await writeFile(reportPath, `${JSON.stringify({
      schema: 'kaminos.smoke-dense-raymarch-teacher-report.v0',
      identity: 'smoke-dense-state-raymarch-teacher-v0',
      status: 'passed',
      source: {
        fitReportPath,
        manifestIdentity: fit.teacher.manifestIdentity,
        fluidIdentity: fit.teacher.fluidIdentity,
        cameraIdentity: fit.teacher.cameraIdentity,
        effectiveRoute: fit.teacher.effectiveRoute,
        prototypeIdentity: fit.teacher.prototypeIdentity,
        backend: fit.teacher.backend,
        camera,
      },
      raymarch: { width, height },
      pixelStats: { blank: false },
      artifacts: {
        linearRadiance: {
          path: radiancePath,
          sha256: `sha256:${sha256(bytes)}`,
          dtype: 'float32',
          byteOrder: 'little-endian',
          shape: [height, width],
          byteLength: bytes.byteLength,
        },
      },
    }, null, 2)}\n`);
    return reportPath;
  };
  const geometryTeacherA = await writeGeometryTeacher({
    fit: heldFit,
    fitReportPath: held.reportPath,
    camera: heldCamera,
    cameraId: 'recorded-native',
    directory: join(directory, 'geometry-teacher-a'),
  });
  const geometryTeacherB = await writeGeometryTeacher({
    fit: secondFit,
    fitReportPath: secondFitReportPath,
    camera: secondCamera,
    cameraId: 'shifted-camera',
    directory: join(directory, 'geometry-teacher-b'),
  });
  const geometryProduct = await optimizeSmokeGaussianGeometryProduct({
    sourceFitReportPath: held.reportPath,
    views: [
      { id: 'camera-a', fitReportPath: held.reportPath, teacherReportPath: geometryTeacherA, weight: 1 },
      { id: 'camera-b', fitReportPath: secondFitReportPath, teacherReportPath: geometryTeacherB, weight: 1 },
    ],
    outDir: join(directory, 'optimized-geometry'),
    budget: 2,
    downsampleFactor: 1,
    coverageScale: 1,
    extinctionScale: 1,
    iterations: 40,
    positionLearningRate: 0.02,
    covarianceLearningRate: 0.01,
    maxCenterResidual: 0.3,
    maxLogScaleResidual: 0.8,
    maxCholeskyResidual: 0.1,
    scales: [1, 2],
    valueWeight: 1,
    gradientWeight: 1,
  });
  assert.equal(geometryProduct.status, 'passed');
  assert.equal(geometryProduct.identity, 'smoke-gaussian-oracle-multiview-geometry-optimization-v0');
  assert.equal(geometryProduct.budget.activeGaussianCount, 2);
  assert.equal(geometryProduct.optimizer.hiddenIterationCapApplied, false);
  assert.equal(geometryProduct.views.length, 2);
  assert.equal(new Set(geometryProduct.views.map(view => view.cameraIdentity)).size, 2);
  assert.ok(geometryProduct.optimizer.finalLoss < geometryProduct.optimizer.initialLoss * 0.5);
  assert.ok(geometryProduct.extinctionAccounting.relativeError < 1e-6);
  assert.ok(existsSync(geometryProduct.optimizedArtifact.path));
  assert.ok(existsSync(geometryProduct.optimizedFitReportPath));
  const geometryFit = JSON.parse(await readFile(geometryProduct.optimizedFitReportPath, 'utf8'));
  assert.equal(geometryFit.optimizer.positionAuthority, 'bounded-multiview-image-gradient-center-residual-v0');
  assert.equal(geometryFit.optimizer.covarianceAuthority, 'bounded-positive-cholesky-multiview-image-gradient-v0');
  assert.equal(
    geometryFit.budgetCurve[0].support.authority,
    'optimized-world-space-three-sigma-bounds-v0',
    'optimized products must not inherit stale initializer support diagnostics',
  );
  assert.equal(geometryProduct.support.authority, 'optimized-world-space-three-sigma-bounds-v0');

  const staleGeometryTeacher = JSON.parse(await readFile(geometryTeacherB, 'utf8'));
  staleGeometryTeacher.source.cameraIdentity = `sha256:${'e'.repeat(64)}`;
  const staleGeometryTeacherPath = join(directory, 'geometry-teacher-b', 'stale-report.json');
  await writeFile(staleGeometryTeacherPath, `${JSON.stringify(staleGeometryTeacher, null, 2)}\n`);
  const failedGeometryOut = join(directory, 'failed-geometry');
  await assert.rejects(
    () => optimizeSmokeGaussianGeometryProduct({
      sourceFitReportPath: held.reportPath,
      views: [
        { id: 'camera-a', fitReportPath: held.reportPath, teacherReportPath: geometryTeacherA, weight: 1 },
        { id: 'camera-b', fitReportPath: secondFitReportPath, teacherReportPath: staleGeometryTeacherPath, weight: 1 },
      ],
      outDir: failedGeometryOut,
      budget: 2,
      iterations: 2,
      downsampleFactor: 1,
    }),
    /camera identity/i,
    'a stale teacher camera must fail before multi-view geometry optimization',
  );
  const failedGeometry = JSON.parse(await readFile(join(failedGeometryOut, 'geometry-optimization-report.json'), 'utf8'));
  assert.equal(failedGeometry.status, 'failed');
  assert.equal(failedGeometry.failurePhase, 'validate-views');

  const staleTeacher = JSON.parse(await readFile(teacherReportPath, 'utf8'));
  staleTeacher.source.cameraIdentity = `sha256:${'d'.repeat(64)}`;
  const staleTeacherPath = join(directory, 'held', 'stale-dense-raymarch-teacher-report.json');
  await writeFile(staleTeacherPath, `${JSON.stringify(staleTeacher, null, 2)}\n`);
  const failedOutDir = join(directory, 'failed-optimized-structure');
  await assert.rejects(
    () => optimizeSmokeGaussianStructureProduct({
      fitReportPath: held.reportPath,
      teacherReportPath: staleTeacherPath,
      outDir: failedOutDir,
      budget: 2,
      iterations: 2,
    }),
    /camera identity/i,
    'wrong teacher camera identity must not enter structural optimization',
  );
  const failedStructure = JSON.parse(await readFile(join(failedOutDir, 'structure-optimization-report.json'), 'utf8'));
  assert.equal(failedStructure.status, 'failed', 'failure before optimized product must still leave a durable report');
  const nativeReport = await renderSmokeGaussianOracleWitness({
    fitReportPath: held.reportPath,
    raymarchPngPath: held.raymarchPath,
    outDir: join(directory, 'native-render'),
    budgets: [2],
    extinctionScales: [1, 10],
    coverageScales: [1, 1.7],
    projectionMode: 'native-camera',
  });
  assert.equal(nativeReport.renderer.cameraAuthority, 'checksum-bound-fit-teacher-camera-v0');
  assert.equal(nativeReport.renderer.projectionAuthority, 'full-view-projection-jacobian-covariance-v0');
  assert.equal(nativeReport.renderer.cameraIdentity, heldCamera ? `sha256:${sha256(Buffer.from(JSON.stringify(heldCamera)))}` : null);
  assert.match(nativeReport.contactSheet.path, /perspective-render-contact-sheet\.png$/);
  assert.ok(nativeReport.budgetCurve[0].projectionDiagnostics.visibleGaussianCount > 0);

  const nativeFullGrid = await writeFitReport(join(directory, 'native-full-grid'), { camera: heldCamera, nativeCamera: true });
  const nativeFullGridReport = await renderSmokeGaussianOracleWitness({
    fitReportPath: nativeFullGrid.reportPath,
    raymarchPngPath: nativeFullGrid.raymarchPath,
    outDir: join(directory, 'native-full-grid-render'),
    budgets: [2],
    extinctionScales: [1],
    coverageScales: [1],
    projectionMode: 'native-camera',
  });
  assert.equal(nativeFullGridReport.status, 'passed', 'checksum-bound native full-grid captures must retain their recorded perspective camera');

  const staleCameraReport = JSON.parse(await readFile(held.reportPath, 'utf8'));
  staleCameraReport.teacher.camera.position[0] = 0.25;
  await writeFile(held.reportPath, `${JSON.stringify(staleCameraReport, null, 2)}\n`);
  await assert.rejects(
    () => renderSmokeGaussianOracleWitness({
      fitReportPath: held.reportPath,
      raymarchPngPath: held.raymarchPath,
      outDir: join(directory, 'stale-camera-render'),
      budgets: [2],
      projectionMode: 'native-camera',
    }),
    /camera identity mismatch/i,
    'changed camera matrices cannot retain a stale authoritative identity',
  );

  const wrong = await writeFitReport(join(directory, 'wrong'), { route: 'cached-demo-route-v0' });
  await assert.rejects(
    () => renderSmokeGaussianOracleWitness({
      fitReportPath: wrong.reportPath,
      raymarchPngPath: wrong.raymarchPath,
      outDir: join(directory, 'wrong-render'),
      budgets: [2],
    }),
    /wrong effective route/i,
    'wrong or fallback teacher routes must not enter render evidence',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke gaussian oracle renderer contracts passed');
