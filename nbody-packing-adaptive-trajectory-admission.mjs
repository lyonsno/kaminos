#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  evaluateNBodyUnifiedKktState,
} from './nbody-packing-unified-kkt.mjs';
import {
  NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA,
  adjudicateNBodyAdaptiveStepBoundary,
  createNBodyFamilyGradientAdaptiveTrajectoryConfig,
  solveNBodyFamilyGradientAdaptiveTrajectory,
} from './nbody-packing-restoration.mjs';

export const NBODY_PACKING_ADAPTIVE_TRAJECTORY_ADMISSION_SCHEMA =
  'kaminos.nbody-packing-adaptive-common-descent-trajectory-admission.v0';

const FAMILY_KEYS = Object.freeze([
  'pairwisePenetration',
  'skeletalPenetration',
  'compartmentEscape',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function rounded(value) {
  return Math.round(value * 1e15) / 1e15;
}

async function writeAtomically(targetPath, bytes, io = { writeFile, rename }) {
  const temporaryPath = `${targetPath}.tmp`;
  await io.writeFile(temporaryPath, bytes);
  await io.rename(temporaryPath, targetPath);
}

async function removeIfPresent(targetPath) {
  await rm(targetPath, { force:true, recursive:true });
}

async function invalidateAdmissionPrimaries(outputRoot, { includeRaw = true } = {}) {
  const names = [
    ...(includeRaw ? ['raw-trajectory.json'] : []),
    'result.json',
    'run-report.json',
  ];
  await Promise.all(names.flatMap(name => [
    removeIfPresent(path.join(outputRoot, name)),
    removeIfPresent(path.join(outputRoot, `${name}.tmp`)),
  ]));
}

function requireExact(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function stateReceipt(state, { includeMuscles = false } = {}) {
  return {
    vector:[...state.vector],
    maximumPhysicalResidual:state.maximumPhysicalResidual,
    metrics:structuredClone(state.metrics),
    ...(includeMuscles ? { muscles:structuredClone(state.muscles) } : {}),
  };
}

function verifyResultIdentity(result) {
  const core = structuredClone(result);
  delete core.identity;
  if (result.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error('adaptive trajectory admission rejects stale result identity');
  }
}

export function validateNBodyAdaptiveTrajectoryRaw({ raw }) {
  if (
    raw?.schema !== 'kaminos.adaptive-common-descent-trajectory-raw.v0' ||
    raw.authority !== 'unadmitted-raw-solver-output'
  ) throw new Error('adaptive trajectory admission requires the raw-first solver envelope');
  const result = raw.result;
  verifyResultIdentity(result);
  const expectedConfig = createNBodyFamilyGradientAdaptiveTrajectoryConfig({
    iterationBudget:8,
  });
  const fixture = createNBodyLocalizedChallengeSuite().find(
    row => row.assayProfile.severity === 0.32,
  );
  const problem = compileNBodyAdaptiveKktProblem(fixture);
  if (
    result.schema !== NBODY_PACKING_ADAPTIVE_COMMON_DESCENT_TRAJECTORY_RESULT_SCHEMA ||
    result.status !== 'adaptive-common-descent-trajectory-budget-exhausted' ||
    result.route?.requested !== expectedConfig.algorithm ||
    result.route?.effective !== expectedConfig.algorithm ||
    result.route?.fallbackUsed !== false ||
    raw.source?.problemSha256 !== problem.identity.sha256 ||
    result.source?.problemSha256 !== problem.identity.sha256 ||
    raw.source?.fixedTrajectorySha256 !==
      'ed4975f0c154116a5f9245553d7208778bf0749dfa3223b46d31ed59913bd2e5' ||
    JSON.stringify(raw.requestedConfig) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    result.work?.iterations !== 8 ||
    result.work?.attempts !== 8 ||
    result.work?.rows?.length !== 8 ||
    result.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    result.mechanism?.contactGraphRowsConsumed !== false
  ) throw new Error('adaptive trajectory admission rejects substituted route, source, or config');

  const startState = evaluateNBodyUnifiedKktState({
    problem,
    vector:result.start.vector,
  });
  requireExact(
    result.start,
    stateReceipt(startState),
    'adaptive trajectory admission rejects stale start state',
  );
  const reconstructedTrajectory = solveNBodyFamilyGradientAdaptiveTrajectory({
    problem,
    startVector:startState.vector,
    requestedConfig:expectedConfig,
  });
  requireExact(
    result,
    reconstructedTrajectory,
    'adaptive trajectory admission rejects reconstructed adaptive trajectory authority or continuation schedule',
  );
  const boundaryClassifications = [];
  let previous = result.start;
  let evaluationCount = 0;
  for (const [index, row] of result.work.rows.entries()) {
    requireExact(
      row.before,
      previous,
      `adaptive trajectory admission rejects row continuity at iteration ${index + 1}`,
    );
    if (row.accepted !== true || row.directionConstruction?.predictedCommonDescent !== true) {
      throw new Error(
        `adaptive trajectory admission rejects unaccepted direction at iteration ${index + 1}`,
      );
    }
    const recomputedStep = reconstructedTrajectory.work.rows[index];
    requireExact(
      row.directionConstruction,
      recomputedStep.directionConstruction,
      `adaptive trajectory admission rejects recomputed adaptive step direction at iteration ${index + 1}`,
    );
    requireExact(
      row.bracket,
      recomputedStep.bracket,
      `adaptive trajectory admission rejects recomputed adaptive step bracket at iteration ${index + 1}`,
    );
    requireExact(
      row.trialReceipts,
      recomputedStep.trialReceipts,
      `adaptive trajectory admission rejects recomputed adaptive step trial physics at iteration ${index + 1}`,
    );
    requireExact(
      row.after,
      recomputedStep.after,
      `adaptive trajectory admission rejects recomputed adaptive step selection at iteration ${index + 1}`,
    );
    if (row.stepResultSha256 !== recomputedStep.stepResultSha256) {
      throw new Error(
        `adaptive trajectory admission rejects recomputed adaptive step identity at iteration ${index + 1}`,
      );
    }
    const boundary = adjudicateNBodyAdaptiveStepBoundary(row);
    if (!boundary.admitted) throw new Error(
      `adaptive trajectory admission rejects ${boundary.classification} at iteration ${index + 1}: ${boundary.reason}`,
    );
    boundaryClassifications.push({ iteration:index + 1, ...boundary });
    const minimumPredictedDecreaseRate = Math.min(...Object.values(
      row.directionConstruction.predictedDirectionalDerivatives,
    ).filter(Number.isFinite).map(value => -value));
    for (const trial of row.trialReceipts) {
      const families = trial.constraintFamilies;
      const regressedFamilies = FAMILY_KEYS.filter(key =>
        families[key] > row.before.metrics[key] + expectedConfig.familyRegressionTolerance);
      const actualDecrease = rounded(
        row.before.maximumPhysicalResidual - trial.maximumPhysicalResidual,
      );
      const requiredDecrease = rounded(Math.max(
        expectedConfig.improvementTolerance,
        expectedConfig.sufficientDecreaseFraction * trial.radius *
          minimumPredictedDecreaseRate,
      ));
      const admissible = regressedFamilies.length === 0 &&
        actualDecrease >= requiredDecrease;
      if (
        !Array.isArray(trial.vector) ||
        trial.vector.length !== row.before.vector.length ||
        JSON.stringify(Object.keys(families || {}).sort()) !==
          JSON.stringify([...FAMILY_KEYS].sort()) ||
        Math.max(...Object.values(families)) !== trial.maximumPhysicalResidual ||
        JSON.stringify(trial.regressedFamilies) !== JSON.stringify(regressedFamilies) ||
        trial.actualDecrease !== actualDecrease ||
        trial.requiredDecrease !== requiredDecrease ||
        trial.admissible !== admissible
      ) throw new Error(
        `adaptive trajectory admission rejects internally inconsistent trial at iteration ${index + 1}`,
      );
    }
    const selectedTrial = row.trialReceipts.find(trial => trial.selected);
    const afterState = evaluateNBodyUnifiedKktState({ problem, vector:row.after.vector });
    requireExact(
      row.after,
      stateReceipt(afterState, { includeMuscles:true }),
      `adaptive trajectory admission rejects stale after state at iteration ${index + 1}`,
    );
    if (
      !selectedTrial ||
      JSON.stringify(selectedTrial.vector) !== JSON.stringify(row.after.vector) ||
      row.after.maximumPhysicalResidual >= row.before.maximumPhysicalResidual ||
      FAMILY_KEYS.some(key => row.after.metrics[key] >
        row.before.metrics[key] + expectedConfig.familyRegressionTolerance) ||
      row.after.metrics.endpointDrift !== 0 ||
      row.after.metrics.maximumRelativeVolumeError !== 0
    ) throw new Error(
      `adaptive trajectory admission rejects selection semantics at iteration ${index + 1}`,
    );
    evaluationCount += 2 +
      (2 * row.before.vector.length * FAMILY_KEYS.length) +
      row.trialReceipts.length + 1;
    previous = {
      vector:[...row.after.vector],
      maximumPhysicalResidual:row.after.maximumPhysicalResidual,
      metrics:structuredClone(row.after.metrics),
    };
  }
  requireExact(
    result.selected,
    result.work.rows.at(-1).after,
    'adaptive trajectory admission rejects final selection binding',
  );
  if (evaluationCount !== result.work.evaluationCount) {
    throw new Error('adaptive trajectory admission rejects evaluation accounting');
  }
  return {
    result,
    problemSha256:problem.identity.sha256,
    fixtureSha256:fixture.identity.sha256,
    boundaryClassifications,
  };
}

export async function admitNBodyAdaptiveTrajectoryRaw({
  rawPath,
  outDir = 'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0',
  io = { writeFile, rename },
} = {}) {
  if (!rawPath) throw new Error('adaptive trajectory admission rawPath is required');
  const outputRoot = path.resolve(outDir);
  await mkdir(outputRoot, { recursive:true });
  let phase = 'read-raw';
  let lastTrustworthyEvidence = { phase:'none' };
  try {
    phase = 'invalidate-prior-primary';
    await invalidateAdmissionPrimaries(outputRoot, { includeRaw:false });
    phase = 'read-raw';
    const rawBytes = await readFile(path.resolve(rawPath));
    await removeIfPresent(path.join(outputRoot, 'raw-trajectory.json'));
    const raw = JSON.parse(String(rawBytes));
    lastTrustworthyEvidence = { phase:'raw-read', rawFileSha256:sha256(rawBytes) };
    phase = 'validate-raw';
    const validation = validateNBodyAdaptiveTrajectoryRaw({ raw });
    const resultBytes = jsonBytes(validation.result);
    const reportCore = {
      schema:NBODY_PACKING_ADAPTIVE_TRAJECTORY_ADMISSION_SCHEMA,
      status:'complete-admitted-canonical-trajectory',
      route:{
        requested:validation.result.route.requested,
        effective:validation.result.route.effective,
        fallbackUsed:false,
      },
      source:{
        authority:'registered-job-raw-first-solver-output',
        rawFileSha256:sha256(rawBytes),
        fixtureSha256:validation.fixtureSha256,
        problemSha256:validation.problemSha256,
        fixedTrajectorySha256:raw.source.fixedTrajectorySha256,
      },
      bindings:{
        resultFileSha256:sha256(resultBytes),
        resultSha256:validation.result.identity.sha256,
      },
      adjudication:{
        boundaryClassifications:validation.boundaryClassifications,
        acceptedIterations:validation.result.work.iterations,
        evaluationCount:validation.result.work.evaluationCount,
      },
      outcome:{
        startMaximumPhysicalResidual:validation.result.start.maximumPhysicalResidual,
        finalMaximumPhysicalResidual:validation.result.selected.maximumPhysicalResidual,
        startFamilies:Object.fromEntries(FAMILY_KEYS.map(
          key => [key, validation.result.start.metrics[key]],
        )),
        finalFamilies:Object.fromEntries(FAMILY_KEYS.map(
          key => [key, validation.result.selected.metrics[key]],
        )),
        endpointDrift:validation.result.selected.metrics.endpointDrift,
        maximumRelativeVolumeError:
          validation.result.selected.metrics.maximumRelativeVolumeError,
      },
      claimCeiling:validation.result.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['raw-trajectory.json', rawBytes],
      ['result.json', resultBytes],
      ['run-report.json', jsonBytes(report)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, result:validation.result, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_ADAPTIVE_TRAJECTORY_ADMISSION_SCHEMA,
      status:'failed',
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await invalidateAdmissionPrimaries(outputRoot);
    await writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(failure), io);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rawPath = process.argv[2];
  const outDir = process.argv[3];
  const output = await admitNBodyAdaptiveTrajectoryRaw({ rawPath, outDir });
  process.stdout.write(`${JSON.stringify({
    outputRoot:output.outputRoot,
    resultSha256:output.result.identity.sha256,
    reportSha256:output.report.identity.sha256,
  }, null, 2)}\n`);
}
