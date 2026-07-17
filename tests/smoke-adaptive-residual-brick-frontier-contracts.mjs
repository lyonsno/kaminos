import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildAdaptiveResidualBrickHierarchy,
  reconstructAdaptiveGrid,
  runSmokeAdaptiveResidualBrickFrontier,
  sampleRetainedFineGridTrilinear,
  selectResidualBricks,
} from '../smoke-adaptive-residual-brick-frontier.mjs';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function makeTailField(grid) {
  const values = new Float32Array(grid ** 3);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const index = x + y * grid + z * grid * grid;
        const dx = x - grid * 0.43;
        const dz = z - grid * 0.58;
        const plume = Math.exp(-(dx * dx + dz * dz) / 3.2) * (0.25 + 0.75 * y / (grid - 1));
        const articulated = ((x + 2 * y + 3 * z) % 5 === 0 ? 0.13 : 0);
        values[index] = 0.00035 + plume + articulated;
      }
    }
  }
  return values;
}

const grid = 8;
const source = makeTailField(grid);
const hierarchy = buildAdaptiveResidualBrickHierarchy({ values: source, grid, blockSize: 2 });
assert.equal(hierarchy.identity, 'mass-conserving-adaptive-residual-bricks-v0');
assert.equal(hierarchy.hiddenBrickCapApplied, false);
assert.equal(hierarchy.coarseGrid, 4);
assert.equal(hierarchy.brickCount, 64);
assert.ok(hierarchy.totalResidualEnergy > 0);
assert.ok(hierarchy.minimumSourceValue > 0, 'fixture carries a diffuse nonzero tail');
assert.ok(Math.abs(hierarchy.sourceMass - hierarchy.coarseMass) < 1e-6, 'coarse parent means conserve all source mass');
assert.ok(hierarchy.bricks.every(brick => Math.abs(brick.residualSum) < 1e-6), 'every complete parent residual has zero mass');

const none = selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: 0 });
const half = selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: 0.5 });
const all = selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: 1 });
assert.equal(none.selectedBrickCount, 0);
assert.ok(half.selectedBrickCount > 0 && half.selectedBrickCount < hierarchy.brickCount);
assert.equal(all.selectedBrickCount, hierarchy.brickCount);
assert.equal(none.hiddenBrickCapApplied, false);
assert.ok(half.actualRetainedResidualEnergyFraction >= 0.5);
assert.ok(half.maximumOmittedBrickOpticalDepthBound >= 0);
assert.ok(all.maximumOmittedBrickOpticalDepthBound === 0);
assert.deepEqual(
  selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: 0.5 }).selectedBrickIndices,
  half.selectedBrickIndices,
  'residual ranking and tie-breaking are deterministic',
);

const coarseOnly = reconstructAdaptiveGrid({ hierarchy, selection: none });
const partial = reconstructAdaptiveGrid({ hierarchy, selection: half });
const exact = reconstructAdaptiveGrid({ hierarchy, selection: all });
assert.ok(Math.abs(sum(coarseOnly.values) - sum(source)) < 1e-5, 'coarse-only reconstruction cannot drop diffuse tail mass');
assert.ok(Math.abs(sum(partial.values) - sum(source)) < 1e-5, 'partial refinement preserves exact mass');
assert.deepEqual(exact.values, source, 'full refinement must reconstruct every source cell exactly');
assert.equal(exact.maximumAbsoluteCellError, 0);
assert.ok(partial.maximumAbsoluteCellError <= coarseOnly.maximumAbsoluteCellError);
assert.ok(half.retainedFineCellCountWithHalo >= half.selectedBrickCount * 8);
assert.ok(half.retainedFineCellCountWithHalo < source.length);
assert.ok(half.retainedFineMask instanceof Uint8Array);
const guardedSelection = { ...half, retainedFineMask: new Uint8Array(half.retainedFineMask.length) };
const [guardedBx, guardedBy, guardedBz] = hierarchy.bricks[half.selectedBrickIndices[0]].coordinates;
const guardedPoint = [guardedBx, guardedBy, guardedBz].map(value => -1 + ((value * hierarchy.blockSize + 1) / grid) * 2);
assert.throws(
  () => sampleRetainedFineGridTrilinear({ hierarchy, selection: guardedSelection, point: guardedPoint }),
  /unretained fine cell/i,
  'the candidate sampler cannot hide full-grid reads behind modeled halo accounting',
);

assert.throws(
  () => buildAdaptiveResidualBrickHierarchy({ values: source, grid, blockSize: 3 }),
  /divide grid/i,
);
assert.throws(
  () => selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: 1.01 }),
  /between 0 and 1/i,
);

const scaleGrid = 64;
const scaleHierarchy = buildAdaptiveResidualBrickHierarchy({
  values: new Float32Array(scaleGrid ** 3).fill(0.01),
  grid: scaleGrid,
  blockSize: 1,
});
const scaleEndpoint = selectResidualBricks({ hierarchy: scaleHierarchy, retainedResidualEnergyFraction: 1 });
assert.equal(scaleEndpoint.selectedBrickCount, scaleGrid ** 3, 'full refinement must not overflow the argument stack at production-shaped brick counts');

