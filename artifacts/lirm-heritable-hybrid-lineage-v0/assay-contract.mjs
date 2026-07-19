import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
  writeLirmArmatureProgramImplicitBodyWitness,
} from '../../lirm-speciation-armature-core.js';
import {
  HERITABLE_HYBRID_BRANCHES,
  HERITABLE_HYBRID_FOUNDER,
} from '../../lirm-heritable-hybrid-lineage-program.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const atomicWriteJson = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};
const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function buildHeritableHybridLineagePlan({
  founder = HERITABLE_HYBRID_FOUNDER,
  branches = HERITABLE_HYBRID_BRANCHES,
} = {}) {
  if (!founder || founder.generation !== 0 || founder.parentId !== null) {
    throw new Error('heritable hybrid lineage requires a generation-zero founder');
  }
  if (!Array.isArray(branches) || branches.length === 0) throw new Error('heritable hybrid lineage requires branches');
  const candidates = [founder];
  const edges = [];
  const lineages = [];
  const ids = new Set([founder.id]);
  for (const branch of branches) {
    if (!Array.isArray(branch.generations) || branch.generations.length === 0) {
      throw new Error(`lineage branch has no generations: ${branch.id}`);
    }
    let parent = founder;
    for (const descendant of branch.generations) {
      if (descendant.parentId !== parent.id || descendant.generation !== parent.generation + 1) {
        throw new Error(`missing or misordered lineage parent: ${descendant.id}`);
      }
      if (ids.has(descendant.id)) throw new Error(`duplicate lineage candidate id: ${descendant.id}`);
      ids.add(descendant.id);
      candidates.push(descendant);
      edges.push({ lineageId: branch.id, parentId: parent.id, childId: descendant.id });
      parent = descendant;
    }
    lineages.push({
      id: branch.id,
      requiredDerivedRole: branch.requiredDerivedRole,
      generationIds: branch.generations.map(item => item.id),
      terminalId: parent.id,
    });
  }
  return {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-plan.v0',
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    founderId: founder.id,
    candidates,
    edges,
    lineages,
    evidencePredicate: {
      minimumInheritedCommitments: 4,
      minimumDistinctTerminalLineages: 3,
      requireCumulativeMutationReceipts: true,
      requireOpenAnnularNegativeSpace: true,
      requireMultiGenerationVisualInspection: true,
      downstreamClaim: 'forbidden_until_imagegen_and_trellis_witnessed',
    },
  };
}

