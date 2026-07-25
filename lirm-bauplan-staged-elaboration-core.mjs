import {
  createLirmSpeciationArmatureWitness,
} from './lirm-speciation-armature-core.js';

export const LIRM_BAUPLAN_STAGED_ELABORATION_SCHEMA =
  'kaminos.lirm-bauplan-staged-elaboration-plan.v0';
export const LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE =
  'lirm-armature-03-bauplan';
export const LIRM_BAUPLAN_STAGED_ELABORATION_SEED =
  'molten-lirm-seed-0707';
export const LIRM_BAUPLAN_MASS_AUTHORITY_SCHEMA =
  'kaminos.lirm-bauplan-mass-authority.v0';
export const LIRM_BAUPLAN_MASS_AUTHORITY_LOOP_ONE_SCHEMA =
  'kaminos.lirm-bauplan-mass-authority-loop-one.v0';
export const LIRM_BAUPLAN_MASS_AUTHORITY_LOOP_ONE_PROMPT =
  'Transform these exact clay, depth, and normal controls into one coherent friendly small crawling trilobite-flatback creature. Preserve the supplied silhouette, connected body volume, front-to-back orientation, terrain-facing supports, terminal head, and body-attached structures. Complete underspecified anatomy using one plausible organismal body plan with continuous closed-surface anatomy at every attachment. Retain a flat armored-back character and broad side-plate suggestion. Matte pale green skin and warm cream keratin details, restrained cute creature design, three-quarter studio render, isolated on a plain dark background, readable silhouette, sculptural volume.';

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

function rounded(value) {
  return Number(value.toFixed(3));
}

function scaled(value, multiplier, maximum = Infinity) {
  return rounded(Math.min(maximum, value * multiplier));
}

function createHeavyBauplanVariant(parent) {
  const candidate = structuredClone(parent.candidate);
  candidate.id = 'bauplan-heavy';
  candidate.label = `${parent.candidate.label} / heavy bauplan`;
  candidate.seed = `${parent.candidate.seed}:low-frequency-heavy-v0`;

  const bodyPlan = candidate.bodyPlan;
  const parentBodyPlan = parent.candidate.bodyPlan;
  bodyPlan.silhouette = {
    ...bodyPlan.silhouette,
    bellyScale: scaled(parentBodyPlan.silhouette.bellyScale, 1.18, 2.1),
    widthScale: scaled(parentBodyPlan.silhouette.widthScale, 1.06, 1.9),
    heightScale: scaled(parentBodyPlan.silhouette.heightScale, 1.12, 1.15),
  };
  bodyPlan.bulkScale = scaled(parentBodyPlan.bulkScale, 1.08, 1.55);
  bodyPlan.contactWidth = scaled(parentBodyPlan.contactWidth, 1.03, 0.97);
  bodyPlan.massDistribution = {
    ...bodyPlan.massDistribution,
    bellyDrop: rounded(Math.min(0.92, parentBodyPlan.massDistribution.bellyDrop + 0.12)),
  };

  const gestaltHandle = candidate.semanticHandles.find(
    handle => handle.kind === 'gestalt_silhouette',
  );
  if (!gestaltHandle) throw new Error('heavy bauplan mutation requires a gestalt-silhouette handle');
  Object.assign(gestaltHandle.region, {
    bellyScale: bodyPlan.silhouette.bellyScale,
    widthScale: bodyPlan.silhouette.widthScale,
    heightScale: bodyPlan.silhouette.heightScale,
  });

  const bellyContact = candidate.semanticHandles.find(handle => handle.kind === 'belly_contact');
  if (!bellyContact) throw new Error('heavy bauplan mutation requires a belly-contact handle');
  bellyContact.strength = bodyPlan.contactWidth;
  bellyContact.region.width = bodyPlan.contactWidth;
  bellyContact.region.height = rounded(
    0.055 + bodyPlan.massDistribution.bellyDrop * 0.06,
  );

  candidate.contactPoints = candidate.contactPoints.map(point => ({
    ...point,
    radius: scaled(point.radius, 1.12, 0.06),
  }));
  candidate.semanticHandles.push({
    id: `${candidate.id}:mass-authority`,
    kind: 'low_frequency_mass',
    label: 'authored torso mass / belly depth',
    strength: bodyPlan.silhouette.bellyScale,
    region: {
      tMin: 0.18,
      tMax: 0.82,
      bellyScale: bodyPlan.silhouette.bellyScale,
      widthScale: bodyPlan.silhouette.widthScale,
      heightScale: bodyPlan.silhouette.heightScale,
      bulkScale: bodyPlan.bulkScale,
      bellyDrop: bodyPlan.massDistribution.bellyDrop,
      contactWidth: bodyPlan.contactWidth,
    },
    futureUse: ['morphology_authoring', 'image_completion_conditioning', 'motion_fit_prior'],
  });

  return {
    id: candidate.id,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    parentId: parent.id,
    generation: parent.generation + 1,
    stageKind: 'low-frequency-morphology',
    developmentalModules: [...parent.developmentalModules],
    bauplanContract: BAUPLAN_CONTRACT,
    candidate,
  };
}

