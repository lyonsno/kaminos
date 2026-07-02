#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addRouteRun,
} from './route-composition-tray.mjs';
import {
  buildKilnVolumeFireWitness,
} from './kiln-volume-fire-bridge.mjs';
import {
  volumeUrlForBridge,
} from './kiln-volume-fire-bench.mjs';
import {
  computeRouteFirePayloadFromReport,
  computeRouteFireSmokeUrl,
} from './compute-route-fire-bench.mjs';
import {
  computeRouteVisibleBenchUrl,
} from './compute-route-visible-bench.mjs';
import {
  buildComputeRouteContentionWitnessFromReport,
} from './compute-route-contention-witness.mjs';

export const COMPUTE_ROUTE_FIRE_WITNESS_SCHEMA = 'kaminos.compute-route-fire-witness.v0';
export const COMPUTE_ROUTE_FIRE_VISUAL_REPORT_SCHEMA = 'kaminos.compute-route-fire-visual-report.v0';
export const DEFAULT_SHARP_PIPELINE_ID = 'sharp-image-to-splat-live-v0';
export const DEFAULT_SHARP_ROUTE_ID = 'adapter.sharp-image-to-splat-live.v0';
export const DEFAULT_SHARP_BACKEND_CLASS = 'browser-webgpu';

function unique(values) {
  return [...new Set((values || []).map(value => String(value)).filter(Boolean))];
}

function firstStage(report) {
  return Array.isArray(report?.stages) ? report.stages[0] || null : null;
}

function artifactEntries(report) {
  return Object.entries(report?.artifacts || {})
    .filter(([, artifact]) => artifact?.path)
    .map(([id, artifact]) => ({
      id,
      role: artifact.role || id,
      status: artifact.status || null,
      path: artifact.path,
      schema: artifact.schema || null,
    }));
}

function outputArtifactIdsFromReport(report) {
  return artifactEntries(report)
    .filter(entry => entry.id !== 'input')
    .map(entry => `${entry.id}:${entry.path}`);
}

function inputArtifactIdsFromReport(report) {
  const input = report?.artifacts?.input;
  if (input?.path) return [input.path];
  return [];
}

function routeIdFromReport(report) {
  return report?.effectiveRouteConfig?.routeId
    || firstStage(report)?.requestedRoute
    || firstStage(report)?.effectiveRoute?.id
    || report?.effectivePipelineId
    || report?.requestedPipelineId
    || DEFAULT_SHARP_ROUTE_ID;
}

function backendClassFromReport(report) {
  return firstStage(report)?.effectiveRoute?.effectiveBackend
    || firstStage(report)?.effectiveRoute?.backendClass
    || DEFAULT_SHARP_BACKEND_CLASS;
}

function stageStatusBadge(report) {
  const stage = firstStage(report);
  const artifactStatuses = artifactEntries(report).map(entry => entry.status);
  if (report?.ok === false || stage?.status === 'failed') return 'failed';
  if (stage?.status === 'fixture' || artifactStatuses.some(status => status === 'fixture')) return 'fixture';
  if (stage?.status === 'partial' || artifactStatuses.some(status => status === 'partial')) return 'partial';
  if (stage?.status === 'cached' || artifactStatuses.some(status => status === 'cached')) return 'cached';
  if (stage?.status === 'real' || artifactStatuses.some(status => status === 'real')) return 'real';
  return report?.ok === true ? 'real' : 'missing-backend';
}

function routeWarningsForReport(report, statusBadge) {
  const warnings = [];
  const stage = firstStage(report);
  if (statusBadge === 'failed') warnings.push('pipeline_route_failed');
  if (statusBadge === 'fixture') warnings.push('pipeline_route_fixture_or_mock_adapter');
  if (statusBadge === 'partial') warnings.push('pipeline_route_partial_output');
  if (statusBadge === 'cached') warnings.push('pipeline_route_cached_output');
  if (statusBadge === 'real') warnings.push('pipeline_route_completed_not_active_compute');
  if (stage?.effectiveRoute?.fixtureMode) warnings.push(`pipeline_route_fixture_mode:${stage.effectiveRoute.fixtureMode}`);
  if (report?.artifacts?.autoCropEvidence?.path) warnings.push('pipeline_autocrop_evidence_present');
  if (report?.error) warnings.push(`pipeline_error:${report.error}`);
  return unique(warnings);
}

