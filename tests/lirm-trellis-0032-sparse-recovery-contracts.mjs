import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-trellis-0032-sparse-recovery-v1/', import.meta.url);
const rootPath = root.pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), '0032 sparse-guidance recovery artifact must exist');

const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-trellis-0032-sparse-recovery.v1');
assert.equal(receipts.schema, 'kaminos.lirm-trellis-0032-sparse-recovery-route-receipts.v1');
assert.equal(experiment.source.id, '0032');
assert.equal(experiment.source.sha256, '9b937bc6e4a6727f2c420228ca311f240ae271f8cc496bf2b73cb8ba510a3852');
assert.deepEqual(experiment.pressures, [0.25, 0.5, 0.75, 1]);
assert.equal(receipts.generationJobs.length, 4);
assert.equal(receipts.witnessJobs.length, 16);

const expectedJobType = 'trellis2mlx_molten_sparse_pressure_ee75fdb';
const expectedGenerationCwd = '/private/tmp/trellis2mlx-molten-shape-guidance-pressure-0715';
const expectedWitnessType = 'kaminos_blender_glb_witness_molten_0715';
const expectedWitnessCwd = '/private/tmp/kaminos-molten-lirm-speciation-armature-recovery-0714';
for (const job of receipts.generationJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.equal(job.receipt.job_type, expectedJobType);
  assert.equal(job.receipt.effective_cwd, expectedGenerationCwd);
  assert.equal(job.receipt.ignored_params, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.requested.strength, job.effective.strength);
  assert.equal(job.output.path, job.effective.outputPath);
  assert.ok(job.metrics.sparseVoxels > 100);
  assert.ok(job.metrics.finalTriangles > 50_000);
}
assert.deepEqual(receipts.generationJobs.map(job => job.effective.strength), experiment.pressures);

const expectedYaw = new Map([['left', -0.85], ['front', 0], ['right', 0.85], ['rear', 3.141593]]);
for (const job of receipts.witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.job_type, expectedWitnessType);
  assert.equal(job.receipt.effective_cwd, expectedWitnessCwd);
  assert.equal(job.effectiveCamera.yaw, expectedYaw.get(job.view));
  assert.equal(job.effectiveCamera.pitch, 0.2);
  assert.ok(job.visualEvidence.luminanceStdDev > 5);
  assert.ok(job.visualEvidence.edgeRatio > 0.001);
  assert.ok(job.visualEvidence.activePixelRatio > 0.01);
  assert.ok(job.visualEvidence.activeBoundsRatio > 0.03);
}

const sheet = experiment.contactSheet;
const sheetBytes = readFileSync(join(rootPath, sheet.path));
assert.equal(sha256(sheetBytes), sheet.sha256);
assert.equal(sheetBytes.readUInt32BE(16), 2048);
assert.equal(sheetBytes.readUInt32BE(20), 2224);
assert.equal(sheet.rows, 4);
assert.equal(sheet.cells.length, 16);
assert.equal(sheet.assemblySha256, sha256(Buffer.from(JSON.stringify(sheet.cells))));
assert.ok(sheet.visualEvidence.activePixelRatio > 0.01);

const report = readFileSync(join(rootPath, 'report.md'), 'utf8');
for (const claim of ['0032', '0.75', '1.00', 'identity', 'connectedness', 'effective route']) {
  assert.ok(report.includes(claim), `recovery report must preserve decision boundary: ${claim}`);
}
assert.equal(sha256(readFileSync(join(rootPath, 'route-receipts.json'))), experiment.routeReceiptManifest.sha256);

console.log('LIRM Trellis 0032 sparse-guidance recovery contracts passed');
