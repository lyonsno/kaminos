import {
  buildArmatureProgramImagegenMatrix,
} from '../../lirm-armature-program-imagegen-core.mjs';

export const BRANCHING_IMAGEGEN_PRESSURE_PLAN_SCHEMA =
  'kaminos.lirm-branching-imagegen-pressure-plan.v0';

const STANCES = [
  { id: 'anatomical-completion', file: 'anatomical-completion.txt' },
  { id: 'prior-led-invention', file: 'prior-led-invention.txt' },
  { id: 'semantic-role-interpretation', file: 'semantic-role-interpretation.txt' },
];

export async function buildBranchingImagegenPressurePlan({
  candidates,
  promptRoot,
  outputRoot,
  seeds = [718201, 718202],
} = {}) {
  if (!Array.isArray(candidates) || candidates.length !== 2) {
    throw new Error('branching pressure assay requires exactly two candidate receipts');
  }
  const candidateIds = candidates.map(candidate => candidate.receipt?.candidateId);
  if (candidateIds.some(id => !id) || new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('branching pressure assay requires two unique candidate ids');
  }

  const plans = [];
  for (const candidate of candidates) {
    plans.push(await buildArmatureProgramImagegenMatrix({
      conditioningReceipt: candidate.receipt,
      conditioningRoot: candidate.conditioningRoot,
      promptRoot,
      outputRoot,
      seeds,
      stances: STANCES,
      referenceSets: [{ id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] }],
    }));
  }
  const cells = plans.flatMap(plan => plan.cells);
  const expectedCount = candidates.length * STANCES.length * seeds.length;
  if (cells.length !== expectedCount || new Set(cells.map(cell => cell.cellId)).size !== expectedCount) {
    throw new Error(`branching pressure matrix coverage mismatch: ${cells.length} != ${expectedCount}`);
  }

  return {
    schema: BRANCHING_IMAGEGEN_PRESSURE_PLAN_SCHEMA,
    status: 'planned',
    createdAt: new Date().toISOString(),
    purpose:
      'Assay whether two donor-fitted branching creature gestalts survive increasingly prior-led anatomical invention.',
    comparisonContract: {
      kind: 'two-gestalt-three-stance-two-seed-pressure-matrix',
      candidateIds,
      stances: STANCES.map(stance => stance.id),
      seeds,
      fixedReferenceSet: 'clay-depth-normal',
      fixedModel: 'flux2-klein-9b',
      fixedSteps: 8,
      fixedGuidance: 1.0,
      loadBearingDiscriminator:
        'Outputs must become coherent organisms with visible lineage to the supplied 3D gestalt; mere novelty or literal clay skinning does not satisfy.',
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      everyConditioningInputMustMatchWitnessHash: true,
      requestedRouteMustEqualEffectiveJobType: true,
      visuallyDistinctOutputWithoutLineage: 'does_not_satisfy',
      visuallyAdherentOutputWithoutOrganismLevelCompletion: 'does_not_satisfy',
    },
    cells,
  };
}

