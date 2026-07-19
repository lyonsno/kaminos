import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertExactIdCoverage,
  buildGreenroomSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltImagegenCompletion,
} from '../../lirm-speciation-gestalt-imagegen-core.mjs';
import {
  buildHeritableHybridLineageImagegenPlan,
  imagegenSubmissionFingerprint as submissionFingerprint,
  recoverMatchingImagegenSubmissions,
} from './imagegen-contract.mjs';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const runtimeRoot = resolve(
  process.env.KAMINOS_LIRM_HERITABLE_LINEAGE_IMAGEGEN_RUNTIME_ROOT
    ?? '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-heritable-lineage-imagegen-20260718',
);
const greenroomCli = resolve(
  process.env.KAMINOS_GPU_GREENROOM_BIN
    ?? '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom',
);
const witnessReceiptPath = resolve(artifactRoot, 'receipt.json');
const controlSheetReceiptPath = resolve(artifactRoot, 'control-contact-sheet-receipt.json');
const controlAdjudicationPath = resolve(artifactRoot, 'control-adjudication.json');
const planPath = resolve(artifactRoot, 'imagegen-plan.json');
const submissionPath = resolve(artifactRoot, 'imagegen-submission-report.json');
const collectionPath = resolve(artifactRoot, 'imagegen-collection.json');
const runnerFailurePath = resolve(artifactRoot, 'imagegen-runner-failure.json');
const durableOutputRoot = resolve(artifactRoot, 'imagegen-outputs');

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function fileEvidence(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty durable output: ${path}`);
  return {
    path: relative(artifactRoot, path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function runGreenroom(args) {
  const result = spawnSync(greenroomCli, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Greenroom ${args[0]} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return parseGreenroomCliOutput(result.stdout);
}

async function createPlan() {
  const plan = await buildHeritableHybridLineageImagegenPlan({
    witnessReceipt: JSON.parse(await readFile(witnessReceiptPath, 'utf8')),
    witnessRoot: artifactRoot,
    controlSheetReceipt: JSON.parse(await readFile(controlSheetReceiptPath, 'utf8')),
    controlAdjudication: JSON.parse(await readFile(controlAdjudicationPath, 'utf8')),
    controlSheetRoot: artifactRoot,
    promptRoot: resolve(artifactRoot, 'prompts'),
    outputRoot: runtimeRoot,
  });
  plan.sourceEvidence = {
    ...plan.sourceEvidence,
    witnessReceipt: await fileEvidence(witnessReceiptPath),
    controlSheetReceipt: await fileEvidence(controlSheetReceiptPath),
    controlAdjudication: await fileEvidence(controlAdjudicationPath),
  };
  await writeJsonAtomic(planPath, plan);
  return plan;
}

async function submit() {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (plan.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-plan.v0') {
    throw new Error(`unsupported lineage imagegen plan schema: ${plan.schema}`);
  }
  let prior = null;
  try { prior = JSON.parse(await readFile(submissionPath, 'utf8')); } catch {}
  const recovery = recoverMatchingImagegenSubmissions({
    cells: plan.cells,
    priorSubmitted: prior?.submitted,
  });
  const submittedById = new Map(recovery.recovered.map(item => [item.cellId, item]));
  const report = {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-submission.v0',
    status: 'submitting',
    requestedCount: plan.cells.length,
    submitted: plan.cells.flatMap(cell => submittedById.has(cell.cellId) ? [submittedById.get(cell.cellId)] : []),
    staleRecoveredSubmissions: recovery.staleRecoveredSubmissions,
    failurePhase: null,
    lastTrustworthyEvidence: `${submittedById.size}/${plan.cells.length} fingerprint-matched submissions recovered`,
  };
  await writeJsonAtomic(submissionPath, report);
  try {
    for (const cell of plan.cells) {
      if (submittedById.has(cell.cellId)) continue;
      const response = runGreenroom(['submit', ...buildGreenroomSubmitArgs(cell)]);
      if (!response.job_id) throw new Error(`submit returned no job id for ${cell.cellId}`);
      const submitted = {
        cellId: cell.cellId,
        candidateId: cell.candidateId,
        lineageId: cell.lineageId,
        generation: cell.generation,
        parentId: cell.parentId,
        submissionFingerprint: submissionFingerprint(cell),
        jobId: response.job_id,
        response,
      };
      report.submitted.push(submitted);
      submittedById.set(cell.cellId, submitted);
      report.lastTrustworthyEvidence = `${report.submitted.length}/${report.requestedCount} lineage imagegen jobs submitted through Greenroom`;
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
    plannedIds: plan.cells.map(cell => cell.cellId),
    observedIds: submission.submitted.map(item => item.cellId),
    label: 'heritable lineage imagegen submission',
  });
  const byId = new Map(plan.cells.map(cell => [cell.cellId, cell]));
  const report = {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-collection.v0',
    status: 'collecting',
    requestedCount: plan.cells.length,
    accepted: [],
    nonterminal: [],
    rejected: [],
    visualInspectionClaim: 'not-yet-inspected',
    failurePhase: null,
    lastTrustworthyEvidence: 'fingerprint-bound submission report loaded; no output accepted',
  };
  await mkdir(durableOutputRoot, { recursive: true });
  for (const submitted of submission.submitted) {
    const cell = byId.get(submitted.cellId);
    if (submitted.submissionFingerprint !== submissionFingerprint(cell)) {
      report.rejected.push({
        cellId: submitted.cellId,
        jobId: submitted.jobId,
        error: 'submission fingerprint does not match current lineage imagegen plan',
      });
      continue;
    }
    const status = runGreenroom(['status', submitted.jobId]);
    if (status.status === 'pending' || status.status === 'running') {
      report.nonterminal.push({ cellId: cell.cellId, jobId: submitted.jobId, status: status.status });
      continue;
    }
    try {
      const completion = await validateGestaltImagegenCompletion({ cell, status });
      const durablePath = resolve(durableOutputRoot, `${cell.cellId}.png`);
      await copyFile(completion.output.path, durablePath);
      const durableOutput = await fileEvidence(durablePath);
      if (durableOutput.sha256 !== completion.output.sha256
          || durableOutput.bytes !== completion.output.bytes) {
        throw new Error(`durable output copy mismatch: ${cell.cellId}`);
      }
      report.accepted.push({
        ...completion,
        candidateId: cell.candidateId,
        lineageId: cell.lineageId,
        generation: cell.generation,
        parentId: cell.parentId,
        inheritedCommitments: cell.inheritedCommitments,
        inheritedMutations: cell.inheritedMutations,
        lineagePressure: cell.lineagePressure,
        durableOutput,
      });
      report.lastTrustworthyEvidence = `${report.accepted.length}/${plan.cells.length} exact-route outputs copied durably; visual lineage adjudication pending`;
    } catch (error) {
      report.rejected.push({
        cellId: cell.cellId,
        jobId: submitted.jobId,
        observedStatus: status.status,
        failurePhase: status.failure_phase ?? 'completion-validation-or-durable-copy',
        error: String(error?.stack ?? error),
        lastTrustworthyEvidence: 'GPU Greenroom status receipt',
      });
    }
  }
  if (report.rejected.length > 0) {
    report.status = 'failed';
    report.failurePhase = 'completion-validation-or-durable-copy';
  } else if (report.nonterminal.length > 0 || report.accepted.length < plan.cells.length) {
    report.status = 'waiting';
  } else {
    report.status = 'complete-uninspected';
  }
  await writeJsonAtomic(collectionPath, report);
  if (report.status === 'failed' || (report.status === 'waiting' && !allowPending)) process.exitCode = 2;
  return report;
}

async function main() {
  const command = process.argv[2] ?? 'plan';
  if (command === 'plan') return createPlan();
  if (command === 'submit') return submit();
  if (command === 'collect') return collect();
  if (command === 'collect-allow-pending') return collect({ allowPending: true });
  throw new Error('usage: node run-imagegen.mjs <plan|submit|collect|collect-allow-pending>');
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch (error) {
  await writeJsonAtomic(runnerFailurePath, {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-runner-failure.v0',
    status: 'failed',
    failurePhase: `imagegen-${process.argv[2] ?? 'plan'}`,
    errorMessage: error.message,
    lastTrustworthyEvidence: 'lineage control receipts and any incrementally written plan or submission report',
  });
  throw error;
}
