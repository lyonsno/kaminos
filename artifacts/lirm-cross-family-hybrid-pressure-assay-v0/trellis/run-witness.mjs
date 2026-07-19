import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertExactIdCoverage,
  buildGreenroomWitnessSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltWitnessCompletion,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';
import {
  buildCrossFamilyHybridTrellisWitnessPlan,
  recoverMatchingSubmissions,
  witnessSubmissionFingerprint as submissionFingerprint,
} from './assay-contract.mjs';

const trellisRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(trellisRoot, '../../..');
const planPath = resolve(trellisRoot, 'witness-plan.json');
const submissionPath = resolve(trellisRoot, 'witness-submission-report.json');
const completionPath = resolve(trellisRoot, 'witness-completion-report.json');
const durableFrameRoot = resolve(trellisRoot, 'witness', 'frames');
const greenroomOutputRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-cross-family-hybrid-trellis-20260719/witness';
const witnessScript = resolve(repoRoot, 'artifacts/generator-basin-fanout-20260710/witness/blender_glb_witness.py');
const greenroomCli = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function fileEvidence(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty durable witness: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function runGreenroom(args) {
  const result = spawnSync(greenroomCli, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Greenroom command failed (${result.status}): ${result.stderr || result.stdout}`);
  return parseGreenroomCliOutput(result.stdout);
}

async function createPlan() {
  const plan = await buildCrossFamilyHybridTrellisWitnessPlan({
    trellisPlan: JSON.parse(await readFile(resolve(trellisRoot, 'plan.json'), 'utf8')),
    trellisCompletion: JSON.parse(await readFile(resolve(trellisRoot, 'completion-report.json'), 'utf8')),
    witnessScript,
    outputRoot: greenroomOutputRoot,
  });
  await writeJsonAtomic(planPath, plan);
  return plan;
}

async function submit() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  let prior = null;
  try { prior = JSON.parse(await readFile(submissionPath, 'utf8')); } catch {}
  const recovery = recoverMatchingSubmissions({
    cells: plan.cells,
    priorSubmitted: prior?.submitted,
    idKey: 'witnessId',
    fingerprintFor: submissionFingerprint,
  });
  const submittedById = new Map(recovery.recovered.map(item => [item.witnessId, item]));
  const report = {
    schema: 'kaminos.lirm-cross-family-hybrid-trellis-witness-submission.v0',
    status: 'submitting',
    requestedCount: plan.cells.length,
    submitted: plan.cells.flatMap(cell => submittedById.has(cell.witnessId) ? [submittedById.get(cell.witnessId)] : []),
    staleRecoveredSubmissions: recovery.staleRecoveredSubmissions,
    failurePhase: null,
    lastTrustworthyEvidence: `${submittedById.size}/${plan.cells.length} previously accepted witness submissions recovered`,
  };
  await writeJsonAtomic(submissionPath, report);
  try {
    for (const cell of plan.cells) {
      if (submittedById.has(cell.witnessId)) continue;
      const response = runGreenroom(['submit', ...buildGreenroomWitnessSubmitArgs(cell)]);
      if (!response.job_id) throw new Error(`submit returned no job id for ${cell.witnessId}`);
      const submitted = {
        witnessId: cell.witnessId,
        submissionFingerprint: submissionFingerprint(cell),
        jobId: response.job_id,
        response,
      };
      report.submitted.push(submitted);
      submittedById.set(cell.witnessId, submitted);
      report.lastTrustworthyEvidence = `${report.submitted.length}/${report.requestedCount} witness jobs submitted through Greenroom`;
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
  assertExactIdCoverage({
    plannedIds: plan.cells.map(cell => cell.witnessId),
    observedIds: submission.submitted.map(item => item.witnessId),
    label: 'rare gestalt Trellis witness submission',
  });
  const byId = new Map(plan.cells.map(cell => [cell.witnessId, cell]));
  const report = {
    schema: 'kaminos.lirm-cross-family-hybrid-trellis-witness-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    failurePhase: null,
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: 'witness submission loaded; no frame accepted',
  };
  await mkdir(durableFrameRoot, { recursive: true });
  for (const submitted of submission.submitted) {
    const cell = byId.get(submitted.witnessId);
    if (submitted.submissionFingerprint !== submissionFingerprint(cell)) {
      report.rejected.push({
        witnessId: cell.witnessId,
        jobId: submitted.jobId,
        error: 'submission fingerprint does not match current witness plan',
      });
      continue;
    }
    const status = runGreenroom(['status', submitted.jobId]);
    if (status.status === 'pending' || status.status === 'running') {
      report.nonterminal.push({ witnessId: cell.witnessId, jobId: submitted.jobId, status: status.status });
      continue;
    }
    try {
      const completion = await validateGestaltWitnessCompletion({ cell, status });
      const durablePath = resolve(durableFrameRoot, `${cell.witnessId}.png`);
      await copyFile(completion.output.path, durablePath);
      const durableOutput = await fileEvidence(durablePath);
      if (durableOutput.sha256 !== completion.output.sha256) throw new Error(`durable witness hash drift: ${cell.witnessId}`);
      report.accepted.push({
        ...completion,
        evidenceRole: cell.evidenceRole,
        greenroomOutput: completion.output,
        output: durableOutput,
      });
      report.lastTrustworthyEvidence = `${report.accepted.length}/${plan.cells.length} route-validated witness frames copied; visual inspection pending`;
    } catch (error) {
      report.rejected.push({ witnessId: cell.witnessId, jobId: submitted.jobId, error: String(error?.stack ?? error), status });
    }
  }
  if (report.rejected.length > 0) {
    report.status = 'failed';
    report.failurePhase = 'witness-validation-or-durable-copy';
  } else if (report.nonterminal.length > 0 || report.accepted.length < plan.cells.length) {
    report.status = 'waiting';
  } else {
    report.status = 'complete-frames-uninspected';
  }
  await writeJsonAtomic(completionPath, report);
  if (report.status === 'failed' || (report.status === 'waiting' && !allowPending)) process.exitCode = 2;
  return report;
}

const command = process.argv[2];
if (command === 'plan') process.stdout.write(`${JSON.stringify(await createPlan(), null, 2)}\n`);
else if (command === 'submit') process.stdout.write(`${JSON.stringify(await submit(), null, 2)}\n`);
else if (command === 'collect') process.stdout.write(`${JSON.stringify(await collect(), null, 2)}\n`);
else if (command === 'collect-allow-pending') process.stdout.write(`${JSON.stringify(await collect({ allowPending: true }), null, 2)}\n`);
else throw new Error('usage: node run-witness.mjs <plan|submit|collect|collect-allow-pending>');
