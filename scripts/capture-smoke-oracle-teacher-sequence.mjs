#!/usr/bin/env node

import { createHash, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { materializeSmokeOracleTeacherFrameExport } from '../smoke-oracle-teacher-export.mjs';
import {
  assessMinimumRadiusMaturityCandidate,
  buildMinimumRadiusTeacherContract,
  validateMinimumRadiusEffectiveState,
} from '../smoke-oracle-minimum-radius-teacher.mjs';

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
      renderPhaseTimeMs: state.renderPhaseTimeMs,
      frameSubmissionAuthority: state.frameSubmissionAuthority,
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

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodePngRgba(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.from(png.subarray(0, 8)).equals(signature)) throw new Error('native canvas screenshot is not PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!header || header.length !== 13 || !idat.length) throw new Error('native canvas PNG is partial');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`unsupported native canvas PNG layout: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const components = colorType === 6 ? 4 : 3;
  const stride = width * components;
  const packed = inflateSync(Buffer.concat(idat));
  if (packed.length !== (stride + 1) * height) throw new Error('native canvas PNG decompressed byte count mismatch');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[y * (stride + 1)];
    const input = packed.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= components ? row[x - components] : 0;
      const up = previous ? previous[x] : 0;
      const upperLeft = previous && x >= components ? previous[x - components] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paethPredictor(left, up, upperLeft)
                : NaN;
      if (!Number.isFinite(predictor)) throw new Error(`unsupported native canvas PNG filter ${filter}`);
      row[x] = (input[x] + predictor) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = pixels[pixel * components];
    rgba[pixel * 4 + 1] = pixels[pixel * components + 1];
    rgba[pixel * 4 + 2] = pixels[pixel * components + 2];
    rgba[pixel * 4 + 3] = components === 4 ? pixels[pixel * components + 3] : 255;
  }
  return { width, height, rgba };
}

