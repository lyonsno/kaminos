#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(artifactRoot, '..', '..');
const witnessRoot = join(artifactRoot, 'witness');
const receipt = JSON.parse(readFileSync(join(witnessRoot, 'receipt.json'), 'utf8'));
const baselineRoot = join(artifactRoot, 'baselines');
const assemblerPath = join(repoRoot, 'artifacts', 'lirm-trellis-guidance-pressure-assay-v1', 'assemble-contact-sheet.swift');
const kinds = ['clay', 'depth', 'normal', 'mask'];
const evidence = [];

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function fileEvidence(path) {
  const bytes = readFileSync(path);
  return { path: path.slice(artifactRoot.length + 1), byteSize: bytes.byteLength, sha256: sha256(bytes) };
}

function requireSource(path) {
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`missing or blank contact-sheet source: ${path}`);
  return path;
}

function bundle(candidateId, generationId, pressure) {
  const found = receipt.bundles.find(item => item.candidateId === candidateId
    && item.dualLineage.silhouette.generationId === generationId
    && item.fieldModel.gestaltPressure === pressure);
  if (!found) throw new Error(`missing composite bundle ${candidateId} ${generationId} p${pressure}`);
  return found;
}

function baselineCell(candidateId, kind, title) {
  return {
    sourcePath: requireSource(join(baselineRoot, candidateId, `${kind}-implicit.png`)),
    title,
    viewLabel: `${candidateId} procedural`,
  };
}

function compositeCell(selected, kind, title) {
  return {
    sourcePath: requireSource(join(witnessRoot, selected.compositeId, `${kind}-composite.png`)),
    title,
    viewLabel: `${selected.candidateId} composite`,
  };
}

function assemble(name, cells) {
  if (cells.length % 4 !== 0) throw new Error(`${name} requires a cell count divisible by four`);
  const manifestPath = join(artifactRoot, `${name}.inputs.json`);
  const outputPath = join(artifactRoot, `${name}.png`);
  const manifest = {
    width: 2048,
    cellWidth: 512,
    cellHeight: 570,
    imageHeight: 512,
    imageOffsetY: 8,
    headerHeight: 50,
    cells,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = spawnSync('/usr/bin/swift', [assemblerPath, manifestPath, outputPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`contact sheet assembly failed for ${name}: ${result.stderr || result.stdout}`);
  evidence.push(fileEvidence(manifestPath), fileEvidence(outputPath));
  return { name, rows: cells.length / 4, cells: cells.length, manifest: fileEvidence(manifestPath), output: fileEvidence(outputPath) };
}

const generations = [
  ['basin-03-s3p00-n00', 'B03'],
  ['basin-10-s3p00-n00', 'B10'],
  ['basin-15-s3p00-n00', 'B15'],
  ['basin-22-s1p50-n00', 'B22'],
];
const pressures = [0.25, 0.46, 0.67];
const sheets = [];
for (const kind of kinds) {
  const pressureCells = generations.flatMap(([generationId, short]) => [
    baselineCell('lirm-armature-22', kind, `${short} baseline`),
    ...pressures.map(pressure => compositeCell(bundle('lirm-armature-22', generationId, pressure), kind, `${short} p${pressure.toFixed(2)}`)),
  ]);
  sheets.push(assemble(`pressure-${kind}-contact-sheet`, pressureCells));

  const retentionCells = ['lirm-armature-08', 'lirm-armature-16', 'lirm-armature-22', 'lirm-armature-24']
    .flatMap(candidateId => [
      baselineCell(candidateId, kind, `${candidateId.slice(-2)} baseline`),
      compositeCell(bundle(candidateId, 'basin-10-s3p00-n00', 0.46), kind, `${candidateId.slice(-2)} B10 p0.46`),
    ]);
  sheets.push(assemble(`armature-retention-${kind}-contact-sheet`, retentionCells));
}

const sheetReceipt = {
  schema: 'kaminos.lirm-speciation-armature-gestalt-composite-contact-sheets.v0',
  sourceWitness: fileEvidence(join(witnessRoot, 'receipt.json')),
  assembler: {
    path: assemblerPath,
    sha256: sha256(readFileSync(assemblerPath)),
  },
  sheets,
  outputEvidence: evidence,
  falseClosureGuards: {
    allSourcesRequiredNonblank: true,
    operatorSmokeClaim: 'not_yet_requested',
    visualInspectionClaim: 'not_yet_inspected',
  },
};
writeFileSync(join(artifactRoot, 'contact-sheet-receipt.json'), `${JSON.stringify(sheetReceipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ schema: sheetReceipt.schema, sheetCount: sheets.length, sheets: sheets.map(item => item.output) }, null, 2)}\n`);
