import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGreenroomSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltImagegenCompletion,
} from '../../lirm-speciation-gestalt-imagegen-core.mjs';
import { buildRareGestaltImagegenPlan } from './imagegen-contract.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const witnessReceiptPath = join(artifactRoot, 'receipt.json');
const promptRoot = join(artifactRoot, 'prompts');
const runtimeRoot = resolve(
  process.env.KAMINOS_LIRM_RARE_GESTALT_IMAGEGEN_RUNTIME_ROOT
    ?? '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-rare-gestalt-pressure-20260719',
);
const greenroomCli = resolve(
  process.env.KAMINOS_GPU_GREENROOM_BIN
    ?? '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom',
);
const planPath = join(artifactRoot, 'imagegen-plan.json');
const submissionPath = join(artifactRoot, 'imagegen-submission-report.json');
const collectionPath = join(artifactRoot, 'imagegen-collection.json');

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

const runGreenroom = args => {
  const result = spawnSync(greenroomCli, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Greenroom ${args[0]} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
};

const greenroomStatus = jobId => runGreenroom(['status', jobId]);

async function buildPlan() {
  const witnessReceipt = JSON.parse(await readFile(witnessReceiptPath, 'utf8'));
  const plan = await buildRareGestaltImagegenPlan({
    witnessReceipt,
    witnessRoot: artifactRoot,
    promptRoot,
    outputRoot: runtimeRoot,
  });
  plan.sourceEvidence = { witnessReceipt: await evidence(witnessReceiptPath) };
  await atomicWriteJson(planPath, plan);
  return plan;
}

async function submitPlan() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (plan.schema !== 'kaminos.lirm-rare-gestalt-imagegen-pressure-plan.v0') throw new Error('unsupported plan schema');
  const submissions = [];
  for (const cell of plan.cells) {
    if (cell.jobId) {
      submissions.push({ cellId: cell.cellId, jobId: cell.jobId, status: 'already-submitted' });
      continue;
    }
    let parsed;
    try {
      const result = spawnSync(greenroomCli, ['submit', ...buildGreenroomSubmitArgs(cell)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      parsed = parseGreenroomCliOutput(result.stdout);
    } catch (error) {
      await atomicWriteJson(submissionPath, {
        schema: 'kaminos.lirm-rare-gestalt-imagegen-submission.v0',
        status: 'failed',
        failurePhase: 'greenroom-submit',
        failedCellId: cell.cellId,
        errorMessage: error.message,
        submissions,
        lastTrustworthyEvidence: 'planned cell with hashed conditioning and prompt inputs',
      });
      throw error;
    }
    cell.jobId = parsed.job_id;
    submissions.push({ cellId: cell.cellId, jobId: cell.jobId, status: 'submitted' });
    await atomicWriteJson(planPath, plan);
    await atomicWriteJson(submissionPath, {
      schema: 'kaminos.lirm-rare-gestalt-imagegen-submission.v0',
      status: submissions.length === plan.cells.length ? 'complete' : 'submitting',
      plannedCellCount: plan.cells.length,
      submittedCellCount: submissions.length,
      submissions,
      lastTrustworthyEvidence: `${submissions.length}/${plan.cells.length} cells accepted by GPU Greenroom`,
    });
  }
  return submissions;
}

async function collectPlan() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const accepted = [];
  const incomplete = [];
  const failed = [];
  const durableOutputRoot = join(artifactRoot, 'imagegen-outputs');
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
      const durableOutput = await evidence(durablePath);
      if (durableOutput.sha256 !== completion.output.sha256 || durableOutput.byteSize !== completion.output.bytes) {
        throw new Error(`durable output copy mismatch: ${cell.cellId}`);
      }
      accepted.push({ ...completion, durableOutput });
    } catch (error) {
      failed.push({
        cellId: cell.cellId,
        jobId: cell.jobId,
        observedStatus: status.status,
        failurePhase: status.failure_phase ?? 'completion-validation',
        errorMessage: error.message,
        lastTrustworthyEvidence: 'GPU Greenroom status receipt',
      });
    }
  }
  const collection = {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-collection.v0',
    status: failed.length > 0 ? 'failed' : incomplete.length > 0 ? 'incomplete' : 'complete-uninspected',
    accepted,
    incomplete,
    failed,
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: `${accepted.length}/${plan.cells.length} route-validated outputs copied durably`,
  };
  await atomicWriteJson(collectionPath, collection);
  return collection;
}

const command = process.argv[2] ?? 'plan';
if (command === 'plan') {
  process.stdout.write(`${JSON.stringify(await buildPlan(), null, 2)}\n`);
} else if (command === 'submit') {
  process.stdout.write(`${JSON.stringify(await submitPlan(), null, 2)}\n`);
} else if (command === 'collect') {
  const collection = await collectPlan();
  process.stdout.write(`${JSON.stringify(collection, null, 2)}\n`);
  if (collection.status !== 'complete-uninspected') process.exitCode = 2;
} else {
  throw new Error(`unsupported command: ${command}`);
}
