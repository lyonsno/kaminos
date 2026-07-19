import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  GESTALT_TRELLIS_JOB_TYPE,
  GESTALT_TRELLIS_RUNNER,
  GESTALT_WITNESS_JOB_TYPE,
  GESTALT_WITNESS_RUNNER,
} from '../../../lirm-speciation-gestalt-imagegen-core.mjs';

export const BRANCHING_TRELLIS_PROMOTION_PLAN_SCHEMA = 'kaminos.lirm-branching-trellis-promotion-plan.v0';

const SETTINGS = Object.freeze({
  seed: 42,
  resolution: 512,
  steps: 6,
  cascade: false,
  targetFaces: 200000,
  textureSize: 1024,
  simplifyFirst: true,
});

const WITNESS_VIEWS = Object.freeze([
  { view: 'left', yaw: -0.85, pitch: 0.2 },
  { view: 'front', yaw: 0, pitch: 0.2 },
  { view: 'right', yaw: 0.85, pitch: 0.2 },
  { view: 'opposite', yaw: 3.141593, pitch: 0.2 },
]);

async function fileEvidence(path) {
  const bytes = await readFile(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || bytes.length === 0) throw new Error(`missing or empty durable imagegen output: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function buildBranchingTrellisPromotionPlan({
  imagegenPlan,
  imagegenCompletion,
  adjudication,
  durableImageRoot,
  outputRoot,
}) {
  if (imagegenPlan?.schema !== 'kaminos.lirm-branching-imagegen-pressure-plan.v0'
    || imagegenPlan.status !== 'planned') {
    throw new Error(`unexpected imagegen plan: ${imagegenPlan?.schema}/${imagegenPlan?.status}`);
  }
  if (imagegenCompletion?.schema !== 'kaminos.lirm-branching-imagegen-pressure-collection.v0'
    || imagegenCompletion.status !== 'complete') {
    throw new Error('imagegen collection is not complete');
  }
  if (adjudication?.schema !== 'kaminos.lirm-branching-imagegen-pressure-assay.v0'
    || adjudication.status !== 'visually-inspected-promotion-selected'
    || adjudication.visualInspection?.inspectedAtOriginalResolution !== true) {
    throw new Error('Trellis promotion requires a visually inspected adjudication');
  }
  const evidenceRoles = adjudication.trellisPromotion?.evidenceRoles;
  if (adjudication.trellisPromotion?.status !== 'selected'
    || !Array.isArray(evidenceRoles) || evidenceRoles.length === 0) {
    throw new Error('Trellis promotion requires selected evidence roles');
  }
  const cellIds = evidenceRoles.map(item => item.cellId);
  const roles = evidenceRoles.map(item => item.role);
  if (new Set(cellIds).size !== cellIds.length) throw new Error('duplicate promoted cell id');
  if (new Set(roles).size !== roles.length) throw new Error('duplicate promotion evidence role');
  if (evidenceRoles.some(item => typeof item.cellId !== 'string' || typeof item.role !== 'string')) {
    throw new Error('promotion evidence roles require string cellId and role');
  }

  const planned = new Map(imagegenPlan.cells.map(cell => [cell.cellId, cell]));
  const accepted = new Map(imagegenCompletion.accepted.map(entry => [entry.cellId, entry]));
  const cells = [];
  for (const selection of evidenceRoles) {
    const source = planned.get(selection.cellId);
    const completion = accepted.get(selection.cellId);
    if (!source || !completion) throw new Error(`promoted cell is not accepted: ${selection.cellId}`);
    const durablePath = resolve(durableImageRoot, `${selection.cellId}.png`);
    const input = await fileEvidence(durablePath);
    if (input.sha256 !== completion.output?.sha256) {
      throw new Error(`durable imagegen output hash drift: ${selection.cellId}`);
    }
    const outputDir = resolve(outputRoot, selection.cellId);
    cells.push({
      cellId: selection.cellId,
      evidenceRole: selection.role,
      jobType: GESTALT_TRELLIS_JOB_TYPE,
      requestedRoute: `gpu-greenroom/${GESTALT_TRELLIS_JOB_TYPE}`,
      expectedRunner: GESTALT_TRELLIS_RUNNER,
      candidateId: source.candidateId,
      generationId: source.candidateId,
      sourceBasinIndex: null,
      stance: source.stance,
      imagegenSeed: source.seed,
      referenceSet: source.referenceSet,
      dualLineage: {
        proceduralArmature: source.candidateId,
        imagegenPressure: source.stance,
      },
      input,
      outputDir,
      outputPath: resolve(outputDir, 'output.glb'),
      settings: { ...SETTINGS },
    });
  }

  return {
    schema: BRANCHING_TRELLIS_PROMOTION_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: {
      kind: 'inspected-evidence-role-promotion',
      evidenceRoles: evidenceRoles.map(item => ({ ...item })),
      fixedSettings: { ...SETTINGS },
    },
    evidencePredicate: {
      directInferenceForbidden: true,
      routeFallbackAllowed: false,
      missingGlbCountsAsSuccess: false,
      sourceHashDriftAllowed: false,
      spatialCoherenceRequiresRenderedWitness: true,
      visuallyNovelWithoutLineage: 'does_not_satisfy',
    },
    cells,
  };
}

export async function buildBranchingTrellisWitnessPlan({
  trellisPlan,
  trellisCompletion,
  witnessScript,
  outputRoot,
}) {
  if (trellisPlan?.schema !== BRANCHING_TRELLIS_PROMOTION_PLAN_SCHEMA || trellisPlan.status !== 'planned') {
    throw new Error(`unexpected Trellis promotion plan: ${trellisPlan?.schema}/${trellisPlan?.status}`);
  }
  if (trellisCompletion?.schema !== 'kaminos.lirm-branching-trellis-collection.v0'
    || trellisCompletion.status !== 'complete-glbs-unwitnessed') {
    throw new Error(`Trellis completion is not witnessable: ${trellisCompletion?.status}`);
  }
  const accepted = new Map(trellisCompletion.accepted.map(item => [item.cellId, item]));
  if (accepted.size !== trellisPlan.cells.length) throw new Error('accepted GLB count does not match plan');
  const script = await fileEvidence(witnessScript);
  const cells = [];
  for (const source of trellisPlan.cells) {
    const completion = accepted.get(source.cellId);
    if (!completion) throw new Error(`missing accepted GLB: ${source.cellId}`);
    const input = await fileEvidence(completion.output.path);
    if (input.sha256 !== completion.output.sha256) throw new Error(`durable GLB hash drift: ${source.cellId}`);
    if (completion.evidenceRole !== source.evidenceRole) throw new Error(`evidence role drift: ${source.cellId}`);
    for (const witnessView of WITNESS_VIEWS) {
      const outputDir = resolve(outputRoot, source.cellId, witnessView.view);
      cells.push({
        witnessId: `${source.cellId}-${witnessView.view}`,
        cellId: source.cellId,
        evidenceRole: source.evidenceRole,
        candidateId: source.candidateId,
        stance: source.stance,
        imagegenSeed: source.imagegenSeed,
        jobType: GESTALT_WITNESS_JOB_TYPE,
        expectedRunner: GESTALT_WITNESS_RUNNER,
        requestedRoute: `gpu-greenroom/${GESTALT_WITNESS_JOB_TYPE}`,
        input,
        witnessScript: script,
        outputDir,
        outputPath: resolve(outputDir, 'render.png'),
        ...witnessView,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-branching-trellis-witness-plan.v0',
    status: 'planned',
    requiredViews: WITNESS_VIEWS.map(item => ({ ...item })),
    evidencePredicate: {
      expectedWitnessCount: trellisPlan.cells.length * WITNESS_VIEWS.length,
      blankOrMissingFrameCountsAsSuccess: false,
      routeFallbackAllowed: false,
      spatialClaimRequiresHumanVisualInspection: true,
    },
    cells,
  };
}
