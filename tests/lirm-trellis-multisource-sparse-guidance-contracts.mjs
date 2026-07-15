import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-trellis-multisource-sparse-guidance-v1/', import.meta.url);
const rootPath = root.pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), 'multi-source sparse-guidance assay artifact must exist');

const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-trellis-multisource-sparse-guidance.v1');
assert.equal(receipts.schema, 'kaminos.lirm-trellis-multisource-sparse-guidance-route-receipts.v1');
assert.equal(receipts.allDoneExitZero, true);
assert.equal(receipts.generationJobs.length, 9);
assert.equal(receipts.witnessJobs.length, 36);

assert.deepEqual(experiment.fixed, {
  seed: 42,
  steps: 6,
  resolution: 512,
  targetFaces: 200000,
  textureSize: 1024,
  cascade: false,
  simplifyFirst: true,
  downstreamShapeGuidance: {
    strength: 7.5,
    rescale: 0.5,
    interval: [0.6, 1.0],
  },
});
assert.equal(experiment.routeCommit, 'ee75fdb');
assert.deepEqual(experiment.routeIdentity, {
  generationJobType: 'trellis2mlx_molten_sparse_pressure_ee75fdb',
  generationEffectiveCwd: '/private/tmp/trellis2mlx-molten-shape-guidance-pressure-0715',
  witnessJobType: 'kaminos_blender_glb_witness_molten_0715',
  witnessEffectiveCwd: '/private/tmp/kaminos-molten-lirm-speciation-armature-recovery-0714',
  runner: '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py',
  effectiveBackend: 'MLX on Apple Silicon through gpu-greenroom strict FIFO',
});

const expectedSources = new Map([
  ['0066', '03a773c497d03281e94d387d5162058abd9134d6e1c52ecfca1de6ed8193d5ba'],
  ['0032', '9b937bc6e4a6727f2c420228ca311f240ae271f8cc496bf2b73cb8ba510a3852'],
  ['0087', '993608e914ad107c7cb8f0133974c97f7a1cd4d89e4bc205ff3cc9aea7c734f0'],
]);
assert.deepEqual(
  new Map(experiment.sources.map(source => [source.id, source.sha256])),
  expectedSources,
);

const expectedPressures = new Map([
  ['prior-hybrid-0p0', 0],
  ['hybrid-0p25', 0.25],
  ['hybrid-0p50', 0.5],
]);
const expectedCells = new Set();
for (const sourceId of expectedSources.keys()) {
  for (const pressure of expectedPressures.keys()) expectedCells.add(`${sourceId}/${pressure}`);
}

const seenCells = new Set();
const seenGenerationJobs = new Set();
for (const job of receipts.generationJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.receipt.ignored_params, null);
  assert.equal(job.receipt.job_type, experiment.routeIdentity.generationJobType);
  assert.equal(job.receipt.effective_cwd, experiment.routeIdentity.generationEffectiveCwd);
  assert.equal(job.request.job_id, job.receipt.job_id);
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 8_000_000, 'Trellis output must be a substantive GLB');
  assert.ok(job.metrics.sparseVoxels > 100);
  assert.ok(job.metrics.denseVoxels > 80_000);
  assert.ok(job.metrics.rawTriangles > 100_000);
  assert.ok(job.metrics.finalTriangles > 50_000);
  assert.equal(job.requested.strength, expectedPressures.get(job.pressure));
  assert.deepEqual(job.requested, job.effective);
  assert.equal(job.input.sha256, expectedSources.get(job.sourceId));
  assert.equal(job.output.path, job.effective.outputPath);
  assert.ok(
    job.receipt.effective_route.startsWith(`${experiment.routeIdentity.runner} `),
    'effective route must use the admitted Trellis runner',
  );
  seenCells.add(`${job.sourceId}/${job.pressure}`);
  seenGenerationJobs.add(job.receipt.job_id);
}
assert.deepEqual(seenCells, expectedCells);
assert.equal(seenGenerationJobs.size, 9);
assert.equal(
  receipts.generationJobs.find(job => job.receipt.job_id === '619722d00d51').metrics.duplicateFacesRemoved,
  0,
  'an omitted zero-count cleanup event must be recorded as zero rather than missing evidence',
);

