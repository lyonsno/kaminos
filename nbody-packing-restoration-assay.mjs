#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  evaluateNBodyUnifiedKktState,
} from './nbody-packing-unified-kkt.mjs';
import {
  createNBodyAllNeighborRestorationConfig,
  createNBodyFamilyGradientCommonDescentConfig,
  createNBodyFamilyGradientCommonDescentTrajectoryConfig,
  solveNBodyAllNeighborRestoration,
  solveNBodyFamilyGradientCommonDescent,
  solveNBodyFamilyGradientCommonDescentTrajectory,
} from './nbody-packing-restoration.mjs';

export const NBODY_PACKING_RESTORATION_ASSAY_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-assay.v0';
export const NBODY_PACKING_COMMON_DESCENT_ASSAY_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-assay.v0';
export const NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-trajectory-assay.v0';

export const NBODY_PACKING_REFINED_COMMON_DESCENT_RADII = Object.freeze([
  0.004,
  0.002,
  0.001,
  0.0005,
  0.00025,
  0.000125,
  0.0000625,
  0.00003125,
  0.000015625,
  0.0000078125,
]);

const FROZEN_ADMITTED_COMMON_DESCENT = Object.freeze({
  resultFileSha256:'dd236d22e8d7287a9739e7e237ab56926b5aa38c830d6416e2595df8b006872b',
  resultSha256:'879cc405832bce8fb6e04ed2360b1a326614402432fe8dbe86da1d0b53a2dd19',
  reportFileSha256:'6c0f07050febb3fbf78aab4b5f423d451c7a467cff7a0bc7ba05e225ed2f48b0',
  reportSha256:'20cbd158b960ce5de258d9dcf6cb40a4512d6ad588838164da17d580d325f4c4',
});

const FROZEN_BASELINES = Object.freeze({
  pattern:Object.freeze({
    fileSha256:'56d597089c7dc3a96cd7a158717ee92072e5c3349e0a3c489a9f88fd9f15953b',
    resultSha256:'a697e6567f88d34ba7f8e78b60bbfa188d89e0e896be1b704a11017658d1bb93',
  }),
  homotopy:Object.freeze({
    fileSha256:'57f08fe1090d059bc250093522463579050af2ab66db491d39ffdacc15a67736',
    resultSha256:'cfaede5e816f6dfc04b2e99230b9d47f2a093c8cda8b393ecb563610184daa2b',
  }),
});

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

