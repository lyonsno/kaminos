import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  writeLirmArmatureGestaltFamilyWitness,
} from '../../lirm-armature-gestalt-family-core.mjs';
import {
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(artifactRoot, '../..');
const sheetManifestPath = join(artifactRoot, 'conditioning-contact-sheet-manifest.json');
const sheetPath = join(artifactRoot, 'conditioning-contact-sheet.png');
const sheetReceiptPath = join(artifactRoot, 'conditioning-contact-sheet-receipt.json');
const reportPath = join(artifactRoot, 'report.json');
const assemblerPath = join(repoRoot, 'artifacts/lirm-trellis-guidance-pressure-assay-v1/assemble-contact-sheet.swift');

const evidence = async path => {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty evidence: ${path}`);
  return {
    path: relative(artifactRoot, path),
    byteSize: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
};

const familyResult = await writeLirmArmatureGestaltFamilyWitness({
  repoRoot,
  outDir: artifactRoot,
  pixelWidth: 256,
  pixelHeight: 192,
});
const familyReceipt = JSON.parse(await readFile(familyResult.receiptPath, 'utf8'));
if (familyReceipt.status !== 'complete' || familyReceipt.candidates.length !== 5) {
  throw new Error(`family witness is incomplete: ${familyReceipt.status}`);
}

const mapKinds = ['clay', 'depth', 'normal', 'semantic'];
const cells = [];
const sourceEvidence = [];
for (const candidate of familyReceipt.candidates) {
  const candidateReceiptPath = join(artifactRoot, candidate.receiptPath);
  const candidateReceipt = JSON.parse(await readFile(candidateReceiptPath, 'utf8'));
  if (candidateReceipt.status !== 'complete'
      || candidateReceipt.effectiveConfig.pixelWidth !== 256
      || candidateReceipt.effectiveConfig.pixelHeight !== 192) {
    throw new Error(`candidate conditioning receipt is incomplete or substituted: ${candidate.id}`);
  }
  for (const kind of mapKinds) {
    const map = candidateReceipt.outputInventory.maps.find(item => item.kind === kind);
    if (!map) throw new Error(`missing ${kind} map for ${candidate.id}`);
    const sourcePath = join(dirname(candidateReceiptPath), map.rasterPath);
    const live = await evidence(sourcePath);
    const admitted = candidateReceipt.outputEvidence.find(item => item.path === map.rasterPath);
    if (!admitted || admitted.sha256 !== live.sha256 || admitted.byteSize !== live.byteSize) {
      throw new Error(`conditioning evidence drift for ${candidate.id}/${kind}`);
    }
    sourceEvidence.push({ candidateId: candidate.id, kind, ...live });
    cells.push({
      sourcePath,
      title: candidate.id,
      viewLabel: kind.toUpperCase(),
    });
  }
}

const manifest = {
  width: 2048,
  cellWidth: 512,
  cellHeight: 420,
  imageHeight: 384,
  imageOffsetY: 0,
  headerHeight: 36,
  cells,
};
await writeFile(sheetManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const assembled = spawnSync('swift', [assemblerPath, sheetManifestPath, sheetPath], { encoding: 'utf8' });
if (assembled.status !== 0) {
  await writeFile(sheetReceiptPath, `${JSON.stringify({
    schema: 'kaminos.lirm-armature-gestalt-conditioning-contact-sheet.v0',
    status: 'failed',
    failurePhase: 'assemble-contact-sheet',
    errorMessage: assembled.stderr || assembled.stdout,
    lastTrustworthyEvidence: await evidence(sheetManifestPath),
  }, null, 2)}\n`);
  throw new Error(assembled.stderr || assembled.stdout);
}
const sheetBytes = await readFile(sheetPath);
const pngInspection = inspectPngEvidence(sheetBytes);
assertUsefulPngEvidence(pngInspection, {
  minWidth: 2048,
  minHeight: 2100,
  minLuminanceStdDev: 8,
  minActivePixelRatio: 0.02,
  minActiveBoundsRatio: 0.5,
}, 'multi-gestalt conditioning contact sheet');

const sheetReceipt = {
  schema: 'kaminos.lirm-armature-gestalt-conditioning-contact-sheet.v0',
  status: 'complete-uninspected',
  requestedRoute: 'kaminos/lirm-armature-gestalt-family/contact-sheet-v0',
  effectiveRoute: 'kaminos/lirm-armature-gestalt-family/contact-sheet-v0',
  requestedConfig: { candidateCount: 5, mapKinds, columns: 4 },
  effectiveConfig: { candidateCount: familyReceipt.candidates.length, mapKinds, columns: 4 },
  familyReceipt: await evidence(familyResult.receiptPath),
  manifest: await evidence(sheetManifestPath),
  assembler: await evidence(assemblerPath),
  sheet: await evidence(sheetPath),
  pngInspection,
  sourceEvidence,
  visualInspectionClaim: 'not-yet-inspected',
  lastTrustworthyEvidence: 'all 20 source maps match candidate receipts and assembled PNG passed structural evidence admission',
};
await writeFile(sheetReceiptPath, `${JSON.stringify(sheetReceipt, null, 2)}\n`);

const report = {
  schema: 'kaminos.lirm-armature-multi-gestalt-conditioning-assay.v0',
  status: 'conditioning-complete-uninspected',
  evidencePredicate: {
    candidateCount: 5,
    distinctArmatureProgramCount: 3,
    eachCandidateRequires: mapKinds,
    inferenceClaim: 'none',
    nextGate: 'operator-independent visual inspection before image inference',
  },
  familyReceipt: await evidence(familyResult.receiptPath),
  contactSheetReceipt: await evidence(sheetReceiptPath),
  contactSheet: await evidence(sheetPath),
  candidates: familyReceipt.candidates.map(candidate => ({
    id: candidate.id,
    armatureProgramId: candidate.armatureProgramId,
    acceptance: candidate.acceptance,
    donorSha256: candidate.donorSha256,
    metrics: candidate.metrics,
  })),
  falseClosureGuards: {
    visualProgressClaim: 'pending inspection',
    imagegenBasinClaim: 'not_yet_fired',
    trellisCastClaim: 'not_yet_fired',
    generalMorphologyMediumClaim: 'not_yet_assayed',
  },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
