import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.held-smoke-assay-witness.v0';
const COCKPIT_SCHEMA = 'kaminos.held-smoke-assay-cockpit.v0';
const AB_ROUTE = 'webgpu-held-smoke-assay-v0';
const D_ROUTE = 'kaminos.volume.held-field-viewer.v0';
const D_COMPOSITION = 'smoke-raymarch-under-splats-v0';
const DENSE_D_COMPOSITION = 'smoke-raymarch-only-v0';
const DENSE_COMPARISON_PROFILE = 'dense-splat-competence-v0';
const args = parseArgs(process.argv.slice(2));
const requestedUrl = requireIdentity(args.get('--url'), '--url');
const url = new URL(requestedUrl);
const competenceMode = url.searchParams.get('comparison') === 'competence';
const expectedDComposition = competenceMode ? DENSE_D_COMPOSITION : D_COMPOSITION;
const expectedDComparisonProfile = competenceMode ? DENSE_COMPARISON_PROFILE : null;
const requestedRoute = competenceMode ? 'held-smoke-u-b-d-competence-cockpit-v0' : 'held-smoke-a-b-c-d-cockpit-v0';
const expectedManifestSha256 = requireSha256(url.searchParams.get('manifest_sha256'), 'manifest_sha256');
const expectedAssayManifestSha256 = requireSha256(url.searchParams.get('assay_manifest_sha256'), 'assay_manifest_sha256');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-held-smoke-assay-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
const settleMs = requireNonNegative(args.get('--settle-ms') || 1800, '--settle-ms');
const loadTimeoutMs = requirePositiveNumber(args.get('--load-timeout-ms') || 180000, '--load-timeout-ms');
const chromePort = requirePositiveInteger(args.get('--chrome-port') || 19417, '--chrome-port');
const chromePath = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1600,1000');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(join(tmpdir(), 'kaminos-held-smoke-assay-chrome-'))));

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
  failurePhase = 'wait-complete-child-routes';
  const initialState = await waitForLiveState(loadTimeoutMs);
  validateState(initialState);
  lastTrustworthyEvidence.initialState = initialState;
  await delay(settleMs);

  failurePhase = 'capture-cockpit';
  const finalState = await runtimeState();
  validateState(finalState);
  const screenshot = await wsRequest('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(screenshot.data, 'base64');
  const imagePath = join(outDir, competenceMode ? 'held-smoke-competence.png' : 'held-smoke-assay.png');
  writeFileSync(imagePath, bytes);
  const pixels = inspectPng(bytes);
  assert.ok(pixels.nonUniformPixelCount > Math.max(256, pixels.pixelCount * 0.01), 'blank or uniform cockpit capture');
  assert.ok(pixels.luminanceStdDev > 4, 'blank cockpit capture has insufficient visual variation');
  const panelEvidence = pixels.panelEvidence;
  lastTrustworthyEvidence.panelEvidence = panelEvidence;
  assert.equal(runtimeExceptionCount, 0, 'browser runtime exceptions were observed');
  const report = {
    schema: SCHEMA,
    status: 'passed',
    failurePhase: null,
    startedAt,
    completedAt: new Date().toISOString(),
    requestedUrl,
    requestedRoute,
    effectiveRoute: requestedRoute,
    source: finalState.source,
    children: finalState.children,
    browser: {
      identity: 'kaminos-held-smoke-assay-single-cdp-browser-v0',
      mode: browser.mode,
      chromePath,
      chromePort,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    },
    captureConfig: { settleMs, loadTimeoutMs, noHiddenFrameCap: true },
    runtime: { initial: initialState, final: finalState, runtimeExceptionCount },
    frame: {
      path: relative(dirname(reportPath), imagePath),
      byteLength: bytes.byteLength,
      sha256: hash(bytes),
      width: pixels.width,
      height: pixels.height,
      luminanceMean: pixels.luminanceMean,
      luminanceStdDev: pixels.luminanceStdDev,
      nonUniformPixelCount: pixels.nonUniformPixelCount,
      panelEvidence,
    },
    falseClosureChecks: {
      rejectsWrongOrFallbackChildRoute: true,
      rejectsUnregisteredOrSubstitutedMount: true,
      rejectsWrongEffectiveSourceDigest: true,
      rejectsPartialChildLoading: true,
      rejectsMissingOrBlankOutput: true,
      rejectsChecksumValidButSmokeEmptyImport: true,
      rejectsImportedFluidBindingDrift: true,
      rejectsSceneOnlyPixelsWithoutShaderSmokeAuthority: true,
      preservesFailurePhaseBeforePrimaryOutput: true,
    },
    claimBoundary: competenceMode
      ? 'dense-splat-competence-floor-v0: static same-source U dense lift versus B learned selector and D raymarch. This tests the splat representation ceiling before sparsification; it does not prove neural temporal smoke decode.'
      : 'Static same-source representation comparison. A/B are smoke-only splat products; D is raymarched smoke under splat flame. C remains open. This does not prove neural temporal smoke decode.',
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
    effectiveRoute: null,
    runtimeExceptionCount,
    error: error?.message || String(error),
    browser: browser ? {
      identity: 'kaminos-held-smoke-assay-single-cdp-browser-v0',
      mode: browser.mode,
      chromePath,
      chromePort,
      userDataDir,
      keepBrowserOpen,
      windowSize,
    } : null,
    captureConfig: { settleMs, loadTimeoutMs, noHiddenFrameCap: true },
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

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be an explicit sha256 digest`);
  return value.toLowerCase();
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
    const page = pages.find(item => item.type === 'page' && item.url.includes('held-basin-smoke-assay.html'))
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
    const documentState = await evaluate(`({ href: location.href, readyState: document.readyState })`).catch(() => null);
    if (documentState?.href === requestedUrl && documentState.readyState !== 'loading') return documentState;
    await delay(100);
  }
  throw new Error('requested cockpit did not complete navigation within requested timeout');
}

async function runtimeState() {
  return evaluate(`window.__kaminosHeldSmokeAssay?.debugState?.() || null`);
}

async function waitForLiveState(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await runtimeState().catch(() => null);
    if (latest) lastTrustworthyEvidence.latestRuntime = latest;
    if (latest?.status === 'failed') throw new Error(`cockpit failed: ${latest.failurePhase}: ${latest.error}`);
    if (latest?.status === 'running') return latest;
    await delay(100);
  }
  throw new Error(`cockpit or child routes remained partial after requested timeout: ${JSON.stringify(latest)}`);
}

function validateState(state) {
  assert.ok(state, 'missing live cockpit state');
  assert.equal(state.schema, COCKPIT_SCHEMA);
  assert.equal(state.status, 'running');
  assert.equal(state.failurePhase, null);
  assert.equal(state.error, null);
  assert.equal(state.comparisonMode, competenceMode ? 'competence' : 'assay');
  assert.equal(state.experimentIdentity, competenceMode ? 'dense-splat-competence-floor-v0' : null);
  assert.equal(state.source.mountRegistered, true, 'held source mount was not registered');
  assert.equal(state.source.manifestSha256Requested, expectedManifestSha256);
  assert.equal(state.source.manifestSha256Effective, expectedManifestSha256);
  assert.equal(state.source.assayManifestSha256Requested, expectedAssayManifestSha256);
  assert.equal(state.source.assayManifestSha256Effective, expectedAssayManifestSha256);
  assert.equal(
    state.source.comparisonAuthority,
    competenceMode ? 'dense-competence-independent-viewports-v0' : 'same-source-camera-independent-viewports-v0',
  );
  assert.equal(state.children.a.status, 'running', 'A child route is partial');
  assert.equal(state.children.a.requestedRoute, AB_ROUTE);
  assert.equal(state.children.a.effectiveRoute, AB_ROUTE);
  assert.equal(state.children.a.requestedProductIndex, 0);
  assert.equal(state.children.a.effectiveProductIndex, 0);
  assert.ok(state.children.a.frameCount > 0);
  assert.equal(state.children.b.status, 'running', 'B child route is partial');
  assert.equal(state.children.b.requestedRoute, AB_ROUTE);
  assert.equal(state.children.b.effectiveRoute, AB_ROUTE);
  assert.equal(state.children.b.requestedProductIndex, 1);
  assert.equal(state.children.b.effectiveProductIndex, 1);
  assert.ok(state.children.b.frameCount > 0);
  assert.equal(state.children.d.status, 'running', 'D child route is partial');
  assert.equal(state.children.d.requestedRoute, D_ROUTE);
  assert.match(state.children.d.effectiveRoute || '', /^native-3d-compute-fluid-raymarch-v0$/);
  assert.equal(state.children.d.compositionRequested, expectedDComposition);
  assert.equal(state.children.d.compositionEffective, expectedDComposition);
  assert.equal(state.children.d.comparisonProfileRequested, expectedDComparisonProfile);
  assert.equal(state.children.d.comparisonProfileEffective, expectedDComparisonProfile);
  assert.equal(state.children.d.manifestSha256Effective, expectedManifestSha256);
  const smokeDensity = state.children.d.fluidChannelStatistics?.smokeDensity;
  assert.ok(smokeDensity, 'D omitted checksum-verified fluid channel statistics');
  assert.ok(smokeDensity.sampleCount > 0, 'D imported no fluid cells');
  assert.ok(smokeDensity.nonZeroCount > 0, 'D imported a blank smoke density channel');
  assert.ok(smokeDensity.max > 0, 'D imported smoke has no positive density');
  assert.match(state.source.fluidSha256Requested || '', /^[a-f0-9]{64}$/);
  assert.equal(
    state.children.d.renderBindingIdentity?.fluidSha256,
    state.source.fluidSha256Requested,
    'D raymarch did not consume the checksum-bound imported fluid buffer',
  );
  assert.ok(
    state.children.d.renderTargetPixelEvidence?.nonBackgroundPixelCount > 0,
    'D submitted render target contains only the clear color',
  );
  assert.ok(
    state.children.d.featureCaptureSmokeAuthority?.nonZeroCount > 0,
    'D scene pixels carry no shader-sampled smoke authority',
  );
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
  const dProbe = {
    x0: Math.floor(width * 0.72), x1: Math.ceil(width * 0.96),
    y0: Math.floor(height * 0.27), y1: Math.ceil(height * 0.42),
    edgeSum: 0, edgeCount: 0, luminanceSum: 0, luminanceSquared: 0, pixelCount: 0,
  };
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
      if (x >= dProbe.x0 && x < dProbe.x1 && y >= dProbe.y0 && y < dProbe.y1) {
        dProbe.luminanceSum += luminance;
        dProbe.luminanceSquared += luminance * luminance;
        dProbe.pixelCount += 1;
        if (x > dProbe.x0 && y > dProbe.y0) {
          const leftPixel = (x - 1) * channels;
          const leftLuminance = current[leftPixel] * 0.2126 + current[leftPixel + 1] * 0.7152 + current[leftPixel + 2] * 0.0722;
          const upLuminance = previous[pixel] * 0.2126 + previous[pixel + 1] * 0.7152 + previous[pixel + 2] * 0.0722;
          dProbe.edgeSum += (Math.abs(luminance - leftLuminance) + Math.abs(luminance - upLuminance)) * 0.5;
          dProbe.edgeCount += 1;
        }
      }
    }
    current.copy(previous);
  }
  const pixelCount = width * height;
  const luminanceMean = luminanceSum / pixelCount;
  const variance = Math.max(0, luminanceSquared / pixelCount - luminanceMean * luminanceMean);
  const dMean = dProbe.luminanceSum / Math.max(1, dProbe.pixelCount);
  const dVariance = Math.max(0, dProbe.luminanceSquared / Math.max(1, dProbe.pixelCount) - dMean * dMean);
  return {
    width, height, pixelCount, nonUniformPixelCount, luminanceMean, luminanceStdDev: Math.sqrt(variance),
    panelEvidence: {
      dSmokeProbe: {
        bounds: [dProbe.x0, dProbe.y0, dProbe.x1, dProbe.y1],
        pixelCount: dProbe.pixelCount,
        luminanceMean: dMean,
        luminanceStdDev: Math.sqrt(dVariance),
        edgeMean: dProbe.edgeSum / Math.max(1, dProbe.edgeCount),
      },
    },
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
