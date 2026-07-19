import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  GESTALT_IMAGEGEN_JOB_TYPE,
  GESTALT_IMAGEGEN_JOB_TYPE_2REF,
  GESTALT_IMAGEGEN_JOB_TYPE_3REF,
  GESTALT_IMAGEGEN_RUNNER,
  GESTALT_TRELLIS_JOB_TYPE,
  GESTALT_TRELLIS_PLAN_SCHEMA,
  GESTALT_TRELLIS_RUNNER,
} from './lirm-speciation-gestalt-imagegen-core.mjs';

export const ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA = 'kaminos.lirm-armature-program-imagegen-plan.v0';
export const ARMATURE_GESTALT_FAMILY_IMAGEGEN_PLAN_SCHEMA =
  'kaminos.lirm-armature-gestalt-family-imagegen-plan.v0';

const EXPECTED_CONDITIONING_SCHEMA = 'kaminos.lirm-armature-program-implicit-body-witness.v0';
const EXPECTED_CONDITIONING_ROUTE = 'kaminos/lirm-armature-program/implicit-body-v0';
const JOB_TYPE_BY_REFERENCE_COUNT = new Map([
  [1, GESTALT_IMAGEGEN_JOB_TYPE],
  [2, GESTALT_IMAGEGEN_JOB_TYPE_2REF],
  [3, GESTALT_IMAGEGEN_JOB_TYPE_3REF],
]);

async function fileEvidence(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty evidence file: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function assertConditioningReceipt(receipt) {
  if (receipt?.schema !== EXPECTED_CONDITIONING_SCHEMA) {
    throw new Error(`unexpected conditioning witness schema: ${receipt?.schema ?? 'missing'}`);
  }
  if (receipt.status !== 'complete') throw new Error(`conditioning witness is not complete: ${receipt.status}`);
  if (receipt.effectiveRoute !== EXPECTED_CONDITIONING_ROUTE) {
    throw new Error(`conditioning witness route mismatch: ${receipt.effectiveRoute ?? 'missing'}`);
  }
  if (!receipt.armatureProgram?.id || !receipt.armatureProgram?.parameterVocabulary) {
    throw new Error('conditioning witness lacks armature program identity');
  }
  if (!receipt.parameters || typeof receipt.parameters !== 'object' || Array.isArray(receipt.parameters)) {
    throw new Error('conditioning witness lacks fitted parameters');
  }
  if (!Array.isArray(receipt.outputInventory?.maps) || !Array.isArray(receipt.outputEvidence)) {
    throw new Error('conditioning witness lacks map inventory or output evidence');
  }
}

async function loadConditioningMaps(receipt, conditioningRoot) {
  const evidenceByPath = new Map(receipt.outputEvidence.map(entry => [entry.path, entry]));
  if (evidenceByPath.size !== receipt.outputEvidence.length) {
    throw new Error('conditioning witness contains duplicate evidence paths');
  }
  const maps = new Map();
  for (const map of receipt.outputInventory.maps) {
    if (!map?.kind || !map?.rasterPath) throw new Error('conditioning map requires kind and raster path');
    if (maps.has(map.kind)) throw new Error(`duplicate conditioning map kind: ${map.kind}`);
    const expected = evidenceByPath.get(map.rasterPath);
    if (!expected) throw new Error(`conditioning map lacks byte evidence: ${map.kind}`);
    const observed = await fileEvidence(resolve(conditioningRoot, map.rasterPath));
    if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize <= 0) {
      throw new Error(`conditioning map lacks valid byte size evidence: ${map.kind}`);
    }
    if (observed.bytes !== expected.byteSize) throw new Error(`conditioning evidence byte mismatch (${map.kind})`);
    if (observed.sha256 !== expected.sha256) throw new Error(`conditioning evidence hash mismatch (${map.kind})`);
    maps.set(map.kind, { ...observed, role: map.kind, sourceRelativePath: map.rasterPath });
  }
  return maps;
}

function validateSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) throw new Error('imagegen matrix requires seeds');
  const seen = new Set();
  for (const seed of seeds) {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`invalid imagegen seed: ${seed}`);
    if (seen.has(seed)) throw new Error(`duplicate imagegen seed: ${seed}`);
    seen.add(seed);
  }
}

function validateReferenceSets(referenceSets, availableMaps) {
  if (!Array.isArray(referenceSets) || referenceSets.length === 0) throw new Error('imagegen matrix requires reference sets');
  const seen = new Set();
  for (const set of referenceSets) {
    if (!set?.id || seen.has(set.id)) throw new Error(`invalid or duplicate reference set: ${set?.id ?? 'missing'}`);
    seen.add(set.id);
    if (!Array.isArray(set.roles) || set.roles[0] !== 'clay') throw new Error('reference set must begin with clay');
    if (!JOB_TYPE_BY_REFERENCE_COUNT.has(set.roles.length)) {
      throw new Error(`reference set has unsupported cardinality: ${set.roles.length}`);
    }
    if (new Set(set.roles).size !== set.roles.length) throw new Error(`reference set repeats a role: ${set.id}`);
    for (const role of set.roles) {
      if (!availableMaps.has(role)) throw new Error(`reference set requests missing conditioning role: ${role}`);
    }
  }
}

export async function buildArmatureProgramImagegenMatrix({
  conditioningReceipt,
  conditioningRoot,
  promptRoot,
  outputRoot,
  seeds = [718021, 718113],
  stances = [
    { id: 'controlled-organism', file: 'controlled-organism.txt' },
    { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  ],
  referenceSets = [
    { id: 'clay-only', roles: ['clay'] },
    { id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] },
  ],
} = {}) {
  assertConditioningReceipt(conditioningReceipt);
  if (!conditioningRoot || !promptRoot || !outputRoot) throw new Error('conditioningRoot, promptRoot, and outputRoot are required');
  validateSeeds(seeds);
  const maps = await loadConditioningMaps(conditioningReceipt, conditioningRoot);
  validateReferenceSets(referenceSets, maps);
  if (!Array.isArray(stances) || stances.length === 0) throw new Error('imagegen matrix requires prompt stances');
  const stanceIds = new Set();
  const prompts = new Map();
  for (const stance of stances) {
    if (!stance?.id || !stance?.file || stanceIds.has(stance.id)) {
      throw new Error(`invalid or duplicate prompt stance: ${stance?.id ?? 'missing'}`);
    }
    stanceIds.add(stance.id);
    prompts.set(stance.id, await fileEvidence(resolve(promptRoot, stance.file)));
  }

  const cells = [];
  for (const referenceSet of referenceSets) {
    const [primaryRole, ...secondaryRoles] = referenceSet.roles;
    for (const stance of stances) {
      for (const seed of seeds) {
        const cellId = `${conditioningReceipt.candidateId}-${referenceSet.id}-${stance.id}-seed${seed}`;
        const cellOutputDir = resolve(outputRoot, 'cells', cellId);
        cells.push({
          cellId,
          jobType: JOB_TYPE_BY_REFERENCE_COUNT.get(referenceSet.roles.length),
          requestedRoute: `gpu-greenroom/${JOB_TYPE_BY_REFERENCE_COUNT.get(referenceSet.roles.length)}`,
          expectedRunner: GESTALT_IMAGEGEN_RUNNER,
          candidateId: conditioningReceipt.candidateId,
          armatureProgram: conditioningReceipt.armatureProgram,
          parameters: conditioningReceipt.parameters,
          conditioningRoute: conditioningReceipt.effectiveRoute,
          conditioningConfig: conditioningReceipt.effectiveConfig,
          referenceSet: referenceSet.id,
          stance: stance.id,
          seed,
          input: maps.get(primaryRole),
          references: secondaryRoles.map(role => maps.get(role)),
          prompt: prompts.get(stance.id),
          outputDir: cellOutputDir,
          outputPath: resolve(cellOutputDir, 'output.png'),
          settings: {
            model: 'flux2-klein-9b',
            quantize: 4,
            width: 512,
            height: 512,
            steps: 8,
            guidance: 1.0,
            mlxCacheLimitGb: 48,
          },
        });
      }
    }
  }

  return {
    schema: ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA,
    createdAt: new Date().toISOString(),
    purpose: 'Measure topology adherence and model-prior completion from one fitted 3D creature armature.',
    requestedConditioningRoute: EXPECTED_CONDITIONING_ROUTE,
    expectedRunner: GESTALT_IMAGEGEN_RUNNER,
    armatureProgram: conditioningReceipt.armatureProgram,
    parameters: conditioningReceipt.parameters,
    comparisonContract: {
      fixedCandidate: conditioningReceipt.candidateId,
      fixedModel: 'flux2-klein-9b',
      fixedSteps: 8,
      fixedGuidance: 1.0,
      variedReferenceSets: referenceSets.map(set => set.id),
      variedPromptStances: stances.map(stance => stance.id),
      variedSeeds: seeds,
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      requestedRouteMustEqualEffectiveJobType: true,
      effectiveRunnerMustMatch: GESTALT_IMAGEGEN_RUNNER,
      everyConditioningInputMustMatchWitnessHash: true,
    },
    cells,
  };
}

