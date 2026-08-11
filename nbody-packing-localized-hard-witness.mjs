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
  LOCALIZED_CHALLENGE_RESULT_SCHEMA,
  LOCALIZED_CONTINUATION_RESULT_SCHEMA,
} from './nbody-packing-localized-challenge.mjs';
import {
  NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
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
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'read-source-results';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    const [challengeBytes, continuationBytes, patternBytes] = await Promise.all([
      readFile(path.resolve(challengeResultPath)),
      readFile(path.resolve(continuationResultPath)),
      readFile(path.resolve(patternResultPath)),
    ]);
    const challenge = JSON.parse(String(challengeBytes));
    const continuation = JSON.parse(String(continuationBytes));
    const pattern = JSON.parse(String(patternBytes));
    lastTrustworthyEvidence = {
      phase:'source-results-read',
      challengeSha256:sha256(challengeBytes),
      continuationSha256:sha256(continuationBytes),
      patternSha256:sha256(patternBytes),
    };
    phase = 'bind-source-identities';
    const suite = createNBodyLocalizedChallengeSuite();
    const passFixture = suite.find(row => row.assayProfile.severity === 0.28);
    const failFixture = suite.find(row => row.assayProfile.severity === 0.32);
    const problem = validateSources({
      challenge, continuation, pattern, passFixture, failFixture,
    });
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
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'source-identities-bound',
      problemSha256:problem.identity.sha256,
    };
    phase = 'write-primary';
    const fixtures = { lastPass:passFixture, firstFail:failFixture };
    const comparison = { challenge, continuation, pattern };
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
      reference: {
        label:'Manufactured feasibility witness', severity:null,
        status:'existence witness outside candidate carrier', warning:false,
        source:failFixture.knownFeasible,
        muscles:failFixture.knownFeasible.muscles,
        metrics:failFixture.metrics.knownFeasible,
        truth:'This withheld manufactured state proves fixture feasibility, not feasibility in the frozen two-mode candidate carrier.',
      },
    };
    const display = {
      title:'Localized hard boundary · six bodies',
      authority:'Synthetic two-obstacle mechanism falsifier · no anatomical admission',
      explanation:'Severity 0.32 creates a gross cold failure. Exact 0.28 continuation and an independent same-basis coordinate search reduce the debt by roughly two orders of magnitude but do not clear it. This establishes a <strong>globalization defect</strong>; it does <strong>not</strong> yet establish a carrier representation limit.',
      orderedStates:[...STATE_KEYS],
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
      route:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
        effective:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
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
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        challengeResultSha256:sha256(challengeBytes),
        continuationResultSha256:sha256(continuationBytes),
        patternResultSha256:sha256(patternBytes),
      },
      requiredStates:[...STATE_KEYS],
      requiredModes:['volume','slice'],
      claimCeiling: {
        admittedClaim:'severity 0.32 exposes a gross cold-start globalization failure and an unresolved same-basis residual floor after continuation and coordinate search',
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
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_LOCALIZED_HARD_WITNESS_ROUTE,
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
  const result = await writeNBodyPackingLocalizedHardBoundaryWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    outputRoot:result.outputRoot,
    report:result.report,
  }, null, 2)}\n`);
}
