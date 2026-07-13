#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const BOUNDARY_SPLAT_BENCHMARK_SCHEMA = 'kaminos.boundary-splat.learned-cost-benchmark.v0';
const ANALYTIC_RENDERER_IDENTITY = 'live-boundary-sidecar-analytic-splats-v0';
const LEARNED_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const CORRECTED_MODEL_IDENTITY = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const CANDIDATE_HEAD_WEIGHT_PRODUCTS = 1408;

function parseCliArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

const args = parseCliArgs(process.argv.slice(2));
const origin = String(args.get('--origin') || 'http://127.0.0.1:8095').replace(/\/+$/, '');
const out = resolve(args.get('--out') || '/tmp/kaminos-boundary-splat-learned-cost.json');
const artifactDir = resolve(args.get('--artifact-dir') || out.replace(/\.json$/i, '.artifacts'));
const debugPort = Number(args.get('--debug-port') || 9537);
const settleMs = Number(args.get('--settle-ms') || 1500);
const warmupSamples = Math.max(0, Math.floor(Number(args.get('--warmup-samples') || 2)));
const steadySamples = Math.max(1, Math.floor(Number(args.get('--steady-samples') || 8)));
const windowSize = String(args.get('--window-size') || '1280,960');
const userDataDir = String(args.get('--user-data-dir') || `/tmp/kaminos-boundary-splat-benchmark-profile-${process.pid}`);

const CASES = [
  { id: 'res096-rs050', resolution: 96, renderScale: 0.5, viewport: windowSize },
  { id: 'res128-rs075', resolution: 128, renderScale: 0.75, viewport: windowSize },
  { id: 'res160-rs100', resolution: 160, renderScale: 1, viewport: windowSize },
];

function benchmarkRoute(testCase) {
  const url = new URL('/', origin);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_scene', 'tall_plume');
  url.searchParams.set('volume_tall_preset', 'rgb_upscale_basin_0711');
  url.searchParams.set('volume_resolution', String(testCase.resolution));
  url.searchParams.set('volume_boundary_sidecar_source', 'baked');
  url.searchParams.set('volume_boundary_splat_mode', 'analytic');
  url.searchParams.set('volume_render_scale', String(testCase.renderScale));
  return url.toString();
}

