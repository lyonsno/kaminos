#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNBodyLocalizedChallengeSuite } from './nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from './muscle-compartment-packing-core.mjs';
import {
  compileNBodyAdaptiveKktProblem,
  evaluateNBodyUnifiedKktState,
} from './nbody-packing-unified-kkt.mjs';
import {
  createNBodyActiveRowTrustRegionTrajectoryConfig,
  NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA,
  NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_TRAJECTORY_RESULT_SCHEMA,
} from './nbody-packing-restoration.mjs';
import {
  NBODY_PACKING_ACTIVE_ROW_CONTINUATION_ASSAY_SCHEMA,
  NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_ASSAY_SCHEMA,
  NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_ASSAY_SCHEMA,
  NBODY_PACKING_ELASTIC_ALL_ROW_RAW_PAIR_SCHEMA,
} from './nbody-packing-restoration-assay.mjs';
import {
  NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
  NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE,
  NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
  NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
  NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
  renderNBodyPackingLocalizedChallengeHtml,
} from './nbody-packing-localized-witness.mjs';

export { NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE };
export { NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE };
export { NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE };
export { NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE };
const ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE =
  'active-row-minimum-norm-common-descent-trust-region-trajectory-v0';

const FROZEN_ACTIVE_ROW_SOURCE = Object.freeze({
  rawFileSha256:'ed32c03ef9e98e64699886ba7b115c713b6c055828d1f0ad118ae5546c0ed264',
  resultFileSha256:'ed32c03ef9e98e64699886ba7b115c713b6c055828d1f0ad118ae5546c0ed264',
  resultSha256:'d1ba2a571dfc30f90098c26cf00d45224bb84cc3209440b85452693498229bc2',
  reportFileSha256:'c0132bdaa0bb7d8b306c8f6374692eaa183cd48c98f3b4f59fd06e6eaa9cb21a',
  reportSha256:'c51fc8d8fad0e692f9795510e6596266cd8a25f9b3af91a435f199d6ce7582d6',
});

const FROZEN_ADAPTIVE_SOURCE = Object.freeze({
  resultFileSha256:'8f8764288d999c99ca574f89337f75c4bca4e2169f19bc85ba4ce2aa1c193d69',
  resultSha256:'2a060455affc56b4149461270e7eeb8f59bab24993e7b4f8a75afbf461931b1b',
  reportFileSha256:'1536165e5f7634a1e026e3eec281fa98e38c1628f73952d5bb3eb70d8be00f01',
  reportSha256:'41a1c5897e6b559b07c04bb83c17fbab75048aa71b46b6337fc59e39d66f6477',
});

const FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE = Object.freeze({
  rawFileSha256:'7804914bbe8f7e7ee69fa3d2a896d90fd35d038c1ed9eadbb30c5f953281ee07',
  resultFileSha256:'7804914bbe8f7e7ee69fa3d2a896d90fd35d038c1ed9eadbb30c5f953281ee07',
  resultSha256:'71070911e5bff2d8f51460ea77ef2116abcc335fb2c73da8fa64036eabc288f5',
  reportFileSha256:'0c5b5a1625d5a2bebf15710a890d96c1d14c09e36865f677401e18e71258fc7d',
  reportSha256:'d08e44e6f95d17f8e86e9b11f55c76a83d5d69aa3a45a30ccd0aca7f9204ea1a',
});

const SELECTED_ITERATIONS = Object.freeze([1, 3, 7, 8]);
const SELECTED_CONTINUATION_ITERATIONS = Object.freeze([
  Object.freeze({ local:1, global:9 }),
  Object.freeze({ local:3, global:11 }),
  Object.freeze({ local:4, global:12 }),
  Object.freeze({ local:8, global:16 }),
]);
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

async function writeAtomically(targetPath, bytes, io = { writeFile, rename }) {
  const temporaryPath = `${targetPath}.tmp`;
  await io.writeFile(temporaryPath, bytes);
  await io.rename(temporaryPath, targetPath);
}

