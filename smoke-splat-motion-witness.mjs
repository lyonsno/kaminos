import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import {
  SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY,
} from './smoke-splat-motion-source.mjs';

const SCHEMA = 'kaminos.smoke-splat-motion-witness.v0';
const ROUTE_IDENTITY = 'webgpu-real-field-hierarchical-smoke-motion-v0';
const TEMPORAL_AUTHORITY = 'velocity-carried-short-horizon-extrapolation-v0';
const args = parseArgs(process.argv.slice(2));
const requestedUrl = requireIdentity(args.get('--url'), '--url');
const requestedRoute = new URL(requestedUrl).searchParams.get('route') || ROUTE_IDENTITY;
const requestedFootprintAuthority = new URL(requestedUrl).searchParams.get('footprint')
  || SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY;
const requestedCoarseCoverageScale = requirePositiveNumber(
  new URL(requestedUrl).searchParams.get('coarse_coverage') || 1,
  'coarse_coverage',
);
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-smoke-splat-motion-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
const frameCount = requirePositiveInteger(args.get('--frames') || 8, '--frames');
const stepMs = requireNonNegative(args.get('--step-ms') || 400, '--step-ms');
const settleMs = requireNonNegative(args.get('--settle-ms') || 1600, '--settle-ms');
const loadTimeoutMs = requirePositiveNumber(args.get('--load-timeout-ms') || 120000, '--load-timeout-ms');
const chromePort = requirePositiveInteger(args.get('--chrome-port') || 19416, '--chrome-port');
const chromePath = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1280,960');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(join(tmpdir(), 'kaminos-smoke-motion-chrome-'))));

mkdirSync(outDir, { recursive: true });
const startedAt = new Date().toISOString();
const lastTrustworthyEvidence = {};
let failurePhase = 'initializing';
let browser = null;
let socket = null;
let runtimeExceptionCount = 0;

