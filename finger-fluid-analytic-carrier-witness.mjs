#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  validateFingerFluidAnalyticCarrierWitnessReport,
} from './finger-fluid-analytic-carrier-witness-contract.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const requestedUrl = args.get('--url')
  || 'http://127.0.0.1:48220/index.html?kaminos_finger_fluid_bench=1'
    + '&finger_fluid_truth_scene=live_hand_inlets'
    + '&finger_fluid_renderer=screen_space_refraction'
    + '&finger_fluid_analytic_carrier=hybrid_analytic_carrier'
    + '&finger_fluid_witness_target_step=72';
const requestedUrlObject = new URL(requestedUrl);
const targetStep = Number(
  requestedUrlObject.searchParams.get('finger_fluid_witness_target_step') || 72,
);
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-analytic-carrier-${process.pid}`);
const reportPath = resolve(args.get('--report') || join(outDir, 'report.json'));
const hybridPath = join(outDir, 'hybrid-analytic-carrier.png');
const particlePath = join(outDir, 'particle-only.png');
const debugPort = Number(args.get('--debug-port') || 9527);
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const hookWaitMs = Number(args.get('--hook-wait-ms') || 45000);
const chrome = process.env.KAMINOS_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir')
  || `/tmp/kaminos-analytic-carrier-profile-${debugPort}-${process.pid}`;
const fixedCamera = {
  yaw: -0.62,
  pitch: 0.52,
  distance: 6.2,
  target: [0, -0.48, 0.2],
};

let phase = 'validate-config';
let primaryOutputWritten = false;
let effectiveUrl = null;
let browserVersion = null;
let servedSourceIdentity = null;
let lastDebugState = null;
let sourceIdentity = null;
let sameState = null;
let captures = {};
let visualDelta = null;
let stderr = '';
const consoleEvents = [];

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    schema: 'kaminos.finger-fluid.analytic-carrier-visual-witness.v1',
    ok: false,
    requestedUrl,
    effectiveUrl,
    targetStep,
    debugPort,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    servedSourceIdentity,
    backend: lastDebugState?.runtime ? {
      solver: lastDebugState.runtime.solver_backend,
      renderer: lastDebugState.runtime.render_backend,
      solverRoute: lastDebugState.runtime.solverRoute,
      rendererRoute: lastDebugState.runtime.effectiveRenderer,
    } : null,
    sourceIdentity,
    sameState,
    captures,
    visualDelta,
    outputFiles: primaryOutputWritten ? [hybridPath, particlePath] : [],
    consoleEvents,
    stderrTail: stderr.slice(-2000),
    lastDebugState,
    ...extra,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function bindServedSourceIdentity() {
  const sources = [
    ['index.html', new URL('./index.html', requestedUrlObject), new URL('./index.html', import.meta.url)],
    [
      'finger-fluid-webgpu-core.js',
      new URL('./finger-fluid-webgpu-core.js', requestedUrlObject),
      new URL('./finger-fluid-webgpu-core.js', import.meta.url),
    ],
  ];
  const identity = {};
  for (const [name, servedUrl, localUrl] of sources) {
    const localBytes = readFileSync(localUrl);
    const response = await fetch(servedUrl);
    if (!response.ok) throw new Error(`served source ${servedUrl} failed ${response.status}`);
    const servedBytes = Buffer.from(await response.arrayBuffer());
    identity[name] = {
      requestedUrl: servedUrl.href,
      effectiveUrl: response.url,
      localSha256: sha256(localBytes),
      servedSha256: sha256(servedBytes),
      bytes: servedBytes.byteLength,
    };
    identity[name].exactLocalMatch = identity[name].localSha256 === identity[name].servedSha256;
    if (!identity[name].exactLocalMatch) {
      throw new Error(`served source differs from witness checkout: ${JSON.stringify(identity[name])}`);
    }
  }
  return identity;
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForPage() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error('Chrome page target did not open');
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener(
      'error',
      () => rejectOpen(new Error('WebSocket open failed')),
      { once: true },
    );
  });
}

function wsRequest(socket, method, params = {}) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 30000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function evaluate(socket, expression) {
  const result = await wsRequest(socket, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Runtime.evaluate failed',
    );
  }
  return result.result.value;
}

function collectRuntimeEvents(socket) {
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: (message.params.args || [])
          .map(value => value.value || value.description || '')
          .join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description
          || message.params.exceptionDetails?.text
          || 'Runtime exception',
      });
    }
  });
}

function decodePng(path) {
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: null, maxBuffer: 128 * 1024 * 1024 },
  );
  if (decoded.status !== 0 || !decoded.stdout?.length) {
    throw new Error(`ffmpeg canvas decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  return decoded.stdout;
}