export function buildActiveComputeRouteRun({
  pipelineId = DEFAULT_SHARP_PIPELINE_ID,
  routeId = DEFAULT_SHARP_ROUTE_ID,
  backendClass = DEFAULT_SHARP_BACKEND_CLASS,
  reportPath = null,
  inputPath = null,
  runId = `${pipelineId}-active`,
} = {}) {
  return addRouteRun({
    schema: 'kaminos.kiln.route-composition-tray.v0',
    trayId: 'active-compute-route-fire-tray',
    sourceArtifacts: [],
    conditioningLinks: [],
    routeRuns: [],
    outputArtifacts: [],
  }, {
    runId,
    requestedRoute: routeId,
    effectiveRoute: routeId,
    backendClass,
    statusBadge: 'real',
    routePhase: 'running',
    receiptId: reportPath,
    inputArtifactIds: inputPath ? [inputPath] : [],
    conditioningArtifactIds: [],
    outputArtifactIds: [],
  }).routeRuns[0];
}

export function buildRouteRunFromPipelineReport(report, {
  reportPath = null,
  runId = null,
  routePhase = null,
} = {}) {
  if (!report || report.schema !== 'kaminos.pipeline-witness.v0') {
    throw new Error('valid kaminos.pipeline-witness.v0 report is required');
  }
  const statusBadge = stageStatusBadge(report);
  const effectiveRoute = routeIdFromReport(report);
  const requestedRoute = report.effectiveRouteConfig?.routeId || effectiveRoute;
  const phase = routePhase || (statusBadge === 'failed' ? 'failed' : 'completed');
  const routeRun = addRouteRun({
    schema: 'kaminos.kiln.route-composition-tray.v0',
    trayId: 'pipeline-report-route-fire-tray',
    sourceArtifacts: [],
    conditioningLinks: [],
    routeRuns: [],
    outputArtifacts: [],
  }, {
    runId: runId || `${report.requestedPipelineId || 'pipeline-route'}-${report.phase || 'report'}`,
    requestedRoute,
    effectiveRoute,
    backendClass: backendClassFromReport(report),
    statusBadge,
    routePhase: phase,
    receiptId: reportPath || report.bundleIndex?.path || report.effectiveRouteConfig?.outputRoot || null,
    inputArtifactIds: inputArtifactIdsFromReport(report),
    conditioningArtifactIds: [],
    outputArtifactIds: outputArtifactIdsFromReport(report),
  }).routeRuns[0];
  const warnings = routeWarningsForReport(report, statusBadge);
  routeRun.sourceTruthWarnings = unique([...(routeRun.sourceTruthWarnings || []), ...warnings]);
  routeRun.routeActivity.sourceTruthWarnings = unique([...(routeRun.routeActivity.sourceTruthWarnings || []), ...warnings]);
  routeRun.routeActivity.fire.warningLoad = routeRun.routeActivity.sourceTruthWarnings.length;
  routeRun.pipelineReportSummary = {
    schema: report.schema,
    ok: report.ok === true,
    requestedPipelineId: report.requestedPipelineId || null,
    effectivePipelineId: report.effectivePipelineId || null,
    reportPath,
    phase: report.phase || null,
    stageStatus: firstStage(report)?.status || null,
    artifactRoles: artifactEntries(report).map(entry => entry.role),
    autoCropEvidencePath: report.artifacts?.autoCropEvidence?.path || null,
  };
  return routeRun;
}

