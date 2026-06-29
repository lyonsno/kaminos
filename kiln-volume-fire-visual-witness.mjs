#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildKilnVolumeFireWitness } from './kiln-volume-fire-bridge.mjs';

const TOOL_ID = 'beaming-kiln-volume-fire-visual-witness-v0';
const REPORT_SCHEMA = 'beaming.volume-fire.route-activity-visual-witness-report.v0';
const ACCEPTANCE_SURFACE = 'beaming-volume-witness-current-renderer';
const EFFECTIVE_FIXTURE = 'wake-route-activity-bridge-fixture-v0';

function routeActivity(overrides = {}) {
  const fire = {
    heatClass: 'burn',
    fuelClass: 'local-webgpu',
    truthClass: 'live',
    visualAuthority: 'live-compute',
    allowsFullBurn: true,
    spendIntensity: 1,
    custodyStrength: 0.8,
    failureSharpness: 0,
    cacheWarmth: 0,
    outputSlotCount: 1,
    warningLoad: 0,
    ...overrides.fire,
  };
  return {
    schema: 'kaminos.kiln.route-activity.v0',
    activityId: 'live-run-route-activity',
    routeRunId: 'live-run',
    activityState: 'burning',
    routePhase: 'running',
    truthMode: 'live',
    visualAuthority: 'live-compute',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'adapter.moge-local-webgpu.v0',
    backendClass: 'browser-webgpu',
    receiptId: 'receipt-live-001',
    sourceArtifactIds: ['source-image-a'],
    conditioningArtifactIds: ['depth-a'],
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'pending' }],
    sourceTruthWarnings: [],
    falseAuthorityViolations: [],
    fire,
    ...overrides,
  };
}

function routeRun(routeActivityPayload, overrides = {}) {
  return {
    schema: 'kaminos.kiln.tray-route-run.v0',
    runId: routeActivityPayload.routeRunId,
    requestedRoute: routeActivityPayload.requestedRoute,
    effectiveRoute: routeActivityPayload.effectiveRoute,
    backendClass: routeActivityPayload.backendClass,
    statusBadge: overrides.statusBadge || 'real',
    routePhase: routeActivityPayload.routePhase,
    receiptId: routeActivityPayload.receiptId,
    inputArtifactIds: routeActivityPayload.sourceArtifactIds,
    conditioningArtifactIds: routeActivityPayload.conditioningArtifactIds,
    outputArtifactIds: (routeActivityPayload.outputSlots || []).map(slot => slot.artifactId),
    routeActivity: routeActivityPayload,
    sourceTruthWarnings: routeActivityPayload.sourceTruthWarnings,
    ...overrides,
  };
}

function fixtureRouteRuns() {
  const live = routeActivity();
  const cached = routeActivity({
    activityId: 'cached-run-route-activity',
    routeRunId: 'cached-run',
    activityState: 'cached',
    routePhase: 'completed',
    truthMode: 'cached',
    visualAuthority: 'cached',
    backendClass: 'cache',
    receiptId: 'receipt-cached-001',
    sourceTruthWarnings: ['cached_not_fresh_compute'],
    fire: {
      heatClass: 'glow',
      fuelClass: 'cached',
      truthClass: 'cached',
      visualAuthority: 'cached',
      allowsFullBurn: false,
      spendIntensity: 0,
      cacheWarmth: 0.8,
    },
  });
  const fallback = routeActivity({
    activityId: 'fallback-run-route-activity',
    routeRunId: 'fallback-run',
    activityState: 'fallback',
    routePhase: 'running',
    truthMode: 'fallback',
    visualAuthority: 'fallback',
    effectiveRoute: 'fixture-generator',
    backendClass: 'fixture',
    receiptId: 'receipt-fallback-001',
    sourceTruthWarnings: ['fallback_kiln_not_requested_route'],
    fire: {
      heatClass: 'burn',
      fuelClass: 'fixture',
      truthClass: 'fallback',
      visualAuthority: 'fallback',
      allowsFullBurn: true,
      spendIntensity: 1,
      warningLoad: 1,
    },
  });
  const unavailable = routeActivity({
    activityId: 'missing-run-route-activity',
    routeRunId: 'missing-run',
    activityState: 'unavailable',
    routePhase: 'queued',
    truthMode: 'unavailable',
    visualAuthority: 'none',
    effectiveRoute: null,
    backendClass: 'missing',
    receiptId: null,
    sourceArtifactIds: [],
    conditioningArtifactIds: [],
    outputSlots: [],
    sourceTruthWarnings: ['kiln_backend_unavailable'],
    fire: {
      heatClass: 'cold',
      fuelClass: 'unknown',
      truthClass: 'unavailable',
      visualAuthority: 'none',
      allowsFullBurn: false,
    },
  });

  return [
    routeRun(live),
    routeRun(cached, { statusBadge: 'cached' }),
    routeRun(fallback, { statusBadge: 'fallback' }),
    routeRun(unavailable, { statusBadge: 'missing-backend' }),
  ];
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    out: '/tmp/kaminos-route-activity-beaming-volume-fire.png',
    report: '/tmp/kaminos-route-activity-beaming-volume-fire.json',
    serverPort: 18114,
    debugPort: 9438,
    settleMs: 2500,
    windowSize: '1280,960',
    evidenceMode: 'performance',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--out') args.out = argv[++index] || args.out;
    else if (arg === '--report') args.report = argv[++index] || args.report;
    else if (arg === '--server-port') args.serverPort = Number(argv[++index] || args.serverPort);
    else if (arg === '--debug-port') args.debugPort = Number(argv[++index] || args.debugPort);
    else if (arg === '--settle-ms') args.settleMs = Number(argv[++index] || args.settleMs);
    else if (arg === '--window-size') args.windowSize = argv[++index] || args.windowSize;
    else if (arg === '--evidence-mode') args.evidenceMode = argv[++index] || args.evidenceMode;
  }
  return args;
}

