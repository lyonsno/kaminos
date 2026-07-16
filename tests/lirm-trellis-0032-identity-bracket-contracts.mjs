import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-trellis-0032-identity-bracket-v1/', import.meta.url);
const rootPath = root.pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), '0032 identity-bracket artifact must exist');
assert.ok(existsSync(join(rootPath, 'experiment.json')), '0032 identity-bracket experiment must exist');
assert.ok(existsSync(join(rootPath, 'route-receipts.json')), '0032 identity-bracket route receipts must exist');
const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-trellis-0032-identity-bracket.v1');
assert.equal(receipts.schema, 'kaminos.lirm-trellis-0032-identity-bracket-route-receipts.v1');
assert.equal(experiment.source.id, '0032');
assert.equal(experiment.source.sha256, '9b937bc6e4a6727f2c420228ca311f240ae271f8cc496bf2b73cb8ba510a3852');
assert.deepEqual(experiment.pressures, [1, 2, 4]);
assert.equal(receipts.generationJobs.length, 3);
assert.equal(receipts.witnessJobs.length, 12);
assert.deepEqual(receipts.excludedWitnessJobs, [{
  jobId: '7846c3d4b3a3',
  duplicatesAdmittedJobId: '19bea65b5bc7',
  cell: 'cfg-2p00/left',
  reason: 'redundant submission excluded before evidence assembly',
}]);

for (const job of receipts.generationJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.job_type, 'trellis2mlx_molten_sparse_pressure_ee75fdb');
  assert.equal(job.receipt.effective_cwd, '/private/tmp/trellis2mlx-molten-shape-guidance-pressure-0715');
  assert.equal(job.receipt.ignored_params, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.requested.strength, job.effective.strength);
  assert.ok(job.metrics.sparseVoxels > 100);
  assert.ok(job.metrics.finalTriangles > 50_000);
}
assert.deepEqual(receipts.generationJobs.map(job => job.effective.strength), [1, 2, 4]);

const expectedYaw = new Map([['left', -0.85], ['front', 0], ['right', 0.85], ['rear', 3.141593]]);
assert.equal(new Set(receipts.witnessJobs.map(job => `${job.row}/${job.view}`)).size, 12);
for (const job of receipts.witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.job_type, 'kaminos_blender_glb_witness_molten_0715');
  assert.equal(job.receipt.effective_cwd, '/private/tmp/kaminos-molten-lirm-speciation-armature-recovery-0714');
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
assert.equal(sheetBytes.readUInt32BE(20), 1668);
assert.equal(sheet.rows, 3);
assert.equal(sheet.cells.length, 12);
assert.equal(sheet.assemblySha256, sha256(Buffer.from(JSON.stringify(sheet.cells))));

const report = readFileSync(join(rootPath, 'report.md'), 'utf8');
for (const claim of ['1.00', '2.00', '4.00', 'giant eye', 'radial', 'identity', 'effective route']) {
  assert.ok(report.includes(claim), `identity-bracket report must preserve decision boundary: ${claim}`);
}
assert.equal(sha256(readFileSync(join(rootPath, 'route-receipts.json'))), experiment.routeReceiptManifest.sha256);

console.log('LIRM Trellis 0032 identity-bracket contracts passed');