async function invalidatePrimaries(outputRoot) {
  let names = [];
  try {
    names = await readdir(outputRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const exact = new Set([
    'fixtures.json',
    'comparison.json',
    'index.html',
    'report.json',
    'visual-inspection.json',
  ]);
  await Promise.all(names.filter(name =>
    exact.has(name) ||
    name.endsWith('.png') ||
    name.endsWith('-capture-report.json') ||
    name.endsWith('.tmp')
  ).map(name => rm(path.join(outputRoot, name), { force:true, recursive:true })));
}

function verifyCanonicalIdentity(value, label) {
  const core = structuredClone(value);
  delete core.identity;
  if (value.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error(`active-row witness rejects stale ${label} identity`);
  }
}

function requireExact(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function physicalReceipt(state) {
  return {
    vector:[...state.vector],
    maximumPhysicalResidual:state.maximumPhysicalResidual,
    metrics:structuredClone(state.metrics),
  };
}

function maximumCenterlineDisplacement(baselineMuscles, targetMuscles) {
  let maximum = 0;
  if (baselineMuscles.length !== targetMuscles.length) {
    throw new Error('active-row witness rejects comparison muscle-count mismatch');
  }
  for (let muscleIndex = 0; muscleIndex < targetMuscles.length; muscleIndex += 1) {
    const baseline = baselineMuscles[muscleIndex];
    const target = targetMuscles[muscleIndex];
    if (baseline.id !== target.id || baseline.centerline.length !== target.centerline.length) {
      throw new Error('active-row witness rejects comparison topology mismatch');
    }
    for (let knotIndex = 0; knotIndex < target.centerline.length; knotIndex += 1) {
      maximum = Math.max(maximum, Math.hypot(...target.centerline[knotIndex].position.map(
        (value, axis) => value - baseline.centerline[knotIndex].position[axis],
      )));
    }
  }
  return maximum;
}

function validateActiveRowSource({
  raw,
  rawBytes,
  result,
  resultBytes,
  report,
  reportBytes,
  fixture,
  problem,
}) {
  for (const [value, label] of [
    [raw, 'raw active-row trajectory'],
    [result, 'active-row trajectory'],
    [report, 'active-row trajectory assay report'],
  ]) verifyCanonicalIdentity(value, label);
  const source = report.source?.authenticatedAdaptiveTrajectory;
  if (
    sha256(rawBytes) !== FROZEN_ACTIVE_ROW_SOURCE.rawFileSha256 ||
    sha256(resultBytes) !== FROZEN_ACTIVE_ROW_SOURCE.resultFileSha256 ||
    result.identity?.sha256 !== FROZEN_ACTIVE_ROW_SOURCE.resultSha256 ||
    sha256(reportBytes) !== FROZEN_ACTIVE_ROW_SOURCE.reportFileSha256 ||
    report.identity?.sha256 !== FROZEN_ACTIVE_ROW_SOURCE.reportSha256 ||
    !rawBytes.equals(resultBytes) ||
    JSON.stringify(raw) !== JSON.stringify(result) ||
    report.schema !== NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_ASSAY_SCHEMA ||
    report.status !== 'complete-active-row-trajectory-budget-exhausted' ||
    report.source?.fixtureSha256 !== fixture.identity.sha256 ||
    report.source?.problemSha256 !== problem.identity.sha256 ||
    source?.resultFileSha256 !== FROZEN_ADAPTIVE_SOURCE.resultFileSha256 ||
    source?.resultSha256 !== FROZEN_ADAPTIVE_SOURCE.resultSha256 ||
    source?.reportFileSha256 !== FROZEN_ADAPTIVE_SOURCE.reportFileSha256 ||
    source?.reportSha256 !== FROZEN_ADAPTIVE_SOURCE.reportSha256 ||
    report.bindings?.rawTrajectoryFileSha256 !== sha256(rawBytes) ||
    report.bindings?.rawTrajectorySha256 !== result.identity.sha256 ||
    report.bindings?.resultFileSha256 !== sha256(resultBytes) ||
    report.bindings?.resultSha256 !== result.identity.sha256 ||
    report.claimCeiling !== result.claimCeiling
  ) throw new Error('active-row witness rejects substituted active-row trajectory source');

  const expectedConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({ iterationBudget:8 });
  const rows = result.work?.rows || [];
  if (
    result.schema !== NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_TRAJECTORY_RESULT_SCHEMA ||
    result.status !== 'active-row-trust-region-trajectory-budget-exhausted' ||
    result.route?.requested !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    result.route?.effective !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    result.route?.fallbackUsed !== false ||
    result.source?.problemSha256 !== problem.identity.sha256 ||
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    rows.length !== 8 ||
    result.work?.iterations !== 8 ||
    result.work?.attempts !== 8 ||
    result.work?.terminalReason !== null ||
    rows.some(row => !row.accepted ||
      row.directionConstruction?.activeSetPolicy !== 'family-maximum-relative-band' ||
      row.directionConstruction?.predictedCommonDescent !== true ||
      row.candidateReceipts?.filter(candidate => candidate.selected).length !== 1 ||
      !/^[a-f0-9]{64}$/.test(row.stepResultSha256)) ||
    report.probe?.acceptedIterations !== 8 ||
    report.probe?.attemptedIterations !== 8 ||
    report.probe?.terminalReason !== null ||
    result.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    result.mechanism?.contactGraphRowsConsumed !== true
  ) throw new Error('active-row witness rejects incompatible active-row trajectory contract');

  const startState = evaluateNBodyUnifiedKktState({ problem, vector:result.start.vector });
  requireExact(
    result.start,
    {
      vector:[...startState.vector],
      maximumActiveRowViolation:result.start.maximumActiveRowViolation,
      maximumPhysicalResidual:startState.maximumPhysicalResidual,
      metrics:structuredClone(startState.metrics),
    },
    'active-row witness rejects physically stale start state',
  );
  let previous = result.start;
  const evaluatedRows = [];
  for (const row of rows) {
    requireExact(row.before, previous,
      `active-row witness rejects row continuity at iteration ${row.iteration}`);
    const afterState = evaluateNBodyUnifiedKktState({ problem, vector:row.after.vector });
    requireExact(
      row.after,
      {
        vector:[...afterState.vector],
        maximumActiveRowViolation:row.after.maximumActiveRowViolation,
        maximumPhysicalResidual:afterState.maximumPhysicalResidual,
        metrics:structuredClone(afterState.metrics),
      },
      `active-row witness rejects physical row state at iteration ${row.iteration}`,
    );
    const selected = row.candidateReceipts.find(candidate => candidate.selected);
    requireExact(selected?.vector, row.after.vector,
      `active-row witness rejects selected candidate at iteration ${row.iteration}`);
    if (
      row.after.maximumPhysicalResidual >= row.before.maximumPhysicalResidual ||
      row.after.maximumActiveRowViolation >= row.before.maximumActiveRowViolation ||
      FAMILY_KEYS.some(key => row.after.metrics[key] >
        row.before.metrics[key] + expectedConfig.step.familyRegressionTolerance) ||
      row.after.metrics.endpointDrift !== 0 ||
      row.after.metrics.maximumRelativeVolumeError !== 0
    ) throw new Error(`active-row witness rejects progress semantics at iteration ${row.iteration}`);
    evaluatedRows.push({ row, state:afterState });
    previous = row.after;
  }
  const selectedState = evaluateNBodyUnifiedKktState({ problem, vector:result.selected.vector });
  requireExact(result.selected, {
    vector:[...selectedState.vector],
    maximumActiveRowViolation:result.selected.maximumActiveRowViolation,
    maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
    metrics:structuredClone(selectedState.metrics),
    muscles:selectedState.muscles,
  },
    'active-row witness rejects physically stale selected state');
  requireExact(result.selected.vector, rows.at(-1).after.vector,
    'active-row witness rejects final trajectory continuity');
  return { startState, evaluatedRows, selectedState };
}

function validateActiveRowContinuationSource({
  raw,
  rawBytes,
  result,
  resultBytes,
  report,
  reportBytes,
  priorResult,
  priorReport,
  fixture,
  problem,
}) {
  for (const [value, label] of [
    [raw, 'raw active-row continuation'],
    [result, 'active-row continuation'],
    [report, 'active-row continuation assay report'],
  ]) verifyCanonicalIdentity(value, label);
  const source = report.source?.admittedActiveRowTrajectory;
  if (
    sha256(rawBytes) !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.rawFileSha256 ||
    sha256(resultBytes) !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.resultFileSha256 ||
    result.identity?.sha256 !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.resultSha256 ||
    sha256(reportBytes) !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.reportFileSha256 ||
    report.identity?.sha256 !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.reportSha256 ||
    !rawBytes.equals(resultBytes) ||
    JSON.stringify(raw) !== JSON.stringify(result) ||
    report.schema !== NBODY_PACKING_ACTIVE_ROW_CONTINUATION_ASSAY_SCHEMA ||
    report.status !== 'complete-active-row-continuation-budget-exhausted' ||
    report.route?.requested !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    report.route?.effective !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    report.route?.fallbackUsed !== false ||
    report.source?.fixtureSha256 !== fixture.identity.sha256 ||
    report.source?.problemSha256 !== problem.identity.sha256 ||
    source?.rawFileSha256 !== FROZEN_ACTIVE_ROW_SOURCE.rawFileSha256 ||
    source?.rawSha256 !== FROZEN_ACTIVE_ROW_SOURCE.resultSha256 ||
    source?.resultFileSha256 !== FROZEN_ACTIVE_ROW_SOURCE.resultFileSha256 ||
    source?.resultSha256 !== FROZEN_ACTIVE_ROW_SOURCE.resultSha256 ||
    source?.reportFileSha256 !== FROZEN_ACTIVE_ROW_SOURCE.reportFileSha256 ||
    source?.reportSha256 !== FROZEN_ACTIVE_ROW_SOURCE.reportSha256 ||
    report.bindings?.rawTrajectoryFileSha256 !== sha256(rawBytes) ||
    report.bindings?.rawTrajectorySha256 !== result.identity.sha256 ||
    report.bindings?.resultFileSha256 !== sha256(resultBytes) ||
    report.bindings?.resultSha256 !== result.identity.sha256
  ) throw new Error('active-row witness rejects substituted continuation source');

  const expectedConfig = createNBodyActiveRowTrustRegionTrajectoryConfig({ iterationBudget:8 });
  const rows = result.work?.rows || [];
  if (
    result.schema !== NBODY_PACKING_ACTIVE_ROW_TRUST_REGION_TRAJECTORY_RESULT_SCHEMA ||
    result.status !== 'active-row-trust-region-trajectory-budget-exhausted' ||
    result.route?.requested !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    result.route?.effective !== ACTIVE_ROW_TRAJECTORY_SOLVER_ROUTE ||
    result.route?.fallbackUsed !== false ||
    result.source?.problemSha256 !== problem.identity.sha256 ||
    JSON.stringify(result.config?.requested) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.config?.effective) !== JSON.stringify(expectedConfig) ||
    JSON.stringify(result.start?.vector) !== JSON.stringify(priorResult.selected.vector) ||
    result.start?.maximumPhysicalResidual !== priorResult.selected.maximumPhysicalResidual ||
    JSON.stringify(result.start?.metrics) !== JSON.stringify(priorResult.selected.metrics) ||
    rows.length !== 8 ||
    result.work?.iterations !== 8 ||
    result.work?.attempts !== 8 ||
    result.work?.terminalReason !== null ||
    rows.some(row => !row.accepted || row.certificate !== null ||
      row.directionConstruction?.activeSetPolicy !== 'family-maximum-relative-band' ||
      row.directionConstruction?.predictedCommonDescent !== true ||
      row.candidateReceipts?.filter(candidate => candidate.selected).length !== 1 ||
      !/^[a-f0-9]{64}$/.test(row.stepResultSha256)) ||
    report.probe?.continuationStartIteration !== priorResult.work.iterations ||
    report.probe?.acceptedIterations !== 8 ||
    report.probe?.attemptedIterations !== 8 ||
    report.probe?.terminalReason !== null ||
    result.mechanism?.oracleTargetCoordinatesConsumed !== false ||
    result.mechanism?.contactGraphRowsConsumed !== true ||
    priorReport.bindings?.resultSha256 !== priorResult.identity.sha256
  ) throw new Error('active-row witness rejects incompatible continuation contract');

  let previous = result.start;
  const evaluatedRows = [];
  for (const row of rows) {
    requireExact(row.before, previous,
      `active-row witness rejects continuation row continuity at ${row.iteration}`);
    const afterState = evaluateNBodyUnifiedKktState({ problem, vector:row.after.vector });
    requireExact(row.after, {
      vector:[...afterState.vector],
      maximumActiveRowViolation:row.after.maximumActiveRowViolation,
      maximumPhysicalResidual:afterState.maximumPhysicalResidual,
      metrics:structuredClone(afterState.metrics),
    }, `active-row witness rejects physical continuation row ${row.iteration}`);
    const selected = row.candidateReceipts.find(candidate => candidate.selected);
    requireExact(selected?.vector, row.after.vector,
      `active-row witness rejects continuation selected candidate ${row.iteration}`);
    if (
      row.after.maximumPhysicalResidual >= row.before.maximumPhysicalResidual ||
      row.after.maximumActiveRowViolation >= row.before.maximumActiveRowViolation ||
      FAMILY_KEYS.some(key => row.after.metrics[key] >
        row.before.metrics[key] + expectedConfig.step.familyRegressionTolerance) ||
      row.after.metrics.endpointDrift !== 0 ||
      row.after.metrics.maximumRelativeVolumeError !== 0
    ) throw new Error(`active-row witness rejects continuation progress at ${row.iteration}`);
    evaluatedRows.push({ row, state:afterState });
    previous = row.after;
  }
  const selectedState = evaluateNBodyUnifiedKktState({ problem, vector:result.selected.vector });
  requireExact(result.selected, {
    vector:[...selectedState.vector],
    maximumActiveRowViolation:result.selected.maximumActiveRowViolation,
    maximumPhysicalResidual:selectedState.maximumPhysicalResidual,
    metrics:structuredClone(selectedState.metrics),
    muscles:selectedState.muscles,
  }, 'active-row witness rejects physically stale continuation selected state');
  requireExact(result.selected.vector, rows.at(-1).after.vector,
    'active-row witness rejects continuation final continuity');
  return { evaluatedRows, selectedState };
}

function continuationState({
  globalIteration,
  label,
  row,
  state,
  baselineState,
  baselineIdentity,
  source,
  previousActiveKeys,
}) {
  const selectedRadius = row.candidateReceipts.find(candidate => candidate.selected)?.radius;
  const activeKeys = row.directionConstruction.activeRows.map(activeRow => activeRow.key);
  const addedKeys = activeKeys.filter(key => !previousActiveKeys.has(key));
  const admission = addedKeys.length > 0
    ? ` ${addedKeys.length} newly binding row${addedKeys.length === 1 ? '' : 's'} enter the active set.`
    : '';
  return [`active-row-step-${globalIteration}`, {
    label,
    severity:0.32,
    status:'accepted active-row continuation step',
    warning:true,
    source,
    muscles:state.muscles,
    metrics:state.metrics,
    comparisonOverlay:{
      baselineState:'active-row-step-8',
      baselineLabel:'admitted step 8',
      baselineResultIdentitySha256:baselineIdentity,
      targetStepIdentitySha256:row.stepResultSha256,
      displayGain:35,
      maximumWorldDisplacement:maximumCenterlineDisplacement(
        baselineState.muscles,
        state.muscles,
      ),
      rendering:'true-position-cross-section-rings-and-amplified-vectors-v0',
    },
    comparisonNote:`step-8 rings at true position · displacement vectors ×35 display-only · ${activeKeys.length} active rows · selected radius ${selectedRadius}`,
    truth:`Global step ${globalIteration} accepts common descent over ${activeKeys.length} active rows at radius ${selectedRadius}.${admission} Endpoints and volumes remain exact; residual debt remains visible.`,
  }];
}

function trajectoryState({
  key,
  label,
  row,
  state,
  baselineState,
  baselineIdentity,
  source,
}) {
  const selectedRadius = row.candidateReceipts.find(candidate => candidate.selected)?.radius;
  const activeCount = row.directionConstruction.activeRows.length;
  return [key, {
    label,
    severity:0.32,
    status:'accepted active-row step',
    warning:true,
    source,
    muscles:state.muscles,
    metrics:state.metrics,
    comparisonOverlay:{
      baselineState:'authenticated-adaptive-start',
      baselineLabel:'authenticated adaptive start',
      baselineResultIdentitySha256:baselineIdentity,
      targetStepIdentitySha256:row.stepResultSha256,
      displayGain:35,
      maximumWorldDisplacement:maximumCenterlineDisplacement(
        baselineState.muscles,
        state.muscles,
      ),
      rendering:'true-position-cross-section-rings-and-amplified-vectors-v0',
    },
    comparisonNote:`adaptive-start rings at true position · displacement vectors ×35 display-only · ${activeCount} active rows · selected radius ${selectedRadius}`,
    truth:`Iteration ${row.iteration} accepts simultaneous common descent over ${activeCount} family-maximum active rows at radius ${selectedRadius}. Carrier volumes and endpoints remain exact; unresolved debt remains visible.`,
  }];
}

export async function writeNBodyPackingActiveRowTrajectoryWitness({
  outDir = 'artifacts/nbody-packing-active-row-trust-region-trajectory-viewer-v0',
  activeRowRawPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/raw-trajectory.json',
  activeRowResultPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/result.json',
  activeRowReportPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/run-report.json',
  io = { writeFile, rename },
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'invalidate-prior-primary';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    await invalidatePrimaries(outputRoot);
    phase = 'read-active-row-source';
    const [rawBytes, resultBytes, reportBytes] = await Promise.all([
      readFile(path.resolve(activeRowRawPath)),
      readFile(path.resolve(activeRowResultPath)),
      readFile(path.resolve(activeRowReportPath)),
    ]);
    const raw = JSON.parse(String(rawBytes));
    const result = JSON.parse(String(resultBytes));
    const sourceReport = JSON.parse(String(reportBytes));
    lastTrustworthyEvidence = {
      phase:'active-row-source-read',
      rawFileSha256:sha256(rawBytes),
      resultFileSha256:sha256(resultBytes),
      resultSha256:result.identity?.sha256 || null,
      reportFileSha256:sha256(reportBytes),
      reportSha256:sourceReport.identity?.sha256 || null,
    };

    phase = 'bind-active-row-source';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      candidate => candidate.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const validation = validateActiveRowSource({
      raw,
      rawBytes,
      result,
      resultBytes,
      report:sourceReport,
      reportBytes,
      fixture,
      problem,
    });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'active-row-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
    };

    phase = 'construct-projection';
    const source = fixture.knownFeasible;
    const baselineIdentity = sourceReport.source.authenticatedAdaptiveTrajectory.resultSha256;
    const rowByIteration = new Map(validation.evaluatedRows.map(entry => [entry.row.iteration, entry]));
    const states = Object.fromEntries([
      ['authenticated-adaptive-start', {
        label:'authenticated adaptive start',
        severity:0.32,
        status:'admitted adaptive trajectory endpoint',
        warning:true,
        source,
        muscles:validation.startState.muscles,
        metrics:validation.startState.metrics,
        truth:'This is the exact admitted adaptive endpoint consumed by the active-row trajectory. It is the physical A/B baseline, not a replayed solve.',
      }],
      ...SELECTED_ITERATIONS.map(iteration => {
        const entry = rowByIteration.get(iteration);
        const label = iteration === 3
          ? 'step 3 · first full-radius jump'
          : iteration === 7
            ? 'step 7 · late full-radius move'
            : iteration === 8
              ? 'step 8 · admitted final'
              : 'step 1 · first active-row move';
        return trajectoryState({
          key:`active-row-step-${iteration}`,
          label,
          row:entry.row,
          state:entry.state,
          baselineState:validation.startState,
          baselineIdentity,
          source,
        });
      }),
      ['manufactured-reference', {
        label:'manufactured feasibility witness',
        severity:null,
        status:'existence witness outside candidate carrier',
        warning:false,
        source,
        muscles:fixture.knownFeasible.muscles,
        metrics:fixture.metrics.knownFeasible,
        truth:'This withheld manufactured state proves fixture feasibility only. It is not an anatomical target and is not consumed by the candidate solver.',
      }],
    ]);
    const orderedStates = Object.keys(states);
    const fixtures = {
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
      manufacturedReference:fixture.knownFeasible,
    };
    const comparison = {
      activeRowTrajectory:result,
      activeRowAssayReport:sourceReport,
      projectedIterations:[...SELECTED_ITERATIONS],
      presentation:{ solverReplayed:false, physicalStatesReevaluated:true },
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const payload = {
      states,
      mechanism:{
        oracleTargetCoordinatesConsumed:result.mechanism.oracleTargetCoordinatesConsumed,
        contactGraphRowsConsumed:result.mechanism.contactGraphRowsConsumed,
      },
      display:{
        title:'Active-row trust-region trajectory · six-body hard boundary',
        authority:'Synthetic severity-0.32 mechanism witness · admitted source projection · no anatomical admission',
        explanation:'The exact authenticated adaptive endpoint is compared with four physically reevaluated accepted states from the admitted active-row trajectory. Cross-section rings stay at the baseline position; arrows are display-only amplification. Step 3 and step 7 are the two large-radius moves. Step 8 is the admitted budget endpoint, not a convergence claim.',
        orderedStates,
        defaultState:'active-row-step-8',
      },
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        effective:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        fallbackUsed:false,
      },
      classification:{
        acceptedIterations:result.work.iterations,
        attemptedIterations:result.work.attempts,
        terminalReason:result.work.terminalReason,
        solverReplayedForPresentation:false,
        physicalProjectionCount:SELECTED_ITERATIONS.length + 1,
        selectedRadii:structuredClone(sourceReport.probe.selectedRadii),
        mechanismInputs:structuredClone(payload.mechanism),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        activeRowRawFileSha256:sha256(rawBytes),
        activeRowResultFileSha256:sha256(resultBytes),
        activeRowResultIdentitySha256:result.identity.sha256,
        activeRowReportFileSha256:sha256(reportBytes),
        activeRowReportIdentitySha256:sourceReport.identity.sha256,
        authenticatedAdaptiveResultIdentitySha256:baselineIdentity,
      },
      requiredStates:orderedStates,
      requiredModes:['volume', 'slice'],
      claimCeiling:{
        admittedClaim:'eight accepted trust-region steps recompute simultaneous common descent over family-maximum active rows and reduce every tracked residual family from the authenticated adaptive endpoint while preserving exact endpoints and volume; the run is budget exhausted without a terminal certificate, so this is progress evidence rather than convergence, feasibility, or carrier-limit evidence',
        anatomicalAdmission:'none',
        nonGoals:[
          'global-feasibility',
          'carrier-representation-impossibility',
          'anatomical-plausibility',
          'arbitrary-N-closure',
          'fascia-composition',
          'production-admission',
        ],
      },
    };
    const witnessReport = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['fixtures.json', fixtureBytes],
      ['comparison.json', comparisonBytes],
      ['index.html', htmlBytes],
      ['report.json', jsonBytes(witnessReport)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, report:witnessReport, states };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure), io);
    throw error;
  }
}

