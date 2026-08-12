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
} from './nbody-packing-restoration.mjs';
import {
  LOCALIZED_CHALLENGE_RESULT_SCHEMA,
  LOCALIZED_CONTINUATION_RESULT_SCHEMA,
} from './nbody-packing-localized-challenge.mjs';
import {
  NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
  NBODY_PACKING_RESTORATION_WITNESS_ROUTE,
  NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE,
  NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE,
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
    ] = await Promise.all([
      readFile(path.resolve(challengeResultPath)),
      readFile(path.resolve(continuationResultPath)),
      readFile(path.resolve(patternResultPath)),
      restorationResultPath ? readFile(path.resolve(restorationResultPath)) : Promise.resolve(null),
      trajectoryResultPath ? readFile(path.resolve(trajectoryResultPath)) : Promise.resolve(null),
      commonDescentResultPath
        ? readFile(path.resolve(commonDescentResultPath))
        : Promise.resolve(null),
    ]);
    const challenge = JSON.parse(String(challengeBytes));
    const continuation = JSON.parse(String(continuationBytes));
    const pattern = JSON.parse(String(patternBytes));
    const restoration = restorationBytes ? JSON.parse(String(restorationBytes)) : null;
    const trajectory = trajectoryBytes ? JSON.parse(String(trajectoryBytes)) : null;
    const commonDescent = commonDescentBytes ? JSON.parse(String(commonDescentBytes)) : null;
    if (trajectory && !restoration) {
      throw new Error('localized hard witness trajectory requires the admitted one-step comparison');
    }
    lastTrustworthyEvidence = {
      phase:'source-results-read',
      challengeSha256:sha256(challengeBytes),
      continuationSha256:sha256(continuationBytes),
      patternSha256:sha256(patternBytes),
      restorationSha256:restorationBytes ? sha256(restorationBytes) : null,
      trajectorySha256:trajectoryBytes ? sha256(trajectoryBytes) : null,
      commonDescentSha256:commonDescentBytes ? sha256(commonDescentBytes) : null,
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
        restoration.start?.maximumPhysicalResidual !== 0.001615326586 ||
        !(restoration.selected?.maximumPhysicalResidual < 0.000945973079)
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
        trajectory.work?.iterations !== 6 ||
        trajectory.work?.rows?.some(row => row.accepted !== true) ||
        trajectory.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        trajectory.mechanism?.contactGraphRowsConsumed !== false ||
        trajectory.invariance?.candidateEnumeration !== 'passed' ||
        trajectory.start?.maximumPhysicalResidual !== 0.001615326586 ||
        !(trajectory.selected?.maximumPhysicalResidual <
          (restoration?.selected?.maximumPhysicalResidual ?? 0.000945973079))
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
        commonDescent.start?.maximumPhysicalResidual !== 0.001615326586 ||
        commonDescent.selected?.maximumPhysicalResidual !== 0.000125037313 ||
        commonDescent.directionConstruction?.predictedCommonDescent !== true ||
        commonDescent.work?.iterations !== 1 ||
        commonDescent.work?.attempts !== 1 ||
        commonDescent.work.candidateReceipts.some(candidate =>
          candidate.regressedFamilies.length !== 0
        ) ||
        commonDescent.mechanism?.oracleTargetCoordinatesConsumed !== false ||
        commonDescent.mechanism?.contactGraphRowsConsumed !== false
      ) throw new Error('localized hard witness rejects substituted common-descent evidence');
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
    if (JSON.stringify(patternState.metrics) !== JSON.stringify(pattern.seedRows[0].final.metrics)) {
      throw new Error('localized hard witness rejects stale pattern final metrics');
    }
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
          truth:'One simultaneous direction derived from every violated pair, bone, and compartment row beats both frozen local-search floors without oracle coordinates or a contact graph. Residual debt remains.',
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
          truth:'Six deterministic simultaneous all-neighbor steps lower the maximum residual, but scalar merit resurrects pair debt that the first step had cleared. This is a debt-trading failure, not convergence or feasibility.',
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
          truth:'One minimum-norm combination of independent pair, bone, and compartment gradients lowers every tracked family at all tested radii. The selected step clears pair and compartment debt and leaves a smaller skeletal residual; this is a bounded synthetic mechanism result, not feasibility or anatomy.',
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
      'reference',
    ];
    const witnessRoute = commonDescent
      ? NBODY_PACKING_COMMON_DESCENT_WITNESS_ROUTE
      : trajectory
        ? NBODY_PACKING_RESTORATION_TRAJECTORY_WITNESS_ROUTE
      : restoration
        ? NBODY_PACKING_RESTORATION_WITNESS_ROUTE
        : NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE;
    const display = {
      title:restoration
        ? commonDescent
          ? 'Family-gradient common descent · six-body hard boundary'
          : trajectory
          ? 'Repeated all-neighbor restoration · six-body hard boundary'
          : 'All-neighbor restoration · six-body hard boundary'
        : 'Localized hard boundary · six bodies',
      authority:'Synthetic two-obstacle mechanism falsifier · no anatomical admission',
      explanation:restoration
        ? commonDescent
          ? 'Severity 0.32 creates a gross cold failure. The scalar direction can trade debt and the strict family filter stalls on that direction. A new <strong>minimum-norm combination of independent family gradients</strong> creates a direction whose tested nonlinear steps do not regress any tracked family; this is a bounded mechanism advance, not feasibility or anatomical admission.'
          : trajectory
          ? 'Severity 0.32 creates a gross cold failure. Compare the admitted one-step state with six <strong>simultaneous all-neighbor restoration</strong> steps. Although the maximum residual descends, the repeated scalar-merit trajectory resurrects pairwise debt after clearing it. This exposes a debt-trading failure and motivates constraint-family-aware acceptance.'
          : 'Severity 0.32 creates a gross cold failure. Continuation, one-coordinate search, and homotopy establish local floors. The new state applies one <strong>simultaneous all-neighbor restoration direction</strong> and descends below both recorded floors; this is a mechanism advance, not feasibility or optimality closure.'
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
          restorationVersusHomotopyFloor:
            0.000945973079 / restoration.selected.maximumPhysicalResidual,
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
          commonDescentVersusScalarOneStep:
            restoration.selected.maximumPhysicalResidual /
              commonDescent.selected.maximumPhysicalResidual,
          commonDescentSelectedRadius:
            commonDescent.work.candidateReceipts.find(candidate => candidate.selected)?.radius,
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
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling: {
        admittedClaim:commonDescent
          ? 'one deterministic minimum-norm combination of independent constraint-family gradients on severity 0.32 lowers maximum physical residual to 0.000125037313 without trading tracked family debt at any tested radius, clearing pairwise and compartment debt while retaining exact attachment and volume invariants'
          : trajectory
            ? 'six deterministic simultaneous all-neighbor restoration steps on severity 0.32 monotonically lower the maximum residual while retaining exact attachment and volume invariants, but reintroduce pairwise penetration after the one-step state cleared it; scalar-merit repetition therefore fails the no-debt-trading architecture predicate'
          : restoration
            ? 'one simultaneous all-neighbor restoration step on severity 0.32 beats the frozen coordinate-search and homotopy residual floors while retaining exact attachment and volume invariants'
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
    const requestedRoute = commonDescentResultPath
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
  const result = await writeNBodyPackingLocalizedHardBoundaryWitness({
    outDir,
    restorationResultPath,
    trajectoryResultPath,
    commonDescentResultPath,
  });
  process.stdout.write(`${JSON.stringify({
    outputRoot:result.outputRoot,
    report:result.report,
  }, null, 2)}\n`);
}