function assertFamilyReceipt(familyReceipt) {
  if (familyReceipt?.schema !== 'kaminos.lirm-armature-gestalt-family-witness.v0') {
    throw new Error(`unexpected armature family witness schema: ${familyReceipt?.schema ?? 'missing'}`);
  }
  if (familyReceipt.status !== 'complete') {
    throw new Error(`armature family witness is not complete: ${familyReceipt.status ?? 'missing'}`);
  }
  if (!Array.isArray(familyReceipt.candidates) || familyReceipt.candidates.length === 0) {
    throw new Error('armature family witness has no candidates');
  }
  const ids = new Set();
  for (const candidate of familyReceipt.candidates) {
    if (!candidate?.id || ids.has(candidate.id)) {
      throw new Error(`duplicate family candidate id: ${candidate?.id ?? 'missing'}`);
    }
    ids.add(candidate.id);
    if (!candidate.receiptPath || candidate.receiptEvidence?.path !== candidate.receiptPath) {
      throw new Error(`family candidate receipt evidence mismatch: ${candidate.id}`);
    }
  }
  if (JSON.stringify(familyReceipt.requestedCandidateIds) !== JSON.stringify([...ids])) {
    throw new Error('family candidate coverage differs from requested candidate ids');
  }
}

async function loadFamilyCandidateReceipt(candidate, conditioningRoot) {
  const absolutePath = resolve(conditioningRoot, candidate.receiptPath);
  const evidence = await fileEvidence(absolutePath);
  if (evidence.bytes !== candidate.receiptEvidence.byteSize
      || evidence.sha256 !== candidate.receiptEvidence.sha256) {
    throw new Error(`family candidate receipt hash mismatch: ${candidate.id}`);
  }
  const receipt = JSON.parse(await readFile(absolutePath, 'utf8'));
  if (receipt.candidateId !== candidate.id) {
    throw new Error(`family candidate receipt identity mismatch: ${candidate.id}`);
  }
  return { receipt, receiptRoot: dirname(absolutePath), evidence };
}

