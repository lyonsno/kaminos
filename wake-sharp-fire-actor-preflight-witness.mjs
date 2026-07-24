#!/usr/bin/env node

import { createHash, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const EXPECTED = Object.freeze({
  mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
  actorId: 'wake-kiln-flamebowl-hero',
  basinRevision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
  packageSha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc',
  engineSha256: 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab',
  carrierIdentity: 'kaminos.wake-sharp-promoted-fire-volume-adapter.v1',
  carrierSha256: 'fcdec4fd4b7a103b5f228613a90d4a1f48bff63112f70403c488fa64902e0ca4',
  routeId: 'sharp-image-to-splat-live-v0',
  routeAuthority: 'same-browser-product-realm-shared-device',
  splatMode: 'kernel_moment_covariance',
});

export function validateWakeSharpFireActorPreflightState(state, {
  expectedSharpRevision,
} = {}) {
  if (state?.phase !== 'burning') throw new Error(`product fire phase mismatch: ${state?.phase || 'missing'}`);
  const episode = state.fireActorProductEpisode;
  if (episode?.status !== 'recording') throw new Error('product FireActor episode is not recording');
  if (!state.firingId || episode.firingId !== state.firingId) throw new Error('product firing identity mismatch');
  if (episode.mountId !== EXPECTED.mountId) throw new Error('product mount identity mismatch');
  if (episode.actorId !== EXPECTED.actorId) throw new Error('product actor identity mismatch');
  if (episode.basinRevision !== EXPECTED.basinRevision) throw new Error('product basin revision mismatch');
  if (episode.packageSha256 !== EXPECTED.packageSha256) throw new Error('product package SHA-256 mismatch');
  if (episode.engine?.effectiveSha256 !== EXPECTED.engineSha256) {
    throw new Error('product promoted engine identity mismatch');
  }
  if (episode.carrier?.identity !== EXPECTED.carrierIdentity
    || episode.carrier?.effectiveSha256 !== EXPECTED.carrierSha256) {
    throw new Error('product promoted carrier identity mismatch');
  }
  if (!expectedSharpRevision
    || episode.sharp?.requestedRevision !== expectedSharpRevision
    || episode.sharp?.effectiveRevision !== expectedSharpRevision
    || episode.sharp?.revisionContractStatus !== 'matched') {
    throw new Error('product SHARP revision contract mismatch');
  }
  if (episode.activation?.mode !== 'product-route'
    || episode.activation?.routeId !== EXPECTED.routeId
    || episode.activation?.authority !== EXPECTED.routeAuthority
    || episode.activation?.inferenceRequired !== true) {
    throw new Error('product route activation identity mismatch');
  }
  const volume = state.volumeState;
  if (volume?.active !== true) throw new Error('promoted product volume is not active');
  if (!(volume.frameCount > 0) || !(volume.simStepCount > 0)) {
    throw new Error('promoted product volume did not advance a rendered simulation frame');
  }
  if (volume.boundarySplatMode !== EXPECTED.splatMode) {
    throw new Error(`promoted product splat mode mismatch: ${volume.boundarySplatMode || 'missing'}`);
  }
  const fallback = volume.error
    || volume.boundarySplatFallbackReason
    || volume.boundarySplatPresentationModeFallbackReason
    || volume.raymarchSmokePresentationModeFallbackReason;
  if (fallback) throw new Error(`promoted product fallback: ${fallback}`);
  if (volume.raymarchSmokePresentationModeEffective !== 'on') {
    throw new Error('promoted product smoke presentation is not effective');
  }
  if (volume.timing?.identity !== 'wake-sharp-promoted-fire-carrier-timing-v0'
    || !(volume.timing.frameSamples > 0)
    || volume.timing.queueTimingAvailable !== true) {
    throw new Error('promoted product carrier timing is unavailable');
  }
  const stageTiming = volume.liveStageTimingReceipt;
  if (stageTiming?.status !== 'sampled'
    || stageTiming.authority !== 'same-controls-same-device-separate-diagnostic-submit'
    || stageTiming.carrierTimingReset !== true
    || stageTiming.profile?.timestampStatus !== 'available'
    || stageTiming.profile?.reason !== 'timestamp-query-sampled'
    || stageTiming.profile?.stages?.total?.status !== 'sampled'
    || !Number.isFinite(stageTiming.profile.stages.total.ms)
    || !(stageTiming.profile.stages.total.ms > 0)) {
    throw new Error('promoted product GPU stage timing is unavailable');
  }
  if (state.pixelWitness?.projectionIdentity !== 'promoted-canvas-raised-over-product-ui') {
    throw new Error('promoted product pixel witness projection identity mismatch');
  }
  if (!(state.pixelWitness?.width > 0) || !(state.pixelWitness?.height > 0)
    || !(state.pixelWitness.changedPixels > 0) || !(state.pixelWitness.litPixels > 0)) {
    throw new Error('promoted product canvas is blank');
  }
  return state;
}

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result.set(key, next);
      index += 1;
    } else {
      result.set(key, '1');
    }
  }
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
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Runtime evaluation failed',
    );
  }
  return result.result.value;
}