function measurePng(path) {
  const pixels = decodePng(path);
  let activePixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 3) {
    if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 24) {
      activePixels += 1;
    }
  }
  const pixelCount = Math.floor(pixels.length / 3);
  const activeRatio = activePixels / Math.max(1, pixelCount);
  return {
    pixelCount,
    activePixels,
    activeRatio: Number(activeRatio.toFixed(6)),
    partial: activeRatio < 0.02,
    measurement: 'captured-webgpu-canvas-rgb24-v1',
  };
}

function measurePngDelta(leftPath, rightPath) {
  const left = decodePng(leftPath);
  const right = decodePng(rightPath);
  if (left.length !== right.length) {
    throw new Error(`same-state captures have different byte lengths: ${left.length} != ${right.length}`);
  }
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let offset = 0; offset < left.length; offset += 3) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      absoluteChannelDelta += delta;
      if (delta >= 3) pixelChanged = true;
    }
    if (pixelChanged) changedPixels += 1;
  }
  const pixelCount = Math.floor(left.length / 3);
  return {
    changedPixels,
    changedRatio: Number((changedPixels / Math.max(1, pixelCount)).toFixed(6)),
    meanAbsoluteChannelDelta: Number(
      (absoluteChannelDelta / Math.max(1, left.length)).toFixed(6),
    ),
    measurement: 'same-state-analytic-carrier-rgb24-absolute-delta-v1',
  };
}

async function captureCanvas(socket, path) {
  const rect = await evaluate(socket, `(() => {
    const canvas = document.getElementById('finger-fluid-bench-canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  })()`);
  if (!rect || rect.width < 100 || rect.height < 100) {
    throw new Error(`fluid canvas is missing or partial: ${JSON.stringify(rect)}`);
  }
  const screenshot = await wsRequest(socket, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...rect, scale: 1 },
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
  return measurePng(path);
}

function carrierCaptureFromState(state, camera, visual) {
  const optics = state.runtime?.analyticCarrierOptics;
  const live = state.runtime?.liveInlets;
  const hybridActive = optics?.effectiveMode === 'hybrid_analytic_carrier';
  return {
    requestedMode: optics?.requestedMode,
    effectiveMode: optics?.effectiveMode,
    requestedRoute: optics?.requestedRoute,
    effectiveRoute: optics?.effectiveRoute,
    fallbackRoute: optics?.fallbackRoute,
    sourceIdentity: {
      packetId: live?.packetId,
      sourceRoute: live?.sourceRoute,
      artifactSha256: live?.artifactSha256,
      generation: live?.generation,
      sourceMechanicsRevision: optics?.sourceMechanicsRevision,
      ageContract: optics?.ageContract ?? live?.ageContract,
    },
    admittedCarrierSourceIdentity: hybridActive
      ? optics?.admittedCarrierSourceIdentity ?? null
      : null,
    particleSuppressionContract: hybridActive
      ? optics?.particleSuppressionContract ?? null
      : null,
    stepCount: state.runtime?.stepCount,
    camera,
    sampleCount: optics?.sampleCount ?? 0,
    carrierDrawCount: optics?.carrierDrawCount ?? 0,
    accumulationDrawCount: optics?.accumulationDrawCount ?? 0,
    primaryOutputWritten: optics?.primaryOutputWritten === true,
    status: optics?.status,
    supportSourceId: optics?.supportSourceId ?? null,
    supportEpoch: optics?.supportEpoch ?? null,
    remapEpoch: optics?.remapEpoch ?? null,
    handoffReceiptId: optics?.handoffReceiptId ?? null,
    visual,
  };
}

