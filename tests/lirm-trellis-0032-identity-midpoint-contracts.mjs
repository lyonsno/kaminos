import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-trellis-0032-identity-midpoint-v1/', import.meta.url);
const rootPath = root.pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), '0032 midpoint artifact must exist');
const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-trellis-0032-identity-midpoint.v1');
assert.equal(receipts.schema, 'kaminos.lirm-trellis-0032-identity-midpoint-route-receipts.v1');
assert.deepEqual(experiment.pressures, [2, 3, 4]);
assert.equal(experiment.source.id, '0032');
assert.equal(experiment.source.sha256, '9b937bc6e4a6727f2c420228ca311f240ae271f8cc496bf2b73cb8ba510a3852');
assert.equal(receipts.generationJobs.length, 3);
assert.equal(receipts.witnessJobs.length, 12);
assert.deepEqual(receipts.generationJobs.map(job => Number(job.strength ?? job.effective.strength)), [2, 3, 4]);

const expectedYaw = new Map([['left', -0.85], ['front', 0], ['right', 0.85], ['rear', 3.141593]]);
for (const job of receipts.witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.job_type, 'kaminos_blender_glb_witness_molten_0715');
  assert.equal(job.effectiveCamera.yaw, expectedYaw.get(job.view));
  assert.equal(job.effectiveCamera.pitch, 0.2);
  assert.ok(job.receipt.effective_route.includes(` ${expectedYaw.get(job.view)} 0.2`));
  assert.ok(job.visualEvidence.luminanceStdDev > 5);
  assert.ok(job.visualEvidence.edgeRatio > 0.001);
  assert.ok(job.visualEvidence.activePixelRatio > 0.01);
}

assert.deepEqual(receipts.excludedMidpointWitnesses.map(job => job.jobId), [
  'bfc1691e1509',
  'fc7be0d4597a',
  '1ee0f8f4f0be',
  'b7c2b7f1bbc1',
]);
for (const excluded of receipts.excludedMidpointWitnesses) {
  assert.equal(excluded.effectiveYaw, 0);
  assert.match(excluded.reason, /omitted yaw/);
}

const sheet = experiment.contactSheet;
const sheetBytes = readFileSync(join(rootPath, sheet.path));
assert.equal(sha256(sheetBytes), sheet.sha256);
assert.equal(sheetBytes.readUInt32BE(16), 2048);
assert.equal(sheetBytes.readUInt32BE(20), 1668);
assert.equal(sheet.rows, 3);
assert.equal(sheet.cells.length, 12);
assert.equal(sheet.assemblySha256, sha256(Buffer.from(JSON.stringify(sheet.cells))));
assert.equal(sha256(readFileSync(join(rootPath, 'route-receipts.json'))), experiment.routeReceiptManifest.sha256);

const report = readFileSync(join(rootPath, 'report.md'), 'utf8');
for (const claim of ['greater than CFG `3.0`', 'at most CFG `4.0`', 'excluded', 'default yaw', 'Stop the scalar sweep here']) {
  assert.ok(report.includes(claim), `midpoint report must preserve decision boundary: ${claim}`);
}

console.log('LIRM Trellis 0032 identity-midpoint contracts passed');
