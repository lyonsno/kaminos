#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
} from './structural-material-3d-resident-solver.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE } from './structural-material-3d-webgpu-hot-sidecar.js';

const PRODUCT_SCHEMA = 'kaminos.structural-material.webgpu-hot-sidecar-browser-witness.v0';
const WRAPPER_SCHEMA = 'kaminos.structural-material.resident-solver-greenroom-wrapper.v0';
const worktree = dirname(fileURLToPath(import.meta.url));
const artifactTag = process.env.RESIDENT_SOLVER_ARTIFACT_TAG || 'resident-solver-greenroom-r4';
const artifacts = resolve(worktree, 'artifacts/structural-material-3d', artifactTag);
const greenroomOutput = resolve(
  process.env.RESIDENT_SOLVER_GREENROOM_OUTPUT ||
    `${process.env.HOME}/.local/state/gpu-greenroom/outputs/${artifactTag}`,
);
const profile = resolve(
  process.env.RESIDENT_SOLVER_CHROME_PROFILE || `/private/tmp/kaminos-${artifactTag}-chrome-profile`,
);
const url = process.env.RESIDENT_SOLVER_URL || 'http://127.0.0.1:8395/structural-material-3d.html';
const debugPort = Number(process.env.RESIDENT_SOLVER_DEBUG_PORT || 19496);
const witnessPath = resolve(worktree, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs');
const reportPath = resolve(artifacts, 'report.json');
const screenshotPath = resolve(artifacts, 'resident-solver.png');
const wrapperReportPath = resolve(artifacts, 'greenroom-wrapper-report.json');

const wrapperReport = {
  schema: WRAPPER_SCHEMA,
  status: 'failed',
  failurePhase: 'initialization',
  requestedUrl: url,
  effectiveUrl: null,
  requestedWitness: witnessPath,
  effectiveWitness: null,
  requestedProductSchema: PRODUCT_SCHEMA,
  effectiveProductSchema: null,
  requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectivePageRoute: null,
  requestedExecutionRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
  effectiveExecutionRoute: null,
  requestedSolverRoute: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
  effectiveSolverRoute: null,
  requestedSolverAuthority: STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
  effectiveSolverAuthority: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
  artifactTag,
  artifacts,
  greenroomOutput,
  screenshotEvidence: null,
  failedChecks: [],
  chromeProfile: profile,
  debugPort,
  witnessExitCode: null,
  error: null,
};

mkdirSync(artifacts, { recursive: true });
mkdirSync(greenroomOutput, { recursive: true });

if (!Number.isInteger(debugPort) || debugPort <= 0 || debugPort > 65535) {
  wrapperReport.failurePhase = 'configuration';
  wrapperReport.error = `invalid RESIDENT_SOLVER_DEBUG_PORT ${process.env.RESIDENT_SOLVER_DEBUG_PORT}`;
  writeFileSync(wrapperReportPath, `${JSON.stringify(wrapperReport, null, 2)}\n`);
  process.exit(2);
}

rmSync(profile, { recursive: true, force: true });

function profilePids() {
  const lines = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  return lines.flatMap(line => {
    if (!line.includes(`--user-data-dir=${profile}`)) return [];
    const pid = Number(line.trim().split(/\s+/, 1)[0]);
    return Number.isInteger(pid) ? [pid] : [];
  });
}

async function waitForCdp() {
  const deadline = Date.now() + 30000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Chrome CDP did not open on ${debugPort}: ${lastError?.message || 'timeout'}`);
}

function verifyProductReport(productReport) {
  const effectiveSolver = productReport.isolatedSequence?.first?.solver;
  const checks = {
    productSchema: productReport.schema === PRODUCT_SCHEMA,
    productStatus: productReport.status === 'passed' && productReport.failurePhase === null,
    pageRoute: productReport.requestedPageRoute === STRUCTURAL_MATERIAL_3D_ROUTE &&
      productReport.effectivePageRoute === STRUCTURAL_MATERIAL_3D_ROUTE,
    executionRoute: productReport.requestedRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE &&
      productReport.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_HOT_SIDECAR_ROUTE,
    solverRoute: productReport.requestedSolverRoute === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE &&
      productReport.effectiveSolverRoute === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE &&
      effectiveSolver?.route === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_ROUTE,
    solverAuthority: effectiveSolver?.authority === STRUCTURAL_MATERIAL_3D_RESIDENT_SOLVER_AUTHORITY,
    backend: productReport.requestedBackend === 'webgpu' && productReport.effectiveBackend === 'webgpu',
    noCpuFallback: productReport.cpuFallbackUsed === false,
    productChecks: productReport.checks && Object.keys(productReport.checks).length > 0 &&
      Object.values(productReport.checks).every(Boolean),
    noRuntimeErrors: Array.isArray(productReport.runtimeErrors) && productReport.runtimeErrors.length === 0,
  };
  const byteLength = statSync(screenshotPath).size;
  const screenshotEvidence = {
    path: screenshotPath,
    byteLength,
    reportedPath: productReport.effectiveConfig?.screenshotPath || null,
    ok: productReport.effectiveConfig?.screenshotPath === screenshotPath && byteLength > 2000,
  };
  checks.screenshotArtifact = screenshotEvidence.ok;
  return {
    checks,
    screenshotEvidence,
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
  };
}

try {
  wrapperReport.failurePhase = 'chrome-launch';
  const launch = spawnSync('/usr/bin/open', [
    '-na',
    'Google Chrome',
    '--args',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1280,820',
    'about:blank',
  ], { encoding: 'utf8' });
  if (launch.status !== 0) throw new Error(launch.stderr || `open exited ${launch.status}`);
  const cdp = await waitForCdp();
  wrapperReport.chrome = {
    browser: cdp.Browser || null,
    protocolVersion: cdp['Protocol-Version'] || null,
    webSocketDebuggerUrl: cdp.webSocketDebuggerUrl || null,
  };

  wrapperReport.failurePhase = 'route-identity';
  const pageResponse = await fetch(url, { cache: 'no-store' });
  const pageBody = await pageResponse.text();
  if (!pageResponse.ok || !pageBody.includes('Kaminos Layered Structural Sidecar')) {
    throw new Error(`served route identity mismatch: HTTP ${pageResponse.status}`);
  }
  wrapperReport.effectiveUrl = pageResponse.url;

  wrapperReport.failurePhase = 'browser-witness';
  const witness = spawnSync('/opt/homebrew/Cellar/node/25.9.0_2/bin/node', [
    witnessPath,
    '--url', url,
    '--out', reportPath,
    '--screenshot', screenshotPath,
    '--debug-port', String(debugPort),
    '--width', '1280',
    '--height', '820',
  ], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  wrapperReport.witnessExitCode = witness.status;
  wrapperReport.witnessStdoutCapture = 'report-file-authoritative';
  wrapperReport.witnessStderr = witness.stderr;
  if (witness.status !== 0) throw new Error(`browser witness exited ${witness.status}`);

  const productReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  const effectiveSolver = productReport.isolatedSequence?.first?.solver;
  wrapperReport.effectiveWitness = witnessPath;
  wrapperReport.effectiveProductSchema = productReport.schema || null;
  wrapperReport.effectivePageRoute = productReport.effectivePageRoute || null;
  wrapperReport.effectiveExecutionRoute = productReport.effectiveRoute || null;
  wrapperReport.effectiveSolverRoute = effectiveSolver?.route || null;
  wrapperReport.effectiveSolverAuthority = effectiveSolver?.authority || null;
  wrapperReport.effectiveBackend = productReport.effectiveBackend || null;
  wrapperReport.cpuFallbackUsed = productReport.cpuFallbackUsed ?? null;
  const verification = verifyProductReport(productReport);
  wrapperReport.productChecks = verification.checks;
  wrapperReport.screenshotEvidence = verification.screenshotEvidence;
  wrapperReport.failedChecks = verification.failedChecks;
  if (verification.failedChecks.length > 0) {
    throw new Error(`product identity/evidence checks failed: ${verification.failedChecks.join(', ')}`);
  }
  wrapperReport.status = 'passed';
  wrapperReport.failurePhase = null;
} catch (error) {
  wrapperReport.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  wrapperReport.chromeProfilePids = profilePids();
  writeFileSync(wrapperReportPath, `${JSON.stringify(wrapperReport, null, 2)}\n`);
  writeFileSync(resolve(greenroomOutput, 'greenroom-wrapper-report.json'), `${JSON.stringify(wrapperReport, null, 2)}\n`);
  for (const pid of wrapperReport.chromeProfilePids.toReversed()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The dedicated profile process may have exited after the snapshot.
    }
  }
}
