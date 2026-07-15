#!/usr/bin/env node

import { createHash, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { materializeSmokeOracleTeacherFrameExport } from '../smoke-oracle-teacher-export.mjs';

const DEFAULT_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1';
const DEFAULT_DENSE_CHUNK_BYTES = 256 * 1024;

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

let cdpRequestTimeoutMs = 120000;
let cdpStartupTimeoutMs = 15000;
let cdpProbeTimeoutMs = 1000;

async function cdpFetch(port, path, options = {}, timeoutMs = cdpRequestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`CDP ${path} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCdp(port, { timeoutMs = cdpStartupTimeoutMs, pollMs = 125 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await cdpFetch(port, '/json/version', {}, Math.min(cdpProbeTimeoutMs, Math.max(250, deadline - Date.now())));
    } catch (error) {
      lastError = error;
      await delay(pollMs);
    }
  }
  throw new Error(`Chrome DevTools endpoint did not open on ${port} within ${timeoutMs}ms: ${lastError?.message || 'no response'}`);
}

async function cdpAvailable(port) {
  try {
    await cdpFetch(port, '/json/version', {}, cdpProbeTimeoutMs);
    return true;
  } catch {
    return false;
  }
}

function wsRequest(ws, method, params = {}, timeoutMs = cdpRequestTimeoutMs) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (message.error) rejectReq(new Error(`${method}: ${message.error.message}`));
      else resolveReq(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function waitForPage(port, { timeoutMs = cdpStartupTimeoutMs, urlHint = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastPageCount = 0;
  while (Date.now() < deadline) {
    const pages = await cdpFetch(port, '/json/list', {}, cdpProbeTimeoutMs);
    lastPageCount = Array.isArray(pages) ? pages.length : 0;
    const page = pages.find(candidate => candidate.type === 'page'
      && candidate.webSocketDebuggerUrl
      && urlHint
      && candidate.url?.includes(urlHint))
      || pages.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
    if (page) return page;
    await delay(125);
  }
  throw new Error(`Chrome did not expose a page target within ${timeoutMs}ms; observed ${lastPageCount} targets`);
}

async function evaluate(ws, expression, timeoutMs = cdpRequestTimeoutMs) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate exception');
  }
  return result.result.value;
}

function compactReadinessExpression() {
  return `(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!state) return null;
    return {
      prototypeIdentity: state.prototypeIdentity,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      active: state.active,
      width: state.width,
      height: state.height,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      error: state.error || null
    };
  })()`;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

async function writeRgbaPng(path, width, height, rgba) {
  const zlib = await import('node:zlib');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const source = Buffer.from(rgba);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    source.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  return { path, sha256: `sha256:${sha256(png)}`, byteLength: png.byteLength };
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function launchChrome({ chrome, port, userDataDir, windowSize, url, keepBrowserOpen }) {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) chromeProcess.unref();
  return chromeProcess;
}

async function attachOrLaunchBrowser({ chrome, port, userDataDir, windowSize, url, reuseBrowser, keepBrowserOpen }) {
  if (reuseBrowser && await cdpAvailable(port)) {
    return {
      identity: 'smoke-oracle-teacher-attach-or-launch-cdp-browser-v0',
      mode: 'attached-existing',
      port,
      userDataDir,
      windowSize,
      keepBrowserOpen,
      process: null,
    };
  }
  const chromeProcess = launchChrome({ chrome, port, userDataDir, windowSize, url, keepBrowserOpen });
  return {
    identity: reuseBrowser
      ? 'smoke-oracle-teacher-attach-or-launch-cdp-browser-v0'
      : 'smoke-oracle-teacher-per-capture-cdp-browser-v0',
    mode: reuseBrowser ? 'launched-shared' : 'launched-per-capture',
    port,
    userDataDir,
    windowSize,
    keepBrowserOpen,
    process: chromeProcess,
  };
}

function serializableBrowserSession(browserSession) {
  if (!browserSession) return null;
  const { process: _process, ...serializable } = browserSession;
  return serializable;
}

function parseWindowSize(value) {
  const [width, height] = String(value).split(',').map(part => Math.floor(Number(part.trim())));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1280,
    height: Number.isFinite(height) && height > 0 ? height : 960,
  };
}

async function captureDenseChunks(ws, { chunkBytes }) {
  const chunks = [];
  let metadata = null;
  let offsetBytes = 0;
  while (true) {
    const chunk = await evaluate(ws, `window.__kaminosVolumePrototype.sampleFullGridFluidFieldChunk(${JSON.stringify({
      offsetBytes,
      byteLength: chunkBytes,
    })})`);
    if (chunk?.ok !== true) throw new Error(`full-grid fluid chunk failed: ${JSON.stringify(chunk)}`);
    if (!metadata) {
      const { chunk: _chunk, ...rest } = chunk;
      metadata = rest;
    }
    chunks.push(chunk.chunk);
    offsetBytes = chunk.nextOffsetBytes;
    if (chunk.complete) break;
  }
  return { metadata, chunks };
}

async function captureTeacherFrameSample(ws, {
  frameIndex,
  sameBrowserSessionId,
  sequenceStartNowMs,
}) {
  if (controlledStep) {
    const frame = await evaluate(ws, `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: frameIndex,
      advanceSim: frameIndex > 0,
      sameBrowserSessionId,
      startNow: sequenceStartNowMs,
      stepDeltaMs,
      renderScales: [teacherRenderScale],
      includeRgba: true,
      compactSamples: false,
      resumeRenderLoop: false,
    })})`);
    if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
      throw new Error(`controlledStepFrame failed for frame ${frameIndex}: ${JSON.stringify({
        ok: frame?.ok,
        reason: frame?.reason,
        sequenceAuthority: frame?.sequenceAuthority,
        controlledStepFrameIndex: frame?.controlledStepFrameIndex,
      })}`);
    }
    if (frame.scaleSet?.ok !== true || frame.scaleSet.sampleSetAuthority !== 'frame-locked-render-scale-set-v0') {
      throw new Error(`controlledStepFrame omitted frame-locked render-scale set for frame ${frameIndex}: ${JSON.stringify({
        ok: frame.scaleSet?.ok,
        reason: frame.scaleSet?.reason,
        sampleSetAuthority: frame.scaleSet?.sampleSetAuthority,
      })}`);
    }
    const sample = frame.scaleSet.samples?.[0];
    if (sample?.ok !== true) {
      throw new Error(`controlledStepFrame sample failed for frame ${frameIndex}: ${JSON.stringify({
        ok: sample?.ok,
        reason: sample?.reason,
        sampleAuthority: sample?.sampleAuthority,
      })}`);
    }
    return {
      sample,
      sequence: {
        sequenceAuthority: frame.sequenceAuthority,
        sampleSetAuthority: frame.scaleSet.sampleSetAuthority,
        sampleAuthority: frame.scaleSet.sampleAuthority,
        sameBrowserSessionId: frame.sameBrowserSessionId,
        sequenceStartNowMs: frame.sequenceStartNowMs,
        controlledStepFrameIndex: frame.controlledStepFrameIndex,
        controlledStepDeltaMs: frame.controlledStepDeltaMs,
        controlledStepNowMs: frame.controlledStepNowMs,
        controlledStepCapture: frame.controlledStepCapture,
        sameStateCaptureId: frame.scaleSet.sameStateCaptureId,
        baseFrameCount: frame.scaleSet.baseFrameCount,
        baseSimStepCount: frame.scaleSet.baseSimStepCount,
        fixedNowMs: frame.scaleSet.fixedNowMs,
        renderScales: frame.scaleSet.renderScales,
      },
    };
  }
  const sample = await evaluate(ws, `window.__kaminosVolumePrototype.sampleFrame(${JSON.stringify({
    advanceSim: frameIndex > 0,
    includeRgba: true,
    now: performance.now() + frameIndex * stepDeltaMs,
  })})`);
  return { sample, sequence: null };
}

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-smoke-oracle-teacher-sequence'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/teacher-capture-report.json`));
const url = String(args.get('--url') || DEFAULT_URL);
const frames = Math.max(1, Math.floor(Number(args.get('--frames') || 2)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const stepDeltaMs = Math.max(0, Number(args.get('--step-delta-ms') || 220));
const requestedChunkBytes = Number(args.get('--chunk-bytes') || DEFAULT_DENSE_CHUNK_BYTES);
const chunkBytes = Math.max(4, Math.floor(requestedChunkBytes / 4) * 4);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const windowSize = String(args.get('--window-size') || '1280,960');
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = resolve(String(args.get('--user-data-dir') || `/tmp/kaminos-smoke-oracle-teacher-profile-${port}`));
const keepBrowserOpen = args.has('--keep-browser-open');
const reuseBrowser = args.has('--reuse-browser');
const controlledStep = !args.has('--no-controlled-step');
const routeRenderScale = Number(new URL(url).searchParams.get('volume_render_scale'));
const teacherRenderScale = Math.max(0.1, Math.min(1, Number.isFinite(Number(args.get('--teacher-render-scale')))
  ? Number(args.get('--teacher-render-scale'))
  : (Number.isFinite(routeRenderScale) ? routeRenderScale : 1)));
cdpRequestTimeoutMs = Math.max(5000, Math.floor(Number(args.get('--cdp-timeout-ms') || cdpRequestTimeoutMs)));
cdpStartupTimeoutMs = Math.max(1000, Math.floor(Number(args.get('--cdp-startup-timeout-ms') || cdpStartupTimeoutMs)));
cdpProbeTimeoutMs = Math.max(250, Math.floor(Number(args.get('--cdp-probe-timeout-ms') || Math.min(1000, cdpStartupTimeoutMs))));

const report = {
  schema: 'kaminos.smoke-oracle-teacher-capture-report.v0',
  status: 'running',
  requestedRoute: url,
  outDir,
  reportPath,
  frames: [],
  failures: [],
  chunkBytes,
  chunkingPolicy: {
    identity: 'cdp-chunked-full-grid-readback-no-total-cap-v1',
    defaultChunkBytes: DEFAULT_DENSE_CHUNK_BYTES,
    requestedChunkBytes,
    effectiveChunkBytes: chunkBytes,
    measuredReason: '4MiB CDP Runtime.evaluate dense export timed out on 64^3 teacher capture; 256KiB chunks completed the full 16MiB field without truncation',
    totalFlowPolicy: 'uncapped-contiguous-chunks-until-runtime-complete',
  },
  cdpRequestTimeoutMs,
  cdpStartupTimeoutMs,
  cdpProbeTimeoutMs,
  controlledStep,
  teacherRenderScale,
  port,
  windowSize,
  userDataDir,
  keepBrowserOpen,
  reuseBrowser,
  createdAt: new Date().toISOString(),
};
await writeJson(reportPath, report);

async function updateReportPhase(phase, extra = {}) {
  report.phase = phase;
  Object.assign(report, extra);
  report.updatedAt = new Date().toISOString();
  await writeJson(reportPath, report);
}

async function recordFailureReport(error, { phase = report.phase || 'unknown', signal = null, status = 'failed' } = {}) {
  report.status = status;
  report.failurePhase = phase;
  report.updatedAt = new Date().toISOString();
  report.failures.push({
    message: error?.message || String(error),
    stack: error?.stack || null,
    signal,
    capturedFrameCount: report.frames.length,
    lastTrustworthyEvidence: report.lastTrustworthyEvidence || null,
  });
  await writeJson(reportPath, report);
}

let browserSession = null;
let ws = null;
let signalHandling = false;
async function handleSignal(signal) {
  if (signalHandling) process.exit(signal === 'SIGINT' ? 130 : 143);
  signalHandling = true;
  await recordFailureReport(new Error(`${signal} interrupted smoke oracle teacher capture`), {
    phase: report.phase || 'interrupted',
    signal,
    status: 'failed',
  });
  if (browserSession?.process && !keepBrowserOpen) browserSession.process.kill('SIGTERM');
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.once('SIGINT', () => { void handleSignal('SIGINT'); });
process.once('SIGTERM', () => { void handleSignal('SIGTERM'); });

try {
  await mkdir(outDir, { recursive: true });
  await updateReportPhase('browser-launch');
  browserSession = await attachOrLaunchBrowser({ chrome, port, userDataDir, windowSize, url, reuseBrowser, keepBrowserOpen });
  report.browserSession = serializableBrowserSession(browserSession);
  await updateReportPhase('cdp-startup');
  const version = await waitForCdp(port, { timeoutMs: cdpStartupTimeoutMs });
  report.browser = { Browser: version.Browser || null, webSocketDebuggerUrl: version.webSocketDebuggerUrl || null };
  await updateReportPhase('target-discovery');
  const page = await waitForPage(port, { timeoutMs: cdpStartupTimeoutMs, urlHint: 'kaminos_volume_smoke=1' });
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  const viewport = parseWindowSize(windowSize);
  await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await updateReportPhase('page-navigate');
  await wsRequest(ws, 'Page.navigate', { url });
  if (!reuseBrowser) await wsRequest(ws, 'Page.bringToFront');
  await updateReportPhase('route-settle');
  await delay(settleMs);
  await updateReportPhase('route-readiness');
  let lastReadinessState = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await evaluate(ws, compactReadinessExpression());
    lastReadinessState = state;
    report.lastTrustworthyEvidence = {
      phase: 'route-readiness',
      attempt,
      state,
      observedAt: new Date().toISOString(),
    };
    if (attempt === 0 || attempt % 10 === 0) await writeJson(reportPath, report);
    if (state?.active
        && state.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0'
        && state.width > 0
        && state.height > 0
        && state.frameCount > 0) break;
    await delay(250);
    if (attempt === 119) throw new Error(`native volume route did not become active: ${JSON.stringify(lastReadinessState)}`);
  }
  let sameBrowserSessionId = null;
  let sequenceStartNowMs = null;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    await updateReportPhase(`frame-${frameIndex}-sample`);
    const captured = await captureTeacherFrameSample(ws, {
      frameIndex,
      sameBrowserSessionId,
      sequenceStartNowMs,
    });
    const { sample, sequence } = captured;
    if (sequence) {
      sameBrowserSessionId = sequence.sameBrowserSessionId;
      sequenceStartNowMs = sequence.sequenceStartNowMs;
    }
    if (sample?.ok !== true) throw new Error(`sampleFrame failed for frame ${frameIndex}: ${JSON.stringify(sample)}`);
    if (sample.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') throw new Error(`wrong effective route: ${sample.effectiveRoute}`);
    if (!sample.image || !Array.isArray(sample.image.rgba)) {
      throw new Error(`sampleFrame omitted RGBA image for frame ${frameIndex}`);
    }
    const expectedRgbaLength = Number(sample.image.width) * Number(sample.image.height) * 4;
    if (sample.image.rgba.length !== expectedRgbaLength) {
      throw new Error(`sampleFrame RGBA image was partial for frame ${frameIndex}: ${sample.image.rgba.length}/${expectedRgbaLength}`);
    }
    const frameId = `sim-step-${sample.simStepCount}`;
    const imagePath = resolve(outDir, `${frameId}.raymarch.png`);
    const image = await writeRgbaPng(imagePath, sample.image.width, sample.image.height, sample.image.rgba);
    report.lastTrustworthyEvidence = {
      phase: `frame-${frameIndex}-sample`,
      frameId,
      simStepCount: sample.simStepCount,
      frameCount: sample.frameCount,
      effectiveRoute: sample.effectiveRoute,
      prototypeIdentity: sample.prototypeIdentity,
      backend: sample.backend,
      image,
      sequence,
      observedAt: new Date().toISOString(),
    };
    await writeJson(reportPath, report);
    await updateReportPhase(`frame-${frameIndex}-dense-export`);
    const { metadata, chunks } = await captureDenseChunks(ws, { chunkBytes });
    const materialized = await materializeSmokeOracleTeacherFrameExport({
      outDir,
      frameId,
      metadata,
      chunks,
    });
    report.frames.push({
      frameIndex,
      frameId,
      simStepCount: sample.simStepCount,
      frameCount: sample.frameCount,
      effectiveRoute: sample.effectiveRoute,
      prototypeIdentity: sample.prototypeIdentity,
      backend: sample.backend,
      sampleAuthority: sample.sampleAuthority,
      sequence,
      render: {
        path: image.path,
        sha256: image.sha256,
        width: sample.image.width,
        height: sample.image.height,
        meanLuma: sample.meanLuma,
        litPixels: sample.litPixels,
        smokeLikePixels: sample.smokeLikePixels,
      },
      denseField: {
        manifestPath: materialized.manifestPath,
        manifestIdentity: materialized.manifestIdentity,
        fluidPath: materialized.fluidPath,
        fluidIdentity: materialized.fluidIdentity,
        byteLength: materialized.byteLength,
        grid: metadata.grid,
        chunkCount: chunks.length,
      },
      simReadback: {
        grid: sample.simReadback?.grid,
        densityMax: sample.simReadback?.densityMax,
        smokeWeight: sample.simReadback?.smokeWeight,
        smokeVisualRiseDisplacement: sample.simReadback?.smokeVisualRiseDisplacement,
        liveVoxels: sample.simReadback?.liveVoxels,
      },
    });
    report.updatedAt = new Date().toISOString();
    await writeJson(reportPath, report);
  }
  report.status = 'captured';
  report.updatedAt = new Date().toISOString();
  await writeJson(reportPath, report);
  ws.close();
} catch (error) {
  await recordFailureReport(error, {
    phase: report.phase || (report.frames.length ? 'sequence-capture' : 'route-capture'),
  });
  throw error;
} finally {
  if (ws) ws.close();
  if (browserSession?.process && !keepBrowserOpen) browserSession.process.kill('SIGTERM');
}

console.log(JSON.stringify(report, null, 2));
