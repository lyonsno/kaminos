import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGreenroomSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltImagegenCompletion,
} from '../../lirm-speciation-gestalt-imagegen-core.mjs';
import {
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';
import {
  BRANCHING_IMAGEGEN_PRESSURE_PLAN_SCHEMA,
  buildBranchingImagegenPressurePlan,
} from './assay-contract.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(artifactRoot, '../..');
const conditioningRoot = join(repoRoot, 'artifacts/lirm-armature-expanded-gestalt-conditioning-assay-v1');
const promptRoot = join(artifactRoot, 'prompts');
const runtimeRoot = resolve(
  process.env.KAMINOS_LIRM_BRANCHING_IMAGEGEN_RUNTIME_ROOT
    ?? '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-branching-imagegen-pressure-20260718',
);
const greenroomRoot = resolve(process.env.GPU_GREENROOM_DIR ?? '/Users/noahlyons/.local/state/gpu-greenroom');
const greenroomCli = resolve(
  process.env.KAMINOS_GPU_GREENROOM_BIN
    ?? '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom',
);
const assemblerPath = join(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');
const planPath = join(artifactRoot, 'plan.json');
const submissionPath = join(artifactRoot, 'submission-report.json');
const collectionPath = join(artifactRoot, 'collection.json');
const contactSheetManifestPath = join(artifactRoot, 'contact-sheet-manifest.json');
const contactSheetPath = join(artifactRoot, 'branching-imagegen-pressure-contact-sheet.png');
const reportPath = join(artifactRoot, 'report.json');
const selectedCandidateIds = ['forked-saddle-lirm02', 'asymmetric-bead-chain-lirm07'];

const atomicWriteJson = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const evidence = async path => {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty evidence: ${path}`);
  return {
    path: relative(artifactRoot, path),
    byteSize: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
};

async function buildPlan() {
  const familyReceiptPath = join(conditioningRoot, 'receipt.json');
  const familyReceipt = JSON.parse(await readFile(familyReceiptPath, 'utf8'));
  if (familyReceipt.schema !== 'kaminos.lirm-armature-gestalt-family-witness.v0'
      || familyReceipt.status !== 'complete') {
    throw new Error(`conditioning family is not complete: ${familyReceipt.status ?? 'missing'}`);
  }
  const candidates = [];
  for (const candidateId of selectedCandidateIds) {
    const indexEntry = familyReceipt.candidates.find(candidate => candidate.id === candidateId);
    if (!indexEntry) throw new Error(`conditioning family lacks ${candidateId}`);
    const receiptPath = join(conditioningRoot, indexEntry.receiptPath);
    const observed = await evidence(receiptPath);
    if (observed.byteSize !== indexEntry.receiptEvidence.byteSize
        || observed.sha256 !== indexEntry.receiptEvidence.sha256) {
      throw new Error(`conditioning receipt drift: ${candidateId}`);
    }
    candidates.push({
      receipt: JSON.parse(await readFile(receiptPath, 'utf8')),
      conditioningRoot: dirname(receiptPath),
    });
  }
  const plan = await buildBranchingImagegenPressurePlan({
    candidates,
    promptRoot,
    outputRoot: runtimeRoot,
  });
  plan.sourceEvidence = {
    familyReceipt: await evidence(familyReceiptPath),
    candidateReceiptIds: selectedCandidateIds,
  };
  plan.greenroomAuthority = greenroomRoot;
  await atomicWriteJson(planPath, plan);
  return plan;
}

async function submitPlan() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (plan.schema !== BRANCHING_IMAGEGEN_PRESSURE_PLAN_SCHEMA) throw new Error('unsupported plan schema');
  const submissions = [];
  for (const cell of plan.cells) {
    const existing = cell.jobId;
    if (existing) {
      submissions.push({ cellId: cell.cellId, jobId: existing, status: 'already-submitted' });
      continue;
    }
    const args = buildGreenroomSubmitArgs(cell);
    const result = spawnSync(greenroomCli, ['submit', ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
      const failure = {
        schema: 'kaminos.lirm-branching-imagegen-pressure-submission.v0',
        status: 'failed',
        failurePhase: 'greenroom-submit',
        cellId: cell.cellId,
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        lastTrustworthyEvidence: 'planned cell with hashed conditioning and prompt inputs',
      };
      await atomicWriteJson(submissionPath, { submissions, failure });
      throw new Error(`Greenroom submission failed for ${cell.cellId}: ${result.stderr || result.stdout}`);
    }
    const parsed = parseGreenroomCliOutput(result.stdout);
    cell.jobId = parsed.job_id;
    submissions.push({ cellId: cell.cellId, jobId: cell.jobId, status: 'submitted' });
    await atomicWriteJson(planPath, plan);
    await atomicWriteJson(submissionPath, {
      schema: 'kaminos.lirm-branching-imagegen-pressure-submission.v0',
      status: submissions.length === plan.cells.length ? 'complete' : 'submitting',
      plannedCellCount: plan.cells.length,
      submittedCellCount: submissions.length,
      submissions,
    });
  }
  return submissions;
}

function greenroomStatus(jobId) {
  const result = spawnSync(greenroomCli, ['status', jobId], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Greenroom status failed for ${jobId}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function collectPlan() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const accepted = [];
  const incomplete = [];
  const failed = [];
  const durableOutputRoot = join(artifactRoot, 'outputs');
  await mkdir(durableOutputRoot, { recursive: true });
  for (const cell of plan.cells) {
    if (!cell.jobId) {
      incomplete.push({ cellId: cell.cellId, reason: 'not-submitted' });
      continue;
    }
    const status = greenroomStatus(cell.jobId);
    if (status.status === 'pending' || status.status === 'running') {
      incomplete.push({ cellId: cell.cellId, jobId: cell.jobId, status: status.status });
      continue;
    }
    try {
      const completion = await validateGestaltImagegenCompletion({ cell, status });
      const durablePath = join(durableOutputRoot, `${cell.cellId}.png`);
      await copyFile(cell.outputPath, durablePath);
      const durable = await evidence(durablePath);
      if (durable.sha256 !== completion.output.sha256 || durable.byteSize !== completion.output.bytes) {
        throw new Error(`durable output copy mismatch: ${cell.cellId}`);
      }
      accepted.push({ ...completion, durableOutput: durable });
    } catch (error) {
      failed.push({
        cellId: cell.cellId,
        jobId: cell.jobId,
        observedStatus: status.status,
        failurePhase: status.failure_phase ?? 'completion-validation',
        errorMessage: error.message,
        lastTrustworthyEvidence: 'Greenroom status receipt',
      });
    }
  }
  const collection = {
    schema: 'kaminos.lirm-branching-imagegen-pressure-collection.v0',
    status: failed.length > 0 ? 'failed' : incomplete.length > 0 ? 'incomplete' : 'complete',
    accepted,
    incomplete,
    failed,
  };
  await atomicWriteJson(collectionPath, collection);
  return { plan, collection };
}

async function buildContactSheet(plan, collection) {
  if (collection.status !== 'complete' || collection.accepted.length !== plan.cells.length) {
    throw new Error(`collection is not contact-sheetable: ${collection.status}`);
  }
  const acceptedByCell = new Map(collection.accepted.map(item => [item.cellId, item]));
  const cells = [];
  const sourceEvidence = [];
  for (const candidateId of selectedCandidateIds) {
    const candidateCells = plan.cells.filter(cell => cell.candidateId === candidateId);
    const sourceCell = candidateCells[0];
    const normalReference = sourceCell.references.find(reference => reference.role === 'normal');
    cells.push(
      { sourcePath: sourceCell.input.path, title: candidateId, viewLabel: 'ARMATURE' },
      { sourcePath: normalReference.path, title: candidateId, viewLabel: 'NORMAL' },
    );
    sourceEvidence.push(await evidence(sourceCell.input.path), await evidence(normalReference.path));
    for (const stance of plan.comparisonContract.stances) {
      for (const seed of plan.comparisonContract.seeds) {
        const cell = candidateCells.find(item => item.stance === stance && item.seed === seed);
        const accepted = acceptedByCell.get(cell?.cellId);
        if (!cell || !accepted) throw new Error(`missing accepted contact-sheet cell: ${candidateId}/${stance}/${seed}`);
        const durablePath = join(artifactRoot, accepted.durableOutput.path);
        cells.push({ sourcePath: durablePath, title: stance, viewLabel: `SEED ${seed}` });
        sourceEvidence.push(await evidence(durablePath));
      }
    }
  }
  const manifest = {
    width: 2048,
    cellWidth: 512,
    cellHeight: 548,
    imageHeight: 512,
    imageOffsetY: 0,
    headerHeight: 36,
    cells,
  };
  await atomicWriteJson(contactSheetManifestPath, manifest);
  const assembled = spawnSync('swift', [assemblerPath, contactSheetManifestPath, contactSheetPath], { encoding: 'utf8' });
  if (assembled.status !== 0) throw new Error(`contact-sheet assembly failed: ${assembled.stderr || assembled.stdout}`);
  const sheetBytes = await readFile(contactSheetPath);
  const pngInspection = inspectPngEvidence(sheetBytes);
  assertUsefulPngEvidence(pngInspection, {
    minWidth: 2048,
    minHeight: 2000,
    minLuminanceStdDev: 8,
    minActivePixelRatio: 0.02,
    minActiveBoundsRatio: 0.5,
  }, 'branching imagegen pressure contact sheet');
  const report = {
    schema: 'kaminos.lirm-branching-imagegen-pressure-assay.v0',
    status: 'outputs-complete-uninspected',
    evidencePredicate: plan.comparisonContract.loadBearingDiscriminator,
    plan: await evidence(planPath),
    submission: await evidence(submissionPath),
    collection: await evidence(collectionPath),
    contactSheetManifest: await evidence(contactSheetManifestPath),
    contactSheet: await evidence(contactSheetPath),
    pngInspection,
    sourceEvidence,
    visualInspection: 'not-yet-inspected',
    trellisPromotion: 'not-yet-selected',
  };
  await atomicWriteJson(reportPath, report);
  return report;
}

const command = process.argv[2] ?? 'plan';
if (command === 'plan') {
  console.log(JSON.stringify(await buildPlan(), null, 2));
} else if (command === 'submit') {
  console.log(JSON.stringify(await submitPlan(), null, 2));
} else if (command === 'collect') {
  const { plan, collection } = await collectPlan();
  if (collection.status === 'complete') await buildContactSheet(plan, collection);
  console.log(JSON.stringify(collection, null, 2));
  if (collection.status !== 'complete') process.exitCode = 2;
} else {
  throw new Error(`unsupported command: ${command}`);
}
