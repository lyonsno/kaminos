import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fitterUrl = new URL('../smoke-gaussian-oracle-fitter.mjs', import.meta.url);
const {
  SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY,
  fitSmokeGaussianOracleFrame,
} = await import(fitterUrl);

assert.equal(SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY, 'smoke-gaussian-oracle-static-fit-v0');

const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeFrame(directory, mutate = {}) {
  await mkdir(directory, { recursive: true });
  const grid = 4;
  const values = new Float32Array(grid ** 3 * channels.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const offset = ((z * grid * grid) + (y * grid) + x) * channels.length;
        const leftPlume = x === 1 && y >= 1 && z <= 2;
        const rightPlume = x === 2 && y >= 1 && z >= 1;
        values[offset + 4] = leftPlume || rightPlume ? 0.5 + y * 0.1 : 0;
        values[offset + 0] = 0.01 * x;
        values[offset + 1] = 0.08;
        values[offset + 2] = -0.01 * z;
        values[offset + 5] = leftPlume ? 0.1 : 0.2;
      }
    }
  }
  const bytes = Buffer.from(values.buffer);
  const fluidPath = join(directory, 'frame.fluid.f32');
  await writeFile(fluidPath, bytes);
  const manifest = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    grid,
    fluidChannelOrder: channels,
    worldSpace: {
      coordinateFrame: 'kaminos-volume-world-v0',
      transformAuthority: 'native-volume-grid-world-transform-v0',
      bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
    },
    sidecars: {
      fluid: {
        kind: 'fluid',
        dtype: 'float32',
        byteOrder: 'little-endian',
        floatCount: values.length,
        byteLength: bytes.length,
        shape: [grid, grid, grid, channels.length],
        channelOrder: channels,
        path: 'frame.fluid.f32',
        sha256: sha256(bytes),
      },
    },
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      simStepCount: 12,
      completedSteps: 12,
      grid,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
    ...mutate,
  };
  const manifestPath = join(directory, 'frame.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function writeHeldFrame(directory) {
  await mkdir(directory, { recursive: true });
  const grid = 4;
  const values = new Float32Array(grid ** 3 * channels.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const offset = ((z * grid * grid) + (y * grid) + x) * channels.length;
        const plume = x >= 1 && x <= 2 && y >= 1 && z >= 1;
        values[offset + 4] = plume ? 0.35 + y * 0.12 : 0;
        values[offset] = 0.02 * x;
        values[offset + 1] = 0.09;
        values[offset + 2] = -0.01 * z;
        values[offset + 5] = plume ? 0.18 : 0;
      }
    }
  }
  const fluidBytes = Buffer.from(values.buffer);
  const frontBytes = Buffer.from(new Float32Array(grid ** 3).buffer);
  const boundaryBytes = Buffer.from(new Float32Array(grid ** 3 * 4).buffer);
  await writeFile(join(directory, 'held.fluid.f32'), fluidBytes);
  await writeFile(join(directory, 'held.front.f32'), frontBytes);
  await writeFile(join(directory, 'held.boundary.f32'), boundaryBytes);

  const sourceCaptureBytes = Buffer.from('{"schema":"kaminos.operator-live-basin-capture.v0","capture":"held-fixture"}\n');
  const sourceCapturePath = join(directory, 'source-capture.manifest.json');
  await writeFile(sourceCapturePath, sourceCaptureBytes);
  const descriptor = (kind, bytes, shape, channelOrder, url) => ({
    kind,
    dtype: 'float32',
    byteOrder: 'little-endian',
    floatCount: bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    byteLength: bytes.byteLength,
    shape,
    channelOrder,
    url,
    sha256: sha256(bytes),
  });
  const manifest = {
    schema: 'kaminos.volume.operator-basin-replay.v0',
    status: 'captured',
    failurePhase: null,
    captureId: 'operator-live-basin-held-fixture',
    source: {
      identity: 'operator-live-evolved-basin-v0',
      sourceSessionId: 'held-fixture-session',
      sourceCaptureManifest: 'source-capture.manifest.json',
      sourceCaptureManifestSha256: sha256(sourceCaptureBytes),
      backend: 'WebGPU:apple',
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    },
    grid,
    initialSimStepCount: 179290,
    initializationAuthority: 'offline-high-truth-held-render-only-v0',
    filterIdentity: 'phase-aligned-held-render-application-v0',
    layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
    camera: {
      position: [-4.2, 2.1, 8.2],
      target: [0, 0.02, 0],
      projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0],
      matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -9, 1],
    },
    fluid: descriptor('fluid', fluidBytes, [grid, grid, grid, channels.length], channels, './held.fluid.f32'),
    front: descriptor('front', frontBytes, [grid, grid, grid, 1], ['frontTopology'], './held.front.f32'),
    boundary: descriptor('boundary', boundaryBytes, [grid, grid, grid, 4], ['support', 'coverage', 'ridge', 'footprint'], './held.boundary.f32'),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = join(directory, 'viewer-manifest.json');
  await writeFile(manifestPath, manifestBytes);
  return {
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    sourceCapturePath,
    sourceCaptureBytes,
  };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-gaussian-oracle-fit-'));
