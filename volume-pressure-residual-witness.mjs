#!/usr/bin/env node

// Pressure residual witness: exercises one saved basin on the real Apple WebGPU
// route, switches the pressure solver arm by arm through the live cockpit
// controls, and records the GPU-measured divergence residual before and after
// projection for each arm. It is numerical evidence about the solve, not a
// visual or basin-quality verdict. It fails loud on software fallback, a stale
// or missing residual, an effective solver that disagrees with the request, or
// a simulation that stops advancing.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const basinFile = resolve(String(args.get('--basin-file') || ''));
const serverUrl = String(args.get('--server-url') || 'http://127.0.0.1:18461');
const expectedRepoRoot = resolve(String(args.get('--expected-repo-root') || '.'));
const expectedCommit = String(args.get('--expected-commit') || '');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-pressure-residual-witness.json'));
const arms = String(args.get('--arms') || 'legacy,converged-open-top,converged').split(',').map(arm => arm.trim()).filter(Boolean);
const sweeps = Number(args.get('--sweeps') || 60);
// Optional shared Projection control value for every arm. In converged mode the
// control is the projection gain, so 1.0 is the full solve; the basin's own
// value (often far below 1) is what the operator currently sees.
const projectionOverride = args.has('--projection') ? Number(args.get('--projection')) : null;
const settleSteps = Number(args.get('--settle-steps') || 200);
const sampleSeconds = Number(args.get('--sample-seconds') || 6);
const timeoutMs = Number(args.get('--timeout-ms') || 240000);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const profilePath = resolve(String(args.get('--profile') || `/tmp/kaminos-pressure-witness-chrome-${debugPort}`));
const runId = randomUUID();

const report = {
  identity: 'kaminos-pressure-residual-witness-v0',
  runId,
  startedAt: new Date().toISOString(),
  status: 'running',
  failurePhase: 'argument-validation',
  failure: null,
  requested: { basinFile, serverUrl, expectedRepoRoot, expectedCommit, arms, sweeps, settleSteps, sampleSeconds, projectionOverride },
  effective: {},
  arms: [],
  browserErrors: [],
  lastTrustworthyEvidence: {},
};

