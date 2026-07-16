#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const part = process.argv[index];
  if (!part.startsWith('--')) continue;
  const key = part.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, '1');
  }
}

const requestedCompositionId = args.get('composition') || 'promoted-bench-2026-07-15';
const baseUrl = new URL(args.get('url') || 'http://127.0.0.1:8197/');
baseUrl.searchParams.set('composition', requestedCompositionId);
const requestedUrl = baseUrl.toString();
const out = args.get('out') || '/tmp/kaminos-crucible-promoted-bench.png';
const reportPath = args.get('report') || '/tmp/kaminos-crucible-promoted-bench.json';
const chrome = args.get('chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = Number(args.get('cdp-port') || 9364);
const width = Number(args.get('viewport-width') || 1600);
const height = Number(args.get('viewport-height') || 1000);
const loadTimeoutMs = Number(args.get('load-timeout-ms') || 120000);
const expectedObjectIds = ['stone-receiver', 'specimen-tray', 'titan-hammer'];
const startedAt = new Date().toISOString();

let phase = 'starting';
let browser = null;
let socket = null;
let userDataDir = null;
let stderr = '';
let primaryOutputWritten = false;
let lastTrustworthyEvidence = null;
let canvasPixelEvidence = null;
let sidebarPixelEvidence = null;
let cleanupEvidence = null;
let finalStatus = 'failed';
let finalError = null;

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function ensureParent(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(status, extra = {}) {
  ensureParent(reportPath);
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.crucible-composition-witness.v0',
    status,
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedUrl,
    requestedCompositionId,
    effectiveCompositionId: lastTrustworthyEvidence?.effectiveCompositionId || null,
    registeredObjectIds: lastTrustworthyEvidence?.registeredObjectIds || [],
    aoEnabled: lastTrustworthyEvidence?.aoEnabled ?? null,
    screenshot: primaryOutputWritten ? out : null,
    primaryOutputWritten,
    canvasPixelEvidence,
    sidebarPixelEvidence,
    cleanup: cleanupEvidence,
    lastTrustworthyEvidence,
    stderr: stderr.trim().slice(-4000),
    ...extra,
  }, null, 2));
}

async function cdp(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP ${pathname} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await cdp('/json/version');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let sequence = 0;
function wsRequest(ws, method, params = {}, timeoutMs = 30000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result || {});
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression, timeoutMs = 30000) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(`evaluation failed during ${phase}: ${result.exceptionDetails.text || 'exception'}`);
  }
  return result.result?.value;
}

async function waitForComposition(ws) {
  const deadline = Date.now() + loadTimeoutMs;
  while (Date.now() < deadline) {
    const evidence = await evaluate(ws, `window.kaminosCrucibleCompositionDebugState?.() || null`);
    if (evidence) lastTrustworthyEvidence = evidence;
    if (evidence?.status === 'failed') throw new Error(evidence.error || 'composition route failed');
    if (evidence?.status === 'loaded') return evidence;
    await sleep(250);
  }
  throw new Error(`composition did not load within ${loadTimeoutMs} ms`);
}

function assertEffectiveEvidence(evidence) {
  if (evidence.requestedCompositionId !== requestedCompositionId) {
    throw new Error(`requested composition mismatch: ${evidence.requestedCompositionId || 'missing'}`);
  }
  if (evidence.effectiveCompositionId !== requestedCompositionId) {
    throw new Error(`effective composition mismatch: ${evidence.effectiveCompositionId || 'missing'}`);
  }
  if (evidence.aoEnabled !== false) throw new Error('composition did not prove AO disabled');
  if (JSON.stringify(evidence.registeredObjectIds) !== JSON.stringify(expectedObjectIds)) {
    throw new Error(`registered object mismatch: ${JSON.stringify(evidence.registeredObjectIds)}`);
  }
}

async function captureViewport(ws) {
  const result = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const png = Buffer.from(result.data, 'base64');
  if (png.length < 4096) throw new Error('screenshot is too small to be credible evidence');
  ensureParent(out);
  writeFileSync(out, png);
  primaryOutputWritten = true;
  return result.data;
}