export function buildComputeRouteFireWitness({
  witnessId = 'compute-route-fire-witness-001',
  routeRun,
  baseUrl = 'http://127.0.0.1:18118/',
  pipelineReport = null,
  phase = 'built',
} = {}) {
  if (!routeRun?.routeActivity) throw new Error('routeRun with routeActivity is required');
  const routeActivityWitness = buildKilnVolumeFireWitness({
    witnessId,
    routeRuns: [routeRun],
  });
  const primaryBridge = routeActivityWitness.primaryBridge;
  return {
    schema: COMPUTE_ROUTE_FIRE_WITNESS_SCHEMA,
    witnessId,
    phase,
    routeRun,
    routeActivityWitness,
    primaryBridge,
    volumeWitnessUrl: volumeUrlForBridge(primaryBridge, baseUrl),
    pipelineReportSummary: pipelineReport ? {
      schema: pipelineReport.schema || null,
      ok: pipelineReport.ok === true,
      requestedPipelineId: pipelineReport.requestedPipelineId || null,
      effectivePipelineId: pipelineReport.effectivePipelineId || null,
      phase: pipelineReport.phase || null,
      artifactIds: Object.keys(pipelineReport.artifacts || {}),
      autoCropEvidencePath: pipelineReport.artifacts?.autoCropEvidence?.path || null,
    } : routeRun.pipelineReportSummary || null,
  };
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    pipelineWorktree: '/private/tmp/kaminos-pipeline-gutfucker-0623',
    pipelineId: DEFAULT_SHARP_PIPELINE_ID,
    routeId: DEFAULT_SHARP_ROUTE_ID,
    backendClass: DEFAULT_SHARP_BACKEND_CLASS,
    input: null,
    outDir: '/tmp/kaminos-compute-route-fire/pipeline-out',
    pipelineReport: null,
    report: '/tmp/kaminos-compute-route-fire/report.json',
    contentionReport: null,
    out: '/tmp/kaminos-compute-route-fire/fire.png',
    serverPort: 18118,
    debugPort: 9441,
    settleMs: 2500,
    windowSize: '1280,960',
    requestedBudgetId: 'operator-live-fire',
    requestedRayBudgetPreset: null,
    runPipeline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--run-pipeline') args.runPipeline = true;
    else if (arg === '--pipeline-worktree') args.pipelineWorktree = argv[++index] || args.pipelineWorktree;
    else if (arg === '--pipeline-id') args.pipelineId = argv[++index] || args.pipelineId;
    else if (arg === '--route-id') args.routeId = argv[++index] || args.routeId;
    else if (arg === '--backend-class') args.backendClass = argv[++index] || args.backendClass;
    else if (arg === '--input') args.input = argv[++index] || args.input;
    else if (arg === '--out-dir') args.outDir = argv[++index] || args.outDir;
    else if (arg === '--pipeline-report') args.pipelineReport = argv[++index] || args.pipelineReport;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--contention-report') args.contentionReport = argv[++index] || args.contentionReport;
    else if (arg === '--out') args.out = argv[++index] || args.out;
    else if (arg === '--server-port') args.serverPort = Number(argv[++index] || args.serverPort);
    else if (arg === '--debug-port') args.debugPort = Number(argv[++index] || args.debugPort);
    else if (arg === '--settle-ms') args.settleMs = Number(argv[++index] || args.settleMs);
    else if (arg === '--window-size') args.windowSize = argv[++index] || args.windowSize;
    else if (arg === '--requested-budget-id') args.requestedBudgetId = argv[++index] || args.requestedBudgetId;
    else if (arg === '--requested-ray-budget-preset') args.requestedRayBudgetPreset = argv[++index] || args.requestedRayBudgetPreset;
  }
  return args;
}

