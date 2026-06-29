#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  BEAMING_KILN_ROUTE_FIRE_ACCEPTANCE_SURFACE,
  BEAMING_KILN_ROUTE_FIRE_DEFAULT_EVIDENCE_MODE,
  BEAMING_KILN_ROUTE_FIRE_FIXTURE_ID,
  buildKilnVolumeFireBenchModel,
} from './kiln-volume-fire-bench.mjs';

const TOOL_ID = 'beaming-kiln-volume-fire-visual-witness-v0';
const REPORT_SCHEMA = 'beaming.volume-fire.route-activity-visual-witness-report.v0';

function parseArgs(argv) {
  const args = {
    dryRun: false,
    out: '/tmp/kaminos-route-activity-beaming-volume-fire.png',
    report: '/tmp/kaminos-route-activity-beaming-volume-fire.json',
    serverPort: 18114,
    debugPort: 9438,
    settleMs: 2500,
    windowSize: '1280,960',
    evidenceMode: BEAMING_KILN_ROUTE_FIRE_DEFAULT_EVIDENCE_MODE,
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

function buildBaseReport({ args, routeActivityWitness, primaryBridge, volumeWitnessUrl }) {
  return {
    schema: REPORT_SCHEMA,
    toolId: TOOL_ID,
    effectiveFixture: BEAMING_KILN_ROUTE_FIRE_FIXTURE_ID,
    acceptanceSurface: BEAMING_KILN_ROUTE_FIRE_ACCEPTANCE_SURFACE,
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
const bench = buildKilnVolumeFireBenchModel({
  baseUrl: `http://127.0.0.1:${args.serverPort}/`,
  witnessId: 'route-tray-fire-visual-witness-001',
  evidenceMode: args.evidenceMode,
});
const routeActivityWitness = bench.witness;
const primaryBridge = bench.primaryBridge;
const volumeWitnessUrl = bench.launchUrl;
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
