import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGestaltTrellisPromotionPlan,
  buildGreenroomTrellisSubmitArgs,
  assertExactIdCoverage,
  parseGreenroomCliOutput,
  validateGestaltTrellisCompletion,
} from '../../../../lirm-speciation-gestalt-imagegen-core.mjs';

const trellisRoot = dirname(fileURLToPath(import.meta.url));
const imagegenRoot = resolve(trellisRoot, '..');
const planPath = resolve(trellisRoot, 'plan.json');
const submissionPath = resolve(trellisRoot, 'submission-report.json');
const completionPath = resolve(trellisRoot, 'completion-report.json');
const failurePath = resolve(trellisRoot, 'preflight-failure-report.json');
const outputRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-gestalt-factorial-trellis-20260718';
const greenroom = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';
const promotedCellIds = [
  'lirm-armature-08__basin-10-s3p00-n00-p046-strict-blockout-preservation-seed717048',
  'lirm-armature-08__basin-10-s3p00-n00-p046-prior-led-invention-seed717048',
  'lirm-armature-24__basin-10-s3p00-n00-p046-strict-blockout-preservation-seed717048',
  'lirm-armature-24__basin-10-s3p00-n00-p046-prior-led-invention-seed717048',
  'lirm-armature-08__basin-10-s3p00-n00-p046-prior-led-invention-seed717047',
];
const comparisonContract = {
  kind: 'armature-prompt-pressure-factorial-plus-seed-probe',
  fixedSilhouetteLineage: 'basin-10-s3p00-n00',
  factorialSeed: 717048,
  armatures: ['lirm-armature-08', 'lirm-armature-24'],
  promptStances: ['strict-blockout-preservation', 'prior-led-invention'],
  seedProbe: { candidateId: 'lirm-armature-08', stance: 'prior-led-invention', seed: 717047 },
};

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
  await mkdir(trellisRoot, { recursive: true });
  try {
    const imagegenPlan = JSON.parse(await readFile(resolve(imagegenRoot, 'plan.json'), 'utf8'));
    const imagegenCompletion = JSON.parse(await readFile(resolve(imagegenRoot, 'completion-report.json'), 'utf8'));
    const plan = await buildGestaltTrellisPromotionPlan({
      imagegenPlan,
      imagegenCompletion,
      promotedCellIds,
      outputRoot,
      comparisonContract,
    });
    await writeJsonAtomic(planPath, plan);
    return plan;
  } catch (error) {
    await writeJsonAtomic(failurePath, {
      schema: 'kaminos.lirm-speciation-gestalt-factorial-trellis-preflight-failure.v0',
      status: 'failed',
      failurePhase: 'plan',
      error: String(error?.stack ?? error),
      lastTrustworthyEvidence: 'no Trellis jobs submitted',
    });
    throw error;
  }
}

async function submit() {
  await mkdir(trellisRoot, { recursive: true });
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const report = {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-submission.v0',
    status: 'submitting',
    planPath,
    requestedCount: plan.cells.length,
    submitted: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'plan validated; no jobs submitted',
  };
  await writeJsonAtomic(submissionPath, report);
  try {
    for (const cell of plan.cells) {
      const response = runGreenroom(['submit', ...buildGreenroomTrellisSubmitArgs(cell)]);
      if (!response.job_id) throw new Error(`submit returned no job id for ${cell.cellId}`);
      report.submitted.push({ cellId: cell.cellId, jobId: response.job_id, response });
      report.lastTrustworthyEvidence = `${report.submitted.length}/${report.requestedCount} jobs submitted`;
      await writeJsonAtomic(submissionPath, report);
    }
    assertExactIdCoverage({
      plannedIds: plan.cells.map(cell => cell.cellId),
      observedIds: report.submitted.map(entry => entry.cellId),
      label: 'Trellis submission cell',
    });
    report.status = 'submitted';
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = error?.code === 'ERR_EXACT_ID_COVERAGE' ? 'submission-accounting' : 'submit';
    report.error = String(error?.stack ?? error);
    await writeJsonAtomic(submissionPath, report);
    throw error;
  }
  await writeJsonAtomic(submissionPath, report);
  return report;
}

async function collect({ allowPending = false } = {}) {
  await mkdir(trellisRoot, { recursive: true });
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const submission = JSON.parse(await readFile(submissionPath, 'utf8'));
  const byId = new Map(plan.cells.map(cell => [cell.cellId, cell]));
  const report = {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'submission report loaded',
  };
  await writeJsonAtomic(completionPath, report);
  try {
    assertExactIdCoverage({
      plannedIds: plan.cells.map(cell => cell.cellId),
      observedIds: submission.submitted.map(entry => entry.cellId),
      label: 'Trellis submission cell',
    });
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = 'submission-accounting';
    report.error = String(error?.message ?? error);
    report.lastTrustworthyEvidence = 'submission report loaded but exact plan coverage was not established';
    await writeJsonAtomic(completionPath, report);
    process.exitCode = 2;
    return report;
  }
  for (const submitted of submission.submitted) {
    const cell = byId.get(submitted.cellId);
    if (!cell) throw new Error(`submitted cell is absent from plan: ${submitted.cellId}`);
    const status = runGreenroom(['status', submitted.jobId]);
    if (status.status === 'pending' || status.status === 'running') {
      report.nonterminal.push({ cellId: cell.cellId, jobId: submitted.jobId, status: status.status });
      continue;
    }
    try {
      report.accepted.push(await validateGestaltTrellisCompletion({ cell, status }));
      report.lastTrustworthyEvidence = `${report.accepted.length} GLBs accepted; spatial coherence still requires witness`;
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
  } else if (report.nonterminal.length > 0) {
    report.status = 'waiting';
  } else {
    try {
      assertExactIdCoverage({
        plannedIds: plan.cells.map(cell => cell.cellId),
        observedIds: report.accepted.map(entry => entry.cellId),
        label: 'accepted Trellis cell',
      });
      report.status = 'complete-glbs-unwitnessed';
    } catch (error) {
      report.status = 'failed';
      report.failurePhase = 'completion-accounting';
      report.error = String(error?.message ?? error);
    }
  }
  await writeJsonAtomic(completionPath, report);
  if (report.status === 'failed' || (report.status === 'waiting' && !allowPending)) process.exitCode = 2;
  return report;
}

const command = process.argv[2];
if (command === 'plan') console.log(JSON.stringify(await createPlan(), null, 2));
else if (command === 'submit') console.log(JSON.stringify(await submit(), null, 2));
else if (command === 'collect') console.log(JSON.stringify(await collect(), null, 2));
else if (command === 'collect-allow-pending') console.log(JSON.stringify(await collect({ allowPending: true }), null, 2));
else throw new Error('usage: node run-promotion.mjs <plan|submit|collect|collect-allow-pending>');