function measureRgbaFrame({ width, height, rgba }) {
  let litPixels = 0;
  let smokeLikePixels = 0;
  let totalLuma = 0;
  let minSmokeY = height;
  let maxSmokeY = -1;
  let minSmokeX = width;
  let maxSmokeX = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    totalLuma += luma;
    if (luma > 20) litPixels += 1;
    if (b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60) {
      smokeLikePixels += 1;
      const y = Math.floor(pixel / width);
      const x = pixel % width;
      minSmokeY = Math.min(minSmokeY, y);
      maxSmokeY = Math.max(maxSmokeY, y);
      minSmokeX = Math.min(minSmokeX, x);
      maxSmokeX = Math.max(maxSmokeX, x);
    }
  }
  return {
    meanLuma: totalLuma / Math.max(1, width * height),
    litPixels,
    smokeLikePixels,
    smokeBounds: {
      minY: smokeLikePixels ? minSmokeY : 0,
      maxY: smokeLikePixels ? maxSmokeY : 0,
      height: smokeLikePixels ? maxSmokeY - minSmokeY + 1 : 0,
      width: smokeLikePixels ? maxSmokeX - minSmokeX + 1 : 0,
      verticalFillRatio: smokeLikePixels ? (maxSmokeY - minSmokeY + 1) / height : 0,
      horizontalFillRatio: smokeLikePixels ? (maxSmokeX - minSmokeX + 1) / width : 0,
      pixelCount: smokeLikePixels,
    },
  };
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
  if (teacherContract) {
    const hasSequenceStart = sequenceStartNowMs !== null
      && sequenceStartNowMs !== undefined
      && Number.isFinite(Number(sequenceStartNowMs));
    const requestedNow = hasSequenceStart
      ? Number(sequenceStartNowMs) + frameIndex * stepDeltaMs
      : null;
    const submission = await evaluate(ws, `window.__kaminosVolumePrototype.submitNativeTeacherFrameToCanvas(${JSON.stringify({
      advanceSim: frameIndex > 0,
      now: requestedNow,
    })})`);
    if (submission?.ok !== true || submission.sampleAuthority !== 'native-raymarch-canvas-submission-v0') {
      throw new Error(`native teacher canvas submission failed for frame ${frameIndex}: ${JSON.stringify(submission)}`);
    }
    const rect = submission.canvasCssRect || {};
    const clip = {
      x: Math.max(0, Number(rect.x) || 0),
      y: Math.max(0, Number(rect.y) || 0),
      width: Math.max(1, Number(rect.width) || 0),
      height: Math.max(1, Number(rect.height) || 0),
      scale: 1,
    };
    if (clip.width <= 1 || clip.height <= 1) throw new Error(`native teacher canvas clip is blank: ${JSON.stringify(rect)}`);
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip,
    });
    const png = Buffer.from(screenshot.data, 'base64');
    const decoded = decodePngRgba(png);
    const metrics = measureRgbaFrame(decoded);
    const majorantReadback = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleMajorantReadback()');
    const sessionId = sameBrowserSessionId || `native-canvas-${Date.now()}`;
    const startNow = hasSequenceStart ? Number(sequenceStartNowMs) : submission.sampleNowMs;
    return {
      sample: {
        ...submission,
        ...metrics,
        image: decoded,
        majorantReadback,
        captureRendererRequested: 'native-raymarch',
        captureRendererEffective: 'native-raymarch-canvas-submission-v0',
        nativeScreenshot: {
          authority: 'cdp-native-canvas-clip-after-explicit-raymarch-submission-v0',
          sha256: `sha256:${sha256(png)}`,
          byteLength: png.byteLength,
          clip,
        },
      },
      sequence: {
        sequenceAuthority: 'controlled-native-canvas-sequence-v0',
        sampleAuthority: submission.sampleAuthority,
        imageAuthority: submission.imageAuthority,
        sameBrowserSessionId: sessionId,
        sequenceStartNowMs: startNow,
        controlledStepFrameIndex: frameIndex,
        controlledStepDeltaMs: stepDeltaMs,
        controlledStepNowMs: submission.sampleNowMs,
        baseFrameCount: submission.frameCount - 1,
        baseSimStepCount: submission.simStepCount - (frameIndex > 0 ? 1 : 0),
      },
    };
  }
  if (controlledStep) {
    const frame = await evaluate(ws, `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
      controlledStepFrameIndex: frameIndex,
      advanceSim: frameIndex > 0,
      sameBrowserSessionId,
      startNow: sequenceStartNowMs,
      stepDeltaMs,
      renderScales: [teacherRenderScale],
      includeRgba: true,
      captureRenderer: 'native-raymarch',
      includeSimReadback: false,
      includeMajorantReadback: true,
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
    captureRenderer: 'native-raymarch',
    includeSimReadback: false,
    includeMajorantReadback: true,
    now: performance.now() + frameIndex * stepDeltaMs,
  })})`);
  return { sample, sequence: null };
}

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-smoke-oracle-teacher-sequence'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/teacher-capture-report.json`));
const requestedRoute = String(args.get('--url') || DEFAULT_URL);
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
const attachWithoutNavigate = args.has('--attach-without-navigate');
const controlledStep = !args.has('--no-controlled-step');
const probeUntilMature = args.has('--probe-until-mature');
const heldManifestPath = args.get('--held-manifest') ? resolve(String(args.get('--held-manifest'))) : null;
const routeRenderScale = Number(new URL(requestedRoute).searchParams.get('volume_render_scale'));
const teacherRenderScale = Math.max(0.1, Math.min(1, Number.isFinite(Number(args.get('--teacher-render-scale')))
  ? Number(args.get('--teacher-render-scale'))
  : (Number.isFinite(routeRenderScale) ? routeRenderScale : 1)));
cdpRequestTimeoutMs = Math.max(5000, Math.floor(Number(args.get('--cdp-timeout-ms') || cdpRequestTimeoutMs)));
cdpStartupTimeoutMs = Math.max(1000, Math.floor(Number(args.get('--cdp-startup-timeout-ms') || cdpStartupTimeoutMs)));
cdpProbeTimeoutMs = Math.max(250, Math.floor(Number(args.get('--cdp-probe-timeout-ms') || Math.min(1000, cdpStartupTimeoutMs))));

let teacherContract = null;
if (heldManifestPath) {
  const heldManifestBytes = await readFile(heldManifestPath);
  teacherContract = buildMinimumRadiusTeacherContract({
    heldManifest: JSON.parse(heldManifestBytes),
    heldManifestIdentity: `sha256:${sha256(heldManifestBytes)}`,
    requestedRoute,
  });
}
if (probeUntilMature && !teacherContract) {
  throw new Error('--probe-until-mature requires --held-manifest so maturity cannot detach from source authority');
}
if (probeUntilMature && frames < 2) {
  throw new Error('--probe-until-mature requires at least two adjacent teacher frames');
}
if (attachWithoutNavigate && !reuseBrowser) {
  throw new Error('--attach-without-navigate requires --reuse-browser and a proven existing CDP target');
}
if (attachWithoutNavigate && !teacherContract) {
  throw new Error('--attach-without-navigate requires --held-manifest so continued state cannot detach from source authority');
}

