#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const GREENROOM_BENCHMARK_SCHEMA = 'kaminos.volume.greenroom-benchmark.v0';
const GREENROOM_BENCHMARK_JOB_ID = 'kaminos-volume-gpu-greenroom-benchmark-v0';

function parseArgs(argv) {
  const parsed = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      i += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function metricDelta(samples, key, relativeTolerance, absoluteTolerance) {
  const values = samples.map((sample) => Number(sample?.[key])).filter(Number.isFinite);
  if (values.length < 2) {
    return {
      key,
      status: 'insufficient-samples',
      sampleCount: values.length,
      values,
      absoluteDelta: null,
      relativeDelta: null,
      tolerance: relativeTolerance,
      absoluteTolerance,
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const absoluteDelta = max - min;
  const relativeDelta = mean > 0 ? absoluteDelta / mean : 0;
  const divergent = absoluteDelta > absoluteTolerance && relativeDelta > relativeTolerance;
  return {
    key,
    status: divergent ? 'divergent' : 'stable',
    sampleCount: values.length,
    values,
    min,
    max,
    mean,
    absoluteDelta,
    relativeDelta,
    tolerance: relativeTolerance,
    absoluteTolerance,
  };
}

function scenarioIdsFromAggregate(aggregate) {
  return (aggregate?.aggregate?.runs || [])
    .map((run) => run.scenarioId)
    .filter(Boolean);
}

function runByScenario(aggregate) {
  return new Map((aggregate?.aggregate?.runs || []).map((run) => [run.scenarioId, run]));
}

function buildStabilitySummary(passAggregates, options) {
  const allScenarioIds = [...new Set(passAggregates.flatMap(scenarioIdsFromAggregate))];
  const passMaps = passAggregates.map(runByScenario);
  const summaries = allScenarioIds.map((scenarioId) => {
    const samples = passMaps.map((map, passIndex) => {
      const run = map.get(scenarioId);
      return run ? {
        passIndex: passIndex + 1,
        frameP95Ms: run.frameP95Ms,
        queueDoneP95Ms: run.queueDoneP95Ms,
        score: run.score,
        report: run.report,
        screenshot: run.screenshot,
      } : null;
    }).filter(Boolean);
    const frameP95 = metricDelta(
      samples,
      'frameP95Ms',
      options.frameP95RelativeTolerance,
      options.frameP95AbsoluteTolerance,
    );
    const queueDoneP95 = metricDelta(
      samples,
      'queueDoneP95Ms',
      options.queueDoneP95RelativeTolerance,
      options.queueDoneP95AbsoluteTolerance,
    );
    const stabilityUnmeasured = frameP95.status === 'insufficient-samples' && queueDoneP95.status === 'insufficient-samples';
    const stabilitySuspect = frameP95.status === 'divergent' || queueDoneP95.status === 'divergent';
    return {
      scenarioId,
      status: stabilityUnmeasured ? 'unmeasured' : (stabilitySuspect ? 'suspect' : 'stable'),
      stabilityUnmeasured,
      stabilitySuspect,
      sampleCount: samples.length,
      samples,
      frameP95,
      queueDoneP95,
    };
  });
  return {
    identity: 'kaminos-volume-greenroom-stability-v0',
    repeatCount: options.repeatCount,
    retryDivergent: options.retryDivergent,
    frameP95RelativeTolerance: options.frameP95RelativeTolerance,
    frameP95AbsoluteTolerance: options.frameP95AbsoluteTolerance,
    queueDoneP95RelativeTolerance: options.queueDoneP95RelativeTolerance,
    queueDoneP95AbsoluteTolerance: options.queueDoneP95AbsoluteTolerance,
    stableCount: summaries.filter((summary) => summary.status === 'stable').length,
    suspectCount: summaries.filter((summary) => summary.stabilitySuspect).length,
    unmeasuredCount: summaries.filter((summary) => summary.stabilityUnmeasured).length,
    divergentScenarioIds: summaries.filter((summary) => summary.stabilitySuspect).map((summary) => summary.scenarioId),
    scenarios: summaries,
  };
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-volume-greenroom-benchmark');
const aggregatePath = resolve(args.get('--aggregate') || `${outDir}/aggregate.json`);
const jobPath = resolve(args.get('--job') || `${outDir}/greenroom-job.json`);
const runPath = resolve(args.get('--run') || `${outDir}/greenroom-run.json`);
const jobInputPath = args.get('--job-input') ? resolve(args.get('--job-input')) : null;
const settleMs = String(args.get('--settle-ms') || 8000);
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = String(args.get('--debug-port') || 9500);
const scenarios = args.get('--scenarios');
const dryRun = args.has('--dry-run');
const repeatCount = finiteInteger(args.get('--repeat-count'), dryRun ? 1 : 2);
const retryDivergent = !args.has('--no-retry-divergent');
const frameP95RelativeTolerance = finiteNumber(args.get('--stability-frame-p95-pct'), 0.15);
const frameP95AbsoluteTolerance = finiteNumber(args.get('--stability-frame-p95-ms'), 5);
const queueDoneP95RelativeTolerance = finiteNumber(args.get('--stability-queue-p95-pct'), 0.20);
const queueDoneP95AbsoluteTolerance = finiteNumber(args.get('--stability-queue-p95-ms'), 15);

mkdirSync(outDir, { recursive: true });

function sweepArgsForPass(pass) {
  const passOutDir = resolve(outDir, pass.slug);
  const passAggregatePath = resolve(passOutDir, 'aggregate.json');
  const sweepArgs = [
    'volume-sweep.mjs',
    '--matrix', 'performance',
    '--base-url', baseUrl,
    '--out-dir', passOutDir,
    '--aggregate', passAggregatePath,
    '--settle-ms', settleMs,
    '--window-size', windowSize,
    '--debug-port', String(Number(debugPort) + pass.index * 100),
  ];
  const passScenarios = pass.scenarios || scenarios;
  if (passScenarios) sweepArgs.push('--scenarios', String(passScenarios));
  if (dryRun) sweepArgs.push('--dry-run');
  return {
    passOutDir,
    passAggregatePath,
    stdoutPath: resolve(passOutDir, 'sweep-stdout.log'),
    stderrPath: resolve(passOutDir, 'sweep-stderr.log'),
    sweepArgs,
  };
}

const plannedPasses = Array.from({ length: repeatCount }, (_, index) => ({
  index,
  slug: `pass-${index + 1}`,
  scenarios,
}));
const firstPass = sweepArgsForPass(plannedPasses[0]);
const requestedCommand = [process.execPath, ...firstPass.sweepArgs];
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');

const job = {
  schema: GREENROOM_BENCHMARK_SCHEMA,
  jobId: GREENROOM_BENCHMARK_JOB_ID,
  createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  baseUrl,
  outDir,
  aggregatePath,
  jobPath,
  runPath,
  logPathContract: 'Per-pass sweep logs live in plannedPasses/passRuns stdoutPath and stderrPath entries.',
  jobInputPath,
  dryRun,
  repeatCount,
  retryDivergent,
  frameP95RelativeTolerance,
  frameP95AbsoluteTolerance,
  queueDoneP95RelativeTolerance,
  queueDoneP95AbsoluteTolerance,
  matrixMode: 'performance',
  performanceMatrixId: 'tall-plume-performance-matrix-v0',
  evidenceModeContract: 'performance matrix evidence mode is forwarded by volume-sweep.mjs to volume-witness.mjs as --evidence-mode performance',
  requestedGreenroomCondition: {
    cleanGpuWindow: true,
    noConcurrentInference: true,
    noOperatorWorkloadContention: true,
  },
  uncontendedEvidenceClaim: false,
  requestedCommand,
  plannedPasses: plannedPasses.map((pass) => ({
    slug: pass.slug,
    scenarios: pass.scenarios || 'all',
    command: [process.execPath, ...sweepArgsForPass(pass).sweepArgs],
  })),
};

writeJson(jobPath, { job });

const startedAt = new Date().toISOString();
const startMs = Date.now();
const passRuns = [];
let failedChild = null;

function runSweepPass(pass) {
  const paths = sweepArgsForPass(pass);
  mkdirSync(paths.passOutDir, { recursive: true });
  const passStartedAt = new Date().toISOString();
  const stdoutFd = openSync(paths.stdoutPath, 'w');
  const stderrFd = openSync(paths.stderrPath, 'w');
  let child;
  try {
    child = spawnSync(process.execPath, paths.sweepArgs, {
      cwd,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const passFinishedAt = new Date().toISOString();
  const aggregate = readJson(paths.passAggregatePath);
  const passRun = {
    index: pass.index,
    slug: pass.slug,
    scenarios: pass.scenarios || scenarios || 'all',
    startedAt: passStartedAt,
    finishedAt: passFinishedAt,
    status: child.status === 0 ? (dryRun ? 'dry-run' : 'passed') : 'failed',
    command: [process.execPath, ...paths.sweepArgs],
    outDir: paths.passOutDir,
    aggregatePath: paths.passAggregatePath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    exitStatus: child.status,
    signal: child.signal,
    spawnError: child.error ? {
      name: child.error.name,
      message: child.error.message,
      code: child.error.code,
    } : null,
    aggregateSummary: aggregate?.aggregate ? {
      generatedAt: aggregate.aggregate.generatedAt,
      runs: aggregate.aggregate.runs?.length || 0,
      failures: aggregate.aggregate.failures?.length || 0,
      recommendations: aggregate.aggregate.recommendations || [],
    } : null,
  };
  passRuns.push(passRun);
  return { child, aggregate, passRun };
}

const passAggregates = [];
for (const pass of plannedPasses) {
  const result = runSweepPass(pass);
  if (result.aggregate) passAggregates.push(result.aggregate);
  if (result.child.status !== 0) {
    failedChild = result.child;
    break;
  }
}

let stabilitySummary = buildStabilitySummary(passAggregates, {
  repeatCount,
  retryDivergent,
  frameP95RelativeTolerance,
  frameP95AbsoluteTolerance,
  queueDoneP95RelativeTolerance,
  queueDoneP95AbsoluteTolerance,
});

let divergentRetry = null;
if (!failedChild && retryDivergent && !dryRun && passAggregates.length >= 2 && stabilitySummary.divergentScenarioIds.length > 0) {
  divergentRetry = {
    index: passRuns.length,
    slug: 'pass-3-divergent',
    scenarios: stabilitySummary.divergentScenarioIds.join(','),
  };
  const result = runSweepPass(divergentRetry);
  if (result.aggregate) passAggregates.push(result.aggregate);
  if (result.child.status !== 0) failedChild = result.child;
  stabilitySummary = buildStabilitySummary(passAggregates, {
    repeatCount: passRuns.length,
    retryDivergent,
    frameP95RelativeTolerance,
    frameP95AbsoluteTolerance,
    queueDoneP95RelativeTolerance,
    queueDoneP95AbsoluteTolerance,
  });
}

const finishedAt = new Date().toISOString();
const representativeAggregate = passAggregates[0] || null;
const latestRunsByScenario = new Map();
for (const aggregate of passAggregates) {
  for (const row of aggregate?.aggregate?.runs || []) {
    latestRunsByScenario.set(row.scenarioId, row);
  }
}
const stabilityByScenario = new Map(stabilitySummary.scenarios.map((summary) => [summary.scenarioId, summary]));
const combinedRuns = [...latestRunsByScenario.values()].map((row) => ({
  ...row,
  stabilitySummary: stabilityByScenario.get(row.scenarioId) || null,
  stabilitySuspect: Boolean(stabilityByScenario.get(row.scenarioId)?.stabilitySuspect),
}));
combinedRuns.sort((a, b) => (a.recommendationRank || 9999) - (b.recommendationRank || 9999));
const combinedAggregate = {
  aggregate: {
    ...(representativeAggregate?.aggregate || {}),
    generatedAt: new Date().toISOString(),
    aggregateKind: 'greenroom-repeatability-wrapper',
    aggregatePath,
    passCount: passRuns.length,
    repeatCount,
    retryDivergent,
    divergentScenarioIds: stabilitySummary.divergentScenarioIds,
    stabilitySummary,
    passRuns,
    passAggregates: passRuns.map((passRun) => passRun.aggregatePath),
    runs: combinedRuns,
    failures: passAggregates.flatMap((aggregate) => aggregate?.aggregate?.failures || []),
    recommendations: combinedRuns.slice(0, 4).map((row, index) => ({
      recommendationRank: index + 1,
      scenarioId: row.scenarioId,
      label: row.label,
      score: row.score,
      frameP95Ms: row.frameP95Ms,
      queueDoneP95Ms: row.queueDoneP95Ms,
      renderScale: row.effectiveConfig?.renderScale,
      raySteps: row.effectiveConfig?.raySteps,
      adaptiveRaymarch: row.effectiveConfig?.adaptiveRaymarch,
      simCadence: row.effectiveConfig?.simCadence,
      effectiveVisualAuthority: row.effectiveConfig?.effectiveVisualAuthority,
      stabilitySuspect: row.stabilitySuspect,
      report: row.report,
      screenshot: row.screenshot,
    })),
  },
};
writeJson(aggregatePath, combinedAggregate);

const run = {
  schema: GREENROOM_BENCHMARK_SCHEMA,
  jobId: GREENROOM_BENCHMARK_JOB_ID,
  status: failedChild ? 'failed' : (dryRun ? 'dry-run' : 'passed'),
  startedAt,
  finishedAt,
  durationMs: Date.now() - startMs,
  cwd,
  gitCommit,
  gitBranch,
  baseUrl,
  outDir,
  aggregatePath,
  jobPath,
  logPathContract: 'Per-pass sweep logs live in passRuns stdoutPath and stderrPath entries.',
  jobInputPath,
  dryRun,
  repeatCount,
  retryDivergent,
  divergentRetry,
  divergentScenarioIds: stabilitySummary.divergentScenarioIds,
  stabilitySummary,
  passRuns,
  matrixMode: 'performance',
  performanceMatrixId: 'tall-plume-performance-matrix-v0',
  uncontendedEvidenceClaim: false,
  effectiveCommand: requestedCommand,
  requestedCommand,
  exitStatus: failedChild ? failedChild.status : 0,
  signal: failedChild?.signal || null,
  spawnError: failedChild?.error ? {
    name: failedChild.error.name,
    message: failedChild.error.message,
    code: failedChild.error.code,
  } : null,
  aggregateSummary: combinedAggregate.aggregate ? {
    generatedAt: combinedAggregate.aggregate.generatedAt,
    runs: combinedAggregate.aggregate.runs?.length || 0,
    failures: combinedAggregate.aggregate.failures?.length || 0,
    recommendations: combinedAggregate.aggregate.recommendations || [],
    stabilitySummary: {
      stableCount: stabilitySummary.stableCount,
      suspectCount: stabilitySummary.suspectCount,
      divergentScenarioIds: stabilitySummary.divergentScenarioIds,
    },
  } : null,
};

writeJson(runPath, { job, run });
console.log(JSON.stringify({ job, run }, null, 2));
if (failedChild) process.exit(failedChild.status || 1);
