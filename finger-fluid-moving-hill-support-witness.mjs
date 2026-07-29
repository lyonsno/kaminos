#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const MOVING_HILL_ROUTE = 'lerms/hill-of-hills/gpu-moving-support-contact-v0';
const MOVING_HILL_PRESENTATION_MODE = 'moving_hill_consumer';
const MOVING_HILL_PRESENTATION_ROUTE =
  'kaminos/finger-fluid/moving-hill-consumer-presentation-v0';
const EXTERNAL_CAMERA_IDENTITY = 'kaminos-moving-hill-support-witness-camera';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const requestedUrl = args.get('--url');
const out = resolve(args.get('--out') || `/tmp/kaminos-moving-hill-support-${process.pid}.png`);
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const debugPort = Number(args.get('--debug-port') || 9573);
const viewportWidth = Number(args.get('--viewport-width') || 1600);
const viewportHeight = Number(args.get('--viewport-height') || 1000);
const waitMs = Number(args.get('--wait-ms') || 30000);
const chrome = process.env.KAMINOS_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir')
  || `/tmp/kaminos-moving-hill-support-profile-${debugPort}-${process.pid}`;

let phase = 'parse-config';
let primaryOutputWritten = false;
let effectiveUrl = null;
let browserVersion = null;
let servedSourceIdentity = null;
let state = null;
let visual = null;
let stderr = '';
let chromeProcess = null;
const consoleEvents = [];
let lastTrustworthyEvidence = {
  phase: 'argument-parse',
  evidence: { requestedUrl, out, reportPath },
};

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function waitForBrowserLaunch(child) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let launched = false;
    child.on('error', error => {
      stderr += `${error?.stack || error}\n`;
      if (!launched) rejectLaunch(error);
    });
    child.once('spawn', () => {
      launched = true;
      resolveLaunch();
    });
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function preserveEvidence(completedPhase, evidence) {
  lastTrustworthyEvidence = { phase: completedPhase, evidence };
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    schema: 'kaminos.finger-fluid.moving-hill-support-browser-witness-report.v0',
    ok: false,
    requestedUrl,
    effectiveUrl,
    requestedRoute: MOVING_HILL_ROUTE,
    effectiveRoute: state?.effectiveRoute ?? null,
    fallbackRoute: state?.fallbackRoute ?? null,
    backend: state?.backend ?? null,
    evidenceScope: state?.evidenceScope
      ?? 'synthetic_canonical_frame_contract_witness_not_lerms_source_authority',
    primary_output_written: primaryOutputWritten,
    failure_phase: phase,
    lastTrustworthyEvidence,
    browserVersion,
    servedSourceIdentity,
    state,
    visual,
    output: out,
    viewport: { width: viewportWidth, height: viewportHeight },
    debugPort,
    consoleEvents,
    stderrTail: stderr.slice(-3000),
    ...extra,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function bindServedSourceIdentity(url) {
  const names = [
    'finger-fluid-moving-hill-support-witness.html',
    'finger-fluid-moving-hill-support-witness.js',
    'finger-fluid-webgpu-core.js',
  ];
  const identity = {};
  for (const name of names) {
    const localBytes = readFileSync(new URL(`./${name}`, import.meta.url));
    const servedUrl = new URL(`./${name}`, url);
    const response = await fetch(servedUrl);
    if (!response.ok) {
      throw new Error(`served source ${servedUrl.href} failed with ${response.status}`);
    }
    const servedBytes = Buffer.from(await response.arrayBuffer());
    identity[name] = {
      requestedUrl: servedUrl.href,
      effectiveUrl: response.url,
      localSha256: sha256(localBytes),
      servedSha256: sha256(servedBytes),
      bytes: servedBytes.byteLength,
    };
    identity[name].exactLocalMatch = (
      identity[name].localSha256 === identity[name].servedSha256
    );
    if (!identity[name].exactLocalMatch) {
      throw new Error(`served source differs from local checkout: ${name}`);
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
  for (let offset = 0; offset < pixels.length; offset += 3) {
    if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 24) {
      activePixels += 1;
    }
  }
  const pixelCount = pixels.length / 3;
  return {
    pixelCount,
    activePixels,
    activeRatio: Number((activePixels / pixelCount).toFixed(6)),
    blank: activePixels === 0,
    partial: activePixels / pixelCount < 0.04,
    measurement: 'captured-moving-hill-support-canvas-rgb24-v0',
  };
}

async function captureCanvas(socket) {
  const rect = await evaluate(socket, `(() => {
    const canvas = document.getElementById('moving-hill-support');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  })()`);
  if (!rect || rect.width < 100 || rect.height < 100) {
    throw new Error(`moving-Hill canvas is missing or partial: ${JSON.stringify(rect)}`);
  }
  const screenshot = await wsRequest(socket, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...rect, scale: 1 },
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
  const measurement = measurePng(out);
  if (measurement.blank || measurement.partial) {
    throw new Error(`captured moving-Hill output is blank or partial: ${JSON.stringify(measurement)}`);
  }
  return measurement;
}

function validateState(candidate) {
  if (!candidate || candidate.status !== 'running') {
    throw new Error(`moving-Hill witness is not running: ${JSON.stringify(candidate)}`);
  }
  if (candidate.backend !== 'webgpu_compute') {
    throw new Error(`fallback backend rejected: ${candidate.backend}`);
  }
  if (
    candidate.requestedRoute !== MOVING_HILL_ROUTE
    || candidate.effectiveRoute !== MOVING_HILL_ROUTE
  ) {
    throw new Error(`moving-Hill route identity mismatch: ${JSON.stringify(candidate)}`);
  }
  if (candidate.fallbackRoute !== null) {
    throw new Error(`fallback route rejected: ${candidate.fallbackRoute}`);
  }
  if (
    candidate.deviceMatchesSolver !== true
    || candidate.hostReadbackVisibility !== false
  ) {
    throw new Error(`same-device support authority rejected: ${JSON.stringify(candidate)}`);
  }
  if (
    candidate.frameCount < 12
    || candidate.supportWriteCount < 3
    || candidate.terrainEpoch < 3
  ) {
    throw new Error(`stale moving-Hill epoch evidence rejected: ${JSON.stringify(candidate)}`);
  }
  if (
    candidate.requestedPresentationMode !== MOVING_HILL_PRESENTATION_MODE
    || candidate.effectivePresentationMode !== MOVING_HILL_PRESENTATION_MODE
    || candidate.effectivePresentationRoute !== MOVING_HILL_PRESENTATION_ROUTE
    || candidate.presentationEvidence?.fallbackReason !== null
    || candidate.presentationEvidence?.nonParticleToyDrawCount !== 0
  ) {
    throw new Error(`moving-Hill presentation identity rejected: ${JSON.stringify(candidate)}`);
  }
  if (
    candidate.cameraEvidence?.authority !== 'consumer_external_exact_v0'
    || candidate.cameraEvidence?.identity !== EXTERNAL_CAMERA_IDENTITY
    || !Number.isSafeInteger(candidate.cameraEvidence?.generation)
    || candidate.cameraEvidence?.fallbackReason !== null
  ) {
    throw new Error(`external camera authority rejected: ${JSON.stringify(candidate)}`);
  }
  if (
    candidate.negativeParticleWitness?.cameraIdentity !== EXTERNAL_CAMERA_IDENTITY
    || !Number.isSafeInteger(candidate.negativeParticleWitness?.cameraGeneration)
    || candidate.negativeParticleWitness?.presentationRoute !== MOVING_HILL_PRESENTATION_ROUTE
    || candidate.negativeParticleWitness?.particleVisibility !== 'hidden'
    || candidate.negativeParticleWitness?.particleDrawCount !== 0
    || candidate.negativeParticleWitness?.nonParticleToyDrawCount !== 0
  ) {
    throw new Error(`particle attribution witness rejected: ${JSON.stringify(candidate)}`);
  }
  if (
    candidate.blank
    || candidate.partial
    || candidate.primaryOutputWritten !== true
  ) {
    throw new Error(`blank or partial state rejected: ${JSON.stringify(candidate)}`);
  }
}

async function main() {
  if (!requestedUrl) throw new Error('--url is required');
  const requestedUrlObject = new URL(requestedUrl);
  if (
    requestedUrlObject.pathname !== '/finger-fluid-moving-hill-support-witness.html'
    || !/^[0-9a-f]{40}$/.test(requestedUrlObject.searchParams.get('composed_revision') || '')
  ) {
    throw new Error(`witness URL is stale, defaulted, or lacks exact source identity: ${requestedUrl}`);
  }
  preserveEvidence('validate-config', {
    requestedUrl,
    viewport: { width: viewportWidth, height: viewportHeight },
  });

  phase = 'bind-served-source';
  servedSourceIdentity = await bindServedSourceIdentity(requestedUrlObject);
  preserveEvidence('bind-served-source', servedSourceIdentity);

  phase = 'launch-browser';
  chromeProcess = spawn(chrome, [
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
  await waitForBrowserLaunch(chromeProcess);

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
    state = await evaluate(socket, 'window.kaminosMovingHillSupportWitnessState ?? null');
    if (state?.status === 'error') {
      throw new Error(`moving-Hill witness failed before primary output: ${JSON.stringify(state)}`);
    }
    if (
      state?.status === 'running'
      && state.frameCount >= 12
      && state.supportWriteCount >= 3
    ) {
      break;
    }
    await delay(100);
  }
  effectiveUrl = await evaluate(socket, 'window.location.href');
  if (effectiveUrl !== requestedUrl) {
    throw new Error(`effective URL differs from requested URL: ${effectiveUrl} != ${requestedUrl}`);
  }
  validateState(state);
  preserveEvidence('live-moving-support-epochs', state);

  phase = 'capture-primary-output';
  visual = await captureCanvas(socket);
  primaryOutputWritten = true;
  preserveEvidence('captured-primary-output', { state, visual, out });

  phase = 'complete';
  writeReport({ ok: true });
  socket.close();
}

main()
  .catch(error => {
    writeReport({
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
    process.exitCode = 1;
  })
  .finally(() => {
    if (chromeProcess?.pid && !chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
    }
  });