try {
  failurePhase = 'launch-browser';
  browser = await launchBrowser();
  failurePhase = 'connect-cdp';
  await waitForCdp(loadTimeoutMs);
  const page = await findPage(loadTimeoutMs);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(socket);
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') runtimeExceptionCount += 1;
  });
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');
  failurePhase = 'navigate-route';
  await wsRequest('Page.navigate', { url: requestedUrl });
  await waitForDocument(loadTimeoutMs);
  failurePhase = 'wait-live-route';
  const initialState = await waitForLiveState(loadTimeoutMs);
  validateState(initialState);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  await delay(settleMs);

  failurePhase = 'capture-motion';
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    if (index > 0) await delay(stepMs);
    const state = await runtimeState();
    validateState(state);
    const screenshot = await wsRequest('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const bytes = Buffer.from(screenshot.data, 'base64');
    const imagePath = join(outDir, `frame-${String(index).padStart(3, '0')}.png`);
    writeFileSync(imagePath, bytes);
    const pixels = inspectPng(bytes);
    assert.ok(pixels.nonUniformPixelCount > Math.max(128, pixels.pixelCount * 0.002), 'blank or uniform smoke capture');
    frames.push({
      index,
      capturedAt: new Date().toISOString(),
      image: {
        path: imagePath,
        byteLength: bytes.length,
        sha256: hash(bytes),
        width: pixels.width,
        height: pixels.height,
        luminanceMean: pixels.luminanceMean,
        luminanceStdDev: pixels.luminanceStdDev,
        nonUniformPixelCount: pixels.nonUniformPixelCount,
      },
      frameDigest: hash(bytes),
      runtime: compactState(state),
    });
    lastTrustworthyEvidence.latestFrame = frames.at(-1);
  }

  failurePhase = 'validate-motion';
  const uniqueFrameDigests = new Set(frames.map(frame => frame.frameDigest));
  const runtimeFrameCounts = frames.map(frame => frame.runtime.frameCount);
  assert.ok(uniqueFrameDigests.size >= 2, 'frameDigest sequence is static or cached');
  assert.ok(runtimeFrameCounts.at(-1) > runtimeFrameCounts[0], 'runtime frame count did not advance');
  assert.equal(runtimeExceptionCount, 0, 'browser runtime exceptions were observed');
  const initialCompact = compactState(initialState);
  const finalCompact = frames.at(-1).runtime;
  const report = {
    schema: SCHEMA,
    status: 'passed',
    failurePhase: null,
    startedAt,
    completedAt: new Date().toISOString(),
    requestedUrl,
    requestedRoute,
    effectiveRoute: finalCompact.effectiveRoute,
    fallbackReason: finalCompact.fallbackReason,
    backend: finalCompact.backend,
    temporalAuthority: finalCompact.temporalAuthority,
    requestedFootprintAuthority,
    effectiveFootprintAuthority: finalCompact.effectiveFootprintAuthority,
    requestedCoarseCoverageScale,
    effectiveCoarseCoverageScale: finalCompact.effectiveCoarseCoverageScale,
    browser: {
      identity: 'kaminos-smoke-motion-single-cdp-browser-v0',
      mode: browser.mode,
      chromePath,
      chromePort,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    },
    captureConfig: {
      frameCount,
      stepMs,
      settleMs,
      loadTimeoutMs,
      noHiddenFrameCap: true,
    },
    source: {
      products: finalCompact.products,
      drawPlan: finalCompact.drawPlan,
    },
    runtime: {
      initial: initialCompact,
      final: finalCompact,
      frameCountDelta: finalCompact.frameCount - initialCompact.frameCount,
      runtimeExceptionCount,
    },
    motionEvidence: {
      frameDigestAuthority: 'sha256-of-live-cdp-page-capture-v0',
      uniqueFrameDigestCount: uniqueFrameDigests.size,
      frameDigests: frames.map(frame => frame.frameDigest),
      runtimeFrameCounts,
      staticOrCached: false,
    },
    frames,
    falseClosureChecks: {
      rejectsWrongOrFallbackRoute: true,
      rejectsWrongFootprintAuthority: true,
      rejectsWrongCoarseCoverageScale: true,
      rejectsMissingPartialOrBlankOutput: true,
      rejectsStaticOrCachedFrames: true,
      rejectsTruncatedOrMassLosingProducts: true,
      preservesFailurePhaseBeforePrimaryOutput: true,
    },
    claimBoundary: 'Standalone WebGPU smoke representation and raster motion evidence. This does not prove final flame-smoke depth composition or live recurrent smoke decode.',
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const failed = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    startedAt,
    failedAt: new Date().toISOString(),
    requestedUrl,
    requestedRoute,
    requestedFootprintAuthority,
    effectiveFootprintAuthority: null,
    requestedCoarseCoverageScale,
    effectiveCoarseCoverageScale: null,
    effectiveRoute: null,
    fallbackReason: null,
    runtimeExceptionCount,
    error: error?.stack || error?.message || String(error),
    browser: browser ? {
      identity: 'kaminos-smoke-motion-single-cdp-browser-v0',
      mode: browser.mode,
      chromePath,
      chromePort,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    } : null,
    captureConfig: { frameCount, stepMs, settleMs, loadTimeoutMs, noHiddenFrameCap: true },
    lastTrustworthyEvidence,
  };
  writeFileSync(reportPath, `${JSON.stringify(failed, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(failed, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  try { socket?.close?.(); } catch {}
  if (!keepBrowserOpen) browser?.process?.kill('SIGTERM');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(item, '1');
    else {
      values.set(item, next);
      index += 1;
    }
  }
  return values;
}

function requireIdentity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function requirePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

function requireNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function defaultChromePath() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(existsSync) || 'google-chrome';
}

async function launchBrowser() {
  try {
    await cdpFetch('/json/version');
    return { mode: 'connected-existing', process: null };
  } catch {}
  const process = spawn(chromePath, [
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    requestedUrl,
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) process.unref();
  return { mode: keepBrowserOpen ? 'launched-kept-open' : 'launched-owned', process };
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${chromePort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { return await cdpFetch('/json/version'); }
    catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`CDP endpoint did not open within requested timeout: ${lastError?.message || 'unknown'}`);
}

async function findPage(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(item => item.type === 'page' && item.url.includes('smoke-splat-motion.html'))
      || pages.find(item => item.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(100);
  }
  throw new Error('no CDP page target appeared within requested timeout');
}

function waitForWebSocketOpen(target) {
  return new Promise((resolveOpen, rejectOpen) => {
    target.addEventListener('open', resolveOpen, { once: true });
    target.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function wsRequest(method, params = {}) {
  const id = socket._nextRequestId = (socket._nextRequestId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const cleanup = () => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    };
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    const onClose = () => { cleanup(); rejectRequest(new Error(`${method}: CDP socket closed`)); };
    const onError = () => { cleanup(); rejectRequest(new Error(`${method}: CDP socket error`)); };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await wsRequest('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text || 'unknown'}`);
  return response.result.value;
}

async function waitForDocument(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await evaluate(`({ href: location.href, readyState: document.readyState })`).catch(() => null);
    if (status?.href === requestedUrl && status.readyState !== 'loading') return status;
    await delay(100);
  }
  throw new Error('requested page did not complete navigation within requested timeout');
}

