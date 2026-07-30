#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OPTICAL_ROUTE = 'kaminos/finger-fluid/portable-macro-screen-space-optics-v0';
const CYAN_DEBUG_ROUTE = 'kaminos/finger-fluid/portable-macro-cyan-debug-v0';
const REGULAR_GRID_DEBUG_TOPOLOGY_ROUTE =
  'kaminos/finger-fluid/portable-macro-regular-grid-debug-v0';
const WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE =
  'kaminos/finger-fluid/portable-macro-wet-boundary-clipped-v0';
const CONTINUOUS_PATCH_TOPOLOGY_ROUTE =
  'kaminos/finger-fluid/portable-macro-continuous-patch-v0';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const startTimeSeconds = Number(args.get('--start-time') || 0.75);
const endTimeSeconds = Number(args.get('--end-time') || 2.75);
const requestedUrl = args.get('--url')
  || `http://127.0.0.1:48220/finger-fluid-portable-macro-optical-witness.html?mode=continuous&time=${startTimeSeconds}`;
const outDir = resolve(
  args.get('--out-dir') || `/tmp/kaminos-portable-macro-optics-${process.pid}`,
);
const reportPath = resolve(args.get('--report') || join(outDir, 'report.json'));
const dynamicStartPath = join(outDir, 'continuous-fixed-camera-source-start.png');
const dynamicEndPath = join(outDir, 'continuous-fixed-camera-source-end.png');
const regularGridPath = join(outDir, 'same-state-regular-grid-debug.png');
const cyanPath = join(outDir, 'same-state-cyan-debug.png');
const clippedPath = join(outDir, 'same-state-wet-boundary-clipped.png');
const cameraBasePath = join(outDir, 'frozen-source-camera-base.png');
const cameraMovedPath = join(outDir, 'frozen-source-camera-moved.png');
const debugPort = Number(args.get('--debug-port') || 9531);
const viewportWidth = Number(args.get('--viewport-width') || 1600);
const viewportHeight = Number(args.get('--viewport-height') || 1000);
const waitMs = Number(args.get('--wait-ms') || 30000);
const chrome = process.env.KAMINOS_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir')
  || `/tmp/kaminos-portable-macro-optics-profile-${debugPort}-${process.pid}`;

let phase = 'parse-config';
let primaryOutputWritten = false;
let requestedUrlObject = null;
let initialEffectiveUrl = null;
let effectiveUrl = null;
let browserVersion = null;
let servedSourceIdentity = null;
let state = null;
let captures = {};
let dynamicDelta = null;
let sameStateDelta = null;
let continuousDelta = null;
let cameraMotionDelta = null;
let operatorControls = null;
let stderr = '';
const consoleEvents = [];
const outputFiles = [];
let lastTrustworthyEvidence = {
  phase: 'argument-parse',
  evidence: { requestedUrl, reportPath },
};

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function preserveEvidence(completedPhase, evidence) {
  lastTrustworthyEvidence = { phase: completedPhase, evidence };
}