export async function buildArmatureGestaltFamilyImagegenMatrix({
  familyReceipt,
  conditioningRoot,
  promptRoot,
  outputRoot,
  seeds = [718021, 718113],
  stance = { id: 'world-creature-invention', file: 'world-creature-invention.txt' },
  referenceSets = [
    { id: 'clay-only', roles: ['clay'] },
    { id: 'clay-depth-normal', roles: ['clay', 'depth', 'normal'] },
  ],
} = {}) {
  assertFamilyReceipt(familyReceipt);
  if (!conditioningRoot || !promptRoot || !outputRoot) {
    throw new Error('conditioningRoot, promptRoot, and outputRoot are required');
  }
  if (!stance?.id || !stance?.file) throw new Error('family imagegen matrix requires one fixed prompt stance');

  const candidatePlans = [];
  const receiptEvidence = [];
  for (const candidate of familyReceipt.candidates) {
    const loaded = await loadFamilyCandidateReceipt(candidate, conditioningRoot);
    candidatePlans.push(await buildArmatureProgramImagegenMatrix({
      conditioningReceipt: loaded.receipt,
      conditioningRoot: loaded.receiptRoot,
      promptRoot,
      outputRoot,
      seeds,
      stances: [stance],
      referenceSets,
    }));
    receiptEvidence.push({ candidateId: candidate.id, ...loaded.evidence });
  }

  const cells = candidatePlans.flatMap(plan => plan.cells);
  if (new Set(cells.map(cell => cell.cellId)).size !== cells.length) {
    throw new Error('family imagegen matrix produced duplicate cell ids');
  }
  const expectedCount = familyReceipt.candidates.length * seeds.length * referenceSets.length;
  if (cells.length !== expectedCount) {
    throw new Error(`family imagegen cell coverage mismatch: ${cells.length} != ${expectedCount}`);
  }

  return {
    schema: ARMATURE_GESTALT_FAMILY_IMAGEGEN_PLAN_SCHEMA,
    createdAt: new Date().toISOString(),
    purpose: 'Measure whether distinct source-anchored 3D creature gestalts recruit distinct model priors while preserving lineage.',
    requestedConditioningRoute: familyReceipt.effectiveRoute,
    expectedRunner: GESTALT_IMAGEGEN_RUNNER,
    familyCandidateReceiptEvidence: receiptEvidence,
    comparisonContract: {
      kind: 'multi-gestalt-reference-seed-factorial',
      fixedCandidateIds: familyReceipt.candidates.map(candidate => candidate.id),
      fixedStance: stance.id,
      fixedModel: 'flux2-klein-9b',
      fixedSteps: 8,
      fixedGuidance: 1.0,
      variedReferenceSets: referenceSets.map(set => set.id),
      variedSeeds: seeds,
      loadBearingDiscriminator:
        'The fixed invention prompt must recruit materially different creature priors from the five bodies while preserving recognizable lineage.',
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      requestedRouteMustEqualEffectiveJobType: true,
      effectiveRunnerMustMatch: GESTALT_IMAGEGEN_RUNNER,
      everyConditioningInputMustMatchWitnessHash: true,
      samePromptAcrossEveryCandidate: true,
      visuallyDistinctOutputWithoutLineage: 'does_not_satisfy',
      visuallyAdherentOutputWithoutDistinctPriorRecruitment: 'does_not_satisfy',
    },
    cells,
  };
}

