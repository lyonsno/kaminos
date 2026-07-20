#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
  createFingerFluidWaterfallOracleConfig,
  createFingerFluidWaterfallOracleEvidenceIdentity,
  evaluateFingerFluidPulseDrainageSeries,
  evaluateFingerFluidUnsupportedSheetOraclePair,
  evaluateFingerFluidWaterfallOraclePair,
} from './finger-fluid-webgpu-core.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const baseUrl = new URL(args.get('--url') || 'http://127.0.0.1:8100/index.html?kaminos_finger_fluid_bench=1');
const targetStep = Math.max(1, Math.floor(Number(args.get('--target-step') || 480)));
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-finger-fluid-waterfall-oracle');
const reportPath = resolve(args.get('--report') || `${outDir}/pair-report.json`);
const debugPort = Number(args.get('--debug-port') || 9590);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const deviceScaleFactor = Number(args.get('--device-scale-factor') || 1);
const rendererMode = args.get('--renderer') || 'sphere_debug';
const colorMode = args.get('--color-mode') || 'phase';
const opticalDebugMode = args.get('--optical-debug') || 'shaded';
const densityIterations = Math.max(1, Math.floor(Number(args.get('--density-iterations') || 3)));
const capillaryStrength = Number(args.get('--capillary-strength') || 0.72);
const supportFriction = Number(args.get('--support-friction') || 1.6);
const freeFlightViscosityBoost = Number(args.get('--free-flight-viscosity-boost') || 0.17);
const thinSheetVorticityAttenuation = Number(args.get('--thin-sheet-vorticity-attenuation') || 0.88);
const unsupportedSheetStrength = Number(args.get('--unsupported-sheet-strength') || 0);
const inletCutoffStep = Number(args.get('--cutoff-step') || 480);
const captureSteps = String(args.get('--capture-steps') || '480,510,540,600,720,960')
  .split(',')
  .map(value => Number(value.trim()));
const comparisonAxis = args.get('--comparison-axis') || 'resolution';
if (!['resolution', 'unsupported_sheet', 'pulse_drainage'].includes(comparisonAxis)) {
  throw new RangeError(`Unsupported waterfall oracle comparison axis: ${comparisonAxis}`);
}
if (comparisonAxis === 'unsupported_sheet' && !(unsupportedSheetStrength > 0)) {
  throw new RangeError('Unsupported-sheet comparison requires --unsupported-sheet-strength greater than zero');
}
if (comparisonAxis === 'pulse_drainage' && (
  !Number.isSafeInteger(inletCutoffStep)
  || inletCutoffStep < 1
  || captureSteps.length < 2
  || captureSteps[0] !== inletCutoffStep
  || captureSteps.some((step, index) => !Number.isSafeInteger(step) || step < 1 || (index > 0 && step <= captureSteps[index - 1]))
  || unsupportedSheetStrength !== 2
)) {
  throw new RangeError('Pulse drainage requires --unsupported-sheet-strength 2 and increasing --capture-steps beginning at --cutoff-step');
}

let phase = 'initializing';
let baselineRun = null;
let highRun = null;
let pair = null;
let pulseSeries = null;
let timeSliceRuns = [];
let lastTrustworthyEvidence = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: comparisonAxis === 'pulse_drainage'
      ? 'kaminos.finger-fluid.pulse-drainage-witness.v0'
      : 'kaminos.finger-fluid.waterfall-resolution-oracle-witness.v0',
    status: pulseSeries?.status || pair?.status || 'failed_before_primary_capture',
    failurePhase: phase,
    requestedBaseUrl: baseUrl.href,
    targetStep,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
    rendererMode,
    colorMode,
    opticalDebugMode,
    densityIterations,
    unsupportedSheetStrength,
    inletCutoffStep: comparisonAxis === 'pulse_drainage' ? inletCutoffStep : null,
    captureSteps: comparisonAxis === 'pulse_drainage' ? captureSteps : null,
    comparisonAxis,
    baselineRun,
    highRun,
    pair,
    pulseSeries,
    sourceRecirculationCountStableAfterCutoff: pulseSeries?.sourceActivationCountStableAfterCutoff ?? null,
    timeSliceRuns,
    lastTrustworthyEvidence,
    visualContinuityAccepted: null,
    ...extra,
  }, null, 2));
}

