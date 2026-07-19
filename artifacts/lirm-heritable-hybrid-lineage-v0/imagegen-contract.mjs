import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { buildArmatureProgramImagegenMatrix } from '../../lirm-armature-program-imagegen-core.mjs';

export const HERITABLE_LINEAGE_IMAGEGEN_PLAN_SCHEMA =
  'kaminos.lirm-heritable-hybrid-lineage-imagegen-plan.v0';
const WITNESS_SCHEMA = 'kaminos.lirm-heritable-hybrid-lineage-witness.v0';
const CONTROL_SHEET_SCHEMA = 'kaminos.lirm-heritable-hybrid-lineage-control-sheet-receipt.v0';
const ADJUDICATION_SCHEMA = 'kaminos.lirm-heritable-hybrid-lineage-control-adjudication.v0';
const FIXED_SEED = 718501;
const STANCE = Object.freeze({ id: 'lineage-metabolizer', file: 'lineage-metabolizer.txt' });

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

async function fileEvidence(path, label = 'evidence') {
  const absolutePath = resolve(path);
  const metadata = await stat(absolutePath);
  const bytes = await readFile(absolutePath);
  if (!metadata.isFile() || bytes.length === 0) throw new Error(`missing or empty ${label}: ${absolutePath}`);
  return {
    path: absolutePath,
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function resolveInside(root, path, label) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const localPath = relative(absoluteRoot, absolutePath);
  if (localPath.startsWith('..') || isAbsolute(localPath)) throw new Error(`${label} escapes artifact root`);
  return absolutePath;
}

export function imagegenSubmissionFingerprint(cell) {
  return fingerprint({
    cellId: cell.cellId,
    candidateId: cell.candidateId,
    lineageId: cell.lineageId,
    generation: cell.generation,
    parentId: cell.parentId,
    inheritedCommitments: cell.inheritedCommitments,
    inheritedMutations: cell.inheritedMutations,
    jobType: cell.jobType,
    requestedRoute: cell.requestedRoute,
    expectedRunner: cell.expectedRunner,
    input: cell.input,
    references: cell.references,
    prompt: cell.prompt,
    seed: cell.seed,
    outputDir: cell.outputDir,
    outputPath: cell.outputPath,
    settings: cell.settings,
  });
}

export function recoverMatchingImagegenSubmissions({ cells, priorSubmitted } = {}) {
  const currentById = new Map((cells ?? []).map(cell => [cell.cellId, cell]));
  const recovered = [];
  const staleRecoveredSubmissions = [];
  for (const prior of priorSubmitted ?? []) {
    const cell = currentById.get(prior.cellId);
    const currentFingerprint = cell ? imagegenSubmissionFingerprint(cell) : null;
    if (cell && prior.submissionFingerprint === currentFingerprint) {
      recovered.push(prior);
    } else {
      staleRecoveredSubmissions.push({
        cellId: prior.cellId,
        jobId: prior.jobId,
        storedFingerprint: prior.submissionFingerprint ?? null,
        currentFingerprint,
        reason: cell ? 'submission-fingerprint-mismatch' : 'submission-id-not-in-current-plan',
      });
    }
  }
  return { recovered, staleRecoveredSubmissions };
}

export async function buildHeritableHybridLineageImagegenPlan({
  witnessReceipt,
  witnessRoot,
  controlSheetReceipt,
  controlAdjudication,
  controlSheetRoot,
  promptRoot,
  outputRoot,
  seed = FIXED_SEED,
} = {}) {
  if (witnessReceipt?.schema !== WITNESS_SCHEMA
      || witnessReceipt.status !== 'complete-inspected'
      || witnessReceipt.visualInspectionClaim !== 'inspected') {
    throw new Error('lineage imagegen requires a visually inspected heritable witness');
  }
  if (!Array.isArray(witnessReceipt.outputs) || witnessReceipt.outputs.length !== 10) {
    throw new Error('lineage imagegen requires founder plus all nine descendants');
  }
  if (controlSheetReceipt?.schema !== CONTROL_SHEET_SCHEMA
      || controlSheetReceipt.status !== 'complete-inspected'
      || controlSheetReceipt.visualInspectionVerified !== true
      || controlSheetReceipt.visualInspectionClaim !== 'inspected') {
    throw new Error('lineage imagegen requires the inspected control sheet receipt');
  }
  if (controlAdjudication?.schema !== ADJUDICATION_SCHEMA
      || controlAdjudication.status !== 'accepted-for-imagegen-pressure'
      || controlAdjudication.visualInspectionClaim !== 'inspected') {
    throw new Error('lineage imagegen requires accepted control adjudication');
  }
  if (!controlSheetReceipt.contactSheet?.sha256
      || controlAdjudication.inspectedArtifact?.sha256 !== controlSheetReceipt.contactSheet.sha256) {
    throw new Error('adjudication control sheet hash drift');
  }
  const controlSheetPath = resolveInside(
    controlSheetRoot,
    controlSheetReceipt.contactSheet.path,
    'control sheet path',
  );
  const liveControlSheet = await fileEvidence(controlSheetPath, 'live control sheet');
  if (liveControlSheet.sha256 !== controlSheetReceipt.contactSheet.sha256) {
    throw new Error('control sheet live file hash drift');
  }

  const cells = [];
  for (const output of witnessReceipt.outputs) {
    if (!output?.id || !output.receiptPath || !Array.isArray(output.inheritedCommitments)) {
      throw new Error('lineage witness output lacks identity or inheritance evidence');
    }
    const receiptPath = resolveInside(witnessRoot, output.receiptPath, 'conditioning receipt path');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (receipt.status !== 'complete' || receipt.candidateId !== output.id) {
      throw new Error(`conditioning receipt mismatch: ${output.id}`);
    }
    const candidatePlan = await buildArmatureProgramImagegenMatrix({
      conditioningReceipt: receipt,
      conditioningRoot: dirname(receiptPath),
      promptRoot,
      outputRoot,
      seeds: [seed],
      stances: [STANCE],
      referenceSets: [{ id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] }],
    });
    if (candidatePlan.cells.length !== 1) throw new Error(`unexpected candidate cell count: ${output.id}`);
    cells.push({
      ...candidatePlan.cells[0],
      lineageId: output.lineageId,
      generation: output.generation,
      parentId: output.parentId,
      inheritedCommitments: [...output.inheritedCommitments],
      inheritedMutations: [...output.inheritedMutations],
      lineagePressure: output.lineagePressure,
      conditioningReceiptPath: receiptPath,
    });
  }
  if (new Set(cells.map(cell => cell.cellId)).size !== 10
      || new Set(cells.map(cell => cell.candidateId)).size !== 10) {
    throw new Error('lineage imagegen candidate coverage is not exactly ten unique cells');
  }
  const lineages = witnessReceipt.plan?.lineages;
  if (!Array.isArray(lineages) || lineages.length !== 3) {
    throw new Error('lineage witness lacks three-lineage graph evidence');
  }
  return {
    schema: HERITABLE_LINEAGE_IMAGEGEN_PLAN_SCHEMA,
    status: 'planned',
    createdAt: new Date().toISOString(),
    purpose: 'Test whether one fixed Flux prior can preserve shared ancestry while metabolizing three heritable morphology branches into distinct creature lineages.',
    sourceEvidence: {
      witnessSchema: witnessReceipt.schema,
      controlSheet: liveControlSheet,
      controlAdjudication: {
        schema: controlAdjudication.schema,
        inspectedArtifactSha256: controlAdjudication.inspectedArtifact.sha256,
      },
    },
    comparisonContract: {
      kind: 'founder-plus-three-three-generation-lineages-fixed-causal-firing',
      founderId: witnessReceipt.plan.founderId,
      lineageIds: lineages.map(lineage => lineage.id),
      terminalIds: lineages.map(lineage => lineage.terminalId),
      candidateIds: cells.map(cell => cell.candidateId),
      fixedPromptStance: STANCE.id,
      fixedPromptSha256: cells[0].prompt.sha256,
      fixedSeed: seed,
      fixedReferenceSet: 'clay-depth-normal',
      fixedModel: cells[0].settings.model,
      fixedSteps: cells[0].settings.steps,
      fixedGuidance: cells[0].settings.guidance,
      variedAxis: 'heritable-3d-armature-only',
      loadBearingDiscriminators: [
        'all descendants remain recognizably descended from the shared annular-canopy-tripod founder',
        'each branch preserves its cumulative inherited structures across three generations',
        'terminal descendants recruit materially different creature gestalts rather than cosmetic variants',
        'the model invents coherent connective anatomy without erasing load-bearing negative space',
      ],
    },
    evidencePredicate: {
      allTenRouteValidatedOutputsRequired: true,
      originalResolutionContactSheetInspectionRequired: true,
      ancestryRequiresCrossGenerationComparison: true,
      divergenceRequiresCrossLineageComparison: true,
      spatialInheritanceRequiresTrellisWitness: true,
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      promptVariationAccepted: false,
      seedVariationAccepted: false,
      referenceHashDriftAccepted: false,
      visuallyInterestingWithoutAncestry: 'does_not_satisfy',
      visuallyAdherentWithoutTerminalDivergence: 'does_not_satisfy',
      imagegenSheetProvesSpatialInheritance: false,
    },
    cells,
  };
}

