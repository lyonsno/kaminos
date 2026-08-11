#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createNBodyLocalizedChallengeSuite,
} from './nbody-packing-assay-core.mjs';
import {
  hashMusclePackingCanonicalJson,
} from './muscle-compartment-packing-core.mjs';
import {
  NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA,
  compileNBodyAdaptiveKktProblem,
  createNBodyAdaptiveKktConfig,
  evaluateNBodyUnifiedKktState,
  scaleNBodyUnifiedKktProblemClearance,
  solveNBodyUnifiedKktCandidate,
} from './nbody-packing-unified-kkt.mjs';

export const LOCALIZED_CHALLENGE_RESULT_SCHEMA =
  'kaminos.nbody-localized-challenge-result.v0';
export const LOCALIZED_CONTINUATION_RESULT_SCHEMA =
  'kaminos.nbody-localized-continuation-result.v0';
export const LOCALIZED_CONSTRAINT_HOMOTOPY_RESULT_SCHEMA =
  'kaminos.nbody-localized-constraint-homotopy-result.v0';

export function isNBodyLocalizedChallengePass(solverResult) {
  const tolerance = solverResult?.config?.effective?.convergenceTolerance;
  const residual = solverResult?.selected?.maximumPhysicalResidual;
  return solverResult?.status === 'converged-unified-kkt-candidate' &&
    solverResult?.invariance?.candidateEnumeration === 'passed' &&
    Number.isFinite(tolerance) && tolerance > 0 &&
    Number.isFinite(residual) && residual <= tolerance;
}