function waitForServer(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      execFileSync('python3', ['-c', `import urllib.request; urllib.request.urlopen("http://127.0.0.1:${port}/", timeout=0.25).read(1)`], {
        stdio: 'ignore',
      });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125);
    }
  }
  throw new Error(`static server did not respond on port ${port}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildOperatorSmokeUrlFromContentionWitness(witness, {
  baseUrl = 'http://127.0.0.1:18121/',
  volumeWitnessUrl = null,
} = {}) {
  return computeRouteVisibleBenchUrl(witness, {
    baseUrl,
    volumeWitnessUrl,
    payload: 'model',
  });
}

function runPipelineWitness(args, reportPath) {
  if (!args.input) throw new Error('--input is required with --run-pipeline');
  mkdirSync(args.outDir, { recursive: true });
  return spawn(process.execPath, [
    'pipeline-witness.mjs',
    '--pipeline-id', args.pipelineId,
    '--input', resolve(args.input),
    '--out-dir', resolve(args.outDir),
    '--report', reportPath,
  ], {
    cwd: resolve(args.pipelineWorktree),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function captureChildOutput(child) {
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk.toString()));
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));
  return { stdout, stderr };
}

function runVisualWitness({ volumeWitnessUrl, out, report, debugPort, settleMs, windowSize }) {
  execFileSync(process.execPath, [
    'volume-witness.mjs',
    '--url', volumeWitnessUrl,
    '--out', out,
    '--report', report,
    '--debug-port', String(debugPort),
    '--settle-ms', String(settleMs),
    '--window-size', windowSize,
    '--evidence-mode', 'performance',
    '--full-screenshot', out.replace(/\.png$/i, '.full.png'),
  ], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: 'pipe',
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = resolve(args.report);
  const fireOut = resolve(args.out);
  const volumeReportPath = reportPath.replace(/\.json$/i, '.volume-witness.json');
  const contentionReportPath = resolve(args.contentionReport || reportPath.replace(/\.json$/i, '.contention-witness.json'));
  const pipelineReportPath = resolve(args.pipelineReport || `${args.outDir.replace(/\/$/, '')}/pipeline-witness.json`);
  let pipelineProcess = null;
  let pipelineStartedAtMs = null;
  let server = null;
  let activeWitness = null;
  let finalWitness = null;
  const report = {
    schema: COMPUTE_ROUTE_FIRE_VISUAL_REPORT_SCHEMA,
    phase: 'initialized',
    dryRun: args.dryRun,
    runPipeline: args.runPipeline,
    pipelineWorktree: resolve(args.pipelineWorktree),
    pipelineId: args.pipelineId,
    routeId: args.routeId,
    input: args.input ? resolve(args.input) : null,
    pipelineReportPath,
    outputPath: reportPath,
    screenshot: fireOut,
    volumeWitnessReportPath: volumeReportPath,
    contentionWitnessReportPath: contentionReportPath,
    activeWitness: null,
    finalWitness: null,
    smokePayload: null,
    smokeUrl: null,
    routeFireSmokeUrl: null,
    operatorSmokeUrl: null,
    contentionWitness: null,
    pipelineExit: null,
    pipelineReport: null,
    visualWitnessReport: null,
  };

  try {
    if (args.runPipeline) {
      const activeRun = buildActiveComputeRouteRun({
        pipelineId: args.pipelineId,
        routeId: args.routeId,
        backendClass: args.backendClass,
        reportPath: pipelineReportPath,
        inputPath: args.input ? resolve(args.input) : null,
      });
      activeWitness = buildComputeRouteFireWitness({
        witnessId: 'actual-compute-route-active-fire',
        routeRun: activeRun,
        baseUrl: `http://127.0.0.1:${args.serverPort}/`,
        phase: 'pipeline-running',
      });
      report.activeWitness = activeWitness;
      if (!args.dryRun) {
        pipelineStartedAtMs = Date.now();
        pipelineProcess = runPipelineWitness(args, pipelineReportPath);
        pipelineProcess.outputCapture = captureChildOutput(pipelineProcess);
        report.phase = 'pipeline-running';
        report.pipelineExit = {
          status: null,
          startedAt: new Date(pipelineStartedAtMs).toISOString(),
          finishedAt: null,
          durationMs: null,
          stdoutTail: '',
          stderrTail: '',
        };
      } else {
        report.phase = 'pipeline-planned';
      }
    } else {
      if (!existsSync(pipelineReportPath)) throw new Error(`pipeline report does not exist: ${pipelineReportPath}`);
      const pipelineReport = readJson(pipelineReportPath);
      const routeRun = buildRouteRunFromPipelineReport(pipelineReport, { reportPath: pipelineReportPath });
      activeWitness = buildComputeRouteFireWitness({
        witnessId: 'actual-compute-route-report-fire',
        routeRun,
        baseUrl: `http://127.0.0.1:${args.serverPort}/`,
        pipelineReport,
        phase: 'report-consumed',
      });
      report.activeWitness = activeWitness;
      report.pipelineReport = pipelineReport;
    }

    if (args.dryRun) {
      report.phase = 'dry-run';
      report.smokePayload = computeRouteFirePayloadFromReport(report);
      report.routeFireSmokeUrl = computeRouteFireSmokeUrl(report.smokePayload, {
        baseUrl: `http://127.0.0.1:${args.serverPort}/`,
        volumeWitnessUrl: report.activeWitness.volumeWitnessUrl,
      });
      report.smokeUrl = report.routeFireSmokeUrl;
      writeJson(reportPath, report);
      console.log(reportPath);
      return;
    }

    mkdirSync(dirname(fireOut), { recursive: true });
    server = spawn('python3', ['-m', 'http.server', String(args.serverPort), '--bind', '127.0.0.1'], {
      cwd: new URL('.', import.meta.url).pathname,
      stdio: 'ignore',
    });
    waitForServer(args.serverPort);
    report.phase = 'visual-witness-active';
    writeJson(reportPath, report);
    runVisualWitness({
      volumeWitnessUrl: activeWitness.volumeWitnessUrl,
      out: fireOut,
      report: volumeReportPath,
      debugPort: args.debugPort,
      settleMs: args.settleMs,
      windowSize: args.windowSize,
    });
    report.visualWitnessReport = readJson(volumeReportPath);

    if (pipelineProcess) {
      const exitCode = await new Promise(resolve => pipelineProcess.on('close', resolve));
      const pipelineFinishedAtMs = Date.now();
      const outputCapture = pipelineProcess.outputCapture || { stdout: [], stderr: [] };
      report.pipelineExit = {
        status: exitCode,
        startedAt: pipelineStartedAtMs ? new Date(pipelineStartedAtMs).toISOString() : null,
        finishedAt: new Date(pipelineFinishedAtMs).toISOString(),
        durationMs: pipelineStartedAtMs ? pipelineFinishedAtMs - pipelineStartedAtMs : null,
        stdoutTail: outputCapture.stdout.join('').slice(-4000),
        stderrTail: outputCapture.stderr.join('').slice(-4000),
      };
      if (existsSync(pipelineReportPath)) {
        const pipelineReport = readJson(pipelineReportPath);
        report.pipelineReport = pipelineReport;
        finalWitness = buildComputeRouteFireWitness({
          witnessId: 'actual-compute-route-final-fire',
          routeRun: buildRouteRunFromPipelineReport(pipelineReport, { reportPath: pipelineReportPath }),
          baseUrl: `http://127.0.0.1:${args.serverPort}/`,
          pipelineReport,
          phase: 'pipeline-complete',
        });
        report.finalWitness = finalWitness;
      }
      if (exitCode !== 0) report.phase = 'pipeline-failed-after-active-visual';
      else report.phase = 'complete';
    } else {
      report.phase = 'complete';
    }
    if (report.activeWitness) {
      report.smokePayload = computeRouteFirePayloadFromReport(report);
      report.routeFireSmokeUrl = computeRouteFireSmokeUrl(report.smokePayload, {
        baseUrl: `http://127.0.0.1:${args.serverPort}/`,
        volumeWitnessUrl: report.activeWitness.volumeWitnessUrl,
      });
      report.smokeUrl = report.routeFireSmokeUrl;
    }
    if (report.visualWitnessReport) {
      report.contentionWitness = buildComputeRouteContentionWitnessFromReport(report, {
        witnessId: `${args.pipelineId}-contention`,
        requestedVisualBudget: {
          budgetId: args.requestedBudgetId,
          rayBudgetPreset: args.requestedRayBudgetPreset,
          liveSimulation: true,
          prerecorded: false,
        },
        visualWitnessReportPath: volumeReportPath,
      });
      writeJson(contentionReportPath, report.contentionWitness);
      report.operatorSmokeUrl = buildOperatorSmokeUrlFromContentionWitness(report.contentionWitness, {
        baseUrl: `http://127.0.0.1:${args.serverPort}/`,
        volumeWitnessUrl: report.activeWitness?.volumeWitnessUrl || null,
      });
      report.smokeUrl = report.operatorSmokeUrl;
    }
    writeJson(reportPath, report);
    console.log(reportPath);
  } catch (error) {
    report.phase = `failed:${report.phase}`;
    report.error = error?.message || String(error);
    if (existsSync(volumeReportPath)) report.visualWitnessReport = readJson(volumeReportPath);
    if (existsSync(pipelineReportPath)) report.pipelineReport = readJson(pipelineReportPath);
    writeJson(reportPath, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (server) server.kill('SIGTERM');
    if (pipelineProcess && !pipelineProcess.killed && pipelineProcess.exitCode === null) {
      pipelineProcess.kill('SIGTERM');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