async function writeFixture(directory) {
  await mkdir(directory, { recursive: true });
  const fixtureGrid = 8;
  const physical = makeTailField(fixtureGrid);
  const sidecar = new Float32Array(fixtureGrid ** 3 * 4);
  for (let index = 0; index < physical.length; index += 1) sidecar[index * 4] = physical[index];
  const sidecarBytes = Buffer.from(sidecar.buffer);
  const sidecarPath = join(directory, 'sidecar.f32');
  await writeFile(sidecarPath, sidecarBytes);

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
  const cameraIdentity = sha256(Buffer.from(JSON.stringify(camera)));
  const fit = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:test',
      grid: fixtureGrid,
      worldSpace: {
        transformAuthority: 'native-volume-grid-world-transform-v0',
        bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
      },
      camera,
      cameraIdentity,
    },
  };
  const fitBytes = Buffer.from(`${JSON.stringify(fit, null, 2)}\n`);
  const fitPath = join(directory, 'fit-report.json');
  await writeFile(fitPath, fitBytes);

  const matched = {
    schema: 'kaminos.smoke-matched-optics-falsifier-report.v0',
    identity: 'smoke-matched-optics-falsifier-v0',
    status: 'passed',
    hiddenCellCapApplied: false,
    effective: {
      route: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:test',
      cameraIdentity,
      grid: fixtureGrid,
      width: 40,
      height: 32,
      samplesPerCell: 1,
      extinctionCoefficient: 0.731,
      displayExposure: 8,
      opticalModel: 'beer-lambert-one-minus-exp-negative-depth-v0',
      productionCompositorAuthority: false,
    },
    lastTrustworthyEvidence: {
      sidecarPath,
      sidecarSha256: sha256(sidecarBytes),
      gaussianFitReportPath: fitPath,
      gaussianFitReportSha256: sha256(fitBytes),
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      backend: 'WebGPU:test',
      cameraIdentity,
    },
  };
  const matchedBytes = Buffer.from(`${JSON.stringify(matched, null, 2)}\n`);
  const matchedPath = join(directory, 'matched-optics-report.json');
  await writeFile(matchedPath, matchedBytes);
  return { matchedPath, matchedSha256: sha256(matchedBytes) };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-adaptive-bricks-'));
try {
  const fixture = await writeFixture(join(directory, 'source'));
  const outDir = join(directory, 'frontier');
  const report = await runSmokeAdaptiveResidualBrickFrontier({
    matchedOpticsReportPath: fixture.matchedPath,
    expectedMatchedOpticsReportSha256: fixture.matchedSha256,
    outDir,
    blockSizes: [2, 4],
    retainedResidualEnergyFractions: [0, 0.5, 1],
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.hiddenBrickCapApplied, false);
  assert.deepEqual(report.requested.blockSizes, [2, 4]);
  assert.deepEqual(report.requested.retainedResidualEnergyFractions, [0, 0.5, 1]);
  assert.equal(report.frontier.length, 6);
  assert.equal(report.frontier.filter(row => row.requestedRetainedResidualEnergyFraction === 1).every(row => row.comparisonToDense.maximumAbsoluteOpticalDepthError === 0), true);
  assert.equal(report.frontier.every(row => Math.abs(row.massAccounting.relativeError) < 1e-6), true);
  assert.equal(report.frontier.every(row => row.workAccounting.hiddenDenseTouchApplied === false), true);
  assert.equal(report.frontier.every(row => /^sha256:[0-9a-f]{64}$/.test(row.selectionIdentity)), true);
  assert.equal(report.frontier.every(row => existsSync(row.artifacts.selectedBrickIndices.path)), true);
  assert.equal(report.frontier.every(row => row.workAccounting.chargedSampleCount <= row.workAccounting.denseSampleCount), true);
  assert.equal(report.frontier.every(row => existsSync(row.artifacts.displayPng.path)), true);
  assert.ok(existsSync(report.contextHtml.path));

  await assert.rejects(
    () => runSmokeAdaptiveResidualBrickFrontier({
      matchedOpticsReportPath: fixture.matchedPath,
      expectedMatchedOpticsReportSha256: `sha256:${'0'.repeat(64)}`,
      outDir: join(directory, 'wrong-source'),
      blockSizes: [2],
      retainedResidualEnergyFractions: [0, 1],
    }),
    /matched-optics report sha256 mismatch/i,
  );
  const failed = JSON.parse(await readFile(join(directory, 'wrong-source', 'adaptive-residual-brick-frontier-report.json'), 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failurePhase, 'source-validation');
  assert.match(failed.error, /sha256 mismatch/i);

  await assert.rejects(
    () => runSmokeAdaptiveResidualBrickFrontier({
      matchedOpticsReportPath: fixture.matchedPath,
      expectedMatchedOpticsReportSha256: fixture.matchedSha256,
      outDir: join(directory, 'partial-frontier'),
      blockSizes: [2],
      retainedResidualEnergyFractions: [0, 0.5],
    }),
    /must include exact endpoints 0 and 1/i,
  );
  const partialFailure = JSON.parse(await readFile(join(directory, 'partial-frontier', 'adaptive-residual-brick-frontier-report.json'), 'utf8'));
  assert.equal(partialFailure.status, 'failed');
  assert.equal(partialFailure.failurePhase, 'request-validation');
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke adaptive residual brick frontier contracts passed');