export function buildHeritableHybridLineageImagegenSheetManifest({ plan, collection, artifactRoot } = {}) {
  if (plan?.schema !== HERITABLE_LINEAGE_IMAGEGEN_PLAN_SCHEMA || plan.status !== 'planned') {
    throw new Error(`unexpected lineage imagegen plan: ${plan?.schema}/${plan?.status}`);
  }
  if (collection?.schema !== 'kaminos.lirm-heritable-hybrid-lineage-imagegen-collection.v0'
      || !['complete-uninspected', 'complete-inspected'].includes(collection.status)) {
    throw new Error(`lineage imagegen collection is not complete: ${collection?.status}`);
  }
  if (!artifactRoot) throw new Error('lineage imagegen contact sheet requires artifactRoot');
  if (!Array.isArray(collection.accepted) || collection.accepted.length !== 10) {
    throw new Error(`lineage imagegen contact sheet requires 10 accepted outputs, got ${collection.accepted?.length ?? 0}`);
  }
  const accepted = new Map(collection.accepted.map(item => [item.cellId, item]));
  if (accepted.size !== 10) throw new Error('lineage imagegen contact sheet contains duplicate accepted cells');
  const founder = plan.cells.find(cell => cell.candidateId === plan.comparisonContract.founderId);
  if (!founder) throw new Error('lineage imagegen contact sheet lacks founder cell');
  const cells = [];
  for (const lineageId of plan.comparisonContract.lineageIds) {
    const row = [founder, ...plan.cells
      .filter(cell => cell.lineageId === lineageId)
      .sort((left, right) => left.generation - right.generation)];
    if (row.length !== 4 || row.some((cell, generation) => cell.generation !== generation)) {
      throw new Error(`lineage imagegen contact sheet requires founder plus generations 1-3: ${lineageId}`);
    }
    for (const cell of row) {
      const completion = accepted.get(cell.cellId);
      if (!completion || completion.candidateId !== cell.candidateId) {
        throw new Error(`lineage contact sheet output missing or mismatched: ${cell.cellId}`);
      }
      if (!completion.durableOutput?.path || !completion.durableOutput?.sha256
          || completion.durableOutput.sha256 !== completion.output?.sha256) {
        throw new Error(`lineage contact sheet source receipt mismatch: ${cell.cellId}`);
      }
      cells.push({
        cellId: cell.cellId,
        candidateId: cell.candidateId,
        lineageId,
        generation: cell.generation,
        parentId: cell.parentId,
        sourcePath: resolve(artifactRoot, completion.durableOutput.path),
        sourceSha256: completion.durableOutput.sha256,
        title: cell.generation === 0 ? 'SHARED FOUNDER' : `${lineageId} / G${cell.generation}`,
        viewLabel: cell.generation === 0 ? `ancestor repeated for ${lineageId}` : `inherited generation ${cell.generation}`,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-heritable-hybrid-lineage-imagegen-contact-sheet-manifest.v0',
    columns: 4,
    rows: 3,
    width: 1536,
    cellWidth: 384,
    cellHeight: 422,
    imageHeight: 384,
    imageOffsetY: 0,
    cells,
  };
}
