import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildArmatureGestaltFamilyImagegenContactSheetManifest } from '../../../lirm-armature-program-imagegen-core.mjs';
import {
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../../lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const imagegenRoot = dirname(fileURLToPath(import.meta.url));
const artifactRoot = resolve(imagegenRoot, '..');
const repoRoot = resolve(artifactRoot, '../..');
const planPath = resolve(imagegenRoot, 'plan.json');
const completionPath = resolve(imagegenRoot, 'completion-report.json');
const receiptPath = resolve(imagegenRoot, 'contact-sheet-receipt.json');
const assemblerPath = resolve(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty evidence: ${path}`);
  return {
    path: relative(artifactRoot, path),
    byteSize: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

const initialized = {
  schema: 'kaminos.lirm-armature-gestalt-family-imagegen-contact-sheet.v0',
  status: 'running',
  requestedRoute: 'kaminos/lirm-armature-gestalt-family/imagegen-contact-sheet-v0',
  effectiveRoute: null,
  failurePhase: null,
  lastTrustworthyEvidence: 'builder invoked; no completion report admitted',
};
await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);

try {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const completion = JSON.parse(await readFile(completionPath, 'utf8'));
  const manifest = await buildArmatureGestaltFamilyImagegenContactSheetManifest({ plan, completion });
  const sheets = [];
  for (const seedSheet of manifest.sheets) {
    const manifestPath = resolve(imagegenRoot, `contact-sheet-seed${seedSheet.seed}-inputs.json`);
    const sheetPath = resolve(imagegenRoot, `multi-gestalt-imagegen-seed${seedSheet.seed}.png`);
    await writeFile(manifestPath, `${JSON.stringify(seedSheet.sheet, null, 2)}\n`);
    const assembled = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
    if (assembled.status !== 0) throw new Error(assembled.stderr || assembled.stdout);
    const sheetBytes = await readFile(sheetPath);
    const pngInspection = inspectPngEvidence(sheetBytes);
    assertUsefulPngEvidence(pngInspection, {
      minWidth: 2048,
      minHeight: 2740,
      minLuminanceStdDev: 8,
      minActivePixelRatio: 0.02,
      minActiveBoundsRatio: 0.5,
    }, `multi-gestalt imagegen contact sheet seed ${seedSheet.seed}`);
    sheets.push({
      seed: seedSheet.seed,
      manifest: await evidence(manifestPath),
      sheet: await evidence(sheetPath),
      pngInspection,
      sourceEvidence: seedSheet.evidence,
    });
  }

  const receipt = {
    ...initialized,
    status: 'complete-uninspected',
    effectiveRoute: initialized.requestedRoute,
    requestedConfig: { seedSheets: 2, candidateRows: 5, columns: 4, expectedGeneratedOutputs: 20 },
    effectiveConfig: { seedSheets: sheets.length, candidateRows: 5, columns: 4, generatedOutputs: completion.accepted.length },
    plan: await evidence(planPath),
    completion: await evidence(completionPath),
    assembler: await evidence(assemblerPath),
    sheets,
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: 'all 20 outputs and conditioning sources rehashed against receipts; both seed sheets passed structural PNG admission',
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const failure = {
    ...initialized,
    status: 'failed',
    failurePhase: 'completion-admission-or-contact-sheet-assembly',
    errorMessage: String(error?.stack ?? error),
    lastTrustworthyEvidence: 'builder invocation persisted; no visual evidence accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
}