export async function buildArmatureGestaltFamilyImagegenContactSheetManifest({ plan, completion } = {}) {
  if (plan?.schema !== ARMATURE_GESTALT_FAMILY_IMAGEGEN_PLAN_SCHEMA) {
    throw new Error(`unexpected armature family imagegen plan schema: ${plan?.schema ?? 'missing'}`);
  }
  if (completion?.schema !== 'kaminos.lirm-armature-gestalt-family-imagegen-collection.v0'
      || completion.status !== 'complete') {
    throw new Error(`armature family imagegen collection is not complete: ${completion?.status ?? 'missing'}`);
  }
  if (!Array.isArray(completion.accepted) || completion.accepted.length !== plan.cells.length) {
    throw new Error('accepted family output count does not match plan');
  }
  const accepted = new Map(completion.accepted.map(entry => [entry.cellId, entry]));
  if (accepted.size !== plan.cells.length) throw new Error('accepted family outputs contain duplicate cell ids');

  const candidateIds = plan.comparisonContract?.fixedCandidateIds;
  const referenceSets = plan.comparisonContract?.variedReferenceSets;
  const seeds = plan.comparisonContract?.variedSeeds;
  if (!Array.isArray(candidateIds) || !Array.isArray(referenceSets) || !Array.isArray(seeds)) {
    throw new Error('family comparison contract lacks candidate, reference, or seed axes');
  }
  if (referenceSets.length !== 2 || seeds.length !== 2) {
    throw new Error('family contact sheet requires the two-reference-by-two-seed factorial');
  }

  const sheets = [];
  for (const seed of seeds) {
    const cells = [];
    const evidence = [];
    for (const candidateId of candidateIds) {
      const candidateCells = plan.cells.filter(cell => cell.candidateId === candidateId);
      if (candidateCells.length !== referenceSets.length * seeds.length) {
        throw new Error(`family contact sheet coverage mismatch for ${candidateId}`);
      }
      const sourceHashes = new Set(candidateCells.map(cell => cell.input.sha256));
      if (sourceHashes.size !== 1) throw new Error(`candidate clay source differs across cells: ${candidateId}`);
      const source = await fileEvidence(candidateCells[0].input.path);
      if (source.sha256 !== candidateCells[0].input.sha256) {
        throw new Error(`source input hash drift for ${candidateId}`);
      }

      const clayCell = candidateCells.find(cell => cell.referenceSet === referenceSets[0] && cell.seed === seed);
      const threeRefCell = candidateCells.find(cell => cell.referenceSet === referenceSets[1] && cell.seed === seed);
      if (!clayCell || !threeRefCell) throw new Error(`missing family seed pair for ${candidateId}/${seed}`);
      const normalReference = threeRefCell.references.find(reference => reference.role === 'normal');
      if (!normalReference) throw new Error(`missing normal reference for ${threeRefCell.cellId}`);
      const normal = await fileEvidence(normalReference.path);
      if (normal.sha256 !== normalReference.sha256) {
        throw new Error(`normal input hash drift for ${threeRefCell.cellId}`);
      }

      const outputCells = [clayCell, threeRefCell];
      const outputs = [];
      for (const cell of outputCells) {
        const acceptedOutput = accepted.get(cell.cellId);
        if (!acceptedOutput) throw new Error(`missing accepted output for ${cell.cellId}`);
        const output = await fileEvidence(cell.outputPath);
        if (output.sha256 !== acceptedOutput.output.sha256) {
          throw new Error(`generated output hash drift for ${cell.cellId}`);
        }
        outputs.push(output);
      }

      evidence.push(
        { candidateId, role: 'armature', ...source },
        { candidateId, role: 'normal', ...normal },
        { candidateId, role: `clay-only/seed${seed}`, ...outputs[0] },
        { candidateId, role: `clay-depth-normal/seed${seed}`, ...outputs[1] },
      );
      cells.push(
        { sourcePath: source.path, title: candidateId, viewLabel: 'ARMATURE' },
        { sourcePath: normal.path, title: candidateId, viewLabel: 'NORMAL' },
        { sourcePath: outputs[0].path, title: candidateId, viewLabel: 'CLAY' },
        { sourcePath: outputs[1].path, title: candidateId, viewLabel: '3REF' },
      );
    }
    sheets.push({
      seed,
      sheet: {
        width: 2048,
        cellWidth: 512,
        cellHeight: 548,
        imageHeight: 512,
        imageOffsetY: 0,
        headerHeight: 36,
        cells,
      },
      evidence,
    });
  }

  return {
    schema: 'kaminos.lirm-armature-gestalt-family-imagegen-contact-sheet-manifest.v0',
    sheets,
  };
}