try {
  const manifestPath = await writeFrame(directory);
  const outDir = join(directory, 'fit');
  const report = await fitSmokeGaussianOracleFrame({
    manifestPath,
    outDir,
    budgets: [1, 2, 4],
    maxIterations: 8,
    densityThreshold: 0.000001,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.identity, SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY);
  assert.equal(report.teacher.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(report.teacher.worldSpace.transformAuthority, 'native-volume-grid-world-transform-v0');
  assert.deepEqual(report.requestedBudgets, [1, 2, 4]);
  assert.equal(report.hiddenBudgetCapApplied, false);
  assert.equal(report.budgetCurve.length, 3);
  assert.ok(report.teacher.totalSmokeExtinction > 0);
  assert.equal(report.budgetCurve.every(entry => entry.activeGaussianCount === entry.requestedBudget), true);
  assert.equal(report.budgetCurve.every(entry => entry.totalAssignedExtinction > 0), true);
  assert.equal(report.budgetCurve.every(entry => entry.extinctionAccounting.relativeError < 1e-6), true);
  assert.equal(report.budgetCurve.every(entry => entry.covariance.axisSystem === 'jacobi-eigenbasis-3x3-v0'), true);
  assert.ok(report.budgetCurve[2].massWeightedSse <= report.budgetCurve[0].massWeightedSse);
  assert.ok(existsSync(report.budgetCurve[0].artifact.path), 'each budget writes a concrete Gaussian artifact');

  await assert.rejects(
    () => fitSmokeGaussianOracleFrame({
      manifestPath,
      outDir: join(directory, 'bad-budget'),
      budgets: [0],
    }),
    /positive integer budget/i,
    'invalid budgets must fail instead of silently substituting a cap',
  );

  const wrongRoute = await writeFrame(join(directory, 'wrong-route'), {
    effectiveRoute: 'cached-demo-route-v0',
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      simStepCount: 12,
      completedSteps: 12,
      grid: 4,
      effectiveRoute: 'cached-demo-route-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
  });
  await assert.rejects(
    () => fitSmokeGaussianOracleFrame({
      manifestPath: wrongRoute,
      outDir: join(directory, 'wrong-route-fit'),
      budgets: [1],
    }),
    /wrong effective route/i,
    'wrong or fallback teacher routes must not enter the oracle fitter',
  );

  const held = await writeHeldFrame(join(directory, 'held'));
  const heldReport = await fitSmokeGaussianOracleFrame({
    manifestPath: held.manifestPath,
    expectedManifestSha256: held.manifestSha256,
    outDir: join(directory, 'held-fit'),
    budgets: [2],
    maxIterations: 4,
  });
  assert.equal(heldReport.status, 'passed');
  assert.equal(heldReport.teacher.sourceSchema, 'kaminos.volume.operator-basin-replay.v0');
  assert.equal(heldReport.teacher.captureId, 'operator-live-basin-held-fixture');
  assert.equal(heldReport.teacher.simStepCount, 179290);
  assert.equal(heldReport.teacher.manifestIdentity, `sha256:${held.manifestSha256}`);
  assert.equal(heldReport.teacher.sourceCaptureIdentity, `sha256:${sha256(held.sourceCaptureBytes)}`);
  assert.match(heldReport.teacher.cameraIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(heldReport.teacher.worldSpace.transformAuthority, 'operator-basin-normalized-volume-domain-v0');

  await assert.rejects(
    () => fitSmokeGaussianOracleFrame({
      manifestPath: held.manifestPath,
      expectedManifestSha256: '0'.repeat(64),
      outDir: join(directory, 'wrong-held-manifest-fit'),
      budgets: [1],
    }),
    /requested manifest sha256 mismatch/i,
    'a held source cannot be silently substituted for the checksum requested by the assay',
  );

  await writeFile(held.sourceCapturePath, '{"changed":true}\n');
  await assert.rejects(
    () => fitSmokeGaussianOracleFrame({
      manifestPath: held.manifestPath,
      expectedManifestSha256: held.manifestSha256,
      outDir: join(directory, 'stale-source-capture-fit'),
      budgets: [1],
    }),
    /source capture sha256 mismatch/i,
    'the replay manifest cannot conceal a changed source capture',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke gaussian oracle fitter contracts passed');