export async function writeNBodyPackingActiveRowContinuationWitness({
  outDir = 'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-viewer-v0',
  activeRowRawPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/raw-trajectory.json',
  activeRowResultPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/result.json',
  activeRowReportPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-v0/run-report.json',
  continuationRawPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/raw-trajectory.json',
  continuationResultPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/result.json',
  continuationReportPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/run-report.json',
  io = { writeFile, rename },
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'invalidate-prior-primary';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    await invalidatePrimaries(outputRoot);
    phase = 'read-active-row-continuation-source';
    const [
      priorRawBytes, priorResultBytes, priorReportBytes,
      continuationRawBytes, continuationResultBytes, continuationReportBytes,
    ] = await Promise.all([
      readFile(path.resolve(activeRowRawPath)),
      readFile(path.resolve(activeRowResultPath)),
      readFile(path.resolve(activeRowReportPath)),
      readFile(path.resolve(continuationRawPath)),
      readFile(path.resolve(continuationResultPath)),
      readFile(path.resolve(continuationReportPath)),
    ]);
    const priorRaw = JSON.parse(String(priorRawBytes));
    const priorResult = JSON.parse(String(priorResultBytes));
    const priorReport = JSON.parse(String(priorReportBytes));
    const continuationRaw = JSON.parse(String(continuationRawBytes));
    const continuationResult = JSON.parse(String(continuationResultBytes));
    const continuationReport = JSON.parse(String(continuationReportBytes));
    lastTrustworthyEvidence = {
      phase:'active-row-continuation-source-read',
      priorResultFileSha256:sha256(priorResultBytes),
      priorResultSha256:priorResult.identity?.sha256 || null,
      continuationResultFileSha256:sha256(continuationResultBytes),
      continuationResultSha256:continuationResult.identity?.sha256 || null,
      continuationReportFileSha256:sha256(continuationReportBytes),
      continuationReportSha256:continuationReport.identity?.sha256 || null,
    };

    phase = 'bind-active-row-continuation-source';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      candidate => candidate.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const priorValidation = validateActiveRowSource({
      raw:priorRaw,
      rawBytes:priorRawBytes,
      result:priorResult,
      resultBytes:priorResultBytes,
      report:priorReport,
      reportBytes:priorReportBytes,
      fixture,
      problem,
    });
    const continuationValidation = validateActiveRowContinuationSource({
      raw:continuationRaw,
      rawBytes:continuationRawBytes,
      result:continuationResult,
      resultBytes:continuationResultBytes,
      report:continuationReport,
      reportBytes:continuationReportBytes,
      priorResult,
      priorReport,
      fixture,
      problem,
    });
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'active-row-continuation-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
    };

    phase = 'construct-continuation-projection';
    const source = fixture.knownFeasible;
    const rowByIteration = new Map(continuationValidation.evaluatedRows.map(
      entry => [entry.row.iteration, entry],
    ));
    const priorActiveKeys = new Set(
      priorResult.work.rows.at(-1).directionConstruction.activeRows.map(row => row.key),
    );
    const states = {
      'active-row-step-8':{
        label:'step 8 · admitted continuation start',
        severity:0.32,
        status:'admitted active-row budget endpoint',
        warning:true,
        source,
        muscles:priorValidation.selectedState.muscles,
        metrics:priorValidation.selectedState.metrics,
        truth:'This is the exact admitted step-eight endpoint consumed by the continuation. It is the physical baseline, not a replayed solve.',
      },
    };
    for (const { local, global } of SELECTED_CONTINUATION_ITERATIONS) {
      const entry = rowByIteration.get(local);
      const previousActive = local === 1
        ? priorActiveKeys
        : new Set(continuationResult.work.rows[local - 2]
          .directionConstruction.activeRows.map(row => row.key));
      const label = global === 11
        ? 'step 11 · eighth row admitted'
        : global === 12
          ? 'step 12 · ninth row admitted'
          : global === 16
            ? 'step 16 · continuation endpoint'
            : 'step 9 · continuation begins';
      const [key, value] = continuationState({
        globalIteration:global,
        label,
        row:entry.row,
        state:entry.state,
        baselineState:priorValidation.selectedState,
        baselineIdentity:priorResult.identity.sha256,
        source,
        previousActiveKeys:previousActive,
      });
      states[key] = value;
    }
    states['manufactured-reference'] = {
      label:'manufactured feasibility witness',
      severity:null,
      status:'existence witness outside candidate carrier',
      warning:false,
      source,
      muscles:fixture.knownFeasible.muscles,
      metrics:fixture.metrics.knownFeasible,
      truth:'This withheld manufactured state proves fixture feasibility only. It is not an anatomical target and is not consumed by the candidate solver.',
    };
    const orderedStates = Object.keys(states);
    const finalActiveKeys = new Set(continuationResult.work.rows.at(-1)
      .directionConstruction.activeRows.map(row => row.key));
    const finalPhysical = evaluateNBodyUnifiedKktState({
      problem,
      vector:continuationResult.selected.vector,
    });
    const finalViolatedRows = finalPhysical.rows.filter(row => row.signedGap <= 0);
    const finalFamilyMaxima = Object.fromEntries(
      [...new Set(finalViolatedRows.map(row => row.kind))].sort().map(kind => [
        kind,
        Math.max(...finalViolatedRows
          .filter(row => row.kind === kind)
          .map(row => Math.max(0, -row.signedGap))),
      ]),
    );
    const relativeActivationBand =
      continuationResult.config.effective.step.relativeActivationBand;
    const postStepEligibleRows = finalViolatedRows.filter(row =>
      Math.max(0, -row.signedGap) >=
        finalFamilyMaxima[row.kind] * (1 - relativeActivationBand),
    );
    const postStepNewlyEligibleRows = postStepEligibleRows
      .filter(row => !finalActiveKeys.has(row.key))
      .map(row => {
        const violation = Math.max(0, -row.signedGap);
        const familyMaximum = finalFamilyMaxima[row.kind];
        return {
          key:row.key,
          kind:row.kind,
          violation,
          familyMaximum,
          activationThreshold:familyMaximum * (1 - relativeActivationBand),
          relativeToFamilyMaximum:violation / familyMaximum,
        };
      })
      .sort((left, right) => left.key.localeCompare(right.key));
    const fixtures = {
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
      manufacturedReference:fixture.knownFeasible,
    };
    const comparison = {
      admittedStepEightTrajectory:priorResult,
      admittedStepEightReport:priorReport,
      continuationTrajectory:continuationResult,
      continuationReport,
      projectedGlobalIterations:SELECTED_CONTINUATION_ITERATIONS.map(row => row.global),
      presentation:{ solverReplayed:false, physicalStatesReevaluated:true },
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const payload = {
      states,
      mechanism:{
        oracleTargetCoordinatesConsumed:
          continuationResult.mechanism.oracleTargetCoordinatesConsumed,
        contactGraphRowsConsumed:
          continuationResult.mechanism.contactGraphRowsConsumed,
      },
      display:{
        title:'Step-eight continuation · active-set accretion',
        authority:'Synthetic severity-0.32 continuation witness · admitted source projection · no anatomical admission',
        explanation:'The exact admitted step-eight endpoint is compared with four physically reevaluated continuation states. Step 11 admits an eighth active row; step 12 admits a ninth. Rings stay at step-eight position and arrows use display-only amplification. Step 16 is another budget endpoint, not convergence or a floor certificate.',
        orderedStates,
        defaultState:'active-row-step-16',
      },
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
    }));
    const activeRowCounts = [
      priorResult.work.rows.at(-1).directionConstruction.activeRows.length,
      ...SELECTED_CONTINUATION_ITERATIONS.map(({ local }) =>
        continuationResult.work.rows[local - 1].directionConstruction.activeRows.length),
    ];
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        effective:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        fallbackUsed:false,
      },
      classification:{
        continuationStartIteration:priorResult.work.iterations,
        continuationAcceptedIterations:continuationResult.work.iterations,
        terminalReason:continuationResult.work.terminalReason,
        solverReplayedForPresentation:false,
        physicalProjectionCount:SELECTED_CONTINUATION_ITERATIONS.length + 1,
        activeRowCounts,
        minimumNormStart:
          continuationResult.work.rows[0].directionConstruction.minimumNorm,
        minimumNormSelected:
          continuationResult.work.rows.at(-1).directionConstruction.minimumNorm,
        lastStepActiveRowCount:finalActiveKeys.size,
        postStepEligibleActiveRowCount:postStepEligibleRows.length,
        postStepNewlyEligibleRows,
        mechanismInputs:structuredClone(payload.mechanism),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        priorResultFileSha256:sha256(priorResultBytes),
        priorResultIdentitySha256:priorResult.identity.sha256,
        priorReportFileSha256:sha256(priorReportBytes),
        priorReportIdentitySha256:priorReport.identity.sha256,
        continuationRawFileSha256:sha256(continuationRawBytes),
        continuationResultFileSha256:sha256(continuationResultBytes),
        continuationResultIdentitySha256:continuationResult.identity.sha256,
        continuationReportFileSha256:sha256(continuationReportBytes),
        continuationReportIdentitySha256:continuationReport.identity.sha256,
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling:{
        admittedClaim:'eight exact-source continuation steps remain family-monotone while the active set grows from six rows at the admitted step-eight boundary to nine rows and the common-descent minimum norm weakens; this is bounded progress and constraint-cone-tightening evidence, not convergence, cycling, feasibility, or a local-floor certificate',
        anatomicalAdmission:'none',
        nonGoals:[
          'global-feasibility',
          'carrier-representation-impossibility',
          'anatomical-plausibility',
          'arbitrary-N-closure',
          'fascia-composition',
          'production-admission',
        ],
      },
    };
    const witnessReport = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['fixtures.json', fixtureBytes],
      ['comparison.json', comparisonBytes],
      ['index.html', htmlBytes],
      ['report.json', jsonBytes(witnessReport)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, report:witnessReport, states };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_ACTIVE_ROW_TRAJECTORY_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure), io);
    throw error;
  }
}