const captureRouteUrl = new URL(requestedRoute);
if (teacherContract) captureRouteUrl.searchParams.set('volume_capture_hold', '1');
const url = captureRouteUrl.toString();

const report = {
  schema: 'kaminos.smoke-oracle-teacher-capture-report.v0',
  status: 'running',
  requestedRoute,
  effectiveCaptureRoute: url,
  captureExecution: teacherContract ? {
    requested: 'explicit-step-no-autonomous-frame-submission',
    effectiveRouteParameter: 'volume_capture_hold=1',
    expectedAuthority: 'capture-hold-explicit-step-v0',
    simulatorControlEffect: 'none',
    rendererControlEffect: 'none',
  } : null,
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
  probeUntilMature,
  heldManifestPath,
  teacherContract,
  maturityProbes: [],
  teacherRenderScale,
  port,
  windowSize,
  userDataDir,
  keepBrowserOpen,
  reuseBrowser,
  attachWithoutNavigate,
  continuationAuthority: attachWithoutNavigate ? 'same-browser-no-navigation-continuation-v0' : null,
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
  if (attachWithoutNavigate) {
    await updateReportPhase('page-attach-without-navigation', {
      continuationPageUrl: page.url,
    });
  } else {
    await updateReportPhase('page-navigate');
    await wsRequest(ws, 'Page.navigate', { url });
    if (!reuseBrowser) await wsRequest(ws, 'Page.bringToFront');
  }
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
    const routeActive = state?.active
      && state.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0';
    const captureHoldActive = teacherContract
      && state.frameSubmissionAuthority === 'capture-hold-explicit-step-v0'
      && (attachWithoutNavigate
        ? state.frameCount >= state.simStepCount && state.simStepCount > 0
        : state.frameCount === 0 && state.simStepCount === 0);
    const autonomousRouteActive = !teacherContract
      && state.width > 0
      && state.height > 0
      && state.frameCount > 0;
    if (routeActive && (captureHoldActive || autonomousRouteActive)) break;
    await delay(250);
    if (attempt === 119) throw new Error(`native volume route did not become active: ${JSON.stringify(lastReadinessState)}`);
  }

  if (attachWithoutNavigate) {
    report.continuationFrom = {
      authority: 'same-browser-no-navigation-continuation-v0',
      pageUrl: page.url,
      frameCount: lastReadinessState.frameCount,
      simStepCount: lastReadinessState.simStepCount,
      renderPhaseTimeMs: lastReadinessState.renderPhaseTimeMs,
    };
    await writeJson(reportPath, report);
  }

  if (teacherContract) {
    await updateReportPhase('minimum-radius-effective-state-validation');
    const effectiveState = await evaluate(ws, `(() => {
      const prototype = window.__kaminosVolumePrototype;
      prototype.setControls(${JSON.stringify(teacherContract.expectedControls)});
      const camera = prototype.setCameraState(${JSON.stringify({ ...teacherContract.expectedCamera, lock: true })});
      const state = prototype.debugState();
      return {
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
        controls: state.controls,
        camera
      };
    })()`);
    report.minimumRadiusEffectiveState = effectiveState;
    report.lastTrustworthyEvidence = {
      phase: 'minimum-radius-effective-state-observed',
      effectiveState,
      observedAt: new Date().toISOString(),
    };
    await writeJson(reportPath, report);
    report.effectiveStateParity = validateMinimumRadiusEffectiveState(teacherContract, effectiveState);
    report.lastTrustworthyEvidence = {
      phase: 'minimum-radius-effective-state-validation',
      effectiveStateParity: report.effectiveStateParity,
      observedAt: new Date().toISOString(),
    };
    await writeJson(reportPath, report);
  }

  function validateCapturedSample(sample, frameIndex) {
    if (sample?.ok !== true) throw new Error(`sampleFrame failed for frame ${frameIndex}: ${JSON.stringify(sample)}`);
    if (sample.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') throw new Error(`wrong effective route: ${sample.effectiveRoute}`);
    if (!sample.image || (!Array.isArray(sample.image.rgba) && !ArrayBuffer.isView(sample.image.rgba))) {
      throw new Error(`sampleFrame omitted RGBA image for frame ${frameIndex}`);
    }
    const expectedRgbaLength = Number(sample.image.width) * Number(sample.image.height) * 4;
    if (sample.image.rgba.length !== expectedRgbaLength) {
      throw new Error(`sampleFrame RGBA image was partial for frame ${frameIndex}: ${sample.image.rgba.length}/${expectedRgbaLength}`);
    }
  }

  async function persistTeacherFrame({ captured, frameIndex, existingImage = null }) {
    const { sample, sequence } = captured;
    validateCapturedSample(sample, frameIndex);
    const frameId = `sim-step-${sample.simStepCount}`;
    const imagePath = resolve(outDir, `${frameId}.raymarch.png`);
    const image = existingImage || await writeRgbaPng(imagePath, sample.image.width, sample.image.height, sample.image.rgba);
    report.lastTrustworthyEvidence = {
      phase: `frame-${frameIndex}-sample`,
      frameId,
      simStepCount: sample.simStepCount,
      frameCount: sample.frameCount,
      effectiveRoute: sample.effectiveRoute,
      prototypeIdentity: sample.prototypeIdentity,
      backend: sample.backend,
      camera: sample.camera || null,
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
      camera: sample.camera || metadata.camera || null,
      sequence,
      render: {
        path: image.path,
        sha256: image.sha256,
        imageAuthority: sample.imageAuthority || null,
        nativeScreenshot: sample.nativeScreenshot || null,
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
      majorantReadback: sample.majorantReadback || null,
    });
    report.updatedAt = new Date().toISOString();
    await writeJson(reportPath, report);
    return { sample, sequence, image };
  }

  let sameBrowserSessionId = null;
  let sequenceStartNowMs = attachWithoutNavigate ? report.continuationFrom.renderPhaseTimeMs : null;
  let sequenceFrameIndex = attachWithoutNavigate ? 1 : 0;
  let firstCaptured = null;
  let firstCapturedImage = null;
  if (probeUntilMature) {
    let previousProbe = null;
    while (!firstCaptured) {
      await updateReportPhase(`maturity-probe-${sequenceFrameIndex}`);
      const captured = await captureTeacherFrameSample(ws, {
        frameIndex: sequenceFrameIndex,
        sameBrowserSessionId,
        sequenceStartNowMs,
      });
      const { sample, sequence } = captured;
      validateCapturedSample(sample, sequenceFrameIndex);
      if (sequence) {
        sameBrowserSessionId = sequence.sameBrowserSessionId;
        sequenceStartNowMs = sequence.sequenceStartNowMs;
      }
      const probePath = resolve(outDir, 'maturity-probes', `sim-step-${sample.simStepCount}.png`);
      const image = await writeRgbaPng(probePath, sample.image.width, sample.image.height, sample.image.rgba);
      const currentProbe = {
        simStepCount: sample.simStepCount,
        render: {
          width: sample.image.width,
          height: sample.image.height,
          litPixels: sample.litPixels,
          smokeLikePixels: sample.smokeLikePixels,
          imageAuthority: sample.imageAuthority || null,
          nativeScreenshot: sample.nativeScreenshot || null,
          sha256: image.sha256,
          path: image.path,
        },
        support: {
          liveVoxels: sample.majorantReadback?.occupiedBricks,
          smokeWeight: Number(sample.majorantReadback?.extinctionMean || 0) * Number(sample.majorantReadback?.bricks || 0),
          smokeVisualRiseDisplacement: sample.smokeBounds?.verticalFillRatio,
          smokeVisualLateralDisplacement: sample.smokeBounds?.horizontalFillRatio,
        },
      };
      const assessment = assessMinimumRadiusMaturityCandidate({ current: currentProbe, previous: previousProbe });
      report.maturityProbes.push({ ...assessment, capturedAt: new Date().toISOString() });
      report.lastTrustworthyEvidence = {
        phase: `maturity-probe-${sequenceFrameIndex}`,
        assessment,
        image,
        observedAt: new Date().toISOString(),
      };
      await writeJson(reportPath, report);
      if (assessment.candidate) {
        firstCaptured = captured;
        firstCapturedImage = image;
        report.maturityCandidate = assessment;
        break;
      }
      previousProbe = currentProbe;
      sequenceFrameIndex += 1;
    }
  }

  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    await updateReportPhase(`frame-${frameIndex}-sample`);
    let captured = frameIndex === 0 && firstCaptured ? firstCaptured : null;
    if (!captured) {
      if (frameIndex > 0 || firstCaptured) sequenceFrameIndex += 1;
      captured = await captureTeacherFrameSample(ws, {
        frameIndex: sequenceFrameIndex,
        sameBrowserSessionId,
        sequenceStartNowMs,
      });
    }
    if (captured.sequence) {
      sameBrowserSessionId = captured.sequence.sameBrowserSessionId;
      sequenceStartNowMs = captured.sequence.sequenceStartNowMs;
    }
    await persistTeacherFrame({
      captured,
      frameIndex,
      existingImage: frameIndex === 0 ? firstCapturedImage : null,
    });
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
