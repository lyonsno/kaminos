import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const trellisRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(trellisRoot, '../../..');
const planPath = resolve(trellisRoot, 'witness-plan.json');
const completionPath = resolve(trellisRoot, 'witness-completion-report.json');
const manifestPath = resolve(trellisRoot, 'witness-contact-sheet-inputs.json');
const sheetPath = resolve(trellisRoot, 'trellis-witness-contact-sheet.png');
const receiptPath = resolve(trellisRoot, 'witness-contact-sheet-receipt.json');
const assemblerPath = resolve(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty output: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

const initialized = {
  schema: 'kaminos.lirm-armature-gestalt-family-trellis-witness-contact-sheet.v0',
  status: 'running',
  failurePhase: null,
  visualInspectionClaim: 'not-yet-inspected',
  lastTrustworthyEvidence: 'builder invoked; no witness frame admitted',
};
await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);

try {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const completion = JSON.parse(await readFile(completionPath, 'utf8'));
  if (plan.schema !== 'kaminos.lirm-speciation-gestalt-trellis-witness-plan.v0') {
    throw new Error(`unexpected plan schema: ${plan.schema}`);
  }
  if (completion.schema !== 'kaminos.lirm-speciation-gestalt-trellis-witness-collection.v0'
    || completion.status !== 'complete-frames-uninspected') {
    throw new Error(`witness collection is not complete: ${completion.status}`);
  }
  const accepted = new Map(completion.accepted.map(entry => [entry.witnessId, entry]));
  if (accepted.size !== plan.cells.length) throw new Error('accepted witness count does not match plan');
  const cells = [];
  const sourceEvidence = [];
  for (const cell of plan.cells) {
    const acceptedFrame = accepted.get(cell.witnessId);
    if (!acceptedFrame) throw new Error(`missing accepted frame: ${cell.witnessId}`);
    const live = await evidence(cell.outputPath);
    if (live.sha256 !== acceptedFrame.output.sha256) throw new Error(`witness hash drift: ${cell.witnessId}`);
    sourceEvidence.push(live);
    cells.push({
      sourcePath: live.path,
      title: 'UPRIGHT BASIN 10 / SEED 718113',
      viewLabel: cell.view.toUpperCase(),
    });
  }
  const manifest = {
    width: 2048,
    cellWidth: 512,
    cellHeight: 455,
    imageHeight: 419,
    imageOffsetY: 0,
    headerHeight: 36,
    cells,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const receipt = {
    ...initialized,
    status: 'complete-uninspected',
    plan: await evidence(planPath),
    completion: await evidence(completionPath),
    manifest: await evidence(manifestPath),
    assembler: await evidence(assemblerPath),
    sheet: await evidence(sheetPath),
    sourceEvidence,
    lastTrustworthyEvidence: 'four route-validated witness frames assembled; human visual inspection pending',
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const failure = {
    ...initialized,
    status: 'failed',
    failurePhase: 'witness-admission-or-contact-sheet-assembly',
    error: String(error?.stack ?? error),
    lastTrustworthyEvidence: 'builder invocation persisted; no contact sheet accepted',
  };
  await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
}