export async function writeNBodyPackingElasticAllRowComparatorWitness({
  outDir = 'artifacts/nbody-packing-active-row-elastic-all-row-comparator-viewer-v0',
  sourceRawPath =
    'artifacts/nbody-packing-active-row-trust-region-trajectory-continuation-v0/raw-trajectory.json',
  comparatorResultPath =
    'artifacts/nbody-packing-active-row-elastic-all-row-comparator-v0/result.json',
  comparatorReportPath =
    'artifacts/nbody-packing-active-row-elastic-all-row-comparator-v0/run-report.json',
  io = { writeFile, rename },
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'invalidate-prior-primary';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    await invalidatePrimaries(outputRoot);
    phase = 'read-elastic-comparator-source';
    const [sourceBytes, resultBytes, reportBytes] = await Promise.all([
      readFile(path.resolve(sourceRawPath)),
      readFile(path.resolve(comparatorResultPath)),
      readFile(path.resolve(comparatorReportPath)),
    ]);
    const sourceTrajectory = JSON.parse(String(sourceBytes));
    const result = JSON.parse(String(resultBytes));
    const sourceReport = JSON.parse(String(reportBytes));
    verifyCanonicalIdentity(sourceTrajectory, 'elastic comparator trajectory source');
    verifyCanonicalIdentity(result, 'elastic comparator result');
    verifyCanonicalIdentity(sourceReport, 'elastic comparator report');
    lastTrustworthyEvidence = {
      phase:'elastic-comparator-source-read',
      sourceFileSha256:sha256(sourceBytes),
      sourceSha256:sourceTrajectory.identity?.sha256 || null,
      resultFileSha256:sha256(resultBytes),
      resultSha256:result.identity?.sha256 || null,
      reportFileSha256:sha256(reportBytes),
      reportSha256:sourceReport.identity?.sha256 || null,
    };

    phase = 'bind-elastic-comparator-source';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      candidate => candidate.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    if (
      sha256(sourceBytes) !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.rawFileSha256 ||
      sourceTrajectory.identity.sha256 !== FROZEN_ACTIVE_ROW_CONTINUATION_SOURCE.resultSha256 ||
      result.schema !== NBODY_PACKING_ELASTIC_ALL_ROW_RAW_PAIR_SCHEMA ||
      result.status !== 'complete-equal-budget-pair-admitted' ||
      result.route?.fallbackUsed !== false ||
      result.source?.problemSha256 !== problem.identity.sha256 ||
      result.source?.trajectorySha256 !== sourceTrajectory.identity.sha256 ||
      sourceReport.schema !== NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_ASSAY_SCHEMA ||
      sourceReport.status !== 'complete-equal-budget-pair-admitted' ||
      sourceReport.bindings?.resultFileSha256 !== sha256(resultBytes) ||
      sourceReport.bindings?.resultSha256 !== result.identity.sha256
    ) throw new Error('elastic comparator witness rejects substituted result or source binding');
    const sourceState = evaluateNBodyUnifiedKktState({
      problem,
      vector:sourceTrajectory.selected.vector,
    });
    const controlState = evaluateNBodyUnifiedKktState({
      problem,
      vector:result.control.selected.vector,
    });
    const comparatorState = evaluateNBodyUnifiedKktState({
      problem,
      vector:result.comparator.selected.vector,
    });
    requireExact(controlState.metrics, result.control.selected.metrics,
      'elastic comparator witness rejects stale control physics');
    requireExact(comparatorState.metrics, result.comparator.selected.metrics,
      'elastic comparator witness rejects stale comparator physics');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'elastic-comparator-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
    };

    phase = 'construct-elastic-comparator-projection';
    const source = fixture.knownFeasible;
    const decision = result.decision;
    const stateRows = [
      ['step-16-source', 'step 16 · shared source', sourceState,
        decision.sourceAllRowSquaredViolationEnergy,
        decision.sourceLowerWallViolation,
        'Exact shared crowded state. Both arms begin here with the same 24-coordinate carrier and source identity.'],
      ['active-row-control', 'active-row · one more step', controlState,
        decision.controlAllRowSquaredViolationEnergy,
        decision.controlLowerWallViolation,
        'Strict common descent recomputed ten eligible rows and spent 69 physical evaluations.'],
      ['elastic-all-row-comparator', 'elastic all-row · one step', comparatorState,
        decision.comparatorAllRowSquaredViolationEnergy,
        decision.comparatorLowerWallViolation,
        'Explicit-slack all-row linearization consumed all 531 rows and spent the same 69 physical evaluations.'],
    ];
    const states = Object.fromEntries(stateRows.map(([
      key, label, state, energy, lowerWallViolation, truth,
    ]) => [key, {
      label,
      severity:0.32,
      status:key === 'step-16-source'
        ? 'shared architecture-assay source'
        : key === 'active-row-control'
          ? result.control.status
          : result.comparator.status,
      warning:true,
      source,
      muscles:state.muscles,
      metrics:state.metrics,
      ...(key === 'step-16-source' ? {} : {
        comparisonOverlay:{
          baselineState:'step-16-source',
          baselineLabel:'step 16 source',
          baselineResultIdentitySha256:sourceTrajectory.identity.sha256,
          targetStepIdentitySha256:key === 'active-row-control'
            ? result.control.identity.sha256
            : result.comparator.identity.sha256,
          displayGain:60,
          maximumWorldDisplacement:maximumCenterlineDisplacement(
            sourceState.muscles,
            state.muscles,
          ),
          rendering:'true-position-cross-section-rings-and-amplified-vectors-v0',
        },
      }),
      comparisonNote:`all-row energy ${energy} · lower-wall violation ${lowerWallViolation} · true surface position · arrows ×60 display-only`,
      truth:`${truth} Surfaces remain at true coordinates; use volume and slice modes plus orbit before judging formation.`,
    }]));
    const orderedStates = stateRows.map(([key]) => key);
    const fixtures = {
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const comparison = {
      result,
      report:sourceReport,
      presentation:{ solverReplayed:false, physicalStatesReevaluated:true },
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const payload = {
      states,
      mechanism:{
        oracleTargetCoordinatesConsumed:false,
        contactGraphRowsConsumed:true,
      },
      display:{
        title:'Step 16 · strict active set versus elastic all-row',
        authority:'Equal-budget synthetic architecture falsifier · 69 evaluations per arm · no anatomical admission',
        explanation:'One shared crowded state, one strict ten-row common-descent control, and one explicit-slack 531-row comparator. Geometry is rendered at true position with stable colors. Cross-section rings and arrows reveal subtle displacement but are display-only; the translucent surface is the physical output.',
        orderedStates,
        defaultState:'elastic-all-row-comparator',
      },
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE,
        effective:NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE,
        fallbackUsed:false,
      },
      classification:{
        decision:structuredClone(decision),
        solverReplayedForPresentation:false,
        physicalProjectionCount:3,
        mechanismInputs:structuredClone(payload.mechanism),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        sourceFileSha256:sha256(sourceBytes),
        sourceIdentitySha256:sourceTrajectory.identity.sha256,
        resultFileSha256:sha256(resultBytes),
        resultIdentitySha256:result.identity.sha256,
        reportFileSha256:sha256(reportBytes),
        reportIdentitySha256:sourceReport.identity.sha256,
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling:{
        admittedClaim:'same-camera true-position visual comparison of one equal-budget source-bound control/comparator step',
        anatomicalAdmission:'none',
        nonGoals:[
          'production-architecture-selection',
          'global-convergence',
          'carrier-sufficiency',
          'anatomical-plausibility',
          'arbitrary-N-closure',
          'fascia-composition',
        ],
      },
    };
    const witnessReport = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['fixtures.json', fixtureBytes],
      ['comparison.json', comparisonBytes],
      ['index.html', htmlBytes],
      ['report.json', jsonBytes(witnessReport)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, report:witnessReport, states };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_ELASTIC_ALL_ROW_COMPARATOR_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure), io);
    throw error;
  }
}

