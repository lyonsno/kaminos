import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../../lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const styleRoot = dirname(fileURLToPath(import.meta.url));
const artifactRoot = resolve(styleRoot, '..');
const repoRoot = resolve(artifactRoot, '../..');
const planPath = resolve(styleRoot, 'plan.json');
const completionPath = resolve(styleRoot, 'completion-report.json');
const baselinePlanPath = resolve(artifactRoot, 'imagegen/plan.json');
const baselineCompletionPath = resolve(artifactRoot, 'imagegen/completion-report.json');
const receiptPath = resolve(styleRoot, 'contact-sheet-receipt.json');
const assemblerPath = resolve(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty evidence: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

async function assertEvidence(expected) {
  const observed = await evidence(expected.path);
  if (observed.bytes !== (expected.bytes ?? expected.byteSize) || observed.sha256 !== expected.sha256) {
    throw new Error(`evidence drift: ${expected.path}`);
  }
  return observed;
}

function acceptedById(completion, expectedSchema) {
  if (completion.schema !== expectedSchema || completion.status !== 'complete') {
    throw new Error(`completion is not admissible: ${completion.schema} / ${completion.status}`);
  }
  return new Map(completion.accepted.map(entry => [entry.cellId, entry]));
}

async function assembleSheet({ name, cells, sourceEvidence }) {
  const manifestPath = resolve(styleRoot, `${name}-inputs.json`);
  const sheetPath = resolve(styleRoot, `${name}.png`);
  const manifest = {
    width: 2048,
    cellWidth: 512,
    cellHeight: 548,
    imageHeight: 512,
    imageOffsetY: 0,
    headerHeight: 36,
    cells,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const assembled = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
  if (assembled.status !== 0) throw new Error(assembled.stderr || assembled.stdout);
  const pngInspection = inspectPngEvidence(await readFile(sheetPath));
  assertUsefulPngEvidence(pngInspection, {
    minWidth: 2048,
    minHeight: 2740,
    minLuminanceStdDev: 8,
    minActivePixelRatio: 0.02,
    minActiveBoundsRatio: 0.5,
  }, name);
  return {
    manifest: await evidence(manifestPath),
    sheet: await evidence(sheetPath),
    pngInspection,
    sourceEvidence,
  };
}

const initialized = {
  schema: 'kaminos.lirm-armature-gestalt-family-style-axis-contact-sheet.v0',
  status: 'running',
  failurePhase: null,
  visualInspectionClaim: 'not-yet-inspected',
  lastTrustworthyEvidence: 'builder invoked; no source output admitted',
};
await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);

try {
  const [plan, completion, baselinePlan, baselineCompletion] = await Promise.all([
    readFile(planPath, 'utf8').then(JSON.parse),
    readFile(completionPath, 'utf8').then(JSON.parse),
    readFile(baselinePlanPath, 'utf8').then(JSON.parse),
    readFile(baselineCompletionPath, 'utf8').then(JSON.parse),
  ]);
  const styleAccepted = acceptedById(
    completion,
    'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0',
  );
  const baselineAccepted = acceptedById(
    baselineCompletion,
    'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0',
  );
  const baselinePlanned = new Map(baselinePlan.cells.map(cell => [cell.cellId, cell]));
  const candidates = plan.comparisonContract.fixedCandidateIds;
  const planByCandidateSeed = new Map(plan.cells.map(cell => [`${cell.candidateId}\0${cell.seed}`, cell]));
  const sheets = [];

  for (const seed of [718113, 718211]) {
    const cells = [];
    const sourceEvidence = [];
    for (const candidateId of candidates) {
      const styleCell = planByCandidateSeed.get(`${candidateId}\0${seed}`);
      const styleOutput = styleAccepted.get(styleCell?.cellId);
      if (!styleCell || !styleOutput) throw new Error(`missing style output: ${candidateId} / ${seed}`);
      const clay = await assertEvidence(styleCell.input);
      const depth = await assertEvidence(styleCell.references[0]);
      const normal = await assertEvidence(styleCell.references[1]);
      const style = await assertEvidence(styleOutput.output);
      sourceEvidence.push(clay, depth, normal, style);
      cells.push(
        { sourcePath: clay.path, title: candidateId, viewLabel: 'ARMATURE' },
        seed === 718113
          ? { sourcePath: normal.path, title: candidateId, viewLabel: 'NORMAL' }
          : { sourcePath: depth.path, title: candidateId, viewLabel: 'DEPTH' },
      );
      if (seed === 718113) {
        const baselineId = `${candidateId}-clay-depth-normal-world-creature-invention-seed718113`;
        const baselineCell = baselinePlanned.get(baselineId);
        const baselineOutput = baselineAccepted.get(baselineId);
        if (!baselineCell || !baselineOutput) throw new Error(`missing exact-seed baseline: ${candidateId}`);
        const baseline = await assertEvidence(baselineOutput.output);
        sourceEvidence.push(baseline);
        cells.push(
          { sourcePath: baseline.path, title: candidateId, viewLabel: 'BASE' },
          { sourcePath: style.path, title: candidateId, viewLabel: 'MINERAL' },
        );
      } else {
        cells.push(
          { sourcePath: normal.path, title: candidateId, viewLabel: 'NORMAL' },
          { sourcePath: style.path, title: candidateId, viewLabel: 'MINERAL' },
        );
      }
    }
    sheets.push(await assembleSheet({
      name: seed === 718113 ? 'style-axis-exact-seed718113' : 'style-axis-replication-seed718211',
      cells,
      sourceEvidence,
    }));
  }

  const receipt = {
    ...initialized,
    status: 'complete-uninspected',
    visualInspectionClaim: 'not-yet-inspected',
    plan: await evidence(planPath),
    completion: await evidence(completionPath),
    baselinePlan: await evidence(baselinePlanPath),
    baselineCompletion: await evidence(baselineCompletionPath),
    assembler: await evidence(assemblerPath),
    sheets,
    lastTrustworthyEvidence: 'all ten style outputs rehashed; exact-seed baseline and fresh-seed replication sheets passed structural PNG admission',
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const failure = {
    ...initialized,
    status: 'failed',
    failurePhase: 'completion-admission-or-contact-sheet-assembly',
    error: String(error?.stack ?? error),
    lastTrustworthyEvidence: 'builder invocation persisted; no contact sheet accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
}
