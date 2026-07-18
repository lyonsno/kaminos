import { spawnSync } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGestaltTrellisWitnessPlan,
  buildGreenroomWitnessSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltWitnessCompletion,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trellisRoot = resolve(artifactRoot, 'trellis');
const planPath = resolve(trellisRoot, 'witness-plan.json');
const submissionPath = resolve(trellisRoot, 'witness-submission-report.json');
const completionPath = resolve(trellisRoot, 'witness-completion-report.json');
const outputRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-speciation-gestalt-composite-trellis-20260718/witness';
const witnessScript = resolve(artifactRoot, '../generator-basin-fanout-20260710/witness/blender_glb_witness.py');
const greenroom = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function runGreenroom(args) {
  const result = spawnSync(greenroom, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Greenroom command failed (${result.status}): ${result.stderr || result.stdout}`);
  return parseGreenroomCliOutput(result.stdout);
}

async function createPlan() {
  const trellisPlan = JSON.parse(await readFile(resolve(trellisRoot, 'plan.json'), 'utf8'));
  const trellisCompletion = JSON.parse(await readFile(resolve(trellisRoot, 'completion-report.json'), 'utf8'));
  const plan = await buildGestaltTrellisWitnessPlan({ trellisPlan, trellisCompletion, outputRoot, witnessScript });
  await writeJsonAtomic(planPath, plan);
  return plan;
}

async function submit() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const report = {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-witness-submission.v0',
    status: 'submitting',
    requestedCount: plan.cells.length,
    submitted: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'witness plan validated; no render jobs submitted',
  };
  await writeJsonAtomic(submissionPath, report);
  try {
    for (const cell of plan.cells) {
      const response = runGreenroom(['submit', ...buildGreenroomWitnessSubmitArgs(cell)]);
      if (!response.job_id) throw new Error(`submit returned no job id for ${cell.witnessId}`);
      report.submitted.push({ witnessId: cell.witnessId, jobId: response.job_id, response });
      report.lastTrustworthyEvidence = `${report.submitted.length}/${report.requestedCount} render jobs submitted`;
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
  const byId = new Map(plan.cells.map(cell => [cell.witnessId, cell]));
  const report = {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-witness-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    failurePhase: null,
    lastTrustworthyEvidence: 'witness submission report loaded',
    visualInspectionClaim: 'not-yet-inspected',
  };
  await writeJsonAtomic(completionPath, report);
  for (const submitted of submission.submitted) {
    const cell = byId.get(submitted.witnessId);
    const status = runGreenroom(['status', submitted.jobId]);
    if (status.status === 'pending' || status.status === 'running') {
      report.nonterminal.push({ witnessId: cell.witnessId, jobId: submitted.jobId, status: status.status });
      continue;
    }
    try {
      report.accepted.push(await validateGestaltWitnessCompletion({ cell, status }));
      report.lastTrustworthyEvidence = `${report.accepted.length} nonempty rendered frames accepted; visual inspection pending`;
    } catch (error) {
      report.rejected.push({ witnessId: cell.witnessId, jobId: submitted.jobId, error: String(error?.message ?? error), status });
    }
    await writeJsonAtomic(completionPath, report);
  }
  if (report.rejected.length > 0) {
    report.status = 'failed';
    report.failurePhase = 'witness-validation';
  } else if (report.nonterminal.length > 0) {
    report.status = 'waiting';
  } else if (report.accepted.length === plan.cells.length) {
    report.status = 'complete-frames-uninspected';
  } else {
    report.status = 'failed';
    report.failurePhase = 'witness-accounting';
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
else throw new Error('usage: node run-witness.mjs <plan|submit|collect|collect-allow-pending>');