async function invalidatePriorPrimary(outputRoot) {
  try {
    await unlink(path.join(outputRoot, 'result.json'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function verifyCanonicalIdentity(value, label) {
  const core = structuredClone(value);
  delete core.identity;
  if (value.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error(`restoration assay rejects stale ${label} identity`);
  }
}

function verifyFrozenBaseline(bytes, value, expected, label) {
  if (
    sha256(bytes) !== expected.fileSha256 ||
    value.identity?.sha256 !== expected.resultSha256
  ) throw new Error(`restoration assay rejects substituted ${label}`);
}

export async function runNBodyPackingRestorationAssay({
  outDir = 'artifacts/nbody-packing-all-neighbor-restoration-v0',
  patternResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/oracle-pattern-search-032.json',
  homotopyResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/homotopy-032-fine-0875-to-1.json',
  iterationBudget = 1,
  acceptancePolicy = 'scalar-merit',
} = {}) {
  const outputRoot = path.resolve(outDir);
  const requestedRoute = acceptancePolicy === 'family-pareto-no-resurrection'
    ? 'all-neighbor-p8-family-filter-restoration-v0'
    : acceptancePolicy === 'scalar-merit'
      ? 'all-neighbor-p8-merit-trust-region-restoration-v0'
      : `unsupported-acceptance-policy:${String(acceptancePolicy)}`;
  let phase = 'read-frozen-inputs';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    phase = 'invalidate-prior-primary';
    await invalidatePriorPrimary(outputRoot);
    phase = 'read-frozen-inputs';
    const [patternBytes, homotopyBytes] = await Promise.all([
      readFile(path.resolve(patternResultPath)),
      readFile(path.resolve(homotopyResultPath)),
    ]);
    const pattern = JSON.parse(String(patternBytes));
    const homotopy = JSON.parse(String(homotopyBytes));
    verifyCanonicalIdentity(pattern, 'coordinate-search result');
    verifyCanonicalIdentity(homotopy, 'homotopy result');
    lastTrustworthyEvidence = {
      phase:'frozen-inputs-read',
      patternFileSha256:sha256(patternBytes),
      homotopyFileSha256:sha256(homotopyBytes),
    };
    phase = 'bind-problem-and-baselines';
    verifyFrozenBaseline(
      patternBytes,
      pattern,
      FROZEN_BASELINES.pattern,
      'coordinate-search floor',
    );
    verifyFrozenBaseline(
      homotopyBytes,
      homotopy,
      FROZEN_BASELINES.homotopy,
      'homotopy floor',
    );
    const fixture = createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const patternFloor = pattern.seedRows?.[0]?.final;
    const homotopyFloor = homotopy.stages?.at(-1)?.solverResult?.selected;
    if (
      pattern.schema !== 'kaminos.nbody-localized-same-basis-pattern-search.v0' ||
      pattern.status !== 'same-basis-feasibility-unresolved' ||
      pattern.route?.effective !== 'deterministic-coupled-coordinate-pattern-search' ||
      pattern.route?.fallbackUsed !== false ||
      pattern.problemIdentity?.sha256 !== problem.identity.sha256 ||
      pattern.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      pattern.mechanism?.contactGraphRowsConsumed !== false ||
      pattern.starts?.length !== 1 ||
      pattern.seedRows?.length !== 1 ||
      pattern.selected !== null ||
      patternFloor?.maximumPhysicalResidual !== 0.001615326586
    ) throw new Error('restoration assay rejects substituted coordinate-search floor');
    if (
      homotopy.schema !== 'kaminos.nbody-localized-constraint-homotopy-result.v0' ||
      homotopy.status !== 'complete-stalled-before-full-clearance' ||
      homotopy.route?.effective !== 'compiled-problem-clearance-homotopy' ||
      homotopy.route?.fallbackUsed !== false ||
      homotopy.source?.fixtureSha256 !== fixture.identity.sha256 ||
      homotopy.source?.problemSha256 !== problem.identity.sha256 ||
      homotopyFloor?.maximumPhysicalResidual !== 0.000945973079
    ) throw new Error('restoration assay rejects substituted homotopy floor');
    const patternEffective = evaluateNBodyUnifiedKktState({
      problem,
      vector:patternFloor.vector,
    });
    const homotopyEffective = evaluateNBodyUnifiedKktState({
      problem,
      vector:homotopyFloor.vector,
    });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'problem-and-baselines-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      patternResultSha256:pattern.identity.sha256,
      homotopyResultSha256:homotopy.identity.sha256,
      patternEffectiveMaximumPhysicalResidual:patternEffective.maximumPhysicalResidual,
      homotopyEffectiveMaximumPhysicalResidual:homotopyEffective.maximumPhysicalResidual,
    };
    phase = 'solve-all-neighbor-restoration';
    const requestedConfig = createNBodyAllNeighborRestorationConfig({ acceptancePolicy });
    requestedConfig.iterationBudget = iterationBudget;
    const result = solveNBodyAllNeighborRestoration({
      problem,
      startVector:patternFloor.vector,
      requestedConfig,
    });
    phase = 'verify-restoration-result';
    const scalarAdmission = acceptancePolicy === 'scalar-merit' &&
      result.status === 'restoration-floor-improved' &&
      result.selected.maximumPhysicalResidual < patternEffective.maximumPhysicalResidual;
    const familyAdmission = acceptancePolicy === 'family-pareto-no-resurrection' &&
      result.status === 'stalled-family-filter-restoration' &&
      result.work.iterations === 0 &&
      result.work.attempts === 1 &&
      result.work.rows?.length === 1 &&
      result.work.rows[0].accepted === false &&
      result.work.rows[0].terminalReason === 'no-admissible-trust-region-candidate' &&
      result.work.rows[0].candidateReceipts?.length ===
        requestedConfig.trustRegionRadii.length &&
      result.work.rows[0].candidateReceipts.every(candidate =>
        candidate.selected === false &&
        candidate.rejectionReason !== 'higher-ranked-admissible-candidate' &&
        candidate.constraintFamilies &&
        Array.isArray(candidate.regressedFamilies)
      ) &&
      JSON.stringify(result.selected.vector) === JSON.stringify(result.start.vector) &&
      result.selected.maximumPhysicalResidual === patternEffective.maximumPhysicalResidual;
    if (
      result.route.requested !== requestedRoute ||
      result.route.effective !== requestedRoute ||
      result.route.fallbackUsed !== false ||
      result.source.problemSha256 !== problem.identity.sha256 ||
      result.start.maximumPhysicalResidual !== patternEffective.maximumPhysicalResidual ||
      !(scalarAdmission || familyAdmission) ||
      result.mechanism.oracleTargetCoordinatesConsumed !== false ||
      result.mechanism.contactGraphRowsConsumed !== false ||
      result.invariance.candidateEnumeration !== 'passed'
    ) throw new Error('restoration assay result did not clear its exact admission predicate');
    phase = 'write-terminal-artifacts';
    const resultBytes = jsonBytes(result);
    const reportCore = {
      schema:NBODY_PACKING_RESTORATION_ASSAY_SCHEMA,
      status:acceptancePolicy === 'family-pareto-no-resurrection'
        ? 'complete-family-filter-floor-exposed'
        : 'complete-mechanism-floor-improved',
      route:structuredClone(result.route),
      source:{
        fixtureSha256:fixture.identity.sha256,
        problemSha256:problem.identity.sha256,
        pattern:{ path:patternResultPath, fileSha256:sha256(patternBytes), resultSha256:pattern.identity.sha256 },
        homotopy:{ path:homotopyResultPath, fileSha256:sha256(homotopyBytes), resultSha256:homotopy.identity.sha256 },
      },
      comparison:{
        sourceReported:{
          coordinateSearchFloor:patternFloor.maximumPhysicalResidual,
          homotopyFloor:homotopyFloor.maximumPhysicalResidual,
          authority:'historical-sampled-metrics-not-used-for-admission',
        },
        effectiveCompiledRows:{
          coordinateSearchFloor:patternEffective.maximumPhysicalResidual,
          homotopyFloor:homotopyEffective.maximumPhysicalResidual,
          authority:'compiled-constraint-row-family-maxima',
        },
        restorationResidual:result.selected.maximumPhysicalResidual,
        improvementVersusCoordinateSearch:
          patternEffective.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
        improvementVersusHomotopy:
          homotopyEffective.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
      },
      bindings:{ resultJsonSha256:sha256(resultBytes), resultSha256:result.identity.sha256 },
      claimCeiling:result.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'result.json'), resultBytes),
      writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, result, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_RESTORATION_ASSAY_SCHEMA,
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
    await writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(failure));
    throw error;
  }
}

