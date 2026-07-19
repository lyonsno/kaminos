#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SAME_STATE_TEACHER_CONTRACT,
  validateSameStateTeacherWitnessIdentity,
} from './same-state-teacher-contract.mjs';

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
let requestedAssay = 'analytical-response';
const lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });

try {
  failurePhase = 'config-load';
  if (!configPath || !existsSync(configPath)) throw new Error(`missing Greenroom config: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  validateConfig(config);
  requestedAssay = config.assay || 'analytical-response';
  lastTrustworthyEvidence.config = {
    path: configPath,
    schema: config.schema,
    assay: config.assay || 'analytical-response',
    renderer: config.renderer || null,
    costLadderInstances: config.costLadderInstances || null,
    horizons: config.horizons || null,
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

  if (isSameStateAssay(config.assay)) {
    failurePhase = 'same-state-teacher-contracts';
    const contracts = await runChild(process.execPath, [resolve(repoRoot, 'tests/volume-same-state-teacher-contracts.mjs')], {
      cwd: repoRoot,
      stdoutPath: resolve(outDir, 'contracts.stdout.log'),
      stderrPath: resolve(outDir, 'contracts.stderr.log'),
    });
    lastTrustworthyEvidence.contracts = contracts;
    if (contracts.code !== 0) throw new Error(`same-state teacher contracts exited ${contracts.code}`);
  }

  failurePhase = isSameStateAssay(config.assay) ? 'same-state-teacher-witness' : 'forced-response-witness';
  const witnessArgs = isSameStateAssay(config.assay)
    ? [
      resolve(repoRoot, 'volume-same-state-teacher-witness.mjs'),
      '--config', configPath,
      '--url', requestedRoute,
      '--out-dir', resolve(outDir, 'captures'),
      '--report', witnessReportPath,
      '--chrome-port', String(chromePort),
      '--user-data-dir', resolve(outDir, 'chrome-profile'),
    ]
    : [
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
  if (witness.code !== 0) throw new Error(`${isSameStateAssay(config.assay) ? 'same-state teacher' : 'forced-response'} witness exited ${witness.code}`);
  if (witnessReport?.status !== 'completed') {
    throw new Error(`forced-response witness did not complete: ${witnessReport?.status || 'missing-report'}`);
  }

  failurePhase = 'evidence-validation';
  if (config.assay === 'same-state-teacher') {
    if (!String(witnessReport.backend || '').startsWith('WebGPU:')) throw new Error(`same-state teacher backend disagreement: ${witnessReport.backend}`);
    if (witnessReport.effectiveRoute !== 'exact-same-state-forced-response-teacher-sequence-v0') {
      throw new Error(`effective teacher route disagreement: ${witnessReport.effectiveRoute}`);
    }
    const selectedRow = validateSameStateTeacherWitnessIdentity(witnessReport);
    if (selectedRow.residual.residualName !== SAME_STATE_TEACHER_CONTRACT.residualName) {
      throw new Error('validated teacher residual identity disagreement');
    }
    if (witnessReport.modelIdentity !== null || witnessReport.splineAdmitted !== false || witnessReport.latticeAdmitted !== false) {
      throw new Error('teacher assay admitted a forbidden model representation');
    }
  } else if (config.assay === 'same-state-analytical-calibration') {
    if (!String(witnessReport.backend || '').startsWith('WebGPU:')) throw new Error(`analytical calibration backend disagreement: ${witnessReport.backend}`);
    if (witnessReport.requestedRoute !== requestedRoute) {
      throw new Error('analytical calibration requested route disagreement');
    }
    assertEffectiveRouteControls(witnessReport.lastTrustworthyEvidence?.route?.effectiveUrl, config.route);
    if (witnessReport.effectiveRoute !== 'boundary-splat-analytical-teacher-calibration-baseline-v0') {
      throw new Error(`effective analytical calibration route disagreement: ${witnessReport.effectiveRoute}`);
    }
    if (witnessReport.simulatorRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error(`analytical calibration simulator route disagreement: ${witnessReport.simulatorRoute || 'missing'}`);
    }
    validateAnalyticalCandidateExport(witnessReport.candidateExport);
    if (witnessReport.baseline?.teacherResidualName !== SAME_STATE_TEACHER_CONTRACT.residualName) {
      throw new Error(`analytical calibration teacher identity disagreement: ${witnessReport.baseline?.teacherResidualName || 'missing'}`);
    }
    if (!['named-analytical-miss', 'candidate-support-miss'].includes(witnessReport.baseline?.status)) {
      throw new Error(`untouched analytical baseline did not expose a named miss: ${witnessReport.baseline?.status || 'missing'}`);
    }
    if (witnessReport.baseline?.parameterCalibrationAdmitted !== false) {
      throw new Error('untouched analytical baseline claimed parameter-calibration authority');
    }
    if (witnessReport.baseline?.status === 'candidate-support-miss'
      && witnessReport.baseline.candidateSupport?.upperCandidateCount !== 0) {
      throw new Error('analytical candidate-support miss did not block parameter calibration');
    }
    if (witnessReport.calibratedParametersApplied !== false
      || witnessReport.analyticalWarpApplied !== true
      || witnessReport.modelIdentity !== null
      || witnessReport.splineAdmitted !== false
      || witnessReport.latticeAdmitted !== false) {
      throw new Error('analytical baseline admitted calibration or a forbidden representation');
    }
  } else {
    if (witnessReport.browser?.headless !== true || witnessReport.browser?.unsafeWebGpuEnabled !== true) {
      throw new Error('timestamp-capable headless WebGPU route was not effective');
    }
    if (witnessReport.effectiveRoute !== 'boundary-splat-analytical-age-height-forcing-warp-v0') {
      throw new Error(`effective response route disagreement: ${witnessReport.effectiveRoute}`);
    }
    if (witnessReport.timing?.rows?.map(row => row.instanceCount).join(',') !== '1,16,100') {
      throw new Error('complete response ladder is missing 1/16/100 rows');
    }
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
      timingAuthority: isSameStateAssay(requestedAssay) ? 'not-requested-teacher-calibration' : 'gpu-timestamp-query',
    },
    effectiveBackend: witnessReport ? {
      browser: witnessReport.browser || null,
      backend: witnessReport.backend || null,
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
    shortestVisibleResidual: report.shortestVisibleResidual || null,
    selectedArtifacts: report.selectedArtifacts || null,
    initialField: report.initialField || report.lastTrustworthyEvidence?.initialField || null,
    lastCompletedHorizon: report.lastTrustworthyEvidence?.lastCompletedHorizon || null,
    baseline: report.baseline || null,
    candidateExport: report.candidateExport || null,
  };
}

function validateConfig(config) {
  if (config?.assay === 'same-state-analytical-calibration') {
    if (config.schema !== 'kaminos.volume.same-state-analytical-teacher-calibration-config.v0') throw new Error(`analytical calibration config schema disagreement: ${config?.schema}`);
    if (!config.teacherInitialField?.fluidSha256 || !config.teacherInitialField?.frontSha256) throw new Error('analytical calibration teacher field identity is missing');
    if (config.teacherResidual?.residualName !== SAME_STATE_TEACHER_CONTRACT.residualName) throw new Error('analytical calibration residual identity disagreement');
    if (!config.route || typeof config.route !== 'object') throw new Error('analytical calibration route controls are missing');
    return;
  }
  if (config?.assay === 'same-state-teacher') {
    if (config.schema !== 'kaminos.volume.same-state-forced-teacher-config.v0') throw new Error(`teacher config schema disagreement: ${config?.schema}`);
    if (!Array.isArray(config.horizons) || config.horizons.length < 1) throw new Error('teacher horizon ladder is missing');
    if (!config.route || typeof config.route !== 'object') throw new Error('teacher route controls are missing');
    return;
  }
  if (config?.schema !== CONFIG_SCHEMA) throw new Error(`config schema disagreement: ${config?.schema}`);
  if (!['analytic', 'learned'].includes(config.renderer)) throw new Error(`unsupported renderer: ${config.renderer}`);
  if (config.costLadderInstances?.join(',') !== '1,16,100') throw new Error('cost ladder must be exactly 1,16,100');
  if (!config.route || typeof config.route !== 'object') throw new Error('route controls are missing');
  if (config.route.volume_boundary_splat_mode !== config.renderer) throw new Error('route renderer disagrees with requested renderer');
}

function isSameStateAssay(assay) {
  return assay === 'same-state-teacher' || assay === 'same-state-analytical-calibration';
}

function validateAnalyticalCandidateExport(candidateExport) {
  if (candidateExport?.authority !== 'debug-full-field-boundary-splat-effective-output-readback-v0') {
    throw new Error(`analytical candidate authority disagreement: ${candidateExport?.authority || 'missing'}`);
  }
  if (candidateExport.sourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0') {
    throw new Error(`analytical candidate source authority disagreement: ${candidateExport.sourceAuthority || 'missing'}`);
  }
  if (candidateExport.rendererIdentity !== 'live-boundary-sidecar-analytic-splats-v0') {
    throw new Error(`analytical candidate renderer identity disagreement: ${candidateExport.rendererIdentity || 'missing'}`);
  }
  const { draw, descriptor } = candidateExport;
  if (draw?.overflowCount !== 0) throw new Error(`analytical candidate overflow disagreement: ${draw?.overflowCount ?? 'missing'}`);
  if (!Number.isInteger(draw.instanceCount) || draw.instanceCount <= 0) throw new Error('analytical candidate instance count is invalid');
  if (!Number.isInteger(draw.candidateCount) || draw.candidateCount <= 0 || draw.candidateCount > draw.instanceCount) {
    throw new Error('analytical candidate draw count is invalid');
  }
  if (descriptor?.kind !== 'boundarySplat'
    || descriptor.dtype !== 'float32'
    || descriptor.floatCount !== draw.instanceCount * 12
    || descriptor.byteLength !== descriptor.floatCount * Float32Array.BYTES_PER_ELEMENT
    || descriptor.shape?.[0] !== draw.instanceCount
    || descriptor.shape?.[1] !== 12) {
    throw new Error('analytical candidate descriptor disagrees with draw receipt');
  }
  if (!/^[0-9a-f]{64}$/.test(candidateExport.sha256 || '')) throw new Error('analytical candidate readback hash is missing');
}

function assertEffectiveRouteControls(effectiveUrl, requestedControls) {
  if (!effectiveUrl) throw new Error('analytical calibration effective URL is missing');
  const effective = new URL(effectiveUrl);
  for (const [key, value] of Object.entries(requestedControls)) {
    if (effective.searchParams.get(key) !== String(value)) {
      throw new Error(`analytical calibration route control disagreement:${key}`);
    }
  }
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
