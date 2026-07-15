import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../artifacts/lirm-silhouette-imagegen-multiref-assay-v1/', import.meta.url);
const rootPath = root.pathname;
const repoRootPath = new URL('../', import.meta.url).pathname;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.ok(existsSync(rootPath), 'multi-reference assay artifact must exist');

const experiment = JSON.parse(readFileSync(join(rootPath, 'experiment.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(join(rootPath, 'route-receipts.json'), 'utf8'));
const submissions = readFileSync(join(rootPath, 'submissions.tsv'), 'utf8').trim().split('\n');
const stageReceipts = JSON.parse(readFileSync(join(rootPath, 'trellis-stage-receipts.json'), 'utf8'));

assert.equal(experiment.schema, 'kaminos.lirm-silhouette-imagegen-multiref-assay.v1');
assert.equal(receipts.schema, 'kaminos.lirm-silhouette-imagegen-multiref-route-receipts.v1');
assert.equal(receipts.jobCount, 9);
assert.equal(receipts.jobs.length, 9);
assert.equal(receipts.allDoneExitZero, true);
assert.equal(submissions.length, 10, 'submissions table must contain one header plus nine jobs');
assert.equal(stageReceipts.schema, 'kaminos.lirm-silhouette-imagegen-multiref-trellis-stage-receipts.v1');
assert.equal(stageReceipts.jobCount, 10);
assert.equal(stageReceipts.allDoneExitZero, true);

const expectedCells = new Set();
for (const shape of ['prior-shape-0032', 'prior-shape-0066', 'prior-shape-0087']) {
  for (const referenceSet of ['clay-depth', 'clay-normal', 'clay-depth-normal']) {
    expectedCells.add(`${shape}/${referenceSet}`);
  }
}

const seenCells = new Set();
const seenJobs = new Set();
const seenOutputs = new Set();
for (const job of receipts.jobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.ok(job.receipt.effective_route.includes('mflux-generate-flux2-edit'));
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.prompt.sha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 100_000, 'generated output must be a substantive nonblank PNG');
  assert.equal(job.inputs[0].role, 'clay');
  assert.equal(job.inputs.length, job.referenceSet === 'clay-depth-normal' ? 3 : 2);
  assert.deepEqual(job.inputs.map(input => input.role), job.referenceSet.split('-'));
  for (const input of job.inputs) assert.match(input.sha256, /^[a-f0-9]{64}$/);
  assert.equal(job.receipt.job_type, job.inputs.length === 3
    ? 'mflux_flux2_edit_promptfile_3ref'
    : 'mflux_flux2_edit_promptfile_2ref');
  assert.equal(job.request.params.seed, String(job.seed));
  assert.equal(job.request.job_id, job.receipt.job_id);
  seenCells.add(`${job.shape}/${job.referenceSet}`);
  seenJobs.add(job.receipt.job_id);
  seenOutputs.add(job.output.sha256);
}
assert.deepEqual(seenCells, expectedCells);
assert.equal(seenJobs.size, 9, 'every matrix cell must have its own Greenroom job');
assert.equal(seenOutputs.size, 9, 'duplicate or stale output bytes must not masquerade as a matrix');

assert.equal(experiment.controls.length, 3);
for (const control of experiment.controls) {
  assert.match(control.outputSha256, /^[a-f0-9]{64}$/);
  assert.match(control.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(control.promptSha256, /^[a-f0-9]{64}$/);
  assert.match(control.sourceReceiptManifestSha256, /^[a-f0-9]{64}$/);

  const sourceManifestPath = join(repoRootPath, control.sourceReceiptManifestPath);
  const sourceManifestBytes = readFileSync(sourceManifestPath);
  assert.equal(sha256(sourceManifestBytes), control.sourceReceiptManifestSha256);
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceJob = sourceManifest.jobs.find(job => job.receipt.job_id === control.jobId);
  assert.ok(sourceJob, `control ${control.jobId} must exist in its named source manifest`);

  assert.equal(sourceJob.receipt.job_type, 'mflux_flux2_edit_promptfile');
  assert.equal(sourceJob.receipt.status, 'done');
  assert.equal(sourceJob.receipt.exit_code, 0);
  assert.equal(sourceJob.receipt.failure_phase, null);
  assert.deepEqual(sourceJob.receipt.warnings ?? [], []);
  assert.equal(sourceJob.input.path, sourceJob.receipt.input_path);
  assert.equal(sourceJob.input.sha256, control.inputSha256);
  assert.match(sourceJob.input.path, new RegExp(`/${control.shape}/clay\\.png$`));
  assert.equal(sourceJob.output.path, control.outputPath);
  assert.equal(sourceJob.output.sha256, control.outputSha256);
  assert.ok(sourceJob.output.bytes > 100_000, 'clay-only control must be a substantive nonblank PNG');

  const expectedPromptPath = `prompts/${control.stance}.txt`;
  const promptBytes = readFileSync(join(sourceManifestPath, '..', expectedPromptPath));
  assert.equal(sourceJob.prompt.canonicalPath, expectedPromptPath);
  assert.equal(sourceJob.prompt.sha256, control.promptSha256);
  assert.equal(sha256(promptBytes), control.promptSha256);
  assert.equal(sourceJob.routeIdentity.effectiveRunner, experiment.effectiveRunner);
  assert.equal(experiment.matrix.fixedSeedByShape[control.shape], Number(sourceJob.receipt.effective_route.match(/--seed (\d+)/)[1]));
  assert.equal(experiment.matrix.fixedStanceByShape[control.shape], control.stance);
  for (const routeFragment of [
    `--model ${experiment.model}`,
    `--quantize ${experiment.quantize}`,
    `--height ${experiment.height}`,
    `--width ${experiment.width}`,
    `--steps ${experiment.steps}`,
    `--guidance ${experiment.guidance}.0`,
  ]) {
    assert.ok(sourceJob.receipt.effective_route.includes(routeFragment), `control route must include ${routeFragment}`);
  }
}

assert.equal(experiment.rejectedSubmission.jobId, 'f4c8e072077b');
assert.equal(experiment.rejectedSubmission.status, 'cancelled');
assert.equal(experiment.rejectedSubmission.admittedToMatrix, false);
assert.equal(experiment.rejectedSubmission.replacementJobId, '4ea0e6341688');
assert.deepEqual(experiment.rejectedSubmission.replacementCell, {
  shape: 'prior-shape-0032',
  referenceSet: 'clay-depth',
});
assert.ok(!seenJobs.has(experiment.rejectedSubmission.jobId), 'rejected malformed job must not enter receipt manifest');
assert.ok(seenJobs.has(experiment.rejectedSubmission.replacementJobId), 'replacement job must enter receipt manifest');
const submissionJobIds = new Set(submissions.slice(1).map(line => line.split('\t')[0]));
assert.ok(!submissionJobIds.has(experiment.rejectedSubmission.jobId), 'rejected malformed job must not enter submissions table');
assert.ok(submissionJobIds.has(experiment.rejectedSubmission.replacementJobId), 'replacement job must enter submissions table');
const replacementReceiptJob = receipts.jobs.find(job => job.receipt.job_id === experiment.rejectedSubmission.replacementJobId);
assert.equal(replacementReceiptJob.shape, experiment.rejectedSubmission.replacementCell.shape);
assert.equal(replacementReceiptJob.referenceSet, experiment.rejectedSubmission.replacementCell.referenceSet);
const replacementSubmission = submissions.slice(1)
  .map(line => line.split('\t'))
  .find(columns => columns[0] === experiment.rejectedSubmission.replacementJobId);
assert.equal(replacementSubmission[1], experiment.rejectedSubmission.replacementCell.shape);
assert.equal(replacementSubmission[3], experiment.rejectedSubmission.replacementCell.referenceSet);

const contactPath = join(rootPath, experiment.contactSheet.path);
const contactBytes = readFileSync(contactPath);
const contactHash = sha256(contactBytes);
assert.equal(contactHash, experiment.contactSheet.sha256);
assert.equal(contactBytes.readUInt32BE(16), 2048);
assert.equal(contactBytes.readUInt32BE(20), 1536);
assert.equal(experiment.contactSheet.layout, '3 rows x 4 columns: single-clay control, clay+depth, clay+normal, clay+depth+normal');

const receiptBytes = readFileSync(join(rootPath, 'route-receipts.json'));
assert.equal(
  sha256(receiptBytes),
  experiment.routeReceiptManifest.sha256,
);

const trellisJobs = stageReceipts.jobs.filter(job => job.stage === 'trellis');
const witnessJobs = stageReceipts.jobs.filter(job => job.stage === 'blender-witness');
assert.equal(trellisJobs.length, 2);
assert.equal(witnessJobs.length, 8);

const expectedCastCells = new Set([
  'prior-shape-0032/clay-normal',
  'prior-shape-0066/clay-depth-normal',
]);
assert.deepEqual(new Set(trellisJobs.map(job => `${job.shape}/${job.referenceSet}`)), expectedCastCells);

for (const job of trellisJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.receipt.job_type, 'trellis2mlx_fast');
  assert.match(job.receipt.effective_route, /--seed 42 .*--steps 6 .*--no-cascade .*--target-faces 200000 .*--texture-size 1024 .*--simplify-first$/);
  assert.equal(job.request.params.seed, '42');
  assert.equal(job.request.params.steps, '6');
  assert.equal(job.request.params.target_faces, '200000');
  assert.equal(job.request.params.texture_size, '1024');
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.input.sha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 8_000_000, 'Trellis GLB must be a substantive cast');
  assert.ok(job.metrics.sparseVoxels > 2_000);
  assert.ok(job.metrics.finalTriangles > 100_000);
}

const expectedViews = new Set();
for (const shape of ['prior-shape-0032', 'prior-shape-0066']) {
  for (const view of ['left', 'front', 'right', 'opposite']) expectedViews.add(`${shape}/${view}`);
}
assert.deepEqual(new Set(witnessJobs.map(job => `${job.shape}/${job.view}`)), expectedViews);
assert.equal(new Set(witnessJobs.map(job => job.output.sha256)).size, 8, 'every witness view must have unique rendered bytes');
for (const job of witnessJobs) {
  assert.equal(job.receipt.status, 'done');
  assert.equal(job.receipt.exit_code, 0);
  assert.equal(job.receipt.failure_phase, null);
  assert.deepEqual(job.receipt.warnings ?? [], []);
  assert.equal(job.receipt.job_type, 'kaminos_blender_glb_witness_molten_0715');
  assert.match(job.receipt.effective_route, /kaminos-molten-lirm-speciation-armature-recovery-0714\/artifacts\/generator-basin-fanout-20260710\/witness\/blender_glb_witness\.py/);
  assert.match(job.receiptSha256, /^[a-f0-9]{64}$/);
  assert.match(job.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(job.input.sha256, /^[a-f0-9]{64}$/);
  assert.match(job.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(job.output.bytes > 100_000, 'Blender witness must be a substantive nonblank PNG');
}

const stageReceiptBytes = readFileSync(join(rootPath, 'trellis-stage-receipts.json'));
assert.equal(
  sha256(stageReceiptBytes),
  experiment.trellisStage.routeReceiptManifest.sha256,
);
const stageSheetBytes = readFileSync(join(rootPath, experiment.trellisStage.contactSheet.path));
assert.equal(
  sha256(stageSheetBytes),
  experiment.trellisStage.contactSheet.sha256,
);
assert.equal(stageSheetBytes.readUInt32BE(16), 4400);
assert.equal(stageSheetBytes.readUInt32BE(20), 1800);

console.log('lirm silhouette imagegen multi-reference assay contracts passed');
