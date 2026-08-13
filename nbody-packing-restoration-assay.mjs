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
  createNBodyActiveRowTrustRegionTrajectoryConfig,
  createNBodyFamilyGradientCommonDescentConfig,
  createNBodyFamilyGradientCommonDescentTrajectoryConfig,
  solveNBodyAllNeighborRestoration,
  solveNBodyActiveRowTrustRegionTrajectory,
  solveNBodyFamilyGradientCommonDescent,
  solveNBodyFamilyGradientCommonDescentTrajectory,
} from './nbody-packing-restoration.mjs';

export const NBODY_PACKING_RESTORATION_ASSAY_SCHEMA =
  'kaminos.nbody-packing-all-neighbor-restoration-assay.v0';
export const NBODY_PACKING_COMMON_DESCENT_ASSAY_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-assay.v0';
export const NBODY_PACKING_COMMON_DESCENT_TRAJECTORY_ASSAY_SCHEMA =
  'kaminos.nbody-packing-family-gradient-common-descent-trajectory-assay.v0';
export const NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_ASSAY_SCHEMA =
  'kaminos.nbody-packing-active-row-trust-region-trajectory-assay.v0';

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

const FROZEN_AUTHENTICATED_ADAPTIVE_TRAJECTORY = Object.freeze({
  resultFileSha256:'8f8764288d999c99ca574f89337f75c4bca4e2169f19bc85ba4ce2aa1c193d69',
  resultSha256:'2a060455affc56b4149461270e7eeb8f59bab24993e7b4f8a75afbf461931b1b',
  reportFileSha256:'1536165e5f7634a1e026e3eec281fa98e38c1628f73952d5bb3eb70d8be00f01',
  reportSha256:'41a1c5897e6b559b07c04bb83c17fbab75048aa71b46b6337fc59e39d66f6477',
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

async function invalidatePriorActiveTrajectory(outputRoot) {
  await Promise.all(['result.json', 'raw-trajectory.json'].map(async fileName => {
    try {
      await unlink(path.join(outputRoot, fileName));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
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

export async function runNBodyPackingActiveRowTrajectoryAssay({
  outDir = 'artifacts/nbody-packing-active-row-trust-region-trajectory-v0',
  adaptiveResultPath =
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/result.json',
  adaptiveReportPath =
    'artifacts/nbody-packing-family-gradient-adaptive-common-descent-trajectory-v0/run-report.json',
  iterationBudget = 8,
} = {}) {
  const outputRoot = path.resolve(outDir);
  const requestedRoute =
    'active-row-minimum-norm-common-descent-trust-region-trajectory-v0';
  let phase = 'read-authenticated-adaptive-source';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    phase = 'invalidate-prior-primary';
    await invalidatePriorActiveTrajectory(outputRoot);
    phase = 'read-authenticated-adaptive-source';
    const [sourceResultBytes, sourceReportBytes] = await Promise.all([
      readFile(path.resolve(adaptiveResultPath)),
      readFile(path.resolve(adaptiveReportPath)),
    ]);
    const sourceResult = JSON.parse(String(sourceResultBytes));
    const sourceReport = JSON.parse(String(sourceReportBytes));
    verifyCanonicalIdentity(sourceResult, 'authenticated adaptive trajectory');
    verifyCanonicalIdentity(sourceReport, 'authenticated adaptive trajectory report');
    lastTrustworthyEvidence = {
      phase:'authenticated-adaptive-source-read',
      resultFileSha256:sha256(sourceResultBytes),
      resultSha256:sourceResult.identity?.sha256 || null,
      reportFileSha256:sha256(sourceReportBytes),
      reportSha256:sourceReport.identity?.sha256 || null,
    };

    phase = 'bind-authenticated-adaptive-source';
    if (
      sha256(sourceResultBytes) !==
        FROZEN_AUTHENTICATED_ADAPTIVE_TRAJECTORY.resultFileSha256 ||
      sourceResult.identity?.sha256 !==
        FROZEN_AUTHENTICATED_ADAPTIVE_TRAJECTORY.resultSha256 ||
      sha256(sourceReportBytes) !==
        FROZEN_AUTHENTICATED_ADAPTIVE_TRAJECTORY.reportFileSha256 ||
      sourceReport.identity?.sha256 !==
        FROZEN_AUTHENTICATED_ADAPTIVE_TRAJECTORY.reportSha256
    ) throw new Error('active-row assay rejects substituted authenticated adaptive trajectory');
    if (
      sourceReport.bindings?.resultFileSha256 !== sha256(sourceResultBytes) ||
      sourceReport.bindings?.resultSha256 !== sourceResult.identity.sha256
    ) throw new Error('active-row assay rejects broken authenticated adaptive binding');
    const fixture = createNBodyLocalizedChallengeSuite().find(
      row => row.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    if (
      sourceResult.schema !==
        'kaminos.nbody-packing-family-gradient-adaptive-common-descent-trajectory-result.v0' ||
      sourceResult.status !== 'adaptive-common-descent-trajectory-budget-exhausted' ||
      sourceResult.route?.effective !==
        'family-gradient-minimum-norm-common-descent-adaptive-trajectory-v0' ||
      sourceResult.route?.fallbackUsed !== false ||
      sourceResult.source?.problemSha256 !== problem.identity.sha256 ||
      sourceResult.selected?.maximumPhysicalResidual !== 0.004513829534 ||
      sourceResult.selected?.metrics?.endpointDrift !== 0 ||
      sourceResult.selected?.metrics?.maximumRelativeVolumeError !== 0 ||
      sourceReport.schema !==
        'kaminos.nbody-packing-adaptive-common-descent-trajectory-admission.v0' ||
      sourceReport.status !== 'complete-admitted-canonical-trajectory' ||
      sourceReport.source?.fixtureSha256 !== fixture.identity.sha256 ||
      sourceReport.source?.problemSha256 !== problem.identity.sha256
    ) throw new Error('active-row assay rejects incompatible authenticated adaptive source');
    const effectiveStart = evaluateNBodyUnifiedKktState({
      problem,
      vector:sourceResult.selected.vector,
    });
    if (
      effectiveStart.maximumPhysicalResidual !== sourceResult.selected.maximumPhysicalResidual ||
      JSON.stringify(effectiveStart.metrics) !== JSON.stringify(sourceResult.selected.metrics)
    ) throw new Error('active-row assay rejects physically stale adaptive selected state');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'authenticated-adaptive-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      effectiveStartMaximumPhysicalResidual:effectiveStart.maximumPhysicalResidual,
    };

    phase = 'solve-active-row-trajectory';
    const requestedConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({
      iterationBudget,
    });
    const rawTrajectory = solveNBodyActiveRowTrustRegionTrajectory({
      problem,
      startVector:sourceResult.selected.vector,
      requestedConfig,
    });
    const rawBytes = jsonBytes(rawTrajectory);
    await writeAtomically(path.join(outputRoot, 'raw-trajectory.json'), rawBytes);
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'raw-active-row-trajectory-persisted',
      rawFileSha256:sha256(rawBytes),
      rawResultSha256:rawTrajectory.identity?.sha256 || null,
    };

    phase = 'verify-active-row-trajectory';
    verifyCanonicalIdentity(rawTrajectory, 'raw active-row trajectory');
    const rows = rawTrajectory.work?.rows || [];
    const acceptedRows = rows.filter(row => row.accepted);
    const familyKeys = [
      'pairwisePenetration',
      'skeletalPenetration',
      'compartmentEscape',
    ];
    if (
      ![
        'active-row-trust-region-trajectory-budget-exhausted',
        'active-row-trust-region-trajectory-feasible',
        'active-row-trust-region-trajectory-local-floor',
      ].includes(rawTrajectory.status) ||
      rawTrajectory.route?.requested !== requestedRoute ||
      rawTrajectory.route?.effective !== requestedRoute ||
      rawTrajectory.route?.fallbackUsed !== false ||
      rawTrajectory.source?.problemSha256 !== problem.identity.sha256 ||
      rawTrajectory.start?.maximumPhysicalResidual !==
        sourceResult.selected.maximumPhysicalResidual ||
      rows.length !== rawTrajectory.work?.attempts ||
      acceptedRows.length !== rawTrajectory.work?.iterations ||
      acceptedRows.length < 2 ||
      acceptedRows.some(row =>
        row.after.maximumPhysicalResidual >= row.before.maximumPhysicalResidual ||
        row.after.maximumActiveRowViolation >= row.before.maximumActiveRowViolation ||
        familyKeys.some(key => row.after.metrics[key] >
          row.before.metrics[key] + requestedConfig.step.familyRegressionTolerance)
      ) ||
      rows.some(row =>
        !/^[a-f0-9]{64}$/.test(row.stepResultSha256) ||
        row.directionConstruction?.activeSetPolicy !== 'family-maximum-relative-band'
      ) ||
      rawTrajectory.selected?.metrics?.endpointDrift !== 0 ||
      rawTrajectory.selected?.metrics?.maximumRelativeVolumeError !== 0 ||
      rawTrajectory.mechanism?.oracleTargetCoordinatesConsumed !== false ||
      rawTrajectory.mechanism?.contactGraphRowsConsumed !== true
    ) throw new Error('active-row trajectory did not clear its bounded admission contract');
    if (
      rawTrajectory.status === 'active-row-trust-region-trajectory-local-floor' &&
      (!rows.at(-1)?.certificate || rows.at(-1).accepted)
    ) throw new Error('active-row trajectory local floor lacks its terminal certificate');

    phase = 'write-terminal-artifacts';
    const resultBytes = jsonBytes(rawTrajectory);
    const reportCore = {
      schema:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_ASSAY_SCHEMA,
      status:rawTrajectory.status === 'active-row-trust-region-trajectory-feasible'
        ? 'complete-active-row-trajectory-feasible'
        : rawTrajectory.status === 'active-row-trust-region-trajectory-local-floor'
          ? 'complete-active-row-trajectory-floor-exposed'
          : 'complete-active-row-trajectory-budget-exhausted',
      route:structuredClone(rawTrajectory.route),
      source:{
        fixtureSha256:fixture.identity.sha256,
        problemSha256:problem.identity.sha256,
        authenticatedAdaptiveTrajectory:{
          resultPath:adaptiveResultPath,
          resultFileSha256:sha256(sourceResultBytes),
          resultSha256:sourceResult.identity.sha256,
          reportPath:adaptiveReportPath,
          reportFileSha256:sha256(sourceReportBytes),
          reportSha256:sourceReport.identity.sha256,
        },
      },
      probe:{
        activeSetPolicy:requestedConfig.step.activeSetPolicy,
        relativeActivationBand:requestedConfig.step.relativeActivationBand,
        iterationBudget:requestedConfig.iterationBudget,
        acceptedIterations:rawTrajectory.work.iterations,
        attemptedIterations:rawTrajectory.work.attempts,
        terminalReason:rawTrajectory.work.terminalReason,
        selectedRadii:rows.map(row =>
          row.candidateReceipts.find(candidate => candidate.selected)?.radius || null
        ),
      },
      comparison:{
        authenticatedAdaptiveStart:rawTrajectory.start.maximumPhysicalResidual,
        activeRowTrajectory:rawTrajectory.selected.maximumPhysicalResidual,
        improvementRatio:
          rawTrajectory.start.maximumPhysicalResidual /
            rawTrajectory.selected.maximumPhysicalResidual,
        familyStart:Object.fromEntries(familyKeys.map(
          key => [key, rawTrajectory.start.metrics[key]],
        )),
        familySelected:Object.fromEntries(familyKeys.map(
          key => [key, rawTrajectory.selected.metrics[key]],
        )),
      },
      bindings:{
        rawTrajectoryFileSha256:sha256(rawBytes),
        rawTrajectorySha256:rawTrajectory.identity.sha256,
        resultFileSha256:sha256(resultBytes),
        resultSha256:rawTrajectory.identity.sha256,
      },
      claimCeiling:rawTrajectory.claimCeiling,
    };
    const report = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    await Promise.all([
      writeAtomically(path.join(outputRoot, 'result.json'), resultBytes),
      writeAtomically(path.join(outputRoot, 'run-report.json'), jsonBytes(report)),
    ]);
    return { outputRoot, rawTrajectory, result:rawTrajectory, report };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_ASSAY_SCHEMA,
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
      : acceptancePolicy === 'active-row-trust-region-trajectory'
        ? await runNBodyPackingActiveRowTrajectoryAssay({ outDir, iterationBudget })
      : await runNBodyPackingRestorationAssay({
          outDir,
          iterationBudget,
          acceptancePolicy,
        });
  process.stdout.write(`${JSON.stringify({ outputRoot, report }, null, 2)}\n`);
}