function elasticExchangeSelectedRadius(row) {
  const attempt = row.regime === 'elastic-all-row'
    ? row.attempts?.elastic
    : row.attempts?.strict;
  return attempt?.selected?.radius ??
    attempt?.work?.candidateReceipts?.find(candidate => candidate.selected)?.radius ??
    attempt?.candidateReceipts?.find(candidate => candidate.selected)?.radius ?? null;
}

function elasticExchangeOrderedRows(state) {
  return [...state.rows]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(row => ({
      key:row.key,
      kind:row.kind,
      signedGap:row.signedGap,
      violation:Math.max(0, -row.signedGap),
    }));
}

function elasticExchangeDebtSummary(row) {
  const families = Object.fromEntries(Object.entries(row.familyDebt || {}).map(
    ([key, value]) => [key, {
      borrowed:value.borrowed,
      repaid:value.repaid,
      outstandingAfter:value.outstandingAfter,
    }],
  ));
  const changedRows = (row.rowDebt || [])
    .filter(value => value.borrowed > 0 || value.repaid > 0)
    .sort((left, right) =>
      Math.max(right.borrowed, right.repaid) - Math.max(left.borrowed, left.repaid))
    .slice(0, 8)
    .map(value => ({
      key:value.key,
      kind:value.kind,
      borrowed:value.borrowed,
      repaid:value.repaid,
      outstandingAfter:value.outstandingAfter,
    }));
  return { families, changedRows };
}

