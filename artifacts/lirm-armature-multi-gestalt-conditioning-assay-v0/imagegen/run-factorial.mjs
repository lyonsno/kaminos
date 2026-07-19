import { spawnSync } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArmatureGestaltFamilyImagegenMatrix } from '../../../lirm-armature-program-imagegen-core.mjs';
import {
  buildGreenroomSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltImagegenCompletion,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imagegenRoot = resolve(artifactRoot, 'imagegen');
const familyReceiptPath = resolve(artifactRoot, 'receipt.json');
const promptRoot = resolve(imagegenRoot, 'prompts');
const planPath = resolve(imagegenRoot, 'plan.json');
const submissionPath = resolve(imagegenRoot, 'submission-report.json');
const completionPath = resolve(imagegenRoot, 'completion-report.json');
const outputRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multi-gestalt-imagegen-20260719';
const greenroom = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function runGreenroom(args) {
  const result = spawnSync(greenroom, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Greenroom command failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return parseGreenroomCliOutput(result.stdout);
}

async function createPlan() {
  const familyReceipt = JSON.parse(await readFile(familyReceiptPath, 'utf8'));
  const plan = await buildArmatureGestaltFamilyImagegenMatrix({
    familyReceipt,
    conditioningRoot: artifactRoot,
    promptRoot,
    outputRoot,
    seeds: [718021, 718113],
    stance: { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
    referenceSets: [
      { id: 'clay-only', roles: ['clay'] },
      { id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] },
    ],
  });
  await writeJsonAtomic(planPath, plan);
  return plan;
}

function assertAdoptableJob(cell, status) {
  if (status.job_type !== cell.jobType) throw new Error(`recovered job type mismatch: ${status.job_type}`);
  if (resolve(status.input_path) !== resolve(cell.input.path)) throw new Error('recovered job input mismatch');
  if (resolve(status.output_dir) !== resolve(cell.outputDir)) throw new Error('recovered job output directory mismatch');
}

async function submit(recoveredJobIds = []) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const report = {
    schema: 'kaminos.lirm-armature-gestalt-family-imagegen-submission.v0',
    status: 'submitting',
    planPath,
    requestedCount: plan.cells.length,
    submitted: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'plan loaded; no jobs submitted',
  };
  await writeJsonAtomic(submissionPath, report);
  try {
    for (const [index, recoveredJobId] of recoveredJobIds.entries()) {
      const cell = plan.cells[index];
      if (!cell) throw new Error(`more recovered jobs than plan cells: ${recoveredJobId}`);
      const status = runGreenroom(['status', recoveredJobId]);
      assertAdoptableJob(cell, status);
      report.submitted.push({
        cellId: cell.cellId,
        jobId: recoveredJobId,
        recoveredAfterInterruption: true,
        response: status,
      });
      report.lastTrustworthyEvidence = `adopted ${report.submitted.length} verified existing job(s)`;
      await writeJsonAtomic(submissionPath, report);
    }
    for (const cell of plan.cells.slice(recoveredJobIds.length)) {
      const response = runGreenroom(['submit', ...buildGreenroomSubmitArgs(cell)]);
      if (!response.job_id) throw new Error(`submit returned no job id for ${cell.cellId}`);
      report.submitted.push({ cellId: cell.cellId, jobId: response.job_id, response });
      report.lastTrustworthyEvidence = `${report.submitted.length}/${report.requestedCount} jobs submitted`;
      await writeJsonAtomic(submissionPath, report);
    }
    report.status = 'submitted';
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = 'submit';
    report.error = String(error?.stack ?? error);
    await writeJsonAtomic(submissionPath, report);
    throw error;
  }
  await writeJsonAtomic(submissionPath, report);
  return report;
}

async function collect({ allowPending = false } = {}) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const submission = JSON.parse(await readFile(submissionPath, 'utf8'));
  const byId = new Map(plan.cells.map(cell => [cell.cellId, cell]));
  const report = {
    schema: 'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'submission report loaded; no primary output accepted',
  };
  await writeJsonAtomic(completionPath, report);
  for (const submitted of submission.submitted) {
    const cell = byId.get(submitted.cellId);
    if (!cell) {
      report.rejected.push({ cellId: submitted.cellId, jobId: submitted.jobId, error: 'submitted cell absent from plan' });
      continue;
    }
    const status = runGreenroom(['status', submitted.jobId]);
    if (status.status === 'pending' || status.status === 'running') {
      report.nonterminal.push({ cellId: cell.cellId, jobId: submitted.jobId, status: status.status });
      continue;
    }
    try {
      report.accepted.push(await validateGestaltImagegenCompletion({ cell, status }));
      report.lastTrustworthyEvidence = `${report.accepted.length}/${plan.cells.length} primary outputs accepted`;
    } catch (error) {
      report.rejected.push({
        cellId: cell.cellId,
        jobId: submitted.jobId,
        error: String(error?.message ?? error),
        status,
      });
    }
    await writeJsonAtomic(completionPath, report);
  }
  if (report.rejected.length > 0) {
    report.status = 'failed';
    report.failurePhase = 'completion-validation';
  } else if (report.nonterminal.length > 0 || report.accepted.length < plan.cells.length) {
    report.status = 'waiting';
  } else {
    report.status = 'complete';
  }
  await writeJsonAtomic(completionPath, report);
  if (report.status === 'failed' || (report.status === 'waiting' && !allowPending)) process.exitCode = 2;
  return report;
}

const command = process.argv[2];
if (command === 'plan') console.log(JSON.stringify(await createPlan(), null, 2));
else if (command === 'submit') console.log(JSON.stringify(await submit(process.argv.slice(3)), null, 2));
else if (command === 'collect') console.log(JSON.stringify(await collect(), null, 2));
else if (command === 'collect-allow-pending') console.log(JSON.stringify(await collect({ allowPending: true }), null, 2));
else throw new Error('usage: node run-factorial.mjs <plan|submit|collect|collect-allow-pending>');