async function runtimeState() {
  return evaluate(`JSON.parse(JSON.stringify(window.__kaminosSmokeSplatMotion || null))`);
}

async function waitForLiveState(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await runtimeState().catch(() => null);
    if (latest?.status === 'failed') throw new Error(`smoke motion route failed: ${latest.error}`);
    if (latest?.status === 'running' && latest.frameCount >= 2) return latest;
    await delay(100);
  }
  throw new Error(`smoke motion route did not become live: ${JSON.stringify(latest)}`);
}

function validateState(state) {
  assert.ok(state, 'missing live smoke motion runtime state');
  assert.equal(state.status, 'running');
  assert.equal(state.requestedRoute, requestedRoute);
  assert.equal(state.effectiveRoute, ROUTE_IDENTITY);
  assert.equal(state.fallbackReason, null);
  assert.match(state.backend || '', /^WebGPU:/);
  assert.equal(state.temporalAuthority, TEMPORAL_AUTHORITY);
  assert.equal(state.requestedFootprintAuthority, requestedFootprintAuthority);
  assert.equal(state.effectiveFootprintAuthority, requestedFootprintAuthority);
  assert.equal(state.requestedCoarseCoverageScale, requestedCoarseCoverageScale);
  assert.equal(state.effectiveCoarseCoverageScale, requestedCoarseCoverageScale);
  assert.equal(state.products?.length, 2);
  assert.equal(state.products.some(product => product.producerKind === 'learned-heldout-residual-selector'), true);
  assert.equal(state.products.every(product => product.rejectedExtinctionMass === 0), true);
  assert.equal(state.drawPlan?.uniqueProductCount, 2);
  assert.equal(state.drawPlan?.coarseSplatsAlwaysPresent, true);
  assert.equal(state.drawPlan?.rejectedExtinctionMass, 0);
  assert.equal(state.drawPlan?.instanceBindings?.length, state.instanceCount);
  assert.ok(state.drawPlan?.drawInstanceCount > 0);
}

function compactState(state) {
  return {
    schema: state.schema,
    status: state.status,
    requestedRoute: state.requestedRoute,
    effectiveRoute: state.effectiveRoute,
    fallbackReason: state.fallbackReason,
    backend: state.backend,
    temporalAuthority: state.temporalAuthority,
    requestedFootprintAuthority: state.requestedFootprintAuthority,
    effectiveFootprintAuthority: state.effectiveFootprintAuthority,
    requestedCoarseCoverageScale: state.requestedCoarseCoverageScale,
    effectiveCoarseCoverageScale: state.effectiveCoarseCoverageScale,
    manifestPath: state.manifestPath,
    instanceCount: state.instanceCount,
    fineLodFraction: state.fineLodFraction,
    motionRate: state.motionRate,
    frameCount: state.frameCount,
    elapsedMs: state.elapsedMs,
    products: state.products,
    drawPlan: state.drawPlan,
    timing: state.timing ? {
      authority: state.timing.authority,
      sampleCount: state.timing.frameIntervalsMs.length,
      p50Ms: state.timing.p50Ms,
      p95Ms: state.timing.p95Ms,
    } : null,
    error: state.error,
  };
}

function inspectPng(bytes) {
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, 'capture is not a PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  assert.equal(bitDepth, 8, 'only 8-bit PNG captures are supported');
  assert.ok(colorType === 2 || colorType === 6, `unsupported PNG color type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const chunks = [];
  let cursor = 8;
  while (cursor < bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(cursor + 8, cursor + 8 + length));
    cursor += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let offset = 0;
  let luminanceSum = 0;
  let luminanceSquared = 0;
  let nonUniformPixelCount = 0;
  let firstLuminance = null;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset++];
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[offset++];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      current[x] = (encoded + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = x * channels;
      const luminance = current[pixel] * 0.2126 + current[pixel + 1] * 0.7152 + current[pixel + 2] * 0.0722;
      if (firstLuminance === null) firstLuminance = luminance;
      if (Math.abs(luminance - firstLuminance) > 2) nonUniformPixelCount += 1;
      luminanceSum += luminance;
      luminanceSquared += luminance * luminance;
    }
    current.copy(previous);
  }
  const pixelCount = width * height;
  const luminanceMean = luminanceSum / pixelCount;
  const variance = Math.max(0, luminanceSquared / pixelCount - luminanceMean * luminanceMean);
  return {
    width,
    height,
    pixelCount,
    nonUniformPixelCount,
    luminanceMean,
    luminanceStdDev: Math.sqrt(variance),
  };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