export async function runNBodyPackingCommonDescentAssay({
  outDir = 'artifacts/nbody-packing-family-gradient-common-descent-v0',
  patternResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/oracle-pattern-search-032.json',
  homotopyResultPath =
    'artifacts/nbody-packing-localized-challenge-v0/homotopy-032-fine-0875-to-1.json',
} = {}) {
  const outputRoot = path.resolve(outDir);
  const requestedRoute = 'family-gradient-minimum-norm-common-descent-v0';
  let phase = 'read-frozen-inputs';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    phase = 'invalidate-prior-primary';
    await invalidatePriorPrimary(outputRoot);
    phase = 'read-frozen-inputs';
    const [patternBytes, homotopyBytes] = await Promise.all([
      readFile(path.resolve(patternResultPath)),
      readFile(path.resolve(homotopyResultPath)),
    ]);
    const pattern = JSON.parse(String(patternBytes));
    const homotopy = JSON.parse(String(homotopyBytes));
    verifyCanonicalIdentity(pattern, 'coordinate-search result');
    verifyCanonicalIdentity(homotopy, 'homotopy result');
    lastTrustworthyEvidence = {
      phase:'frozen-inputs-read',
      patternFileSha256:sha256(patternBytes),
      homotopyFileSha256:sha256(homotopyBytes),
    };
    phase = 'bind-problem-and-baselines';
    verifyFrozenBaseline(
      patternBytes,
      pattern,
      FROZEN_BASELINES.pattern,
      'coordinate-search floor',
    );
    verifyFrozenBaseline(
      homotopyBytes,
      homotopy,
      FROZEN_BASELINES.homotopy,
      'homotopy floor',
    );
    const fixture = createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const patternFloor = pattern.seedRows?.[0]?.final;
    const homotopyFloor = homotopy.stages?.at(-1)?.solverResult?.selected;
    if (
      pattern.schema !== 'kaminos.nbody-localized-same-basis-pattern-search.v0' ||
      pattern.status !== 'same-basis-feasibility-unresolved' ||
      pattern.route?.effective !== 'deterministic-coupled-coordinate-pattern-search' ||
      pattern.route?.fallbackUsed !== false ||
      pattern.problemIdentity?.sha256 !== problem.identity.sha256 ||
      pattern.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      pattern.mechanism?.contactGraphRowsConsumed !== false ||
      pattern.starts?.length !== 1 ||
      pattern.seedRows?.length !== 1 ||
      pattern.selected !== null ||
      patternFloor?.maximumPhysicalResidual !== 0.001615326586
    ) throw new Error('common-descent assay rejects substituted coordinate-search floor');
    if (
      homotopy.schema !== 'kaminos.nbody-localized-constraint-homotopy-result.v0' ||
      homotopy.status !== 'complete-stalled-before-full-clearance' ||
      homotopy.route?.effective !== 'compiled-problem-clearance-homotopy' ||
      homotopy.route?.fallbackUsed !== false ||
      homotopy.source?.fixtureSha256 !== fixture.identity.sha256 ||
      homotopy.source?.problemSha256 !== problem.identity.sha256 ||
      homotopyFloor?.maximumPhysicalResidual !== 0.000945973079
    ) throw new Error('common-descent assay rejects substituted homotopy floor');
    const patternEffective = evaluateNBodyUnifiedKktState({
      problem,
      vector:patternFloor.vector,
    });
    const homotopyEffective = evaluateNBodyUnifiedKktState({
      problem,
      vector:homotopyFloor.vector,
    });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'problem-and-baselines-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      patternResultSha256:pattern.identity.sha256,
      homotopyResultSha256:homotopy.identity.sha256,
      patternEffectiveMaximumPhysicalResidual:patternEffective.maximumPhysicalResidual,
      homotopyEffectiveMaximumPhysicalResidual:homotopyEffective.maximumPhysicalResidual,
    };

    phase = 'solve-family-gradient-common-descent';
    const requestedConfig = createNBodyFamilyGradientCommonDescentConfig();
    const result = solveNBodyFamilyGradientCommonDescent({
      problem,
      startVector:patternFloor.vector,
      requestedConfig,
    });
    phase = 'verify-common-descent-result';
    if (
      result.status !== 'common-descent-step-accepted' ||
      result.route?.requested !== requestedRoute ||
      result.route?.effective !== requestedRoute ||
      result.route?.fallbackUsed !== false ||
      result.source?.problemSha256 !== problem.identity.sha256 ||
      result.start?.maximumPhysicalResidual !== patternEffective.maximumPhysicalResidual ||
      result.selected?.maximumPhysicalResidual !== 0.004745541883 ||
      result.selected?.metrics?.pairwisePenetration !== 0.001531913516 ||
      result.selected?.metrics?.skeletalPenetration !== 0.001545080434 ||
      result.selected?.metrics?.compartmentEscape !== 0.004745541883 ||
      result.work?.iterations !== 1 ||
      result.work?.attempts !== 1 ||
      result.work?.candidateReceipts?.length !== requestedConfig.trustRegionRadii.length ||
      result.work.candidateReceipts.filter(candidate => candidate.selected).length !== 1 ||
      result.work.candidateReceipts.find(candidate => candidate.selected)?.radius !== 0.00025 ||
      result.work.candidateReceipts.find(candidate => candidate.selected)
        ?.regressedFamilies.length !== 0 ||
      ['pairwisePenetration', 'skeletalPenetration', 'compartmentEscape'].some(
        key => result.selected.metrics[key] >
          result.start.metrics[key] + requestedConfig.familyRegressionTolerance,
      ) ||
      result.directionConstruction?.predictedCommonDescent !== true ||
      result.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      result.mechanism?.contactGraphRowsConsumed !== false
    ) throw new Error('common-descent assay result did not clear exact admission predicate');

    phase = 'write-terminal-artifacts';
    const resultBytes = jsonBytes(result);
    const reportCore = {
      schema:NBODY_PACKING_COMMON_DESCENT_ASSAY_SCHEMA,
      status:'complete-common-descent-step-admitted',
      route:structuredClone(result.route),
      source:{
        fixtureSha256:fixture.identity.sha256,
        problemSha256:problem.identity.sha256,
        pattern:{
          path:patternResultPath,
          fileSha256:sha256(patternBytes),
          resultSha256:pattern.identity.sha256,
        },
        homotopy:{
          path:homotopyResultPath,
          fileSha256:sha256(homotopyBytes),
          resultSha256:homotopy.identity.sha256,
        },
      },
      comparison:{
        sourceReported:{
          coordinateSearchFloor:patternFloor.maximumPhysicalResidual,
          homotopyFloor:homotopyFloor.maximumPhysicalResidual,
          authority:'historical-sampled-metrics-not-used-for-admission',
        },
        effectiveCompiledRows:{
          coordinateSearchFloor:patternEffective.maximumPhysicalResidual,
          homotopyFloor:homotopyEffective.maximumPhysicalResidual,
          authority:'compiled-constraint-row-family-maxima',
        },
        commonDescentResidual:result.selected.maximumPhysicalResidual,
        improvementVersusCoordinateSearch:
          patternEffective.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
        improvementVersusHomotopy:
          homotopyEffective.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
      },
      bindings:{
        resultJsonSha256:sha256(resultBytes),
        resultSha256:result.identity.sha256,
      },
      claimCeiling:result.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'result.json'), resultBytes),
      writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, result, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_COMMON_DESCENT_ASSAY_SCHEMA,
      status:'failed',
      route:{ requested:requestedRoute, effective:null, fallbackUsed:false },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(failure));
    throw error;
  }
}

