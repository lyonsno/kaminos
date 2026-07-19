import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  buildArmatureProgramImagegenMatrix,
} from '../../lirm-armature-program-imagegen-core.mjs';

const STANCES = Object.freeze([
  Object.freeze({ id: 'anatomical-completion', file: 'anatomical-completion.txt' }),
  Object.freeze({ id: 'prior-led-invention', file: 'prior-led-invention.txt' }),
]);

export async function buildRareGestaltImagegenPlan({
  witnessReceipt,
  witnessRoot,
  promptRoot,
  outputRoot,
  seeds = [718301],
} = {}) {
  if (witnessReceipt?.schema !== 'kaminos.lirm-rare-gestalt-pressure-witness.v0'
      || witnessReceipt.status !== 'complete-inspected'
      || !String(witnessReceipt.visualInspectionClaim).includes('inspected')) {
    throw new Error('rare gestalt imagegen requires a visually inspected control witness');
  }
  if (!Array.isArray(witnessReceipt.candidates) || witnessReceipt.candidates.length !== 6) {
    throw new Error('rare gestalt imagegen requires all six admitted control candidates');
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
    throw new Error(`rare gestalt imagegen coverage mismatch: ${cells.length} != ${expectedCount}`);
  }
  return {
    schema: 'kaminos.lirm-rare-gestalt-imagegen-pressure-plan.v0',
    status: 'planned',
    createdAt: new Date().toISOString(),
    purpose: 'Measure whether two deliberately rare topology programs survive strict completion and prior-led invention.',
    comparisonContract: {
      kind: 'six-gestalt-two-stance-one-seed-pressure-ladder',
      candidateIds: witnessReceipt.candidates.map(candidate => candidate.id),
      stances: STANCES.map(stance => stance.id),
      seeds,
      fixedReferenceSet: 'clay-depth-normal',
      fixedModel: 'flux2-klein-9b',
      fixedSteps: 8,
      fixedGuidance: 1,
      loadBearingDiscriminator: 'The organism must preserve its authored aperture, canopy, suspended mass, or tripod support gestalt while completing enough anatomy to read as a living creature.',
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      everyConditioningInputMustMatchWitnessHash: true,
      requestedRouteMustEqualEffectiveJobType: true,
      visuallyNovelWithoutLineage: 'does_not_satisfy',
      filledApertureOrLostSuspension: 'does_not_satisfy',
    },
    cells,
  };
}