function volumeUrlForBridge(bridge, baseUrl) {
  const url = new URL(baseUrl);
  const params = bridge.visualReceipt?.volumeParams || {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildBaseReport({ args, routeActivityWitness, primaryBridge, volumeWitnessUrl }) {
  return {
    schema: REPORT_SCHEMA,
    toolId: TOOL_ID,
    effectiveFixture: EFFECTIVE_FIXTURE,
    acceptanceSurface: ACCEPTANCE_SURFACE,
    dryRun: args.dryRun,
    requestedOut: args.out,
    screenshot: resolve(args.out),
    requestedReport: args.report,
    outputPath: resolve(args.report),
    serverPort: args.serverPort,
    debugPort: args.debugPort,
    settleMs: args.settleMs,
    windowSize: args.windowSize,
    evidenceMode: args.evidenceMode,
    volumeWitnessUrl,
    routeActivityWitness,
    primaryBridge,
    visualWitnessReport: null,
    phase: args.dryRun ? 'dry-run' : 'initialized',
  };
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

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out);
const reportPath = resolve(args.report);
const volumeReportPath = reportPath.replace(/\.json$/i, '.volume-witness.json');
const routeActivityWitness = buildKilnVolumeFireWitness({
  witnessId: 'route-tray-fire-visual-witness-001',
  routeRuns: fixtureRouteRuns(),
});
const primaryBridge = routeActivityWitness.primaryBridge;
const volumeWitnessUrl = volumeUrlForBridge(primaryBridge, `http://127.0.0.1:${args.serverPort}/`);
const report = buildBaseReport({ args, routeActivityWitness, primaryBridge, volumeWitnessUrl });

if (args.dryRun) {
  writeReport(reportPath, report);
  console.log(reportPath);
  process.exit(0);
}

let server = null;
try {
  mkdirSync(dirname(out), { recursive: true });
  server = spawn('python3', ['-m', 'http.server', String(args.serverPort), '--bind', '127.0.0.1'], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: 'ignore',
  });
  report.phase = 'server-start';
  waitForServer(args.serverPort);
  report.phase = 'volume-witness';
  execFileSync(process.execPath, [
    'volume-witness.mjs',
    '--url',
    volumeWitnessUrl,
    '--out',
    out,
    '--report',
    volumeReportPath,
    '--debug-port',
    String(args.debugPort),
    '--settle-ms',
    String(args.settleMs),
    '--window-size',
    args.windowSize,
    '--evidence-mode',
    args.evidenceMode,
    '--full-screenshot',
    out.replace(/\.png$/i, '.full.png'),
  ], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: 'pipe',
  });
  const visualWitnessReport = readJsonIfExists(volumeReportPath);
  report.phase = 'complete';
  report.visualWitnessReport = visualWitnessReport;
  report.visualWitnessReportPath = volumeReportPath;
  writeReport(reportPath, report);
  console.log(reportPath);
} catch (error) {
  report.phase = `failed:${report.phase}`;
  report.error = error?.message || String(error);
  report.visualWitnessReport = readJsonIfExists(volumeReportPath);
  report.visualWitnessReportPath = volumeReportPath;
  writeReport(reportPath, report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  if (server) server.kill('SIGTERM');
}