export function urlsHaveSameIdentity(actual, expected) {
  const canonicalize = value => {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) => (
      keyA.localeCompare(keyB) || valueA.localeCompare(valueB)
    ));
    url.search = '';
    for (const [key, value] of entries) url.searchParams.append(key, value);
    return url.href;
  };
  return canonicalize(actual) === canonicalize(expected);
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    schema: 'kaminos.finger-fluid.portable-macro-optical-browser-witness.v0',
    ok: false,
    requestedUrl,
    initialEffectiveUrl,
    effectiveUrl,
    requestedRoute: OPTICAL_ROUTE,
    effectiveRoute: state?.effectiveRoute ?? null,
    fallback: state?.fallback ?? null,
    requestedTopologyRoute: CONTINUOUS_PATCH_TOPOLOGY_ROUTE,
    effectiveTopologyRoute: state?.effectiveTopologyRoute ?? null,
    topologyFallback: state?.topologyFallback ?? null,
    backend: state?.backend ?? null,
    startTimeSeconds,
    endTimeSeconds,
    viewport: { width: viewportWidth, height: viewportHeight },
    debugPort,
    browserVersion,
    servedSourceIdentity,
    captures,
    dynamicDelta,
    sameStateDelta,
    continuousDelta,
    cameraMotionDelta,
    operatorControls,
    primary_output_written: primaryOutputWritten,
    failure_phase: phase,
    lastTrustworthyEvidence,
    outputFiles: [...outputFiles],
    consoleEvents,
    stderrTail: stderr.slice(-3000),
    lastState: state,
    ...extra,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function bindServedSourceIdentity() {
  const sources = [
    {
      localPath: 'finger-fluid-portable-macro-optical-witness.html',
      servedUrl: requestedUrlObject,
    },
    {
      localPath: 'finger-fluid-portable-macro-optical-witness.js',
      servedPath: 'finger-fluid-portable-macro-optical-witness.js?runtime=continuous-v1',
    },
    {
      localPath: 'finger-fluid-portable-macro-optical-renderer.js',
      servedPath: 'finger-fluid-portable-macro-optical-renderer.js',
    },
    {
      localPath: 'finger-fluid-webgpu-core.js',
      servedPath: 'finger-fluid-webgpu-core.js',
    },
  ];
  const identity = {};
  for (const { localPath, servedPath, servedUrl: exactServedUrl } of sources) {
    const localBytes = readFileSync(new URL(`./${localPath}`, import.meta.url));
    const servedUrl = exactServedUrl || new URL(`./${servedPath}`, requestedUrlObject);
    const response = await fetch(servedUrl);
    if (!response.ok) {
      throw new Error(`served source ${servedUrl.href} failed with ${response.status}`);
    }
    const servedBytes = Buffer.from(await response.arrayBuffer());
    identity[localPath] = {
      requestedUrl: servedUrl.href,
      effectiveUrl: response.url,
      localSha256: sha256(localBytes),
      servedSha256: sha256(servedBytes),
      bytes: servedBytes.byteLength,
    };
    identity[localPath].exactLocalMatch = (
      identity[localPath].localSha256 === identity[localPath].servedSha256
    );
    if (!identity[localPath].exactLocalMatch) {
      throw new Error(`served source differs from local checkout: ${localPath}`);
    }
  }
  return identity;
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
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

function decodePng(path) {
  const decoded = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: null, maxBuffer: 128 * 1024 * 1024 },
  );
  if (decoded.status !== 0 || !decoded.stdout?.length) {
    throw new Error(`ffmpeg PNG decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  return decoded.stdout;
}

function measurePng(path) {
  const pixels = decodePng(path);
  let activePixels = 0;
  let darkPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const maximum = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    if (maximum > 24) activePixels += 1;
    if (maximum < 4) darkPixels += 1;
  }
  const pixelCount = pixels.length / 3;
  return {
    pixelCount,
    activeRatio: Number((activePixels / pixelCount).toFixed(6)),
    darkRatio: Number((darkPixels / pixelCount).toFixed(6)),
    partial: activePixels / pixelCount < 0.2,
    blank: activePixels === 0,
    measurement: 'captured-portable-macro-canvas-rgb24-v0',
  };
}

function measurePngDelta(leftPath, rightPath) {
  const left = decodePng(leftPath);
  const right = decodePng(rightPath);
  if (left.length !== right.length) {
    throw new Error(`capture byte lengths differ: ${left.length} != ${right.length}`);
  }
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let offset = 0; offset < left.length; offset += 3) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(left[offset + channel] - right[offset + channel]);
      absoluteChannelDelta += difference;
      if (difference >= 3) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const pixelCount = left.length / 3;
  return {
    changedPixels,
    changedRatio: Number((changedPixels / pixelCount).toFixed(6)),
    meanAbsoluteChannelDelta: Number(
      (absoluteChannelDelta / left.length).toFixed(6),
    ),
    measurement: 'portable-macro-rgb24-absolute-delta-v0',
  };
}

async function readState(socket) {
  return evaluate(socket, 'window.kaminosPortableMacroOpticalDebugState ?? null');
}

function validateOpticalState(candidate, expectedTime, expectedTopologyRoute) {
  if (!candidate || candidate.status !== 'running') {
    throw new Error(`portable macro optical state is not running: ${JSON.stringify(candidate)}`);
  }
  if (candidate.backend !== 'webgpu') {
    throw new Error(`fallback backend rejected: ${candidate.backend}`);
  }
  if (
    candidate.requestedRoute !== OPTICAL_ROUTE
    || candidate.effectiveRoute !== OPTICAL_ROUTE
  ) {
    throw new Error(`optical route identity mismatch: ${JSON.stringify(candidate)}`);
  }
  if (candidate.fallback !== null) {
    throw new Error(`fallback route rejected: ${JSON.stringify(candidate.fallback)}`);
  }
  if (
    candidate.requestedTopologyRoute !== expectedTopologyRoute
    || candidate.effectiveTopologyRoute !== expectedTopologyRoute
  ) {
    throw new Error(`optical topology identity mismatch: ${JSON.stringify(candidate)}`);
  }
  if (candidate.topologyFallback !== null) {
    throw new Error(`fallback topology rejected: ${JSON.stringify(candidate.topologyFallback)}`);
  }
  if (
    candidate.rendererEvidence?.requestedTopologyRoute !== expectedTopologyRoute
    || candidate.rendererEvidence?.effectiveTopologyRoute !== expectedTopologyRoute
  ) {
    throw new Error(
      `renderer topology identity mismatch: ${JSON.stringify(candidate.rendererEvidence)}`,
    );
  }
  if (candidate.rendererEvidence?.topologyFallback !== null) {
    throw new Error(
      `renderer fallback topology rejected: ${
        JSON.stringify(candidate.rendererEvidence?.topologyFallback)
      }`,
    );
  }
  if (
    [WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE, CONTINUOUS_PATCH_TOPOLOGY_ROUTE]
      .includes(expectedTopologyRoute)
    && (
      !candidate.topology?.boundaryId
      || !candidate.topology?.resetId
    )
  ) {
    throw new Error(`wet-boundary evidence is partial: ${JSON.stringify(candidate.topology)}`);
  }
  if (
    expectedTopologyRoute === WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE
    && (
      candidate.rendererEvidence?.topology?.boundaryId !== candidate.topology.boundaryId
      || candidate.rendererEvidence?.topology?.resetId !== candidate.topology.resetId
      || candidate.rendererEvidence?.topology?.shorelineCrossingCount
        !== candidate.topology.shorelineCrossingCount
      || candidate.rendererEvidence?.topology?.clippedCellCount
        !== candidate.topology.clippedCellCount
      || !candidate.rendererEvidence?.topology?.ambiguityRoute
    )
  ) {
    throw new Error(
      `renderer clipped shoreline evidence is partial or divergent: ${
        JSON.stringify(candidate.rendererEvidence?.topology)
      }`,
    );
  }
  if (
    expectedTopologyRoute === CONTINUOUS_PATCH_TOPOLOGY_ROUTE
    && (
      candidate.topology?.reconstruction?.position !== 'shared-c1-hermite-patch-v0'
      || candidate.topology?.reconstruction?.normal
        !== 'analytic-position-derivative-v0'
      || candidate.topology?.reconstruction?.coverage
        !== 'fragment-signed-wet-margin-aa-v0'
      || candidate.topology?.reconstruction?.stableCarrier !== true
      || candidate.rendererEvidence?.topology?.reconstruction?.position
        !== 'shared-c1-hermite-patch-v0'
    )
  ) {
    throw new Error(
      `continuous reconstruction evidence is partial or divergent: ${
        JSON.stringify(candidate)
      }`,
    );
  }
  if (candidate.blank || candidate.partial || !candidate.primaryOutputWritten) {
    throw new Error(`blank or partial optical output rejected: ${JSON.stringify(candidate)}`);
  }
  if (Math.abs(candidate.animationTimeSeconds - expectedTime) > 1e-6) {
    throw new Error(`stale optical state time rejected: ${candidate.animationTimeSeconds}`);
  }
}

async function setTimeAndMode(socket, timeSeconds, mode) {
  return evaluate(socket, `(async () => {
    const timeControl = document.querySelector('#time-control');
    const modeControl = document.querySelector(
      \`#mode-controls [data-mode="${mode}"]\`
    );
    const requestedTime = ${JSON.stringify(timeSeconds)};
    if (!timeControl || !modeControl) throw new Error('operator controls are missing');
    if (requestedTime > Number(timeControl.max)) {
      timeControl.max = String(Math.ceil(requestedTime + 1));
    }
    timeControl.value = requestedTime;
    timeControl.dispatchEvent(new Event('input', { bubbles: true }));
    modeControl.click();
    await window.__kaminosPortableMacroDevice?.queue?.onSubmittedWorkDone?.();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.kaminosPortableMacroOpticalDebugState;
  })()`);
}

async function exerciseOperatorControls(socket, initialState) {
  const result = await evaluate(socket, `(async () => {
    const controls = document.querySelector('#controls');
    const playback = document.querySelector('#playback-toggle');
    const timeControl = document.querySelector('#time-control');
    const modes = [...document.querySelectorAll('#mode-controls [data-mode]')];
    const cyanControl = modes.find(control => control.dataset.mode === 'cyan');
    const bounds = controls?.getBoundingClientRect();
    if (
      !controls
      || !playback
      || !timeControl
      || !cyanControl
      || modes.length !== 4
      || !bounds
      || bounds.width < 240
      || bounds.height < 60
      || bounds.right > window.innerWidth
      || bounds.bottom > window.innerHeight
    ) {
      throw new Error('operator controls are hidden or partial');
    }
    const before = window.kaminosPortableMacroOpticalDebugState;
    playback.click();
    await new Promise(resolve => setTimeout(resolve, 250));
    await window.__kaminosPortableMacroDevice?.queue?.onSubmittedWorkDone?.();
    const playing = window.kaminosPortableMacroOpticalDebugState;
    if (
      playing.paused
      || playing.frameCount <= before.frameCount
      || playing.animationTimeSeconds <= before.animationTimeSeconds + 0.1
    ) {
      throw new Error('animation did not advance through the visible play control');
    }
    playback.click();
    await window.__kaminosPortableMacroDevice?.queue?.onSubmittedWorkDone?.();
    const paused = window.kaminosPortableMacroOpticalDebugState;
    await new Promise(resolve => setTimeout(resolve, 150));
    const settled = window.kaminosPortableMacroOpticalDebugState;
    if (
      !paused.paused
      || !settled.paused
      || settled.animationTimeSeconds !== paused.animationTimeSeconds
    ) {
      throw new Error('pause control did not freeze the visible animation state');
    }
    cyanControl.click();
    await window.__kaminosPortableMacroDevice?.queue?.onSubmittedWorkDone?.();
    const cyan = window.kaminosPortableMacroOpticalDebugState;
    if (
      cyan.requestedMode !== 'cyan'
      || cyan.effectiveMode !== 'cyan'
      || cyan.requestedRoute !== ${JSON.stringify(CYAN_DEBUG_ROUTE)}
      || cyan.effectiveRoute !== ${JSON.stringify(CYAN_DEBUG_ROUTE)}
      || cyan.fallback !== null
      || cyan.requestedTopologyRoute
        !== ${JSON.stringify(CONTINUOUS_PATCH_TOPOLOGY_ROUTE)}
      || cyan.effectiveTopologyRoute
        !== ${JSON.stringify(CONTINUOUS_PATCH_TOPOLOGY_ROUTE)}
      || cyan.topologyFallback !== null
    ) {
      throw new Error(\`cyan visible control route mismatch: \${JSON.stringify(cyan)}\`);
    }
    return {
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      modeCount: modes.length,
      before: {
        frameCount: before.frameCount,
        animationTimeSeconds: before.animationTimeSeconds,
        paused: before.paused,
      },
      playing: {
        frameCount: playing.frameCount,
        animationTimeSeconds: playing.animationTimeSeconds,
        paused: playing.paused,
      },
      paused: {
        frameCount: settled.frameCount,
        animationTimeSeconds: settled.animationTimeSeconds,
        paused: settled.paused,
      },
      cyan: {
        requestedMode: cyan.requestedMode,
        effectiveMode: cyan.effectiveMode,
        requestedRoute: cyan.requestedRoute,
        effectiveRoute: cyan.effectiveRoute,
        fallback: cyan.fallback,
        requestedTopologyRoute: cyan.requestedTopologyRoute,
        effectiveTopologyRoute: cyan.effectiveTopologyRoute,
        topologyFallback: cyan.topologyFallback,
      },
      playbackLabel: playback.getAttribute('aria-label'),
      timeValue: document.querySelector('#time-value')?.value ?? null,
    };
  })()`);
  const restoredState = await setTimeAndMode(
    socket,
    initialState.animationTimeSeconds,
    'continuous',
  );
  return { ...result, restoredState };
}

async function setCameraOrbit(socket, cameraOrbitRadians) {
  return evaluate(socket, `(async () => {
    const state = window.kaminosPortableMacroSetCameraOrbitForWitness?.(
      ${JSON.stringify(cameraOrbitRadians)}
    );
    if (!state) throw new Error('camera witness control is missing');
    await window.__kaminosPortableMacroDevice?.queue?.onSubmittedWorkDone?.();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.kaminosPortableMacroOpticalDebugState;
  })()`);
}

async function captureCanvas(socket, path) {
  const rect = await evaluate(socket, `(() => {
    const canvas = document.getElementById('portable-macro-optics');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  })()`);
  if (!rect || rect.width < 100 || rect.height < 100) {
    throw new Error(`portable macro canvas is missing or partial: ${JSON.stringify(rect)}`);
  }
  const screenshot = await wsRequest(socket, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...rect, scale: 1 },
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
  const visual = measurePng(path);
  if (visual.blank || visual.partial) {
    throw new Error(`captured output is blank or partial: ${JSON.stringify(visual)}`);
  }
  outputFiles.push(path);
  return visual;
}

async function main() {
  requestedUrlObject = new URL(requestedUrl);
  if (
    requestedUrlObject.pathname !== '/finger-fluid-portable-macro-optical-witness.html'
    || requestedUrlObject.searchParams.get('mode') !== 'continuous'
    || Number(requestedUrlObject.searchParams.get('time')) !== startTimeSeconds
  ) {
    throw new Error(`witness URL is stale or defaulted: ${requestedUrl}`);
  }
  if (
    !Number.isFinite(startTimeSeconds)
    || startTimeSeconds < 0
    || !Number.isFinite(endTimeSeconds)
    || endTimeSeconds <= startTimeSeconds
  ) {
    throw new Error('dynamic witness times must be finite, nonnegative, and increasing');
  }
  preserveEvidence('validate-config', {
    requestedUrl,
    startTimeSeconds,
    endTimeSeconds,
    viewport: { width: viewportWidth, height: viewportHeight },
  });

  phase = 'bind-served-source';
  servedSourceIdentity = await bindServedSourceIdentity();
  preserveEvidence('bind-served-source', servedSourceIdentity);

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
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      state = await readState(socket);
      if (state?.status === 'error') {
        throw new Error(`renderer failed before primary output: ${JSON.stringify(state)}`);
      }
      if (state?.status === 'running' && state.frameCount > 0) break;
      await delay(100);
    }
    initialEffectiveUrl = await evaluate(socket, 'window.location.href');
    if (initialEffectiveUrl !== requestedUrl) {
      throw new Error(
        `initialEffectiveUrl !== requestedUrl: ${initialEffectiveUrl} != ${requestedUrl}`,
      );
    }
    validateOpticalState(
      state,
      startTimeSeconds,
      CONTINUOUS_PATCH_TOPOLOGY_ROUTE,
    );
    preserveEvidence('first-optical-frame', state);

    phase = 'exercise-operator-controls';
    operatorControls = await exerciseOperatorControls(socket, state);
    state = operatorControls.restoredState;
    validateOpticalState(
      state,
      startTimeSeconds,
      CONTINUOUS_PATCH_TOPOLOGY_ROUTE,
    );
    preserveEvidence('exercise-operator-controls', operatorControls);

    phase = 'capture-dynamic-start';
    captures.dynamicStart = {
      state,
      visual: await captureCanvas(socket, dynamicStartPath),
      path: dynamicStartPath,
    };
    primaryOutputWritten = true;

    phase = 'capture-dynamic-end';
    state = await setTimeAndMode(socket, endTimeSeconds, 'continuous');
    validateOpticalState(
      state,
      endTimeSeconds,
      CONTINUOUS_PATCH_TOPOLOGY_ROUTE,
    );
    captures.dynamicEnd = {
      state,
      visual: await captureCanvas(socket, dynamicEndPath),
      path: dynamicEndPath,
    };
    dynamicDelta = measurePngDelta(dynamicStartPath, dynamicEndPath);
    if (dynamicDelta.changedRatio < 0.002) {
      throw new Error(`dynamic output is stale: ${JSON.stringify(dynamicDelta)}`);
    }

    phase = 'capture-same-state-regular-grid-debug';
    state = await setTimeAndMode(socket, endTimeSeconds, 'regular_grid_debug');
    validateOpticalState(
      state,
      endTimeSeconds,
      REGULAR_GRID_DEBUG_TOPOLOGY_ROUTE,
    );
    captures.regularGridDebug = {
      state,
      visual: await captureCanvas(socket, regularGridPath),
      path: regularGridPath,
    };

    phase = 'capture-same-state-cyan-debug';
    state = await setTimeAndMode(socket, endTimeSeconds, 'cyan');
    if (
      state?.status !== 'running'
      || state.backend !== 'webgpu'
      || state.requestedMode !== 'cyan'
      || state.effectiveMode !== 'cyan'
      || state.requestedRoute !== CYAN_DEBUG_ROUTE
      || state.effectiveRoute !== CYAN_DEBUG_ROUTE
      || state.fallback !== null
      || state.requestedTopologyRoute !== CONTINUOUS_PATCH_TOPOLOGY_ROUTE
      || state.effectiveTopologyRoute !== CONTINUOUS_PATCH_TOPOLOGY_ROUTE
      || state.topologyFallback !== null
      || state.blank
      || state.partial
      || !state.primaryOutputWritten
    ) {
      throw new Error(`cyan visible output rejected: ${JSON.stringify(state)}`);
    }
    captures.cyanDebug = {
      state,
      visual: await captureCanvas(socket, cyanPath),
      path: cyanPath,
    };

    phase = 'capture-same-state-wet-boundary-clipped';
    state = await setTimeAndMode(socket, endTimeSeconds, 'clipped');
    validateOpticalState(
      state,
      endTimeSeconds,
      WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE,
    );
    captures.wetBoundaryClipped = {
      state,
      visual: await captureCanvas(socket, clippedPath),
      path: clippedPath,
    };
    sameStateDelta = measurePngDelta(regularGridPath, dynamicEndPath);
    if (sameStateDelta.changedRatio < 0.001) {
      throw new Error(
        `continuous topology lacks a material grid-debug delta: ${JSON.stringify(sameStateDelta)}`,
      );
    }
    continuousDelta = measurePngDelta(clippedPath, dynamicEndPath);
    if (continuousDelta.changedRatio < 0.001) {
      throw new Error(
        `continuous reconstruction lacks a material clipped-route delta: ${
          JSON.stringify(continuousDelta)
        }`,
      );
    }

    phase = 'capture-frozen-source-camera-base';
    state = await setTimeAndMode(socket, endTimeSeconds, 'continuous');
    state = await setCameraOrbit(socket, 0);
    validateOpticalState(state, endTimeSeconds, CONTINUOUS_PATCH_TOPOLOGY_ROUTE);
    captures.frozenSourceCameraBase = {
      state,
      visual: await captureCanvas(socket, cameraBasePath),
      path: cameraBasePath,
    };

    phase = 'capture-frozen-source-camera-moved';
    state = await setCameraOrbit(socket, 0.18);
    validateOpticalState(state, endTimeSeconds, CONTINUOUS_PATCH_TOPOLOGY_ROUTE);
    if (Math.abs(state.cameraOrbitRadians - 0.18) > 1e-6) {
      throw new Error(`camera route is stale: ${JSON.stringify(state)}`);
    }
    captures.frozenSourceCameraMoved = {
      state,
      visual: await captureCanvas(socket, cameraMovedPath),
      path: cameraMovedPath,
    };
    cameraMotionDelta = measurePngDelta(cameraBasePath, cameraMovedPath);
    if (cameraMotionDelta.changedRatio < 0.002) {
      throw new Error(`camera output is stale: ${JSON.stringify(cameraMotionDelta)}`);
    }
    if (consoleEvents.some(event => event.type === 'exception' || event.type === 'error')) {
      throw new Error(`browser emitted runtime errors: ${JSON.stringify(consoleEvents)}`);
    }

    phase = 'complete';
    state = await setCameraOrbit(socket, 0);
    const expectedFinalUrl = new URL(requestedUrl);
    expectedFinalUrl.searchParams.set('mode', 'continuous');
    expectedFinalUrl.searchParams.set('time', endTimeSeconds.toFixed(2));
    expectedFinalUrl.searchParams.set('paused', '1');
    expectedFinalUrl.searchParams.delete('cameraOrbit');
    const finalEffectiveUrl = await evaluate(socket, 'window.location.href');
    if (!urlsHaveSameIdentity(finalEffectiveUrl, expectedFinalUrl)) {
      throw new Error(
        `final effective URL is stale: ${finalEffectiveUrl} != ${expectedFinalUrl.href}`,
      );
    }
    effectiveUrl = finalEffectiveUrl;
    preserveEvidence('complete', {
      initialEffectiveUrl,
      effectiveUrl,
      backend: state.backend,
      effectiveRoute: state.effectiveRoute,
      effectiveTopologyRoute: state.effectiveTopologyRoute,
      topology: state.topology,
      source: state.source,
      host: state.host,
      dynamicDelta,
      sameStateDelta,
      continuousDelta,
      cameraMotionDelta,
    });
    const report = writeReport({
      ok: true,
      failure_phase: null,
      primary_output_written: true,
    });
    socket.close();
    return report;
  } finally {
    chromeProcess.kill('SIGTERM');
    await delay(250);
    if (!chromeProcess.killed) chromeProcess.kill('SIGKILL');
  }
}

const invokedAsMain = process.argv[1] && (
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
);
if (invokedAsMain) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const report = writeReport({
      ok: false,
      error: error?.stack || error?.message || String(error),
    });
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}