function writeReport(report) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    schema: BOUNDARY_SPLAT_BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    origin,
    out,
    artifactDir,
    debugPort,
    settleMs,
    warmupSamples,
    steadySamples,
    windowSize,
    userDataDir,
    correctedModelIdentity: CORRECTED_MODEL_IDENTITY,
    candidateHeadWeightProductsPerCandidate: CANDIDATE_HEAD_WEIGHT_PRODUCTS,
    ...report,
  }, null, 2)}\n`);
}

function initialFalseClosureChecks() {
  return {
    fallbackRoute: false,
    requestedEffectiveRendererDisagreement: false,
    staleOrDefaultModelIdentity: false,
    candidateCountMismatch: false,
    nonzeroOverflow: false,
    nonzeroCandidateCopy: false,
    missingOrBlankSamples: false,
    proxyRepresentedAsGpuExclusive: false,
    warmupMixedIntoSteadyState: false,
    multipleParallelBrowsers: false,
    frozenStateMismatch: false,
    staleOrDefaultConfig: false,
  };
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  return {
    count: sorted.length,
    minMs: sorted[0],
    p25Ms: percentile(0.25),
    medianMs: percentile(0.5),
    p75Ms: percentile(0.75),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
    meanMs: mean,
    standardDeviationMs: Math.sqrt(sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sorted.length),
  };
}

function summarizeRun(testCase, reportPath, screenshotPath, report) {
  const probe = report.boundarySplatCostProbe;
  const samples = Array.isArray(probe?.samples) ? probe.samples : [];
  const falseClosureChecks = initialFalseClosureChecks();
  const expectedSampleCount = (warmupSamples + steadySamples) * 2;
  const expectedRenderer = mode => mode === 'learned' ? LEARNED_RENDERER_IDENTITY : ANALYTIC_RENDERER_IDENTITY;
  const validModes = new Set(['analytic', 'learned']);
  const candidateCounts = samples.map(sample => Number(sample.drawState?.candidateCount)).filter(Number.isFinite);

  falseClosureChecks.fallbackRoute = report.boundarySplatFallbackReason != null
    || samples.some(sample => sample.status !== 'available');
  falseClosureChecks.requestedEffectiveRendererDisagreement = samples.some(sample => (
    !validModes.has(sample.mode)
    || sample.rendererIdentity !== expectedRenderer(sample.mode)
    || sample.sourceAuthority !== SOURCE_AUTHORITY
  ));
  falseClosureChecks.staleOrDefaultModelIdentity = samples.some(sample => (
    sample.mode === 'learned' && sample.modelIdentity !== CORRECTED_MODEL_IDENTITY
  )) || !samples.some(sample => sample.mode === 'learned');
  falseClosureChecks.candidateCountMismatch = candidateCounts.length !== samples.length
    || new Set(candidateCounts).size !== 1;
  falseClosureChecks.nonzeroOverflow = samples.some(sample => Number(sample.drawState?.overflowCount) !== 0);
  falseClosureChecks.nonzeroCandidateCopy = samples.some(sample => Number(sample.candidateCopyBytes) !== 0)
    || Number(report.boundarySplatCopyBytesThisFrame) !== 0;
  falseClosureChecks.missingOrBlankSamples = probe?.ok !== true
    || samples.length !== expectedSampleCount
    || samples.some(sample => !Number.isFinite(Number(sample.elapsedMs)) || Number(sample.elapsedMs) < 0);
  falseClosureChecks.proxyRepresentedAsGpuExclusive = probe?.measurementAuthority === 'cpu-visible-queue-completion-proxy-v0'
    && samples.some(sample => sample.measurementAuthority !== 'cpu-visible-queue-completion-proxy-v0'
      || !String(sample.measurementDisclaimer || '').includes('not-gpu-exclusive'));
  falseClosureChecks.warmupMixedIntoSteadyState = ['analytic', 'learned'].some(mode => {
    const modeSamples = samples.filter(sample => sample.mode === mode);
    return modeSamples.filter(sample => sample.phase === 'warmup').length !== warmupSamples
      || modeSamples.filter(sample => sample.phase === 'steady').length !== steadySamples;
  });
  falseClosureChecks.frozenStateMismatch = probe?.frozenStatePreserved !== true
    || Number(probe?.baseSimStepCount) !== Number(probe?.finalSimStepCount);
  falseClosureChecks.staleOrDefaultConfig = Number(report.simGrid) !== testCase.resolution
    || Math.abs(Number(report.renderScale) - testCase.renderScale) > 0.02
    || report.expectedTallPlumePreset !== 'rgb_upscale_basin_0711';

  const steadyAnalytic = samples.filter(sample => sample.phase === 'steady' && sample.mode === 'analytic');
  const steadyLearned = samples.filter(sample => sample.phase === 'steady' && sample.mode === 'learned');
  const pairedDeltas = steadyAnalytic.map((analytic, index) => Number(steadyLearned[index]?.elapsedMs) - Number(analytic.elapsedMs));
  const compactionAnalytic = steadyAnalytic.map(sample => Number(sample.stages?.compactionMs));
  const compactionLearned = steadyLearned.map(sample => Number(sample.stages?.compactionMs));
  const compactionDeltas = compactionAnalytic.map((analytic, index) => compactionLearned[index] - analytic);
  const splatRasterAnalytic = steadyAnalytic.map(sample => Number(sample.stages?.splatRasterMs));
  const splatRasterLearned = steadyLearned.map(sample => Number(sample.stages?.splatRasterMs));
  const splatRasterDeltas = splatRasterAnalytic.map((analytic, index) => splatRasterLearned[index] - analytic);
  const candidateCount = candidateCounts[0] ?? null;

  return {
    ok: !Object.values(falseClosureChecks).some(Boolean),
    id: testCase.id,
    requestedRoute: benchmarkRoute(testCase),
    witnessReportPath: reportPath,
    screenshotPath,
    resolution: testCase.resolution,
    simGrid: report.simGrid,
    renderScale: testCase.renderScale,
    viewport: testCase.viewport,
    renderWidth: report.renderWidth,
    renderHeight: report.renderHeight,
    effectiveRoute: report.effectiveRoute,
    backend: report.backend,
    browserSession: report.browserSession,
    sourceAuthority: SOURCE_AUTHORITY,
    analyticRendererIdentity: ANALYTIC_RENDERER_IDENTITY,
    learnedRendererIdentity: LEARNED_RENDERER_IDENTITY,
    correctedModelIdentity: CORRECTED_MODEL_IDENTITY,
    measurementAuthority: probe?.measurementAuthority ?? null,
    timestampProbe: probe?.timestampProbe ?? null,
    warmupSamples,
    steadySamples,
    samples,
    boundarySplatGpuProfile: report.boundarySplatGpuProfile,
    boundarySplatCopyDisposition: report.boundarySplatCopyDisposition,
    boundarySplatCandidateCount: candidateCount,
    boundarySplatOverflowCount: samples[0]?.drawState?.overflowCount ?? null,
    boundarySplatCopyBytesThisFrame: report.boundarySplatCopyBytesThisFrame,
    candidateHeadProductsPerFrame: candidateCount == null ? null : candidateCount * CANDIDATE_HEAD_WEIGHT_PRODUCTS,
    distributions: {
      analyticSteady: distribution(steadyAnalytic.map(sample => Number(sample.elapsedMs))),
      learnedSteady: distribution(steadyLearned.map(sample => Number(sample.elapsedMs))),
      learnedMinusAnalyticPaired: distribution(pairedDeltas),
      compactionAnalyticSteady: distribution(compactionAnalytic),
      compactionLearnedSteady: distribution(compactionLearned),
      compactionLearnedMinusAnalyticPaired: distribution(compactionDeltas),
      splatRasterAnalyticSteady: distribution(splatRasterAnalytic),
      splatRasterLearnedSteady: distribution(splatRasterLearned),
      splatRasterLearnedMinusAnalyticPaired: distribution(splatRasterDeltas),
    },
    falseClosureChecks,
    incrementalCostClaimAllowed: !Object.values(falseClosureChecks).some(Boolean),
    optimizationClaimAllowed: false,
  };
}

function runWitness(testCase, index) {
  const screenshotPath = resolve(artifactDir, `${testCase.id}.png`);
  const reportPath = resolve(artifactDir, `${testCase.id}.json`);
  const witnessArgs = [
    'volume-witness.mjs',
    '--url', benchmarkRoute(testCase),
    '--out', screenshotPath,
    '--report', reportPath,
    '--settle-ms', String(settleMs),
    '--window-size', testCase.viewport,
    '--debug-port', String(debugPort),
    '--user-data-dir', userDataDir,
    '--boundary-splat-cost-probe',
    '--boundary-splat-cost-warmup-samples', String(warmupSamples),
    '--boundary-splat-cost-steady-samples', String(steadySamples),
    '--reuse-browser',
    '--keep-browser-open',
  ];
  const result = spawnSync(process.execPath, witnessArgs, {
    cwd: new URL('.', import.meta.url).pathname,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    let lastTrustworthyEvidence = null;
    try {
      lastTrustworthyEvidence = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      lastTrustworthyEvidence = null;
    }
    return {
      ok: false,
      id: testCase.id,
      phase: 'witness',
      requestedRoute: benchmarkRoute(testCase),
      command: [process.execPath, ...witnessArgs],
      status: result.status,
      signal: result.signal,
      stderr: result.stderr,
      reportPath,
      screenshotPath,
      lastTrustworthyEvidence,
      incrementalCostClaimAllowed: false,
      optimizationClaimAllowed: false,
      falseClosureChecks: {
        ...initialFalseClosureChecks(),
        missingOrBlankSamples: true,
      },
    };
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return { serialIndex: index, ...summarizeRun(testCase, reportPath, screenshotPath, report) };
}

async function closeSharedBrowser() {
  try {
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json());
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', resolveOpen, { once: true });
      ws.addEventListener('error', rejectOpen, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
    await new Promise(resolveClose => {
      ws.addEventListener('close', resolveClose, { once: true });
      setTimeout(resolveClose, 500);
    });
    return { attempted: true, status: 'closed', leftAlive: false };
  } catch (error) {
    return { attempted: true, status: 'close-failed', leftAlive: true, error: error?.message || String(error) };
  }
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const runs = [];
  let phase = 'start';
  let lastTrustworthyEvidence = null;
  let browserClose = { attempted: false, status: 'not-started', leftAlive: false };
  writeReport({
    status: 'running',
    phase,
    cases: CASES,
    runs,
    lastTrustworthyEvidence,
    falseClosureChecks: initialFalseClosureChecks(),
    incrementalCostClaimAllowed: false,
    optimizationClaimAllowed: false,
  });

  try {
    phase = 'serial-alternations';
    for (const [index, testCase] of CASES.entries()) {
      const run = runWitness(testCase, index);
      runs.push(run);
      lastTrustworthyEvidence = run;
      writeReport({
        status: 'running',
        phase,
        cases: CASES,
        runs,
        lastTrustworthyEvidence,
        browserClose,
        falseClosureChecks: initialFalseClosureChecks(),
        incrementalCostClaimAllowed: false,
        optimizationClaimAllowed: false,
      });
      if (!run.ok) break;
    }
  } catch (error) {
    runs.push({ ok: false, phase, error: error?.message || String(error), lastTrustworthyEvidence });
  } finally {
    phase = 'browser-close';
    browserClose = await closeSharedBrowser();
  }

  const falseClosureChecks = initialFalseClosureChecks();
  falseClosureChecks.missingOrBlankSamples = runs.length !== CASES.length || runs.some(run => !run.ok);
  falseClosureChecks.multipleParallelBrowsers = new Set(runs.map(run => run.browserSession?.port).filter(Boolean)).size > 1;
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.falseClosureChecks || {})) falseClosureChecks[key] ||= Boolean(value);
  }
  const incrementalCostClaimAllowed = runs.length === CASES.length
    && runs.every(run => run.ok && run.incrementalCostClaimAllowed)
    && !Object.values(falseClosureChecks).some(Boolean);
  const status = incrementalCostClaimAllowed ? 'valid-learned-cost-evidence' : 'failed-before-primary-output';

  writeReport({
    status,
    phase: 'complete',
    cases: CASES,
    runs,
    learnedCostScaling: runs.filter(run => run.ok).map(run => ({
      id: run.id,
      resolution: run.resolution,
      renderScale: run.renderScale,
      renderPixels: Number(run.renderWidth || 0) * Number(run.renderHeight || 0),
      candidateCount: run.boundarySplatCandidateCount,
      candidateHeadProductsPerFrame: run.candidateHeadProductsPerFrame,
      measurementAuthority: run.measurementAuthority,
      learnedMinusAnalyticPaired: run.distributions?.learnedMinusAnalyticPaired ?? null,
    })),
    lastTrustworthyEvidence,
    browserClose,
    falseClosureChecks,
    incrementalCostClaimAllowed,
    optimizationClaimAllowed: false,
    conclusion: incrementalCostClaimAllowed
      ? 'Matched analytic-versus-learned incremental-cost evidence is valid at the recorded authority; it does not authorize renderer-over-raymarch or end-to-end production claims.'
      : 'The learned-cost artifact failed at least one false-closure check; no incremental or renderer optimization claim is allowed.',
  });
  console.log(JSON.stringify({ status, out, browserClose, falseClosureChecks, incrementalCostClaimAllowed, optimizationClaimAllowed: false }, null, 2));
  if (!incrementalCostClaimAllowed) process.exitCode = 1;
}

main().catch(async error => {
  const browserClose = await closeSharedBrowser();
  writeReport({
    status: 'failed-before-primary-output',
    phase: 'top-level',
    error: error?.message || String(error),
    lastTrustworthyEvidence: null,
    browserClose,
    falseClosureChecks: {
      ...initialFalseClosureChecks(),
      missingOrBlankSamples: true,
    },
    incrementalCostClaimAllowed: false,
    optimizationClaimAllowed: false,
  });
  process.exitCode = 1;
});