export function isNBodyLocalizedHomotopyStageAdmissible(
  solverResult,
  convergenceTolerance,
) {
  return solverResult?.status === 'converged-unified-kkt-candidate' &&
    solverResult?.invariance?.candidateEnumeration === 'passed' &&
    Number.isFinite(convergenceTolerance) && convergenceTolerance > 0 &&
    Number.isFinite(solverResult?.selected?.maximumPhysicalResidual) &&
    solverResult.selected.maximumPhysicalResidual <= convergenceTolerance;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resultCore({ suite, rows, status, terminal }) {
  const lastPass = [...rows].reverse().find(
    row => isNBodyLocalizedChallengePass(row.result),
  ) || null;
  const firstFail = rows.find(
    row => !isNBodyLocalizedChallengePass(row.result),
  ) || null;
  return {
    schema:LOCALIZED_CHALLENGE_RESULT_SCHEMA,
    route: {
      requested:'ordered-severity-continuation-through-first-failure',
      effective:'ordered-severity-continuation-through-first-failure',
      fallbackUsed:false,
    },
    suite: {
      fixtureCount:suite.length,
      fixtureIdentities:suite.map(fixture => ({
        id:fixture.id,
        sha256:fixture.identity.sha256,
        severity:fixture.assayProfile.severity,
      })),
    },
    solver: {
      policy:'frozen-reviewed-adaptive-carrier',
      config:createNBodyAdaptiveKktConfig(),
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
    },
    rows,
    bracket: {
      lastPass:lastPass ? {
        fixtureId:lastPass.fixtureId,
        fixtureSha256:lastPass.fixtureSha256,
        severity:lastPass.severity,
        resultSha256:lastPass.result.identity.sha256,
      } : null,
      firstFail:firstFail ? {
        fixtureId:firstFail.fixtureId,
        fixtureSha256:firstFail.fixtureSha256,
        severity:firstFail.severity,
        resultSha256:firstFail.result.identity.sha256,
        failure:firstFail.result.failure,
      } : null,
    },
    status,
    terminal,
    claimCeiling:'bounded-synthetic-last-pass-first-fail-localization-only',
  };
}

function documentResult(args) {
  const core = resultCore(args);
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function validateSeedResult(seedResult, initialVector) {
  const core = structuredClone(seedResult || {});
  delete core.identity;
  if (
    seedResult?.schema !== NBODY_PACKING_UNIFIED_KKT_RESULT_SCHEMA ||
    !/^[a-f0-9]{64}$/.test(seedResult?.identity?.sha256 || '') ||
    seedResult.identity.sha256 !== hashMusclePackingCanonicalJson(core) ||
    !/^[a-f0-9]{64}$/.test(seedResult?.source?.fixtureSha256 || '') ||
    seedResult?.status !== 'converged-unified-kkt-candidate' ||
    seedResult?.invariance?.candidateEnumeration !== 'passed' ||
    !Array.isArray(seedResult?.selected?.vector)
  ) {
    throw new Error(
      'localized continuation requires one canonical traversal-stable converged seed result',
    );
  }
  if (
    hashMusclePackingCanonicalJson(seedResult.selected.vector) !==
    hashMusclePackingCanonicalJson(initialVector)
  ) {
    throw new Error('localized continuation seed result selected vector does not match initialVector');
  }
  return {
    fixtureSha256:seedResult.source.fixtureSha256,
    resultSha256:seedResult.identity.sha256,
  };
}

function continuationDocument({
  fixture,
  initialVector,
  seedSource,
  requestedConfig,
  solverResult,
  status,
  terminal,
  elapsedMilliseconds,
}) {
  const seed = {
    fixtureSha256:seedSource.fixtureSha256,
    resultSha256:seedSource.resultSha256,
    vectorSha256:hashMusclePackingCanonicalJson(initialVector),
  };
  const core = {
    schema:LOCALIZED_CONTINUATION_RESULT_SCHEMA,
    route: {
      requested:'same-basis-prior-rung-continuation',
      effective:'same-basis-prior-rung-continuation',
      fallbackUsed:false,
    },
    target: {
      fixtureId:fixture.id,
      fixtureSha256:fixture.identity.sha256,
      severity:fixture.assayProfile.severity,
    },
    seed: {
      requested:structuredClone(seed),
      effective:structuredClone(seed),
    },
    solver: {
      requestedConfig:structuredClone(requestedConfig),
      effectiveConfig:structuredClone(requestedConfig),
      carrierPolicy:'frozen-first-second-sine',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
    },
    solverResult:solverResult ? structuredClone(solverResult) : null,
    elapsedMilliseconds,
    status,
    terminal,
    claimCeiling:'same-basis-continuation-can-classify-cold-start-globalization-only',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function runNBodyLocalizedContinuation({
  fixture,
  initialVector,
  seedResult,
  requestedConfig = createNBodyAdaptiveKktConfig(),
  outputPath = null,
} = {}) {
  if (!Array.isArray(initialVector)) {
    throw new Error('localized continuation initialVector must be an array');
  }
  const seedSource = validateSeedResult(seedResult, initialVector);
  const startedAt = new Date().toISOString();
  const running = continuationDocument({
    fixture,
    initialVector,
    seedSource,
    requestedConfig,
    solverResult:null,
    status:'running',
    terminal:{ startedAt, completedAt:null, failurePhase:null },
    elapsedMilliseconds:null,
  });
  if (outputPath) writeJson(outputPath, running);
  try {
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const started = performance.now();
    const solverResult = solveNBodyUnifiedKktCandidate({
      problem,
      requestedConfig,
      initialVector,
    });
    const result = continuationDocument({
      fixture,
      initialVector,
      seedSource,
      requestedConfig,
      solverResult,
      status:solverResult.status === 'converged-unified-kkt-candidate'
        ? 'complete-converged'
        : 'complete-stalled',
      terminal:{ startedAt, completedAt:new Date().toISOString(), failurePhase:null },
      elapsedMilliseconds:Number((performance.now() - started).toFixed(3)),
    });
    if (outputPath) writeJson(outputPath, result);
    return result;
  } catch (error) {
    const failure = continuationDocument({
      fixture,
      initialVector,
      seedSource,
      requestedConfig,
      solverResult:null,
      status:'failed-before-classification',
      terminal:{
        startedAt,
        completedAt:new Date().toISOString(),
        failurePhase:'continuation-solve',
        error:{ name:error.name, message:error.message, stack:error.stack },
      },
      elapsedMilliseconds:null,
    });
    if (outputPath) writeJson(outputPath, failure);
    throw error;
  }
}

function homotopyDocument({
  problem,
  stageScales,
  initialVector,
  requestedConfig,
  stages,
  status,
  terminal,
}) {
  const lastStage = stages.at(-1) || null;
  const core = {
    schema:LOCALIZED_CONSTRAINT_HOMOTOPY_RESULT_SCHEMA,
    route: {
      requested:'compiled-problem-clearance-homotopy',
      effective:'compiled-problem-clearance-homotopy',
      fallbackUsed:false,
    },
    source: {
      problemSha256:problem.identity.sha256,
      fixtureSha256:problem.source.fixtureSha256,
    },
    config: {
      requested:{ stageScales:[...stageScales], solver:structuredClone(requestedConfig) },
      effective:{ stageScales:[...stageScales], solver:structuredClone(requestedConfig) },
    },
    initialization:initialVector === undefined
      ? { kind:'compiled-crowded-zero-vector' }
      : {
          kind:'explicit-same-basis-vector',
          vectorSha256:hashMusclePackingCanonicalJson(initialVector),
        },
    mechanism: {
      continuationVariable:'uniform-muscle-radius-obstacle-radius-and-clearance-scale',
      carrier:'unchanged-compiled-first-second-sine',
      previousStageSelectedVectorConsumed:true,
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
    },
    stages,
    final:lastStage ? {
      clearanceScale:lastStage.clearanceScale,
      problemSha256:lastStage.problemSha256,
      resultSha256:lastStage.solverResult.identity.sha256,
      status:lastStage.solverResult.status,
      maximumPhysicalResidual:lastStage.solverResult.selected.maximumPhysicalResidual,
    } : null,
    status,
    terminal,
    claimCeiling:'full-clearance-convergence-on-the-unchanged-carrier-only',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function runNBodyLocalizedConstraintHomotopy({
  problem,
  stageScales,
  initialVector,
  requestedConfig = createNBodyAdaptiveKktConfig(),
  outputPath = null,
} = {}) {
  if (
    !Array.isArray(stageScales) || stageScales.length === 0 ||
    stageScales.some(scale => !Number.isFinite(scale) || scale <= 0 || scale > 1) ||
    stageScales.some((scale, index) => index > 0 && scale <= stageScales[index - 1]) ||
    stageScales.at(-1) !== 1
  ) {
    throw new Error(
      'localized constraint homotopy stageScales must be strictly increasing in (0, 1] and end at 1',
    );
  }
  if (initialVector !== undefined && !Array.isArray(initialVector)) {
    throw new Error('localized constraint homotopy initialVector must be an array');
  }
  const startedAt = new Date().toISOString();
  const stages = [];
  const writeProgress = (status, terminal) => {
    const result = homotopyDocument({
      problem,
      stageScales,
      initialVector,
      requestedConfig,
      stages,
      status,
      terminal,
    });
    if (outputPath) writeJson(outputPath, result);
    return result;
  };
  writeProgress('running', { startedAt, completedAt:null, failurePhase:null });
  try {
    let seed = initialVector === undefined ? undefined : [...initialVector];
    for (const clearanceScale of stageScales) {
      const effectiveProblem = scaleNBodyUnifiedKktProblemClearance({
        problem,
        clearanceScale,
      });
      const started = performance.now();
      const solverResult = solveNBodyUnifiedKktCandidate({
        problem:effectiveProblem,
        requestedConfig,
        ...(seed === undefined ? {} : { initialVector:seed }),
      });
      stages.push({
        clearanceScale,
        problemSha256:effectiveProblem.identity.sha256,
        parentProblemSha256:clearanceScale === 1
          ? null
          : effectiveProblem.source.parentProblemSha256,
        seedVectorSha256:hashMusclePackingCanonicalJson(
          seed === undefined
            ? Array(effectiveProblem.variables.length).fill(0)
            : seed,
        ),
        elapsedMilliseconds:Number((performance.now() - started).toFixed(3)),
        solverResult,
      });
      const admissible = isNBodyLocalizedHomotopyStageAdmissible(
        solverResult,
        requestedConfig.convergenceTolerance,
      );
      const rejectedStatus = solverResult.status === 'converged-unified-kkt-candidate'
        ? 'complete-inadmissible-before-full-clearance'
        : 'complete-stalled-before-full-clearance';
      writeProgress(admissible ? 'running' : rejectedStatus, {
        startedAt,
        completedAt:admissible ? null : new Date().toISOString(),
        failurePhase:null,
      });
      if (!admissible) {
        return writeProgress(rejectedStatus, {
          startedAt,
          completedAt:new Date().toISOString(),
          failurePhase:null,
        });
      }
      seed = [...solverResult.selected.vector];
    }
    return writeProgress('complete-converged-full-clearance', {
      startedAt,
      completedAt:new Date().toISOString(),
      failurePhase:null,
    });
  } catch (error) {
    writeProgress('failed-before-classification', {
      startedAt,
      completedAt:new Date().toISOString(),
      failurePhase:'constraint-homotopy-stage',
      error:{ name:error.name, message:error.message, stack:error.stack },
    });
    throw error;
  }
}

export function classifyNBodyLocalizedSameBasisOracle({
  problem,
  startVector,
  convergenceTolerance,
  stepSchedule,
  translationBounds,
} = {}) {
  if (!Number.isFinite(convergenceTolerance) || convergenceTolerance <= 0) {
    throw new Error('same-basis oracle convergenceTolerance must be positive and finite');
  }
  if (
    !Array.isArray(stepSchedule) || stepSchedule.length === 0 ||
    stepSchedule.some(step => !Number.isFinite(step) || step <= 0)
  ) {
    throw new Error('same-basis oracle stepSchedule must contain positive finite values');
  }
  if (
    !Array.isArray(translationBounds) || translationBounds.length !== 2 ||
    !translationBounds.every(Number.isFinite) ||
    translationBounds[0] >= translationBounds[1]
  ) {
    throw new Error('same-basis oracle translationBounds must be an ordered finite pair');
  }
  if (
    !Array.isArray(startVector) ||
    startVector.some(value => value < translationBounds[0] || value > translationBounds[1])
  ) {
    throw new Error('same-basis oracle startVector must remain inside translationBounds');
  }
  const start = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
  const evaluations = [];
  for (const step of stepSchedule) {
    for (let coordinateIndex = 0; coordinateIndex < startVector.length; coordinateIndex += 1) {
      for (const direction of [-1, 1]) {
        const delta = direction * step;
        const vector = [...startVector];
        vector[coordinateIndex] += delta;
        if (
          vector[coordinateIndex] < translationBounds[0] ||
          vector[coordinateIndex] > translationBounds[1]
        ) {
          evaluations.push({
            step, coordinateIndex, direction, delta,
            status:'skipped-translation-bound',
          });
          continue;
        }
        const state = evaluateNBodyUnifiedKktState({ problem, vector });
        const row = {
          step,
          coordinateIndex,
          direction,
          delta,
          status:'evaluated',
          maximumPhysicalResidual:state.maximumPhysicalResidual,
          metrics:structuredClone(state.metrics),
        };
        evaluations.push(row);
        if (state.maximumPhysicalResidual <= convergenceTolerance) {
          const core = {
            schema:'kaminos.nbody-localized-same-basis-oracle.v0',
            route: {
              requested:'deterministic-single-coordinate-neighborhood',
              effective:'deterministic-single-coordinate-neighborhood',
              fallbackUsed:false,
            },
            problemIdentity:structuredClone(problem.identity),
            mechanism: {
              carrier:structuredClone(problem.carrier),
              oracleTargetCoordinatesConsumed:false,
              contactGraphRowsConsumed:false,
              startSource:'frozen-solver-last-trustworthy-selected-vector',
            },
            config: {
              convergenceTolerance,
              stepSchedule:[...stepSchedule],
              translationBounds:[...translationBounds],
              coordinateEnumeration:'ascending-index-negative-then-positive',
            },
            start: {
              vector:[...startVector],
              maximumPhysicalResidual:start.maximumPhysicalResidual,
              metrics:structuredClone(start.metrics),
            },
            selected: {
              vector,
              coordinateIndex,
              delta,
              maximumPhysicalResidual:state.maximumPhysicalResidual,
              metrics:structuredClone(state.metrics),
              muscles:structuredClone(state.muscles),
            },
            evaluations,
            status:'same-basis-feasible-globalization-failure',
            claimCeiling:'one-feasible-neighbor-proves-representation-sufficiency-not-optimality',
          };
          return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
        }
      }
    }
  }
  const core = {
    schema:'kaminos.nbody-localized-same-basis-oracle.v0',
    route: {
      requested:'deterministic-single-coordinate-neighborhood',
      effective:'deterministic-single-coordinate-neighborhood',
      fallbackUsed:false,
    },
    problemIdentity:structuredClone(problem.identity),
    mechanism: {
      carrier:structuredClone(problem.carrier),
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      startSource:'frozen-solver-last-trustworthy-selected-vector',
    },
    config: {
      convergenceTolerance,
      stepSchedule:[...stepSchedule],
      translationBounds:[...translationBounds],
      coordinateEnumeration:'ascending-index-negative-then-positive',
    },
    start: {
      vector:[...startVector],
      maximumPhysicalResidual:start.maximumPhysicalResidual,
      metrics:structuredClone(start.metrics),
    },
    selected:null,
    evaluations,
    status:'same-basis-feasibility-unresolved',
    claimCeiling:'bounded-neighborhood-negative-does-not-prove-representation-infeasibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function patternStateReceipt(state) {
  return {
    vector:[...state.vector],
    maximumPhysicalResidual:state.maximumPhysicalResidual,
    violationEnergy:state.rows.reduce(
      (sum, row) => sum + Math.max(0, -row.signedGap) ** 2,
      0,
    ),
    deformationEnergy:state.deformationEnergy,
    metrics:structuredClone(state.metrics),
  };
}

function comparePatternStates(left, right) {
  if (Math.abs(left.maximumPhysicalResidual - right.maximumPhysicalResidual) > 1e-15) {
    return left.maximumPhysicalResidual - right.maximumPhysicalResidual;
  }
  if (Math.abs(left.violationEnergy - right.violationEnergy) > 1e-18) {
    return left.violationEnergy - right.violationEnergy;
  }
  if (Math.abs(left.deformationEnergy - right.deformationEnergy) > 1e-15) {
    return left.deformationEnergy - right.deformationEnergy;
  }
  return hashMusclePackingCanonicalJson(left.vector)
    .localeCompare(hashMusclePackingCanonicalJson(right.vector));
}

function patternSearchDocument({
  problem,
  startVectors,
  convergenceTolerance,
  stepSchedule,
  sweepsPerStep,
  translationBounds,
  seedRows,
  evaluations,
  selected,
  status,
  terminal,
}) {
  const core = {
    schema:'kaminos.nbody-localized-same-basis-pattern-search.v0',
    route: {
      requested:'deterministic-coupled-coordinate-pattern-search',
      effective:'deterministic-coupled-coordinate-pattern-search',
      fallbackUsed:false,
    },
    problemIdentity:structuredClone(problem.identity),
    mechanism: {
      carrier:structuredClone(problem.carrier),
      objective:'maximum-physical-residual-then-sum-squared-negative-constraint-gaps',
      movePolicy:'best-single-coordinate-move-per-sweep',
      coordinateEnumeration:'ascending-index-negative-then-positive',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
    },
    config: {
      convergenceTolerance,
      stepSchedule:[...stepSchedule],
      sweepsPerStep,
      translationBounds:[...translationBounds],
    },
    starts:startVectors.map((vector, seedIndex) => ({
      seedIndex,
      vectorSha256:hashMusclePackingCanonicalJson(vector),
    })),
    seedRows,
    evaluations,
    selected,
    status,
    terminal,
    claimCeiling:selected
      ? 'feasible-same-basis-witness-proves-representation-sufficiency-not-optimality'
      : 'bounded-pattern-search-negative-does-not-prove-representation-infeasibility',
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

export function classifyNBodyLocalizedSameBasisPatternSearch({
  problem,
  startVectors,
  convergenceTolerance,
  stepSchedule,
  sweepsPerStep,
  translationBounds,
  outputPath = null,
} = {}) {
  if (!Number.isFinite(convergenceTolerance) || convergenceTolerance <= 0) {
    throw new Error('same-basis pattern convergenceTolerance must be positive and finite');
  }
  if (
    !Array.isArray(stepSchedule) || stepSchedule.length === 0 ||
    stepSchedule.some(step => !Number.isFinite(step) || step <= 0)
  ) {
    throw new Error('same-basis pattern stepSchedule must contain positive finite values');
  }
  if (!Number.isInteger(sweepsPerStep) || sweepsPerStep <= 0) {
    throw new Error('same-basis pattern sweepsPerStep must be a positive integer');
  }
  if (
    !Array.isArray(translationBounds) || translationBounds.length !== 2 ||
    !translationBounds.every(Number.isFinite) ||
    translationBounds[0] >= translationBounds[1]
  ) {
    throw new Error('same-basis pattern translationBounds must be an ordered finite pair');
  }
  if (!Array.isArray(startVectors) || startVectors.length === 0) {
    throw new Error('same-basis pattern startVectors must be a nonempty array');
  }
  const startedAt = new Date().toISOString();
  const seedRows = [];
  const evaluations = [];
  let selected = null;
  const writeProgress = (status, terminal) => {
    const document = patternSearchDocument({
      problem,
      startVectors,
      convergenceTolerance,
      stepSchedule,
      sweepsPerStep,
      translationBounds,
      seedRows,
      evaluations,
      selected,
      status,
      terminal,
    });
    if (outputPath) writeJson(outputPath, document);
    return document;
  };
  writeProgress('running', { startedAt, completedAt:null, failurePhase:null });
  try {
    for (const [seedIndex, startVector] of startVectors.entries()) {
      let currentState = evaluateNBodyUnifiedKktState({ problem, vector:startVector });
      let current = patternStateReceipt(currentState);
      const acceptedMoves = [];
      const seedRow = {
        seedIndex,
        start:structuredClone(current),
        acceptedMoves,
        final:null,
      };
      seedRows.push(seedRow);
      if (current.maximumPhysicalResidual <= convergenceTolerance) {
        selected = {
          seedIndex,
          ...structuredClone(current),
          muscles:structuredClone(currentState.muscles),
          acceptedMoves:structuredClone(acceptedMoves),
        };
        return writeProgress('same-basis-feasible-globalization-failure', {
          startedAt, completedAt:new Date().toISOString(), failurePhase:null,
        });
      }
      for (const step of stepSchedule) {
        for (let sweep = 1; sweep <= sweepsPerStep; sweep += 1) {
          let best = null;
          let bestState = null;
          for (let coordinateIndex = 0; coordinateIndex < current.vector.length;
            coordinateIndex += 1) {
            for (const direction of [-1, 1]) {
              const delta = direction * step;
              const vector = [...current.vector];
              vector[coordinateIndex] += delta;
              if (
                vector[coordinateIndex] < translationBounds[0] ||
                vector[coordinateIndex] > translationBounds[1]
              ) {
                evaluations.push({
                  seedIndex, step, sweep, coordinateIndex, direction, delta,
                  status:'skipped-translation-bound',
                });
                continue;
              }
              const candidateState = evaluateNBodyUnifiedKktState({ problem, vector });
              const candidate = patternStateReceipt(candidateState);
              evaluations.push({
                seedIndex, step, sweep, coordinateIndex, direction, delta,
                status:'evaluated',
                maximumPhysicalResidual:candidate.maximumPhysicalResidual,
                violationEnergy:candidate.violationEnergy,
                deformationEnergy:candidate.deformationEnergy,
              });
              if (candidate.maximumPhysicalResidual <= convergenceTolerance) {
                acceptedMoves.push({
                  step, sweep, coordinateIndex, direction, delta,
                  before:structuredClone(current),
                  after:structuredClone(candidate),
                });
                selected = {
                  seedIndex,
                  ...structuredClone(candidate),
                  muscles:structuredClone(candidateState.muscles),
                  acceptedMoves:structuredClone(acceptedMoves),
                };
                seedRow.final = structuredClone(candidate);
                return writeProgress('same-basis-feasible-globalization-failure', {
                  startedAt, completedAt:new Date().toISOString(), failurePhase:null,
                });
              }
              if (!best || comparePatternStates(candidate, best) < 0) {
                best = candidate;
                bestState = candidateState;
                best.move = { step, sweep, coordinateIndex, direction, delta };
              }
            }
          }
          if (!best || comparePatternStates(best, current) >= 0) break;
          const before = structuredClone(current);
          const move = best.move;
          delete best.move;
          current = best;
          currentState = bestState;
          acceptedMoves.push({ ...move, before, after:structuredClone(current) });
          seedRow.final = structuredClone(current);
          writeProgress('running', { startedAt, completedAt:null, failurePhase:null });
        }
      }
      seedRow.final = structuredClone(current);
    }
    return writeProgress('same-basis-feasibility-unresolved', {
      startedAt, completedAt:new Date().toISOString(), failurePhase:null,
    });
  } catch (error) {
    writeProgress('failed-before-classification', {
      startedAt,
      completedAt:new Date().toISOString(),
      failurePhase:'pattern-search',
      error:{ name:error.name, message:error.message, stack:error.stack },
    });
    throw error;
  }
}

export function runNBodyLocalizedChallenge({
  outputPath = null,
  suite = createNBodyLocalizedChallengeSuite(),
} = {}) {
  const rows = [];
  const startedAt = new Date().toISOString();
  if (outputPath) {
    writeJson(outputPath, documentResult({
      suite,
      rows,
      status:'running',
      terminal:{ startedAt, completedAt:null, failurePhase:null },
    }));
  }
  try {
    for (const fixture of suite) {
      const problem = compileNBodyAdaptiveKktProblem(fixture);
      const requestedConfig = createNBodyAdaptiveKktConfig();
      const started = performance.now();
      const result = solveNBodyUnifiedKktCandidate({ problem, requestedConfig });
      rows.push({
        fixtureId:fixture.id,
        fixtureSha256:fixture.identity.sha256,
        severity:fixture.assayProfile.severity,
        elapsedMilliseconds:Number((performance.now() - started).toFixed(3)),
        problemIdentity:structuredClone(problem.identity),
        result,
      });
      const failed = !isNBodyLocalizedChallengePass(result);
      if (outputPath) {
        writeJson(outputPath, documentResult({
          suite,
          rows,
          status:failed ? 'complete-boundary-found' : 'running',
          terminal:{
            startedAt,
            completedAt:failed ? new Date().toISOString() : null,
            failurePhase:null,
          },
        }));
      }
      if (failed) break;
    }
    const boundaryFound = rows.some(
      row => !isNBodyLocalizedChallengePass(row.result),
    );
    const result = documentResult({
      suite,
      rows,
      status:boundaryFound ? 'complete-boundary-found' : 'complete-no-boundary-found',
      terminal:{ startedAt, completedAt:new Date().toISOString(), failurePhase:null },
    });
    if (outputPath) writeJson(outputPath, result);
    return result;
  } catch (error) {
    const failure = documentResult({
      suite,
      rows,
      status:'failed-before-boundary-classification',
      terminal:{
        startedAt,
        completedAt:new Date().toISOString(),
        failurePhase:rows.length === 0 ? 'before-first-rung' : 'between-rungs',
        error:{ name:error.name, message:error.message, stack:error.stack },
      },
    });
    if (outputPath) writeJson(outputPath, failure);
    throw error;
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (!outputPath) throw new Error('localized challenge runner requires --output <path>');
  const result = runNBodyLocalizedChallenge({ outputPath:path.resolve(outputPath) });
  process.stdout.write(`${JSON.stringify({
    status:result.status,
    bracket:result.bracket,
    outputPath:path.resolve(outputPath),
    identity:result.identity,
  }, null, 2)}\n`);
}
