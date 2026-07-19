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

export function buildCrossFamilyHybridContactSheetManifest({ accepted, artifactRoot: root }) {
  if (!Array.isArray(accepted) || accepted.length !== 6) {
    throw new Error(`cross-family hybrid contact sheet requires 6 accepted outputs, got ${accepted?.length ?? 0}`);
  }
  const candidateOrder = [...new Set(accepted.map(cell => cell.candidateId))];
  if (candidateOrder.length !== 3) throw new Error('cross-family hybrid contact sheet requires three candidate pairs');
  const cells = candidateOrder.flatMap(candidateId => {
    const pair = accepted.filter(cell => cell.candidateId === candidateId);
    const anatomical = pair.find(cell => cell.stance === 'anatomical-completion');
    const priorLed = pair.find(cell => cell.stance === 'prior-led-invention');
    if (!anatomical || !priorLed || pair.length !== 2 || anatomical.cellId === priorLed.cellId) {
      throw new Error(`duplicate or missing stance pair for ${candidateId}`);
    }
    return [anatomical, priorLed].map(cell => {
      if (!cell.durableOutput?.path) throw new Error(`missing durable output path: ${cell.cellId}`);
      return {
        cellId: cell.cellId,
        candidateId,
        stance: cell.stance,
        sourcePath: resolve(root, cell.durableOutput.path),
        title: candidateId,
        viewLabel: cell.stance === 'anatomical-completion' ? 'ANATOMICAL' : 'PRIOR-LED',
      };
    });
  });
  if (new Set(cells.map(cell => cell.cellId)).size !== cells.length) {
    throw new Error('duplicate or missing stance pair in contact sheet cells');
  }
  return {
    schema: 'kaminos.lirm-cross-family-hybrid-imagegen-contact-sheet-manifest.v0',
    columns: 2,
    rows: 3,
    width: 1024,
    cellWidth: 512,
    cellHeight: 550,
    imageHeight: 512,
    imageOffsetY: 0,
    cells,
  };
}

export async function writeCrossFamilyHybridContactSheet({ root = artifactRoot } = {}) {
  const collection = JSON.parse(await readFile(join(root, 'imagegen-collection.json'), 'utf8'));
  if (!['complete-uninspected', 'complete-inspected'].includes(collection.status)) {
    throw new Error(`cross-family imagegen collection is not complete: ${collection.status}`);
  }
  const manifest = buildCrossFamilyHybridContactSheetManifest({
    accepted: collection.accepted,
    artifactRoot: root,
  });
  const manifestPath = join(root, 'imagegen-contact-sheet-manifest.json');
  const outputPath = join(root, 'imagegen-pressure-contact-sheet.png');
  await atomicWriteJson(manifestPath, manifest);
  const assembler = join(root, '../lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift');
  const render = spawnSync('swift', [assembler, manifestPath, outputPath], { encoding: 'utf8' });
  if (render.status !== 0) throw new Error(`contact sheet assembly failed: ${render.stderr || render.stdout}`);
  const outputStat = await stat(outputPath);
  if (!outputStat.isFile() || outputStat.size < 100_000) throw new Error('contact sheet is missing or implausibly small');
  const bytes = await readFile(outputPath);
  const dimensions = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath], { encoding: 'utf8' });
  const height = manifest.rows * manifest.cellHeight;
  if (dimensions.status !== 0
      || !dimensions.stdout.includes(`pixelWidth: ${manifest.width}`)
      || !dimensions.stdout.includes(`pixelHeight: ${height}`)) {
    throw new Error(`contact sheet dimensions do not match manifest: ${dimensions.stdout || dimensions.stderr}`);
  }
  const receipt = {
    schema: 'kaminos.lirm-cross-family-hybrid-imagegen-contact-sheet-receipt.v0',
    status: 'complete-uninspected',
    requestedRoute: 'kaminos/local-swift-contact-sheet-v0',
    effectiveRoute: 'swift/AppKit',
    manifestPath: relative(root, manifestPath),
    contactSheet: {
      path: relative(root, outputPath),
      byteSize: bytes.length,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      width: manifest.width,
      height,
    },
    visualInspectionClaim: 'not-yet-inspected',
    falseClosureGuards: {
      missingOrPartialCollectionAccepted: false,
      duplicateOrUnlabeledCellsAccepted: false,
      blankOrImplausiblySmallRasterAccepted: false,
      contactSheetImpliesVisualSuccess: false,
    },
  };
  await atomicWriteJson(join(root, 'imagegen-contact-sheet-receipt.json'), receipt);
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await writeCrossFamilyHybridContactSheet(), null, 2)}\n`);
}