function assertUniqueValues(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a non-empty array`);
  if (new Set(values).size !== values.length) throw new Error(`${label} must contain unique values`);
}

export async function buildArmatureProgramTrellisPromotionPlan({
  imagegenPlan,
  imagegenCompletion,
  promotedCellIds,
  outputRoot,
  comparisonContract,
} = {}) {
  if (imagegenPlan?.schema !== ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA) {
    throw new Error(`unexpected armature imagegen plan schema: ${imagegenPlan?.schema ?? 'missing'}`);
  }
  if (imagegenCompletion?.schema !== 'kaminos.lirm-armature-program-imagegen-collection.v0'
    || imagegenCompletion.status !== 'complete') {
    throw new Error('armature imagegen collection is not complete');
  }
  if (!outputRoot) throw new Error('Trellis outputRoot is required');
  assertUniqueValues(promotedCellIds, 'promotedCellIds');
  if (comparisonContract?.kind !== 'armature-reference-seed-factorial') {
    throw new Error(`unsupported armature Trellis comparison contract: ${comparisonContract?.kind ?? 'missing'}`);
  }
  if (typeof comparisonContract.fixedStance !== 'string' || comparisonContract.fixedStance.length === 0) {
    throw new Error('armature Trellis comparison requires fixedStance');
  }
  assertUniqueValues(comparisonContract.referenceSets, 'comparison referenceSets');
  assertUniqueValues(comparisonContract.imagegenSeeds, 'comparison imagegenSeeds');
  for (const seed of comparisonContract.imagegenSeeds) {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`invalid comparison imagegen seed: ${seed}`);
  }

  const planned = new Map(imagegenPlan.cells.map(cell => [cell.cellId, cell]));
  const accepted = new Map(imagegenCompletion.accepted.map(entry => [entry.cellId, entry]));
  const expectedFactorialKeys = comparisonContract.referenceSets.flatMap(referenceSet => (
    comparisonContract.imagegenSeeds.map(seed => `${referenceSet}\u0000${seed}`)
  ));
  const observedFactorialKeys = [];
  const cells = [];
  for (const cellId of promotedCellIds) {
    const sourceCell = planned.get(cellId);
    const sourceCompletion = accepted.get(cellId);
    if (!sourceCell || !sourceCompletion) throw new Error(`promoted cell is not accepted: ${cellId}`);
    if (sourceCell.stance !== comparisonContract.fixedStance) {
      throw new Error(`promoted cell violates fixed stance: ${cellId}`);
    }
    observedFactorialKeys.push(`${sourceCell.referenceSet}\u0000${sourceCell.seed}`);
    const input = await fileEvidence(sourceCompletion.output.path);
    if (input.sha256 !== sourceCompletion.output.sha256) throw new Error(`imagegen output hash drift: ${cellId}`);
    const cellOutputDir = resolve(outputRoot, cellId);
    cells.push({
      cellId,
      jobType: GESTALT_TRELLIS_JOB_TYPE,
      requestedRoute: `gpu-greenroom/${GESTALT_TRELLIS_JOB_TYPE}`,
      expectedRunner: GESTALT_TRELLIS_RUNNER,
      candidateId: sourceCell.candidateId,
      armatureProgram: sourceCell.armatureProgram,
      parameters: sourceCell.parameters,
      conditioningRoute: sourceCell.conditioningRoute,
      referenceSet: sourceCell.referenceSet,
      stance: sourceCell.stance,
      imagegenSeed: sourceCell.seed,
      input,
      outputDir: cellOutputDir,
      outputPath: resolve(cellOutputDir, 'output.glb'),
      settings: {
        seed: 42,
        resolution: 512,
        steps: 6,
        cascade: false,
        targetFaces: 200000,
        textureSize: 1024,
        simplifyFirst: true,
      },
    });
  }
  if (new Set(observedFactorialKeys).size !== observedFactorialKeys.length
    || expectedFactorialKeys.length !== observedFactorialKeys.length
    || expectedFactorialKeys.some(key => !observedFactorialKeys.includes(key))) {
    throw new Error(`factorial cell coverage mismatch: expected ${expectedFactorialKeys.length}, observed ${observedFactorialKeys.length}`);
  }

  return {
    schema: GESTALT_TRELLIS_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: {
      ...comparisonContract,
      fixedSettings: cells[0].settings,
    },
    evidencePredicate: {
      routeFallbackAllowed: false,
      missingGlbCountsAsSuccess: false,
      sourceHashDriftAllowed: false,
      spatialCoherenceRequiresRenderedWitness: true,
    },
    cells,
  };
}
