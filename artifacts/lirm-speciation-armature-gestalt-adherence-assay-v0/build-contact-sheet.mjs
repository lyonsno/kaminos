import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGestaltAdherenceContactSheetManifest } from '../../lirm-speciation-gestalt-imagegen-core.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(artifactRoot, '../lirm-speciation-armature-gestalt-composite-assay-v0/witness');
const variant = process.env.KAMINOS_GESTALT_ADHERENCE_VARIANT ?? 'baseline';
const runRoot = variant === 'baseline' ? artifactRoot : resolve(artifactRoot, variant);
const planPath = resolve(runRoot, 'plan.json');
const completionPath = resolve(runRoot, 'completion-report.json');
const manifestPath = resolve(runRoot, 'contact-sheet-inputs.json');
const sheetPath = resolve(runRoot, variant === 'baseline'
  ? 'gestalt-adherence-contact-sheet.png'
  : `gestalt-adherence-${variant}-contact-sheet.png`);
const receiptPath = resolve(runRoot, 'contact-sheet-receipt.json');
const assemblerPath = resolve(artifactRoot, '../lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty output: ${path}`);
  return { path, bytes: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const completion = JSON.parse(await readFile(completionPath, 'utf8'));
const manifest = await buildGestaltAdherenceContactSheetManifest({ plan, completion, sourceRoot });
await writeFile(manifestPath, `${JSON.stringify(manifest.sheet, null, 2)}\n`);

const result = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
if (result.status !== 0) {
  await writeFile(receiptPath, `${JSON.stringify({
    schema: 'kaminos.lirm-speciation-gestalt-adherence-contact-sheet.v0',
    status: 'failed',
    failurePhase: 'assemble-contact-sheet',
    error: result.stderr || result.stdout,
    lastTrustworthyEvidence: await evidence(manifestPath),
  }, null, 2)}\n`);
  throw new Error(result.stderr || result.stdout);
}

const receipt = {
  schema: 'kaminos.lirm-speciation-gestalt-adherence-contact-sheet.v0',
  status: 'complete',
  visualInspectionClaim: 'not-yet-inspected',
  plan: await evidence(planPath),
  completion: await evidence(completionPath),
  manifest: await evidence(manifestPath),
  assembler: await evidence(assemblerPath),
  sheet: await evidence(sheetPath),
  sourceEvidence: manifest.evidence,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