function createLoopOneAssayContract(parent, heavy) {
  return {
    schema: LIRM_BAUPLAN_MASS_AUTHORITY_LOOP_ONE_SCHEMA,
    candidateIds: [parent.id, heavy.id],
    developmentalModules: [],
    explicitShellGeometry: 'absent',
    retainedArmorPriorHooks: [...parent.candidate.bodyPlan.gestalt.priorHooks],
    controlProjection: {
      requestedRoute: 'lirm-speciation-armature-implicit-body-witness-v1',
      sourceMaps: ['clay', 'depth', 'normal'],
      camera: 'shared-implicit-body-camera',
      crop: 'tight-surface-bounds',
    },
    imagegen: {
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
      jobType: 'mflux_flux2_edit_promptfile_3ref',
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seed: 720501,
      prompt: LIRM_BAUPLAN_MASS_AUTHORITY_LOOP_ONE_PROMPT,
    },
    trellis: {
      requestedRoute: 'gpu-greenroom/trellis2mlx_fast',
      jobType: 'trellis2mlx_fast',
      seed: 720501,
      resolution: 512,
      steps: 6,
      cascade: false,
      simplifyFirst: true,
      targetFaces: 200000,
      textureSize: 1024,
    },
    generatedSupportClaim: 'inadmissible',
    blindClassification: {
      owner: 'blind-independent-classifier',
      cellLabels: ['cell-a', 'cell-b'],
      mappingPublication: 'withheld_until_blind_classification',
      firstClassifier: 'blind-independent-classifier',
    },
    visualAdmission: {
      researchVisibility: 'agent_only',
      operatorExposure: 'prohibited_pending_independent_safe_and_happy',
      staticGates: ['safe', 'happy'],
      motionSafe: 'unassayed',
    },
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
  const heavy = createHeavyBauplanVariant(bauplan);
  return {
    schema: LIRM_BAUPLAN_STAGED_ELABORATION_SCHEMA,
    lineageId: LIRM_BAUPLAN_STAGED_ELABORATION_LINEAGE,
    sourceCandidateId: SOURCE_CANDIDATE_ID,
    sourceSeed: LIRM_BAUPLAN_STAGED_ELABORATION_SEED,
    sourceWitness,
    stages: [bauplan, armored, tactile],
    massAuthority: {
      schema: LIRM_BAUPLAN_MASS_AUTHORITY_SCHEMA,
      authority: 'deterministic-low-frequency-bauplan-mutation',
      parentStageId: heavy.parentId,
      variant: heavy,
      changed: {
        'bodyPlan.silhouette.bellyScale': {
          from: armored.candidate.bodyPlan.silhouette.bellyScale,
          to: heavy.candidate.bodyPlan.silhouette.bellyScale,
        },
        'bodyPlan.silhouette.widthScale': {
          from: armored.candidate.bodyPlan.silhouette.widthScale,
          to: heavy.candidate.bodyPlan.silhouette.widthScale,
        },
        'bodyPlan.silhouette.heightScale': {
          from: armored.candidate.bodyPlan.silhouette.heightScale,
          to: heavy.candidate.bodyPlan.silhouette.heightScale,
        },
        'bodyPlan.bulkScale': {
          from: armored.candidate.bodyPlan.bulkScale,
          to: heavy.candidate.bodyPlan.bulkScale,
        },
        'bodyPlan.massDistribution.bellyDrop': {
          from: armored.candidate.bodyPlan.massDistribution.bellyDrop,
          to: heavy.candidate.bodyPlan.massDistribution.bellyDrop,
        },
        'bodyPlan.contactWidth': {
          from: armored.candidate.bodyPlan.contactWidth,
          to: heavy.candidate.bodyPlan.contactWidth,
        },
      },
      preserved: [
        'axialCurve',
        'axisSamples',
        'head-and-mouth-polarity',
        'limb-topology',
        'developmental-module-absence',
        'explicit-shell-geometry-absence',
        'armor-bearing-prior-hooks',
        'contact-identities-and-axial-roles',
        'motion-affordance-class',
      ],
      assayContract: createLoopOneAssayContract(bauplan, heavy),
    },
    evidencePredicate: {
      fixedPromptSeedRouteCamera: true,
      compareDevelopmentalHierarchyBeforeSpatialGeneration: true,
      trellisClaim: 'forbidden_until_still_image_inspection',
    },
  };
}
