import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHeritableHybridLineageImagegenPlan,
  buildHeritableHybridLineageImagegenSheetManifest,
  imagegenSubmissionFingerprint,
  recoverMatchingImagegenSubmissions,
} from '../artifacts/lirm-heritable-hybrid-lineage-v0/imagegen-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-heritable-hybrid-lineage-v0');
const witnessReceipt = JSON.parse(await readFile(join(artifactRoot, 'receipt.json'), 'utf8'));
const controlSheetReceipt = JSON.parse(await readFile(join(artifactRoot, 'control-contact-sheet-receipt.json'), 'utf8'));
const controlAdjudication = JSON.parse(await readFile(join(artifactRoot, 'control-adjudication.json'), 'utf8'));
const runnerSource = await readFile(join(artifactRoot, 'run-imagegen.mjs'), 'utf8');
assert.match(runnerSource, /submissionFingerprint/);
assert.match(runnerSource, /staleRecoveredSubmissions/);
assert.match(runnerSource, /failurePhase/);
assert.match(runnerSource, /visualInspectionClaim/);
assert.match(runnerSource, /validateGestaltImagegenCompletion/);
assert.doesNotMatch(runnerSource, /\['status', [^\]]+, '--json'\]/);
const sheetSource = await readFile(join(artifactRoot, 'contact-sheet.mjs'), 'utf8');
assert.match(sheetSource, /source hash drift/);
assert.match(sheetSource, /visualInspectionClaim/);
assert.match(sheetSource, /implausibly small/);

const plan = await buildHeritableHybridLineageImagegenPlan({
  witnessReceipt,
  witnessRoot: artifactRoot,
  controlSheetReceipt,
  controlAdjudication,
  controlSheetRoot: artifactRoot,
  promptRoot: join(artifactRoot, 'prompts'),
  outputRoot: '/tmp/kaminos-heritable-lineage-imagegen-contract-runtime',
});

assert.equal(plan.schema, 'kaminos.lirm-heritable-hybrid-lineage-imagegen-plan.v0');
assert.equal(plan.status, 'planned');
assert.equal(plan.cells.length, 10);
assert.equal(new Set(plan.cells.map(cell => cell.cellId)).size, 10);
assert.equal(new Set(plan.cells.map(cell => cell.candidateId)).size, 10);
assert.deepEqual(plan.cells.map(cell => cell.candidateId), witnessReceipt.outputs.map(output => output.id));
assert.deepEqual(plan.comparisonContract.terminalIds, [
  'cleft-crown-twins-g3',
  'stilted-ventral-keel-g3',
  'lateral-sail-radiant-g3',
]);
assert.equal(new Set(plan.cells.map(cell => cell.prompt.sha256)).size, 1);
assert.equal(new Set(plan.cells.map(cell => cell.seed)).size, 1);
assert.equal(new Set(plan.cells.map(cell => cell.jobType)).size, 1);
assert.equal(new Set(plan.cells.map(cell => cell.requestedRoute)).size, 1);
assert.equal(new Set(plan.cells.map(cell => JSON.stringify(cell.settings))).size, 1);
assert.ok(plan.cells.every(cell => cell.jobType === 'mflux_flux2_edit_promptfile_3ref'));
assert.ok(plan.cells.every(cell => cell.references.map(reference => reference.role).join(',') === 'depth,normal'));
assert.ok(plan.cells.every(cell => cell.settings.model === 'flux2-klein-9b'));
assert.ok(plan.cells.every(cell => cell.settings.steps === 8));
assert.ok(plan.cells.every(cell => cell.settings.guidance === 1));
assert.ok(plan.cells.every(cell => cell.referenceSet === 'clay-depth-normal'));
assert.ok(plan.cells.every(cell => Array.isArray(cell.inheritedCommitments) && cell.inheritedCommitments.length >= 4));

const founder = plan.cells.find(cell => cell.candidateId === 'annular-canopy-founder');
assert.equal(founder.generation, 0);
assert.equal(founder.parentId, null);
assert.deepEqual(founder.inheritedMutations, []);
const terminal = plan.cells.find(cell => cell.candidateId === 'cleft-crown-twins-g3');
assert.equal(terminal.lineageId, 'cleft-crown-twins');
assert.equal(terminal.generation, 3);
assert.equal(terminal.parentId, 'cleft-crown-twins-g2');
assert.ok(terminal.inheritedMutations.length >= 3);

const fingerprint = imagegenSubmissionFingerprint(plan.cells[0]);
assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
const changedReferenceCell = structuredClone(plan.cells[0]);
changedReferenceCell.references[1].sha256 = `sha256:${'1'.repeat(64)}`;
assert.notEqual(fingerprint, imagegenSubmissionFingerprint(changedReferenceCell));

const recovery = recoverMatchingImagegenSubmissions({
  cells: plan.cells,
  priorSubmitted: [{
    cellId: plan.cells[0].cellId,
    jobId: 'stale-reference-job',
    submissionFingerprint: imagegenSubmissionFingerprint(changedReferenceCell),
  }],
});
assert.equal(recovery.recovered.length, 0);
assert.equal(recovery.staleRecoveredSubmissions.length, 1);
assert.equal(recovery.staleRecoveredSubmissions[0].reason, 'submission-fingerprint-mismatch');

const collection = {
  schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-collection.v0',
  status: 'complete-uninspected',
  accepted: plan.cells.map(cell => ({
    cellId: cell.cellId,
    candidateId: cell.candidateId,
    lineageId: cell.lineageId,
    generation: cell.generation,
    output: { sha256: `sha256:${createFakeHash(cell.cellId)}` },
    durableOutput: {
      path: `imagegen-outputs/${cell.cellId}.png`,
      sha256: `sha256:${createFakeHash(cell.cellId)}`,
    },
  })),
};
function createFakeHash(value) {
  return Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64);
}
const sheet = buildHeritableHybridLineageImagegenSheetManifest({ plan, collection, artifactRoot });
assert.equal(sheet.columns, 4);
assert.equal(sheet.rows, 3);
assert.equal(sheet.cells.length, 12);
assert.equal(sheet.cells.filter(cell => cell.candidateId === 'annular-canopy-founder').length, 3);
for (let row = 0; row < 3; row += 1) {
  assert.deepEqual(sheet.cells.slice(row * 4, row * 4 + 4).map(cell => cell.generation), [0, 1, 2, 3]);
}

await assert.rejects(
  buildHeritableHybridLineageImagegenPlan({
    witnessReceipt,
    witnessRoot: artifactRoot,
    controlSheetReceipt: { ...controlSheetReceipt, status: 'complete-uninspected' },
    controlAdjudication,
    controlSheetRoot: artifactRoot,
    promptRoot: join(artifactRoot, 'prompts'),
    outputRoot: '/tmp/kaminos-heritable-lineage-imagegen-uninspected',
  }),
  /inspected control sheet receipt/,
);

await assert.rejects(
  buildHeritableHybridLineageImagegenPlan({
    witnessReceipt,
    witnessRoot: artifactRoot,
    controlSheetReceipt,
    controlAdjudication: {
      ...controlAdjudication,
      inspectedArtifact: {
        ...controlAdjudication.inspectedArtifact,
        sha256: `sha256:${'f'.repeat(64)}`,
      },
    },
    controlSheetRoot: artifactRoot,
    promptRoot: join(artifactRoot, 'prompts'),
    outputRoot: '/tmp/kaminos-heritable-lineage-imagegen-stale-adjudication',
  }),
  /adjudication control sheet hash drift/,
);

console.log('LIRM heritable hybrid lineage imagegen contracts passed');