export async function writeNBodyPackingElasticExchangeTrajectoryWitness({
  outDir = 'artifacts/nbody-packing-elastic-exchange-trajectory-viewer-v0',
  canonicalRawPath =
    'artifacts/nbody-packing-elastic-exchange-trajectory-v0/canonical-raw.json',
  reverseRawPath =
    'artifacts/nbody-packing-elastic-exchange-trajectory-v0/reverse-raw.json',
  runReportPath =
    'artifacts/nbody-packing-elastic-exchange-trajectory-v0/run-report.json',
  io = { writeFile, rename },
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'invalidate-prior-primary';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    await invalidatePrimaries(outputRoot);
    phase = 'read-elastic-exchange-trajectory-source';
    const [canonicalBytes, reverseBytes, reportBytes] = await Promise.all([
      readFile(path.resolve(canonicalRawPath)),
      readFile(path.resolve(reverseRawPath)),
      readFile(path.resolve(runReportPath)),
    ]);
    const canonical = JSON.parse(String(canonicalBytes));
    const reverse = JSON.parse(String(reverseBytes));
    const sourceReport = JSON.parse(String(reportBytes));
    verifyCanonicalIdentity(canonical, 'elastic-exchange canonical trajectory');
    verifyCanonicalIdentity(reverse, 'elastic-exchange reverse trajectory');
    lastTrustworthyEvidence = {
      phase:'elastic-exchange-trajectory-source-read',
      canonicalFileSha256:sha256(canonicalBytes),
      canonicalSha256:canonical.identity.sha256,
      reverseFileSha256:sha256(reverseBytes),
      reverseSha256:reverse.identity.sha256,
      reportFileSha256:sha256(reportBytes),
    };

    phase = 'bind-elastic-exchange-trajectory-source';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      candidate => candidate.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const expectedAlgorithm = 'strict-active-row-then-elastic-all-row-debt-trajectory-v0';
    if (
      canonical.schema !== NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA ||
      reverse.schema !== NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA ||
      canonical.route?.requested !== expectedAlgorithm ||
      canonical.route?.effective !== expectedAlgorithm ||
      canonical.route?.fallbackUsed !== false ||
      reverse.route?.requested !== expectedAlgorithm ||
      reverse.route?.effective !== expectedAlgorithm ||
      reverse.route?.fallbackUsed !== false ||
      canonical.source?.problemSha256 !== problem.identity.sha256 ||
      reverse.source?.problemSha256 !== problem.identity.sha256 ||
      canonical.config?.effective?.strictStep?.candidateEnumeration !== 'canonical' ||
      canonical.config?.effective?.elasticStep?.candidateEnumeration !== 'canonical' ||
      reverse.config?.effective?.strictStep?.candidateEnumeration !== 'reverse' ||
      reverse.config?.effective?.elasticStep?.candidateEnumeration !== 'reverse' ||
      sourceReport.schema !== 'kaminos.elastic-exchange-canonical-trajectory-run.v0' ||
      sourceReport.status !== 'complete-canonical-reverse-physical-parity' ||
      sourceReport.route?.fallbackUsed !== false ||
      sourceReport.bindings?.canonicalSha256 !== canonical.identity.sha256 ||
      sourceReport.bindings?.reverseSha256 !== reverse.identity.sha256 ||
      sourceReport.bindings?.selectedVectorSha256 !==
        hashMusclePackingCanonicalJson(canonical.selected.vector) ||
      sourceReport.bindings?.selectedMetricsSha256 !==
        hashMusclePackingCanonicalJson(canonical.selected.metrics) ||
      JSON.stringify(canonical.selected.vector) !== JSON.stringify(reverse.selected.vector) ||
      JSON.stringify(canonical.selected.metrics) !== JSON.stringify(reverse.selected.metrics) ||
      canonical.work?.terminalClass !== reverse.work?.terminalClass ||
      canonical.work?.acceptedTransitions !== reverse.work?.acceptedTransitions ||
      canonical.work?.rows?.length !== canonical.work?.acceptedTransitions ||
      sourceReport.decision?.terminalClass !== canonical.work?.terminalClass
    ) throw new Error('elastic-exchange trajectory witness rejects substituted or non-parity source');

    const reevaluate = (stored, label) => {
      const state = evaluateNBodyUnifiedKktState({ problem, vector:stored.vector });
      requireExact(state.metrics, stored.metrics,
        `elastic-exchange trajectory witness rejects stale ${label} metrics`);
      if (stored.muscles) requireExact(state.muscles, stored.muscles,
        `elastic-exchange trajectory witness rejects stale ${label} geometry`);
      requireExact(elasticExchangeOrderedRows(state), stored.rows,
        `elastic-exchange trajectory witness rejects stale ${label} row ledger`);
      return state;
    };
    const startState = reevaluate(canonical.start, 'start');
    const evaluatedRows = canonical.work.rows.map(row => ({
      row,
      state:reevaluate(row.after, `step ${row.iteration}`),
    }));
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'elastic-exchange-trajectory-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      acceptedTransitions:evaluatedRows.length,
      terminalClass:canonical.work.terminalClass,
    };

    phase = 'construct-elastic-exchange-trajectory-projection';
    const source = fixture.knownFeasible;
    const orderedStates = [
      'step-16-source',
      ...evaluatedRows.map(({ row }) => `elastic-exchange-step-${row.iteration}`),
    ];
    const states = {
      'step-16-source':{
        label:'step 16 · crowded source',
        severity:0.32,
        status:'shared elastic-exchange trajectory source',
        warning:true,
        source,
        muscles:startState.muscles,
        metrics:startState.metrics,
        comparisonNote:`all-row energy ${canonical.start.allRowSquaredViolationEnergy} · maximum residual ${canonical.start.maximumPhysicalResidual} · exact trajectory source`,
        truth:'This is the exact crowded state consumed by both enumeration arms. It is rendered at true physical position and contains no display displacement.',
      },
      ...Object.fromEntries(evaluatedRows.map(({ row, state }) => {
        const key = `elastic-exchange-step-${row.iteration}`;
        const debt = elasticExchangeDebtSummary(row);
        const radius = elasticExchangeSelectedRadius(row);
        const terminal = row.iteration === canonical.work.terminalEvidence?.iteration
          ? ` This accepted state triggers ${canonical.work.terminalClass}: the contact graph repeats while all-row energy rises versus iteration ${canonical.work.terminalEvidence.priorIteration}.`
          : '';
        return [key, {
          label:`step ${row.iteration} · ${row.regime === 'elastic-all-row' ? 'elastic escape' : 'strict repayment'}`,
          severity:0.32,
          status:row.iteration === canonical.work.terminalEvidence?.iteration
            ? canonical.work.terminalClass
            : `accepted ${row.regime}`,
          warning:true,
          source,
          muscles:state.muscles,
          metrics:state.metrics,
          comparisonOverlay:{
            baselineState:'step-16-source',
            baselineLabel:'step 16 source',
            baselineResultIdentitySha256:canonical.start.stateIdentity,
            targetStepIdentitySha256:row.stepIdentity,
            displayGain:60,
            maximumWorldDisplacement:maximumCenterlineDisplacement(
              startState.muscles,
              state.muscles,
            ),
            rendering:'true-position-cross-section-rings-and-amplified-vectors-v0',
          },
          comparisonNote:`${row.regime} · radius ${radius} · all-row energy ${row.after.allRowSquaredViolationEnergy} · maximum residual ${row.after.maximumPhysicalResidual} · family and changed-row debt in comparison ledger · arrows ×60 display-only`,
          truth:`Iteration ${row.iteration} accepts one ${row.regime} transition. Endpoint identity and per-muscle volume remain exact. Family and row borrowing are preserved independently; the surface stays at true coordinates.${terminal}`,
          debt,
        }];
      })),
    };
    const comparison = {
      canonical:{
        identity:structuredClone(canonical.identity),
        source:structuredClone(canonical.source),
        config:structuredClone(canonical.config),
        start:{
          stateIdentity:canonical.start.stateIdentity,
          allRowSquaredViolationEnergy:canonical.start.allRowSquaredViolationEnergy,
          maximumPhysicalResidual:canonical.start.maximumPhysicalResidual,
        },
        work:{
          attempts:canonical.work.attempts,
          acceptedTransitions:canonical.work.acceptedTransitions,
          strictAccepted:canonical.work.strictAccepted,
          elasticAccepted:canonical.work.elasticAccepted,
          terminalClass:canonical.work.terminalClass,
          terminalEvidence:structuredClone(canonical.work.terminalEvidence),
          totalPhysicalEvaluations:canonical.work.totalPhysicalEvaluations,
          rows:canonical.work.rows.map(row => ({
            iteration:row.iteration,
            regime:row.regime,
            accepted:row.accepted,
            sourceStateIdentity:row.sourceStateIdentity,
            selectedStateIdentity:row.selectedStateIdentity,
            contactGraphIdentity:row.contactGraphIdentity,
            stepIdentity:row.stepIdentity,
            trajectoryPrefixIdentity:row.trajectoryPrefixIdentity,
            before:{
              allRowSquaredViolationEnergy:row.before.allRowSquaredViolationEnergy,
              maximumPhysicalResidual:row.before.maximumPhysicalResidual,
            },
            after:{
              allRowSquaredViolationEnergy:row.after.allRowSquaredViolationEnergy,
              maximumPhysicalResidual:row.after.maximumPhysicalResidual,
            },
            debt:elasticExchangeDebtSummary(row),
          })),
        },
      },
      reverse:{
        identity:structuredClone(reverse.identity),
        config:structuredClone(reverse.config),
        selectedStateIdentity:reverse.selected.stateIdentity,
        terminalClass:reverse.work.terminalClass,
      },
      runReport:structuredClone(sourceReport),
      presentation:{ solverReplayed:false, physicalStatesReevaluated:true },
    };
    const fixtures = {
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const payload = {
      states,
      mechanism:{
        oracleTargetCoordinatesConsumed:false,
        contactGraphRowsConsumed:true,
      },
      display:{
        title:'Elastic exchange trajectory · borrowing, repayment, cycle',
        authority:'Canonical/reverse parity-bound synthetic trajectory · complete physical row custody · no anatomical admission',
        explanation:'One exact crowded source, one elastic escape, and every accepted strict repayment state. Surfaces are rendered at true position with stable colors. Cross-section rings and arrows expose subtle motion at ×60 display gain only. The final state is shown because the repeated contact graph and worsening all-row energy are the mechanism failure, not because it is a preferred packing result.',
        orderedStates,
        defaultState:orderedStates.at(-1),
      },
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
        effective:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
        fallbackUsed:false,
      },
      classification:{
        terminalClass:canonical.work.terminalClass,
        terminalEvidence:structuredClone(canonical.work.terminalEvidence),
        acceptedTransitions:canonical.work.acceptedTransitions,
        strictAccepted:canonical.work.strictAccepted,
        elasticAccepted:canonical.work.elasticAccepted,
        canonicalReversePhysicalParity:true,
        solverReplayedForPresentation:false,
        physicalProjectionCount:orderedStates.length,
        mechanismInputs:structuredClone(payload.mechanism),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        canonicalFileSha256:sha256(canonicalBytes),
        canonicalIdentitySha256:canonical.identity.sha256,
        reverseFileSha256:sha256(reverseBytes),
        reverseIdentitySha256:reverse.identity.sha256,
        reportFileSha256:sha256(reportBytes),
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling:{
        admittedClaim:'same-camera true-position visual comparison of one parity-bound elastic escape, subsequent strict repayment, and the exact terminal contact-cycle state',
        anatomicalAdmission:'none',
        nonGoals:[
          'production-architecture-selection',
          'global-convergence',
          'carrier-sufficiency',
          'anatomical-plausibility',
          'arbitrary-N-closure',
          'fascia-composition',
        ],
      },
    };
    const witnessReport = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['fixtures.json', fixtureBytes],
      ['comparison.json', comparisonBytes],
      ['index.html', htmlBytes],
      ['report.json', jsonBytes(witnessReport)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, report:witnessReport, states };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure), io);
    throw error;
  }
}