function buildUrl(
  preset,
  sheetStrength = unsupportedSheetStrength,
  captureStep = targetStep,
  cutoffStep = null,
) {
  const config = createFingerFluidWaterfallOracleConfig(preset);
  const url = new URL(baseUrl.href);
  url.searchParams.set('kaminos_finger_fluid_bench', '1');
  url.searchParams.set('finger_fluid_truth_scene', 'waterfall_resolution_oracle');
  url.searchParams.set('finger_fluid_oracle_resolution', preset);
  url.searchParams.set('finger_fluid_particle_count', String(config.defaultParticleCount));
  url.searchParams.set('finger_fluid_renderer', rendererMode);
  url.searchParams.set('finger_fluid_color_mode', colorMode);
  url.searchParams.set('finger_fluid_optical_debug', opticalDebugMode);
  url.searchParams.set('finger_fluid_density_iterations', String(densityIterations));
  url.searchParams.set('finger_fluid_capillary_strength', String(capillaryStrength));
  url.searchParams.set('finger_fluid_support_friction', String(supportFriction));
  url.searchParams.set('finger_fluid_free_flight_viscosity_boost', String(freeFlightViscosityBoost));
  url.searchParams.set('finger_fluid_thin_sheet_vorticity_attenuation', String(thinSheetVorticityAttenuation));
  url.searchParams.set('finger_fluid_unsupported_sheet_strength', String(sheetStrength));
  url.searchParams.set('finger_fluid_oracle_fixed_camera', '1');
  url.searchParams.set('finger_fluid_witness_target_step', String(captureStep));
  if (cutoffStep !== null) url.searchParams.set('finger_fluid_inlet_cutoff_step', String(cutoffStep));
  return url;
}

