#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import {
  hashMusclePackingCanonicalJson,
} from './muscle-compartment-packing-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  evaluateNBodyUnifiedKktState,
} from './nbody-packing-unified-kkt.mjs';
import {
  createNBodyAllNeighborRestorationConfig,
  createNBodyFamilyGradientCommonDescentConfig,
  createNBodyFamilyGradientCommonDescentTrajectoryConfig,
} from './nbody-packing-restoration.mjs';
import {
  NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA,
  NBODY_PACKING_REFINED_COMMON_DESCENT_RADII,
} from './nbody-packing-restoration-assay.mjs';
import {
  LOCALIZED_CHALLENGE_RESULT_SCHEMA,
  LOCALIZED_CONTINUATION_RESULT_SCHEMA,
} from './nbody-packing-localized-challenge.mjs';
import {
  NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
  NBODY_PACKING_RESTORATION_WITNESS_ROUTE,
  NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE,
  NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE,
  NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_WITNESS_ROUTE,
  NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
  renderNBodyPackingLocalizedChallengeHtml,
} from './nbody-packing-localized-witness.mjs';

const STATE_KEYS = Object.freeze([
  'pass-crowded',
  'last-pass',
  'fail-crowded',
  'first-fail',
  'same-basis-feasible',
  'reference',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomically(targetPath, bytes) {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, targetPath);
}

function verifyCanonicalIdentity(value, label) {
  const core = structuredClone(value);
  delete core.identity;
  if (value.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error(`localized hard witness rejects stale ${label} identity`);
  }
}

function validateCurrentScalarRestorationContract(result, iterationBudget) {
  const expectedConfig = createNBodyAllNeighborRestorationConfig();
  expectedConfig.iterationBudget = iterationBudget;
  const candidateKeys = [
    'constraintFamilies',
    'maximumPhysicalResidual',
    'merit',
    'radius',
    'regressedFamilies',
    'rejectionReason',
    'selected',
    'vector',
    'violationEnergy',
  ];
  const candidateRows = result.work?.rows?.flatMap(row => row.candidateReceipts || []) || [];
  if (
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    result.mechanism?.acceptancePolicy !== 'scalar-merit' ||
    candidateRows.length !== result.work?.attempts * expectedConfig.trustRegionRadii.length ||
    candidateRows.some(candidate =>
      JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(candidateKeys) ||
      JSON.stringify(Object.keys(candidate.constraintFamilies || {}).sort()) !==
        JSON.stringify([
          'compartmentEscape',
          'pairwisePenetration',
          'skeletalPenetration',
        ]) ||
      !Array.isArray(candidate.regressedFamilies)
    )
  ) {
    throw new Error('localized hard witness rejects result outside current scalar configuration contract');
  }
}

function validateCurrentCommonDescentContract(result) {
  const expectedConfig = createNBodyFamilyGradientCommonDescentConfig();
  const candidateKeys = [
    'constraintFamilies',
    'maximumPhysicalResidual',
    'radius',
    'regressedFamilies',
    'rejectionReason',
    'selected',
    'vector',
  ];
  if (
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    result.mechanism?.directionBasis !==
      'minimum-norm-convex-combination-of-normalized-family-gradients' ||
    result.mechanism?.nonlinearAcceptance !==
      'no-family-regression-and-lower-maximum-physical-residual' ||
    result.work?.candidateReceipts?.length !== expectedConfig.trustRegionRadii.length ||
    result.work.candidateReceipts.some(candidate =>
      JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(candidateKeys) ||
      JSON.stringify(Object.keys(candidate.constraintFamilies || {}).sort()) !==
        JSON.stringify([
          'compartmentEscape',
          'pairwisePenetration',
          'skeletalPenetration',
        ]) ||
      !Array.isArray(candidate.regressedFamilies)
    )
  ) throw new Error('localized hard witness rejects result outside current common-descent contract');
}

function validateCurrentCommonDescentTrajectoryContract(result) {
  const expectedConfig = createNBodyFamilyGradientCommonDescentTrajectoryConfig({
    iterationBudget:8,
    trustRegionRadii:NBODY_PACKING_REFINED_COMMON_DESCENT_RADII,
  });
  const candidateKeys = [
    'constraintFamilies',
    'maximumPhysicalResidual',
    'radius',
    'regressedFamilies',
    'rejectionReason',
    'selected',
    'vector',
  ];
  const rows = result.work?.rows || [];
  if (
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    result.mechanism?.directionBasis !==
      'recomputed-minimum-norm-convex-combination-of-normalized-family-gradients' ||
    result.mechanism?.nonlinearAcceptance !==
      'no-family-regression-and-lower-maximum-physical-residual' ||
    rows.length !== result.work?.attempts ||
    rows.some(row =>
      row.candidateReceipts?.length !== expectedConfig.trustRegionRadii.length ||
      row.candidateReceipts.some(candidate =>
        JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(candidateKeys) ||
        !Array.isArray(candidate.regressedFamilies)
      )
    )
  ) throw new Error('localized hard witness rejects result outside current common-descent trajectory contract');
}

const COMMON_DESCENT_FAMILY_KEYS = Object.freeze([
  'pairwisePenetration',
  'skeletalPenetration',
  'compartmentEscape',
]);

const FROZEN_ADMITTED_COMMON_DESCENT_SOURCE = Object.freeze({
  resultFileSha256:'dd236d22e8d7287a9739e7e237ab56926b5aa38c830d6416e2595df8b006872b',
  resultSha256:'879cc405832bce8fb6e04ed2360b1a326614402432fe8dbe86da1d0b53a2dd19',
  reportFileSha256:'6c0f07050febb3fbf78aab4b5f423d451c7a467cff7a0bc7ba05e225ed2f48b0',
  reportSha256:'20cbd158b960ce5de258d9dcf6cb40a4512d6ad588838164da17d580d325f4c4',
});

const FROZEN_ADMITTED_COMMON_DESCENT_TRAJECTORY_SOURCE = Object.freeze({
  resultFileSha256:'bcb484441d981ff9f87bc08cfb3b7d1662466b8fff5db448368d674f8f515e1e',
  resultSha256:'ed4975f0c154116a5f9245553d7208778bf0749dfa3223b46d31ed59913bd2e5',
  reportFileSha256:'ec1781373a275bb81c55c970627f6c6f8a9d791692efe17caa474c79562645b8',
  reportSha256:'91e6bf308728bec62117a96389703eb45febc1f087a72368878d744216c9aef7',
});

function requireExactJson(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function commonDescentStateReceipt(state, { includeMuscles = false } = {}) {
  return {
    vector:[...state.vector],
    maximumPhysicalResidual:state.maximumPhysicalResidual,
    metrics:structuredClone(state.metrics),
    ...(includeMuscles ? { muscles:structuredClone(state.muscles) } : {}),
  };
}

function reconstructCommonDescentStepCore({ problem, row, trajectoryConfig }) {
  const config = createNBodyFamilyGradientCommonDescentConfig();
  config.candidateEnumeration = trajectoryConfig.candidateEnumeration;
  config.directionalDerivativeTolerance = trajectoryConfig.directionalDerivativeTolerance;
  config.familyRegressionTolerance = trajectoryConfig.familyRegressionTolerance;
  config.finiteDifferenceStep = trajectoryConfig.finiteDifferenceStep;
  config.translationBounds = [...trajectoryConfig.translationBounds];
  config.trustRegionRadii = [...trajectoryConfig.trustRegionRadii];
  return {
    schema:'kaminos.nbody-packing-family-gradient-common-descent-result.v0',
    status:'common-descent-step-accepted',
    route:{ requested:config.algorithm, effective:config.algorithm, fallbackUsed:false },
    source:{ problemSha256:problem.identity.sha256 },
    config:{ requested:structuredClone(config), effective:structuredClone(config) },
    start:structuredClone(row.before),
    directionConstruction:structuredClone(row.directionConstruction),
    selected:structuredClone(row.after),
    work:{
      iterations:1,
      attempts:1,
      evaluationCount:
        1 + (2 * row.before.vector.length * COMMON_DESCENT_FAMILY_KEYS.length) +
          row.candidateReceipts.length,
      terminalReason:null,
      candidateReceipts:structuredClone(row.candidateReceipts),
    },
    mechanism:{
      directionBasis:'minimum-norm-convex-combination-of-normalized-family-gradients',
      nonlinearAcceptance:'no-family-regression-and-lower-maximum-physical-residual',
      oracleTargetCoordinatesConsumed:false,
      contactGraphRowsConsumed:false,
      carrierDegreesOfFreedomPerMember:problem.carrier.degreesOfFreedomPerMember,
    },
    claimCeiling:
      'bounded-severity-0.32-local-family-gradient-direction-not-global-feasibility-or-carrier-impossibility',
  };
}

function validateCommonDescentTrajectorySemantics({ problem, result }) {
  const tolerance = result.config.effective.familyRegressionTolerance;
  const rows = result.work.rows;
  let previousAfter = result.start;
  for (const [index, row] of rows.entries()) {
    requireExactJson(
      row.before,
      previousAfter,
      `localized hard witness rejects trajectory semantic ledger continuity at iteration ${index + 1}`,
    );
    const beforeState = evaluateNBodyUnifiedKktState({ problem, vector:row.before.vector });
    requireExactJson(
      row.before,
      commonDescentStateReceipt(beforeState),
      `localized hard witness rejects trajectory semantic ledger before state at iteration ${index + 1}`,
    );
    const candidates = row.candidateReceipts.map(candidate => {
      const state = evaluateNBodyUnifiedKktState({ problem, vector:candidate.vector });
      const families = Object.fromEntries(
        COMMON_DESCENT_FAMILY_KEYS.map(key => [key, state.metrics[key]]),
      );
      const regressedFamilies = COMMON_DESCENT_FAMILY_KEYS.filter(
        key => families[key] > row.before.metrics[key] + tolerance,
      );
      if (
        candidate.maximumPhysicalResidual !== state.maximumPhysicalResidual ||
        JSON.stringify(candidate.constraintFamilies) !== JSON.stringify(families) ||
        JSON.stringify(candidate.regressedFamilies) !== JSON.stringify(regressedFamilies)
      ) throw new Error(
        `localized hard witness rejects trajectory semantic ledger candidate at iteration ${index + 1}`,
      );
      return { candidate, state, regressedFamilies };
    });
    const admissible = candidates
      .filter(({ state, regressedFamilies }) =>
        state.maximumPhysicalResidual < row.before.maximumPhysicalResidual - 1e-12 &&
        regressedFamilies.length === 0)
      .sort((left, right) => {
        if (left.state.maximumPhysicalResidual !== right.state.maximumPhysicalResidual) {
          return left.state.maximumPhysicalResidual - right.state.maximumPhysicalResidual;
        }
        return hashMusclePackingCanonicalJson(left.candidate.vector)
          .localeCompare(hashMusclePackingCanonicalJson(right.candidate.vector));
      });
    const selected = candidates.filter(({ candidate }) => candidate.selected);
    if (row.accepted !== true || selected.length !== 1 || selected[0] !== admissible[0]) {
      throw new Error(
        `localized hard witness rejects trajectory semantic ledger selection at iteration ${index + 1}`,
      );
    }
    for (const candidateRow of candidates) {
      const expectedReason = candidateRow === admissible[0]
        ? null
        : candidateRow.regressedFamilies.length > 0
          ? 'constraint-family-regression'
          : !(candidateRow.state.maximumPhysicalResidual <
              row.before.maximumPhysicalResidual - 1e-12)
            ? 'non-improving-physical-residual'
            : 'higher-ranked-admissible-candidate';
      if (candidateRow.candidate.rejectionReason !== expectedReason) {
        throw new Error(
          `localized hard witness rejects trajectory semantic ledger disposition at iteration ${index + 1}`,
        );
      }
    }
    const afterState = evaluateNBodyUnifiedKktState({ problem, vector:row.after.vector });
    requireExactJson(
      row.after,
      commonDescentStateReceipt(afterState, { includeMuscles:true }),
      `localized hard witness rejects trajectory semantic ledger after state at iteration ${index + 1}`,
    );
    requireExactJson(
      row.after,
      commonDescentStateReceipt(selected[0].state, { includeMuscles:true }),
      `localized hard witness rejects trajectory semantic ledger selected state at iteration ${index + 1}`,
    );
    if (
      row.after.maximumPhysicalResidual >= row.before.maximumPhysicalResidual - 1e-12 ||
      COMMON_DESCENT_FAMILY_KEYS.some(key =>
        row.after.metrics[key] > row.before.metrics[key] + tolerance) ||
      row.after.metrics.endpointDrift !== 0 ||
      row.after.metrics.maximumRelativeVolumeError !== 0
    ) throw new Error(
      `localized hard witness rejects trajectory semantic ledger monotonicity at iteration ${index + 1}`,
    );
    const stepCore = reconstructCommonDescentStepCore({
      problem,
      row,
      trajectoryConfig:result.config.effective,
    });
    if (hashMusclePackingCanonicalJson(stepCore) !== row.stepResultSha256) {
      throw new Error(
        `localized hard witness rejects trajectory semantic ledger step receipt at iteration ${index + 1}`,
      );
    }
    previousAfter = {
      vector:[...row.after.vector],
      maximumPhysicalResidual:row.after.maximumPhysicalResidual,
      metrics:structuredClone(row.after.metrics),
    };
  }
  requireExactJson(
    result.selected,
    rows.at(-1).after,
    'localized hard witness rejects trajectory semantic ledger final selection',
  );
  const legacyRadii = createNBodyFamilyGradientCommonDescentConfig().trustRegionRadii;
  const thirdCandidates = rows[2].candidateReceipts;
  const isAdmissible = candidate =>
    candidate.maximumPhysicalResidual < rows[2].before.maximumPhysicalResidual - 1e-12 &&
    candidate.regressedFamilies.length === 0;
  if (
    thirdCandidates.filter(candidate => legacyRadii.includes(candidate.radius)).some(isAdmissible) ||
    ![0.000015625, 0.0000078125].every(radius =>
      thirdCandidates.some(candidate => candidate.radius === radius && isAdmissible(candidate)))
  ) throw new Error('localized hard witness rejects trajectory semantic ledger radius refinement');
}

function validateCommonDescentTrajectoryReport({
  report,
  reportBytes,
  result,
  resultBytes,
  commonDescent,
  commonDescentBytes,
  fixture,
  problem,
}) {
  verifyCanonicalIdentity(report, 'common descent trajectory assay report');
  const expectedStatus = result.status === 'common-descent-trajectory-feasible'
    ? 'complete-refined-trajectory-feasible'
    : result.status === 'common-descent-trajectory-local-floor'
      ? 'complete-refined-trajectory-floor-exposed'
      : 'complete-refined-trajectory-budget-exhausted';
  const admittedSource = report.source?.admittedCommonDescent;
  if (
    sha256(resultBytes) !== FROZEN_ADMITTED_COMMON_DESCENT_TRAJECTORY_SOURCE.resultFileSha256 ||
    result.identity?.sha256 !== FROZEN_ADMITTED_COMMON_DESCENT_TRAJECTORY_SOURCE.resultSha256 ||
    sha256(reportBytes) !== FROZEN_ADMITTED_COMMON_DESCENT_TRAJECTORY_SOURCE.reportFileSha256 ||
    report.identity?.sha256 !== FROZEN_ADMITTED_COMMON_DESCENT_TRAJECTORY_SOURCE.reportSha256 ||
    report.schema !== NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA ||
    report.status !== expectedStatus ||
    JSON.stringify(report.route) !== JSON.stringify(result.route) ||
    report.route?.fallbackUsed !== false ||
    report.source?.fixtureSha256 !== fixture.identity.sha256 ||
    report.source?.problemSha256 !== problem.identity.sha256 ||
    report.bindings?.resultJsonSha256 !== sha256(resultBytes) ||
    report.bindings?.resultSha256 !== result.identity.sha256 ||
    admittedSource?.resultFileSha256 !== sha256(commonDescentBytes) ||
    admittedSource?.resultSha256 !== commonDescent.identity.sha256 ||
    admittedSource?.resultFileSha256 !== FROZEN_ADMITTED_COMMON_DESCENT_SOURCE.resultFileSha256 ||
    admittedSource?.resultSha256 !== FROZEN_ADMITTED_COMMON_DESCENT_SOURCE.resultSha256 ||
    admittedSource?.reportFileSha256 !== FROZEN_ADMITTED_COMMON_DESCENT_SOURCE.reportFileSha256 ||
    admittedSource?.reportSha256 !== FROZEN_ADMITTED_COMMON_DESCENT_SOURCE.reportSha256 ||
    JSON.stringify(report.probe?.trustRegionRadii) !==
      JSON.stringify(result.config.effective.trustRegionRadii) ||
    report.probe?.iterationBudget !== result.config.effective.iterationBudget ||
    report.probe?.acceptedIterations !== result.work.iterations ||
    report.probe?.attemptedIterations !== result.work.attempts ||
    report.claimCeiling !== result.claimCeiling
  ) throw new Error('localized hard witness rejects trajectory report binding: admitted-source manifest mismatch');
  return sha256(reportBytes);
}

export function createPairDebtEmphasisMarkers({ muscles, rows } = {}) {
  const byId = new Map((muscles || []).map(muscle => [muscle.id, muscle]));
  const markers = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (row.kind !== 'pairwise-clearance' || !(row.signedGap < -1e-7)) continue;
    const match = /^pair:(.+):(\d+)\|(.+):(\d+)$/.exec(row.key);
    if (!match) throw new Error(`localized hard witness cannot parse pair row ${row.key}`);
    const [, leftId, leftSegmentText, rightId, rightSegmentText] = match;
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    const leftSegment = Number(leftSegmentText);
    const rightSegment = Number(rightSegmentText);
    if (
      !left?.centerline?.[leftSegment + 1] ||
      !right?.centerline?.[rightSegment + 1]
    ) throw new Error(`localized hard witness cannot bind pair row ${row.key}`);
    const marker = [0, 1, 2].map(axis => (
      left.centerline[leftSegment].position[axis] +
      left.centerline[leftSegment + 1].position[axis] +
      right.centerline[rightSegment].position[axis] +
      right.centerline[rightSegment + 1].position[axis]
    ) / 4);
    const identity = marker.map(value => value.toFixed(9)).join(':');
    if (!seen.has(identity)) {
      seen.add(identity);
      markers.push(marker);
    }
  }
  return markers;
}

function validateSources({ challenge, continuation, pattern, passFixture, failFixture }) {
  verifyCanonicalIdentity(challenge, 'challenge');
  verifyCanonicalIdentity(continuation, 'continuation');
  verifyCanonicalIdentity(pattern, 'pattern-search');
  if (
    challenge.schema !== LOCALIZED_CHALLENGE_RESULT_SCHEMA ||
    challenge.status !== 'complete-boundary-found' ||
    challenge.bracket?.lastPass?.severity !== 0.28 ||
    challenge.bracket?.firstFail?.severity !== 0.32 ||
    challenge.bracket.lastPass.fixtureSha256 !== passFixture?.identity.sha256 ||
    challenge.bracket.firstFail.fixtureSha256 !== failFixture?.identity.sha256
  ) throw new Error('localized hard witness requires the exact 0.28/0.32 bracket');
  const passRow = challenge.rows?.find(
    row => row.fixtureSha256 === challenge.bracket.lastPass.fixtureSha256,
  );
  const passVectorSha256 = passRow?.result?.selected?.vector
    ? hashMusclePackingCanonicalJson(passRow.result.selected.vector)
    : null;
  if (
    continuation.schema !== LOCALIZED_CONTINUATION_RESULT_SCHEMA ||
    continuation.status !== 'complete-stalled' ||
    continuation.route?.effective !== 'same-basis-prior-rung-continuation' ||
    continuation.route?.fallbackUsed !== false ||
    continuation.seed?.effective?.fixtureSha256 !== passFixture.identity.sha256 ||
    continuation.seed?.effective?.resultSha256 !== challenge.bracket.lastPass.resultSha256 ||
    continuation.seed?.effective?.vectorSha256 !== passVectorSha256 ||
    continuation.target?.fixtureSha256 !== failFixture.identity.sha256 ||
    continuation.solverResult?.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    continuation.solverResult?.mechanism?.contactGraphRowsConsumed !== false
  ) throw new Error('localized hard witness rejects substituted continuation route or seed');
  const continuationVectorSha256 = continuation.solverResult?.selected?.vector
    ? hashMusclePackingCanonicalJson(continuation.solverResult.selected.vector)
    : null;
  const patternStartVectorSha256 = Array.isArray(pattern.seedRows?.[0]?.start?.vector)
    ? hashMusclePackingCanonicalJson(pattern.seedRows[0].start.vector)
    : null;
  if (
    pattern.starts?.length !== 1 ||
    pattern.seedRows?.length !== 1 ||
    pattern.starts[0]?.seedIndex !== 0 ||
    pattern.seedRows[0]?.seedIndex !== 0 ||
    pattern.starts[0]?.vectorSha256 !== continuationVectorSha256 ||
    patternStartVectorSha256 !== continuationVectorSha256
  ) {
    throw new Error(
      'localized hard witness pattern-search seed does not bind the continuation result',
    );
  }
  const problem = compileNBodyAdaptiveKktProblem(failFixture);
  if (
    pattern.schema !== 'kaminos.nbody-localized-same-basis-pattern-search.v0' ||
    pattern.status !== 'same-basis-feasibility-unresolved' ||
    pattern.route?.effective !== 'deterministic-coupled-coordinate-pattern-search' ||
    pattern.route?.fallbackUsed !== false ||
    pattern.problemIdentity?.sha256 !== problem.identity.sha256 ||
    pattern.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    pattern.mechanism?.contactGraphRowsConsumed !== false ||
    pattern.selected !== null ||
    !pattern.seedRows?.[0]?.final?.vector
  ) throw new Error('localized hard witness rejects substituted pattern-search evidence');
  return problem;
}

export async function writeNBodyPackingLocalizedHardBoundaryWitness({
  outDir = 'artifacts/nbody-packing-localized-hard-boundary-v0',
  challengeResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/results-after-globalization-repair.json',
  continuationResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/continuation-028-to-032.json',
  patternResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/oracle-pattern-search-032.json',
  restorationResultPath = null,
  trajectoryResultPath = null,
  commonDescentResultPath = null,
  commonDescentTrajectoryResultPath = null,
  commonDescentTrajectoryReportPath = null,
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'read-source-results';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    const [
      challengeBytes,
      continuationBytes,
      patternBytes,
      restorationBytes,
      trajectoryBytes,
      commonDescentBytes,
      commonDescentTrajectoryBytes,
      commonDescentTrajectoryReportBytes,
    ] = await Promise.all([
      readFile(path.resolve(challengeResultPath)),
      readFile(path.resolve(continuationResultPath)),
      readFile(path.resolve(patternResultPath)),
      restorationResultPath ? readFile(path.resolve(restorationResultPath)) : Promise.resolve(null),
      trajectoryResultPath ? readFile(path.resolve(trajectoryResultPath)) : Promise.resolve(null),
      commonDescentResultPath
        ? readFile(path.resolve(commonDescentResultPath))
        : Promise.resolve(null),
      commonDescentTrajectoryResultPath
        ? readFile(path.resolve(commonDescentTrajectoryResultPath))
        : Promise.resolve(null),
      commonDescentTrajectoryReportPath
        ? readFile(path.resolve(commonDescentTrajectoryReportPath))
        : Promise.resolve(null),
    ]);
    const challenge = JSON.parse(String(challengeBytes));
    const continuation = JSON.parse(String(continuationBytes));
    const pattern = JSON.parse(String(patternBytes));
    const restoration = restorationBytes ? JSON.parse(String(restorationBytes)) : null;
    const trajectory = trajectoryBytes ? JSON.parse(String(trajectoryBytes)) : null;
    const commonDescent = commonDescentBytes ? JSON.parse(String(commonDescentBytes)) : null;
    const commonDescentTrajectory = commonDescentTrajectoryBytes
      ? JSON.parse(String(commonDescentTrajectoryBytes))
      : null;
    const commonDescentTrajectoryReport = commonDescentTrajectoryReportBytes
      ? JSON.parse(String(commonDescentTrajectoryReportBytes))
      : null;
    if (trajectory && !restoration) {
      throw new Error('localized hard witness trajectory requires the admitted one-step comparison');
    }
    if (commonDescentTrajectory && !commonDescent) {
      throw new Error('localized hard witness common trajectory requires the admitted one-step comparison');
    }
    if (commonDescentTrajectory && !commonDescentTrajectoryReport) {
      throw new Error('localized hard witness common trajectory requires its source-bound assay report');
    }
    if (commonDescentTrajectoryReport && !commonDescentTrajectory) {
      throw new Error('localized hard witness trajectory assay report requires its result');
    }
    lastTrustworthyEvidence = {
      phase:'source-results-read',
      challengeSha256:sha256(challengeBytes),
      continuationSha256:sha256(continuationBytes),
      patternSha256:sha256(patternBytes),
      restorationSha256:restorationBytes ? sha256(restorationBytes) : null,
      trajectorySha256:trajectoryBytes ? sha256(trajectoryBytes) : null,
      commonDescentSha256:commonDescentBytes ? sha256(commonDescentBytes) : null,
      commonDescentTrajectorySha256:commonDescentTrajectoryBytes
        ? sha256(commonDescentTrajectoryBytes)
        : null,
      commonDescentTrajectoryReportSha256:commonDescentTrajectoryReportBytes
        ? sha256(commonDescentTrajectoryReportBytes)
        : null,
    };
    phase = 'bind-source-identities';
    const suite = createNBodyLocalizedChallengeSuite();
    const passFixture = suite.find(row => row.assayProfile.severity === 0.28);
    const failFixture = suite.find(row => row.assayProfile.severity === 0.32);
    const problem = validateSources({
      challenge, continuation, pattern, passFixture, failFixture,
    });
    if (restoration) {
      verifyCanonicalIdentity(restoration, 'restoration');
      validateCurrentScalarRestorationContract(restoration, 1);
      if (
        restoration.schema !== 'kaminos.nbody-packing-all-neighbor-restoration-result.v0' ||
        restoration.status !== 'restoration-floor-improved' ||
        restoration.route?.effective !== 'all-neighbor-p8-merit-trust-region-restoration-v0' ||
        restoration.route?.fallbackUsed !== false ||
        restoration.source?.problemSha256 !== problem.identity.sha256 ||
        restoration.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        restoration.mechanism?.contactGraphRowsConsumed !== false ||
        restoration.invariance?.candidateEnumeration !== 'passed' ||
        restoration.start?.maximumPhysicalResidual !== 0.004815758612 ||
        restoration.selected?.maximumPhysicalResidual !== 0.00447138638
      ) throw new Error('localized hard witness rejects substituted restoration evidence');
    }
    if (trajectory) {
      verifyCanonicalIdentity(trajectory, 'restoration trajectory');
      validateCurrentScalarRestorationContract(trajectory, 6);
      if (
        trajectory.schema !== 'kaminos.nbody-packing-all-neighbor-restoration-result.v0' ||
        trajectory.status !== 'restoration-floor-improved' ||
        trajectory.route?.effective !== 'all-neighbor-p8-merit-trust-region-restoration-v0' ||
        trajectory.route?.fallbackUsed !== false ||
        trajectory.source?.problemSha256 !== problem.identity.sha256 ||
        trajectory.config?.effective?.iterationBudget !== 6 ||
        trajectory.work?.iterations !== 5 ||
        trajectory.work?.attempts !== 6 ||
        trajectory.work?.rows?.length !== 6 ||
        trajectory.work.rows.slice(0, -1).some(row => row.accepted !== true) ||
        trajectory.work.rows.at(-1)?.accepted !== false ||
        trajectory.work.rows.at(-1)?.terminalReason !==
          'no-admissible-trust-region-candidate' ||
        trajectory.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        trajectory.mechanism?.contactGraphRowsConsumed !== false ||
        trajectory.invariance?.candidateEnumeration !== 'passed' ||
        trajectory.start?.maximumPhysicalResidual !== 0.004815758612 ||
        trajectory.selected?.maximumPhysicalResidual !== 0.00311519149 ||
        !(trajectory.selected?.maximumPhysicalResidual <
          restoration.selected.maximumPhysicalResidual)
      ) throw new Error('localized hard witness rejects substituted restoration trajectory');
    }
    if (commonDescent) {
      verifyCanonicalIdentity(commonDescent, 'common descent');
      validateCurrentCommonDescentContract(commonDescent);
      if (
        commonDescent.schema !==
          'kaminos.nbody-packing-family-gradient-common-descent-result.v0' ||
        commonDescent.status !== 'common-descent-step-accepted' ||
        commonDescent.route?.effective !==
          'family-gradient-minimum-norm-common-descent-v0' ||
        commonDescent.route?.fallbackUsed !== false ||
        commonDescent.source?.problemSha256 !== problem.identity.sha256 ||
        commonDescent.start?.maximumPhysicalResidual !== 0.004815758612 ||
        commonDescent.selected?.maximumPhysicalResidual !== 0.004745541883 ||
        commonDescent.directionConstruction?.predictedCommonDescent !== true ||
        commonDescent.work?.iterations !== 1 ||
        commonDescent.work?.attempts !== 1 ||
        commonDescent.work.candidateReceipts.filter(candidate => candidate.selected).length !== 1 ||
        commonDescent.work.candidateReceipts.find(candidate => candidate.selected)?.radius !==
          0.00025 ||
        commonDescent.work.candidateReceipts.find(candidate => candidate.selected)
          ?.regressedFamilies.length !== 0 ||
        commonDescent.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        commonDescent.mechanism?.contactGraphRowsConsumed !== false
      ) throw new Error('localized hard witness rejects substituted common-descent evidence');
    }
    if (commonDescentTrajectory) {
      verifyCanonicalIdentity(commonDescentTrajectory, 'common descent trajectory');
      validateCurrentCommonDescentTrajectoryContract(commonDescentTrajectory);
      if (
        commonDescentTrajectory.schema !==
          'kaminos.nbody-packing-family-gradient-common-descent-trajectory-result.v0' ||
        commonDescentTrajectory.status !== 'common-descent-trajectory-budget-exhausted' ||
        commonDescentTrajectory.route?.effective !==
          'family-gradient-minimum-norm-common-descent-trajectory-v0' ||
        commonDescentTrajectory.route?.fallbackUsed !== false ||
        commonDescentTrajectory.source?.problemSha256 !== problem.identity.sha256 ||
        commonDescentTrajectory.start?.maximumPhysicalResidual !== 0.004815758612 ||
        commonDescentTrajectory.selected?.maximumPhysicalResidual !== 0.004722809214 ||
        commonDescentTrajectory.work?.iterations !== 8 ||
        commonDescentTrajectory.work?.attempts !== 8 ||
        commonDescentTrajectory.work.rows.some(row => row.accepted !== true) ||
        commonDescentTrajectory.work.rows.some(row =>
          row.directionConstruction?.predictedCommonDescent !== true ||
          row.candidateReceipts.filter(candidate => candidate.selected).length !== 1 ||
          row.candidateReceipts.find(candidate => candidate.selected)
            ?.regressedFamilies.length !== 0
        ) ||
        commonDescentTrajectory.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        commonDescentTrajectory.mechanism?.contactGraphRowsConsumed !== false
      ) throw new Error('localized hard witness rejects substituted common-descent trajectory evidence');
      validateCommonDescentTrajectoryReport({
        report:commonDescentTrajectoryReport,
        reportBytes:commonDescentTrajectoryReportBytes,
        result:commonDescentTrajectory,
        resultBytes:commonDescentTrajectoryBytes,
        commonDescent,
        commonDescentBytes,
        fixture:failFixture,
        problem,
      });
      validateCommonDescentTrajectorySemantics({ problem, result:commonDescentTrajectory });
    }
    const passRow = challenge.rows.find(row => row.fixtureSha256 === passFixture.identity.sha256);
    const failRow = challenge.rows.find(row => row.fixtureSha256 === failFixture.identity.sha256);
    if (!passRow || !failRow) {
      throw new Error('localized hard witness cannot bind bracket result rows');
    }
    const patternState = evaluateNBodyUnifiedKktState({
      problem,
      vector:pattern.seedRows[0].final.vector,
    });
    const crowdedState = evaluateNBodyUnifiedKktState({
      problem,
      vector:Array(problem.variables.length).fill(0),
    });
    const coldState = evaluateNBodyUnifiedKktState({
      problem,
      vector:failRow.result.selected.vector,
    });
    const warmState = evaluateNBodyUnifiedKktState({
      problem,
      vector:continuation.solverResult.selected.vector,
    });
    const restorationState = restoration ? evaluateNBodyUnifiedKktState({
      problem,
      vector:restoration.selected.vector,
    }) : null;
    const trajectoryState = trajectory ? evaluateNBodyUnifiedKktState({
      problem,
      vector:trajectory.selected.vector,
    }) : null;
    const commonDescentState = commonDescent ? evaluateNBodyUnifiedKktState({
      problem,
      vector:commonDescent.selected.vector,
    }) : null;
    const commonDescentTrajectoryState = commonDescentTrajectory
      ? evaluateNBodyUnifiedKktState({
          problem,
          vector:commonDescentTrajectory.selected.vector,
        })
      : null;
    if (
      restorationState &&
      restorationState.maximumPhysicalResidual !== restoration.selected.maximumPhysicalResidual
    ) throw new Error('localized hard witness rejects stale restoration metrics');
    if (
      trajectoryState &&
      trajectoryState.maximumPhysicalResidual !== trajectory.selected.maximumPhysicalResidual
    ) throw new Error('localized hard witness rejects stale restoration trajectory metrics');
    if (
      commonDescentState &&
      commonDescentState.maximumPhysicalResidual !==
        commonDescent.selected.maximumPhysicalResidual
    ) throw new Error('localized hard witness rejects stale common-descent metrics');
    if (
      commonDescentTrajectoryState &&
      commonDescentTrajectoryState.maximumPhysicalResidual !==
        commonDescentTrajectory.selected.maximumPhysicalResidual
    ) throw new Error('localized hard witness rejects stale common-descent trajectory metrics');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'source-identities-bound',
      problemSha256:problem.identity.sha256,
    };
    phase = 'write-primary';
    const fixtures = { lastPass:passFixture, firstFail:failFixture };
    const comparison = {
      challenge,
      continuation,
      pattern,
      ...(restoration ? { restoration } : {}),
      ...(trajectory ? { trajectory } : {}),
      ...(commonDescent ? { commonDescent } : {}),
      ...(commonDescentTrajectory ? { commonDescentTrajectory } : {}),
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const warmTraversalInvariant =
      continuation.solverResult.invariance.candidateEnumeration === 'passed';
    const states = {
      'pass-crowded': {
        label:'0.32 crowded input', severity:0.32, status:'input', warning:true,
        source:failFixture.crowded, muscles:failFixture.crowded.muscles,
        metrics:failFixture.metrics.crowded,
        emphasisMarkers:createPairDebtEmphasisMarkers(crowdedState),
        truth:'The manufactured hard input begins with gross localized pair, bone, and wall debt.',
      },
      'last-pass': {
        label:'0.28 last pass', severity:0.28, status:passRow.result.status, warning:false,
        source:passFixture.crowded, muscles:passRow.result.selected.muscles,
        metrics:passRow.result.selected.metrics,
        truth:'The unchanged frozen solver clears every hard residual one rung earlier at severity 0.28.',
      },
      'fail-crowded': {
        label:'0.32 cold failure', severity:0.32, status:failRow.result.status, warning:true,
        source:failFixture.crowded, muscles:failRow.result.selected.muscles,
        metrics:failRow.result.selected.metrics,
        emphasisMarkers:createPairDebtEmphasisMarkers(coldState),
        truth:'Cold-start failure: after one accepted move, gross skeletal, pair, and compartment debt remains.',
      },
      'first-fail': {
        label:'0.32 warm-start stall', severity:0.32,
        status:continuation.solverResult.status, warning:true,
        source:failFixture.crowded,
        muscles:continuation.solverResult.selected.muscles,
        metrics:continuation.solverResult.selected.metrics,
        emphasisMarkers:createPairDebtEmphasisMarkers(warmState),
        truth:warmTraversalInvariant
          ? 'The exact 0.28 result seeds 0.32 and sharply reduces maximum debt, then stalls at the same residual under both constraint traversals.'
          : 'The exact 0.28 result seeds 0.32 and sharply reduces maximum debt, then stalls with traversal sensitivity.',
      },
      'same-basis-feasible': {
        label:'0.32 coordinate-search floor', severity:0.32,
        status:pattern.status, warning:true,
        source:failFixture.crowded,
        muscles:patternState.muscles,
        metrics:patternState.metrics,
        emphasisMarkers:createPairDebtEmphasisMarkers(patternState),
        truth:'Independent same-basis coordinate search descends further but does not clear debt. Representation feasibility remains unresolved.',
      },
      ...(restoration ? {
        'all-neighbor-restoration': {
          label:'0.32 all-neighbor restoration', severity:0.32,
          status:restoration.status, warning:true,
          source:failFixture.crowded,
          muscles:restorationState.muscles,
          metrics:restorationState.metrics,
          emphasisMarkers:createPairDebtEmphasisMarkers(restorationState),
          truth:'One simultaneous scalar-merit direction lowers the compiled-row maximum residual without oracle coordinates or a contact graph, while increasing skeletal debt. Residual debt and family trading remain.',
        },
      } : {}),
      ...(trajectory ? {
        'repeated-all-neighbor-restoration': {
          label:'0.32 repeated all-neighbor restoration', severity:0.32,
          status:trajectory.status, warning:true,
          source:failFixture.crowded,
          muscles:trajectoryState.muscles,
          metrics:trajectoryState.metrics,
          emphasisMarkers:createPairDebtEmphasisMarkers(trajectoryState),
          truth:'Five deterministic simultaneous all-neighbor steps lower the maximum residual before the sixth attempt stalls, but scalar merit increases pair debt above its starting value. This is a debt-trading failure, not convergence or feasibility.',
        },
      } : {}),
      ...(commonDescent ? {
        'family-common-descent': {
          label:'0.32 family-gradient common descent', severity:0.32,
          status:commonDescent.status, warning:true,
          source:failFixture.crowded,
          muscles:commonDescentState.muscles,
          metrics:commonDescentState.metrics,
          emphasisMarkers:createPairDebtEmphasisMarkers(commonDescentState),
          truth:'One minimum-norm combination of independent pair, bone, and compartment gradients lowers every tracked family at the selected small radius. Four larger radii correctly fail because they increase compiled compartment debt. This is a bounded synthetic mechanism result, not feasibility or anatomy.',
        },
      } : {}),
      ...(commonDescentTrajectory ? {
        'repeated-family-common-descent': {
          label:'0.32 repeated family-gradient common descent', severity:0.32,
          status:commonDescentTrajectory.status, warning:true,
          source:failFixture.crowded,
          muscles:commonDescentTrajectoryState.muscles,
          metrics:commonDescentTrajectoryState.metrics,
          emphasisMarkers:createPairDebtEmphasisMarkers(commonDescentTrajectoryState),
          truth:'Eight recomputed common-descent steps lower every compiled constraint family. Refining the radius ladder admits the previously rejected third direction, disproving the coarse local-floor classification; the six later minimum-radius steps expose inefficient step control rather than carrier impossibility.',
        },
      } : {}),
      reference: {
        label:'Manufactured feasibility witness', severity:null,
        status:'existence witness outside candidate carrier', warning:false,
        source:failFixture.knownFeasible,
        muscles:failFixture.knownFeasible.muscles,
        metrics:failFixture.metrics.knownFeasible,
        truth:'This withheld manufactured state proves fixture feasibility, not feasibility in the frozen two-mode candidate carrier.',
      },
    };
    const orderedStates = [
      ...STATE_KEYS.slice(0, -1),
      ...(restoration ? ['all-neighbor-restoration'] : []),
      ...(trajectory ? ['repeated-all-neighbor-restoration'] : []),
      ...(commonDescent ? ['family-common-descent'] : []),
      ...(commonDescentTrajectory ? ['repeated-family-common-descent'] : []),
      'reference',
    ];
    const witnessRoute = commonDescentTrajectory
      ? NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_WITNESS_ROUTE
      : commonDescent
        ? NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE
      : trajectory
        ? NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE
      : restoration
        ? NBODY_PACKING_RESTORATION_WITNESS_ROUTE
        : NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE;
    const display = {
      title:commonDescentTrajectory
        ? 'Repeated family-gradient common descent · six-body hard boundary'
        : commonDescent
          ? 'Family-gradient common descent · six-body hard boundary'
        : trajectory
          ? 'Repeated all-neighbor restoration · six-body hard boundary'
          : restoration
            ? 'All-neighbor restoration · six-body hard boundary'
        : 'Localized hard boundary · six bodies',
      authority:'Synthetic two-obstacle mechanism falsifier · no anatomical admission',
      explanation:commonDescentTrajectory
        ? 'Severity 0.32 creates a gross cold failure. Recomputing the <strong>minimum-norm family-gradient common direction</strong> and refining the trust-radius ladder admits eight family-monotone steps. The formerly reported third-step floor disappears, proving it was radius discretization; six subsequent minimum-radius steps make the remaining step-control inefficiency visible. This is a bounded mechanism result, not feasibility or anatomical admission.'
        : commonDescent
          ? 'Severity 0.32 creates a gross cold failure. The scalar direction can trade debt and the strict family filter stalls on that direction. A new <strong>minimum-norm combination of independent family gradients</strong> admits a small step that lowers all compiled constraint families; larger steps remain visibly rejected for compartment regression. This is a bounded mechanism advance, not feasibility or anatomical admission.'
        : trajectory
          ? 'Severity 0.32 creates a gross cold failure. Compare the admitted one-step state with five accepted <strong>simultaneous all-neighbor restoration</strong> steps and the failed sixth attempt. The compiled-row maximum descends, but scalar merit increases pairwise debt above its start value. This exposes a debt-trading failure and motivates constraint-family-aware acceptance.'
          : restoration
            ? 'Severity 0.32 creates a gross cold failure. The new state applies one <strong>simultaneous all-neighbor restoration direction</strong> and lowers the compiled-row maximum residual, while increasing skeletal debt. This is a mechanism advance and a debt-trading witness, not feasibility or optimality closure.'
            : 'Severity 0.32 creates a gross cold failure. Exact 0.28 continuation and an independent same-basis coordinate search reduce the debt by roughly two orders of magnitude but do not clear it. This establishes a <strong>globalization defect</strong>; it does <strong>not</strong> yet establish a carrier representation limit.',
      orderedStates,
      defaultState:'fail-crowded',
    };
    const payload = {
      states,
      display,
      environment:{
        compartment:failFixture.knownFeasible.compartment,
        obstacles:failFixture.knownFeasible.obstacles,
      },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:witnessRoute,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:witnessRoute,
        effective:witnessRoute,
        fallbackUsed:false,
      },
      bracket:structuredClone(challenge.bracket),
      classification: {
        coldMaximumPhysicalResidual:failRow.result.selected.maximumPhysicalResidual,
        warmMaximumPhysicalResidual:
          continuation.solverResult.selected.maximumPhysicalResidual,
        patternMaximumPhysicalResidual:patternState.maximumPhysicalResidual,
        patternStatus:pattern.status,
        traversalInvariance:continuation.solverResult.invariance.candidateEnumeration,
        ...(restoration ? {
          restorationMaximumPhysicalResidual:
            restoration.selected.maximumPhysicalResidual,
          restorationVersusCoordinateFloor:
            patternState.maximumPhysicalResidual / restoration.selected.maximumPhysicalResidual,
        } : {}),
        ...(trajectory ? {
          trajectoryMaximumPhysicalResidual:
            trajectory.selected.maximumPhysicalResidual,
          trajectoryVersusOneStep:
            restoration.selected.maximumPhysicalResidual /
              trajectory.selected.maximumPhysicalResidual,
          trajectoryAcceptedIterations:trajectory.work.iterations,
        } : {}),
        ...(commonDescent ? {
          commonDescentMaximumPhysicalResidual:
            commonDescent.selected.maximumPhysicalResidual,
          commonDescentVersusCompiledRowStart:
            commonDescent.start.maximumPhysicalResidual /
              commonDescent.selected.maximumPhysicalResidual,
          ...(restoration ? {
            commonDescentVersusScalarOneStep:
              restoration.selected.maximumPhysicalResidual /
                commonDescent.selected.maximumPhysicalResidual,
          } : {}),
          commonDescentSelectedRadius:
            commonDescent.work.candidateReceipts.find(candidate => candidate.selected)?.radius,
          commonDescentRegressingCandidateCount:
            commonDescent.work.candidateReceipts.filter(
              candidate => candidate.regressedFamilies.length > 0,
            ).length,
        } : {}),
        ...(commonDescentTrajectory ? {
          commonDescentTrajectoryMaximumPhysicalResidual:
            commonDescentTrajectory.selected.maximumPhysicalResidual,
          commonDescentTrajectoryAcceptedIterations:
            commonDescentTrajectory.work.iterations,
          commonDescentTrajectoryMinimumRadiusSelections:
            commonDescentTrajectory.work.rows.filter(row =>
              row.candidateReceipts.find(candidate => candidate.selected)?.radius ===
                NBODY_PACKING_REFINED_COMMON_DESCENT_RADII.at(-1)
            ).length,
          commonDescentTrajectoryVersusOneStep:
            commonDescent.selected.maximumPhysicalResidual /
              commonDescentTrajectory.selected.maximumPhysicalResidual,
        } : {}),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        challengeResultSha256:sha256(challengeBytes),
        continuationResultSha256:sha256(continuationBytes),
        patternResultSha256:sha256(patternBytes),
        ...(restorationBytes ? { restorationResultSha256:sha256(restorationBytes) } : {}),
        ...(trajectoryBytes ? { trajectoryResultSha256:sha256(trajectoryBytes) } : {}),
        ...(commonDescentBytes ? {
          commonDescentResultSha256:sha256(commonDescentBytes),
        } : {}),
        ...(commonDescentTrajectoryBytes ? {
          commonDescentTrajectoryResultSha256:sha256(commonDescentTrajectoryBytes),
          commonDescentTrajectoryReportSha256:sha256(commonDescentTrajectoryReportBytes),
          commonDescentTrajectoryReportIdentitySha256:
            commonDescentTrajectoryReport.identity.sha256,
        } : {}),
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling: {
        admittedClaim:commonDescentTrajectory
          ? 'eight recomputed family-gradient common-descent steps lower every compiled constraint family from the severity-0.32 start while retaining exact attachment and volume invariants; extending the trust-radius ladder admits the formerly rejected third direction and therefore proves the prior local-floor classification was a coarse radius-ladder artifact, while six subsequent minimum-radius selections expose unresolved step-control inefficiency'
          : commonDescent
            ? 'one deterministic minimum-norm combination of independent constraint-family gradients on severity 0.32 admits a radius-0.00025 step that lowers all compiled constraint-family maxima from 0.004815758612 to 0.004745541883 while retaining exact attachment and volume invariants; four larger tested radii are rejected for compiled compartment regression'
          : trajectory
            ? 'five deterministic simultaneous all-neighbor restoration steps on severity 0.32 lower the compiled-row maximum residual before the sixth attempt stalls, while scalar merit increases pairwise debt above its start value; scalar-merit repetition therefore fails the no-debt-trading architecture predicate'
          : restoration
            ? 'one simultaneous all-neighbor restoration step on severity 0.32 lowers the compiled-row maximum residual while retaining exact attachment and volume invariants'
          : 'severity 0.32 exposes a gross cold-start globalization failure and an unresolved same-basis residual floor after continuation and coordinate search',
        anatomicalAdmission:'none',
        nonGoals:[
          'same-basis-representation-impossibility',
          'arbitrary-N-closure',
          'anatomical-plausibility',
          'performance',
          'optimality',
        ],
      },
    };
    const report = {
      ...reportCore,
      identity:{ sha256:sha256(jsonBytes(reportCore)) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'fixtures.json'), fixtureBytes),
      writeAtomically(path.join(outputRoot, 'comparison.json'), comparisonBytes),
      writeAtomically(path.join(outputRoot, 'index.html'), htmlBytes),
      writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, report, states };
  } catch (error) {
    const requestedRoute = commonDescentTrajectoryResultPath
      ? NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_WITNESS_ROUTE
      : commonDescentResultPath
        ? NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE
      : trajectoryResultPath
        ? NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE
      : restorationResultPath
        ? NBODY_PACKING_RESTORATION_WITNESS_ROUTE
        : NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE;
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:requestedRoute,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-localized-hard-boundary-v0';
  const restorationResultPath = process.argv[3] || null;
  const trajectoryResultPath = process.argv[4] || null;
  const commonDescentResultPath = process.argv[5] || null;
  const commonDescentTrajectoryResultPath = process.argv[6] || null;
  const commonDescentTrajectoryReportPath = process.argv[7] || null;
  const result = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath,
    trajectoryResultPath,
    commonDescentResultPath,
    commonDescentTrajectoryResultPath,
    commonDescentTrajectoryReportPath,
  });
  process.stdout.write(`${JSON.stringify({
    outputRoot:result.outputRoot,
    report:result.report,
  }, null, 2)}\n`);
}
