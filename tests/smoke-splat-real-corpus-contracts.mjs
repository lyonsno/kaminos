import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url);
const compiler = new URL('../scripts/compile-real-smoke-splat-corpus.mjs', import.meta.url);
const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeFrame(directory, step, mutate = {}) {
  const grid = 4;
  const values = new Float32Array(grid ** 3 * channels.length);
  for (let index = 0; index < grid ** 3; index += 1) {
    const offset = index * channels.length;
    const x = index % grid;
    const z = Math.floor(index / (grid * grid));
    const plume = x < grid / 2 && z < grid / 2;
    values[offset + 1] = 0.4;
    values[offset + 4] = plume ? 0.5 + step * 0.001 : 0.00025;
    values[offset + 5] = 0.2;
    values[offset + 7] = index % 3 === 0 ? 0.7 : 0.05;
    values[offset + 12] = index % 2 === 0 ? 0.6 : 0.02;
    values[offset + 13] = index % 7 === 0 ? 0.9 : 0.01;
  }
  const bytes = Buffer.from(values.buffer);
  const fluidPath = join(directory, `frame-${step}.fluid.f32`);
  writeFileSync(fluidPath, bytes);
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
    sidecars: {
      fluid: {
        kind: 'fluid',
        dtype: 'float32',
        byteOrder: 'little-endian',
        floatCount: values.length,
        byteLength: bytes.length,
        shape: [grid, grid, grid, channels.length],
        channelOrder: channels,
        path: fluidPath,
        sha256: sha256(bytes),
      },
    },
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      completedSteps: step,
      simStepCount: step,
      controlsSignature: 'fixture-controls-v0',
      grid,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
    ...mutate,
  };
  const manifestPath = join(directory, `frame-${step}.manifest.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

const directory = mkdtempSync(join(tmpdir(), 'kaminos-real-smoke-corpus-'));
const first = makeFrame(directory, 96);
const second = makeFrame(directory, 97);
const output = join(directory, 'output');
execFileSync(process.execPath, [
  compiler.pathname,
  '--frame', first,
  '--frame', second,
  '--out-dir', output,
  '--coarse-block-size', '2',
  '--fine-block-size', '1',
  '--articulation-threshold', '0.05',
  '--coarse-anchor-mass-ratio', '0.08',
  '--instance-count', '100',
  '--phase-slot-count', '4',
], { cwd: root.pathname, stdio: 'pipe' });

const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
assert.equal(report.status, 'passed');
assert.equal(report.requestedRoute, 'authoritative-full-grid-real-smoke-hierarchy-corpus-v0');
assert.equal(report.effectiveRoute, 'authoritative-full-grid-real-smoke-hierarchy-corpus-v0');
assert.equal(report.frames.length, 2);
assert.deepEqual(report.frameSplit.trainFrameIds, ['sim-step-96']);
assert.deepEqual(report.frameSplit.evaluationFrameIds, ['sim-step-97']);
assert.equal(report.frameSplit.authority, 'explicit-adjacent-step-holdout-v0');
assert.equal(report.frames.every(frame => frame.accounting.rejectedExtinctionMass === 0), true);
assert.equal(report.frames.every(frame => frame.capacity.outputWasTruncated === false), true);
assert.equal(report.requestedConfig.coarseAnchorMassRatio, 0.08);
assert.equal(report.frames.every(frame => frame.coarseConsolidation.identity === 'mass-preserving-anchor-voronoi-v1'), true);
assert.equal(report.frames.every(frame => frame.coarseConsolidation.enabled === true), true);
assert.equal(report.frames.every(frame => frame.coarseConsolidation.mergedSourceBinCount > 0), true);
assert.equal(
  report.frames.every(frame => frame.coarseConsolidation.spatialMomentAuthority === 'anchor-bin-only-tail-optical-transfer-v0'),
  true,
);
assert.equal(report.learnedSelector.heldOutProduct.coarseConsolidation.anchorMassRatio, 0.08);
assert.equal(report.temporalComparison.stepDelta, 1);
assert.ok(report.temporalComparison.sharedCoarseSpatialKeys > 0);
assert.ok(report.modelDataset.train.rowCount > 0);
assert.ok(report.modelDataset.evaluation.rowCount > 0);
assert.equal(report.runtimeBudgetEstimate.visibleInstanceCount, 100);
assert.equal(report.runtimeBudgetEstimate.uniquePhaseSlotCount, 4);
assert.equal(
  report.runtimeBudgetEstimate.estimatedRenderedSplatInstances,
  report.learnedSelector.heldOutProduct.hierarchyCounts.total * 100,
);
assert.equal(
  report.runtimeBudgetEstimate.estimatedStoredPhaseSplats,
  report.learnedSelector.heldOutProduct.hierarchyCounts.total * 4,
);
assert.equal(report.runtimeBudgetEstimate.hiddenCapApplied, false);

const corrupt = makeFrame(directory, 98);
const corruptManifest = JSON.parse(readFileSync(corrupt, 'utf8'));
corruptManifest.sidecars.fluid.sha256 = '0'.repeat(64);
writeFileSync(corrupt, `${JSON.stringify(corruptManifest, null, 2)}\n`);
const failedDir = join(directory, 'failed-hash');
const failed = spawnSync(process.execPath, [compiler.pathname, '--frame', corrupt, '--out-dir', failedDir], {
  cwd: root.pathname,
  encoding: 'utf8',
});
assert.notEqual(failed.status, 0);
const failedReport = JSON.parse(readFileSync(join(failedDir, 'report.json'), 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'source-artifact-validation');
assert.match(failedReport.message, /sha256/i);
assert.equal(failedReport.effectiveRoute, null);

const nonAdjacentDir = join(directory, 'failed-adjacency');
const step99 = makeFrame(directory, 99);
const nonAdjacent = spawnSync(process.execPath, [
  compiler.pathname, '--frame', first, '--frame', step99, '--out-dir', nonAdjacentDir,
], { cwd: root.pathname, encoding: 'utf8' });
assert.notEqual(nonAdjacent.status, 0);
const adjacencyReport = JSON.parse(readFileSync(join(nonAdjacentDir, 'report.json'), 'utf8'));
assert.equal(adjacencyReport.failurePhase, 'sequence-validation');
assert.match(adjacencyReport.message, /adjacent/i);

console.log('real smoke splat corpus contracts passed');
