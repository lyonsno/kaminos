import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = dirname(fileURLToPath(import.meta.url));

const atomicWriteJson = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

export function buildRareGestaltContactSheetManifest({ accepted, planCells = [], artifactRoot: root }) {
  if (!Array.isArray(accepted) || accepted.length !== 12) {
    throw new Error(`rare gestalt contact sheet requires 12 accepted outputs, got ${accepted?.length ?? 0}`);
  }
  const planByCell = new Map(planCells.map(cell => [cell.cellId, cell]));
  const normalized = accepted.map(entry => {
    const planCell = planByCell.get(entry.cellId);
    const candidateId = entry.candidateId ?? planCell?.candidateId;
    const stance = entry.stance ?? planCell?.stance;
    if (!candidateId || !stance || !entry.durableOutput?.path) {
      throw new Error(`incomplete contact sheet cell metadata: ${entry.cellId}`);
    }
    return {
      cellId: entry.cellId,
      candidateId,
      stance,
      sourcePath: resolve(root, entry.durableOutput.path),
      title: candidateId,
      viewLabel: stance === 'anatomical-completion' ? 'ANATOMICAL' : 'PRIOR-LED',
    };
  });
  const candidateOrder = [...new Set(normalized.map(cell => cell.candidateId))];
  if (candidateOrder.length !== 6) throw new Error(`expected six candidate pairs, got ${candidateOrder.length}`);
  const cells = candidateOrder.flatMap(candidateId => {
    const pair = normalized.filter(cell => cell.candidateId === candidateId);
    const anatomical = pair.find(cell => cell.stance === 'anatomical-completion');
    const priorLed = pair.find(cell => cell.stance === 'prior-led-invention');
    if (!anatomical || !priorLed || pair.length !== 2) throw new Error(`missing stance pair for ${candidateId}`);
    return [anatomical, priorLed];
  });
  return {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-contact-sheet-manifest.v0',
    columns: 2,
    rows: 6,
    width: 1024,
    cellWidth: 512,
    cellHeight: 570,
    imageHeight: 512,
    imageOffsetY: 0,
    cells,
  };
}

export async function writeRareGestaltContactSheet({ root = artifactRoot } = {}) {
  const plan = JSON.parse(await readFile(join(root, 'imagegen-plan.json'), 'utf8'));
  const collection = JSON.parse(await readFile(join(root, 'imagegen-collection.json'), 'utf8'));
  if (collection.status !== 'complete-uninspected' && collection.status !== 'complete-inspected') {
    throw new Error(`imagegen collection is not complete: ${collection.status}`);
  }
  const manifest = buildRareGestaltContactSheetManifest({
    accepted: collection.accepted,
    planCells: plan.cells,
    artifactRoot: root,
  });
  const manifestPath = join(root, 'imagegen-contact-sheet-manifest.json');
  const outputPath = join(root, 'imagegen-pressure-contact-sheet.png');
  await atomicWriteJson(manifestPath, manifest);
  const render = spawnSync('swift', [join(root, 'assemble-imagegen-contact-sheet.swift'), manifestPath, outputPath], {
    encoding: 'utf8',
  });
  if (render.status !== 0) throw new Error(`contact sheet assembly failed: ${render.stderr || render.stdout}`);
  const outputStat = await stat(outputPath);
  if (!outputStat.isFile() || outputStat.size < 100_000) throw new Error('contact sheet is missing or implausibly small');
  const bytes = await readFile(outputPath);
  const dimensions = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath], { encoding: 'utf8' });
  if (dimensions.status !== 0
      || !dimensions.stdout.includes(`pixelWidth: ${manifest.width}`)
      || !dimensions.stdout.includes(`pixelHeight: ${manifest.rows * manifest.cellHeight}`)) {
    throw new Error(`contact sheet dimensions do not match manifest: ${dimensions.stdout || dimensions.stderr}`);
  }
  const receipt = {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-contact-sheet-receipt.v0',
    status: 'complete-uninspected',
    requestedRoute: 'kaminos/local-swift-contact-sheet-v0',
    effectiveRoute: 'swift/AppKit',
    manifestPath: relative(root, manifestPath),
    contactSheet: {
      path: relative(root, outputPath),
      byteSize: bytes.length,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      width: manifest.width,
      height: manifest.rows * manifest.cellHeight,
    },
    visualInspectionClaim: 'not-yet-inspected',
    falseClosureGuards: {
      missingOrPartialCollectionAccepted: false,
      unlabeledCellsAccepted: false,
      blankOrImplausiblySmallRasterAccepted: false,
      contactSheetImpliesVisualSuccess: false,
    },
  };
  await atomicWriteJson(join(root, 'imagegen-contact-sheet-receipt.json'), receipt);
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await writeRareGestaltContactSheet(), null, 2)}\n`);
}