export function buildHeritableHybridLineageSheetManifest({ plan, outputs }) {
  if (!plan || !Array.isArray(outputs)) throw new Error('lineage sheet requires plan and outputs');
  const outputById = new Map(outputs.map(output => [output.id, output]));
  const cells = [];
  for (const lineage of plan.lineages) {
    const ids = [plan.founderId, ...lineage.generationIds];
    if (ids.length !== 4) throw new Error(`lineage sheet requires founder plus three generations: ${lineage.id}`);
    for (const [generation, candidateId] of ids.entries()) {
      const output = outputById.get(candidateId);
      if (!output?.clayPath || !output?.claySha256) throw new Error(`lineage sheet output missing: ${candidateId}`);
      cells.push({
        candidateId,
        lineageId: lineage.id,
        generation,
        sourcePath: output.clayPath,
        sourceSha256: output.claySha256,
        title: generation === 0 ? 'FOUNDER' : `${lineage.id} G${generation}`,
        viewLabel: generation === 0 ? `shared ancestor / ${lineage.id}` : `inherited generation ${generation}`,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-control-sheet-manifest.v0',
    columns: 4,
    rows: 3,
    width: 1280,
    cellWidth: 320,
    cellHeight: 296,
    imageHeight: 256,
    imageOffsetY: 0,
    cells,
  };
}

export async function writeHeritableHybridLineageWitness({
  outDir = artifactRoot,
  candidates = buildHeritableHybridLineagePlan().candidates,
  pixelWidth = 288,
  pixelHeight = 256,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const initialized = {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-witness.v0',
    status: 'running',
    phase: 'writer-initialized',
    failurePhase: null,
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    requestedConfig: { pixelWidth, pixelHeight },
    requestedCandidateIds: candidates.map(item => item.id),
    outputs: [],
    visualInspectionClaim: 'not-yet-inspected',
    lastTrustworthyEvidence: 'invocation recorded; no lineage control accepted',
  };
  await atomicWriteJson(receiptPath, initialized);
  let phase = 'lineage-validation';
  try {
    const canonical = buildHeritableHybridLineagePlan();
    if (!Array.isArray(candidates) || candidates.length !== 10) {
      throw new Error(`heritable hybrid lineage requires ten lineage candidates, got ${candidates?.length ?? 0}`);
    }
    if (candidates.some((item, index) => item.id !== canonical.candidates[index].id)) {
      throw new Error('lineage candidate order or identity drifted from canonical plan');
    }
    phase = 'control-witness-write';
    const outputs = [];
    for (const candidate of candidates) {
      const candidateOutDir = join(outDir, 'candidates', candidate.id);
      const result = await writeLirmArmatureProgramImplicitBodyWitness({
        outDir: candidateOutDir,
        armatureProgram: candidate.program,
        parameters: candidate.parameters,
        candidateId: candidate.id,
        pixelWidth,
        pixelHeight,
      });
      const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
      if (receipt.status !== 'complete') throw new Error(`lineage candidate witness incomplete: ${candidate.id}`);
      const clay = receipt.outputInventory.maps.find(item => item.kind === 'clay');
      const evidence = receipt.outputEvidence.find(item => item.path === clay?.rasterPath);
      if (!clay?.rasterPath || !evidence?.sha256) throw new Error(`lineage candidate clay evidence missing: ${candidate.id}`);
      outputs.push({
        id: candidate.id,
        lineageId: candidate.lineageId,
        generation: candidate.generation,
        parentId: candidate.parentId,
        inheritedCommitments: [...candidate.inheritedCommitments],
        inheritedMutations: [...candidate.inheritedMutations],
        lineagePressure: candidate.lineagePressure,
        receiptPath: relative(outDir, result.receiptPath),
        clayPath: resolve(candidateOutDir, clay.rasterPath),
        claySha256: evidence.sha256,
        receipt,
      });
    }
    const completed = {
      ...initialized,
      status: 'complete-uninspected',
      phase: 'control-witnesses-written',
      effectiveRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
      effectiveConfig: { pixelWidth, pixelHeight },
      plan: {
        schema: canonical.schema,
        founderId: canonical.founderId,
        edges: canonical.edges,
        lineages: canonical.lineages,
        evidencePredicate: canonical.evidencePredicate,
      },
      outputs,
      falseClosureGuards: {
        missingGenerationCountsAsSuccess: false,
        visualSimilarityAloneProvesInheritance: false,
        parameterReceiptsAloneProveVisibleDivergence: false,
        generatorOrSpatialCastClaim: 'forbidden',
        visualSelectionRequiresInspection: true,
      },
      lastTrustworthyEvidence: '10 lineage control packages written with parameter ancestry and per-output hash evidence; visual inspection pending',
    };
    await atomicWriteJson(receiptPath, completed);
    return completed;
  } catch (error) {
    await atomicWriteJson(receiptPath, {
      ...initialized,
      status: 'failed',
      phase: 'failed',
      failurePhase: phase,
      errorMessage: error.message,
      lastTrustworthyEvidence: phase === 'lineage-validation'
        ? 'invocation recorded; no lineage candidate accepted'
        : 'canonical lineage accepted; one or more control witnesses incomplete',
    });
    throw error;
  }
}

export async function writeHeritableHybridLineageControlSheet({ outDir = artifactRoot } = {}) {
  const receipt = JSON.parse(await readFile(join(outDir, 'receipt.json'), 'utf8'));
  if (receipt.status !== 'complete-uninspected' && receipt.status !== 'complete-inspected') {
    throw new Error(`lineage controls are incomplete: ${receipt.status}`);
  }
  const plan = buildHeritableHybridLineagePlan();
  const manifest = buildHeritableHybridLineageSheetManifest({ plan, outputs: receipt.outputs });
  const sources = [];
  for (const cell of manifest.cells) {
    const path = resolve(cell.sourcePath);
    const bytes = await readFile(path);
    const sha256 = hashBytes(bytes);
    if (sha256 !== cell.sourceSha256) throw new Error(`lineage sheet source hash drift: ${cell.candidateId}`);
    sources.push({ candidateId: cell.candidateId, lineageId: cell.lineageId, generation: cell.generation, path, byteSize: bytes.length, sha256 });
  }
  const manifestPath = join(outDir, 'control-contact-sheet-manifest.json');
  const outputPath = join(outDir, 'heritable-hybrid-lineage-control-sheet.png');
  await atomicWriteJson(manifestPath, manifest);
  const assembler = join(outDir, '../lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift');
  const render = spawnSync('swift', [assembler, manifestPath, outputPath], { encoding: 'utf8' });
  if (render.status !== 0) throw new Error(`lineage contact-sheet assembly failed: ${render.stderr || render.stdout}`);
  const outputStat = await stat(outputPath);
  if (!outputStat.isFile() || outputStat.size < 100_000) throw new Error('lineage contact sheet is missing or implausibly small');
  const bytes = await readFile(outputPath);
  const sheetReceipt = {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-control-sheet-receipt.v0',
    status: 'complete-uninspected',
    requestedRoute: 'kaminos/local-swift-contact-sheet-v0',
    effectiveRoute: 'swift/AppKit',
    manifestPath: relative(outDir, manifestPath),
    contactSheet: {
      path: relative(outDir, outputPath),
      byteSize: bytes.length,
      sha256: hashBytes(bytes),
      width: manifest.width,
      height: manifest.rows * manifest.cellHeight,
    },
    sources,
    visualInspectionVerified: false,
    visualInspectionClaim: 'not-yet-inspected',
    falseClosureGuards: {
      missingGenerationAccepted: false,
      sourceHashDriftAccepted: false,
      contactSheetImpliesInheritanceSuccess: false,
    },
  };
  await atomicWriteJson(join(outDir, 'control-contact-sheet-receipt.json'), sheetReceipt);
  return sheetReceipt;
}