async function readDebugState(socket) {
  return evaluate(socket, `(() => {
    const read = window.kaminosFingerFluidBenchDebugState
      || window.__kaminosFingerFluidBenchDebugState;
    return typeof read === 'function' ? read() : null;
  })()`);
}

async function main() {
  if (
    requestedUrlObject.searchParams.get('finger_fluid_truth_scene') !== 'live_hand_inlets'
    || requestedUrlObject.searchParams.get('finger_fluid_renderer') !== 'screen_space_refraction'
    || requestedUrlObject.searchParams.get('finger_fluid_analytic_carrier') !== 'hybrid_analytic_carrier'
  ) {
    throw new Error(`analytic carrier witness URL is stale or defaulted: ${requestedUrl}`);
  }
  if (!Number.isSafeInteger(targetStep) || targetStep < 1) {
    throw new Error(`analytic carrier witness target step must be positive: ${targetStep}`);
  }
  phase = 'bind-served-source';
  servedSourceIdentity = await bindServedSourceIdentity();
  phase = 'launch-browser';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-webgpu',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect-cdp';
    browserVersion = await waitForCdp();
    const page = await waitForPage();
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(socket);
    collectRuntimeEvents(socket);
    await wsRequest(socket, 'Runtime.enable');
    await wsRequest(socket, 'Page.enable');
    await wsRequest(socket, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    phase = 'navigate';
    await wsRequest(socket, 'Page.navigate', { url: requestedUrl });

    phase = 'wait-authoritative-hybrid';
    const deadline = Date.now() + hookWaitMs;
    while (Date.now() < deadline) {
      lastDebugState = await readDebugState(socket);
      const optics = lastDebugState?.runtime?.analyticCarrierOptics;
      if (
        lastDebugState?.status === 'running'
        && lastDebugState.runtime?.stepCount >= targetStep
        && optics?.effectiveMode === 'hybrid_analytic_carrier'
        && optics?.primaryOutputWritten === true
      ) break;
      if (lastDebugState?.status === 'error') {
        throw new Error(`analytic carrier route failed before output: ${JSON.stringify(lastDebugState)}`);
      }
      await delay(100);
    }
    if (
      lastDebugState?.status !== 'running'
      || lastDebugState.runtime?.stepCount < targetStep
      || lastDebugState.runtime?.analyticCarrierOptics?.effectiveMode !== 'hybrid_analytic_carrier'
    ) {
      throw new Error(`hybrid carrier never became authoritative: ${JSON.stringify(lastDebugState)}`);
    }
    effectiveUrl = await evaluate(socket, 'window.location.href');
    if (effectiveUrl !== requestedUrl) {
      throw new Error(`requested and effective URL disagree: ${requestedUrl} != ${effectiveUrl}`);
    }
    if (
      lastDebugState.runtime?.solver_backend !== 'webgpu_compute'
      || lastDebugState.runtime?.render_backend !== 'webgpu_direct_render'
      || lastDebugState.runtime?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0'
      || lastDebugState.runtime?.effectiveRenderer !== 'webgpu-screen-space-liquid-refraction-v0'
    ) {
      throw new Error(`fallback backend rejected: ${JSON.stringify(lastDebugState.runtime)}`);
    }
    sourceIdentity = {
      packetId: lastDebugState.runtime.liveInlets?.packetId,
      sourceRoute: lastDebugState.runtime.liveInlets?.sourceRoute,
      artifactSha256: lastDebugState.runtime.liveInlets?.artifactSha256,
      generation: lastDebugState.runtime.liveInlets?.generation,
      sourceMechanicsRevision:
        lastDebugState.runtime.analyticCarrierOptics?.sourceMechanicsRevision,
      ageContract: lastDebugState.runtime.analyticCarrierOptics?.ageContract
        ?? lastDebugState.runtime.liveInlets?.ageContract,
    };
    await evaluate(socket, 'window.kaminosFingerFluidBenchSetSimulationPausedForWitness?.(true)');
    const camera = await evaluate(
      socket,
      `window.kaminosFingerFluidBenchSetCameraForWitness?.(${JSON.stringify(fixedCamera)})`,
    );
    await evaluate(socket, `(() => {
      const overlay = document.getElementById('finger-fluid-bench-overlay');
      const fps = document.getElementById('fps-counter');
      if (overlay) overlay.style.visibility = 'hidden';
      if (fps) fps.style.visibility = 'hidden';
      return true;
    })()`);

    phase = 'capture-hybrid';
    const hybridReceipt = await evaluate(
      socket,
      `window.kaminosFingerFluidBenchRenderCurrentStateForWitness?.(
        'screen_space_refraction',
        'shaded'
      )`,
    );
    const hybridVisual = await captureCanvas(socket, hybridPath);
    primaryOutputWritten = true;
    lastDebugState = await readDebugState(socket);
    captures.hybrid_analytic_carrier = carrierCaptureFromState(
      lastDebugState,
      camera,
      hybridVisual,
    );
    if (hybridReceipt?.stepCount !== captures.hybrid_analytic_carrier.stepCount) {
      throw new Error('hybrid capture receipt and browser state disagree');
    }

    phase = 'switch-particle-control';
    const controlAdmission = await evaluate(
      socket,
      `window.kaminosFingerFluidBenchSetAnalyticCarrierModeForWitness?.('particle_only')`,
    );
    if (
      controlAdmission?.requestedMode !== 'particle_only'
      || controlAdmission?.effectiveMode !== 'particle_only'
      || controlAdmission?.fallbackRoute !== null
    ) {
      throw new Error(`particle-only control admission disagrees: ${JSON.stringify(controlAdmission)}`);
    }

    phase = 'capture-particle-control';
    const particleReceipt = await evaluate(
      socket,
      `window.kaminosFingerFluidBenchRenderCurrentStateForWitness?.(
        'screen_space_refraction',
        'shaded'
      )`,
    );
    const particleVisual = await captureCanvas(socket, particlePath);
    lastDebugState = await readDebugState(socket);
    captures.particle_only = carrierCaptureFromState(lastDebugState, camera, particleVisual);
    if (
      particleReceipt?.stepCount !== captures.particle_only.stepCount
      || captures.particle_only.stepCount !== captures.hybrid_analytic_carrier.stepCount
    ) {
      throw new Error(`same-state carrier A/B advanced the simulation: ${JSON.stringify({
        hybrid: captures.hybrid_analytic_carrier.stepCount,
        particleOnly: captures.particle_only.stepCount,
      })}`);
    }
    sameState = {
      exact: true,
      stepCount: captures.particle_only.stepCount,
      camera,
    };
    visualDelta = measurePngDelta(hybridPath, particlePath);
    if (consoleEvents.some(event => ['error', 'exception'].includes(event.type))) {
      throw new Error(`browser console contains runtime errors: ${JSON.stringify(consoleEvents)}`);
    }

    phase = null;
    const report = writeReport({
      ok: true,
      failure_phase: null,
      primary_output_written: true,
    });
    const acceptance = validateFingerFluidAnalyticCarrierWitnessReport(report);
    writeReport({
      ok: true,
      failure_phase: null,
      primary_output_written: true,
      acceptance,
    });
    socket.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    writeReport({
      ok: false,
      error: error?.message || String(error),
    });
    console.error(error);
    process.exit(1);
  });
