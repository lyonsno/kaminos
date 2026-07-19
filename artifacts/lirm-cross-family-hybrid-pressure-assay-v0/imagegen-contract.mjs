import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  buildArmatureProgramImagegenMatrix,
} from '../../lirm-armature-program-imagegen-core.mjs';

const STANCES = Object.freeze([
  Object.freeze({ id: 'anatomical-completion', file: 'anatomical-completion.txt' }),
  Object.freeze({ id: 'prior-led-invention', file: 'prior-led-invention.txt' }),
]);

export async function buildCrossFamilyHybridImagegenPlan({
  witnessReceipt,
  witnessRoot,
  promptRoot,
  outputRoot,
  seeds = [718401],
} = {}) {
  if (witnessReceipt?.schema !== 'kaminos.lirm-cross-family-hybrid-pressure-witness.v0'
      || witnessReceipt.status !== 'complete-inspected'
      || witnessReceipt.visualInspectionClaim !== 'inspected') {
    throw new Error('cross-family imagegen requires a visually inspected hybrid witness');
  }
  if (!Array.isArray(witnessReceipt.candidates) || witnessReceipt.candidates.length !== 3) {
    throw new Error('cross-family imagegen requires all three hybrid controls');
  }
  const plans = [];
  for (const candidate of witnessReceipt.candidates) {
    const receiptPath = join(witnessRoot, candidate.receiptPath);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (receipt.status !== 'complete' || receipt.candidateId !== candidate.id) {
      throw new Error(`conditioning receipt mismatch: ${candidate.id}`);
    }
    plans.push(await buildArmatureProgramImagegenMatrix({
      conditioningReceipt: receipt,
      conditioningRoot: dirname(receiptPath),
      promptRoot,
      outputRoot,
      seeds,
      stances: STANCES,
      referenceSets: [{ id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] }],
    }));
  }
  const cells = plans.flatMap(plan => plan.cells);
  const expectedCount = witnessReceipt.candidates.length * STANCES.length * seeds.length;
  if (cells.length !== expectedCount || new Set(cells.map(cell => cell.cellId)).size !== expectedCount) {
    throw new Error(`cross-family imagegen coverage mismatch: ${cells.length} != ${expectedCount}`);
  }
  return {
    schema: 'kaminos.lirm-cross-family-hybrid-imagegen-pressure-plan.v0',
    status: 'planned',
    createdAt: new Date().toISOString(),
    purpose: 'Test whether Flux can elaborate a composed annulus-canopy-tripod-pendant topology without reverting to either parent family.',
    comparisonContract: {
      kind: 'three-hybrid-two-stance-one-seed-pressure-ladder',
      candidateIds: witnessReceipt.candidates.map(candidate => candidate.id),
      stances: STANCES.map(stance => stance.id),
      seeds,
      fixedReferenceSet: 'clay-depth-normal',
      fixedModel: 'flux2-klein-9b',
      fixedSteps: 8,
      fixedGuidance: 1,
      minimumSurvivingCommitments: 2,
      loadBearingCommitments: [...witnessReceipt.comparisonContract.requiredCommitments],
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      everyConditioningInputMustMatchWitnessHash: true,
      requestedRouteMustEqualEffectiveJobType: true,
      parentReversionCountsAsSuccess: false,
      singleCommitmentSurvivalCountsAsSuccess: false,
      visuallyNovelWithoutComposedTopology: 'does_not_satisfy',
    },
    cells,
  };
}
