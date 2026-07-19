#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const BOUNDARY_SPLAT_BENCHMARK_SCHEMA = 'kaminos.boundary-splat.serial-benchmark.v0';
const BOUNDARY_SPLAT_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const BOUNDARY_SPLAT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
const BOUNDARY_SPLAT_SELECTOR_POLICY_IDENTITY = 'boundary-splat-nested-permutation-prefix-v0';
const BUDGETS = [6400, 3200, 1600, 800];
const INSTANCE_COUNTS = [1, 16, 64, 100];

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
const out = resolve(args.get('--out') || '/tmp/kaminos-boundary-splat-benchmark.json');
const artifactDir = resolve(args.get('--artifact-dir') || out.replace(/\.json$/i, '.artifacts'));
const debugPort = Number(args.get('--debug-port') || 9537);
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = String(args.get('--window-size') || '1280,960');
const userDataDir = String(args.get('--user-data-dir') || `/tmp/kaminos-boundary-splat-benchmark-profile-${process.pid}`);

const CASES = INSTANCE_COUNTS.flatMap(instances => BUDGETS.map(budget => ({
  id: `instances-${instances}-budget-${budget}`,
  instances,
  budget,
  resolution: 160,
  renderScale: 1,
  viewport: windowSize,
})));

function benchmarkRoute(testCase) {
  const url = new URL('/', origin);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_scene', 'tall_plume');
  url.searchParams.set('volume_tall_preset', 'rgb_upscale_basin_0711');
  url.searchParams.set('volume_resolution', String(testCase.resolution));
  url.searchParams.set('volume_boundary_sidecar_source', 'baked');
  url.searchParams.set('volume_boundary_splat_mode', 'learned');
  url.searchParams.set('volume_boundary_splat_instances', String(testCase.instances));
  url.searchParams.set('volume_boundary_splat_candidate_budget', String(testCase.budget));
  url.searchParams.set('volume_boundary_splat_composition', 'field');
  url.searchParams.set('volume_boundary_splat_phase_mode', 'offset-history');
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
    windowSize,
    userDataDir,
    ...report,
  }, null, 2)}\n`);
}

function initialFalseClosureChecks() {
  return {
    fallbackRoute: false,
    requestedEffectiveRendererDisagreement: false,
    missingTimestampSupport: false,
    staleOrDefaultConfig: false,
    staleOrDefaultBudget: false,
    selectorPolicyDisagreement: false,
    selectorCostMissing: false,
    selectedCountMismatch: false,
    mismatchedRaymarchQuality: false,
    blankOrPartialReport: false,
    multipleParallelBrowsers: false,
  };
}

function profileHasStageTimes(profile) {
  const stages = profile?.stages || {};
  return [
    'simulation',
    'sidecar',
    'compaction',
    'candidateCopy',
    'indirectSetup',
    'splatRaster',
    'matchedRaymarchRaster',
    'total',
  ].every(stage => Number.isFinite(Number(stages[stage]?.ms)));
}

function summarizeRun(testCase, reportPath, screenshotPath, report) {
  const profile = report.boundarySplatGpuProfile || {};
  const copyDisposition = report.boundarySplatCopyDisposition || {};
  const litPixels = Number(report.litPixels ?? report.mainRendererMetrics?.litPixels ?? 0);
  const meanLuma = Number(report.meanLuma ?? report.mainRendererMetrics?.meanLuma ?? 0);
  const sourceCandidateCount = Number(report.boundarySplatSourceCandidateCount ?? report.boundarySplatCandidateCount);
  const requestedInstanceCount = Number(report.boundarySplatRequestedInstanceCount ?? report.controls?.boundarySplatInstances);
  const falseClosureChecks = initialFalseClosureChecks();
  falseClosureChecks.fallbackRoute = report.boundarySplatFallbackReason != null;
  falseClosureChecks.requestedEffectiveRendererDisagreement = report.boundarySplatMode !== 'learned'
    || report.volumeReconstructionStyle !== BOUNDARY_SPLAT_RENDERER_IDENTITY
    || report.boundarySplatRendererIdentity !== BOUNDARY_SPLAT_RENDERER_IDENTITY
    || report.boundarySplatSourceAuthority !== BOUNDARY_SPLAT_SOURCE_AUTHORITY;
  falseClosureChecks.missingTimestampSupport = profile.timestampStatus !== 'available' || !profileHasStageTimes(profile);
  falseClosureChecks.staleOrDefaultConfig = Number(report.simGrid) !== testCase.resolution
    || Math.abs(Number(report.renderScale) - testCase.renderScale) > 0.02
    || report.expectedTallPlumePreset !== 'rgb_upscale_basin_0711'
    || requestedInstanceCount !== testCase.instances;
  falseClosureChecks.staleOrDefaultBudget = Number(report.boundarySplatRequestedCandidateBudget) !== testCase.budget
    || Number(report.boundarySplatEffectiveCandidateBudget) !== Math.min(sourceCandidateCount, testCase.budget);
  falseClosureChecks.selectorPolicyDisagreement = report.boundarySplatSelectorPolicyIdentity !== BOUNDARY_SPLAT_SELECTOR_POLICY_IDENTITY;
  falseClosureChecks.selectorCostMissing = report.boundarySplatSelectorCostProfile?.selectorGpuMs == null
    || !Number.isFinite(Number(report.boundarySplatSelectorCostProfile?.selectorGpuMs));
  falseClosureChecks.selectedCountMismatch = Number(report.boundarySplatSelectedCandidateCount) !== Number(report.boundarySplatEffectiveCandidateBudget)
    || Number(report.boundarySplatInstanceCount) !== Number(report.boundarySplatSelectedCandidateCount) * testCase.instances;
  falseClosureChecks.mismatchedRaymarchQuality = !profile?.stages?.matchedRaymarchRaster;
  falseClosureChecks.blankOrPartialReport = !Number.isFinite(litPixels)
    || litPixels <= 0
    || !report.boundarySplatGpuProfile
    || !report.boundarySplatCopyDisposition;

  return {
    id: testCase.id,
    requestedRoute: benchmarkRoute(testCase),
    witnessReportPath: reportPath,
    screenshotPath,
    resolution: testCase.resolution,
    requestedInstances: testCase.instances,
    requestedCandidateBudget: testCase.budget,
    simGrid: report.simGrid,
    renderScale: testCase.renderScale,
    viewport: testCase.viewport,
    effectiveRoute: report.effectiveRoute,
    volumeReconstructionStyle: report.volumeReconstructionStyle,
    backend: report.backend,
    browserSession: report.browserSession,
    renderWidth: report.renderWidth,
    renderHeight: report.renderHeight,
    boundarySplatMode: report.boundarySplatMode,
    boundarySplatRendererIdentity: report.boundarySplatRendererIdentity,
    boundarySplatSourceAuthority: report.boundarySplatSourceAuthority,
    boundarySplatCapacity: report.boundarySplatCapacity,
    boundarySplatSelectorPolicyIdentity: report.boundarySplatSelectorPolicyIdentity,
    boundarySplatRequestedCandidateBudget: report.boundarySplatRequestedCandidateBudget,
    boundarySplatEffectiveCandidateBudget: report.boundarySplatEffectiveCandidateBudget,
    boundarySplatSelectedCandidateCount: report.boundarySplatSelectedCandidateCount,
    boundarySplatSelectorCostProfile: report.boundarySplatSelectorCostProfile,
    boundarySplatCandidateCount: report.boundarySplatCandidateCount,
    boundarySplatSourceCandidateCount: sourceCandidateCount,
    boundarySplatInstanceCount: report.boundarySplatInstanceCount,
    boundarySplatOverflowCount: report.boundarySplatOverflowCount,
    boundarySplatCountAuthority: report.boundarySplatCountAuthority,
    boundarySplatFallbackReason: report.boundarySplatFallbackReason,
    boundarySplatGpuProfile: profile,
    boundarySplatCopyDisposition: copyDisposition,
    boundarySplatCopyBytesThisFrame: report.boundarySplatCopyBytesThisFrame,
    selectorPlusRasterMs: Number(report.boundarySplatSelectorCostProfile?.selectorGpuMs || 0) + Number(profile?.stages?.splatRaster?.ms || 0),
    litPixels,
    meanLuma,
    falseClosureChecks,
    optimizationClaimAllowed: !Object.values(falseClosureChecks).some(Boolean),
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
    let failedReport = null;
    try {
      failedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      failedReport = null;
    }
    const summarizedFailure = failedReport
      ? summarizeRun(testCase, reportPath, screenshotPath, failedReport)
      : null;
    return {
      ok: false,
      serialIndex: index,
      id: testCase.id,
      phase: 'witness',
      requestedRoute: benchmarkRoute(testCase),
      command: [process.execPath, ...witnessArgs],
      status: result.status,
      signal: result.signal,
      stderr: result.stderr,
      reportPath,
      screenshotPath,
      ...(summarizedFailure || {}),
      witnessReportAvailable: Boolean(failedReport),
      optimizationClaimAllowed: false,
      falseClosureChecks: {
        ...(summarizedFailure?.falseClosureChecks || initialFalseClosureChecks()),
        blankOrPartialReport: true,
      },
    };
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return {
    ok: true,
    serialIndex: index,
    ...summarizeRun(testCase, reportPath, screenshotPath, report),
  };
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
  writeReport({
    status: 'running',
    phase: 'start',
    cases: CASES,
    runs,
    falseClosureChecks: initialFalseClosureChecks(),
    optimizationClaimAllowed: false,
  });

  let phase = 'runs';
  let browserClose = { attempted: false, status: 'not-started', leftAlive: false };
  try {
    for (const [index, testCase] of CASES.entries()) {
      const run = runWitness(testCase, index);
      runs.push(run);
      writeReport({
        status: 'running',
        phase,
        cases: CASES,
        runs,
        browserClose,
        falseClosureChecks: initialFalseClosureChecks(),
        optimizationClaimAllowed: false,
      });
    }
  } catch (error) {
    runs.push({
      ok: false,
      phase,
      error: error?.message || String(error),
      optimizationClaimAllowed: false,
      falseClosureChecks: {
        ...initialFalseClosureChecks(),
        blankOrPartialReport: true,
      },
    });
  } finally {
    phase = 'browser-close';
    browserClose = await closeSharedBrowser();
  }

  const falseClosureChecks = initialFalseClosureChecks();
  falseClosureChecks.blankOrPartialReport = runs.length !== CASES.length || runs.some(run => !run.ok);
  falseClosureChecks.multipleParallelBrowsers = new Set(runs.map(run => run.browserSession?.port).filter(Boolean)).size > 1;
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.falseClosureChecks || {})) {
      falseClosureChecks[key] ||= Boolean(value);
    }
  }
  const optimizationClaimAllowed = runs.length === CASES.length
    && runs.every(run => run.ok && run.optimizationClaimAllowed)
    && !Object.values(falseClosureChecks).some(Boolean);
  const status = optimizationClaimAllowed ? 'valid-optimization-evidence' : 'invalid-for-optimization-claim';

  const candidateScaling = runs
    .filter(run => Number.isFinite(Number(run.boundarySplatEffectiveCandidateBudget))
      && Number.isFinite(Number(run.boundarySplatSelectedCandidateCount))
      && run.boundarySplatGpuProfile)
    .map(run => ({
      id: run.id,
      resolution: run.resolution,
      renderScale: run.renderScale,
      viewport: run.viewport,
      requestedInstances: run.requestedInstances,
      requestedCandidateBudget: run.requestedCandidateBudget,
      renderPixels: Number(run.renderWidth || 0) * Number(run.renderHeight || 0),
      boundarySplatCandidateCount: run.boundarySplatCandidateCount,
      boundarySplatSourceCandidateCount: run.boundarySplatSourceCandidateCount,
      boundarySplatEffectiveCandidateBudget: run.boundarySplatEffectiveCandidateBudget,
      boundarySplatSelectedCandidateCount: run.boundarySplatSelectedCandidateCount,
      selectorPolicyIdentity: run.boundarySplatSelectorPolicyIdentity,
      boundarySplatOverflowCount: run.boundarySplatOverflowCount,
      candidateCopyBytes: run.boundarySplatCopyBytesThisFrame,
      timestampStatus: run.boundarySplatGpuProfile?.timestampStatus || null,
      selectorGpuMs: run.boundarySplatSelectorCostProfile?.selectorGpuMs ?? null,
      splatRasterMs: run.boundarySplatGpuProfile?.stages?.splatRaster?.ms ?? null,
      selectorPlusRasterMs: run.selectorPlusRasterMs ?? null,
      matchedRaymarchRasterMs: run.boundarySplatGpuProfile?.stages?.matchedRaymarchRaster?.ms ?? null,
      visualEvidenceAccepted: Boolean(run.ok),
      optimizationClaimAllowed: Boolean(run.optimizationClaimAllowed),
    }));

  writeReport({
    status,
    phase: 'complete',
    cases: CASES,
    runs,
    candidateScaling,
    browserClose,
    falseClosureChecks,
    optimizationClaimAllowed,
    conclusion: optimizationClaimAllowed
      ? 'Timestamp-backed splat/raymarch comparison is claimable for these serial cases.'
      : 'No optimization claim is allowed: at least one false-closure check tripped, most likely missing timestamp support in this browser.',
  });

  console.log(JSON.stringify({ status, out, browserClose, falseClosureChecks, optimizationClaimAllowed }, null, 2));
  if (runs.some(run => !run.ok && !run.witnessReportAvailable)) process.exitCode = 1;
}

main().catch(async error => {
  const browserClose = await closeSharedBrowser();
  writeReport({
    status: 'failed-before-primary-output',
    phase: 'top-level',
    error: error?.message || String(error),
    browserClose,
    falseClosureChecks: {
      ...initialFalseClosureChecks(),
      blankOrPartialReport: true,
    },
    optimizationClaimAllowed: false,
  });
  process.exitCode = 1;
});
