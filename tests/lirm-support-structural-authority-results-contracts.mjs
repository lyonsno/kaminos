import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { validateExposureLedger } from '../lirm-support-structural-authority-prelaunch.mjs';

const root = join(import.meta.dirname, '..', 'artifacts', 'lirm-support-structural-authority-tranche-01-results');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const assertEvidence = async evidence => {
  assert.equal(isAbsolute(evidence.path), false, `archive evidence path must be relative: ${evidence.path}`);
  const bytes = await readFile(join(root, evidence.path));
  assert.equal(bytes.length, evidence.byteSize, `archive evidence size drift: ${evidence.path}`);
  assert.equal(sha256(bytes), evidence.sha256, `archive evidence hash drift: ${evidence.path}`);
};
const assertNestedEvidence = async (base, evidence) => {
  assert.equal(isAbsolute(evidence.path), false, `nested archive evidence path must be relative: ${evidence.path}`);
  const bytes = await readFile(join(base, evidence.path));
  assert.equal(bytes.length, evidence.byteSize, `nested archive evidence size drift: ${evidence.path}`);
  assert.equal(sha256(bytes), evidence.sha256, `nested archive evidence hash drift: ${evidence.path}`);
};

const receipt = await readJson(join(root, 'receipt.json'));
assert.equal(receipt.schema, 'kaminos.lirm-support-structural-authority-results.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.operatorExposure, 'eligible');
assert.deepEqual(receipt.cells.map(cell => cell.cellId), ['cell-a', 'cell-b', 'cell-c']);
assert.equal(receipt.comparativeResult.carrierAuthorityObserved, true);
assert.equal(receipt.comparativeResult.speciesBasinPreservedAcrossCells, true);
assert.equal(receipt.comparativeResult.literalCarrierLeakageObserved, false);

for (const cell of receipt.cells) {
  assert.equal(cell.status, 'accepted');
  assert.equal(cell.operatorExposure, 'eligible');
  await assertEvidence(cell.output);
  await assertEvidence(cell.completion);
  await assertEvidence(cell.classification);
  const completion = await readJson(join(root, cell.completion.path));
  assert.equal(completion.status, 'accepted');
  assert.equal(completion.cellId, cell.cellId);
  assert.equal(completion.jobId, cell.jobId);
  assert.equal(completion.archivedOutput.path, 'output.png');
  assert.equal(completion.archivedMetadata.path, 'metadata.json');
  assert.equal(completion.archivedGeneratorMetadata.path, 'output.metadata.json');
  assert.deepEqual(
    Object.fromEntries(Object.entries(completion.archivedGreenroom).map(([key, evidence]) => [key, evidence.path])),
    {
      request: 'request.json',
      receipt: 'receipt.json',
      stdout: 'stdout.log',
      stderr: 'stderr.log',
    },
  );
  const cellRoot = join(root, cell.cellId);
  for (const evidence of [
    completion.archivedOutput,
    completion.archivedMetadata,
    completion.archivedGeneratorMetadata,
    ...Object.values(completion.archivedGreenroom),
  ]) {
    await assertNestedEvidence(cellRoot, evidence);
  }
  const metadata = await readJson(join(cellRoot, completion.archivedMetadata.path));
  assert.deepEqual(metadata.output_files, ['output.metadata.json', 'output.png']);
  assert.deepEqual(
    validateExposureLedger(await readJson(join(root, cell.classification.path))),
    await readJson(join(root, cell.classification.path)),
  );
}

for (const evidence of [
  receipt.contactSheet,
  receipt.exposureFilteredComparison,
  receipt.rejectedAttempts,
]) {
  await assertEvidence(evidence);
}

const comparison = await readJson(join(root, receipt.exposureFilteredComparison.path));
assert.equal(comparison.operatorExposure, 'eligible');
assert.deepEqual(comparison.cells.map(cell => cell.cellId), ['cell-a', 'cell-b', 'cell-c']);
for (const cell of comparison.cells) {
  assert.equal(isAbsolute(cell.outputPath), false);
  assert.equal(cell.ledger.operatorExposure, 'eligible');
  await access(join(root, cell.outputPath));
}

const rejected = await readJson(join(root, receipt.rejectedAttempts.path));
assert.equal(rejected.disposition, 'rejected_false_success_no_primary_artifact');
assert.deepEqual(rejected.attempts.map(attempt => attempt.jobId), ['f813daf11932', '7286ab31c8aa']);
for (const attempt of rejected.attempts) {
  assert.equal(attempt.queueStatus, 'done');
  assert.equal(attempt.exitCode, 0);
  assert.equal(attempt.primaryOutputPresent, false);
  const attemptRoot = join(root, 'rejected-attempts', `${attempt.cellId}-${attempt.jobId}`);
  assert.deepEqual(Object.keys(attempt.archivedEvidence).sort(), ['receipt', 'request', 'stderr', 'stdout']);
  for (const evidence of Object.values(attempt.archivedEvidence)) {
    await assertNestedEvidence(attemptRoot, evidence);
  }
  const stdout = await readFile(join(attemptRoot, attempt.archivedEvidence.stdout.path), 'utf8');
  assert.match(stdout, /Prompt file does not exist/);
  await assert.rejects(() => access(join(attemptRoot, 'output.png')));
}

const contactManifest = await readJson(join(root, 'contact-sheet-manifest.json'));
assert.equal(contactManifest.cells.length, 6);
for (const cell of contactManifest.cells) {
  assert.equal(isAbsolute(cell.sourcePath), false);
  await access(join(import.meta.dirname, '..', cell.sourcePath));
}

console.log('LIRM support structural authority results contracts passed');