function writeReport() {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function chromeExecutable() {
  for (const candidate of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable was not found');
}

class CdpSocket {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.webSocketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed to open')), { once: true });
      this.socket.addEventListener('close', () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('CDP WebSocket closed'));
        }
        this.pending.clear();
      });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (message.method === 'Runtime.consoleAPICalled') {
            const type = message.params?.type;
            if (type === 'error' || type === 'warning') {
              const text = (message.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
              report.browserErrors.push({ method: message.method, level: type, text: String(text).slice(0, 900), at: new Date().toISOString() });
            }
            return;
          }
          if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') {
            const entry = message.method === 'Log.entryAdded' ? message.params?.entry : message.params?.exceptionDetails;
            const text = entry?.text || entry?.exception?.description || JSON.stringify(entry).slice(0, 400);
            const level = entry?.level || 'exception';
            if (level === 'error' || message.method === 'Runtime.exceptionThrown') {
              report.browserErrors.push({ method: message.method, level, text: String(text).slice(0, 600), at: new Date().toISOString() });
            }
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

let browser = null;
let socket = null;

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function rendererState() {
  const state = await rendererStateRaw();
  if (state) report.lastTrustworthyEvidence[report.failurePhase] = state;
  return state;
}

async function rendererStateRaw() {
  return evaluate(`(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!state) return null;
    const controls = state.controls || {};
    return {
      backend: state.backend || null,
      error: state.error || null,
      simStepCount: state.simStepCount,
      frameCount: state.frameCount,
      gridSize: state.gridSize ?? state.resolution ?? controls.resolution ?? null,
      volumeScene: state.volumeScene,
      pressureSolver: state.pressureSolver || null,
      pressureProjectionEnabled: state.pressureProjectionEnabled,
      pressureProjectionIterations: state.pressureProjectionIterations,
      pressureSourceStrategy: state.pressureSourceStrategy,
      pressureStrategy: state.pressureStrategy,
      fullGridPassBreakdown: state.fullGridPassBreakdown || null,
      controls: {
        resolution: controls.resolution,
        volumeScene: controls.volumeScene,
        projection: controls.projection,
        pressureMode: controls.pressureMode,
        pressureIterations: controls.pressureIterations,
        pressureStrategy: controls.pressureStrategy,
        pressureSolver: controls.pressureSolver,
        pressureSolverIterations: controls.pressureSolverIterations,
        curl: controls.curl,
        microdetail: controls.microdetail,
        transportSpeed: controls.transportSpeed ?? controls.speed,
      },
      domSolver: document.getElementById('volume-pressure-solver')?.value ?? null,
      domSweeps: document.getElementById('volume-pressure-solver-iterations')?.value ?? null,
    };
  })()`);
}

class TerminalError extends Error {}

async function waitUntil(callback, message, intervalMs = 200, limitMs = timeoutMs) {
  const deadline = Date.now() + limitMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      if (error instanceof TerminalError) throw error;
      lastError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function setControl(id, value) {
  return evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    if (!element) throw new Error('control missing: ' + ${JSON.stringify(id)});
    element.value = ${JSON.stringify(String(value))};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value;
  })()`);
}

function expectedArm(arm) {
  if (arm === 'legacy') return { solver: 'legacy', openTop: false };
  if (arm === 'converged') return { solver: 'converged', openTop: false };
  if (arm === 'converged-open-top') return { solver: 'converged', openTop: true };
  throw new Error(`unknown arm ${arm}`);
}

async function main() {
  if (!existsSync(basinFile)) throw new Error(`basin file missing: ${basinFile}`);
  const basinArtifact = JSON.parse(readFileSync(basinFile, 'utf8'));
  const preset = basinArtifact.preset || basinArtifact;
  const storedRoute = new URL(preset.route);
  const server = new URL(serverUrl);
  const url = new URL(storedRoute.pathname + storedRoute.search, server);
  url.searchParams.delete('volume_quality_reason');
  url.searchParams.set('volume_pressure_solver', 'legacy');
  url.searchParams.set('volume_pressure_solver_iterations', String(sweeps));
  report.effective.basin = {
    presetId: basinArtifact.presetId || null,
    contentHash: basinArtifact.contentHash || null,
    initialLabel: basinArtifact.initialLabel || null,
    savedAt: preset.savedAt || null,
    controlCount: basinArtifact.controlCount ?? preset.controlCount ?? null,
    savedFromSource: basinArtifact.source || null,
    storedRouteOrigin: storedRoute.origin,
  };
  report.effective.url = url.toString();
  report.effective.arms = arms.map(expectedArm);

  report.failurePhase = 'runtime-config';
  const runtimeResponse = await fetch(new URL('/api/runtime-config', server));
  if (!runtimeResponse.ok) throw new Error(`runtime config request failed: ${runtimeResponse.status}`);
  const runtimeConfig = await runtimeResponse.json();
  report.effective.server = runtimeConfig.source || null;
  if (resolve(runtimeConfig.source?.repoRoot || '') !== expectedRepoRoot) {
    throw new Error(`effective server repo root mismatch: ${runtimeConfig.source?.repoRoot} != ${expectedRepoRoot}`);
  }
  if (expectedCommit && runtimeConfig.source?.commit !== expectedCommit) {
    throw new Error(`effective server commit mismatch: ${runtimeConfig.source?.commit} != ${expectedCommit}`);
  }
  if (runtimeConfig.source?.dirty) {
    report.effective.serverDirty = true;
  }

  report.failurePhase = 'browser-launch';
  rmSync(profilePath, { recursive: true, force: true });
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    `--window-size=${String(args.get('--window-size') || '1280,800')}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  // Drain Chrome's pipes: headless Chrome logs continuously, and an undrained
  // pipe blocks the browser process, which then stops answering CDP.
  const chromeLog = [];
  report.effective.chromeLog = chromeLog;
  for (const stream of [browser.stdout, browser.stderr]) {
    stream.on('data', chunk => {
      const text = String(chunk);
      if (chromeLog.length < 40 && /DevTools listening|WebGPU|dawn|Dawn|GPU process|FATAL|fatal/i.test(text)) {
        chromeLog.push(text.slice(0, 300));
      }
    });
  }
  const page = await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    const pages = await response.json();
    return pages.find(candidate => candidate.type === 'page');
  }, 'Chrome page did not register');
  socket = new CdpSocket(page.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Page.navigate', { url: url.toString() });

  report.failurePhase = 'renderer-admission';
  const admitted = await waitUntil(async () => {
    const state = await rendererState();
    if (!state) return null;
    report.lastTrustworthyEvidence.admissionProbe = state;
    if (state.backend === 'unavailable' || state.error) {
      throw new TerminalError(`renderer failed to activate: ${state.error || state.backend}`);
    }
    if (!/^WebGPU:/.test(String(state.backend || ''))) return null;
    if (!(state.simStepCount > 0)) return null;
    return state;
  }, 'WebGPU renderer did not admit');
  if (state_backendIsFallback(admitted.backend)) {
    throw new Error(`software or shared fallback backend is not admissible evidence: ${admitted.backend}`);
  }
  report.effective.backend = admitted.backend;
  report.effective.gridSize = admitted.gridSize;
  report.effective.volumeScene = admitted.volumeScene;
  report.effective.initialControls = admitted.controls;
  const basinResolution = Number(preset.domControls?.['volume-resolution']?.value);
  if (Number.isFinite(basinResolution) && Number(admitted.controls.resolution) !== basinResolution) {
    throw new Error(`basin resolution ${basinResolution} was not applied: effective ${admitted.controls.resolution}`);
  }

  if (projectionOverride !== null) {
    report.failurePhase = 'projection-override';
    await setControl('volume-projection', projectionOverride);
    const applied = await waitUntil(async () => {
      const state = await rendererState();
      return Math.abs(Number(state.controls.projection) - projectionOverride) < 1e-6 ? state : null;
    }, `projection override ${projectionOverride} was not applied`, 200, 20000);
    report.effective.projectionOverride = applied.controls.projection;
  }

  for (const arm of arms) {
    const expected = expectedArm(arm);
    report.failurePhase = `arm-${arm}-switch`;
    const before = await rendererState();
    await setControl('volume-pressure-solver-iterations', sweeps);
    await setControl('volume-pressure-solver', arm);
    const switched = await waitUntil(async () => {
      const state = await rendererState();
      if (state?.error) throw new TerminalError(`renderer error after switching to ${arm}: ${state.error}`);
      const effective = state?.pressureSolver?.effective;
      if (!effective) return null;
      if (effective.solver !== expected.solver || Boolean(effective.openTop) !== expected.openTop) return null;
      if (state.pressureSolver.requested?.solver !== arm) return null;
      if (expected.solver === 'converged' && Number(effective.iterations) !== sweeps) return null;
      return state;
    }, `solver ${arm} did not become effective`, 200, 20000);
    const switchStep = switched.simStepCount;
    const switchedAt = Date.now();

    report.failurePhase = `arm-${arm}-settle`;
    await waitUntil(async () => {
      const state = await rendererState();
      if (state.pressureSolver?.residualError) throw new Error(`residual probe error: ${state.pressureSolver.residualError}`);
      return state.simStepCount >= switchStep + settleSteps ? state : null;
    }, `simulation did not advance ${settleSteps} steps after switching to ${arm}`);

    report.failurePhase = `arm-${arm}-sample`;
    const sampleStart = await rendererState();
    const sampleStartedAt = Date.now();
    await new Promise(resolveWait => setTimeout(resolveWait, sampleSeconds * 1000));
    const sampled = await waitUntil(async () => {
      const state = await rendererState();
      if (state.pressureSolver?.residualError) throw new Error(`residual probe error: ${state.pressureSolver.residualError}`);
      const residual = state.pressureSolver?.residual;
      if (!residual) return null;
      if (!(residual.step >= switchStep + settleSteps)) return null;
      if (residual.solver?.solver !== expected.solver || Boolean(residual.solver?.openTop) !== expected.openTop) return null;
      if (!/^WebGPU:/.test(String(state.backend || ''))) throw new Error(`backend changed mid-run: ${state.backend}`);
      return state;
    }, `no fresh residual for ${arm}`, 200, 30000);
    const sampleEndedAt = Date.now();
    if (!(sampled.simStepCount > sampleStart.simStepCount)) {
      throw new Error(`simulation stalled during ${arm} sample: ${sampleStart.simStepCount} -> ${sampled.simStepCount}`);
    }
    const history = (sampled.pressureSolver.residualHistory || []).filter(entry => entry.step > switchStep + settleSteps);
    const finite = value => Number.isFinite(value);
    const residual = sampled.pressureSolver.residual;
    for (const [operatorName, operator] of Object.entries({ compact: residual.compact, wide: residual.wide })) {
      if (!operator || !finite(operator.before?.meanAbs) || !finite(operator.after?.meanAbs) || !finite(operator.before?.maxAbs) || !finite(operator.after?.maxAbs)) {
        throw new Error(`residual ${operatorName} operator is missing or non-finite for ${arm}`);
      }
    }
    const summarize = key => {
      const values = history.map(entry => entry[key]);
      const meanOf = selector => values.length ? values.reduce((sum, value) => sum + selector(value), 0) / values.length : null;
      return {
        samples: values.length,
        beforeMeanAbs: meanOf(value => value.before.meanAbs),
        afterMeanAbs: meanOf(value => value.after.meanAbs),
        beforeMaxAbs: meanOf(value => value.before.maxAbs),
        afterMaxAbs: meanOf(value => value.after.maxAbs),
        meanReduction: values.length ? meanOf(value => value.before.meanAbs) / Math.max(1e-30, meanOf(value => value.after.meanAbs)) : null,
      };
    };
    report.arms.push({
      arm,
      expected,
      requested: sampled.pressureSolver.requested,
      effective: sampled.pressureSolver.effective,
      uniform: sampled.pressureSolver.uniform,
      pressureSourceStrategy: sampled.pressureSourceStrategy,
      pressureProjectionEnabled: sampled.pressureProjectionEnabled,
      pressureProjectionIterations: sampled.pressureProjectionIterations,
      legacyPressureMode: sampled.controls.pressureMode,
      legacyPressureIterations: sampled.controls.pressureIterations,
      projectionControl: sampled.controls.projection,
      fullGridPassBreakdown: sampled.fullGridPassBreakdown,
      switchStep,
      stepsFromSwitchToSample: sampled.simStepCount - switchStep,
      simStepsPerSecond: (sampled.simStepCount - sampleStart.simStepCount) / ((sampleEndedAt - sampleStartedAt) / 1000),
      framesPerSecond: (sampled.frameCount - sampleStart.frameCount) / ((sampleEndedAt - sampleStartedAt) / 1000),
      wallMsSinceSwitch: sampleEndedAt - switchedAt,
      latestResidual: residual,
      settledSummary: { compact: summarize('compact'), wide: summarize('wide') },
      residualHistorySinceSettle: history,
      stateBeforeSwitch: { simStepCount: before?.simStepCount ?? null, solver: before?.pressureSolver?.effective ?? null },
    });
    report.lastTrustworthyEvidence.lastArm = arm;
    writeReport();
  }

  report.failurePhase = 'complete';
  report.status = 'ok';
}

function state_backendIsFallback(backend) {
  const value = String(backend || '').toLowerCase();
  return !value.startsWith('webgpu:') || value.includes('software') || value.includes('swiftshader');
}

main().then(() => {
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.log(JSON.stringify({ status: report.status, report: reportPath, arms: report.arms.map(arm => ({ arm: arm.arm, compact: arm.settledSummary.compact, wide: arm.settledSummary.wide, simStepsPerSecond: arm.simStepsPerSecond })) }, null, 2));
}).catch(error => {
  report.status = 'failed';
  report.failure = String(error?.stack || error?.message || error);
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.error(JSON.stringify({ status: 'failed', failurePhase: report.failurePhase, failure: String(error?.message || error), report: reportPath }, null, 2));
  process.exitCode = 1;
}).finally(() => {
  socket?.close();
  if (browser) browser.kill('SIGKILL');
  setTimeout(() => process.exit(process.exitCode || 0), 500);
});