async function waitForProductFireApi(ws) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await evaluate(ws, 'Boolean(window.kaminosSharpBreathingRoomKilnFireDebug?.begin)')) return;
    await delay(125);
  }
  throw new Error('Wake product fire API did not mount');
}

async function waitForKaminosHostReady(ws) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const ready = await evaluate(
      ws,
      `Boolean(
        window.__kaminosVolumePrototype?.debugState
        && window.__kaminosVolumeBridge?.debugState
        && document.readyState === 'complete'
      )`,
    );
    if (ready) return;
    await delay(125);
  }
  throw new Error('Kaminos scene and ordinary volume host did not initialize');
}

async function waitForProductFireFrame(ws, waitMs, observeState = () => {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const state = await evaluate(ws, 'window.kaminosSharpBreathingRoomKilnFireDebug.state()');
    observeState(state);
    if (state?.fire?.error) {
      throw new Error(
        `Product fire failed before first frame: ${state.fire.error}${state.fire.errorStack ? `\n${state.fire.errorStack}` : ''}`,
      );
    }
    if (state?.volume?.error) {
      throw new Error(`Promoted product frame failed: ${state.volume.error}`);
    }
    if (state?.fire?.phase === 'burning'
      && state?.volume?.frameCount > 0
      && state?.volume?.simStepCount > 0) return state;
    await delay(250);
  }
  throw new Error(`Product fire did not produce its first frame within caller wait ${waitMs} ms`);
}

async function raisePromotedCanvasForWitness(ws) {
  return evaluate(ws, `(() => {
    const canvas = document.getElementById('kaminos-wake-sharp-promoted-fire-canvas');
    if (!canvas) throw new Error('Promoted product canvas is missing');
    const priorInlineZIndex = canvas.style.getPropertyValue('z-index');
    const priorInlineZIndexPriority = canvas.style.getPropertyPriority('z-index');
    canvas.style.setProperty('z-index', '2147483646', 'important');
    return {
      identity: 'promoted-canvas-raised-over-product-ui',
      renderSource: 'live-product-canvas',
      uiOcclusionSuppressed: true,
      routeMutation: false,
      priorInlineZIndex,
      priorInlineZIndexPriority,
    };
  })()`);
}

async function restorePromotedCanvasAfterWitness(ws, projection) {
  await evaluate(ws, `(() => {
    const canvas = document.getElementById('kaminos-wake-sharp-promoted-fire-canvas');
    if (!canvas) throw new Error('Promoted product canvas disappeared before witness restoration');
    const value = ${JSON.stringify(projection?.priorInlineZIndex || '')};
    const priority = ${JSON.stringify(projection?.priorInlineZIndexPriority || '')};
    if (value) canvas.style.setProperty('z-index', value, priority);
    else canvas.style.removeProperty('z-index');
    return true;
  })()`);
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
  if (!canvasBounds) throw new Error('Promoted product canvas bounds are missing');
  const decoded = decodeScreenshotPng(png);
  const scaleX = decoded.width / Math.max(1, viewport.width);
  const scaleY = decoded.height / Math.max(1, viewport.height);
  const x0 = Math.max(0, Math.floor(canvasBounds.left * scaleX));
  const y0 = Math.max(0, Math.floor(canvasBounds.top * scaleY));
  const x1 = Math.min(decoded.width, Math.ceil(canvasBounds.right * scaleX));
  const y1 = Math.min(decoded.height, Math.ceil(canvasBounds.bottom * scaleY));
  const sampleOffset = (y0 * decoded.width + x0) * decoded.channels;
  const base = [
    decoded.pixels[sampleOffset],
    decoded.pixels[sampleOffset + 1],
    decoded.pixels[sampleOffset + 2],
  ];
  let changedPixels = 0;
  let litPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const r = decoded.pixels[offset];
      const g = decoded.pixels[offset + 1];
      const b = decoded.pixels[offset + 2];
      if (Math.abs(r - base[0]) + Math.abs(g - base[1]) + Math.abs(b - base[2]) > 8) changedPixels += 1;
      if (r + g + b > 24) litPixels += 1;
    }
  }
  return { width: x1 - x0, height: y1 - y0, changedPixels, litPixels };
}