async function inspectScreenshotRegion(ws, screenshotBase64, {
  selector,
  reason,
  minQuantizedColors,
  maxDarkFraction,
}) {
  return evaluate(ws, `(async () => {
    const region = document.querySelector(${JSON.stringify(selector)});
    if (!region) return { ok: false, reason: ${JSON.stringify(`${reason}-missing`)} };
    const rect = region.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) return { ok: false, reason: ${JSON.stringify(`${reason}-collapsed`)}, rect: { width: rect.width, height: rect.height } };
    const image = new Image();
    image.src = ${JSON.stringify(`data:image/png;base64,${screenshotBase64}`)};
    await image.decode();
    const scaleX = image.naturalWidth / innerWidth;
    const scaleY = image.naturalHeight / innerHeight;
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(
      image,
      Math.max(0, rect.left * scaleX),
      Math.max(0, rect.top * scaleY),
      Math.max(1, rect.width * scaleX),
      Math.max(1, rect.height * scaleY),
      0,
      0,
      sample.width,
      sample.height,
    );
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const colors = new Set();
    let darkCount = 0;
    let sum = 0;
    let sumSquares = 0;
    let minLuma = 255;
    let maxLuma = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luma < 8) darkCount += 1;
      sum += luma;
      sumSquares += luma * luma;
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      colors.add(String((red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4)));
    }
    const count = pixels.length / 4;
    const meanLuma = sum / count;
    const variance = sumSquares / count - meanLuma * meanLuma;
    return {
      ok: colors.size >= ${minQuantizedColors} && maxLuma - minLuma >= 12 && darkCount / count < ${maxDarkFraction},
      reason: ${JSON.stringify(reason)},
      sampleWidth: sample.width,
      sampleHeight: sample.height,
      quantizedColorCount: colors.size,
      minLuma,
      maxLuma,
      meanLuma,
      variance,
      darkFraction: darkCount / count,
      regionRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  })()`);
}

try {
  if (!Number.isFinite(port) || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(loadTimeoutMs)) {
    throw new Error('numeric witness arguments must be finite');
  }
  userDataDir = mkdtempSync(path.join(tmpdir(), 'kaminos-crucible-composition-'));
  phase = 'launching-browser';
  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu-sandbox',
    '--no-first-run',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  phase = 'opening-cdp';
  await waitForCdp();
  const targets = await cdp('/json/list');
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('no CDP page target found');
  socket = await connectWebSocket(page.webSocketDebuggerUrl);
  await wsRequest(socket, 'Runtime.enable');
  await wsRequest(socket, 'Page.enable');
  await wsRequest(socket, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  phase = 'loading-composition';
  await wsRequest(socket, 'Page.navigate', { url: requestedUrl });
  const evidence = await waitForComposition(socket);
  lastTrustworthyEvidence = evidence;
  assertEffectiveEvidence(evidence);
  await sleep(Number(args.get('settle-ms') || 2500));

  phase = 'capturing-primary-output';
  const screenshotBase64 = await captureViewport(socket);
  phase = 'checking-presentation-pixels';
  canvasPixelEvidence = await inspectScreenshotRegion(socket, screenshotBase64, {
    selector: '#viewport > canvas',
    reason: 'sampled-canvas-screenshot',
    minQuantizedColors: 8,
    maxDarkFraction: 0.98,
  });
  if (!canvasPixelEvidence?.ok) {
    throw new Error(`canvas pixel evidence failed: ${JSON.stringify(canvasPixelEvidence)}`);
  }
  sidebarPixelEvidence = await inspectScreenshotRegion(socket, screenshotBase64, {
    selector: '#sidebar',
    reason: 'sampled-sidebar-screenshot',
    minQuantizedColors: 6,
    maxDarkFraction: 0.65,
  });
  if (!sidebarPixelEvidence?.ok) {
    throw new Error(`sidebar pixel evidence failed: ${JSON.stringify(sidebarPixelEvidence)}`);
  }

  phase = 'composition-verified';
  finalStatus = 'passed';
} catch (error) {
  finalError = error?.stack || String(error);
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (browser && browser.exitCode === null) {
    phase = 'browser-exit';
    browser.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => browser.once('exit', resolve)),
      sleep(5000),
    ]);
  }
  if (userDataDir) {
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (cleanupError) {
      phase = 'cleanup-failed';
      finalStatus = 'failed';
      finalError = `cleanup failed: ${cleanupError?.stack || cleanupError}`;
      cleanupEvidence = { userDataDir, error: finalError };
      process.exitCode = 1;
    }
  }
}

if (finalStatus === 'passed') phase = 'complete';
writeReport(finalStatus, finalError ? { error: finalError } : {});
if (finalStatus === 'passed') {
  console.log(JSON.stringify({
    status: finalStatus,
    requestedCompositionId,
    effectiveCompositionId: lastTrustworthyEvidence.effectiveCompositionId,
    registeredObjectIds: lastTrustworthyEvidence.registeredObjectIds,
    aoEnabled: lastTrustworthyEvidence.aoEnabled,
    screenshot: out,
    report: reportPath,
    canvasPixelEvidence,
    sidebarPixelEvidence,
  }, null, 2));
} else {
  console.error(finalError || 'Crucible composition witness failed');
}