function pngArtifact(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`primary output is not a complete PNG: ${path}`);
  }
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function waitForCdp(port) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
      lastError = new Error(`CDP version returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(125);
  }
  throw new Error(`Chrome DevTools endpoint did not open: ${lastError?.message || 'unknown failure'}`);
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response.ok) {
      const pages = await response.json();
      const page = pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
        || pages.find(candidate => candidate.type === 'page');
      if (page) return page;
    }
    await delay(125);
  }
  throw new Error('Chrome page target did not appear');
}

function collectRuntimeEvents(ws, events) {
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled') {
      events.push({
        method: message.method,
        type: message.params.type,
        text: (message.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      events.push({
        method: message.method,
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception',
      });
    }
  });
}

function oracleDebugExpression() {
  return `(() => {
    const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
    return {
      href: window.location.href,
      readyState: document.readyState,
      debug: typeof read === 'function' ? read() : null,
      camera: typeof window.kaminosFingerFluidCompositionCameraState === 'function'
        ? window.kaminosFingerFluidCompositionCameraState()
        : null,
    };
  })()`;
}

function validateEffectiveIdentity({
  preset,
  config,
  pageState,
  capturedStep,
  targetCaptureStep,
  unsupportedSheetStrength,
  cutoffStep,
}) {
  const debug = pageState?.debug;
  const route = debug?.config;
  const runtime = debug?.runtime;
  const effective = runtime?.waterfallResolutionOracle;
  const camera = pageState?.camera;
  const cameraIdentity = camera ? {
    yaw: camera.yaw,
    pitch: camera.pitch,
    distance: camera.distance,
    target: camera.target,
  } : null;
  if (debug?.schema !== 'kaminos.finger-fluid-bench.state.v0'
    || debug.status !== 'running'
    || runtime?.available !== true
    || runtime.solver_backend !== 'webgpu_compute'
    || runtime.render_backend !== 'webgpu_direct_render'
    || route?.requestedTruthScene !== 'waterfall_resolution_oracle'
    || route?.effectiveTruthScene !== 'waterfall_resolution_oracle'
    || route?.requestedWaterfallOraclePreset !== preset
    || route?.effectiveWaterfallOraclePreset !== preset
    || route?.requestedParticleCount !== config.defaultParticleCount
    || route?.effectiveParticleCount !== config.defaultParticleCount
    || route?.requestedRendererMode !== rendererMode
    || route?.effectiveRendererMode !== rendererMode
    || effective?.contract !== config.contract
    || effective.requestedPreset !== preset
    || effective.effectivePreset !== preset
    || effective.requestedEqualsEffective !== true
    || runtime.particleCount !== config.defaultParticleCount
    || runtime.kernelRadius !== config.kernelRadius
    || runtime.visibleParticleRadius !== config.visibleParticleRadius
    || runtime.densityIterationsPerStep !== densityIterations
    || route?.requestedUnsupportedSheetStrength !== unsupportedSheetStrength
    || route?.effectiveUnsupportedSheetStrength !== unsupportedSheetStrength
    || runtime.unsupportedSheetStrength !== unsupportedSheetStrength
    || route?.requestedInletCutoffStep !== cutoffStep
    || route?.effectiveInletCutoffStep !== cutoffStep
    || runtime.inletCutoffStep !== cutoffStep
    || capturedStep < targetCaptureStep
    || capturedStep > targetCaptureStep + 8
    || JSON.stringify(cameraIdentity) !== JSON.stringify(config.camera)) {
    throw new Error(`${preset} requested/effective oracle identity mismatch: ${JSON.stringify({
      debugSchema: debug?.schema,
      status: debug?.status,
      route,
      runtime: runtime ? {
        available: runtime.available,
        solver_backend: runtime.solver_backend,
        render_backend: runtime.render_backend,
        particleCount: runtime.particleCount,
        kernelRadius: runtime.kernelRadius,
        visibleParticleRadius: runtime.visibleParticleRadius,
        unsupportedSheetStrength: runtime.unsupportedSheetStrength,
        waterfallResolutionOracle: effective,
      } : null,
      capturedStep,
      cameraIdentity,
      expectedCamera: config.camera,
    })}`);
  }
  return {
    requestedUrl: buildUrl(preset, unsupportedSheetStrength, targetCaptureStep, cutoffStep).href,
    effectiveUrl: pageState.href,
    truthScene: runtime.truthScene,
    requestedPreset: route.requestedWaterfallOraclePreset,
    effectivePreset: route.effectiveWaterfallOraclePreset,
    requestedParticleCount: route.requestedParticleCount,
    effectiveParticleCount: route.effectiveParticleCount,
    solverBackend: runtime.solver_backend,
    renderBackend: runtime.render_backend,
    requestedRendererMode: route.requestedRendererMode,
    effectiveRendererMode: route.effectiveRendererMode,
    requestedColorMode: route.requestedColorMode,
    effectiveColorMode: route.effectiveColorMode,
    requestedOpticalDebugMode: route.requestedOpticalDebugMode,
    effectiveOpticalDebugMode: route.effectiveOpticalDebugMode,
    capturedStep,
    camera: cameraIdentity,
    unsupportedSheetStrength,
    inletCutoffStep: runtime.inletCutoffStep,
  };
}

async function runPreset(preset, port, {
  label = preset,
  sheetStrength = unsupportedSheetStrength,
  captureStep = targetStep,
  cutoffStep = null,
} = {}) {
  const config = createFingerFluidWaterfallOracleConfig(preset);
  const output = resolve(`${outDir}/${label}.png`);
  const runReportPath = resolve(`${outDir}/${label}.json`);
  const requestedUrl = buildUrl(preset, sheetStrength, captureStep, cutoffStep);
  const userDataDir = `/tmp/kaminos-finger-fluid-waterfall-oracle-${label}-${port}-${process.pid}`;
  const consoleEvents = [];
  let runPhase = 'launch_chrome';
  let browserVersion = null;
  let stderr = '';
  let capturedStep = null;
  let pageState = null;
  let effectiveRouteIdentity = null;
  let primaryOutputWritten = false;
  mkdirSync(outDir, { recursive: true });
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const writeRunReport = (extra = {}) => {
    writeFileSync(runReportPath, JSON.stringify({
      schema: 'kaminos.finger-fluid.waterfall-resolution-oracle-run.v0',
      preset,
      label,
      sheetStrength,
      requestedUrl: requestedUrl.href,
      effectiveRouteIdentity,
      phase: runPhase,
      targetStep: captureStep,
      capturedStep,
      browserVersion,
      consoleEvents,
      pageState,
      primaryOutputWritten,
      output: primaryOutputWritten ? output : null,
      stderrTail: stderr.slice(-2000),
      ...extra,
    }, null, 2));
  };

  try {
    runPhase = 'connect_cdp';
    browserVersion = await waitForCdp(port);
    const page = await waitForPage(port);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    collectRuntimeEvents(ws, consoleEvents);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor,
      mobile: false,
    });

    runPhase = 'navigate';
    await wsRequest(ws, 'Page.navigate', { url: requestedUrl.href });

    runPhase = 'wait_authoritative_route';
    const routeDeadline = Date.now() + 30_000;
    while (Date.now() < routeDeadline) {
      pageState = await evaluate(ws, oracleDebugExpression());
      lastTrustworthyEvidence = { preset, runPhase, pageState };
      if (pageState?.debug?.schema === 'kaminos.finger-fluid-bench.state.v0'
        && pageState.debug.status !== 'loading') break;
      await delay(100);
    }
    if (pageState?.debug?.schema !== 'kaminos.finger-fluid-bench.state.v0') {
      throw new Error(`oracle route did not expose the authoritative debug hook: ${JSON.stringify(pageState)}`);
    }
    if (pageState.debug.status === 'error' || pageState.debug.runtime?.available === false) {
      throw new Error(`oracle route rejected before primary output: ${JSON.stringify(pageState.debug)}`);
    }

    runPhase = 'advance_to_target_step';
    let lastProgressStep = -1;
    let lastProgressAt = Date.now();
    while (capturedStep === null) {
      pageState = await evaluate(ws, oracleDebugExpression());
      const stepCount = pageState?.debug?.runtime?.stepCount;
      lastTrustworthyEvidence = { preset, runPhase, stepCount, pageState };
      if (pageState?.debug?.status === 'error' || pageState?.debug?.runtime?.available === false) {
        throw new Error(`oracle route failed before target step: ${JSON.stringify(pageState?.debug)}`);
      }
      if (Number.isSafeInteger(stepCount) && stepCount > lastProgressStep) {
        lastProgressStep = stepCount;
        lastProgressAt = Date.now();
      }
      if (Number.isSafeInteger(stepCount) && stepCount >= captureStep) {
        const pauseReceipt = await evaluate(ws, `(() => {
          const pause = window.kaminosFingerFluidBenchSetSimulationPausedForWitness;
          if (typeof pause !== 'function') throw new Error('missing exact-step finger fluid pause hook');
          return pause(true);
        })()`);
        capturedStep = pauseReceipt?.stepCount;
        break;
      }
      if (Date.now() - lastProgressAt > 120_000) {
        throw new Error(`oracle simulation made no step progress for 120 seconds at step ${lastProgressStep}`);
      }
      await delay(20);
    }

    runPhase = 'capture_sheet_classifier_diagnostics';
    const diagnosticsReceipt = await evaluate(ws, `(async () => {
      const request = window.kaminosFingerFluidBenchRequestDiagnostics;
      if (typeof request !== 'function') throw new Error('missing finger fluid diagnostics hook');
      return request();
    })()`);
    pageState = await evaluate(ws, oracleDebugExpression());
    const sheetDiagnostics = pageState?.debug?.runtime?.diagnostics;
    if (diagnosticsReceipt?.diagnosticsStepCount !== capturedStep
      || sheetDiagnostics?.stepCount !== capturedStep
      || !Number.isSafeInteger(sheetDiagnostics?.unsupportedSheetActiveParticleCount)
      || !Number.isFinite(sheetDiagnostics?.averageUnsupportedSheetActivity)
      || !Number.isFinite(sheetDiagnostics?.maximumUnsupportedSheetActivity)) {
      throw new Error(`unsupported-sheet diagnostics missing or stale at capture: ${JSON.stringify({ capturedStep, diagnosticsReceipt, sheetDiagnostics })}`);
    }
    if (cutoffStep !== null && (
      sheetDiagnostics?.inletCutoffStep !== cutoffStep
      || sheetDiagnostics?.inletCutoffReached !== true
      || !Number.isSafeInteger(sheetDiagnostics?.sourceRecirculationCount)
      || !Number.isSafeInteger(sheetDiagnostics?.activeParticleCount)
      || !Number.isSafeInteger(sheetDiagnostics?.dormantParticleCount)
    )) {
      throw new Error(`pulse drainage diagnostics missing or stale at capture: ${JSON.stringify({ capturedStep, cutoffStep, sheetDiagnostics })}`);
    }

    runPhase = 'validate_effective_route';
    pageState = await evaluate(ws, oracleDebugExpression());
    effectiveRouteIdentity = validateEffectiveIdentity({
      preset,
      config,
      pageState,
      capturedStep,
      targetCaptureStep: captureStep,
      unsupportedSheetStrength: sheetStrength,
      cutoffStep,
    });
    lastTrustworthyEvidence = { preset, runPhase, effectiveRouteIdentity, pageState };

    runPhase = 'capture_primary_output';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    const artifact = pngArtifact(output);
    primaryOutputWritten = true;

    const runtime = pageState.debug.runtime;
    const effective = runtime.waterfallResolutionOracle;
    const identity = createFingerFluidWaterfallOracleEvidenceIdentity({
      ...config,
      truthScene: runtime.truthScene,
      requestedPreset: effective.requestedPreset,
      effectivePreset: effective.effectivePreset,
      particleCount: runtime.particleCount,
      rendererMode: pageState.debug.config.effectiveRendererMode,
      colorMode: pageState.debug.config.effectiveColorMode,
      opticalDebugMode: pageState.debug.config.effectiveOpticalDebugMode,
      fixedTimeStepSeconds: KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
      capturedStep,
      densityIterations: runtime.densityIterationsPerStep,
      capillaryStrength: runtime.capillaryStrength,
      supportFriction: runtime.supportFriction,
      freeFlightViscosityBoost: runtime.freeFlightViscosityBoost,
      thinSheetVorticityAttenuation: runtime.thinSheetVorticityAttenuation,
      unsupportedSheetStrength: runtime.unsupportedSheetStrength,
      inletCutoffStep: runtime.inletCutoffStep,
      camera: config.camera,
    });
    runPhase = 'captured';
    const run = {
      preset,
      label,
      sheetStrength,
      requestedUrl: requestedUrl.href,
      effectiveRouteIdentity,
      report: runReportPath,
      output,
      artifact,
      identity,
      diagnostics: sheetDiagnostics,
      consoleEvents,
    };
    writeRunReport({ ok: true, artifact, identity });
    ws.close();
    return run;
  } catch (error) {
    writeRunReport({ ok: false, error: error?.stack || String(error) });
    throw error;
  } finally {
    if (chromeProcess.exitCode === null) chromeProcess.kill('SIGTERM');
  }
}

try {
  if (comparisonAxis === 'pulse_drainage') {
    for (let index = 0; index < captureSteps.length; index += 1) {
      const captureStep = captureSteps[index];
      phase = `capturing_pulse_step_${captureStep}`;
      const run = await runPreset('high', debugPort + index, {
        label: `pulse-step-${captureStep}`,
        sheetStrength: unsupportedSheetStrength,
        captureStep,
        cutoffStep: inletCutoffStep,
      });
      timeSliceRuns.push(run);
      lastTrustworthyEvidence = { phase, completedCaptureSteps: timeSliceRuns.map(slice => slice.identity.capturedStep) };
      writeReport();
    }
    phase = 'evaluating_pulse_drainage_series';
    pulseSeries = evaluateFingerFluidPulseDrainageSeries({
      slices: timeSliceRuns.map(run => ({
        identity: run.identity,
        diagnostics: run.diagnostics,
        artifact: run.artifact,
      })),
      expectedCaptureSteps: captureSteps,
    });
  } else {
    phase = comparisonAxis === 'resolution' ? 'capturing_baseline' : 'capturing_unsupported_sheet_control';
    baselineRun = comparisonAxis === 'resolution'
      ? await runPreset('baseline', debugPort)
      : await runPreset('high', debugPort, { label: 'control', sheetStrength: 0 });
    phase = comparisonAxis === 'resolution' ? 'capturing_high' : 'capturing_unsupported_sheet_treatment';
    highRun = comparisonAxis === 'resolution'
      ? await runPreset('high', debugPort + 1)
      : await runPreset('high', debugPort + 1, { label: 'treatment', sheetStrength: unsupportedSheetStrength });
    phase = 'evaluating_pair_identity';
    pair = comparisonAxis === 'resolution'
      ? evaluateFingerFluidWaterfallOraclePair({
          baselineIdentity: baselineRun.identity,
          highIdentity: highRun.identity,
          baselineArtifact: baselineRun.artifact,
          highArtifact: highRun.artifact,
        })
      : evaluateFingerFluidUnsupportedSheetOraclePair({
          controlIdentity: baselineRun.identity,
          treatmentIdentity: highRun.identity,
          controlArtifact: baselineRun.artifact,
          treatmentArtifact: highRun.artifact,
        });
  }
  phase = 'captured_pending_operator_disposition';
  writeReport({ mechanicalChecksOk: true });
  console.log(JSON.stringify({
    report: reportPath,
    status: pulseSeries?.status || pair?.status,
    comparisonAxis,
    control: baselineRun?.output || null,
    treatment: highRun?.output || null,
    timeSlices: timeSliceRuns.map(run => run.output),
  }, null, 2));
} catch (error) {
  writeReport({ mechanicalChecksOk: false, error: error?.stack || String(error) });
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}
