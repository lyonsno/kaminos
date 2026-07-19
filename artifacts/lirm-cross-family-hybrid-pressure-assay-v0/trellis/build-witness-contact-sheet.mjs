import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const trellisRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(trellisRoot, '../../..');
const planPath = resolve(trellisRoot, 'witness-plan.json');
const completionPath = resolve(trellisRoot, 'witness-completion-report.json');
const manifestPath = resolve(trellisRoot, 'witness-contact-sheet-inputs.json');
const sheetPath = resolve(trellisRoot, 'trellis-witness-contact-sheet.png');
const receiptPath = resolve(trellisRoot, 'witness-contact-sheet-receipt.json');
const assemblerPath = resolve(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function evidence(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`missing or empty witness artifact: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function compactTitle(cell) {
  const titles = {
    'crown-halo-pendant-tripod-hybrid-survivor': 'CROWN HALO / PRIOR',
    'offset-keyhole-canopy-strider-hybrid-survivor': 'OFFSET KEYHOLE / PRIOR',
    'wide-portal-saddle-canopy-hybrid-survivor': 'WIDE PORTAL / PRIOR',
  };
  const title = titles[cell.evidenceRole];
  if (!title) throw new Error(`unknown evidence role: ${cell.evidenceRole}`);
  return title;
}

const initialized = {
  schema: 'kaminos.lirm-cross-family-hybrid-trellis-witness-contact-sheet.v0',
  status: 'running',
  failurePhase: null,
  visualInspectionClaim: 'not-yet-inspected',
  lastTrustworthyEvidence: 'builder invoked; no witness frame admitted',
};
await writeJsonAtomic(receiptPath, initialized);

try {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const completion = JSON.parse(await readFile(completionPath, 'utf8'));
  if (plan.schema !== 'kaminos.lirm-cross-family-hybrid-trellis-witness-plan.v0') {
    throw new Error(`unexpected witness plan schema: ${plan.schema}`);
  }
  if (completion.schema !== 'kaminos.lirm-cross-family-hybrid-trellis-witness-collection.v0'
      || completion.status !== 'complete-frames-uninspected') {
    throw new Error(`witness collection is not complete: ${completion.status}`);
  }
  const accepted = new Map(completion.accepted.map(item => [item.witnessId, item]));
  if (accepted.size !== plan.cells.length || accepted.size !== 12) {
    throw new Error(`accepted witness count does not satisfy 12-frame contract: ${accepted.size}`);
  }
  const cells = [];
  const sourceEvidence = [];
  for (const cell of plan.cells) {
    const acceptedFrame = accepted.get(cell.witnessId);
    if (!acceptedFrame) throw new Error(`missing accepted witness: ${cell.witnessId}`);
    const live = await evidence(acceptedFrame.output.path);
    if (live.sha256 !== acceptedFrame.output.sha256) throw new Error(`witness hash drift: ${cell.witnessId}`);
    sourceEvidence.push(live);
    cells.push({
      sourcePath: live.path,
      title: compactTitle(cell),
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
  await writeJsonAtomic(manifestPath, manifest);
  const render = spawnSync('swift', [assemblerPath, manifestPath, sheetPath], { encoding: 'utf8' });
  if (render.status !== 0) throw new Error(`witness contact sheet assembly failed: ${render.stderr || render.stdout}`);
  const receipt = {
    ...initialized,
    status: 'complete-uninspected',
    plan: await evidence(planPath),
    completion: await evidence(completionPath),
    manifest: await evidence(manifestPath),
    assembler: await evidence(assemblerPath),
    sheet: await evidence(sheetPath),
    sourceEvidence,
    falseClosureGuards: {
      partialFrameSetAccepted: false,
      routeValidatedFramesImplySpatialSuccess: false,
      frontViewOnlyAccepted: false,
    },
    lastTrustworthyEvidence: 'twelve route-validated witness frames assembled; human spatial inspection pending',
  };
  await writeJsonAtomic(receiptPath, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} catch (error) {
  const failure = {
    ...initialized,
    status: 'failed',
    failurePhase: 'witness-admission-or-contact-sheet-assembly',
    error: String(error?.stack ?? error),
    lastTrustworthyEvidence: 'builder invocation persisted; no contact sheet accepted',
  };
  await writeJsonAtomic(receiptPath, failure);
  throw error;
}