const expectedWitnesses = new Set();
for (const cell of expectedCells) {
  for (const view of ['left', 'front', 'right', 'rear']) expectedWitnesses.add(`${cell}/${view}`);
}
assert.deepEqual(
  new Set(receipts.witnessJobs.map(job => `${job.sourceId}/${job.pressure}/${job.view}`)),
  expectedWitnesses,
);
assert.equal(
  new Set(receipts.witnessJobs.map(job => job.output.sha256)).size,
  36,
  'every admitted camera witness must be visually distinct',
);
const expectedYaw = new Map([
  ['left', -0.85],
  ['front', 0],
  ['right', 0.85],
  ['rear', 3.141593],
]);
for (const job of receipts.witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.receipt.ignored_params, null);
  assert.equal(job.receipt.job_type, experiment.routeIdentity.witnessJobType);
  assert.equal(job.receipt.effective_cwd, experiment.routeIdentity.witnessEffectiveCwd);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 100_000, 'witness must be a substantive nonblank PNG');
  assert.ok(job.visualEvidence.luminanceStdDev > 5);
  assert.ok(job.visualEvidence.edgeRatio > 0.001);
  assert.ok(job.visualEvidence.activePixelRatio > 0.01);
  assert.ok(job.visualEvidence.activeBoundsRatio > 0.03);
  assert.equal(job.effectiveCamera.yaw, expectedYaw.get(job.view));
  assert.equal(job.effectiveCamera.pitch, 0.2);
  const generation = receipts.generationJobs.find(
    candidate => candidate.sourceId === job.sourceId && candidate.pressure === job.pressure,
  );
  assert.ok(generation, `witness must resolve generation cell ${job.sourceId}/${job.pressure}`);
  assert.equal(job.input.sha256, generation.output.sha256);
  assert.equal(job.effectiveCamera.inputPath, generation.output.path);
}

const sheet = experiment.contactSheet;
const sheetBytes = readFileSync(join(rootPath, sheet.path));
assert.equal(sha256(sheetBytes), sheet.sha256);
assert.equal(sheetBytes.readUInt32BE(16), 2048);
assert.equal(sheetBytes.readUInt32BE(20), 5004);
assert.equal(sheet.rows, 9);
assert.equal(sheet.cells.length, 36);
assert.equal(sheet.assemblySha256, sha256(Buffer.from(JSON.stringify(sheet.cells))));
assert.ok(sheet.visualEvidence.luminanceStdDev > 5);
assert.ok(sheet.visualEvidence.edgeRatio > 0.001);
assert.ok(sheet.visualEvidence.activePixelRatio > 0.01);
assert.ok(sheet.visualEvidence.activeBoundsRatio > 0.03);
for (const cell of sheet.cells) {
  const witness = receipts.witnessJobs.find(job => job.receipt.job_id === cell.sourceJobId);
  assert.ok(witness, `sheet cell must name an admitted witness: ${cell.sourceJobId}`);
  assert.equal(cell.sourceId, witness.sourceId);
  assert.equal(cell.pressure, witness.pressure);
  assert.equal(cell.view, witness.view);
  assert.equal(cell.sourcePath, witness.output.path);
  assert.equal(cell.sourceSha256, witness.output.sha256);
}

const report = readFileSync(join(rootPath, 'report.md'), 'utf8');
for (const requiredClaim of [
  'gross topology',
  'source dependence',
  'repeatability',
  'provisional',
  'effective route',
]) {
  assert.ok(report.includes(requiredClaim), `report must preserve claim boundary: ${requiredClaim}`);
}

assert.equal(sha256(readFileSync(join(rootPath, 'route-receipts.json'))), experiment.routeReceiptManifest.sha256);

console.log('LIRM Trellis multi-source sparse-guidance contracts passed');
