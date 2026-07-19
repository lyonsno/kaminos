import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHeritableHybridLineageImagegenSheetManifest } from './imagegen-contract.mjs';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)));

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

export async function writeHeritableHybridLineageImagegenContactSheet({ root = artifactRoot } = {}) {
  const plan = JSON.parse(await readFile(join(root, 'imagegen-plan.json'), 'utf8'));
  const collection = JSON.parse(await readFile(join(root, 'imagegen-collection.json'), 'utf8'));
  const manifest = buildHeritableHybridLineageImagegenSheetManifest({ plan, collection, artifactRoot: root });
  const sources = [];
  for (const cell of manifest.cells) {
    const bytes = await readFile(cell.sourcePath);
    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (bytes.length === 0 || sha256 !== cell.sourceSha256) {
      throw new Error(`lineage contact sheet source hash drift: ${cell.cellId}`);
    }
    sources.push({
      cellId: cell.cellId,
      candidateId: cell.candidateId,
      lineageId: cell.lineageId,
      generation: cell.generation,
      path: relative(root, cell.sourcePath),
      byteSize: bytes.length,
      sha256,
    });
  }
  const manifestPath = join(root, 'imagegen-contact-sheet-manifest.json');
  const outputPath = join(root, 'heritable-hybrid-lineage-imagegen-sheet.png');
  await writeJsonAtomic(manifestPath, manifest);
  const assembler = join(root, '../lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift');
  const render = spawnSync('swift', [assembler, manifestPath, outputPath], { encoding: 'utf8' });
  if (render.status !== 0) throw new Error(`lineage contact sheet assembly failed: ${render.stderr || render.stdout}`);
  const outputStat = await stat(outputPath);
  if (!outputStat.isFile() || outputStat.size < 100_000) {
    throw new Error('lineage contact sheet is missing or implausibly small');
  }
  const height = manifest.rows * manifest.cellHeight;
  const dimensions = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath], { encoding: 'utf8' });
  if (dimensions.status !== 0
      || !dimensions.stdout.includes(`pixelWidth: ${manifest.width}`)
      || !dimensions.stdout.includes(`pixelHeight: ${height}`)) {
    throw new Error(`lineage contact sheet dimensions do not match manifest: ${dimensions.stdout || dimensions.stderr}`);
  }
  const bytes = await readFile(outputPath);
  const receipt = {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-contact-sheet-receipt.v0',
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
    sources,
    visualInspectionVerified: false,
    visualInspectionClaim: 'not-yet-inspected',
    falseClosureGuards: {
      missingOrPartialCollectionAccepted: false,
      duplicateOrMisorderedGenerationAccepted: false,
      sourceHashDriftAccepted: false,
      blankOrImplausiblySmallRasterAccepted: false,
      contactSheetImpliesInheritanceSuccess: false,
      contactSheetImpliesSpatialInheritance: false,
    },
  };
  await writeJsonAtomic(join(root, 'imagegen-contact-sheet-receipt.json'), receipt);
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await writeHeritableHybridLineageImagegenContactSheet(), null, 2)}\n`);
}
