import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArmatureGestaltFamilyTrellisPromotionPlan } from '../../../lirm-armature-program-imagegen-core.mjs';
import {
  buildGreenroomTrellisSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltTrellisCompletion,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

const trellisRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const artifactRoot = resolve(trellisRoot, '..');
const imagegenRoot = resolve(artifactRoot, 'imagegen');
const planPath = resolve(trellisRoot, 'plan.json');
const submissionPath = resolve(trellisRoot, 'submission-report.json');
const completionPath = resolve(trellisRoot, 'completion-report.json');
const outputRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multi-gestalt-trellis-20260719';
const greenroom = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';
const selectedCellId = 'upright-basin10-clay-depth-normal-world-creature-invention-seed718113';

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function fileEvidence(path) {
  const bytes = await readFile(path);
  return {
    path,
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function runGreenroom(args) {
  const result = spawnSync(greenroom, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Greenroom command failed (${result.status}): ${result.stderr || result.stdout}`);
  return parseGreenroomCliOutput(result.stdout);
}

async function createPlan() {
  const imagegenPlan = JSON.parse(await readFile(resolve(imagegenRoot, 'plan.json'), 'utf8'));
  const imagegenCompletion = JSON.parse(await readFile(resolve(imagegenRoot, 'completion-report.json'), 'utf8'));
  const adjudicationPath = resolve(imagegenRoot, 'report.json');
  const selectionReceipt = {
    kind: 'single-inspected-structural-hit',
    selectedCellId,
    rationale: 'Clean novel compact creature; strongest armature match among new gestalts and isolated enough for a Trellis survival probe.',
    adjudication: await fileEvidence(adjudicationPath),
  };
  const plan = await buildArmatureGestaltFamilyTrellisPromotionPlan({
    imagegenPlan,
    imagegenCompletion,
    selectionReceipt,
    outputRoot,
  });
  await writeJsonAtomic(planPath, plan);
  return plan;
}

async function submit() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const report = {
    schema: 'kaminos.lirm-armature-gestalt-family-trellis-submission.v0',
    status: 'submitting',
    requestedCount: plan.cells.length,
    submitted: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'inspected-selection plan loaded; no jobs submitted',
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
    schema: 'kaminos.lirm-speciation-gestalt-trellis-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'submission report loaded; no GLB accepted',
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
      report.accepted.push(await validateGestaltTrellisCompletion({ cell, status }));
      report.lastTrustworthyEvidence = `${report.accepted.length}/${plan.cells.length} GLBs accepted; spatial coherence pending witness`;
    } catch (error) {
      report.rejected.push({ cellId: cell.cellId, jobId: submitted.jobId, error: String(error?.message ?? error), status });
    }
    await writeJsonAtomic(completionPath, report);
  }
  if (report.rejected.length > 0) {
    report.status = 'failed';
    report.failurePhase = 'completion-validation';
  } else if (report.nonterminal.length > 0 || report.accepted.length < plan.cells.length) {
    report.status = 'waiting';
  } else {
    report.status = 'complete-glbs-unwitnessed';
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
