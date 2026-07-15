import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-trellis-guidance-pressure-assay-v1/', import.meta.url);
const rootPath = root.pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), 'Trellis guidance-pressure assay artifact must exist');

const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-trellis-guidance-pressure-assay.v1');
assert.equal(receipts.schema, 'kaminos.lirm-trellis-guidance-pressure-route-receipts.v1');
assert.equal(receipts.allDoneExitZero, true);
assert.equal(receipts.generationJobs.length, 11);
assert.equal(receipts.witnessJobs.length, 44);

assert.match(experiment.source.sha256, /^[a-f0-9]{64}$/);
assert.equal(experiment.source.sha256, '03a773c497d03281e94d387d5162058abd9134d6e1c52ecfca1de6ed8193d5ba');
assert.equal(experiment.fixed.seed, 42);
assert.equal(experiment.fixed.steps, 6);
assert.equal(experiment.fixed.resolution, 512);
assert.equal(experiment.fixed.targetFaces, 200000);
assert.equal(experiment.fixed.textureSize, 1024);
assert.equal(experiment.fixed.cascade, false);
assert.equal(experiment.fixed.simplifyFirst, true);
assert.equal(experiment.routeCommits.denseShapeGuidance, 'c3cea40');
assert.equal(experiment.routeCommits.sparseStructureGuidance, 'ee75fdb');

const expectedCells = new Set();
for (const pressure of ['low-3p0', 'default-7p5', 'high-12p0']) {
  expectedCells.add(`dense-shape/${pressure}`);
}
for (const pressure of [
  'prior-hybrid-0p0',
  'hybrid-0p25',
  'hybrid-0p50',
  'hybrid-0p75',
  'conditioned-1p0',
  'low-3p0',
  'default-7p5',
  'high-12p0',
]) {
  expectedCells.add(`sparse-structure/${pressure}`);
}

const seenCells = new Set();
const seenJobs = new Set();
for (const job of receipts.generationJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.request.job_id, job.receipt.job_id);
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 8_000_000, 'Trellis output must be a substantive GLB');
  assert.ok(job.metrics.sparseVoxels > 400);
  assert.ok(job.metrics.denseVoxels > 150_000);
  assert.ok(job.metrics.rawTriangles > 300_000);
  assert.ok(job.metrics.finalTriangles > 80_000);
  assert.equal(job.requested.strength, job.effective.strength);
  assert.deepEqual(job.requested.interval, job.effective.interval);
  assert.equal(job.input.sha256, experiment.source.sha256);
  seenCells.add(`${job.stage}/${job.pressure}`);
  seenJobs.add(job.receipt.job_id);
}
assert.deepEqual(seenCells, expectedCells);
assert.equal(seenJobs.size, 11, 'every generation cell must have a distinct Greenroom job');

const sparseByPressure = new Map(
  receipts.generationJobs
    .filter(job => job.stage === 'sparse-structure')
    .map(job => [job.pressure, job]),
);
assert.equal(sparseByPressure.get('prior-hybrid-0p0').metrics.sparseVoxels, 470);
assert.equal(sparseByPressure.get('hybrid-0p25').metrics.sparseVoxels, 1374);
assert.equal(sparseByPressure.get('hybrid-0p50').metrics.sparseVoxels, 2261);
assert.equal(sparseByPressure.get('default-7p5').metrics.sparseVoxels, 2440);
assert.ok(
  sparseByPressure.get('prior-hybrid-0p0').metrics.rawTriangles
    < sparseByPressure.get('default-7p5').metrics.rawTriangles / 5,
  'prior-dominant topology crossing must remain numerically distinguishable from the faithful basin',
);

const expectedWitnesses = new Set();
for (const cell of expectedCells) {
  for (const view of ['left', 'front', 'right', 'rear']) expectedWitnesses.add(`${cell}/${view}`);
}
assert.equal(new Set(receipts.witnessJobs.map(job => `${job.stage}/${job.pressure}/${job.view}`)).size, 44);
assert.deepEqual(
  new Set(receipts.witnessJobs.map(job => `${job.stage}/${job.pressure}/${job.view}`)),
  expectedWitnesses,
);
assert.equal(
  new Set(receipts.witnessJobs.map(job => job.output.sha256)).size,
  44,
  'every admitted camera witness must be visually distinct',
);
for (const job of receipts.witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.receipt.job_type, 'kaminos_blender_glb_witness_molten_0715');
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 100_000, 'witness must be a substantive nonblank PNG');
}

for (const sheet of [experiment.contactSheets.denseShape, experiment.contactSheets.sparseStructure]) {
  const bytes = readFileSync(join(rootPath, sheet.path));
  assert.equal(sha256(bytes), sheet.sha256);
  assert.equal(bytes.readUInt32BE(16), 2048);
  assert.equal(bytes.readUInt32BE(20), sheet.height);
}
assert.equal(experiment.contactSheets.denseShape.height, 1668);
assert.equal(experiment.contactSheets.denseShape.layout, '3 rows x 4 columns: low 3.0, default 7.5, high 12.0 by left/front/right/rear');
assert.equal(experiment.contactSheets.sparseStructure.height, 4448);
assert.equal(experiment.contactSheets.sparseStructure.layout, '8 rows x 4 columns: sparse CFG 0.0, 0.25, 0.5, 0.75, 1.0, 3.0, 7.5, 12.0 by left/front/right/rear');

const report = readFileSync(join(rootPath, 'report.md'), 'utf8');
for (const requiredClaim of [
  'Dense-stage pressure',
  'Sparse-stage pressure',
  'gross topology',
  'surface congestion',
  'effective route',
]) {
  assert.ok(report.includes(requiredClaim), `report must preserve claim boundary: ${requiredClaim}`);
}

assert.equal(sha256(readFileSync(join(rootPath, 'route-receipts.json'))), experiment.routeReceiptManifest.sha256);

console.log('lirm Trellis guidance-pressure assay contracts passed');