export async function writeNBodyPackingCumulativeDebtBoundaryWitness({
  outDir = 'artifacts/nbody-packing-cumulative-debt-boundary-viewer-v0',
  canonicalRawPath =
    'artifacts/nbody-packing-cumulative-debt-filter-classified-boundary-trajectory-v0/canonical-raw.json',
  io = { writeFile, rename },
} = {}) {
  const outputRoot = path.resolve(outDir);
  let phase = 'invalidate-prior-primary';
  let lastTrustworthyEvidence = { phase:'none' };
  await mkdir(outputRoot, { recursive:true });
  try {
    await invalidatePrimaries(outputRoot);
    phase = 'read-cumulative-debt-boundary-source';
    const canonicalBytes = await readFile(path.resolve(canonicalRawPath));
    const canonical = JSON.parse(String(canonicalBytes));
    verifyCanonicalIdentity(canonical, 'cumulative-debt boundary trajectory');
    lastTrustworthyEvidence = {
      phase:'cumulative-debt-boundary-source-read',
      canonicalFileSha256:sha256(canonicalBytes),
      canonicalSha256:canonical.identity.sha256,
    };

    phase = 'bind-cumulative-debt-boundary-source';
    const fixture = createNBodyLocalizedChallengeSuite().find(
      candidate => candidate.assayProfile.severity === 0.32,
    );
    const problem = compileNBodyAdaptiveKktProblem(fixture);
    const expectedAlgorithm = 'strict-active-row-then-elastic-all-row-debt-trajectory-v0';
    const rows = canonical.work?.rows || [];
    const floor = rows.at(-1);
    if (
      canonical.schema !== NBODY_PACKING_ELASTIC_EXCHANGE_TRAJECTORY_RESULT_SCHEMA ||
      canonical.status !==
        'elastic-exchange-trajectory-strict-global-merit-floor-cumulative-family-debt-floor' ||
      canonical.route?.requested !== expectedAlgorithm ||
      canonical.route?.effective !== expectedAlgorithm ||
      canonical.route?.fallbackUsed !== false ||
      canonical.source?.problemSha256 !== problem.identity.sha256 ||
      canonical.config?.effective?.iterationBudget !== 20 ||
      canonical.work?.terminalClass !==
        'strict-global-merit-floor-cumulative-family-debt-floor' ||
      canonical.work?.terminalEvidence?.iteration !== 12 ||
      canonical.work?.acceptedTransitions !== 11 ||
      rows.length !== 12 ||
      rows.slice(0, -1).some(row => !row.accepted) ||
      floor?.accepted !== false ||
      floor?.strictGlobalMerit?.status !== 'strict-global-merit-floor' ||
      floor?.strictGlobalMerit?.familyAdmissibleCandidateCount !== 15 ||
      floor?.strictGlobalMerit?.globalAdmissibleCandidateCount !== 0 ||
      floor?.elasticDebtFilter?.status !== 'cumulative-family-debt-floor' ||
      floor?.elasticDebtFilter?.rawAdmissibleCandidateCount !== 16 ||
      floor?.elasticDebtFilter?.admissibleCandidateCount !== 0 ||
      rows.some(row => row.hardInvariantFailures?.length !== 0)
    ) throw new Error('cumulative-debt boundary witness rejects incompatible source');

    const reevaluate = (stored, label) => {
      const state = evaluateNBodyUnifiedKktState({ problem, vector:stored.vector });
      requireExact(state.metrics, stored.metrics,
        `cumulative-debt boundary witness rejects stale ${label} metrics`);
      if (stored.muscles) requireExact(state.muscles, stored.muscles,
        `cumulative-debt boundary witness rejects stale ${label} geometry`);
      requireExact(elasticExchangeOrderedRows(state), stored.rows,
        `cumulative-debt boundary witness rejects stale ${label} row ledger`);
      return state;
    };
    const startState = reevaluate(canonical.start, 'start');
    let priorVector = canonical.start.vector;
    const evaluatedRows = rows.map(row => {
      requireExact(row.before.vector, priorVector,
        `cumulative-debt boundary witness rejects continuity at step ${row.iteration}`);
      const state = reevaluate(row.after, `step ${row.iteration}`);
      if (!row.accepted) {
        requireExact(row.after.vector, row.before.vector,
          `cumulative-debt boundary witness rejects rejected-state mutation at step ${row.iteration}`);
      } else {
        priorVector = row.after.vector;
      }
      return { row, state };
    });
    requireExact(canonical.selected.vector, rows.at(-2).after.vector,
      'cumulative-debt boundary witness rejects final accepted state binding');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      phase:'cumulative-debt-boundary-source-bound',
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      attemptedTransitions:rows.length,
      acceptedTransitions:canonical.work.acceptedTransitions,
      terminalClass:canonical.work.terminalClass,
    };

    phase = 'construct-cumulative-debt-boundary-projection';
    const source = fixture.knownFeasible;
    const selectedIterations = [1, 4, 11, 12];
    const stateKey = iteration => iteration === 12
      ? 'priced-debt-floor-12'
      : `priced-debt-step-${iteration}`;
    const orderedStates = [
      'step-16-source',
      ...selectedIterations.map(stateKey),
    ];
    const states = {
      'step-16-source':{
        label:'step 16 · crowded source',
        severity:0.32,
        status:'shared cumulative-debt trajectory source',
        warning:true,
        source,
        muscles:startState.muscles,
        metrics:startState.metrics,
        comparisonNote:`all-row energy ${canonical.start.allRowSquaredViolationEnergy} · maximum residual ${canonical.start.maximumPhysicalResidual} · exact trajectory source`,
        truth:'Exact crowded source at true physical position. No target geometry, source mutation, or display displacement is consumed by the solver.',
      },
      ...Object.fromEntries(selectedIterations.map(iteration => {
        const { row, state } = evaluatedRows[iteration - 1];
        const floorState = !row.accepted;
        const key = stateKey(iteration);
        const effectiveRadius = row.elasticDebtFilter?.selectedRadius ??
          row.strictGlobalMerit?.selectedRadius ?? null;
        const rawRadius = row.attempts?.elastic?.selected?.radius ?? null;
        const debt = elasticExchangeDebtSummary(row);
        const status = floorState ? canonical.work.terminalClass : `accepted ${row.regime}`;
        const label = floorState
          ? 'attempt 12 · joint direction-set floor'
          : iteration === 1
            ? 'step 1 · initial elastic escape'
            : iteration === 4
              ? 'step 4 · cumulative pricing begins'
              : 'step 11 · final accepted state';
        const truth = floorState
          ? 'No geometry moves at this rejected floor. Fifteen strict candidates remain family-admissible but all are globally uphill; sixteen raw elastic candidates descend globally but all exceed the remaining cumulative skeletal-debt budget.'
          : `Iteration ${iteration} accepts one ${row.regime} transition at the filtered radius. Endpoint identity and individual volume remain exact; all surfaces remain at true physical position.`;
        return [key, {
          label,
          severity:0.32,
          status,
          warning:true,
          source,
          muscles:state.muscles,
          metrics:state.metrics,
          comparisonOverlay:{
            baselineState:'step-16-source',
            baselineLabel:'step 16 source',
            baselineResultIdentitySha256:canonical.start.stateIdentity,
            targetStepIdentitySha256:row.stepIdentity,
            displayGain:80,
            maximumWorldDisplacement:maximumCenterlineDisplacement(
              startState.muscles,
              state.muscles,
            ),
            rendering:'true-position-cross-section-rings-and-amplified-vectors-v0',
          },
          comparisonNote:`${row.regime} · raw elastic radius ${rawRadius} · effective radius ${effectiveRadius} · cumulative candidates ${row.elasticDebtFilter?.admissibleCandidateCount ?? 'n/a'} · all-row energy ${row.after.allRowSquaredViolationEnergy} · arrows ×80 display-only`,
          truth,
          debt,
        }];
      })),
    };
    const comparison = {
      canonical:{
        identity:structuredClone(canonical.identity),
        source:structuredClone(canonical.source),
        config:structuredClone(canonical.config),
        start:{
          stateIdentity:canonical.start.stateIdentity,
          allRowSquaredViolationEnergy:canonical.start.allRowSquaredViolationEnergy,
          maximumPhysicalResidual:canonical.start.maximumPhysicalResidual,
        },
        work:{
          attempts:canonical.work.attempts,
          acceptedTransitions:canonical.work.acceptedTransitions,
          strictAccepted:canonical.work.strictAccepted,
          elasticAccepted:canonical.work.elasticAccepted,
          terminalClass:canonical.work.terminalClass,
          terminalEvidence:structuredClone(canonical.work.terminalEvidence),
          totalPhysicalEvaluations:canonical.work.totalPhysicalEvaluations,
          rows:canonical.work.rows.map(row => ({
            iteration:row.iteration,
            regime:row.regime,
            accepted:row.accepted,
            sourceStateIdentity:row.sourceStateIdentity,
            selectedStateIdentity:row.selectedStateIdentity,
            stepIdentity:row.stepIdentity,
            trajectoryPrefixIdentity:row.trajectoryPrefixIdentity,
            before:{
              allRowSquaredViolationEnergy:row.before.allRowSquaredViolationEnergy,
              maximumPhysicalResidual:row.before.maximumPhysicalResidual,
            },
            after:{
              allRowSquaredViolationEnergy:row.after.allRowSquaredViolationEnergy,
              maximumPhysicalResidual:row.after.maximumPhysicalResidual,
            },
            strictGlobalMerit:structuredClone(row.strictGlobalMerit),
            elasticDebtFilter:structuredClone(row.elasticDebtFilter),
            debtAccumulation:structuredClone(row.debtAccumulation),
            debt:elasticExchangeDebtSummary(row),
          })),
        },
      },
      presentation:{ solverReplayed:false, physicalStatesReevaluated:true },
    };
    const fixtures = {
      fixtureSha256:fixture.identity.sha256,
      problemSha256:problem.identity.sha256,
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const fixtureBytes = jsonBytes(fixtures);
    const comparisonBytes = jsonBytes(comparison);
    const bindings = {
      fixturesSha256:sha256(fixtureBytes),
      resultsSha256:sha256(comparisonBytes),
    };
    const payload = {
      states,
      mechanism:{
        oracleTargetCoordinatesConsumed:false,
        contactGraphRowsConsumed:true,
      },
      display:{
        title:'Cumulative-priced packing · natural direction-set floor',
        authority:'Canonical synthetic trajectory · complete physical row custody · no anatomical admission',
        explanation:'Sparse decision-bearing states from one exact crowded source. Surfaces remain at true position. Cross-section rings and arrows expose subtle cumulative motion at ×80 display gain only. The final floor intentionally has the same geometry as step 11 because no candidate is admitted: strict moves are globally uphill, while elastic moves overdraw the fixed cumulative skeletal-debt budget.',
        orderedStates,
        defaultState:'priced-debt-floor-12',
      },
      environment:{ compartment:source.compartment, obstacles:source.obstacles },
    };
    const htmlBytes = Buffer.from(renderNBodyPackingLocalizedChallengeHtml({
      payload,
      bindings,
      route:NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
    }));
    const reportCore = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'complete-pending-agent-visual-inspection',
      route:{
        requested:NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
        effective:NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
        fallbackUsed:false,
      },
      classification:{
        terminalClass:canonical.work.terminalClass,
        terminalEvidence:structuredClone(canonical.work.terminalEvidence),
        attemptedTransitions:canonical.work.attempts,
        acceptedTransitions:canonical.work.acceptedTransitions,
        strictAccepted:canonical.work.strictAccepted,
        elasticAccepted:canonical.work.elasticAccepted,
        solverReplayedForPresentation:false,
        physicalProjectionCount:orderedStates.length,
        mechanismInputs:structuredClone(payload.mechanism),
      },
      bindings:{
        ...bindings,
        indexHtmlSha256:sha256(htmlBytes),
        canonicalFileSha256:sha256(canonicalBytes),
        canonicalIdentitySha256:canonical.identity.sha256,
      },
      requiredStates:orderedStates,
      requiredModes:['volume','slice'],
      claimCeiling:{
        admittedClaim:'same-camera true-position visual comparison of one cumulative-priced synthetic trajectory from source through the exact strict-global-merit plus cumulative-family-debt floor',
        anatomicalAdmission:'none',
        nonGoals:[
          'production-architecture-selection',
          'global-convergence',
          'carrier-sufficiency',
          'anatomical-plausibility',
          'arbitrary-N-closure',
          'fascia-composition',
        ],
      },
    };
    const witnessReport = {
      ...reportCore,
      identity:{ sha256:hashMusclePackingCanonicalJson(reportCore) },
    };
    phase = 'write-primary';
    for (const [name, bytes] of [
      ['fixtures.json', fixtureBytes],
      ['comparison.json', comparisonBytes],
      ['index.html', htmlBytes],
      ['report.json', jsonBytes(witnessReport)],
    ]) await writeAtomically(path.join(outputRoot, name), bytes, io);
    return { outputRoot, report:witnessReport, states };
  } catch (error) {
    const failure = {
      schema:NBODY_PACKING_LOCALIZED_WITNESS_SCHEMA,
      status:'failed',
      route:{
        requested:NBODY_PACKING_CUMULATIVE_DEBT_BOUNDARY_WITNESS_ROUTE,
        effective:null,
        fallbackUsed:false,
      },
      failurePhase:phase,
      lastTrustworthyEvidence,
      error:{ name:error.name, message:error.message },
    };
    await writeAtomically(path.join(outputRoot, 'report.json'), jsonBytes(failure), io);
    throw error;
  }
}

async function main() {
  const outDir = process.argv[2] ||
    'artifacts/nbody-packing-active-row-trust-region-trajectory-viewer-v0';
  const result = await writeNBodyPackingActiveRowTrajectoryWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    outputRoot:result.outputRoot,
    route:result.report.route,
    bindings:result.report.bindings,
    requiredStates:result.report.requiredStates,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
