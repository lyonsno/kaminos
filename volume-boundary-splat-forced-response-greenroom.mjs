#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA = 'kaminos.volume.boundary-splat-forced-response-greenroom.v0';
const CONFIG_SCHEMA = 'kaminos.volume.boundary-splat-forced-response-greenroom-config.v0';
const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || process.cwd()));
const configPath = resolve(String(args.get('--config') || ''));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-forced-response-greenroom'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/greenroom-supervisor-report.json`));
const witnessReportPath = resolve(`${outDir}/witness-report.json`);
const serverPort = positiveInteger(args.get('--server-port'), 18291);
const chromePort = positiveInteger(args.get('--chrome-port'), 19491);
const startedAt = new Date().toISOString();

let server = null;
let failurePhase = 'startup';
let requestedRoute = null;
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });

try {
  failurePhase = 'config-load';
  if (!configPath || !existsSync(configPath)) throw new Error(`missing Greenroom config: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  validateConfig(config);
  lastTrustworthyEvidence.config = {
    path: configPath,
    schema: config.schema,
    renderer: config.renderer,
    costLadderInstances: config.costLadderInstances,
  };

  requestedRoute = buildRoute(config.route);
  lastTrustworthyEvidence.requestedRoute = requestedRoute;

  failurePhase = 'http-server-start';
  const serverLogFd = openSync(resolve(outDir, 'server.log'), 'a');
  try {
    server = spawn('python3', ['-m', 'http.server', String(serverPort), '--bind', '127.0.0.1'], {
      cwd: repoRoot,
      stdio: ['ignore', serverLogFd, serverLogFd],
    });
  } finally {
    closeSync(serverLogFd);
  }
  server.once('exit', (code, signal) => {
    lastTrustworthyEvidence.serverExit = { code, signal };
  });
  await waitForHttp(`http://127.0.0.1:${serverPort}/`);
  lastTrustworthyEvidence.server = {
    pid: server.pid,
    repoRoot,
    origin: `http://127.0.0.1:${serverPort}`,
  };

  failurePhase = 'forced-response-witness';
  const witnessArgs = [
    resolve(repoRoot, 'volume-boundary-splat-motion-witness.mjs'),
    '--forced-response-assay',
    '--forced-response-renderer', config.renderer,
    '--headless',
    '--url', requestedRoute,
    '--out-dir', resolve(outDir, 'captures'),
    '--report', witnessReportPath,
    '--chrome-port', String(chromePort),
    '--settle-ms', String(config.settleMs),
    '--window-size', config.windowSize,
    '--user-data-dir', resolve(outDir, 'chrome-profile'),
  ];
  const witness = await runChild(process.execPath, witnessArgs, {
    cwd: repoRoot,
    stdoutPath: resolve(outDir, 'witness.stdout.log'),
    stderrPath: resolve(outDir, 'witness.stderr.log'),
  });
  lastTrustworthyEvidence.witnessProcess = witness;

  const witnessReport = readJsonIfPresent(witnessReportPath);
  if (witnessReport) {
    lastTrustworthyEvidence.witness = compactWitnessEvidence(witnessReport);
  }
  if (witness.code !== 0) throw new Error(`forced-response witness exited ${witness.code}`);
  if (witnessReport?.status !== 'completed') {
    throw new Error(`forced-response witness did not complete: ${witnessReport?.status || 'missing-report'}`);
  }

  failurePhase = 'evidence-validation';
  if (witnessReport.browser?.headless !== true || witnessReport.browser?.unsafeWebGpuEnabled !== true) {
    throw new Error('timestamp-capable headless WebGPU route was not effective');
  }
  if (witnessReport.effectiveRoute !== 'boundary-splat-analytical-age-height-forcing-warp-v0') {
    throw new Error(`effective response route disagreement: ${witnessReport.effectiveRoute}`);
  }
  if (witnessReport.timing?.rows?.map(row => row.instanceCount).join(',') !== '1,16,100') {
    throw new Error('complete response ladder is missing 1/16/100 rows');
  }

  const report = buildReport({
    status: 'completed',
    effectiveRoute: witnessReport.effectiveRoute,
    witnessReport,
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) {
  const witnessReport = readJsonIfPresent(witnessReportPath);
  if (witnessReport && !lastTrustworthyEvidence.witness) {
    lastTrustworthyEvidence.witness = compactWitnessEvidence(witnessReport);
  }
  const report = buildReport({
    status: witnessReport ? 'failed-after-partial-output' : 'failed-before-primary-output',
    effectiveRoute: witnessReport?.effectiveRoute || null,
    witnessReport,
    error: error?.stack || error?.message || String(error),
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  if (server && server.exitCode == null && server.signalCode == null) {
    server.kill('SIGTERM');
    await waitForExit(server, 2000);
  }
}

function buildReport({ status, effectiveRoute, witnessReport, error = null }) {
  return {
    schema: SCHEMA,
    status,
    failurePhase: status === 'completed' ? null : failurePhase,
    error,
    startedAt,
    completedAt: new Date().toISOString(),
    repoRoot,
    requestedRoute,
    effectiveRoute,
    requestedBackend: {
      browser: 'chrome-headless-new',
      unsafeWebGpuEnabled: true,
      timingAuthority: 'gpu-timestamp-query',
    },
    effectiveBackend: witnessReport ? {
      browser: witnessReport.browser || null,
      renderer: witnessReport.forcedResponseRendererIdentity || witnessReport.rendererIdentity || null,
      timingAuthority: witnessReport.timing?.authority
        || witnessReport.lastTrustworthyEvidence?.forcedResponseAssay?.timingAuthority
        || null,
    } : null,
    witnessReportPath,
    lastTrustworthyEvidence,
  };
}

function compactWitnessEvidence(report) {
  return {
    schema: report.schema || null,
    status: report.status || null,
    failurePhase: report.failurePhase || null,
    effectiveRoute: report.effectiveRoute || report.lastTrustworthyEvidence?.forcedResponseAssay?.effectiveRoute || null,
    browser: report.browser || null,
    timing: report.timing || report.lastTrustworthyEvidence?.forcedResponseAssay?.timingRows || null,
    visualDeltas: report.visualDeltas || report.lastTrustworthyEvidence?.forcedResponseAssay?.visualDeltas || null,
    inspectedArtifacts: report.inspectedArtifacts || report.lastTrustworthyEvidence?.forcedResponseAssay?.inspectedArtifacts || [],
    stopCeilingExceeded: report.stopCeilingExceeded ?? report.lastTrustworthyEvidence?.forcedResponseAssay?.stopCeilingExceeded ?? null,
  };
}

function validateConfig(config) {
  if (config?.schema !== CONFIG_SCHEMA) throw new Error(`config schema disagreement: ${config?.schema}`);
  if (!['analytic', 'learned'].includes(config.renderer)) throw new Error(`unsupported renderer: ${config.renderer}`);
  if (config.costLadderInstances?.join(',') !== '1,16,100') throw new Error('cost ladder must be exactly 1,16,100');
  if (!config.route || typeof config.route !== 'object') throw new Error('route controls are missing');
  if (config.route.volume_boundary_splat_mode !== config.renderer) throw new Error('route renderer disagrees with requested renderer');
}

function buildRoute(route) {
  const url = new URL(`http://127.0.0.1:${serverPort}/`);
  for (const [key, value] of Object.entries(route)) url.searchParams.set(key, String(value));
  return url.toString();
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode != null || server?.signalCode != null) throw new Error('HTTP server exited before becoming reachable');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`HTTP server did not become reachable: ${url}`);
}

function runChild(command, childArgs, { cwd, stdoutPath, stderrPath }) {
  return new Promise((resolveChild, rejectChild) => {
    const stdoutFd = openSync(stdoutPath, 'a');
    const stderrFd = openSync(stderrPath, 'a');
    let child;
    try {
      child = spawn(command, childArgs, { cwd, stdio: ['ignore', stdoutFd, stderrFd] });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    child.once('error', rejectChild);
    child.once('exit', (code, signal) => {
      resolveChild({ code, signal, command, args: childArgs });
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    delay(timeoutMs),
  ]);
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const map = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) map.set(key, '1');
    else {
      map.set(key, value);
      index += 1;
    }
  }
  return map;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value || fallback));
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`invalid positive integer: ${value}`);
  return parsed;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
