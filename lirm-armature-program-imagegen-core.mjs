import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  GESTALT_IMAGEGEN_JOB_TYPE,
  GESTALT_IMAGEGEN_JOB_TYPE_2REF,
  GESTALT_IMAGEGEN_JOB_TYPE_3REF,
  GESTALT_IMAGEGEN_RUNNER,
} from './lirm-speciation-gestalt-imagegen-core.mjs';

export const ARMATURE_PROGRAM_IMAGEGEN_PLAN_SCHEMA = 'kaminos.lirm-armature-program-imagegen-plan.v0';

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