const browserProjection = `(() => {
  const state = window.kaminosSharpBreathingRoomKilnFireDebug.state();
  const fire = state?.fire;
  const volume = state?.volume;
  const canvas = document.getElementById('kaminos-wake-sharp-promoted-fire-canvas');
  const bounds = canvas?.getBoundingClientRect?.();
  return {
    phase: fire?.phase,
    firingId: fire?.firingId,
    fireActorProductEpisode: fire?.fireActorProductEpisode,
    sharpMount: fire?.sharpMount,
    volumeState: {
      active: volume?.active,
      frameCount: volume?.frameCount,
      simStepCount: volume?.simStepCount,
      boundarySplatMode: volume?.boundarySplatMode,
      boundarySplatRendererIdentity: volume?.boundarySplatRendererIdentity,
      boundarySplatFallbackReason: volume?.boundarySplatFallbackReason,
      boundarySplatPresentationModeFallbackReason: volume?.boundarySplatPresentationModeFallbackReason,
      raymarchSmokePresentationModeEffective: volume?.raymarchSmokePresentationModeEffective,
      raymarchSmokePresentationModeFallbackReason: volume?.raymarchSmokePresentationModeFallbackReason,
      timing: volume?.timing,
      liveStageTimingReceipt: volume?.liveStageTimingReceipt,
      gpuProfile: volume?.boundarySplatGpuProfile,
      error: volume?.error,
    },
    canvasBounds: bounds ? {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    } : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pixelWitness: null,
  };
})()`;

