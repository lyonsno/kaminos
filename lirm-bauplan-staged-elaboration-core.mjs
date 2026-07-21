import {
  createLirmSpeciationArmatureWitness,
} from './lirm-speciation-armature-core.js';

export const LIRM_BAUPLAN_STAGED_ELABORATION_SCHEMA =
  'kaminos.lirm-bauplan-staged-elaboration-plan.v0';
export const LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE =
  'lirm-armature-03-bauplan';
export const LIRM_BAUPLAN_STAGED_ELABORATION_SEED =
  'molten-lirm-seed-0707';

const SOURCE_CANDIDATE_ID = 'lirm-armature-03';
const BAUPLAN_CONTRACT = Object.freeze({
  enclosure: 'single-connected-body',
  polarity: 'terminal-head-and-mouth',
  contactTopology: 'seven-axial-supports',
});

function cloneCandidate(source, id) {
  const candidate = structuredClone(source);
  candidate.id = id;
  candidate.seed = `${source.seed}:${id}`;
  candidate.semanticHandles = candidate.semanticHandles.filter(handle => handle.kind !== 'sensory_nub');
  return candidate;
}

function createBauplanStage(source) {
  const candidate = cloneCandidate(source, 'bauplan-only');
  candidate.bodyPlan.shellPlateCount = 0;
  candidate.bodyPlan.armorPressure = 0;
  candidate.semanticHandles = candidate.semanticHandles.filter(handle => handle.kind !== 'shell_plate');
  return {
    id: candidate.id,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    parentId: null,
    generation: 0,
    stageKind: 'bauplan',
    developmentalModules: [],
    bauplanContract: BAUPLAN_CONTRACT,
    candidate,
  };
}

function createArmoredStage(source, parentId) {
  const candidate = cloneCandidate(source, 'bauplan-plus-dorsal-plates');
  return {
    id: candidate.id,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    parentId,
    generation: 1,
    stageKind: 'developmental-module',
    developmentalModules: ['dorsal-plate-series'],
    bauplanContract: BAUPLAN_CONTRACT,
    candidate,
  };
}

function tactileForkHandle(id, side) {
  const isLeft = side === 'left';
  return {
    id: `bauplan-plus-dorsal-plates-and-tactile-fork:${id}`,
    kind: 'limb_bud',
    label: `anterior tactile fork ${side}`,
    strength: 0.82,
    region: {
      x: isLeft ? 0.89 : 0.97,
      y: isLeft ? 0.37 : 0.42,
      t: isLeft ? 0.9 : 0.98,
      side,
      length: 0.3,
      attachment: 'anterior-head-collar',
    },
    futureUse: ['terrain_probe', 'near-field_sensing', 'social_contact'],
  };
}

function createTactileStage(source, parentId) {
  const candidate = cloneCandidate(source, 'bauplan-plus-dorsal-plates-and-tactile-fork');
  candidate.semanticHandles.push(
    tactileForkHandle('tactile-fork-left', 'left'),
    tactileForkHandle('tactile-fork-right', 'right'),
  );
  return {
    id: candidate.id,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    parentId,
    generation: 2,
    stageKind: 'anatomical-elaboration',
    developmentalModules: ['dorsal-plate-series', 'paired-anterior-tactile-fork'],
    bauplanContract: BAUPLAN_CONTRACT,
    candidate,
  };
}

export function buildLirmBauplanStagedElaborationPlan() {
  const sourceWitness = createLirmSpeciationArmatureWitness({
    seed: LIRM_BAUPLAN_STAGED_ELABORATION_SEED,
    candidateCount: 25,
  });
  const source = sourceWitness.candidates.find(candidate => candidate.id === SOURCE_CANDIDATE_ID);
  if (!source) throw new Error(`source candidate missing: ${SOURCE_CANDIDATE_ID}`);
  const bauplan = createBauplanStage(source);
  const armored = createArmoredStage(source, bauplan.id);
  const tactile = createTactileStage(source, armored.id);
  return {
    schema: LIRM_BAUPLAN_STAGED_ELABORATION_SCHEMA,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    sourceCandidateId: SOURCE_CANDIDATE_ID,
    sourceSeed: LIRM_BAUPLAN_STAGED_ELABORATION_SEED,
    sourceWitness,
    stages: [bauplan, armored, tactile],
    evidencePredicate: {
      fixedPromptSeedRouteCamera: true,
      compareDevelopmentalHierarchyBeforeSpatialGeneration: true,
      trellisClaim: 'forbidden_until_still_image_inspection',
    },
  };
}
