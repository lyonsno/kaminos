#!/usr/bin/env node

import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const EXPECTED = Object.freeze({
  mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
  policyId: 'firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17',
  revision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
  engineSourceCommit: 'ef85ee89e63fe2276c951e7c401cd719d62bf3ce',
  engineSha256: 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab',
  splatMode: 'kernel_moment_covariance',
});

export function validatePromotedFireWitnessState(state) {
  if (state?.status !== 'recording') throw new Error(`preview status mismatch: ${state?.status || 'missing'}`);
  if (state.engineIdentity?.sourceCommit !== EXPECTED.engineSourceCommit
    || state.engineIdentity?.effectiveSha256 !== EXPECTED.engineSha256) {
    throw new Error('promoted fire engine identity mismatch');
  }
  if (state.loaded?.mount?.mountId !== EXPECTED.mountId) throw new Error('promoted fire mount identity mismatch');
  if (state.loaded?.mount?.policy?.policyId !== EXPECTED.policyId) throw new Error('promoted fire policy identity mismatch');
  if (state.loaded?.mount?.basin?.revision !== EXPECTED.revision) throw new Error('promoted fire basin revision mismatch');
  if (state.inferenceRan !== false) throw new Error('promoted fire preview unexpectedly ran inference');
  if (state.routeRef !== null) throw new Error('promoted fire preview unexpectedly carried a route');
  if (state.engineState?.active !== true) throw new Error('promoted fire engine is not active');
  if (!(state.engineState.frameCount > 0) || !(state.engineState.simStepCount > 0)) {
    throw new Error('promoted fire preview did not advance a rendered simulation frame');
  }
  if (state.engineState.boundarySplatMode !== EXPECTED.splatMode) {
    throw new Error(`promoted fire splat mode mismatch: ${state.engineState.boundarySplatMode}`);
  }
  if (state.engineState.boundarySplatFallbackReason || state.engineState.error) {
    throw new Error(`promoted fire fallback: ${state.engineState.boundarySplatFallbackReason || state.engineState.error}`);
  }
  if (state.engineState.raymarchSmokePresentationModeEffective !== 'on') {
    throw new Error('promoted fire smoke presentation is not effective');
  }
  if (!(state.pixelWitness?.width > 0) || !(state.pixelWitness?.height > 0)
    || !(state.pixelWitness.changedPixels > 0) || !(state.pixelWitness.litPixels > 0)) {
    throw new Error('promoted fire canvas is blank');
  }
  return state;
}

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) result.set(argv[index], argv[index + 1]);
  return result;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed: ${response.status}`);
  return response.json();
}

async function waitForCdp(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await cdpJson(port, '/json/version');
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await cdpJson(port, '/json/list');
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) return page;
    await delay(100);
  }
  throw new Error('No debuggable Kaminos page target');
}

function openWebSocket(url) {
  const ws = new WebSocket(url);
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', () => resolveOpen(ws), { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function cdpRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 45000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdpRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

async function waitForPreviewApi(ws) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const available = await evaluate(ws, `Boolean(window.kaminosPromotedFireActorPreview?.begin)`);
    if (available) return;
    await delay(125);
  }
  throw new Error('Promoted fire preview API did not mount');
}

async function waitForPromotedFireFrame(ws, waitMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const state = await evaluate(ws, `window.kaminosPromotedFireActorPreview.engineState()`);
    if (state?.error) throw new Error(`Promoted fire renderer failed before first frame: ${state.error}`);
    if (state?.frameCount > 0 && state?.simStepCount > 0) return state;
    await delay(250);
  }
  throw new Error(`Promoted fire did not produce its first frame within caller wait ${waitMs} ms`);
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function decodeScreenshotPng(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error('CDP screenshot is not PNG');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!(width > 0) || !(height > 0) || bitDepth !== 8 || channels === 0) {
    throw new Error(`unsupported screenshot PNG: ${width}x${height}, depth ${bitDepth}, color ${colorType}`);
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const filter = packed[sourceOffset];
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[sourceOffset + x + 1];
      const targetOffset = y * stride + x;
      const left = x >= channels ? pixels[targetOffset - channels] : 0;
      const up = y > 0 ? pixels[targetOffset - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[targetOffset - stride - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upLeft)
                : null;
      if (predictor === null) throw new Error(`unsupported screenshot PNG filter ${filter}`);
      pixels[targetOffset] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function screenshotPixelWitness(png, canvasBounds, viewport) {
  const decoded = decodeScreenshotPng(png);
  const scaleX = decoded.width / Math.max(1, viewport.width);
  const scaleY = decoded.height / Math.max(1, viewport.height);
  const x0 = Math.max(0, Math.floor(canvasBounds.left * scaleX));
  const y0 = Math.max(0, Math.floor(canvasBounds.top * scaleY));
  const x1 = Math.min(decoded.width, Math.ceil(canvasBounds.right * scaleX));
  const y1 = Math.min(decoded.height, Math.ceil(canvasBounds.bottom * scaleY));
  const sampleOffset = (y0 * decoded.width + x0) * decoded.channels;
  const base = [decoded.pixels[sampleOffset], decoded.pixels[sampleOffset + 1], decoded.pixels[sampleOffset + 2]];
  let changedPixels = 0;
  let litPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const r = decoded.pixels[offset], g = decoded.pixels[offset + 1], b = decoded.pixels[offset + 2];
      if (Math.abs(r - base[0]) + Math.abs(g - base[1]) + Math.abs(b - base[2]) > 8) changedPixels += 1;
      if (r + g + b > 24) litPixels += 1;
    }
  }
  return { width: x1 - x0, height: y1 - y0, changedPixels, litPixels };
}

const browserProjection = `(() => {
  const runtime = window.kaminosPromotedFireActorPreview.state();
  const engineState = window.kaminosPromotedFireActorPreview.engineState();
  const canvas = document.getElementById('kaminos-promoted-fire-canvas');
  const bounds = canvas?.getBoundingClientRect?.();
  return {
    status: runtime?.status,
    engineIdentity: runtime?.engineIdentity,
    loaded: runtime?.loaded ? {
      status: runtime.loaded.status,
      mount: {
        mountId: runtime.loaded.mount?.mountId,
        policy: { policyId: runtime.loaded.mount?.policy?.policyId },
        basin: {
          handle: runtime.loaded.mount?.basin?.handle,
          revision: runtime.loaded.mount?.basin?.revision,
          stableRef: runtime.loaded.mount?.basin?.stableRef,
        },
        representation: runtime.loaded.mount?.representation,
      },
      packageSha256: runtime.loaded.packageSha256,
      resources: runtime.loaded.resources,
    } : null,
    inferenceRan: runtime?.inferenceRan,
    routeRef: runtime?.routeRef,
    engineState: {
      active: engineState?.active,
      frameCount: engineState?.frameCount,
      simStepCount: engineState?.simStepCount,
      boundarySplatMode: engineState?.boundarySplatMode,
      boundarySplatRendererIdentity: engineState?.boundarySplatRendererIdentity,
      boundarySplatFallbackReason: engineState?.boundarySplatFallbackReason,
      raymarchSmokePresentationModeEffective: engineState?.raymarchSmokePresentationModeEffective,
      timing: engineState?.timing,
      gpuProfile: engineState?.boundarySplatGpuProfile,
      error: engineState?.error,
    },
    canvasBounds: bounds ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pixelWitness: null,
  };
})()`;

const completionProjection = `window.endPromotedKilnFirePreview().then(runtime => ({
  status: runtime?.status,
  actorEpisode: runtime?.actorEpisode,
  rendererEpisode: runtime?.rendererEpisode,
  runtimeReceipt: runtime?.runtimeReceipt,
  completedAt: runtime?.completedAt,
}))`;

export async function runPromotedFireWitness(options = {}) {
  const url = options.url || 'http://127.0.0.1:18400/';
  const requestedOutputPath = options.outputPath || 'artifacts/kiln-promoted-fire-preview/live/promoted-fire.png';
  const outputPath = resolve(requestedOutputPath);
  const reportPath = resolve(options.reportPath || 'artifacts/kiln-promoted-fire-preview/live/report.json');
  const settleMs = Number(options.settleMs || 6000);
  const frameWaitMs = Number(options.frameWaitMs || 60000);
  const port = Number(options.debugPort || randomInt(42000, 62000));
  const chrome = options.chrome || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const userDataDir = options.userDataDir || `/tmp/kaminos-promoted-fire-${port}-${process.pid}`;
  let phase = 'launch';
  let browser = null;
  let ws = null;
  let primaryOutputWritten = false;
  let previewState = null;
  let completionState = null;
  let failure = null;

  const writeReport = () => {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({
      schema: 'kaminos.kiln.promoted-fire-witness.v1',
      ok: failure === null && primaryOutputWritten && completionState?.status === 'completed',
      requestedRoute: url,
      effectiveRoute: previewState?.loaded?.resources?.mountUrl ? url : null,
      requested: EXPECTED,
      settleMs,
      frameWaitMs,
      phase,
      failure,
      primaryOutputWritten,
      screenshotPath: primaryOutputWritten ? requestedOutputPath : null,
      previewState,
      completionState,
    }, null, 2));
  };

  try {
    browser = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1440,1000',
      url,
    ], { stdio: 'ignore' });
    await waitForCdp(port);
    const page = await waitForPage(port);
    ws = await openWebSocket(page.webSocketDebuggerUrl);
    await cdpRequest(ws, 'Runtime.enable');
    await cdpRequest(ws, 'Page.enable');
    phase = 'preview-api';
    await waitForPreviewApi(ws);
    await evaluate(ws, `document.querySelector('[data-tab="generate"]')?.click()`);
    phase = 'preview-begin';
    await evaluate(ws, `window.kaminosPromotedFireActorPreview.begin()`);
    await waitForPromotedFireFrame(ws, frameWaitMs);
    await delay(settleMs);
    phase = 'preview-validation';
    previewState = await evaluate(ws, browserProjection);
    phase = 'screenshot';
    const screenshot = await cdpRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    if (!screenshot?.data) throw new Error('CDP screenshot was empty');
    const screenshotPng = Buffer.from(screenshot.data, 'base64');
    previewState.pixelWitness = screenshotPixelWitness(
      screenshotPng,
      previewState.canvasBounds,
      previewState.viewport,
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, screenshotPng);
    primaryOutputWritten = true;
    validatePromotedFireWitnessState(previewState);
    phase = 'episode-completion';
    completionState = await evaluate(ws, completionProjection);
    if (completionState?.status !== 'completed'
      || completionState.actorEpisode?.status !== 'completed'
      || completionState.runtimeReceipt?.fallbackReason !== null
      || completionState.runtimeReceipt?.inferenceRan !== false
      || completionState.runtimeReceipt?.routeRef !== null) {
      throw new Error('Promoted fire episode completion evidence mismatch');
    }
    phase = 'complete';
    return { reportPath, outputPath, previewState, completionState };
  } catch (error) {
    failure = { phase, error: error.message || String(error) };
    throw error;
  } finally {
    if (ws && previewState?.status === 'recording' && completionState?.status !== 'completed') {
      try {
        completionState = await evaluate(ws, `window.endPromotedKilnFirePreview('failed').then(runtime => ({ status: runtime?.status, failurePhase: runtime?.failurePhase, error: runtime?.error }))`);
      } catch {}
    }
    writeReport();
    ws?.close();
    browser?.kill('SIGTERM');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runPromotedFireWitness({
    url: args.get('--url'),
    outputPath: args.get('--out'),
    reportPath: args.get('--report'),
    settleMs: args.get('--settle-ms'),
    frameWaitMs: args.get('--frame-wait-ms'),
    debugPort: args.get('--debug-port'),
  }).then(result => {
    console.log(JSON.stringify({ ok: true, reportPath: result.reportPath, outputPath: result.outputPath }, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
