import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGestaltImagegenContactSheetManifest } from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

const imagegenRoot = dirname(fileURLToPath(import.meta.url));
const artifactRoot = resolve(imagegenRoot, '..');
const sourceRoot = resolve(artifactRoot, 'witness');
const planPath = resolve(imagegenRoot, 'plan.json');
const completionPath = resolve(imagegenRoot, 'completion-report.json');
const manifestPath = resolve(imagegenRoot, 'contact-sheet-inputs.json');
const sheetPath = resolve(imagegenRoot, 'gestalt-imagegen-contact-sheet.png');
const receiptPath = resolve(imagegenRoot, 'contact-sheet-receipt.json');
const assemblerPath = resolve(artifactRoot, '../lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty output: ${path}`);
  return { path, bytes: bytes.length, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const completion = JSON.parse(await readFile(completionPath, 'utf8'));
const manifest = await buildGestaltImagegenContactSheetManifest({ plan, completion, sourceRoot });
await writeFile(manifestPath, `${JSON.stringify(manifest.sheet, null, 2)}\n`);

const result = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
if (result.status !== 0) {
  await writeFile(receiptPath, `${JSON.stringify({
    schema: 'kaminos.lirm-speciation-gestalt-imagegen-contact-sheet.v0',
    status: 'failed',
    failurePhase: 'assemble-contact-sheet',
    error: result.stderr || result.stdout,
    lastTrustworthyEvidence: await evidence(manifestPath),
  }, null, 2)}\n`);
  throw new Error(result.stderr || result.stdout);
}

const receipt = {
  schema: 'kaminos.lirm-speciation-gestalt-imagegen-contact-sheet.v0',
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