export async function runWakeSharpFireActorPreflight(options = {}) {
  const url = options.url || 'http://127.0.0.1:18402/';
  const requestedOutputPath = options.outputPath
    || 'artifacts/wake-sharp-fire-actor-preflight/live/fireactor-product-preflight.png';
  const requestedReportPath = options.reportPath
    || 'artifacts/wake-sharp-fire-actor-preflight/live/report.json';
  const outputPath = resolve(requestedOutputPath);
  const reportPath = resolve(requestedReportPath);
  const expectedSharpRevision = String(options.expectedSharpRevision || '').trim();
  const settleMs = Number(options.settleMs || 5000);
  const frameWaitMs = Number(options.frameWaitMs || 60000);
  const port = Number(options.debugPort || randomInt(42000, 62000));
  const chrome = options.chrome
    || process.env.KAMINOS_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const userDataDir = options.userDataDir || `/tmp/kaminos-wake-sharp-fireactor-${port}-${process.pid}`;
  const firingId = options.firingId || `firing-fireactor-preflight-${Date.now()}`;
  const failureReportPath = resolve(
    options.failureReportPath || `${requestedReportPath}.failed-${firingId}.json`,
  );
  let phase = 'launch';
  let browser = null;
  let ws = null;
  let primaryOutputWritten = false;
  let preflightState = null;
  let lastObservedState = null;
  let screenshotProjection = null;
  let screenshotPng = null;
  let screenshotSha256 = null;
  let releaseState = null;
  let failure = null;

  const writeReport = () => {
    const successful = failure === null
      && primaryOutputWritten
      && releaseState?.phase === 'preflight-complete'
      && releaseState?.volumeReleaseConfirmed === true;
    const effectiveReportPath = successful ? reportPath : failureReportPath;
    mkdirSync(dirname(effectiveReportPath), { recursive: true });
    writeFileSync(effectiveReportPath, JSON.stringify({
      schema: 'kaminos.wake-sharp-fire-actor-preflight-witness.v1',
      ok: successful,
      reportRole: successful ? 'canonical-success' : 'firing-specific-failure',
      reportPath: successful ? requestedReportPath : failureReportPath,
      requestedRoute: url,
      effectiveRoute: preflightState?.fireActorProductEpisode?.activation?.routeId
        === EXPECTED.routeId ? url : null,
      requested: {
        ...EXPECTED,
        sharpRevision: expectedSharpRevision || null,
        firingId,
      },
      invocation: {
        inferenceInvoked: false,
        action: 'product-fire-begin-and-release-only',
      },
      settleMs,
      frameWaitMs,
      phase,
      failure,
      primaryOutputWritten,
      screenshotPath: primaryOutputWritten ? requestedOutputPath : null,
      screenshotSha256: primaryOutputWritten ? screenshotSha256 : null,
      screenshotProjection,
      preflightState,
      lastObservedState,
      releaseState,
    }, null, 2));
    return effectiveReportPath;
  };

  try {
    if (!expectedSharpRevision) throw new Error('--expected-sharp-revision is required');
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
    phase = 'product-fire-api';
    await waitForProductFireApi(ws);
    await waitForKaminosHostReady(ws);
    await evaluate(ws, `document.querySelector('[data-tab="generate"]')?.click()`);
    phase = 'product-fire-begin';
    await evaluate(ws, `window.kaminosSharpBreathingRoomKilnFireDebug.begin(${JSON.stringify({
      profileId: 'baseline-default',
      source: { source: 'preflight://no-inference', label: 'FireActor product preflight' },
      pipelineId: EXPECTED.routeId,
      firingId,
      firePresentationMode: 'full-volume',
      flameContinuityMode: 'live-every-frame',
      requireSharpDutyCorrelation: false,
    })})`);
    await waitForProductFireFrame(ws, frameWaitMs, (state) => {
      lastObservedState = state;
    });
    phase = 'gpu-stage-timing';
    await evaluate(
      ws,
      'window.kaminosSharpBreathingRoomKilnFireDebug.sampleStageTimings()',
    );
    await delay(settleMs);
    phase = 'product-fire-validation';
    preflightState = await evaluate(ws, browserProjection);
    phase = 'screenshot';
    screenshotProjection = await raisePromotedCanvasForWitness(ws);
    let screenshot;
    try {
      screenshot = await cdpRequest(ws, 'Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
    } finally {
      await restorePromotedCanvasAfterWitness(ws, screenshotProjection);
      screenshotProjection.restored = true;
    }
    if (!screenshot?.data) throw new Error('CDP screenshot was empty');
    screenshotPng = Buffer.from(screenshot.data, 'base64');
    screenshotSha256 = createHash('sha256').update(screenshotPng).digest('hex');
    preflightState.pixelWitness = {
      projectionIdentity: screenshotProjection.identity,
      ...screenshotPixelWitness(
      screenshotPng,
      preflightState.canvasBounds,
      preflightState.viewport,
      ),
    };
    validateWakeSharpFireActorPreflightState(preflightState, { expectedSharpRevision });
    phase = 'product-fire-release';
    releaseState = await evaluate(
      ws,
      `window.kaminosSharpBreathingRoomKilnFireDebug.end('preflight-complete', { forceInactive: true }).then(state => ({
        phase: state?.phase,
        volumeReleaseConfirmed: state?.volumeReleaseConfirmed,
        productReceiptStatus: state?.fireActorProductReceipt?.status,
        productReceiptTerminalPhase: state?.fireActorProductReceipt?.terminalPhase,
        promotedActiveAfterRelease: state?.promotedVolumeDebugState?.active,
        restoredVolumeActive: state?.volumeDebugState?.active,
      }))`,
    );
    if (releaseState?.phase !== 'preflight-complete'
      || releaseState.volumeReleaseConfirmed !== true
      || releaseState.productReceiptStatus !== 'failed'
      || releaseState.productReceiptTerminalPhase !== 'preflight-complete'
      || releaseState.promotedActiveAfterRelease !== false) {
      throw new Error('Product FireActor preflight release evidence mismatch');
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, screenshotPng);
    primaryOutputWritten = true;
    phase = 'complete';
    return { reportPath, outputPath, preflightState, releaseState };
  } catch (error) {
    failure = { phase, error: error.message || String(error) };
    throw error;
  } finally {
    if (ws && releaseState?.phase !== 'preflight-complete') {
      try {
        releaseState = await evaluate(
          ws,
          `window.kaminosSharpBreathingRoomKilnFireDebug.end('preflight-failed', { forceInactive: true })`,
        );
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
  runWakeSharpFireActorPreflight({
    url: args.get('--url'),
    outputPath: args.get('--out'),
    reportPath: args.get('--report'),
    expectedSharpRevision: args.get('--expected-sharp-revision'),
    settleMs: args.get('--settle-ms'),
    frameWaitMs: args.get('--frame-wait-ms'),
    debugPort: args.get('--debug-port'),
    firingId: args.get('--firing-id'),
  }).then(result => {
    console.log(JSON.stringify({
      ok: true,
      reportPath: result.reportPath,
      outputPath: result.outputPath,
    }, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