export async function runNBodyPackingCommonDescentTrajectoryAssay({
  outDir = 'artifacts/nbody-packing-family-gradient-common-descent-trajectory-v0',
  commonDescentResultPath =
    'artifacts/nbody-packing-family-gradient-common-descent-v0/result.json',
  commonDescentReportPath =
    'artifacts/nbody-packing-family-gradient-common-descent-v0/run-report.json',
  iterationBudget = 8,
  trustRegionRadii = NBODY_PACKING_REFINED_COMMON_DESCENT_RADII,
} = {}) {
  const outputRoot = path.resolve(outDir);
  const requestedRoute = 'family-gradient-minimum-norm-common-descent-trajectory-v0';
  let phase = 'read-admitted-common-descent-source';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    phase = 'invalidate-prior-primary';
    await invalidatePriorPrimary(outputRoot);
    phase = 'read-admitted-common-descent-source';
    const [sourceResultBytes, sourceReportBytes] = await Promise.all([
      readFile(path.resolve(commonDescentResultPath)),
      readFile(path.resolve(commonDescentReportPath)),
    ]);
    const sourceResult = JSON.parse(String(sourceResultBytes));
    const sourceReport = JSON.parse(String(sourceReportBytes));
    verifyCanonicalIdentity(sourceResult, 'admitted common-descent step');
    verifyCanonicalIdentity(sourceReport, 'admitted common-descent report');
    lastTrustworthyEvidence = {
      phase:'admitted-common-descent-source-read',
      resultFileSha256:sha256(sourceResultBytes),
      resultSha256:sourceResult.identity?.sha256 || null,
      reportFileSha256:sha256(sourceReportBytes),
      reportSha256:sourceReport.identity?.sha256 || null,
    };

    phase = 'bind-admitted-common-descent-source';
    if (
      sha256(sourceResultBytes) !== FROZEN_ADMITTED_COMMON_DESCENT.resultFileSha256 ||
      sourceResult.identity?.sha256 !== FROZEN_ADMITTED_COMMON_DESCENT.resultSha256 ||
      sha256(sourceReportBytes) !== FROZEN_ADMITTED_COMMON_DESCENT.reportFileSha256 ||
      sourceReport.identity?.sha256 !== FROZEN_ADMITTED_COMMON_DESCENT.reportSha256
    ) throw new Error('trajectory assay rejects substituted admitted common-descent step');
    if (
      sourceReport.bindings?.resultJsonSha256 !== sha256(sourceResultBytes) ||
      sourceReport.bindings?.resultSha256 !== sourceResult.identity.sha256
    ) throw new Error('trajectory assay rejects broken admitted common-descent binding');
    const fixture = createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    if (
      sourceResult.schema !== 'kaminos.nbody-packing-family-gradient-common-descent-result.v0' ||
      sourceResult.status !== 'common-descent-step-accepted' ||
      sourceResult.route?.effective !== 'family-gradient-minimum-norm-common-descent-v0' ||
      sourceResult.route?.fallbackUsed !== false ||
      sourceResult.source?.problemSha256 !== problem.identity.sha256 ||
      sourceResult.start?.maximumPhysicalResidual !== 0.004815758612 ||
      sourceResult.selected?.maximumPhysicalResidual !== 0.004745541883 ||
      sourceReport.schema !== NBODY_PACKING_COMMON_DESCENT_ASSAY_SCHEMA ||
      sourceReport.status !== 'complete-common-descent-step-admitted' ||
      sourceReport.source?.fixtureSha256 !== fixture.identity.sha256 ||
      sourceReport.source?.problemSha256 !== problem.identity.sha256
    ) throw new Error('trajectory assay rejects incompatible admitted common-descent source');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'admitted-common-descent-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
    };

    phase = 'solve-refined-common-descent-trajectory';
    const requestedConfig = createNBodyFamilyGradientCommonDescentTrajectoryConfig({
      iterationBudget,
      trustRegionRadii,
    });
    const result = solveNBodyFamilyGradientCommonDescentTrajectory({
      problem,
      startVector:sourceResult.start.vector,
      requestedConfig,
    });
    phase = 'verify-refined-common-descent-trajectory';
    const admittedRows = result.work?.rows?.filter(row => row.accepted) || [];
    const allRows = result.work?.rows || [];
    const familyKeys = [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ];
    const everyAcceptedRowIsFamilyMonotone = admittedRows.every(row =>
      familyKeys.every(key => row.after.metrics[key] <=
        row.before.metrics[key] + requestedConfig.familyRegressionTolerance)
    );
    if (
      ![
        'common-descent-trajectory-feasible',
        'common-descent-trajectory-local-floor',
        'common-descent-trajectory-budget-exhausted',
      ].includes(result.status) ||
      result.route?.requested !== requestedRoute ||
      result.route?.effective !== requestedRoute ||
      result.route?.fallbackUsed !== false ||
      result.source?.problemSha256 !== problem.identity.sha256 ||
      result.start?.maximumPhysicalResidual !== sourceResult.start.maximumPhysicalResidual ||
      allRows.length !== result.work?.attempts ||
      result.work?.iterations !== admittedRows.length ||
      allRows.some(row =>
        row.candidateReceipts?.length !== requestedConfig.trustRegionRadii.length ||
        row.candidateReceipts.some(candidate =>
          !requestedConfig.trustRegionRadii.includes(candidate.radius)
        )
      ) ||
      !everyAcceptedRowIsFamilyMonotone ||
      result.selected?.metrics?.endpointDrift !== 0 ||
      result.selected?.metrics?.maximumRelativeVolumeError !== 0 ||
      result.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      result.mechanism?.contactGraphRowsConsumed !== false
    ) throw new Error('trajectory assay result did not clear its bounded probe contract');

    phase = 'write-terminal-artifacts';
    const resultBytes = jsonBytes(result);
    const selectedRadii = allRows.map(row =>
      row.candidateReceipts.find(candidate => candidate.selected)?.radius || null
    );
    const reportCore = {
      schema:NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA,
      status:result.status === 'common-descent-trajectory-feasible'
        ? 'complete-refined-trajectory-feasible'
        : result.status === 'common-descent-trajectory-local-floor'
          ? 'complete-refined-trajectory-floor-exposed'
          : 'complete-refined-trajectory-budget-exhausted',
      route:structuredClone(result.route),
      source:{
        fixtureSha256:fixture.identity.sha256,
        problemSha256:problem.identity.sha256,
        admittedCommonDescent:{
          resultPath:commonDescentResultPath,
          resultFileSha256:sha256(sourceResultBytes),
          resultSha256:sourceResult.identity.sha256,
          reportPath:commonDescentReportPath,
          reportFileSha256:sha256(sourceReportBytes),
          reportSha256:sourceReport.identity.sha256,
        },
      },
      probe:{
        trustRegionRadii:[...requestedConfig.trustRegionRadii],
        iterationBudget:requestedConfig.iterationBudget,
        acceptedIterations:result.work.iterations,
        attemptedIterations:result.work.attempts,
        selectedRadii,
        terminalReason:result.work.terminalReason,
      },
      comparison:{
        compiledRowStart:result.start.maximumPhysicalResidual,
        admittedOneStep:sourceResult.selected.maximumPhysicalResidual,
        refinedTrajectory:result.selected.maximumPhysicalResidual,
        improvementVersusStart:
          result.start.maximumPhysicalResidual / result.selected.maximumPhysicalResidual,
        improvementVersusAdmittedOneStep:
          sourceResult.selected.maximumPhysicalResidual /
            result.selected.maximumPhysicalResidual,
      },
      bindings:{
        resultJsonSha256:sha256(resultBytes),
        resultSha256:result.identity.sha256,
      },
      claimCeiling:result.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'result.json'), resultBytes),
      writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, result, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA,
      status:'failed',
      route:{ requested:requestedRoute, effective:null, fallbackUsed:false },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(failure));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = process.argv[2] || 'artifacts/nbody-packing-all-neighbor-restoration-v0';
  const iterationBudget = process.argv[3] === undefined ? 1 : Number(process.argv[3]);
  const acceptancePolicy = process.argv[4] || 'scalar-merit';
  const { outputRoot, report } = acceptancePolicy === 'family-gradient-common-descent'
    ? await runNBodyPackingCommonDescentAssay({ outDir })
    : acceptancePolicy === 'family-gradient-common-descent-trajectory'
      ? await runNBodyPackingCommonDescentTrajectoryAssay({ outDir, iterationBudget })
      : await runNBodyPackingRestorationAssay({
          outDir,
          iterationBudget,
          acceptancePolicy,
        });
  process.stdout.write(`${JSON.stringify({ outputRoot, report }, null, 2)}\n`);
}
